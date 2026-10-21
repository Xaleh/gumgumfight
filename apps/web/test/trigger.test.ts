import { type Action, applyAction, type CardData, createAliases, createGame, type DeckList, type GameState, type PlayerId, viewFor } from '@gumgum/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshTrigger } from '../src/game/trigger';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = ['st01', 'st02'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
const luffy: DeckList = load('decks/st01-luffy.json');
const kid: DeckList = load('decks/st02-kid.json');

/** Turno 3 (Luffy ataca), com `cardId` no topo da Vida do Kid e a mão dele vazia (sem Counter). */
function lifeTop(cardId: string): { s: GameState; uid: string } {
  let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'Luffy', deck: luffy }, { name: 'Kid', deck: kid }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  while (s.turn < 3) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  const ps = s.players[1];
  const zone = [ps.deck, ps.life, ps.hand].find((z) => z.some((u) => s.cards[u].cardId === cardId))!;
  const uid = zone.splice(zone.findIndex((u) => s.cards[u].cardId === cardId), 1)[0];
  ps.hand = [];
  ps.life.push(uid);
  return { s, uid };
}

/** Os estados até a pergunta da carta de Vida e o seguinte, depois da resposta. */
function reveal(cardId: string, yes = true) {
  const { s: start, uid } = lifeTop(cardId);
  const act = (s: GameState, a: Action) => applyAction(s, a);
  let s = act(start, { type: 'attack', player: 0, attacker: start.players[0].leader.uid, target: start.players[1].leader.uid });
  if (s.pending?.kind === 'counter') s = act(s, { type: 'pass', player: 1 });
  expect(s.pending).toMatchObject({ kind: 'lifeCard', player: 1, card: uid });
  return { prev: s, next: act(s, { type: 'answer', player: 1, yes }), uid };
}

describe('[Trigger] revelado da Vida', () => {
  it('o [Trigger] que resolve sozinho: a carta já está no descarte', () => {
    const { prev, next, uid } = reveal('ST02-015'); // Scalpel: desvira 2 DON!!
    expect(next.stack.some((f) => f.kind === 'effect' && f.trigger)).toBe(false);
    expect(freshTrigger(prev, next)).toEqual({ player: 1, uid });
    expect(next.players[1].trash).toContain(uid);
  });

  it('"Play this card": a carta vai para o campo', () => {
    const { prev, next, uid } = reveal('ST02-005'); // Killer
    expect(freshTrigger(prev, next)).toEqual({ player: 1, uid });
    expect(next.players[1].characters.map((c) => c.uid)).toContain(uid);
  });

  it('colocar a carta na mão não é [Trigger]', () => {
    const { prev, next } = reveal('ST02-015', false);
    expect(freshTrigger(prev, next)).toBeNull();
  });

  it('na visão online do atacante a carta aparece (a Vida do oponente é oculta)', () => {
    const { prev, next } = reveal('ST02-015');
    const aliases = createAliases(prev, (() => {
      let n = 0;
      return () => `a${n++}`;
    })());
    const view = (st: GameState, p: PlayerId) => viewFor(st, p, aliases);
    const hit = freshTrigger(view(prev, 0), view(next, 0));
    expect(hit?.player).toBe(1);
    expect(hit?.uid).toBeTruthy();
    expect(view(next, 0).players[1].trash).toContain(hit!.uid);
  });
});
