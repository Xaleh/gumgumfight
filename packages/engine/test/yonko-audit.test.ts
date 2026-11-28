// Auditoria da mesa com mais de dois jogadores (Yonko): efeitos que disparavam, valiam ou duravam errado por causa
// de uma conta feita para dois jogadores. Cada teste afirma o comportamento certo (e falhava antes da correção).
// As regras do formato estão em docs/regras-yonko.md; o que ele descreve como intenção não entra aqui.

import { describe, expect, it } from 'vitest';
import { applyAction, createGame, isIdle, YONKO_TABLE } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';

const LEADER: CardData = { id: 'YA-L', name: 'Capitão de Teste', category: 'leader', colors: ['red'], life: 5, power: 5000, types: ['Teste'], text: '' };
const GRUNT: CardData = { id: 'YA-C', name: 'Recruta', category: 'character', colors: ['red'], cost: 1, power: 2000, counter: 1000, types: [], text: '' };
const BRUTE: CardData = { id: 'YA-B', name: 'Brutamontes', category: 'character', colors: ['red'], cost: 5, power: 7000, types: [], text: '' };

/** Deck de 50: Recrutas, e 2 cópias de cada carta de teste. */
const deckOf = (leader: string, extra: string[]): DeckList => ({
  id: `audit-${leader}`,
  name: 'Auditoria',
  leader,
  cards: [{ id: GRUNT.id, count: 48 - 2 * extra.length }, { id: BRUTE.id, count: 2 }, ...extra.map((id) => ({ id, count: 2 }))],
});

/**
 * Mesa de 4 (ou 3) com as regras do Yonko, já depois da preparação (todos na curva ímpar, mãos mantidas), no
 * turno 1 do lugar 0. `leaders[i]`: o Líder do lugar i (padrão: o Líder sem texto). Todos os decks levam as
 * cartas de `extra`.
 */
function ready(extra: CardData[] = [], leaders: Array<CardData | undefined> = [], seats = 4): GameState {
  const all = [LEADER, GRUNT, BRUTE, ...extra, ...leaders.filter((c): c is CardData => Boolean(c))];
  const ids = extra.filter((c) => c.category !== 'leader').map((c) => c.id);
  let s = createGame({
    seed: 7,
    firstPlayer: 0,
    cards: [...new Map(all.map((c) => [c.id, c] as const)).values()],
    table: YONKO_TABLE,
    players: Array.from({ length: seats }, (_, i) => ({ name: `J${i}`, deck: deckOf((leaders[i] ?? LEADER).id, ids) })),
  });
  while (s.phase === 'mulligan') {
    const p = s.pending!;
    s = applyAction(s, p.kind === 'mulligan' ? { type: 'mulligan', player: p.player, redraw: false } : { type: 'option', player: p.player, index: 0 });
  }
  return s;
}

/** Encerra turnos sem fazer nada até o turno pedido. */
function toTurn(s: GameState, turn: number): GameState {
  while (s.turn < turn) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  return s;
}

/** Encerra turnos sem fazer nada até ser a vez de `p`. */
function toPlayer(s: GameState, p: PlayerId): GameState {
  for (let guard = 0; guard < 8 && s.activePlayer !== p; guard++) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  return s;
}

/** Tira do deck (ou da mão, da Vida) uma cópia de `cardId` e a coloca na mão (mutação direta, só para testes). */
function toHand(s: GameState, p: PlayerId, cardId: string): string {
  const ps = s.players[p];
  const inHand = ps.hand.find((u) => s.cards[u].cardId === cardId);
  if (inHand) return inHand;
  for (const zone of [ps.deck, ps.life]) {
    const i = zone.findIndex((u) => s.cards[u].cardId === cardId);
    if (i >= 0) {
      const [uid] = zone.splice(i, 1);
      ps.hand.push(uid);
      return uid;
    }
  }
  throw new Error(`${cardId} não encontrado`);
}

/** Coloca uma carta direto no campo, sem [On Play] (mutação direta, só para testes). */
function onField(s: GameState, p: PlayerId, cardId: string, rested = false): string {
  const uid = toHand(s, p, cardId);
  const ps = s.players[p];
  ps.hand.splice(ps.hand.indexOf(uid), 1);
  ps.characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
}

