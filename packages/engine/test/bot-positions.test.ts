// Testes de posição do bot com busca (docs/bot-tempo.md): tabuleiro montado → jogada esperada.
// O bot decide pela visão (como no servidor); o oponente não bloqueia nem usa Counter.

import { describe, expect, it } from 'vitest';
import { actingPlayer, legalActions } from '../src/actions';
import { DEFAULT_WEIGHTS, evaluate, incomingThreat } from '../src/bot/evaluate';
import { planAction, plannerOptions, resetPlanner } from '../src/bot/planner';
import { chooseBotAction as simpleBot } from '../src/bot/simple';
import { applyAction, cardDef, createGame } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';
import { buildCardDef } from '../src/cards';
import { actionFromView, identityAliases, viewFor } from '../src/view';
import type { CardData } from '../src/types';
import { cards as baseCards, fetchToHand, kid, luffy, started, toTurn } from './helpers';

// Cartas de fora dos decks prontos, com o texto oficial (optcgapi): os casos relatados em partidas contra o bot.
const extraCards: CardData[] = [
  {
    id: 'OP06-033',
    name: 'Vander Decken IX',
    category: 'character',
    colors: ['green'],
    cost: 2,
    power: 2000,
    counter: 1000,
    types: ['Fish-Man', 'Flying Pirates'],
    text: '[On Play] You may trash 1 "Fish-Man" type card from your hand or 1 [The Ark Noah] from your hand or field: K.O. up to 1 of your opponent\'s rested Characters.',
  },
  {
    id: 'OP17-039',
    name: 'Rocks.D.Xebec',
    category: 'leader',
    colors: ['blue'],
    life: 5,
    power: 5000,
    types: ['Rocks Pirates'],
    text: '[When Attacking] You may trash 1 card from your hand: Reveal 1 card from the top of your deck. If the revealed card\'s type includes "Rocks Pirates", draw 2 cards.',
  },
  { id: 'OP17-040', name: 'Edward.Newgate', category: 'character', colors: ['blue'], cost: 6, power: 8000, counter: 0, types: ['Rocks Pirates'], text: '[On Play] Draw 1 card.' },
  {
    id: 'OP08-051',
    name: 'Buckin',
    category: 'character',
    colors: ['blue'],
    cost: 1,
    power: 2000,
    counter: 1000,
    types: ['Former Rocks Pirates'],
    text: '[Your Turn] [On Play] Up to 1 of your [Edward Weevil] cards gains +2000 power during this turn.',
  },
];
const cards = [...baseCards, ...extraCards];

/** Busca determinística e sem teto de tempo (os testes não podem depender da máquina). */
const OPTS = plannerOptions('hard', { random: () => 0.5, timeBudgetMs: 60_000 });

/** Jogada do bot pela visão dele, traduzida de volta para o estado completo. */
function botAction(s: GameState, p: PlayerId): Action {
  const aliases = identityAliases(s);
  const a = actionFromView(s, aliases, planAction(viewFor(s, p, aliases), p, OPTS));
  if (typeof a === 'string') throw new Error(a);
  return a;
}

/** O oponente (scriptado) não bloqueia, não usa Counter e põe a Vida na mão; outras perguntas, pelo bot heurístico. */
function opponentAnswer(s: GameState, p: PlayerId): Action {
  const pending = s.pending!;
  if (pending.kind === 'block') return { type: 'choose', player: p, uids: [] };
  if (pending.kind === 'counter') return { type: 'pass', player: p };
  if (pending.kind === 'lifeCard') return { type: 'answer', player: p, yes: false };
  return simpleBot(s, p);
}

/** Joga o turno inteiro do bot `p` (até o `endTurn` ou o fim da partida) e devolve o estado e as ações dele. */
function botTurn(s: GameState, p: PlayerId): { state: GameState; actions: Action[] } {
  resetPlanner();
  const actions: Action[] = [];
  for (let i = 0; i < 200 && s.phase !== 'gameover'; i++) {
    const acting = actingPlayer(s)!;
    if (acting !== p) {
      s = applyAction(s, opponentAnswer(s, acting));
      continue;
    }
    if (!s.pending && s.activePlayer !== p) break;
    const a = botAction(s, p);
    actions.push(a);
    s = applyAction(s, a);
    if (a.type === 'endTurn') break;
  }
  return { state: s, actions };
}

