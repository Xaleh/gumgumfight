import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/actions';
import { applyAction, cancelAllowed, cancelError, detachDonError, IllegalActionError, locate } from '../src/engine';
import type { Action, GameState } from '../src/types';
import { actionFromView, createAliases, viewFor } from '../src/view';
import { countDon, fetchToHand, noDefense, putOnField, started, toTurn } from './helpers';

const has = (s: GameState, player: 0 | 1, pred: (a: Action) => boolean) => legalActions(s, player).some(pred);

/** O que o `cancel` precisa restaurar (tudo menos o log, o contador de ações e o próprio registro do cancelamento). */
function core(s: GameState) {
  const { log: _l, actionCount: _n, cancel: _c, checkpoint: _k, defs: _d, ...rest } = s;
  return rest;
}

describe('devolver DON!! anexado (detachDon)', () => {
  it('DON!! anexado neste turno e ainda não usado volta ativo para a área de custo', () => {
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    expect(has(s, 0, (a) => a.type === 'detachDon')).toBe(false);
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    expect(s.players[0].leader).toMatchObject({ don: 2, donLoose: 2 });
    expect(s.players[0].donActive).toBe(1);
    expect(has(s, 0, (a) => a.type === 'detachDon' && a.target === leader)).toBe(true);

    s = applyAction(s, { type: 'detachDon', player: 0, target: leader });
    expect(s.players[0].leader).toMatchObject({ don: 1, donLoose: 1 });
    expect(s.players[0].donActive).toBe(2);
    expect(s.log[s.log.length - 1].text).toMatch(/devolve 1 DON!!/);
    s = applyAction(s, { type: 'detachDon', player: 0, target: leader });
    expect(s.players[0].leader.don).toBe(0);
    expect(s.players[0].leader.donLoose).toBeUndefined();
    expect(s.players[0].donActive).toBe(3);
    expect(countDon(s, 0)).toBe(10);
    expect(() => applyAction(s, { type: 'detachDon', player: 0, target: leader })).toThrow(/não tem DON!!/);
  });

  it('depois de atacar com a carta, o DON!! fica até a Renovação', () => {
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: leader, target: s.players[1].leader.uid }));
    expect(s.players[0].leader.don).toBe(1);
    expect(s.players[0].leader.donLoose).toBeUndefined();
    expect(detachDonError(s, 0, leader)).toMatch(/já foi usado/);
    expect(() => applyAction(s, { type: 'detachDon', player: 0, target: leader })).toThrow(IllegalActionError);
    expect(has(s, 0, (a) => a.type === 'detachDon')).toBe(false);
  });

  it('qualquer outra ação (jogar carta, ativar habilidade) prende os DON!! soltos de todas as cartas', () => {
    let s = toTurn(started(), 5);
    const leader = s.players[0].leader.uid;
    const nami = putOnField(s, 0, 'ST01-007');
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    s = applyAction(s, { type: 'attachDon', player: 0, target: nami });
    expect(s.players[0].leader.donLoose).toBe(1);
    expect(locate(s, nami)!.fc.donLoose).toBe(1);
    // Jogar uma carta (custo 1) pode ter contado com os DON!! em campo.
    const usopp = fetchToHand(s, 0, 'ST01-002');
    s = applyAction(s, { type: 'playCard', player: 0, uid: usopp });
    expect(s.players[0].leader.donLoose).toBeUndefined();
    expect(locate(s, nami)!.fc.donLoose).toBeUndefined();
    expect(has(s, 0, (a) => a.type === 'detachDon')).toBe(false);
  });

  it('só no próprio turno, com a mesa parada', () => {
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    expect(detachDonError(s, 1, leader)).toMatch(/agora/);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    // O fim do turno prende o DON!!; no turno do oponente nada volta.
    expect(s.players[0].leader).toMatchObject({ don: 1 });
    expect(s.players[0].leader.donLoose).toBeUndefined();
    expect(() => applyAction(s, { type: 'detachDon', player: 0, target: leader })).toThrow(/turno/);
    expect(has(s, 1, (a) => a.type === 'detachDon')).toBe(false);
  });

  it('as ferramentas manuais também prendem os DON!! soltos', () => {
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    s = applyAction(s, { type: 'manual', player: 0, op: { op: 'shuffle' } });
    expect(s.players[0].leader.donLoose).toBeUndefined();
  });
});

