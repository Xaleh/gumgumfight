// Bot com busca: simula as próprias jogadas com `applyAction` e escolhe pela função de avaliação
// (`evaluate.ts`). Decide pela visão do jogador (`viewFor`), como no servidor: as cartas que ele não
// vê chegam como `?` e são simuladas como cartas sem efeito.
//
// - Fase principal: busca em feixe sobre as ações do turno (jogar, ativar, anexar DON!!, atacar) até o
//   fim do turno; cada linha é pontuada pela avaliação depois do `endTurn`, ajustada pela chance de Counter
//   nos ataques (a mão do oponente é escondida: a chance é estimada pelo tamanho dela e pela margem).
// - Escolhas pendentes (bloquear, Counter, carta da Vida, "pagar X?", opções, alvos): cada resposta
//   possível é simulada até a próxima decisão e comparada pela avaliação.
// - O oponente, dentro da simulação, bloqueia do jeito que mais prejudica o bot, nunca usa Counter
//   (não dá para simular uma mão escondida) e responde às outras perguntas de forma neutra.
// - A linha escolhida fica guardada: enquanto a partida seguir o previsto (o oponente não usou
//   Counter, nenhum efeito surpreendeu), as próximas decisões saem do plano sem nova busca.
//
// Quem chama decide o nível: `easy` é o bot heurístico (`simple.ts`), `normal` olha uma jogada à
// frente, `hard` planeja o turno inteiro.

import { legalActions } from '../actions';
import { applyAction, cardDef, getPower, locate, opponent } from '../engine';
import type { Action, GameState, Pending, PlayerId } from '../types';
import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate';
import { chooseBotAction as simpleBot } from './simple';

export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

export interface PlannerOptions {
  /** Linhas mantidas a cada passo da busca em feixe. */
  beamWidth: number;
  /** Ações por turno consideradas (profundidade da busca). */
  maxDepth: number;
  /** Teto de tempo da busca por decisão (ms). Estourado, vale a melhor linha completa até ali. */
  timeBudgetMs: number;
  /** Respostas possíveis por escolha pendente simuladas (as demais ficam de fora). */
  maxChoices: number;
  weights: Weights;
  /** Desempate aleatório (0 a 1): sem ele o bot repete sempre a mesma jogada. */
  random: () => number;
  /** Relógio (para os testes). */
  now: () => number;
  /** Depuração: recebe cada candidata avaliada numa escolha pendente e a linha escolhida na fase principal. */
  onDecision?: (info: string, depth: number) => void;
}

export const LEVELS: Record<Exclude<BotLevel, 'easy'>, Pick<PlannerOptions, 'beamWidth' | 'maxDepth' | 'timeBudgetMs' | 'maxChoices'>> = {
  normal: { beamWidth: 1, maxDepth: 1, timeBudgetMs: 80, maxChoices: 6 },
  hard: { beamWidth: 6, maxDepth: 16, timeBudgetMs: 250, maxChoices: 10 },
};

export function plannerOptions(level: Exclude<BotLevel, 'easy'>, over: Partial<PlannerOptions> = {}): PlannerOptions {
  return { ...LEVELS[level], weights: DEFAULT_WEIGHTS, random: Math.random, now: Date.now, ...over };
}

/** Custo fixo por ação numa linha: entre linhas iguais, a mais curta ganha (evita ativações inúteis). */
const ACTION_COST = 30;
/** Amplitude do desempate aleatório (abaixo do custo por ação e de qualquer termo da avaliação). */
const NOISE = 20;
/** Teto de passos de resolução automática numa simulação (efeitos em cadeia). */
const MAX_STEPS = 60;
/** Filhos por jogada (variantes de DON!! do mesmo ataque) que entram no feixe a cada passo. */
const SIBLINGS = 2;

/** Uma decisão do bot dentro de uma linha simulada: a chave do estado em que ela vale e a ação. */
interface Step {
  key: string;
  action: Action;
}

interface Sim {
  state: GameState;
  /** Ajustes que a simulação não representa (chance de Counter do oponente). */
  penalty: number;
  /** As decisões do bot ao longo da simulação (a ação pedida e as respostas às perguntas dela). */
  trace: Step[];
  /** Os acertos no Líder do oponente nesta linha: o Counter que cada um exigiria dele (ver `counterAdjust`). */
  hits: number[];
}

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------

