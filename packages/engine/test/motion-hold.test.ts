// A espera da animação (`motionHoldMs`): o tempo que a mesa leva animando uma jogada, só pelo estado.
// O servidor usa isto para não cobrar a animação do relógio de quem joga online (room.ts, `commit`).
// Os tempos acompanham o plano da animação da mesa (apps/web/src/components/Motion.tsx).

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/engine';
import { MOTION_SPOT_MS, motionHoldMs } from '../src/motion';
import { newGame, noDefense, started, toTurn } from './helpers';

describe('motionHoldMs', () => {
  it('nada se move: nada a esperar', () => {
    const s = newGame(1, 0);
    // Escolher jogar primeiro e um mulligan sem troca não mexem em carta nenhuma.
    const a = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
    expect(motionHoldMs(s, a, { type: 'mulligan', player: 0, redraw: false })).toBe(0);
    // Desfazer (o estado volta) só troca a mesa.
    expect(motionHoldMs(a, s)).toBe(0);
  });

  it('as cartas da mão trocadas no mulligan voam uma após a outra', () => {
    const s = newGame(1, 0);
    const act = { type: 'mulligan' as const, player: 0 as const, redraw: true };
    const a = applyAction(s, act);
    // As cartas que saíram da mão voltam ao deck (grupo 1) e as novas saem dele (grupo 2), uma a cada 55 ms,
    // com 80 ms entre os grupos, 340 ms de voo e 60 ms de folga. (Uma carta embaralhada de volta à mão não se move.)
    const n = a.players[0].hand.filter((u) => !s.players[0].hand.includes(u)).length;
    expect(n).toBeGreaterThan(0);
    expect(motionHoldMs(s, a, act)).toBe(n * 55 + 80 + (n - 1) * 55 + 340 + 60);
    // Mais lento, tudo cresce junto (menos a folga).
    expect(motionHoldMs(s, a, act, 2)).toBe((n * 55 + 80 + (n - 1) * 55 + 340) * 2 + 60);
  });

  it('o começo do turno espera a Vida, a compra e os DON!!', () => {
    const s = started();
    const act = { type: 'endTurn' as const, player: 0 as const };
    const a = applyAction(s, act);
    // O jogador 1 compra 1 carta e recebe 2 DON!!.
    const hold = motionHoldMs(s, a, act);
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(1500);
  });

  it('jogar um Personagem passa pela vitrine', () => {
    let s = toTurn(started(), 3);
    const p = s.activePlayer;
    const hand = s.players[p].hand;
    const uid = hand.find((u) => {
      try {
        applyAction(s, { type: 'playCard', player: p, uid: u });
        return true;
      } catch {
        return false;
      }
    });
    expect(uid).toBeDefined();
    const act = { type: 'playCard' as const, player: p, uid: uid! };
    const a = applyAction(s, act);
    // A vitrine (750 ms) mais os DON!! pagos; nunca menos que a vitrine com a folga.
    expect(motionHoldMs(s, a, act)).toBeGreaterThanOrEqual(750 + 60);
  });

  it('um ataque que acerta para no centro da mesa', () => {
    let s = toTurn(started(), 3);
    const p = s.activePlayer;
    const o = (1 - p) as 0 | 1;
    s = applyAction(s, { type: 'attack', player: p, attacker: s.players[p].leader.uid, target: s.players[o].leader.uid });
    const before = s;
    const after = noDefense(s);
    expect(after.players[o].life.length).toBe(before.players[o].life.length - 1);
    // Entre o último "não" da defesa e o dano: a parada do ataque, e a carta da Vida voando para a mão depois dela.
    const spot = MOTION_SPOT_MS.attack;
    const total = spot.flyIn + spot.hold + spot.back;
    let prev = before;
    let hold = 0;
    for (let guard = 0; guard < 5 && prev.players[o].life.length === before.players[o].life.length; guard++) {
      const next = noDefense1(prev);
      hold = motionHoldMs(prev, next);
      prev = next;
    }
    expect(hold).toBeGreaterThanOrEqual(total + 200 + 60);
  });
});

/** Um passo só da defesa (sem bloquear, sem Counter, sem ativar a carta da Vida). */
function noDefense1(s: ReturnType<typeof started>) {
  const p = s.pending;
  if (p?.kind === 'block') return applyAction(s, { type: 'choose', player: p.player, uids: [] });
  if (p?.kind === 'counter') return applyAction(s, { type: 'pass', player: p.player });
  if (p?.kind === 'lifeCard') return applyAction(s, { type: 'answer', player: p.player, yes: false });
  return s;
}
