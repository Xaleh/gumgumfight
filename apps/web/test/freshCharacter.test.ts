// No turno do oponente, o Personagem dele que entrou em campo neste turno fica apagado na mesa, porque não ataca
// nele; os com [Rush] não (ainda podem atacar).
import { applyAction, type CardData, createGame, type DeckList, type GameState, type PlayerId } from '@gumgum/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enteredWithoutRush } from '../src/game/freshCharacter';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = load('cards/st01.json').cards;
const luffy: DeckList = load('decks/st01-luffy.json');

const KAROO = 'ST01-003'; // sem texto
const LUFFY = 'ST01-012'; // [Rush]
const SANJI = 'ST01-004'; // "[DON!! x2] This Character gains [Rush]."

/** Turno 3, do jogador 0. */
function game(): GameState {
  let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'A', deck: luffy }, { name: 'B', deck: luffy }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  while (s.turn < 3) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  return s;
}

/** Põe `cardId` em campo como se tivesse entrado no turno `turn` (mutação direta, só para testes). */
function enter(s: GameState, player: PlayerId, cardId: string, turn = s.turn, don = 0): string {
  const ps = s.players[player];
  const uid = [...ps.deck, ...ps.hand, ...ps.life].find((u) => s.cards[u].cardId === cardId)!;
  for (const zone of [ps.deck, ps.hand, ps.life]) if (zone.includes(uid)) zone.splice(zone.indexOf(uid), 1);
  ps.characters.push({ uid, rested: false, don, playedOnTurn: turn });
  return uid;
}

describe('Personagem que entrou em campo neste turno', () => {
  it('sem [Rush]: não ataca neste turno', () => {
    const s = game();
    expect(enteredWithoutRush(s, enter(s, 0, KAROO))).toBe(true);
  });

  it('com [Rush], impresso ou ganho pelos DON!! anexados: pode atacar', () => {
    const s = game();
    expect(enteredWithoutRush(s, enter(s, 0, LUFFY))).toBe(false);
    // Sanji só ganha [Rush] com 2 DON!! anexados.
    const sanji = enter(s, 0, SANJI);
    expect(enteredWithoutRush(s, sanji)).toBe(true);
    s.players[0].characters.find((c) => c.uid === sanji)!.don = 2;
    expect(enteredWithoutRush(s, sanji)).toBe(false);
  });

  it('só vale para quem está jogando o turno, em pé, e só no turno em que a carta entrou', () => {
    let s = game();
    // Entrou num turno anterior.
    expect(enteredWithoutRush(s, enter(s, 0, KAROO, s.turn - 2))).toBe(false);
    // Do outro jogador (entrou no turno dele; agora é o turno do jogador 0).
    expect(enteredWithoutRush(s, enter(s, 1, KAROO, s.turn - 1))).toBe(false);
    // Líder e carta virada.
    expect(enteredWithoutRush(s, s.players[0].leader.uid)).toBe(false);
    const fresh = enter(s, 0, KAROO);
    s.players[0].characters.find((c) => c.uid === fresh)!.rested = true;
    expect(enteredWithoutRush(s, fresh)).toBe(false);

    // A carta jogada de verdade fica marcada até o fim do turno e volta ao normal no turno seguinte do dono.
    s = game();
    const ps = s.players[0];
    const karoo = [...ps.hand, ...ps.deck].find((u) => s.cards[u].cardId === KAROO)!;
    if (!ps.hand.includes(karoo)) ps.hand.push(...ps.deck.splice(ps.deck.indexOf(karoo), 1));
    s = applyAction(s, { type: 'playCard', player: 0, uid: karoo });
    expect(enteredWithoutRush(s, karoo)).toBe(true);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(enteredWithoutRush(s, karoo)).toBe(false);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(enteredWithoutRush(s, karoo)).toBe(false);
  });
});