/** Ação do bot no nível pedido (padrão `hard`). */
export function chooseBotAction(state: GameState, player: PlayerId, level: BotLevel = 'hard', over?: Partial<PlannerOptions>): Action {
  if (level === 'easy') return simpleBot(state, player);
  return planAction(state, player, plannerOptions(level, over));
}

export function planAction(full: GameState, player: PlayerId, opts: PlannerOptions): Action {
  // O histórico e o checkpoint do "cancelar" não mudam nenhuma decisão, mas o motor copia o estado
  // inteiro a cada jogada simulada: sem eles, a busca simula o dobro de jogadas no mesmo tempo.
  const state: GameState = { ...full, log: [], checkpoint: undefined };
  const actions = legalActions(state, player);
  if (!actions.length) throw new Error('O bot não tem ações legais.');
  const planned = fromPlan(state, player);
  if (planned) return planned;
  const pending = state.pending;
  if (pending) {
    // Mulligan e escolha de quem começa não têm o que simular. Quem começa: o segundo (compra na primeira vez e
    // tem 2 DON!! no primeiro turno); nos replays, os melhores colocados dos torneios escolhem jogar primeiro em
    // só 15% das vezes (docs/bot-tempo.md, seção 11).
    if (pending.kind === 'chooseFirst') return { type: 'answer', player, yes: false };
    if (pending.kind === 'mulligan' || pending.kind === 'manual') return simpleBot(state, player);
    return decidePending(state, player, actions, defenseOrPlan(state, player, opts), 2)?.action ?? simpleBot(state, player);
  }
  return planTurn(state, player, defenseOrPlan(state, player, opts));
}

/**
 * A ameaça do próximo ataque do oponente (`incomingThreat`) só pesa nas decisões do turno dele
 * (Counter, bloqueio, gatilhos). No próprio turno ela deixava o bot passivo — guardando Blockers e
 * cartas na mão em vez de pressionar — e ele perdia mais do que ganhava (medido em auto-jogo; a
 * otimização dos pesos também a levou a quase zero).
 */
function defenseOrPlan(state: GameState, player: PlayerId, opts: PlannerOptions): PlannerOptions {
  if (state.activePlayer !== player) return opts;
  // No próprio turno só o ataque fatal na mesa pesa (`lethalPlan`): deixar o Líder ao alcance de um
  // ataque que a melhor defesa não segura é o erro que qualquer humano castiga.
  return { ...opts, weights: { ...opts.weights, threat: opts.weights.lethalPlan ? 1 : 0, threatHit: 0, lethal: opts.weights.lethalPlan } };
}

// ---------------------------------------------------------------------------
// Resolução automática: responde pelo oponente e pelas escolhas aninhadas do bot
// ---------------------------------------------------------------------------

/**
 * Modelo do oponente dentro da simulação. Bloqueio: a opção que mais prejudica o bot (minimax de
 * um nível). Counter: nunca (a mão dele é escondida; o risco entra em `counterRisk`). O resto: neutro.
 */
function opponentAnswer(state: GameState, me: PlayerId, pending: Pending, opts: PlannerOptions, depth: number): Action {
  const p = pending.player;
  switch (pending.kind) {
    case 'block': {
      if (!pending.options.length) return { type: 'choose', player: p, uids: [] };
      const choices: Action[] = [{ type: 'choose', player: p, uids: [] }, ...pending.options.map((u): Action => ({ type: 'choose', player: p, uids: [u] }))];
      let best: Action = choices[0];
      let worst = Infinity;
      for (const c of choices) {
        const r = simulate(state, me, c, opts, depth);
        const v = r ? evaluate(r.state, me, opts.weights) : Infinity;
        if (v < worst) {
          worst = v;
          best = c;
        }
      }
      return best;
    }
    case 'counter':
      return { type: 'pass', player: p };
    case 'lifeCard':
      return { type: 'answer', player: p, yes: false };
    case 'confirm':
      return { type: 'answer', player: p, yes: !pending.cannot };
    case 'option':
      return { type: 'option', player: p, index: 0 };
    case 'selectTargets':
      return { type: 'choose', player: p, uids: pending.options.slice(0, Math.min(pending.min, pending.max)) };
    case 'manual':
      return { type: 'manualDone', player: p };
    case 'mulligan':
      return { type: 'mulligan', player: p, redraw: false };
    case 'chooseFirst':
      return { type: 'answer', player: p, yes: true };
  }
}