/** Uma decisão isolada do bot `p` (escolha pendente). */
function botDecision(s: GameState, p: PlayerId): Action {
  resetPlanner();
  expect(actingPlayer(s)).toBe(p);
  return botAction(s, p);
}

const names = (s: GameState, uids: string[]) => uids.map((u) => cardDef(s, u).name);
const inTrash = (s: GameState, p: PlayerId, cardId: string) => s.players[p].trash.some((u) => s.cards[u].cardId === cardId);

/** Turno `turn` do jogador 0 com a mão devolvida ao fundo do deck (as cartas de teste entram com `fetchToHand`/`inject`). */
function position(decks: [typeof kid, typeof luffy], turn: number, seed = 1): GameState {
  const s = toTurn(started(seed, decks), turn);
  clearHand(s, 0);
  return s;
}

function clearHand(s: GameState, p: PlayerId) {
  s.players[p].deck.push(...s.players[p].hand);
  s.players[p].hand = [];
}

let injected = 0;

/** Cria uma instância nova de `cardId` (de qualquer coleção carregada) para `player`, no campo ou na mão (mutação direta, só para testes). */
function inject(s: GameState, player: PlayerId, cardId: string, where: 'field' | 'hand', opts: { rested?: boolean; turn?: number } = {}): string {
  if (!s.defs[cardId]) {
    const data = cards.find((c) => c.id === cardId);
    if (!data) throw new Error(`${cardId} não carregada`);
    s.defs[cardId] = buildCardDef(data);
  }
  const uid = `x${++injected}`;
  s.cards[uid] = { uid, cardId, owner: player };
  if (where === 'hand') s.players[player].hand.push(uid);
  else s.players[player].characters.push({ uid, rested: Boolean(opts.rested), don: 0, playedOnTurn: opts.turn ?? 0 });
  return uid;
}

