// Função de avaliação do bot: quanto a posição é boa para `player`, em "pontos de poder"
// (1000 ≈ o valor de +1000 de poder num ataque). Positivo = bom para `player`.
//
// Cada termo nasce de um conceito de tempo do jogo (ver docs/bot-tempo.md):
// - Vida como recurso: as tabelas `life` (a própria) e `lifeOpp` (a do oponente) são côncavas — a
//   primeira Vida perdida vale menos (e ainda dá uma carta), as últimas valem muito.
// - Vantagem de cartas: cada carta na mão vale `handCard`; a do oponente desconta.
// - Tabuleiro: custo, poder e palavras-chave dos Personagens em campo; o Personagem virado no
//   fim do turno fica exposto ao contra-ataque.
// - DON!!: cada DON!! em campo é tempo permanente (DON!! −X custa de verdade).
// - Deck: ficar sem cartas perde a partida.
// - Ameaça: quantos ataques do oponente passam pela melhor defesa no turno dele (`incomingHits`).
//
// Os pesos padrão saíram de uma otimização em auto-jogo (SPSA, ~29 mil partidas; ver
// docs/bot-tempo.md e `scripts/tune-weights.ts`): partindo dos pesos escritos à mão, cada rodada põe
// duas variações dos pesos para jogar entre si e anda na direção da que venceu mais. Os de defesa (`life`,
// `threatHit`, `lethal`) vieram depois do ajuste por imitação das defesas dos melhores colocados dos torneios
// (`apps/server/src/decisions/tune.ts`; docs/bot-tempo.md, seção 11).
//
// A função lê só a visão (`viewFor`): cartas escondidas aparecem como `?` e contam pelo número.

import { cardDef, counterValue, getPower, hasKeyword, opponent, playCost } from '../engine';
import { HIDDEN_CARD } from '../view';
import type { GameState, PlayerId, PlayerState } from '../types';