/**
 * Aplica `action` e segue a resolução até a próxima decisão de verdade: a fase principal do bot
 * (sem nada pendente), uma pergunta ao bot que `depth` não cobre mais, ou a vez do oponente. As
 * escolhas aninhadas do bot são decididas pela avaliação enquanto houver `depth`; depois, pelo bot
 * heurístico. Devolve null quando o motor recusa a jogada (a visão não permite simular tudo).
 */
function simulate(state: GameState, me: PlayerId, action: Action, opts: PlannerOptions, depth: number, prior: number[] = []): Sim | null {
  const trace: Step[] = [];
  if (action.player === me) trace.push({ key: stateKey(state, me), action });
  let s: GameState;
  try {
    s = applyAction(state, action);
  } catch {
    return null;
  }
  for (let i = 0; i < MAX_STEPS && s.phase !== 'gameover'; i++) {
    const pending = s.pending;
    if (!pending) break;
    let next: Action;
    if (pending.player !== me) {
      next = opponentAnswer(s, me, pending, opts, depth);
    } else {
      if (pending.kind === 'mulligan' || pending.kind === 'chooseFirst') break;
      const legal = legalActions(s, me);
      const chosen = depth > 0 ? decidePending(s, me, legal, opts, depth - 1) : null;
      if (chosen) {
        trace.push(...chosen.trace);
        s = chosen.state;
        continue;
      }
      next = simpleBot(s, me);
      trace.push({ key: stateKey(s, me), action: next });
    }
    try {
      s = applyAction(s, next);
    } catch {
      return null;
    }
  }
  let penalty = 0;
  let hits = prior;
  if (action.type === 'attack' && action.player === me) {
    penalty += counterAdjust(state, s, me, action, opts.weights, prior);
    const opp = state.players[opponent(me)];
    if (action.target === opp.leader.uid && (s.phase === 'gameover' || s.players[opp.id].life.length < opp.life.length)) {
      hits = [...prior, getPower(state, action.attacker) - getPower(state, action.target) + 1000];
    }
  }
  return { state: s, penalty, trace, hits };
}

// ---------------------------------------------------------------------------
// Risco de Counter (a mão do oponente é escondida)
// ---------------------------------------------------------------------------

/**
 * Probabilidade de o oponente conseguir somar `need` de Counter com `hand` cartas escondidas: cada
 * carta tem Counter com chance `counterCard` (+2000 com `counterBig`), e as cartas somam.
 */
export function counterAbility(hand: number, need: number, w: Weights = DEFAULT_WEIGHTS): number {
  if (need <= 0) return 1;
  if (hand <= 0) return 0;
  const steps = Math.ceil(need / 1000);
  const p2 = Math.min(1, Math.max(0, w.counterBig));
  const p1 = Math.min(1 - p2, Math.max(0, w.counterCard - p2));
  const p0 = 1 - p1 - p2;
  // dist[s] = chance de as cartas vistas somarem s mil (s = steps vale "steps ou mais").
  let dist = new Float64Array(steps + 1);
  dist[0] = 1;
  for (let c = 0; c < hand; c++) {
    const next = new Float64Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      if (!dist[i]) continue;
      next[i] += dist[i] * p0;
      next[Math.min(steps, i + 1)] += dist[i] * p1;
      next[Math.min(steps, i + 2)] += dist[i] * p2;
    }
    dist = next;
  }
  return dist[steps];
}

/**
 * Vontade do oponente de gastar Counter para salvar o alvo. Um ataque fatal ao Líder ele defende
 * sempre que pode; nos outros, cresce com o que está em jogo (Vida baixa, Personagem caro) e cai a cada
 * 1000 a mais que ele teria de cobrir (`counterStack`: gastar duas cartas por uma Vida é raro).
 */