describe('cancelar a ação em andamento (cancel)', () => {
  it('habilidade ativada que pede um alvo na mesa: cancelar volta ao estado de antes', () => {
    let s = toTurn(started(), 3);
    const karoo = fetchToHand(s, 0, 'ST01-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: karoo });
    const before = s;
    expect(cancelAllowed(before, 0)).toBe(false);
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect(s.usedThisTurn).toHaveLength(1);
    expect(s.cancel).toMatchObject({ player: 0, action: { type: 'activate' } });
    expect(cancelAllowed(s, 0)).toBe(true);
    expect(cancelAllowed(s, 1)).toBe(false);
    expect(has(s, 0, (a) => a.type === 'cancel')).toBe(true);
    expect(() => applyAction(s, { type: 'cancel', player: 1 })).toThrow(/Não há ação/);

    const after = applyAction(s, { type: 'cancel', player: 0 });
    expect(core(after)).toEqual(core(before));
    expect(after.cancel).toBeUndefined();
    expect(after.checkpoint).toBeUndefined();
    expect(after.log[after.log.length - 1].text).toMatch(/cancela a ativação/);
    // A [Once Per Turn] não conta como usada: dá para ativar de novo.
    const again = applyAction(after, { type: 'activate', player: 0, uid: after.players[0].leader.uid, ability: 0 });
    expect(again.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
  });

  it('carta jogada com [On Play] que pede alvo: cancelar devolve a carta à mão e o custo', () => {
    let s = toTurn(started(), 4);
    putOnField(s, 0, 'ST01-002', { rested: true }); // alvo válido para o Killer
    const killer = fetchToHand(s, 1, 'ST02-005');
    const before = s;
    s = applyAction(s, { type: 'playCard', player: 1, uid: killer });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, intent: 'harm' });
    expect(s.players[1].hand).not.toContain(killer);
    expect(cancelAllowed(s, 1)).toBe(true);
    s = applyAction(s, { type: 'cancel', player: 1 });
    expect(core(s)).toEqual(core(before));
    expect(s.players[1].hand).toContain(killer);
    expect(s.players[1].donActive).toBe(4);
    expect(s.log[s.log.length - 1].text).toMatch(/volta para a mão/);
  });

  it('custo de ativação com escolha (descartar da mão) ainda pode ser cancelado antes do descarte', () => {
    let s = toTurn(started(), 6);
    s.players[0].hand = [];
    const leader = s.players[1].leader.uid;
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: leader, target: s.players[0].leader.uid }));
    const before = s;
    s = applyAction(s, { type: 'activate', player: 1, uid: leader, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', intent: 'discard' });
    expect(s.players[1].donRested).toBe(3);
    expect(cancelAllowed(s, 1)).toBe(true);
    s = applyAction(s, { type: 'cancel', player: 1 });
    expect(core(s)).toEqual(core(before));
    expect(s.players[1].donRested).toBe(0);
    expect(s.players[1].leader.rested).toBe(true);
  });

  it('ataque com [When Attacking] que pede alvo: cancelar desvira o atacante e solta o DON!! de novo', () => {
    let s = toTurn(started(), 3);
    const jinbe = putOnField(s, 0, 'ST01-005');
    s = applyAction(s, { type: 'attachDon', player: 0, target: jinbe });
    const before = s;
    expect(locate(s, jinbe)!.fc.donLoose).toBe(1);
    s = applyAction(s, { type: 'attack', player: 0, attacker: jinbe, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect(s.battle).not.toBeNull();
    expect(locate(s, jinbe)!.fc.rested).toBe(true);
    expect(locate(s, jinbe)!.fc.donLoose).toBeUndefined();
    s = applyAction(s, { type: 'cancel', player: 0 });
    expect(core(s)).toEqual(core(before));
    expect(s.battle).toBeNull();
    expect(locate(s, jinbe)!.fc.rested).toBe(false);
    expect(locate(s, jinbe)!.fc.donLoose).toBe(1);
    expect(s.log[s.log.length - 1].text).toMatch(/cancela o ataque/);
  });

  it('não dá para cancelar depois que uma carta escondida foi mostrada (busca no deck)', () => {
    let s = toTurn(started(), 4);
    const bonney = putOnField(s, 1, 'ST02-007');
    s = applyAction(s, { type: 'activate', player: 1, uid: bonney, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    expect(s.cancel).toMatchObject({ player: 1, blocked: 'revealed' });
    expect(s.checkpoint).toBeUndefined();
    expect(cancelError(s, 1)).toMatch(/revelada/);
    expect(has(s, 1, (a) => a.type === 'cancel')).toBe(false);
    expect(() => applyAction(s, { type: 'cancel', player: 1 })).toThrow(/revelada/);
  });

  it('a ação deixa de ser cancelável quando o oponente precisa decidir ou quando termina', () => {
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    s = applyAction(s, { type: 'attack', player: 0, attacker: leader, target: s.players[1].leader.uid });
    // Etapa de Bloqueio/Counter do oponente: o ataque já está declarado para ele.
    expect(s.pending?.player).toBe(1);
    expect(s.cancel).toBeUndefined();
    expect(cancelError(s, 0)).toMatch(/Não há ação/);
    s = noDefense(s);
    // Mesa parada: nada em andamento.
    expect(s.cancel).toBeUndefined();
    expect(s.checkpoint).toBeUndefined();
    expect(() => applyAction(s, { type: 'cancel', player: 0 })).toThrow(IllegalActionError);
  });

  it('o registro some assim que a escolha é feita e o efeito termina', () => {
    let s = toTurn(started(), 3);
    const karoo = fetchToHand(s, 0, 'ST01-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: karoo });
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].leader.uid] });
    expect(s.pending).toBeNull();
    expect(s.cancel).toBeUndefined();
    expect(s.checkpoint).toBeUndefined();
  });

  it('replay: as mesmas ações (com cancel e detachDon) dão o mesmo estado', () => {
    const script: Action[] = [
      { type: 'mulligan', player: 0, redraw: false },
      { type: 'mulligan', player: 1, redraw: false },
      { type: 'endTurn', player: 0 },
      { type: 'endTurn', player: 1 },
    ];
    let s = toTurn(started(), 3);
    const leader = s.players[0].leader.uid;
    const karoo = fetchToHand(s, 0, 'ST01-003');
    const run = (from: GameState) => {
      let g = from;
      const acts: Action[] = [
        { type: 'attachDon', player: 0, target: leader },
        { type: 'detachDon', player: 0, target: leader },
        { type: 'playCard', player: 0, uid: karoo },
        { type: 'activate', player: 0, uid: leader, ability: 0 },
        { type: 'cancel', player: 0 },
        { type: 'endTurn', player: 0 },
      ];
      for (const a of acts) g = applyAction(g, a);
      return g;
    };
    expect(script.length).toBe(4);
    const a = run(s);
    const b = run(s);
    expect(core(a)).toEqual(core(b));
    expect(a.log).toEqual(b.log);
    expect(a.turn).toBe(4);
  });

  it('visão online: a ação cancelável aparece com apelidos e sem o estado guardado', () => {
    let n = 0;
    let s = toTurn(started(), 3);
    const aliases = createAliases(s, () => `k${(++n * 7919).toString(36)}x`);
    const leader = s.players[0].leader.uid;
    const karoo = fetchToHand(s, 0, 'ST01-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: karoo });
    s = applyAction(s, { type: 'attachDon', player: 0, target: leader });
    // detachDon chega do cliente com o apelido e volta para o uid real.
    const real = actionFromView(s, aliases, { type: 'detachDon', player: 0, target: aliases.toAlias[leader] });
    expect(real).toEqual({ type: 'detachDon', player: 0, target: leader });
    expect(viewFor(s, 0, aliases).players[0].leader.donLoose).toBe(1);

    s = applyAction(s, { type: 'activate', player: 0, uid: leader, ability: 0 });
    for (const viewer of [0, 1, null] as const) {
      const view = viewFor(s, viewer, aliases);
      expect(view.checkpoint).toBeUndefined();
      expect(view.cancel).toEqual({ player: 0, action: { type: 'activate', player: 0, uid: aliases.toAlias[leader], ability: 0 } });
      expect(JSON.stringify(view)).not.toContain(`"${leader}"`);
    }
    const mine = viewFor(s, 0, aliases);
    expect(cancelAllowed(mine, 0)).toBe(true);
    expect(legalActions(mine, 0).some((a) => a.type === 'cancel')).toBe(true);
    // Uma visão não tem o estado guardado: cancelar nela é recusado com clareza (o servidor usa o estado completo).
    expect(() => applyAction(mine, { type: 'cancel', player: 0 })).toThrow(/visão/);
    const after = applyAction(s, { type: 'cancel', player: 0 });
    expect(viewFor(after, 1, aliases).cancel).toBeUndefined();
  });
});