export interface Weights {
  /** Valor acumulado de ter N cartas de Vida (índice = N; além do fim, soma `lifeExtra` por carta). */
  life: number[];
  lifeExtra: number;
  /** O mesmo para a Vida do oponente. */
  lifeOpp: number[];
  lifeOppExtra: number;
  /** Carta na própria mão que o bot não vê (ex.: a que acabou de sair da Vida) e carta na mão do oponente. */
  handCard: number;
  handCardOpp: number;
  /** Carta visível na própria mão: valor fixo mais o Counter impresso (por 1000) e o bônus de Evento [Counter] pagável. */
  handCardBase: number;
  handCounter: number;
  handCounterEvent: number;
  /** Acima deste tamanho, cada carta a mais na mão vale metade (não dá para jogar tudo). */
  handSoftCap: number;
  /** Personagem em campo: por ponto de custo, fixo por corpo e por 1000 de poder base. */
  charCost: number;
  charBase: number;
  charPower: number;
  /** Palavras-chave em campo. */
  blocker: number;
  rush: number;
  doubleAttack: number;
  /** Stage em campo. */
  stage: number;
  /** Personagem virado quando o turno passa para o oponente (e ao alcance do Líder dele): fica exposto ao ataque. */
  exposed: number;
  /** DON!! em campo (área de custo + anexados), por unidade. */
  don: number;
  /**
   * No meio do próprio turno: DON!! anexado a uma carta que ainda pode atacar. Some no fim do turno
   * (os DON!! voltam na Renovação); serve só para a busca não descartar "anexar" antes de "atacar".
   */
  donReady: number;
  /** Deck quase vazio (≤ `deckLowAt` cartas). */
  deckLow: number;
  deckLowAt: number;
  /**
   * Ameaça do próximo ataque do oponente (`incomingThreat`): por ataque que passa pela melhor defesa
   * (Blockers em pé, Counters da mão) e o castigo de deixar o Líder ao alcance de um ataque fatal.
   * `threat` multiplica os dois (o planejador o zera no próprio turno: ver `defenseOrPlan`).
   */
  threat: number;
  threatHit: number;
  lethal: number;
  /**
   * Modelo do Counter do oponente nos ataques do bot (a mão dele é escondida; ver `counterAbility` no
   * planejador): chance de uma carta escondida ter Counter (`counterCard`) e de ser +2000 (`counterBig`,
   * parte da anterior); as cartas somam. `counterWill` é um fator sobre a vontade dele de gastar
   * Counter num ataque que não é fatal, e `counterStack` o quanto essa vontade cai a cada 1000 a mais
   * que ele teria de cobrir (gastar duas cartas por uma Vida é raro). Um ataque fatal ele defende sempre que pode.
   */
  counterCard: number;
  counterBig: number;
  counterWill: number;
  counterStack: number;
  /**
   * Valor de uma vitória *provável* (ataque fatal que o oponente talvez consiga parar), na escala da
   * avaliação: a linha vale `winCap` vezes a chance de passar mais a posição se falhar. Sem o teto, qualquer
   * chance de vencer (vezes `win`) engolia a posição que sobra quando o ataque é parado.
   */
  winCap: number;
  /**
   * No próprio turno: castigo por encerrar com o oponente tendo ataque fatal na mesa (`incomingHits` >
   * Vida, contando os Blockers em pé e os Counters da mão). Um humano acha esse ataque sempre.
   */
  lethalPlan: number;
  /** Partida decidida. */
  win: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  life: [0, 8993, 13871, 17453, 21652, 25802],
  lifeExtra: 4150,
  lifeOpp: [0, 37400, 52000, 57100, 61550, 64700],
  lifeOppExtra: 3150,
  handCard: 2900,
  handCardOpp: 1600,
  handCardBase: 1500,
  handCounter: 1100,
  handCounterEvent: 550,
  handSoftCap: 7,
  charCost: 810,
  charBase: 1220,
  charPower: 590,
  blocker: 1550,
  rush: 210,
  doubleAttack: 800,
  stage: 1700,
  exposed: 490,
  don: 2200,
  donReady: 300,
  deckLow: 25000,
  deckLowAt: 2,
  threat: 1,
  threatHit: 2890,
  lethal: 1512,
  counterCard: 0.72,
  counterBig: 0.2,
  counterWill: 1,
  counterStack: 0.6,
  winCap: 120_000,
  lethalPlan: 60_000,
  win: 10_000_000,
};

function lifeValue(w: Weights, n: number, opp = false): number {
  const table = opp ? w.lifeOpp : w.life;
  if (n < table.length) return table[n];
  return table[table.length - 1] + (n - (table.length - 1)) * (opp ? w.lifeOppExtra : w.lifeExtra);
}

/**
 * Valor da mão. A do oponente conta pelo tamanho; a própria, carta a carta: um Counter impresso defende, um
 * Evento [Counter] só vale se sobrar DON!! ativo para pagá-lo no turno do oponente (guardar DON!! é tempo).
 */
function handValue(state: GameState, w: Weights, ps: PlayerState, hidden: number): number {
  let total = 0;
  const values = ps.hand.map((uid) => {
    const def = cardDef(state, uid);
    if (def.id === HIDDEN_CARD) return hidden;
    let v = w.handCardBase + (counterValue(state, uid) / 1000) * w.handCounter;
    if (def.category === 'event' && def.abilities.some((a) => a.timing === 'counter') && playCost(state, uid) <= ps.donActive) v += w.handCounterEvent;
    return v;
  });
  values.sort((a, b) => b - a);
  values.forEach((v, i) => (total += i < w.handSoftCap ? v : v * 0.5));
  return total;
}

/** Valor de um Personagem (ou Stage) em campo, pelos dados da carta e palavras-chave. */
export function fieldCardValue(state: GameState, w: Weights, uid: string): number {
  const def = cardDef(state, uid);
  if (def.category === 'stage') return w.stage;
  let v = w.charBase + (def.cost ?? 0) * w.charCost + ((def.power ?? 0) / 1000) * w.charPower;
  if (hasKeyword(state, uid, 'blocker')) v += w.blocker;
  if (hasKeyword(state, uid, 'rush')) v += w.rush;
  if (hasKeyword(state, uid, 'doubleAttack')) v += w.doubleAttack;
  return v;
}

