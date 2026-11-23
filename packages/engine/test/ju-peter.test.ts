// OP13-084 St. Shepherd Ju Peter: a optcgapi traz na versão normal o [On Play] do St. Jaygarcia Saturn
// (OP13-083) no lugar do [Your Turn] (corrigido em SOURCE_TEXT_FIXES). O [Your Turn] fixa o poder base dos
// {Five Elders} em 7000, para mais ou para menos (Q&A OP17: o OP13-082 Five Elders de 12000 fica com 7000).
import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/cards/parser';
import { applyAction, basePowerOf, createGame, getPower } from '../src/engine';
import { fixCard } from '../src/errata';
import { translateCardPt } from '../src/i18n/render';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const OFFICIAL =
  "If you have 7 or more cards in your trash, this Character cannot be removed from the field by your opponent's effects.\n" +
  '[Your Turn] If you have 10 or more cards in your trash, set the base power of all of your {Five Elders} type Characters to 7000.';
/** Como a optcgapi entrega a versão normal (com o [On Play] do OP13-083). */
const FROM_API =
  "If you have 7 or more cards in your trash, this Character cannot be removed from the field by your opponent's effects.\n" +
  '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 "Five Elders" type card and add it to your hand. Then, place the rest at the bottom of your deck in any order.';

const char = (id: string, name: string, power: number, types: string[], text = ''): CardData => ({
  id,
  name,
  category: 'character',
  colors: ['black'],
  cost: 7,
  power,
  types,
  text,
});
const JU_PETER = char('OP13-084', 'St. Shepherd Ju Peter', 5000, ['Celestial Dragons', 'Five Elders'], FROM_API);
const extra: CardData[] = [
  JU_PETER,
  char('JP-ELDERS', 'Five Elders', 12000, ['Celestial Dragons', 'Five Elders']),
  char('JP-OTHER', 'Outro', 4000, ['Celestial Dragons']),
];
const cards = [...baseCards, ...extra.map(fixCard)];
const deck: DeckList = {
  id: 'jp',
  name: 'jp',
  leader: 'ST01-001',
  cards: [{ id: 'ST01-006', count: 50 - extra.length }, ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

/** Turno 3 (do jogador 0), com `trash` cartas no descarte do jogador 0. */
function game(trash: number): GameState {
  let s = createGame({ seed: 7, firstPlayer: 0, cards, players: [{ name: 'A', deck }, { name: 'B', deck }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  s = toTurn(s, 3);
  const ps = s.players[0];
  ps.trash = ps.deck.splice(0, trash);
  return s;
}
/** Põe `cardId` no campo, tirada do deck (mutação direta, só para testes). */
const field = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.players[player].characters.push({ uid, rested: false, don: 0, playedOnTurn: 0 });
  return uid;
};

describe('OP13-084 St. Shepherd Ju Peter', () => {
  it('o texto da API volta a ser o da carta impressa, e o [Your Turn] é lido (não fica manual)', () => {
    expect(fixCard(JU_PETER).text).toBe(OFFICIAL);
    expect(fixCard({ ...JU_PETER, text: OFFICIAL }).text).toBe(OFFICIAL);
    const parsed = parseCard(fixCard(JU_PETER));
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.abilities.some((a) => a.manual)).toBe(false);
    expect(translateCardPt({ category: 'character', text: OFFICIAL }).text).not.toMatch(/Ao Jogar/);
  });

  it('com 10+ cartas no descarte, no seu turno: os {Five Elders} ficam com 7000 de base (para mais ou para menos)', () => {
    const s = game(10);
    const ju = field(s, 0, 'OP13-084');
    const elders = field(s, 0, 'JP-ELDERS');
    const other = field(s, 0, 'JP-OTHER');
    expect(basePowerOf(s, ju)).toBe(7000);
    expect(basePowerOf(s, elders)).toBe(7000);
    expect(getPower(s, elders)).toBe(7000);
    expect(basePowerOf(s, other)).toBe(4000);
  });

  it('não vale com 9 cartas no descarte, nem no turno do oponente', () => {
    let s = game(9);
    const ju = field(s, 0, 'OP13-084');
    const elders = field(s, 0, 'JP-ELDERS');
    expect(basePowerOf(s, ju)).toBe(5000);
    expect(basePowerOf(s, elders)).toBe(12000);
    s.players[0].trash.push(s.players[0].deck.pop()!);
    expect(basePowerOf(s, elders)).toBe(7000);
    s = toTurn(s, 4);
    expect(basePowerOf(s, ju)).toBe(5000);
    expect(basePowerOf(s, elders)).toBe(12000);
  });

  it('não afeta os {Five Elders} do oponente', () => {
    const s = game(10);
    field(s, 0, 'OP13-084');
    const theirs = field(s, 1, 'JP-ELDERS');
    expect(basePowerOf(s, theirs)).toBe(12000);
  });
});