function counterWill(state: GameState, target: string, opp: PlayerId, need: number, w: Weights): number {
  const ps = state.players[opp];
  const life = ps.life.length;
  if (target === ps.leader.uid && !life) return 1;
  const cost = cardDef(state, target).cost ?? 0;
  // Líder: calibrado nos replays (seção 11 de docs/bot-tempo.md): quando a mão bastava, as pessoas defenderam
  // 78% com 1 de Vida, 68% com 2, 48% com 3 e 33 a 36% com 4 ou mais (um pouco acima aqui, porque esses números
  // incluem os ataques que exigiam mais de uma carta, descontados abaixo por `counterStack`).
  const base = target === ps.leader.uid ? [1, 0.85, 0.75, 0.55, 0.38][Math.min(4, life)] : cost >= 5 ? 0.7 : cost >= 3 ? 0.45 : 0.2;
  // Com o Líder quase sem Vida ele gasta duas cartas sem pensar; com Vida alta, raramente.
  const stack = target === ps.leader.uid ? Math.max(0, (life - 1) / 4) : 1;
  return Math.min(1, base * w.counterWill) * w.counterStack ** (Math.max(0, Math.ceil(need / 1000) - 1) * stack);
}

/**
 * Ajuste pela chance de o oponente usar Counter no ataque: a diferença entre o ataque falhando (ele
 * gasta as cartas que a margem exige) e o resultado simulado (sem Counter), vezes a chance disso.
 * Negativo quando o acerto valia mais que as cartas dele; positivo quando forçar o Counter é o lucro
 * (Vida alta do oponente, margem que exige duas cartas).
 */
function counterAdjust(before: GameState, after: GameState, me: PlayerId, action: Extract<Action, { type: 'attack' }>, w: Weights, prior: number[] = []): number {
  const opp = opponent(me);
  const hand = before.players[opp].hand.length;
  if (!hand && !prior.length) return 0;
  const target = locate(before, action.target);
  if (!target) return 0;
  const ap = getPower(before, action.attacker);
  const tp = getPower(before, action.target);
  if (ap < tp) return 0;
  const need = ap - tp + 1000;
  const lethal = after.phase === 'gameover' && after.winner === me && action.target === before.players[opp].leader.uid;
  let p: number;
  if (lethal) {
    // Para sobreviver ele só precisa parar um dos acertos da linha: o mais barato, com a mão que tinha
    // na hora (cada acerto anterior lhe deu uma carta da Vida). Um ataque fatal ele defende sempre que pode.
    p = 0;
    [...prior, need].forEach((n, i, all) => (p = Math.max(p, counterAbility(hand - (all.length - 1 - i), n, w))));
  } else {
    p = counterAbility(hand, need, w) * counterWill(before, action.target, opp, need, w);
  }
  if (p <= 0) return 0;
  // Ataque falhou: a posição de antes (o atacante virado não muda a avaliação no próprio turno) e as
  // cartas gastas no Counter fora da mão do oponente (uma a cada 2000 que ele precisou cobrir).
  const cards = Math.min(hand, Math.max(1, Math.ceil(need / 2000)));
  if (lethal) {
    // Acerto que vence a partida: vale `winCap` (e não `win`) vezes a chance de passar, para a posição
    // que sobra se ele for parado continuar pesando na escolha. Essa posição é avaliada no fim do turno
    // (como as linhas que não vencem), e não no meio dele: o DON!! pronto e os Personagens ainda em pé
    // valeriam a mais só para a linha fatal.
    let ended = before;
    try {
      ended = applyAction(before, { type: 'endTurn', player: me });
    } catch {
      /* fica a posição do meio do turno */
    }
    const miss = evaluate(ended, me, w) + w.handCardOpp * cards;
    return p * miss + (1 - p) * w.winCap - w.win;
  }
  const miss = evaluate(before, me, w) + w.handCardOpp * cards;
  const hit = evaluate(after, me, w);
  return (miss - hit) * p;
}

// ---------------------------------------------------------------------------
// Escolhas pendentes
// ---------------------------------------------------------------------------

/** Valor estático de uma carta (para ordenar candidatos): custo e poder. */
function staticValue(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  return (def.cost ?? 0) * 1000 + (def.power ?? 0) / 4;
}

