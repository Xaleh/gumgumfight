import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, createGame, getPower, hasKeyword, hasName } from '../src/engine';
import type { Ability, CardData, DeckList, EffectStep, GameState, PlayerId } from '../src/types';
import { cards as baseCards, noDefense, toTurn } from './helpers';

// Auditoria das cartas automatizadas (card 21 do Trello, "Testar as funcionalidades das cartas em
// busca de bugs"): texto oficial x o que o motor entendia. Cartas reais da optcgapi.
const auditCards = (JSON.parse(readFileSync(join(__dirname, 'fixtures/bugs-auditoria-cartas.json'), 'utf8')) as { cards: CardData[] }).cards;
const cards = [...baseCards, ...auditCards];
const byId = (id: string) => cards.find((c) => c.id === id)!;
const def = (id: string) => buildCardDef(byId(id));
const abilities = (id: string): Ability[] => def(id).abilities;

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['ST01-001', 'ST02-001'], seed = 7): GameState {
  let s = createGame({
    seed,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck(leaders[0]) },
      { name: 'B', deck: deck(leaders[1]) },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Troca a carta do topo do deck por `cardId` (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= def(cardId);
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const emptyHand = (s: GameState, player: PlayerId) => {
  const ps = s.players[player];
  ps.deck.push(...ps.hand.splice(0));
};
const setDon = (s: GameState, player: PlayerId, active: number, rested = 0) => {
  const ps = s.players[player];
  ps.donDeck = 10 - active - rested;
  ps.donActive = active;
  ps.donRested = rested;
};
const answer = (s: GameState, yes: boolean) => applyAction(s, { type: 'answer', player: s.pending!.player, yes });
const stepsOf = (id: string, timing: Ability['timing']) => abilities(id).find((a) => a.timing === timing)!.steps;

describe('Law OP01-002: "Then, play … different color than the returned Character" depende da devolução', () => {
  it('com 4 Personagens não devolve nada e também não joga o Personagem da mão', () => {
    let s = toTurn(game(['OP01-002', 'ST02-001']), 3);
    setDon(s, 0, 2);
    for (const id of ['ST01-003', 'ST01-008', 'ST01-009', 'ST02-002']) field(s, 0, id);
    const inHand = hand(s, 0, 'ST02-006');
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    // Antes: a jogada de graça abria mesmo sem a devolução (qualquer cor, custo até 5).
    expect(s.pending).toBeNull();
    expect(s.players[0].hand).toContain(inHand);
    expect(s.players[0].characters).toHaveLength(4);
  });
});

describe('Shu OP11-088: "can be activated when your opponent\'s Character attacks"', () => {
  it('o ataque do Líder do oponente não gasta o [Once Per Turn]; o ataque seguinte de um Personagem (Slash) dá +5000', () => {
    let s = toTurn(game(), 4);
    setDon(s, 1, 4);
    const shu = field(s, 0, 'OP11-088');
    const zoro = field(s, 1, 'ST01-013'); // "Slash"
    const base = getPower(s, shu);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(getPower(s, shu)).toBe(base);
    s = noDefense(s);
    expect(s.battle).toBeNull();
    s = applyAction(s, { type: 'attack', player: 1, attacker: zoro, target: s.players[0].leader.uid });
    expect(getPower(s, shu)).toBe(base + 5000);
  });

  it('a condição de ativação fica na habilidade e o atributo no efeito', () => {
    const ab = abilities('OP11-088').find((a) => a.timing === 'onOpponentAttack')!;
    expect(ab.condition).toEqual({ attackerCharacter: true });
    expect(ab.steps[0].if).toEqual({ attackerAttribute: 'Slash' });
  });
});

describe('Vinsmoke Ichiji OP11-043: "This effect can be activated when you only have {GERMA} Characters"', () => {
  it('é condição para ativar (não gasta o [Once Per Turn] quando não vale)', () => {
    const ab = abilities('OP11-043').find((a) => a.timing === 'onOpponentAttack')!;
    expect(ab.condition).toEqual({ onlyTypeIncludes: 'GERMA' });
    expect(ab.oncePerTurn).toBe(true);
    expect(ab.steps.every((st) => !st.if)).toBe(true);
  });
});

describe('"If you have 8 or more rested cards" conta os DON!! virados', () => {
  it('Jewelry Bonney OP12-118: com 10 DON!! virados compra 2 cartas', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 5, 5);
    const bonney = hand(s, 0, 'OP12-118');
    s = applyAction(s, { type: 'playCard', player: 0, uid: bonney });
    // Pagou 5: 10 DON!! virados. Comprou 2 e escolhe 1 para descartar.
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
  });

  it('com 7 cartas viradas não compra', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 5, 2);
    const bonney = hand(s, 0, 'OP12-118');
    s = applyAction(s, { type: 'playCard', player: 0, uid: bonney });
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('OP06-038, ST24-001 e ST16-003 usam a mesma contagem', () => {
    expect(stepsOf('OP06-038', 'counter')[1].if).toEqual({ ownRestedCardsMin: 8 });
  });
});

describe('Klabautermann EB02-033: "If you have [Merry Go] on your field" (Merry Go é um Stage)', () => {
  it('ganha [Blocker] com o Stage [Merry Go] em campo', () => {
    const s = toTurn(game(), 3);
    const klab = field(s, 0, 'EB02-033');
    expect(hasKeyword(s, klab, 'blocker')).toBe(false);
    s.players[0].stage = { uid: take(s, 0, 'EB02-041'), rested: false, don: 0, playedOnTurn: 0 };
    expect(hasKeyword(s, klab, 'blocker')).toBe(true);
  });
});

describe('Mr.2.Bon.Kurei(Bentham) OP14-091: "other than [Mr.2.Bon.Kurei.(Bentham)]"', () => {
  it('o nome do texto (com um ponto a mais) é o nome da própria carta', () => {
    const playStep = stepsOf('OP14-091', 'onKO').find((st) => st.do === 'playFrom') as Extract<EffectStep, { do: 'playFrom' }>;
    expect(playStep.filter.excludeName).toBe('Mr.2.Bon.Kurei.(Bentham)');
    expect(hasName(def('OP14-091'), playStep.filter.excludeName!)).toBe(true);
    expect(hasName(def('OP14-091'), 'Mr.3')).toBe(false);
  });
});

describe('Octoballoon OP15-106: "yellow Character or Stage card with a cost of 2 or less"', () => {
  it('cor e custo valem para as duas categorias', () => {
    const step = stepsOf('OP15-106', 'trigger')[1] as Extract<EffectStep, { do: 'playFrom' }>;
    expect(step.filter.either).toEqual([
      { color: 'yellow', category: 'character', maxCost: 2 },
      { color: 'yellow', category: 'stage', maxCost: 2 },
    ]);
  });
});

describe('"you may trash 1 card from your hand. If you do, …" com a mão vazia', () => {
  it('Roronoa Zoro OP16-035: sem carta na mão não pergunta e o Líder não recebe DON!!', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 7, 3);
    const zoro = hand(s, 0, 'OP16-035');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    // "Rest up to 1 of your opponent's cards": não escolhe nada.
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toBeNull();
    expect(s.players[0].leader.don).toBe(0);
  });

  it('com 1 carta na mão pergunta, descarta e dá os DON!! ao Líder', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 7, 3);
    const zoro = hand(s, 0, 'OP16-035');
    const other = hand(s, 0, 'ST01-006');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(s.players[0].trash).toContain(other);
    expect(s.players[0].leader.don).toBe(3);
  });
});

