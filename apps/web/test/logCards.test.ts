// Histórico: o nome de carta numa linha abre a carta de que a linha fala, e não uma homônima.
// Relato de jogador: contra um deck de Boa Hancock, o oponente usou a Personagem Boa Hancock de Counter e o
// histórico abriu a Líder (mesmo nome).
import { applyAction, type CardData, createAliases, createGame, type DeckList, type GameState, viewFor } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { logCardNames, resolveLogCard } from '../src/game/logCards';

const leader: CardData = { id: 'HM-L', name: 'Boa Hancock', category: 'leader', colors: ['blue'], life: 5, power: 5000, types: [], text: '' };
const twin: CardData = { id: 'HM-C', name: 'Boa Hancock', category: 'character', colors: ['blue'], cost: 1, power: 2000, counter: 2000, types: [], text: '' };
const deck: DeckList = { id: 'hm', name: 'hm', leader: 'HM-L', cards: [{ id: 'HM-C', count: 50 }] };

/** Turno 3: o jogador 0 joga a Personagem, ataca a Líder do jogador 1, que usa a Personagem de Counter. */
function countered(): GameState {
  let s = createGame({ seed: 5, firstPlayer: 0, cards: [leader, twin], players: [{ name: 'A', deck }, { name: 'B', deck }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  while (s.turn < 3) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  s = applyAction(s, { type: 'playCard', player: 0, uid: s.players[0].hand[0] });
  s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
  if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
  return applyAction(s, { type: 'counter', player: 1, uid: s.players[1].hand[0] });
}

const line = (s: GameState, key: string) => s.log.find((e) => e.key === key)!;

describe('cartas citadas no histórico', () => {
  it('Counter com a Personagem de mesmo nome da Líder: cada nome da linha abre a sua carta', () => {
    const s = countered();
    const names = logCardNames(s.defs);
    expect(names.byName.get('Boa Hancock')).toEqual(['HM-L', 'HM-C']);
    // "Counter: Boa Hancock dá +2000 a Boa Hancock."
    const counter = line(s, 'log.counter');
    expect(resolveLogCard(s, names, counter, 'Boa Hancock', 0)?.id).toBe('HM-C');
    expect(resolveLogCard(s, names, counter, 'Boa Hancock', 1)?.id).toBe('HM-L');
    // "A joga Boa Hancock." e "Boa Hancock (5000) ataca Boa Hancock (5000)."
    expect(resolveLogCard(s, names, line(s, 'log.plays'), 'Boa Hancock', 0)?.category).toBe('character');
    const attack = line(s, 'log.attacks');
    expect([0, 1].map((nth) => resolveLogCard(s, names, attack, 'Boa Hancock', nth)?.category)).toEqual(['leader', 'leader']);
  });

  it('vale igual na visão de cada jogador (online) e de quem assiste', () => {
    const s = countered();
    let n = 0;
    const aliases = createAliases(s, () => `a${++n}`);
    for (const viewer of [0, 1, null] as const) {
      const view = viewFor(s, viewer, aliases);
      const counter = line(view, 'log.counter');
      expect(resolveLogCard(view, logCardNames(view.defs), counter, 'Boa Hancock', 0)?.id).toBe('HM-C');
      expect(resolveLogCard(view, logCardNames(view.defs), counter, 'Boa Hancock', 1)?.id).toBe('HM-L');
    }
  });

  it('linha antiga (sem as cartas): continua o palpite pela mesa, que prefere a Líder', () => {
    const s = countered();
    const { cards: _cards, ...old } = line(s, 'log.counter');
    expect(resolveLogCard(s, logCardNames(s.defs), old, 'Boa Hancock', 0)?.id).toBe('HM-L');
    expect(resolveLogCard(s, logCardNames(s.defs), old, 'Nome que não existe', 0)).toBeNull();
  });
});
