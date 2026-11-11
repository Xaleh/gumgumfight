// Chaves de tradução do histórico (`LogEntry.key`): toda linha do motor traz a chave ao lado do
// texto em português, e a linha secreta não vaza a carta pela chave nem pelos parâmetros.

import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import type { CardData, DeckList } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards, started, toTurn } from './helpers';

let seq = 0;
const aliases = (s: Parameters<typeof createAliases>[0]) => createAliases(s, () => `a${++seq}`);

describe('chaves do histórico', () => {
  it('toda linha tem chave log.* e o texto em português de sempre', () => {
    const s = started();
    expect(s.log.length).toBeGreaterThan(0);
    for (const e of s.log) {
      expect(e.key).toMatch(/^log\./);
      expect(e.text.length).toBeGreaterThan(0);
    }
    expect(s.log.find((e) => e.key === 'log.turnStart')).toMatchObject({ params: { n: 1 } });
  });

  it('linha secreta: o dono recebe a chave secreta; o oponente, só a pública', () => {
    let s = started();
    const p = s.activePlayer;
    const uid = s.players[p].hand[0];
    const name = s.defs[s.cards[uid].cardId].name;
    // Da mão para o topo do deck (manual): o oponente só fica sabendo que "uma carta" se moveu.
    s = applyAction(s, { type: 'manual', player: p, op: { op: 'move', uid, to: 'deckTop' } });
    const raw = s.log[s.log.length - 1];
    const cardId = s.cards[uid].cardId;
    expect(raw).toMatchObject({ key: 'log.manualMoveFromHand', secretKey: 'log.manualMove', secretParams: { card: name }, secretCards: [cardId] });
    expect(raw.cards).toBeUndefined();

    const mine = viewFor(s, p, aliases(s)).log.at(-1)!;
    expect(mine).toMatchObject({ text: raw.secret, key: 'log.manualMove', params: { card: name }, cards: [cardId] });
    expect(mine).not.toHaveProperty('secretCards');

    for (const viewer of [p === 0 ? 1 : 0, null] as const) {
      const theirs = viewFor(s, viewer, aliases(s)).log.at(-1)!;
      expect(theirs.key).toBe('log.manualMoveFromHand');
      expect(JSON.stringify(theirs)).not.toContain(name);
      expect(theirs).not.toHaveProperty('secretKey');
      expect(theirs).not.toHaveProperty('secretParams');
      expect(theirs).not.toHaveProperty('secretCards');
      expect(theirs.cards).toBeUndefined();
    }
  });

  // Relato de jogador: contra um deck de Boa Hancock, o Counter com a Personagem Boa Hancock abria a Líder no
  // histórico (mesmo nome). A linha diz de qual carta se trata, e não só o nome.
  it('linha que cita cartas de mesmo nome diz qual é cada uma (Líder e Personagem homônimos)', () => {
    const leader: CardData = { id: 'HM-L', name: 'Boa Hancock', category: 'leader', colors: ['blue'], life: 5, power: 5000, types: [], text: '' };
    const twin: CardData = { id: 'HM-C', name: 'Boa Hancock', category: 'character', colors: ['blue'], cost: 1, power: 2000, counter: 2000, types: [], text: '' };
    const deck: DeckList = { id: 'hm', name: 'hm', leader: 'HM-L', cards: [{ id: 'HM-C', count: 50 }] };
    let s = createGame({
      seed: 5,
      firstPlayer: 0,
      cards: [...cards, leader, twin],
      players: [
        { name: 'A', deck },
        { name: 'B', deck },
      ],
    });
    s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
    s = toTurn(s, 3);
    s = applyAction(s, { type: 'playCard', player: 0, uid: s.players[0].hand[0] });
    expect(s.log.find((e) => e.key === 'log.plays')).toMatchObject({ params: { card: 'Boa Hancock' }, cards: ['HM-C'] });

    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.log.at(-1)).toMatchObject({ key: 'log.attacks', cards: ['HM-L', 'HM-L'] });
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    s = applyAction(s, { type: 'counter', player: 1, uid: s.players[1].hand[0] });
    // "Counter: Boa Hancock dá +2000 a Boa Hancock.": a primeira é a Personagem da mão; a segunda, a Líder.
    expect(s.log.at(-1)).toMatchObject({ key: 'log.counter', params: { card: 'Boa Hancock', target: 'Boa Hancock' }, cards: ['HM-C', 'HM-L'] });
    // O oponente recebe a mesma linha, com as duas cartas.
    expect(viewFor(s, 0, aliases(s)).log.at(-1)!.cards).toEqual(['HM-C', 'HM-L']);
  });

  it('motivo da vitória com chave e parâmetros', () => {
    let s = started();
    const p = s.activePlayer;
    s = applyAction(s, { type: 'concede', player: p });
    expect(s.winReasonKey).toBe('log.winConcede');
    expect(s.winReasonParams).toEqual({ player: s.players[p].name });
    expect(s.log.at(-1)).toMatchObject({ key: 'log.gameOverWin', parts: { reason: { items: [{ key: 'log.winConcede' }] } } });
  });
});