describe('Monkey.D.Luffy EB02-061: "return 2 of your active DON!! cards"', () => {
  it('DON!! virados ou dados não pagam o custo', () => {
    let s = toTurn(game(), 3);
    const luffy = field(s, 0, 'EB02-061');
    setDon(s, 0, 1, 3);
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    // Antes: 4 DON!! em campo bastavam e o efeito perguntava.
    expect(s.pending?.kind).not.toBe('confirm');
    expect(s.players[0].donDeck).toBe(6);
  });

  it('com 2 ativos paga devolvendo os ativos (os virados ficam)', () => {
    let s = toTurn(game(), 3);
    const luffy = field(s, 0, 'EB02-061');
    setDon(s, 0, 2, 3);
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.players[0].donActive).toBe(0);
    expect(s.players[0].donRested).toBe(3);
    expect(s.players[0].donDeck).toBe(7);
  });

  it('Sengoku OP16-060 lê o mesmo custo', () => {
    expect(abilities('OP16-060')[0].cost).toEqual({ donMinus: 8, donMinusActive: true });
  });
});

describe('Portgas.D.Ace OP03-001: "When this Leader attacks or is attacked"', () => {
  it('não dispara quando o oponente ataca um Personagem', () => {
    let s = toTurn(game(['OP03-001', 'ST02-001']), 4);
    setDon(s, 1, 4);
    const target = field(s, 0, 'ST01-006', true);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target });
    expect(['block', 'counter']).toContain(s.pending?.kind);
  });

  it('é o evento "Líder ataca ou é atacado"', () => {
    expect(abilities('OP03-001')).toEqual([expect.objectContaining({ timing: 'event', event: { kind: 'leaderBattle' } })]);
  });
});

describe('Leitura de outras cartas da auditoria', () => {
  it('Foxy OP07-059: a condição vale para o Líder e para o Personagem', () => {
    const steps = stepsOf('OP07-059', 'whenAttacking').filter((st) => st.do === 'skipRefresh');
    expect(steps).toHaveLength(2);
    for (const st of steps) expect(st.if).toEqual({ minTypedCharacters: { count: 3, type: 'Foxy Pirates' } });
  });

  it('Portgas.D.Ace OP13-119: aceitar e não devolver nenhum Personagem não deixa o oponente jogar', () => {
    const steps = stepsOf('OP13-119', 'onPlay');
    expect(steps.find((st) => st.do === 'opponentPlays')!.if).toEqual({ lastDone: true });
  });

  it('Crocodile OP04-058 e Charlotte Brulee EB03-033: "returned to your DON!! deck by your effect"', () => {
    for (const id of ['OP04-058', 'EB03-033']) {
      expect(abilities(id).find((a) => a.timing === 'event')!.event).toEqual({ kind: 'donReturned', byYourEffect: true });
    }
  });

  it('Nico Robin EB03-055: "you may deal 1 damage" pergunta antes', () => {
    expect(stepsOf('EB03-055', 'onKO')).toEqual([
      { do: 'payCost', cost: {}, scope: 1 },
      { do: 'takeDamage', count: 1, opponent: true },
    ]);
  });

  it('Koala OP12-081: "using a Character\'s effect" e Sanji OP02-026: "from your hand"', () => {
    const koala = abilities('OP12-081').find((a) => a.timing === 'event')!.event!;
    expect(koala.kind === 'anyOf' && koala.events[1]).toMatchObject({ kind: 'characterPlayed', byCharacterEffect: true });
    expect(abilities('OP02-026')[0].event).toMatchObject({ kind: 'characterPlayed', who: 'self', fromHand: true });
  });
});