/** Respostas candidatas a uma escolha pendente (as legais, com combinações extras para "escolha N"). */
function pendingCandidates(state: GameState, player: PlayerId, legal: Action[], opts: PlannerOptions): Action[] {
  const pending = state.pending!;
  const out = legal.filter((a) => a.type !== 'cancel' && a.type !== 'manual');
  if (pending.kind === 'selectTargets') {
    const byValue = [...pending.options].sort((a, b) => staticValue(state, b) - staticValue(state, a));
    if (pending.min > 1) {
      // `legalActions` dá só uma combinação de exemplo: completa com as de maior e as de menor valor.
      const n = Math.min(pending.max, byValue.length);
      out.push({ type: 'choose', player, uids: byValue.slice(0, n) }, { type: 'choose', player, uids: byValue.slice(-n) });
    } else if (pending.max > 1 && byValue.length > 1) {
      // "Até N": também a escolha cheia.
      out.push({ type: 'choose', player, uids: byValue.slice(0, Math.min(pending.max, byValue.length)) });
    }
    // Escolhas de uma carta só: as de maior valor primeiro (o corte abaixo fica com as melhores).
    out.sort((a, b) => {
      const va = a.type === 'choose' && a.uids.length === 1 ? staticValue(state, a.uids[0]) : -1;
      const vb = b.type === 'choose' && b.uids.length === 1 ? staticValue(state, b.uids[0]) : -1;
      return vb - va;
    });
  }
  if (pending.kind === 'counter' && state.battle) {
    // O valor de Counter de um Personagem pode ir para outro alvo (o Líder, ou quem está em batalha).
    const b = state.battle;
    const me = state.players[player];
    for (const a of legal) {
      if (a.type !== 'counter' || cardDef(state, a.uid).category === 'event') continue;
      for (const t of [me.leader.uid, ...me.characters.map((c) => c.uid)]) if (t !== b.target) out.push({ ...a, target: t });
    }
  }
  if (out.length <= opts.maxChoices) return out;
  // Limita o número de simulações: a resposta do bot heurístico sempre entra.
  const fallback = JSON.stringify(simpleBot(state, player));
  const kept = out.slice(0, opts.maxChoices);
  if (!kept.some((a) => JSON.stringify(a) === fallback)) {
    const fb = out.find((a) => JSON.stringify(a) === fallback);
    if (fb) kept[kept.length - 1] = fb;
  }
  return kept;
}