/** Joga da mão uma carta do jogador da vez, com DON!! de sobra (mutação direta, só para testes). */
function play(s: GameState, cardId: string): GameState {
  const p = s.activePlayer;
  const uid = toHand(s, p, cardId);
  s.players[p].donActive = 10;
  return applyAction(s, { type: 'playCard', player: p, uid });
}

/** O defensor não reage: sem [Blocker], sem Counter, e a carta da Vida vai para a mão. */
function noDefense(s: GameState): GameState {
  for (let guard = 0; guard < 20; guard++) {
    const p = s.pending;
    if (p?.kind === 'block') s = applyAction(s, { type: 'choose', player: p.player, uids: [] });
    else if (p?.kind === 'counter') s = applyAction(s, { type: 'pass', player: p.player });
    else if (p?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: p.player, yes: false });
    else break;
  }
  return s;
}

describe('Yonko (auditoria): quem causou o dano', () => {
  // "When you deal damage to your opponent's Life" (`damageDealt`) valia para todo jogador que não fosse o
  // defensor: numa mesa de 4, o ataque de um jogador disparava também o efeito dos dois que só assistiam.
  const SHARK: CardData = {
    id: 'YA-S',
    name: 'Tubarão',
    category: 'character',
    colors: ['red'],
    cost: 1,
    power: 2000,
    types: [],
    text: "When you deal damage to your opponent's Life, draw 1 card.",
  };

  it('"When you deal damage to your opponent\'s Life" só dispara para quem atacou', () => {
    let s = toTurn(ready([SHARK]), 5);
    onField(s, 0, SHARK.id);
    onField(s, 2, SHARK.id);
    const hands = s.players.map((ps) => ps.hand.length);
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid }));
    expect(isIdle(s)).toBe(true);
    expect(s.players[1].hand.length).toBe(hands[1] + 1); // a carta da Vida
    expect(s.players[0].hand.length).toBe(hands[0] + 1); // quem atacou compra
    expect(s.players[2].hand.length).toBe(hands[2]); // quem só assistiu, não
  });
});

describe('Yonko (auditoria): condições contadas pelo número do turno da mesa', () => {
  // "If it is your second turn or later" vira `minTurn: 3` (parser.ts) e é conferido com `state.turn < 3`
  // (conditions.ts): com dois jogadores o turno 3 é o segundo do primeiro jogador; numa mesa de 4, os turnos
  // 3 e 4 são o PRIMEIRO turno do terceiro e do quarto jogador.
  const VETERAN: CardData = {
    id: 'YA-V',
    name: 'Veterano',
    category: 'character',
    colors: ['red'],
    cost: 1,
    power: 2000,
    types: [],
    text: '[On Play] If it is your second turn or later, draw 2 cards.',
  };

  it('"If it is your second turn or later" não vale no primeiro turno do 3º e do 4º jogador', () => {
    for (const seat of [2, 3] as const) {
      let s = toPlayer(ready([VETERAN]), seat);
      expect(s.turnsTaken?.[seat]).toBe(1);
      const hand = s.players[seat].hand.length;
      s = play(s, VETERAN.id);
      expect(isIdle(s)).toBe(true);
      // Jogou 1 carta e não comprou nada: é o primeiro turno dele.
      expect(s.players[seat].hand.length).toBe(hand - 1);
    }
  });
});