describe('bot com busca: fase principal', () => {
  it('vira o Personagem e o ataca', () => {
    // Kid x Luffy, turno 5 (5 DON!!): Straw Sword vira o Vito do oponente; o Líder (5000 + DON!!) o nocauteia.
    const s = position([kid, luffy], 5);
    fetchToHand(s, 0, 'ST02-017'); // Straw Sword: "Rest up to 1 of your opponent's Characters."
    inject(s, 1, 'ST02-002', 'field'); // Vito 5000 (ativo) no campo do oponente.
    const { state, actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'playCard' && cardDef(s, a.uid).name === 'Straw Sword')).toBe(true);
    expect(inTrash(state, 1, 'ST02-002'), 'Vito deveria ter sido nocauteado').toBe(true);
  });

  it('anexa DON!! e ataca no mesmo turno', () => {
    // 4 DON!! e nada na mão: o Líder (5000) precisa de 1 DON!! para nocautear o Franky (6000) virado.
    const s = position([kid, luffy], 7);
    s.players[0].donActive = 4;
    inject(s, 1, 'ST01-010', 'field', { rested: true }); // Franky 6000, custo 4
    const { state, actions } = botTurn(s, 0);
    expect(actions.filter((a) => a.type === 'attachDon').length).toBeGreaterThan(0);
    expect(inTrash(state, 1, 'ST01-010'), 'Franky deveria ter sido nocauteado').toBe(true);
  });

  it('não gasta DON!! em quem não pode atacar', () => {
    // Koby entrou neste turno (sem [Rush]): DON!! nele não serve para nada.
    const s = position([kid, luffy], 5);
    const koby = inject(s, 0, 'ST02-006', 'field', { turn: s.turn });
    const { actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'attachDon' && a.target === koby)).toBe(false);
  });

  it('guarda DON!! para Evento [Counter]', () => {
    // Luffy x Kid, 3 DON!! e Guard Point (custo 1) na mão: ataca com o Líder, mas fecha o turno com DON!! ativo.
    const s = position([luffy, kid], 3);
    fetchToHand(s, 0, 'ST01-014');
    const { state, actions } = botTurn(s, 0);
    expect(actions.some((a) => a.type === 'attack')).toBe(true);
    expect(state.players[0].donActive).toBeGreaterThanOrEqual(1);
    expect(state.players[0].hand.map((u) => s.cards[u].cardId)).toContain('ST01-014');
  });

  it('prefere K.O. de Personagem caro a dano no Líder com Vida alta', () => {
    // Franky (6000) ativo pode bater no Líder (5 de Vida) ou na Robin (5000, custo 3) virada.
    const s = position([luffy, kid], 5);
    const franky = inject(s, 0, 'ST01-010', 'field');
    const robin = inject(s, 1, 'ST01-008', 'field', { rested: true });
    s.players[0].donActive = 0;
    const { actions } = botTurn(s, 0);
    const attack = actions.find((a) => a.type === 'attack' && a.attacker === franky);
    expect(attack && attack.type === 'attack' ? attack.target : null).toBe(robin);
  });

  it('prefere a carta com efeito útil', () => {
    // 3 DON!!, Killer ([On Play] K.O. de Personagem virado de custo ≤ 3) e Vito (vanilla 5000) na mão. Do outro lado,
    // Robin (5000, custo 3) virada e um Chopper [Blocker] ativo; o Líder já atacou: só o Killer a alcança.
    const s = position([kid, luffy], 3);
    s.players[0].leader.rested = true;
    fetchToHand(s, 0, 'ST02-005');
    fetchToHand(s, 0, 'ST02-002');
    inject(s, 1, 'ST01-008', 'field', { rested: true });
    inject(s, 1, 'ST01-006', 'field');
    const { state, actions } = botTurn(s, 0);
    expect(names(s, actions.filter((a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard').map((a) => a.uid))).toContain('Killer');
    expect(inTrash(state, 1, 'ST01-008')).toBe(true);
  });

  it('usa o efeito da carta de remoção quando há alvo, e a segura quando não há', () => {
    // Vander Decken IX ([On Play] descarte 1 {Fish-Man}: K.O. de 1 Personagem virado), um Jinbe vanilla ({Fish-Man},
    // custo 2) e um Bege na mão, 4 DON!!; o Líder já atacou. Com o Kid (custo 7) virado do outro lado, só o Decken o
    // alcança: o bot o joga pagando o custo (o Jinbe) e o nocauteia.
    const setup = (kidRested: boolean, fishMan: boolean) => {
      const s = position([kid, luffy], 7);
      s.players[0].donActive = 4;
      s.players[0].leader.rested = true;
      const decken = inject(s, 0, 'OP06-033', 'hand');
      if (fishMan) inject(s, 0, 'ST03-006', 'hand');
      fetchToHand(s, 0, 'ST02-004');
      inject(s, 1, 'ST02-013', 'field', { rested: kidRested });
      return { s, decken };
    };
    const withTarget = setup(true, true);
    const a = botTurn(withTarget.s, 0);
    expect(a.actions.some((x) => x.type === 'answer' && x.yes)).toBe(true);
    expect(inTrash(a.state, 1, 'ST02-013'), 'o Kid deveria ter sido nocauteado pelo Decken').toBe(true);
    expect(inTrash(a.state, 0, 'ST03-006'), 'o Jinbe deveria ter sido o descarte').toBe(true);

    // O mesmo Kid ativo: o efeito não tem alvo. Jogar o Decken como corpo de 2000 desperdiça a remoção;
    // o bot baixa o resto (Jinbe e Bege) e guarda o Decken para quando houver um Personagem virado.
    const noTarget = setup(false, true);
    const b = botTurn(noTarget.s, 0);
    expect(b.state.players[0].hand).toContain(noTarget.decken);
    expect(b.actions.filter((x) => x.type === 'playCard').length).toBe(2);

    // Sem {Fish-Man} para descartar (o custo não dá para pagar), idem: o Decken fica na mão.
    const noCost = setup(true, false);
    const c = botTurn(noCost.s, 0);
    expect(c.state.players[0].hand).toContain(noCost.decken);
  });

  it('paga o custo do Líder quando o deck faz o efeito valer (Rocks.D.Xebec)', () => {
    // Xebec: "[When Attacking] descarte 1 carta: revele o topo do deck; se for {Rocks Pirates}, compre 2". A visão
    // esconde a ordem do deck, não a composição: com o deck cheio de {Rocks Pirates}, pagar 1 carta por 2 é lucro.
    const xebec: typeof kid = { id: 'xebec', name: 'Xebec', leader: 'OP17-039', cards: [{ id: 'OP17-040', count: 50 }] };
    const game = () => {
      let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'Xebec', deck: xebec }, { name: 'Luffy', deck: luffy }] });
      s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
      s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
      s = toTurn(s, 7);
      clearHand(s, 0);
      return s;
    };
    const pay = game();
    pay.players[0].donActive = 4;
    for (let i = 0; i < 3; i++) inject(pay, 0, 'OP17-040', 'hand'); // custo 6: nada para jogar com 4 DON!!
    const a = botTurn(pay, 0);
    expect(a.actions.some((x) => x.type === 'attack' && x.attacker === pay.players[0].leader.uid)).toBe(true);
    expect(a.actions.some((x) => x.type === 'answer' && x.yes), 'deveria pagar o custo do Xebec').toBe(true);
    expect(a.state.players[0].hand.length).toBe(4); // 3 − 1 descartada + 2 compradas

    // O mesmo deck sem nenhum {Rocks Pirates}: o descarte não rende nada, e o bot recusa.
    const refuse = game();
    refuse.players[0].donActive = 4;
    for (let i = 0; i < 3; i++) inject(refuse, 0, 'OP17-040', 'hand');
    for (const u of [...refuse.players[0].deck, ...refuse.players[0].life]) refuse.cards[u] = { ...refuse.cards[u], cardId: 'ST01-006' };
    const b = botTurn(refuse, 0);
    expect(b.actions.some((x) => x.type === 'attack' && x.attacker === refuse.players[0].leader.uid)).toBe(true);
    expect(b.actions.some((x) => x.type === 'answer' && x.yes), 'não deveria pagar o custo do Xebec').toBe(false);
    expect(b.state.players[0].hand.length).toBe(3);
  });

  it('num deck que descarta da mão, guarda a carta de custo 1 como combustível em vez de baixá-la', () => {
    // Xebec: Buckin (custo 1, 2000, Counter +1000, efeito sem alvo no deck) só serve de Counter ou de descarte para o
    // Líder. Turno 1, 1 DON!!: baixá-la como corpo de 2000 gasta a carta que pagaria o Xebec; o bot a segura.
    const xebec: typeof kid = { id: 'xebec', name: 'Xebec', leader: 'OP17-039', cards: [{ id: 'OP17-040', count: 50 }] };
    const game = (turn: number) => {
      let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'Xebec', deck: xebec }, { name: 'Luffy', deck: luffy }] });
      s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
      s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
      s = toTurn(s, turn);
      clearHand(s, 0);
      return s;
    };
    const first = game(1);
    const buckin = inject(first, 0, 'OP08-051', 'hand');
    inject(first, 0, 'OP17-040', 'hand');
    const a = botTurn(first, 0);
    expect(a.state.players[0].hand).toContain(buckin);

    // Turno 5, Buckin e dois Newgate (custo 6) na mão: ao pagar o Xebec, o descarte é a Buckin, não um Newgate
    // (que vale um turno inteiro de jogada); a Buckin em campo continuaria não valendo a carta.
    const later = game(5);
    later.players[0].donActive = 5;
    const buckin2 = inject(later, 0, 'OP08-051', 'hand');
    inject(later, 0, 'OP17-040', 'hand');
    inject(later, 0, 'OP17-040', 'hand');
    const b = botTurn(later, 0);
    expect(b.actions.some((x) => x.type === 'answer' && x.yes), 'deveria pagar o custo do Xebec').toBe(true);
    expect(b.state.players[0].trash).toContain(buckin2);
    expect(b.state.players[0].characters.map((c) => c.uid)).not.toContain(buckin2);
  });

  it('acha o ataque fatal com vários atacantes pequenos', () => {
    // Oponente com 2 de Vida e a mão vazia; o bot tem o Líder, quatro Personagens de 1000 a 6000 e 4 DON!!: três
    // acertos no Líder vencem, mas cada acerto vale menos que o K.O. do Zoro virado (a linha "tudo no Líder" e a
    // reserva do feixe existem para a busca não cortar a linha fatal antes do fim).
    const s = position([kid, luffy], 9);
    s.players[1].life = s.players[1].life.slice(0, 2);
    clearHand(s, 1);
    s.players[0].donActive = 4;
    inject(s, 0, 'ST02-002', 'field'); // Vito 5000
    inject(s, 0, 'ST02-006', 'field'); // Koby 6000
    inject(s, 0, 'ST02-012', 'field'); // Bepo 3000
    inject(s, 0, 'ST02-004', 'field'); // Bege 1000
    inject(s, 1, 'ST01-013', 'field', { rested: true }); // Zoro 5000, custo 3, virado
    const { state } = botTurn(s, 0);
    expect(state.phase).toBe('gameover');
    expect(state.winner).toBe(0);
  });

  it('conta com o Blocker do oponente', () => {
    // Oponente com 0 de Vida e um Chopper [Blocker] ativo; o bot tem Líder e Zoro ativos: um ataque leva o bloqueio, o outro vence.
    const s = position([kid, luffy], 5);
    s.players[1].life = [];
    inject(s, 1, 'ST01-006', 'field'); // Chopper, [Blocker]
    inject(s, 0, 'ST01-013', 'field'); // Zoro 5000
    const { state } = botTurn(s, 0);
    expect(state.phase).toBe('gameover');
    expect(state.winner).toBe(0);
  });
});

