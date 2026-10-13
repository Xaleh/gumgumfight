// Chaves de tradução do histórico (`LogEntry.key`): toda linha do motor traz a chave ao lado do
// texto em português, e a linha secreta não vaza a carta pela chave nem pelos parâmetros.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/engine';
import { createAliases, viewFor } from '../src/view';
import { started } from './helpers';

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
    expect(raw).toMatchObject({ key: 'log.manualMoveFromHand', secretKey: 'log.manualMove', secretParams: { card: name } });

    const mine = viewFor(s, p, aliases(s)).log.at(-1)!;
    expect(mine).toMatchObject({ text: raw.secret, key: 'log.manualMove', params: { card: name } });

    for (const viewer of [p === 0 ? 1 : 0, null] as const) {
      const theirs = viewFor(s, viewer, aliases(s)).log.at(-1)!;
      expect(theirs.key).toBe('log.manualMoveFromHand');
      expect(JSON.stringify(theirs)).not.toContain(name);
      expect(theirs).not.toHaveProperty('secretKey');
      expect(theirs).not.toHaveProperty('secretParams');
    }
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
