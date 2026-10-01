import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPower } from '../src/engine';
import type { DeckList, GameState } from '../src/types';
import { cards, fetchToHand, luffyBlack, putOnField, started, toTurn, yamato } from './helpers';

// ST10 não tem deck pronto: decks de teste com as cartas do ST10 (Kid roxo x Law).
function game10(): GameState {
  const ids = ['ST10-007', 'ST10-011', 'ST10-014', 'ST10-006', 'ST10-013', 'ST10-005', 'ST10-009', 'ST10-008', 'ST10-012', 'ST10-004', 'ST10-015', 'ST10-016', 'ST10-017'];
  const deck = (leader: string): DeckList => ({
    id: leader,
    name: leader,
    leader,
    cards: ids.map((id, i) => ({ id, count: i < 11 ? 4 : 3 })),
  });
  let s = createGame({ seed: 4, firstPlayer: 0, cards, players: [{ name: 'Kid', deck: deck('ST10-003') }, { name: 'Law', deck: deck('ST10-001') }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}

describe('reações a acontecimentos ("When …")', () => {
  it('DON!! devolvido: Killer nocauteia, Heat ganha +2000 até o seu próximo turno, Wire compra e descarta', () => {
    let s = toTurn(game10(), 5);
    const killer = putOnField(s, 0, 'ST10-007');
    const heat = putOnField(s, 0, 'ST10-011');
    const wire = putOnField(s, 0, 'ST10-014');
    const target = putOnField(s, 1, 'ST10-005', { rested: true }); // custo 2, virado
    const heatPower = getPower(s, heat);
    const hand = s.players[0].hand.length;
    // Kid (líder) ao atacar: DON!! −1 → dispara as três reações.
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm' });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    // Resolve as escolhas que aparecerem (alvo do Killer, descarte do Wire).
    for (let i = 0; i < 6 && s.pending; i++) {
      const p = s.pending;
      if (p.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: p.player, uids: p.options.includes(target) ? [target] : p.options.slice(0, p.min || 1) });
      else if (p.kind === 'trigger') s = applyAction(s, { type: 'answer', player: p.player, yes: false });
      else break;
    }
    expect(s.players[1].trash).toContain(target);
    expect(getPower(s, heat)).toBe(heatPower + 2000);
    expect(s.players[0].hand.length).toBe(hand); // +1 −1 (Wire)
    void killer;
    void wire;
    // +2000 dura até o início do próximo turno do Kid.
    s = toTurn(s, 6);
    expect(getPower(s, heat)).toBe(heatPower + 2000);
    s = toTurn(s, 7);
    expect(getPower(s, heat)).toBe(heatPower);
  });

  it('Luffy (ST10-006): quando o oponente usa [Blocker], nocauteia um personagem de 8000 ou menos', () => {
    let s = toTurn(game10(), 5);
    const luffy = putOnField(s, 0, 'ST10-006', { turn: 1 });
    // O Law (jogador 1) recebe um bloqueador: Wire (ST10-014) tem [Blocker].
    const blocker = putOnField(s, 1, 'ST10-014');
    const victim = putOnField(s, 1, 'ST10-005');
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'block' });
    s = applyAction(s, { type: 'choose', player: 1, uids: [blocker] });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [victim] });
    expect(s.players[1].trash).toContain(victim);
  });

  it('Luffy (ST08-001): quando um personagem é nocauteado no seu turno, recebe 1 DON!! virado', () => {
    let g = toTurn(started(1, [luffyBlack, yamato]), 5);
    const pistol = fetchToHand(g, 0, 'ST08-015'); // K.O. de custo 2 ou menos
    const victim = putOnField(g, 1, 'ST09-002'); // Uzuki Tempura, custo 4 → −4 de custo
    g.modifiers.push({ uid: victim, kind: 'cost', amount: -4, duration: 'turn' });
    g = applyAction(g, { type: 'playCard', player: 0, uid: pistol });
    g = applyAction(g, { type: 'choose', player: 0, uids: [victim] });
    expect(g.players[1].trash).toContain(victim);
    expect(g.players[0].leader.don).toBe(1);
  });
});
