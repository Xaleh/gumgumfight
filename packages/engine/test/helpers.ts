import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

export const cards: CardData[] = ['st01', 'st02', 'st03', 'st04'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
export const luffy: DeckList = load('decks/st01-luffy.json');
export const kid: DeckList = load('decks/st02-kid.json');
export const crocodile: DeckList = load('decks/st03-crocodile.json');
export const kaido: DeckList = load('decks/st04-kaido.json');

export function newGame(seed = 1, firstPlayer: PlayerId = 0): GameState {
  return createGame({
    seed,
    firstPlayer,
    cards,
    players: [
      { name: 'Luffy', deck: luffy },
      { name: 'Kid', deck: kid },
    ],
  });
}

/** Partida já depois dos mulligans, no turno 1 do jogador 0 (por padrão Luffy x Kid). */
export function started(seed = 1, decks?: [DeckList, DeckList]): GameState {
  let s = decks
    ? createGame({
        seed,
        firstPlayer: 0,
        cards,
        players: [
          { name: 'P0', deck: decks[0] },
          { name: 'P1', deck: decks[1] },
        ],
      })
    : newGame(seed, 0);
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  return s;
}

/** Avança até o turno indicado encerrando turnos sem fazer nada. */
export function toTurn(s: GameState, turn: number): GameState {
  while (s.turn < turn) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  return s;
}

/** Garante uma cópia de `cardId` na mão (buscando no deck ou na Vida) (mutação direta, só para testes). */
export function fetchToHand(s: GameState, player: PlayerId, cardId: string): string {
  const ps = s.players[player];
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

/** Coloca uma carta direto no campo (mutação direta, só para testes). */
export function putOnField(s: GameState, player: PlayerId, cardId: string, opts: { rested?: boolean; turn?: number } = {}): string {
  const uid = fetchToHand(s, player, cardId);
  const ps = s.players[player];
  ps.hand.splice(ps.hand.indexOf(uid), 1);
  ps.characters.push({ uid, rested: Boolean(opts.rested), don: 0, playedOnTurn: opts.turn ?? 0 });
  return uid;
}

export function countCards(s: GameState, player: PlayerId): number {
  const ps = s.players[player];
  return (
    1 + ps.characters.length + (ps.stage ? 1 : 0) + ps.hand.length + ps.deck.length + ps.trash.length + ps.life.length +
    s.stack.filter(
      (f) =>
        (f.kind === 'damage' && f.lifeCard && s.cards[f.lifeCard].owner === player) ||
        (f.kind === 'play' && s.cards[f.uid].owner === player),
    ).length
  );
}

export function countDon(s: GameState, player: PlayerId): number {
  const ps = s.players[player];
  const attached = ps.leader.don + ps.characters.reduce((a, c) => a + c.don, 0) + (ps.stage?.don ?? 0);
  return ps.donDeck + ps.donActive + ps.donRested + attached;
}