function sideValue(state: GameState, w: Weights, ps: PlayerState, hidden: number, exposedToOpponent: boolean, opp: boolean): number {
  let v = lifeValue(w, ps.life.length, opp);
  const myTurn = state.activePlayer === ps.id;
  if (myTurn && state.turn > 2) {
    for (const c of [ps.leader, ...ps.characters]) {
      if (!c.rested && c.don && (c.playedOnTurn !== state.turn || hasKeyword(state, c.uid, 'rush'))) v += c.don * w.donReady;
    }
  }
  v += handValue(state, w, ps, hidden);
  for (const c of ps.characters) {
    const cv = fieldCardValue(state, w, c.uid);
    v += cv;
    // No turno do oponente, o Personagem virado pode ser atacado.
    if (exposedToOpponent && c.rested) {
      const threat = getPower(state, state.players[opponent(ps.id)].leader.uid) + 2000;
      if (getPower(state, c.uid) <= threat) v -= w.exposed;
    }
  }
  if (ps.stage) v += fieldCardValue(state, w, ps.stage.uid);
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  v += (ps.donActive + ps.donRested + attached) * w.don;
  if (ps.deck.length <= w.deckLowAt) v -= w.deckLow;
  return v;
}

/** O +poder de um Evento [Counter] (0 se o efeito não dá poder). */
function counterEventPower(state: GameState, uid: string): number {
  const ab = cardDef(state, uid).abilities.find((a) => a.timing === 'counter');
  return ab?.steps.reduce((sum, st) => sum + (st.do === 'power' && st.amount > 0 ? st.amount : 0), 0) ?? 0;
}

/** Counters da mão: o valor impresso ou o +poder de um Evento [Counter] (que custa DON!!). */
function handCounters(state: GameState, ps: PlayerState): { value: number; cost: number }[] {
  const out: { value: number; cost: number }[] = [];
  for (const uid of ps.hand) {
    const def = cardDef(state, uid);
    if (def.id === HIDDEN_CARD) continue;
    if (def.category === 'event') {
      const value = counterEventPower(state, uid);
      if (value) out.push({ value, cost: playCost(state, uid) });
    } else {
      const value = counterValue(state, uid);
      if (value) out.push({ value, cost: 0 });
    }
  }
  return out;
}

/**
 * Cobre `need` de poder com os Counters que sobram (o menor que basta sozinho; senão os maiores até
 * cobrir), tirando os usados de `pool` e pagando os Eventos com `don`. false se não cobre.
 */
function spendCounters(pool: { value: number; cost: number }[], need: number, don: { left: number }): boolean {
  const usable = pool.filter((c) => c.cost <= don.left);
  const single = usable.filter((c) => c.value >= need).sort((a, b) => a.value - b.value || a.cost - b.cost)[0];
  const take = (c: { value: number; cost: number }) => {
    pool.splice(pool.indexOf(c), 1);
    don.left -= c.cost;
  };
  if (single) {
    take(single);
    return true;
  }
  let sum = 0;
  for (const c of usable.sort((a, b) => b.value - a.value)) {
    if (c.cost > don.left) continue;
    take(c);
    sum += c.value;
    if (sum >= need) return true;
  }
  return false;
}

/**
 * Quantos ataques do próximo ataque do oponente acertam o Líder de `player` mesmo com a melhor defesa:
 * no turno do oponente, com os atacantes que ainda podem atacar e o DON!! ativo dele; no próprio
 * turno, com o tabuleiro do oponente desvirado e o DON!! que ele terá no turno seguinte. O oponente
 * distribui o DON!! para acertar o Líder com o máximo de ataques; a defesa usa os [Blocker]s em pé nos
 * ataques mais caros de cobrir e os Counters da mão nos mais baratos.
 */
