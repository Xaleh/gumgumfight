// A mão provável do oponente (docs/bot-tempo.md, seção 13): o deck provável do Líder dele, menos o que o bot já viu,
// vira a chance de Counter nas cartas escondidas e o [Rush] que ele pode baixar. Nada da mão real entra.

import { describe, expect, it } from 'vitest';
import { actingPlayer } from '../src/actions';
import { DEFAULT_WEIGHTS, incomingHits } from '../src/bot/evaluate';
import { counterChance, type DeckGuess, deckGuessFrom, handModel, validateDeckGuess } from '../src/bot/handguess';
import { chooseBotAction, resetPlanner } from '../src/bot/planner';
import { buildCardDef } from '../src/cards';
import { applyAction, cardDef } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';
import { actionFromView, identityAliases, viewFor } from '../src/view';
import { cards, kid, luffy, started, toTurn } from './helpers';

const byId = new Map(cards.map((c) => [c.id, c]));
const KID = 'ST02-001';

let injected = 0;
function inject(s: GameState, p: PlayerId, id: string, where: 'field' | 'hand', o: { rested?: boolean } = {}): string {
  s.defs[id] ??= buildCardDef(byId.get(id)!);
  const uid = `g${++injected}`;
  s.cards[uid] = { uid, cardId: id, owner: p };
  if (where === 'hand') s.players[p].hand.push(uid);
  else s.players[p].characters.push({ uid, rested: !!o.rested, don: 0, playedOnTurn: 0 });
  return uid;
}

/** Deck provável feito à mão: 13 cartas × 4 cópias, todas com o mesmo Counter, ou todas [Rush] de custo 4. */
const fake = (leader: string, card: Omit<DeckGuess['cards'][number], 'id' | 'count'>, n = 13): DeckGuess => ({
  leader,
  source: 'teste',
  cards: Array.from({ length: n }, (_, i) => ({ id: `F-${i}`, count: 4, ...card })),
});
const noCounter = fake(KID, {});
const allBig = fake(KID, { counter: 2000 });
const rushes = fake(KID, { rush: { cost: 4, power: 6000 } }, 4);

const OPTS = { random: () => 0.5, timeBudgetMs: 60_000 };

/** A decisão do bot `p` pela visão dele, com ou sem o deck provável do oponente. */
function decide(s: GameState, p: PlayerId, guess?: DeckGuess): Action {
  resetPlanner();
  const aliases = identityAliases(s);
  const a = actionFromView(s, aliases, chooseBotAction(viewFor(s, p, aliases), p, 'hard', { ...OPTS, ...(guess ? { handGuess: guess } : {}) }));
  if (typeof a === 'string') throw new Error(a);
  return a;
}

/** O turno inteiro do bot 0; o oponente não bloqueia nem usa Counter. */
function botTurn(s: GameState, guess?: DeckGuess): Action[] {
  resetPlanner();
  const out: Action[] = [];
  for (let i = 0; i < 60 && s.phase !== 'gameover'; i++) {
    const who = actingPlayer(s)!;
    if (who !== 0) {
      const kind = s.pending!.kind;
      s = applyAction(s, kind === 'block' ? { type: 'choose', player: who, uids: [] } : kind === 'lifeCard' ? { type: 'answer', player: who, yes: false } : { type: 'pass', player: who });
      continue;
    }
    const aliases = identityAliases(s);
    const a = actionFromView(s, aliases, chooseBotAction(viewFor(s, 0, aliases), 0, 'hard', { ...OPTS, ...(guess ? { handGuess: guess } : {}) }));
    if (typeof a === 'string') throw new Error(a);
    out.push(a);
    s = applyAction(s, a);
    if (a.type === 'endTurn') break;
  }
  return out;
}