/** Escolhe a resposta a uma pergunta pendente simulando cada candidata. null = nenhuma simulável. */
function decidePending(state: GameState, player: PlayerId, legal: Action[], opts: PlannerOptions, depth: number): (Sim & { action: Action }) | null {
  let best: (Sim & { action: Action }) | null = null;
  let bestScore = -Infinity;
  for (const c of pendingCandidates(state, player, legal, opts)) {
    const r = simulate(state, player, c, opts, depth);
    if (!r) continue;
    const score = evaluate(r.state, player, opts.weights) + r.penalty + opts.random() * NOISE;
    opts.onDecision?.(`candidata ${JSON.stringify(c)}: ${score.toFixed(0)} (risco ${r.penalty.toFixed(0)})`, depth);
    if (score > bestScore) {
      bestScore = score;
      best = { ...r, action: c };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fase principal: busca em feixe
// ---------------------------------------------------------------------------

interface Node {
  state: GameState;
  trace: Step[];
  depth: number;
  penalty: number;
  /** Os acertos no Líder do oponente nesta linha (ver `Sim.hits`). */
  hits: number[];
  score: number;
}

/** Resumo do que importa para uma decisão: se bater, o plano guardado continua valendo. */
function stateKey(state: GameState, player: PlayerId): string {
  const me = state.players[player];
  const opp = state.players[opponent(player)];
  const field = (ps: typeof me) => [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])].map((c) => `${c.uid}${c.rested ? 'r' : ''}${c.don}`).join(',');
  const p = state.pending;
  const pendingKey = p ? `${p.kind}:${p.player}:${'options' in p ? p.options.join(',') : ''}${'card' in p ? p.card : ''}` : '';
  return [
    state.turn,
    state.actionCount,
    state.activePlayer,
    pendingKey,
    field(me),
    [...me.hand].sort().join(','),
    me.donActive,
    me.donRested,
    me.life.length,
    [...state.usedThisTurn].sort().join(','),
    field(opp),
    opp.hand.length,
    opp.life.length,
    state.modifiers.length,
    state.stack.length,
  ].join('|');
}

/** Chave sem o contador de ações: linhas da busca que chegam ao mesmo lugar são uma só. */
function dedupeKey(state: GameState, player: PlayerId): string {
  const k = stateKey(state, player);
  return k.slice(k.indexOf('|', k.indexOf('|') + 1) + 1);
}

/**
 * Jogadas da fase principal que valem a pena simular. Anexar DON!! não muda a avaliação na hora, então
 * a busca o descartaria antes de ver o ataque: por isso "anexar k DON!! e atacar" entra como uma jogada
 * composta, com k suficiente para empatar o poder do alvo, superá-lo e sobrar margem para Counter.
 */
function candidateMoves(state: GameState, player: PlayerId): Action[][] {
  const legal = legalActions(state, player);
  const me = state.players[player];
  const out: Action[][] = [];
  const attacks = legal.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
  for (const a of legal) {
    switch (a.type) {
      case 'detachDon':
      case 'cancel':
      case 'endTurn':
        break;
      case 'attachDon':
        // Sozinho, só no Líder (habilidades [DON!! xN]); nos Personagens, junto do ataque.
        if (a.target === me.leader.uid && attacks.some((x) => x.attacker === a.target)) out.push([a]);
        break;
      default:
        out.push([a]);
    }
  }
  for (const atk of attacks) {
    const ap = getPower(state, atk.attacker);
    const tp = getPower(state, atk.target);
    const need = Math.max(0, Math.ceil((tp - ap) / 1000));
    const ks = new Set<number>();
    for (const k of [need, need + 1, need + 2]) if (k > 0 && k <= me.donActive) ks.add(k);
    if (me.donActive > need + 2 && me.donActive <= 4) ks.add(me.donActive);
    for (const k of ks) {
      const give: Action = { type: 'attachDon', player, target: atk.attacker };
      out.push([...Array.from({ length: k }, () => give), atk]);
    }
  }
  return out;
}

/**
 * Linhas "tudo no Líder": cada atacante recebe o DON!! que precisa para alcançar o Líder do oponente
 * (os mais baratos primeiro), e o que sobra vai por cima (espalhado, ou nada: guardado para jogar
 * cartas). A busca em feixe não acha essas linhas sozinha: cada acerto no Líder vale menos que um K.O.
 * ou uma carta jogada, então os nós que levam ao ataque fatal são cortados antes do fim.
 */
function allOutLines(state: GameState, player: PlayerId): Action[][] {
  const me = state.players[player];
  const leader = state.players[opponent(player)].leader.uid;
  const attacks = legalActions(state, player).filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.target === leader);
  if (attacks.length < 2) return [];
  const lp = getPower(state, leader);
  const plan = attacks
    .map((atk) => ({ atk, power: getPower(state, atk.attacker), need: Math.max(0, Math.ceil((lp - getPower(state, atk.attacker)) / 1000)) }))
    .sort((a, b) => a.need - b.need);
  let don = me.donActive;
  const chosen: typeof plan = [];
  for (const p of plan) {
    if (p.need > don) continue;
    don -= p.need;
    chosen.push(p);
  }
  if (chosen.length < 2) return [];
  const out: Action[][] = [];
  const give = (target: string): Action => ({ type: 'attachDon', player, target });
  for (const order of [1, -1]) {
    const ordered = [...chosen].sort((a, b) => order * (b.power - a.power));
    for (const spread of [false, true]) {
      const extra = ordered.map(() => 0);
      if (spread) for (let i = 0, d = don; d > 0; d--, i = (i + 1) % extra.length) extra[i]++;
      const moves: Action[] = [];
      ordered.forEach((p, i) => moves.push(...Array.from({ length: p.need + extra[i] }, () => give(p.atk.attacker)), p.atk));
      out.push(moves);
    }
  }
  return out;
}