describe('bot com busca: defesa', () => {
  /** Jogador 0 (Kid) ataca o Líder do jogador 1 (Luffy, o bot) com o Líder: 5000 contra 5000. */
  function leaderAttack(life: number, hand: string[]): GameState {
    const s = toTurn(started(1, [kid, luffy]), 3);
    s.players[1].life = s.players[1].life.slice(0, life);
    clearHand(s, 1);
    for (const id of hand) fetchToHand(s, 1, id);
    return applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
  }

  it('com 5 de Vida deixa o ataque passar', () => {
    const s = leaderAttack(5, ['ST01-008', 'ST01-011']); // Robin (+1000), Brook (+2000)
    expect(s.pending?.kind).toBe('counter');
    expect(botDecision(s, 1).type).toBe('pass');
  });

  it('com 2 de Vida e nenhum outro atacante do oponente deixa passar (fica com a carta da Vida)', () => {
    // Os melhores colocados dos torneios defendem o Líder com 2 de Vida só em 42 a 50% das vezes em que a mão
    // bastava (docs/bot-tempo.md, seção 11); com o oponente sem mais nenhum ataque no turno, tomar o dano é de graça.
    const s = leaderAttack(2, ['ST01-008', 'ST01-011']);
    expect(s.pending?.kind).toBe('counter');
    expect(botDecision(s, 1).type).toBe('pass');
  });

  it('com 1 de Vida usa Counter', () => {
    const s = leaderAttack(1, ['ST01-008', 'ST01-011']);
    expect(s.pending?.kind).toBe('counter');
    const a = botDecision(s, 1);
    expect(a.type).toBe('counter');
    // Uma carta de +1000 basta (5000 contra 5000): não gasta o Brook (+2000).
    expect(a.type === 'counter' ? cardDef(s, a.uid).name : null).toBe('Nico Robin');
  });

  it('bloqueia com Vida baixa', () => {
    const s = toTurn(started(1, [kid, luffy]), 3);
    s.players[1].life = s.players[1].life.slice(0, 1);
    clearHand(s, 1);
    inject(s, 1, 'ST01-006', 'field'); // Chopper [Blocker]
    const t = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(t.pending?.kind).toBe('block');
    const a = botDecision(t, 1);
    expect(a.type === 'choose' ? names(t, a.uids) : null).toEqual(['Tony Tony.Chopper']);
  });

  it('Evento [Counter] com alvo: dá o poder a quem está sendo atacado', () => {
    // Luffy (bot, jogador 1) com Scalpel na mão e 1 DON!!; o Vito dele (5000) é atacado por um Franky (6000).
    const s = toTurn(started(1, [kid, luffy]), 5);
    clearHand(s, 1);
    inject(s, 1, 'ST02-015', 'hand'); // Scalpel (+2000)
    s.players[1].donActive = 1;
    const vito = inject(s, 1, 'ST02-002', 'field', { rested: true });
    const franky = inject(s, 0, 'ST01-010', 'field');
    let t = applyAction(s, { type: 'attack', player: 0, attacker: franky, target: vito });
    expect(t.pending?.kind).toBe('counter');
    const a = botDecision(t, 1);
    expect(a.type).toBe('counter');
    t = applyAction(t, a);
    expect(t.pending?.kind).toBe('selectTargets');
    const target = botDecision(t, 1);
    expect(target.type === 'choose' ? target.uids : null).toEqual([vito]);
  });
});