describe('mão provável: o modelo', () => {
  it('o deck provável guarda o Counter, o Evento [Counter] e o [Rush] de cada carta', () => {
    const g = deckGuessFrom(KID, [...kid.cards, { id: 'ST01-012', count: 2 }, { id: KID, count: 1 }], byId, 'deck:st02');
    const by = new Map(g.cards.map((c) => [c.id, c]));
    expect(by.has(KID)).toBe(false); // o Líder não entra
    expect(by.get('ST02-008')?.counter).toBe(2000);
    expect(by.get('ST02-015')?.event).toEqual({ cost: 1, power: 2000 }); // Scalpel
    expect(by.get('ST01-012')?.rush).toEqual({ cost: 5, power: 6000 });
    expect(by.get('ST02-004')?.counter).toBeUndefined(); // Bege, sem Counter
    expect(validateDeckGuess(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(validateDeckGuess({ leader: KID, source: 'x', cards: [{ id: 'A', count: 9 }] })).toBeNull();
  });

  it('tira do deck provável o que o bot já viu do oponente, e o Evento [Counter] só conta se o DON!! paga', () => {
    const s = toTurn(started(1, [luffy, kid]), 5);
    const guess = deckGuessFrom(KID, [{ id: 'ST02-008', count: 4 }, { id: 'ST02-015', count: 4 }], byId, 'teste'); // + 42 cartas sem Counter
    // Nenhuma dessas cartas à vista no começo.
    expect(Object.values(s.cards).some((c) => c.owner === 1 && ['ST02-008', 'ST02-015'].includes(c.cardId) && !s.players[1].deck.includes(c.uid) && !s.players[1].hand.includes(c.uid) && !s.players[1].life.includes(c.uid))).toBe(false);
    s.players[1].donActive = 0;
    const view = () => viewFor(s, 0, identityAliases(s));
    const none = handModel(view(), 0, guess, 1)!;
    expect(none.counter[0]).toBeCloseTo(46 / 50, 5); // Scalpel sem DON!! não cobre nada
    expect(none.counter[2]).toBeCloseTo(4 / 50, 5);
    s.players[1].donActive = 1;
    expect(handModel(view(), 0, guess, 1)!.counter[2]).toBeCloseTo(8 / 50, 5);
    // Dois Apoo (+2000) no lixo dele: sobram dois no deck provável.
    for (let i = 0; i < 2; i++) s.players[1].trash.push(inject(s, 1, 'ST02-008', 'hand'));
    s.players[1].hand = s.players[1].hand.filter((u) => !s.players[1].trash.includes(u));
    expect(handModel(view(), 0, guess, 1)!.counter[2]).toBeCloseTo(6 / 48, 5);
    // A vantagem de guardar Counter (razão de chances) sobe a parte das cartas com Counter.
    expect(handModel(view(), 0, guess, 2)!.counter[2]).toBeCloseTo(12 / 54, 5);
    expect(handModel(view(), 0, undefined, 1)).toBeUndefined();
  });

  it('não lê a mão real: trocar as cartas escondidas da mão dele não muda o modelo nem a jogada', () => {
    const base = toTurn(started(1, [luffy, kid]), 7);
    const guess = deckGuessFrom(KID, kid.cards, byId, 'deck:st02');
    const swapped = structuredClone(base);
    const ps = swapped.players[1];
    const n = ps.hand.length;
    [ps.hand, ps.deck] = [ps.deck.slice(0, n), [...ps.hand, ...ps.deck.slice(n)]];
    const model = (s: GameState) => handModel(viewFor(s, 0, identityAliases(s)), 0, guess, DEFAULT_WEIGHTS.guessHold);
    expect(model(swapped)).toEqual(model(base));
    expect(decide(swapped, 0, guess)).toEqual(decide(base, 0, guess));
  });

  it('chance de Counter: as cartas conhecidas contam pelo valor, as escondidas pela distribuição', () => {
    const dist = [0.5, 0.5, 0, 0, 0];
    expect(counterChance([], 2, 2000, dist)).toBeCloseTo(0.25, 6);
    expect(counterChance([1], 1, 2000, dist)).toBeCloseTo(0.5, 6);
    expect(counterChance([2], 0, 2000, dist)).toBe(1);
    expect(counterChance([0, 0], 0, 1000, dist)).toBe(0);
  });
});

describe('mão provável: ataque', () => {
  /** Turno 7 do Luffy (bot): Franky 6000 pode tentar o ataque fatal no Kid (1 de Vida, 5 cartas na mão) ou nocautear a Robin virada. */
  function lethalOrKo(): { s: GameState; robin: string } {
    const s = toTurn(started(1, [luffy, kid]), 7);
    s.players[1].life = s.players[1].life.slice(0, 1);
    s.players[0].deck.push(...s.players[0].hand);
    s.players[0].hand = [];
    s.players[1].deck.push(...s.players[1].hand.splice(5));
    s.players[0].leader.rested = true;
    s.players[0].donActive = 0;
    inject(s, 0, 'ST01-010', 'field'); // Franky 6000
    const robin = inject(s, 1, 'ST01-008', 'field', { rested: true });
    return { s, robin };
  }
  const target = (a: Action) => (a.type === 'attack' ? a.target : null);

  it('contra um deck sem Counter vai no ataque fatal; contra um deck cheio de +2000, nocauteia a Robin', () => {
    const { s, robin } = lethalOrKo();
    const leader = s.players[1].leader.uid;
    expect(target(decide(s, 0)), 'sem a estimativa: o modelo fixo acha o fatal arriscado demais').toBe(robin);
    expect(target(decide(s, 0, noCounter))).toBe(leader);
    expect(target(decide(s, 0, allBig))).toBe(robin);
  });

  it('as cartas reveladas da mão contam pelo Counter delas, e não pela média', () => {
    const { s } = lethalOrKo();
    // As 5 cartas da mão dele são Bege (sem Counter) e ele as revelou: mesmo com um deck provável cheio de +2000, o fatal passa.
    s.players[1].deck.push(...s.players[1].hand);
    s.players[1].hand = [];
    for (let i = 0; i < 5; i++) inject(s, 1, 'ST02-004', 'hand');
    s.knownHand = [...s.players[1].hand];
    expect(target(decide(s, 0, allBig))).toBe(s.players[1].leader.uid);
  });

  it('o deck provável de outro Líder não vale', () => {
    const { s, robin } = lethalOrKo();
    expect(target(decide(s, 0, { ...noCounter, leader: 'ST01-001' }))).toBe(robin);
  });
});

describe('mão provável: defesa', () => {
  /** Turno 7 do Luffy (bot) com 1 de Vida e o Chopper [Blocker] em pé; o Kid tem a Bege virada e 3 DON!! (5 no turno dele). */
  function blockerHome(): { s: GameState; chopper: string } {
    const s = toTurn(started(1, [luffy, kid]), 7);
    s.players[0].life = s.players[0].life.slice(0, 1);
    s.players[0].deck.push(...s.players[0].hand);
    s.players[0].hand = [];
    s.players[0].leader.rested = true;
    s.players[0].donRested += s.players[0].donActive;
    s.players[0].donActive = 0;
    const chopper = inject(s, 0, 'ST01-006', 'field');
    inject(s, 1, 'ST02-004', 'field', { rested: true });
    const k = s.players[1];
    const total = k.donActive + k.donRested + k.donDeck;
    k.donActive = 0;
    k.donRested = 3;
    k.donDeck = total - 3;
    return { s, chopper };
  }
  const choppedAttacked = (acts: Action[], chopper: string) => acts.some((a) => a.type === 'attack' && a.attacker === chopper);

  it('o [Rush] provável entra na ameaça do próximo ataque como mais um atacante', () => {
    const { s } = blockerHome();
    const view = viewFor(s, 0, identityAliases(s));
    const model = handModel(view, 0, rushes, DEFAULT_WEIGHTS.guessHold)!;
    expect(incomingHits(view, 0)).toBe(1); // Líder e Bege; o Chopper bloqueia um
    expect(incomingHits(view, 0, { model, rushMin: DEFAULT_WEIGHTS.guessRush })).toBe(1); // o Rush (4 DON!!) tira o DON!! da Bege
    // Depois do Chopper nocautear a Bege (e ficar virado): sobra o Líder dele, e com o Rush são dois acertos — fatal.
    s.players[0].characters[0].rested = true;
    s.players[1].characters = [];
    const rested = viewFor(s, 0, identityAliases(s));
    expect(incomingHits(rested, 0)).toBe(1);
    expect(incomingHits(rested, 0, { model, rushMin: DEFAULT_WEIGHTS.guessRush })).toBe(2);
  });

  it('sem o [Rush] provável, o Chopper ataca a Bege; com ele, fica em pé para bloquear', () => {
    const { s, chopper } = blockerHome();
    expect(choppedAttacked(botTurn(s), chopper)).toBe(true);
    expect(choppedAttacked(botTurn(s, rushes), chopper)).toBe(false);
  });
});

it('cardDef continua o mesmo (sanidade do teste)', () => {
  const s = started(1, [luffy, kid]);
  expect(cardDef(s, s.players[1].leader.uid).id).toBe(KID);
});