describe('Yonko (auditoria): duração dos efeitos usados no turno de um oponente', () => {
  // OP18-032 Buggy (texto real). "will not become active in your opponent's next Refresh Phase" vira um
  // modificador `skipRefresh` com a duração 'nextOpponentTurn' (steps/power.ts), que na mesa de mais de dois
  // acaba "no começo do turno de quem usou" (`setExpiry` + `turnExpiries`, turn.ts). Usado no turno de um
  // oponente ([On K.O.], [Trigger], [Counter]), o turno de quem usou chega antes da Renovação do alvo e o
  // efeito some sem ter feito nada.
  const BUGGY: CardData = {
    id: 'OP18-032',
    name: 'Buggy',
    category: 'character',
    colors: ['green'],
    cost: 5,
    power: 6000,
    counter: 1000,
    types: ['East Blue', 'Buggy Pirates'],
    text: "[On Play]/[On K.O.] Up to 1 of your opponent's rested Characters with 8000 power or less will not become active in your opponent's next Refresh Phase.",
  };

  it('"will not become active in your opponent\'s next Refresh Phase" usado no turno do oponente segura a carta na Renovação dele', () => {
    let s = toTurn(ready([BUGGY]), 5);
    expect(s.activePlayer).toBe(0);
    const brute = onField(s, 0, BRUTE.id);
    const buggy = onField(s, 1, BUGGY.id, true);
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: brute, target: buggy }));
    // [On K.O.] do Buggy do lugar 1: o Brutamontes (virado pelo ataque) não desvira na próxima Renovação do lugar 0.
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, options: [brute] });
    s = applyAction(s, { type: 'choose', player: 1, uids: [brute] });
    expect(isIdle(s)).toBe(true);
    // A volta inteira: lugares 1, 2 e 3 jogam, e o lugar 0 faz a Renovação.
    s = toTurn(s, 9);
    expect(s.activePlayer).toBe(0);
    expect(s.players[0].characters.find((c) => c.uid === brute)?.rested).toBe(true);
  });
});

describe('Yonko (auditoria): passo "para cada oponente" que também mexe com quem usa o efeito', () => {
  // ST07-008 Charlotte Pudding (texto real; o mesmo passo em ST07-003 Katakuri e ST07-016 Power Mochi).
  // `eachOpponent` (effects.ts) manda repetir `peekLife` para cada oponente sempre que `whose !== 'own'`,
  // inclusive com 'either' ("your or your opponent's"): cada cópia volta a oferecer a PRÓPRIA Vida, e "up to
  // 1 card" vira até 3 cartas da própria Vida olhadas e reordenadas.
  const PUDDING: CardData = {
    id: 'ST07-008',
    name: 'Charlotte Pudding',
    category: 'character',
    colors: ['yellow'],
    cost: 2,
    power: 3000,
    counter: 1000,
    types: ['Big Mom Pirates'],
    text: "[On Play] Look at up to 1 card from the top of your or your opponent's Life cards, and place it at the top or bottom of the Life cards.",
  };

  it('"Look at up to 1 card from the top of your or your opponent\'s Life cards": olhada a própria Vida, o efeito acaba', () => {
    let s = toTurn(ready([PUDDING]), 5);
    const life = [...s.players[0].life];
    s = play(s, PUDDING.id);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, promptKey: 'engine.peekWhichLife' });
    s = applyAction(s, { type: 'option', player: 0, index: 0 }); // a própria Vida
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, promptKey: 'engine.lifeTopIsWhere' });
    s = applyAction(s, { type: 'option', player: 0, index: 1 }); // vai para o fundo
    // "Up to 1 card": a carta olhada foi uma, e não há segunda pergunta.
    expect(s.pending).toBeNull();
    expect(isIdle(s)).toBe(true);
    expect(s.players[0].life).toEqual([life[life.length - 1], ...life.slice(0, -1)]);
  });
});