/** A jogada que uma sequência representa (o ataque, a carta, a habilidade), sem contar o DON!! anexado. */
function moveKey(moves: Action[]): string {
  const a = moves[moves.length - 1];
  switch (a.type) {
    case 'attack':
      return `atk:${a.attacker}>${a.target}`;
    case 'playCard':
      return `play:${a.uid}`;
    case 'activate':
      return `act:${a.uid}:${a.ability}`;
    case 'attachDon':
      return `don:${a.target}`;
    default:
      return a.type;
  }
}

/**
 * Aplica uma sequência de jogadas do bot; para (null) se algo interromper antes da última. Com
 * `partial`, uma interrupção (partida decidida, pergunta ao bot, vez do oponente) devolve a linha até ali.
 */
function simulateSeq(state: GameState, me: PlayerId, moves: Action[], opts: PlannerOptions, depth: number, partial = false, prior: number[] = []): Sim | null {
  let s = state;
  const trace: Step[] = [];
  let penalty = 0;
  let hits = prior;
  for (let i = 0; i < moves.length; i++) {
    const r = simulate(s, me, moves[i], opts, depth, hits);
    if (!r) return i > 0 && partial ? { state: s, penalty, trace, hits } : null;
    trace.push(...r.trace);
    penalty += r.penalty;
    hits = r.hits;
    s = r.state;
    if (i < moves.length - 1 && (s.pending || s.phase === 'gameover' || s.activePlayer !== me)) {
      if (partial) break;
      return null;
    }
  }
  return { state: s, penalty, trace, hits };
}

/**
 * Planos em andamento, por partida (o servidor joga várias ao mesmo tempo): as decisões que faltam,
 * cada uma com a chave do estado em que vale. A partida é identificada pelos uids dos dois Líderes
 * (apelidos aleatórios no online; "c1"/"c52" numa partida local).
 */
const plans = new Map<string, Step[]>();
const MAX_PLANS = 64;

function gameKey(state: GameState, player: PlayerId): string {
  return `${player}:${state.players[0].leader.uid}:${state.players[1].leader.uid}`;
}

function savePlan(state: GameState, player: PlayerId, steps: Step[]) {
  const key = gameKey(state, player);
  plans.delete(key);
  if (!steps.length) return;
  if (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value!);
  plans.set(key, steps);
}

/** A próxima ação do plano guardado, se a partida chegou exatamente onde a simulação previu. */
function fromPlan(state: GameState, player: PlayerId): Action | null {
  const key = gameKey(state, player);
  const steps = plans.get(key);
  if (!steps?.length) return null;
  const step = steps[0];
  if (step.key !== stateKey(state, player)) {
    plans.delete(key);
    return null;
  }
  try {
    applyAction(state, step.action);
  } catch {
    plans.delete(key);
    return null;
  }
  savePlan(state, player, steps.slice(1));
  return step.action;
}

/** Esquece os planos em andamento (ao começar outra partida ou nos testes). */
export function resetPlanner(): void {
  plans.clear();
}