export function incomingHits(state: GameState, player: PlayerId): number {
  if (state.phase === 'gameover') return 0;
  const opp = opponent(player);
  const ps = state.players[player];
  const os = state.players[opp];
  const oppTurn = state.activePlayer === opp;
  if ((oppTurn ? state.turn : state.turn + 1) <= 2) return 0;

  // O Líder no turno do oponente: sem o DON!! anexado (só conta no turno do dono).
  const leaderPower = getPower(state, ps.leader.uid) - (oppTurn ? 0 : ps.leader.don * 1000);
  const attackers: { power: number; hits: number; blockable: boolean }[] = [];
  for (const c of [os.leader, ...os.characters]) {
    if (oppTurn && (c.rested || (c !== os.leader && c.playedOnTurn === state.turn && !hasKeyword(state, c.uid, 'rush')))) continue;
    attackers.push({
      power: getPower(state, c.uid),
      hits: hasKeyword(state, c.uid, 'doubleAttack') ? 2 : 1,
      blockable: !hasKeyword(state, c.uid, 'unblockable'),
    });
  }
  const onField = (p: PlayerState) => p.donActive + p.donRested + p.leader.don + p.characters.reduce((n, c) => n + c.don, 0) + (p.stage?.don ?? 0);
  let don = oppTurn ? os.donActive : onField(os) + Math.min(2, os.donDeck);

  // DON!! do oponente: primeiro o que falta para cada atacante alcançar o Líder (os mais baratos
  // antes), depois um a um no ataque mais fácil de cobrir (encarece o Counter).
  const live: typeof attackers = [];
  for (const a of attackers.sort((x, y) => y.power - x.power)) {
    const k = Math.max(0, Math.ceil((leaderPower - a.power) / 1000));
    if (k > don) continue;
    don -= k;
    a.power += k * 1000;
    live.push(a);
  }
  if (!live.length) return 0;
  for (; don > 0; don--) live.reduce((m, a) => (a.power < m.power ? a : m)).power += 1000;

  // Defesa: Blockers nos ataques mais caros; Counters nos mais baratos.
  let blockers = ps.characters.filter(
    (c) => !c.rested && hasKeyword(state, c.uid, 'blocker') && !state.modifiers.some((m) => m.uid === c.uid && m.kind === 'cannotBlock'),
  ).length;
  const open = live.sort((a, b) => b.power - a.power || b.hits - a.hits).filter((a) => {
    if (blockers > 0 && a.blockable) {
      blockers--;
      return false;
    }
    return true;
  });
  open.sort((a, b) => a.power - b.power);

  let hits = open.reduce((n, a) => n + a.hits, 0);
  const pool = handCounters(state, ps);
  const donLeft = { left: ps.donActive };
  for (const a of open) {
    if (!spendCounters(pool, a.power - leaderPower + 1000, donLeft)) break;
    hits -= a.hits;
  }
  return hits;
}

/**
 * Quanto custa ao `player` o próximo ataque do oponente: `threatHit` por ataque que passa pela
 * defesa completa (`incomingHits`) e, se nem ela salva o Líder, `lethal`.
 */
export function incomingThreat(state: GameState, player: PlayerId, w: Weights = DEFAULT_WEIGHTS): number {
  if (!w.threat) return 0;
  const hits = incomingHits(state, player);
  return w.threat * (hits * w.threatHit + (hits > state.players[player].life.length ? w.lethal : 0));
}

/**
 * Avaliação da posição para `player`. Pode ser chamada em qualquer momento (meio do turno, meio
 * de uma batalha); compare só avaliações feitas no mesmo ponto da resolução.
 */
export function evaluate(state: GameState, player: PlayerId, w: Weights = DEFAULT_WEIGHTS): number {
  if (state.phase === 'gameover') {
    if (state.winner === null) return 0;
    return state.winner === player ? w.win : -w.win;
  }
  const me = state.players[player];
  const opp = state.players[opponent(player)];
  const oppTurn = state.activePlayer !== player;
  return sideValue(state, w, me, w.handCard, oppTurn, false) - sideValue(state, w, opp, w.handCardOpp, !oppTurn, true) - incomingThreat(state, player, w);
}