describe('Yonko (auditoria): "a carta revelada" depois de um passo repetido para cada oponente', () => {
  // `revealOpponentHand` e `revealOpponentTop` estão em EACH_OPPONENT_STEPS (effects.ts): na mesa de mais de
  // dois, o passo roda uma vez por oponente e cada cópia sobrescreve `frame.last`. O "If the revealed card …"
  // seguinte (`chosenMatches` / `revealedHasChosenCost`, em `stepConditionMet`) só olha `frame.last[0]`: a
  // carta do ÚLTIMO oponente da ordem dos turnos decide o efeito para todos.
  const EVENT: CardData = { id: 'YA-E', name: 'Evento de Teste', category: 'event', colors: ['red'], cost: 1, types: [], text: '[Main] Draw 1 card.' };
  // OP01-063 Arlong (texto real, data/cards/op01.json).
  const ARLONG: CardData = {
    id: 'OP01-063',
    name: 'Arlong',
    category: 'character',
    colors: ['blue'],
    cost: 4,
    power: 5000,
    counter: 1000,
    types: ['Fish-Man', 'Arlong Pirates'],
    text: "[DON!! x1] [Activate:Main] You may rest this Character: Choose 1 card from your opponent's hand; your opponent reveals that card. If the revealed card is an Event, place up to 1 card from your opponent's Life area at the bottom of the owner's deck.",
  };
  // OP11-081 Cognac Mama-Mash (texto real, data/cards/st34.json; o mesmo par de passos em OP11-066, OP11-071 e OP11-079).
  const COGNAC: CardData = {
    id: 'OP11-081',
    name: 'Cognac Mama-Mash',
    category: 'event',
    colors: ['purple'],
    cost: 6,
    types: ['The Four Emperors', 'Big Mom Pirates'],
    text: "[Main] Choose a cost and reveal 1 card from the top of your opponent's deck. If the revealed card has the chosen cost, K.O. up to 1 of your opponent's Characters with a base cost of 8 or less.",
  };

  /** Deixa a mão do jogador só com `n` cópias de `cardId` (o resto volta ao deck): mutação direta, só para testes. */
  function handOnly(s: GameState, p: PlayerId, cardId: string, n: number) {
    const ps = s.players[p];
    ps.deck.push(...ps.hand.splice(0));
    for (let i = 0; i < n; i++) {
      const at = ps.deck.findIndex((u) => s.cards[u].cardId === cardId);
      ps.hand.push(...ps.deck.splice(at, 1));
    }
  }

  /** Põe uma cópia de `cardId` no topo do deck do jogador (mutação direta, só para testes). */
  function deckTop(s: GameState, p: PlayerId, cardId: string) {
    const ps = s.players[p];
    const at = ps.deck.findIndex((u) => s.cards[u].cardId === cardId);
    ps.deck.unshift(...ps.deck.splice(at, 1));
  }

  it('Arlong: o Evento revelado por um oponente não tira Vida dos outros dois', () => {
    let s = toTurn(ready([ARLONG, EVENT]), 5);
    const arlong = onField(s, 0, ARLONG.id);
    s.players[0].characters.find((c) => c.uid === arlong)!.don = 1;
    // Lugares 1 e 2 só têm Personagens na mão; o lugar 3 (o último da ordem) só tem Eventos.
    handOnly(s, 1, GRUNT.id, 3);
    handOnly(s, 2, GRUNT.id, 3);
    handOnly(s, 3, EVENT.id, 2);
    const life = s.players.map((ps) => ps.life.length);
    s = applyAction(s, { type: 'activate', player: 0, uid: arlong, ability: 0 });
    expect(isIdle(s)).toBe(true);
    // Só quem revelou um Evento perde a carta de Vida.
    expect(s.players[3].life).toHaveLength(life[3] - 1);
    expect(s.players[1].life).toHaveLength(life[1]);
    expect(s.players[2].life).toHaveLength(life[2]);
    // O histórico diz para quem cada parte valeu: todos revelam, e só o lugar 3 perde a Vida.
    const hits = s.log.filter((e) => e.key === 'log.effectHits').map((e) => e.text);
    expect(hits).toEqual(['Arlong: o efeito vale para J1, J2, J3.', 'Arlong: o efeito vale para J3.']);
  });

  it('Cognac Mama-Mash: a carta revelada de um oponente tem o custo escolhido, e o efeito acontece', () => {
    let s = toTurn(ready([COGNAC]), 5);
    const victim = onField(s, 2, GRUNT.id);
    // Topo dos decks: custo 5 no lugar 1; custo 1 nos lugares 2 e 3.
    deckTop(s, 1, BRUTE.id);
    deckTop(s, 2, GRUNT.id);
    deckTop(s, 3, GRUNT.id);
    s = play(s, COGNAC.id);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, promptKey: 'engine.chooseACost' });
    s = applyAction(s, { type: 'option', player: 0, index: 5 });
    // A carta do lugar 1 tem o custo escolhido: "K.O. up to 1 of your opponent's Characters …".
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [victim] });
    // Cada revelação diz de quem é o deck ("do oponente" não diz, com três na mesa).
    expect(s.log.filter((e) => e.key === 'log.revealsDeckTopOf').map((e) => e.text)).toEqual([
      'J0 revela Brutamontes do topo do deck de J1.',
      'J0 revela Recruta do topo do deck de J2.',
      'J0 revela Recruta do topo do deck de J3.',
    ]);
  });
});