function planTurn(state: GameState, player: PlayerId, opts: PlannerOptions): Action {
  const start = opts.now();
  const over = () => opts.now() - start > opts.timeBudgetMs;
  const noise = () => opts.random() * NOISE;
  const score = (s: GameState, penalty: number, depth: number) => evaluate(s, player, opts.weights) + penalty - depth * ACTION_COST + noise();

  let beam: Node[] = [{ state, trace: [], depth: 0, penalty: 0, hits: [], score: evaluate(state, player, opts.weights) }];
  let best: { score: number; trace: Step[]; complete: boolean } | null = null;
  const offer = (candidate: { score: number; trace: Step[]; complete: boolean }) => {
    opts.onDecision?.(`oferta (${candidate.score.toFixed(0)}): ${candidate.trace.map((st) => JSON.stringify(st.action)).join(' → ')}`, 1);
    if (!best || candidate.score > best.score) best = candidate;
  };

  /** Encerra o turno a partir de `node` e pontua a linha. `complete`: o nó foi expandido por inteiro. */
  const finish = (node: Node, complete: boolean) => {
    const end: Action = { type: 'endTurn', player };
    const r = simulate(node.state, player, end, opts, 1);
    const value = r ? evaluate(r.state, player, opts.weights) + r.penalty : evaluate(node.state, player, opts.weights);
    offer({
      score: value + node.penalty - node.depth * ACTION_COST + noise(),
      trace: [...node.trace, ...(r?.trace ?? [{ key: stateKey(node.state, player), action: end }])],
      complete,
    });
  };

  for (let depth = 0; depth <= opts.maxDepth; depth++) {
    const next = new Map<string, Node>();
    for (const node of beam) {
      // A raiz é sempre expandida por inteiro: no mínimo o bot olha uma jogada à frente.
      const expand = depth < opts.maxDepth && (depth === 0 || !over());
      finish(node, expand);
      if (!expand) continue;
      // As linhas "tudo no Líder" só antes do primeiro ataque da linha.
      const attacked = node.trace.some((st) => st.action.type === 'attack');
      const moves = [...candidateMoves(node.state, player).map((m) => ({ m, allOut: false })), ...(attacked ? [] : allOutLines(node.state, player).map((m) => ({ m, allOut: true })))];
      // Variantes da mesma jogada (DON!! a mais no mesmo ataque) não podem encher o feixe sozinhas:
      // no máximo `SIBLINGS` filhos por jogada, para o feixe manter alternativas de verdade.
      const groups = new Map<string, Node[]>();
      for (const { m: move, allOut } of moves) {
        const r = simulateSeq(node.state, player, move, opts, 1, allOut, node.hits);
        if (!r) continue;
        const trace = [...node.trace, ...r.trace];
        const penalty = node.penalty + r.penalty;
        const d = node.depth + (allOut ? r.trace.filter((st) => st.action.type === 'attack' || st.action.type === 'attachDon').length : move.length);
        // Partida decidida, ou a simulação parou numa pergunta que a profundidade não cobriu: a linha
        // termina aqui (o que vier depois é replanejado na hora).
        if (r.state.phase === 'gameover' || r.state.pending || r.state.activePlayer !== player) {
          offer({ score: score(r.state, penalty, d), trace, complete: true });
          continue;
        }
        const child: Node = { state: r.state, trace, depth: d, penalty, hits: r.hits, score: score(r.state, penalty, d) };
        const g = allOut ? 'allOut' : moveKey(move);
        const list = groups.get(g) ?? [];
        list.push(child);
        groups.set(g, list);
      }
      for (const list of groups.values()) {
        for (const child of list.sort((a, b) => b.score - a.score).slice(0, SIBLINGS)) {
          const k = dedupeKey(child.state, player);
          const seen = next.get(k);
          if (!seen || seen.score < child.score) next.set(k, child);
        }
      }
    }
    if (!next.size) break;
    const sorted = [...next.values()].sort((a, b) => b.score - a.score);
    beam = sorted.slice(0, opts.beamWidth);
    // Um acerto no Líder pontua na hora; uma carta jogada só pelo que põe em campo. Sem reserva, o feixe
    // enche de ataques e nunca vê a linha que baixa duas cartas antes de atacar: a melhor linha de cada
    // número de cartas jogadas (ou habilidades ativadas) fica no feixe mesmo fora das primeiras.
    const plays = (n: Node) => n.trace.filter((st) => st.action.type === 'playCard' || st.action.type === 'activate').length;
    const represented = new Set(beam.map(plays));
    for (const n of sorted.slice(opts.beamWidth)) {
      const k = plays(n);
      if (represented.has(k)) continue;
      represented.add(k);
      beam.push(n);
    }
  }

  const chosen = best!;
  const steps = chosen.trace;
  opts.onDecision?.(`linha escolhida (${chosen.score.toFixed(0)}): ${steps.map((st) => JSON.stringify(st.action)).join(' → ')}`, 0);
  // Linha cortada pela profundidade ou pelo tempo: o `endTurn` do fim não foi comparado com
  // continuar jogando, então fica de fora do plano (a próxima decisão replaneja).
  const rest = chosen.complete ? steps.slice(1) : steps.slice(1).filter((st) => st.action.type !== 'endTurn');
  savePlan(state, player, rest);
  return steps[0].action;
}