describe('avaliação', () => {
  const w = DEFAULT_WEIGHTS;

  it('carta na mão', () => {
    const s = started(1, [kid, luffy]);
    const before = evaluate(s, 0, w);
    fetchToHand(s, 0, 'ST02-002');
    expect(evaluate(s, 0, w)).toBeGreaterThan(before);
  });

  it('carta na mão com efeito de remoção vale mais que o corpo dela', () => {
    // Killer (custo 3, 3000, [On Play] K.O. de Personagem virado de custo ≤ 3) na mão vale o efeito guardado:
    // mais que o Vito (custo 3, 5000, sem efeito), e mais que o próprio Killer em campo com o efeito já gasto.
    const s = started(1, [kid, luffy]);
    const base = evaluate(s, 0, w);
    const killer = inject(s, 0, 'ST02-005', 'hand');
    const withKiller = evaluate(s, 0, w) - base;
    s.players[0].hand.pop();
    inject(s, 0, 'ST02-002', 'hand');
    const withVito = evaluate(s, 0, w) - base;
    expect(withKiller).toBeGreaterThan(withVito);
    s.players[0].hand.pop();
    s.players[0].characters.push({ uid: killer, rested: false, don: 0, playedOnTurn: 0 });
    expect(evaluate(s, 0, w) - base).toBeLessThan(withKiller);
  });

  it('Blocker', () => {
    const a = started(1, [kid, luffy]);
    inject(a, 0, 'ST02-012', 'field'); // Bepo 3000, custo 1
    const b = started(1, [kid, luffy]);
    inject(b, 0, 'ST02-004', 'field'); // Bege 1000, custo 1, [Blocker]
    expect(evaluate(b, 0, w)).toBeGreaterThan(evaluate(a, 0, w) - 500);
  });

  it('Personagem virado exposto no turno do oponente', () => {
    const s = toTurn(started(1, [kid, luffy]), 2); // turno do jogador 1
    const active = structuredClone(s);
    inject(active, 0, 'ST02-002', 'field');
    const rested = structuredClone(s);
    inject(rested, 0, 'ST02-002', 'field', { rested: true });
    expect(evaluate(rested, 0, w)).toBeLessThan(evaluate(active, 0, w));
  });

  it('ameaça: o Blocker em pé e o Counter na mão seguram o ataque fatal do oponente', () => {
    // Turno do Luffy (jogador 1), já sem DON!! ativo: Líder e Robin (5000) atacam o Kid (5000) com 1 de
    // Vida — dois acertos, fatal.
    const base = toTurn(started(1, [kid, luffy]), 4);
    base.players[1].donRested += base.players[1].donActive;
    base.players[1].donActive = 0;
    base.players[0].life = base.players[0].life.slice(0, 1);
    clearHand(base, 0);
    inject(base, 1, 'ST01-008', 'field', { turn: 1 });
    const open = incomingThreat(base, 0, w);
    expect(open).toBeGreaterThanOrEqual(2 * w.threatHit + w.lethal);
    const blocker = structuredClone(base);
    inject(blocker, 0, 'ST02-004', 'field'); // Bege, [Blocker]
    expect(incomingThreat(blocker, 0, w)).toBe(w.threatHit);
    const counter = structuredClone(blocker);
    fetchToHand(counter, 0, 'ST02-002'); // Vito, Counter +1000
    expect(incomingThreat(counter, 0, w)).toBe(0);
  });

  it('Vida côncava: a última vale mais que a primeira', () => {
    const s = started(1, [kid, luffy]);
    const full = evaluate(s, 0, w);
    s.players[0].life = s.players[0].life.slice(0, 4);
    const four = evaluate(s, 0, w);
    s.players[0].life = s.players[0].life.slice(0, 1);
    const one = evaluate(s, 0, w);
    s.players[0].life = [];
    const zero = evaluate(s, 0, w);
    expect(full - four).toBeLessThan(one - zero);
  });

  it('as ações legais continuam válidas depois de cada jogada do bot', () => {
    let s = toTurn(started(3, [kid, luffy]), 5);
    for (let i = 0; i < 40 && s.phase !== 'gameover'; i++) {
      const p = actingPlayer(s)!;
      const a: Action = p === 0 ? botAction(s, p) : s.pending ? opponentAnswer(s, p) : { type: 'endTurn', player: p };
      expect(legalActions(s, p).length).toBeGreaterThan(0);
      s = applyAction(s, a);
    }
  });
});
