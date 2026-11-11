// O valor do [Counter] de um Evento da mão (`eventCounterPower`), que a etapa de Counter mostra na carta ao
// lado do Counter dos Personagens: o poder que o efeito dá agora a uma carta do dono, ou o que tira do oponente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, counterValue, createGame, eventCounterPower } from '../src/engine';
import type { CardData, DeckList, GameState } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards as baseCards, fetchToHand, luffy } from './helpers';

const op01 = JSON.parse(readFileSync(join(__dirname, '../../../data/cards/op01.json'), 'utf8')).cards as CardData[];
const extra = op01.filter((c) => ['OP01-026', 'OP01-028', 'OP01-029', 'OP01-089'].includes(c.id));

const cards = [...baseCards, ...extra];
// O deck do Luffy (ST01) com uma cópia de cada Evento do teste no lugar de quatro cópias de uma carta dele.
const swap = luffy.cards.find((c) => c.count >= 4)!;
const deck: DeckList = {
  ...luffy,
  cards: [...luffy.cards.map((c) => (c === swap ? { ...c, count: c.count - extra.length } : c)).filter((c) => c.count > 0), ...extra.map((c) => ({ id: c.id, count: 1 }))],
};

function game(): GameState {
  let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'A', deck }, { name: 'B', deck }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Partida no turno 1 com `cardId` na mão do jogador 0. */
function withInHand(cardId: string): { s: GameState; uid: string } {
  const s = game();
  return { s, uid: fetchToHand(s, 0, cardId) };
}

describe('valor do [Counter] de um Evento', () => {
  it('poder que o Evento dá a uma carta do dono', () => {
    // "Up to 1 of your Leader or Character cards gains +3000 power during this battle."
    expect(eventCounterPower(...args(withInHand('ST01-014')))).toBe(3000);
    // "… gains +4000 power during this battle. Then, K.O. up to 1 of your opponent's Characters …"
    expect(eventCounterPower(...args(withInHand('OP01-026')))).toBe(4000);
  });

  it('bônus com condição só entra quando a condição vale agora', () => {
    // "… gains +2000 power during this battle. Then, if you have 2 or less Life cards, that card gains an additional +2000 power."
    const { s, uid } = withInHand('OP01-029');
    expect(s.players[0].life.length).toBeGreaterThan(2);
    expect(eventCounterPower(s, uid)).toBe(2000);
    s.players[0].deck.push(...s.players[0].life.splice(2));
    expect(eventCounterPower(s, uid)).toBe(4000);
  });

  it('Evento que tira poder do oponente: o valor negativo', () => {
    // "Give up to 1 of your opponent's Leader or Character cards -2000 power during this turn."
    expect(eventCounterPower(...args(withInHand('OP01-028')))).toBe(-2000);
  });

  it('0 quando o efeito não é de poder ou a carta não é um Evento [Counter]', () => {
    // "If your Leader has the {The Seven Warlords of the Sea} type, return up to 1 Character … to the owner's hand."
    expect(eventCounterPower(...args(withInHand('OP01-089')))).toBe(0);
    // Personagem com Counter impresso: o valor dele é o de `counterValue`.
    const s = game();
    const all = Object.keys(s.cards).filter((u) => s.cards[u].owner === 0);
    const char = all.find((u) => counterValue(s, u) > 0)!;
    expect(eventCounterPower(s, char)).toBe(0);
    // Evento [Main], sem [Counter].
    const main = all.find((u) => s.defs[s.cards[u].cardId].category === 'event' && !s.defs[s.cards[u].cardId].abilities.some((a) => a.timing === 'counter'))!;
    expect(main).toBeDefined();
    expect(eventCounterPower(s, main)).toBe(0);
  });

  it('vale igual na visão do dono da carta (online)', () => {
    const { s, uid } = withInHand('ST01-014');
    let n = 0;
    const aliases = createAliases(s, () => `a${++n}`);
    expect(eventCounterPower(viewFor(s, 0, aliases), aliases.toAlias[uid])).toBe(3000);
  });
});

function args({ s, uid }: { s: GameState; uid: string }): [GameState, string] {
  return [s, uid];
}
