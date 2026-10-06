// Vazamento de informação: etapas que antes eram puladas automaticamente (Counter sem
// carta na mão, carta de Vida sem [Trigger]) contavam ao oponente o que o jogador tinha.
// Hoje elas abrem sempre, e a visão do oponente é a mesma nos dois casos.

import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, createGame } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, GameState, PlayerId } from '../src/types';
import { createAliases, HIDDEN_REF, viewFor } from '../src/view';
import { cards, fetchToHand, kid, luffy, started, toTurn } from './helpers';

let n = 0;
const aliasesFor = (s: GameState) => createAliases(s, () => `k${(++n * 7919).toString(36)}x`);

/** O que o jogador `viewer` vê da decisão pendente e do log a partir da linha `from`. */
function seenBy(s: GameState, viewer: PlayerId | null, from = 0) {
  const view = viewFor(s, viewer, aliasesFor(s));
  return { pending: view.pending, log: view.log.slice(from).map((e) => e.text) };
}

const attackLeader = (s: GameState, player: PlayerId) =>
  applyAction(s, { type: 'attack', player, attacker: s.players[player].leader.uid, target: s.players[1 - player as PlayerId].leader.uid });

/** Turno 3 do Luffy (jogador 0) atacando o Kid (jogador 1), sem [Trigger] no topo da Vida do Kid. */
function ready(seed = 1) {
  const s = toTurn(started(seed), 3);
  const ps = s.players[1];
  ps.life = ps.life.filter((u) => !s.defs[s.cards[u].cardId].abilities.some((a) => a.timing === 'trigger'));
  return s;
}

describe('etapa de Counter sempre acontece', () => {
  it('sem Counter na mão a etapa abre com opções vazias e só "pass" é legal', () => {
    let s = ready();
    s.players[1].hand = [];
    s = attackLeader(s, 0);
    expect(s.pending).toEqual({ kind: 'counter', player: 1, options: [] });
    expect(legalActions(s, 1)).toEqual([{ type: 'pass', player: 1 }]);
    expect(() => applyAction(s, { type: 'counter', player: 1, uid: s.players[1].leader.uid })).toThrow();
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.pending?.kind).toBe('lifeCard');
  });

  it('o ataque que já falha também abre a etapa (pular contaria algo ao atacante)', () => {
    let s = ready();
    s.players[1].hand = [];
    s.modifiers.push({ uid: s.players[1].leader.uid, kind: 'power', amount: 5000, duration: 'turn' });
    const life = s.players[1].life.length;
    s = attackLeader(s, 0);
    expect(s.pending).toMatchObject({ kind: 'counter', player: 1, options: [] });
    s = applyAction(s, { type: 'pass', player: 1 });
    expect(s.battle).toBeNull();
    expect(s.players[1].life).toHaveLength(life);
  });

  it('para o atacante e o espectador, "sem Counter" e "com Counter, mas passou" são iguais', () => {
    // Caso A: mão vazia.
    let a = ready();
    a.players[1].hand = [];
    const logA = a.log.length;
    a = attackLeader(a, 0);
    // Caso B: um Counter na mão, que o defensor não usa.
    let b = ready();
    b.players[1].hand = [];
    const killer = fetchToHand(b, 1, 'ST02-005'); // Counter +1000
    const logB = b.log.length;
    b = attackLeader(b, 0);
    expect((b.pending as { options: string[] }).options).toEqual([killer]);

    for (const viewer of [0, null] as const) {
      const sa = seenBy(a, viewer, logA);
      const sb = seenBy(b, viewer, logB);
      expect(sa.pending).toEqual({ kind: 'counter', player: 1, options: [] });
      expect(sb.pending).toEqual(sa.pending);
      expect(sb.log).toEqual(sa.log);
    }
    // Depois do "pass", o log e a decisão seguinte também não distinguem os casos.
    a = applyAction(a, { type: 'pass', player: 1 });
    b = applyAction(b, { type: 'pass', player: 1 });
    for (const viewer of [0, null] as const) {
      expect(seenBy(b, viewer, logB)).toEqual(seenBy(a, viewer, logA));
    }
  });
});

describe('a carta de Vida sempre passa pelo dono', () => {
  /** Dano no Kid com `cardId` no topo da Vida; devolve o estado já na decisão da carta de Vida. */
  function hit(cardId: string) {
    let s = ready();
    s.players[1].hand = [];
    const top = fetchToHand(s, 1, cardId);
    s.players[1].hand = [];
    s.players[1].life.push(top);
    const log = s.log.length;
    s = applyAction(attackLeader(s, 0), { type: 'pass', player: 1 });
    expect(s.pending).toEqual({ kind: 'lifeCard', player: 1, card: top });
    return { s, top, log };
  }

  it('sem [Trigger]: só "colocar na mão" é legal; ativar é recusado', () => {
    const { s, top } = hit('ST02-003'); // Personagem sem [Trigger]
    expect(legalActions(s, 1)).toEqual([{ type: 'answer', player: 1, yes: false }]);
    expect(() => applyAction(s, { type: 'answer', player: 1, yes: true })).toThrow(/não tem \[Trigger\]/);
    const t = applyAction(s, { type: 'answer', player: 1, yes: false });
    expect(t.players[1].hand).toEqual([top]);
    expect(t.pending).toBeNull();
    expect(t.battle).toBeNull();
  });

  it('com [Trigger]: as duas respostas são legais', () => {
    const { s } = hit('ST02-015'); // Scalpel: [Trigger]
    expect(legalActions(s, 1)).toEqual([
      { type: 'answer', player: 1, yes: true },
      { type: 'answer', player: 1, yes: false },
    ]);
  });

  it('para o oponente e o espectador, "sem [Trigger]" e "com [Trigger] recusado" são iguais', () => {
    const a = hit('ST02-003');
    const b = hit('ST02-015');
    for (const viewer of [0, null] as const) {
      const sa = seenBy(a.s, viewer, a.log);
      const sb = seenBy(b.s, viewer, b.log);
      expect(sa.pending).toEqual({ kind: 'lifeCard', player: 1, card: HIDDEN_REF });
      expect(sb.pending).toEqual(sa.pending);
      expect(sb.log).toEqual(sa.log);
    }
    const ta = applyAction(a.s, { type: 'answer', player: 1, yes: false });
    const tb = applyAction(b.s, { type: 'answer', player: 1, yes: false });
    for (const viewer of [0, null] as const) {
      const sa = seenBy(ta, viewer, a.log);
      const sb = seenBy(tb, viewer, b.log);
      expect(sb.log).toEqual(sa.log);
      expect(sa.log.join('\n')).not.toMatch(/Trigger|Scalpel/);
    }
    // O dono lê qual carta foi para a mão.
    expect(seenBy(tb, 1, b.log).log.join('\n')).toContain('Scalpel');
    expect(seenBy(ta, 1, a.log).log.join('\n')).not.toContain('Scalpel');
  });

  it('o dono vê a carta na decisão; o oponente não', () => {
    const { s, top } = hit('ST02-015');
    const aliases = aliasesFor(s);
    const mine = viewFor(s, 1, aliases);
    const theirs = viewFor(s, 0, aliases);
    expect(mine.pending).toEqual({ kind: 'lifeCard', player: 1, card: aliases.toAlias[top] });
    expect(mine.defs['ST02-015']).toBeDefined();
    expect(theirs.pending).toEqual({ kind: 'lifeCard', player: 1, card: HIDDEN_REF });
    expect(theirs.defs['ST02-015']).toBeUndefined();
  });

  it('[Trigger] ativado continua no log público (a carta é revelada)', () => {
    const { s, log } = hit('ST02-015');
    const t = applyAction(s, { type: 'answer', player: 1, yes: true });
    expect(seenBy(t, 0, log).log.join('\n')).toContain('[Trigger] Scalpel ativado!');
  });

  it('o bot ativa o [Trigger] quando há um e só coloca na mão quando não há', () => {
    const a = hit('ST02-003');
    expect(chooseBotAction(a.s, 1)).toEqual({ type: 'answer', player: 1, yes: false });
    const b = hit('ST02-015');
    expect(chooseBotAction(b.s, 1)).toEqual({ type: 'answer', player: 1, yes: true });
  });
});

describe('replays da versão 1', () => {
  it('ganham as respostas implícitas (pass no Counter vazio, carta de Vida sem [Trigger] para a mão)', () => {
    const config = {
      seed: 7,
      firstPlayer: 0 as PlayerId,
      cards,
      players: [
        { name: 'Luffy', deck: luffy },
        { name: 'Kid', deck: kid },
      ] as [{ name: string; deck: typeof luffy }, { name: string; deck: typeof kid }],
    };
    // Partida bot x bot de hoje: todas as ações. O roteiro "antigo" é o mesmo sem as ações
    // que o motor de então não pedia.
    let s = createGame(config);
    const modern: Action[] = [];
    const old: Action[] = [];
    for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
      const p = s.pending;
      const player = p ? p.player : s.activePlayer;
      const a = chooseBotAction(s, player);
      modern.push(a);
      const implicit =
        (p?.kind === 'counter' && !p.options.length) ||
        (p?.kind === 'lifeCard' && !s.defs[s.cards[p.card].cardId].abilities.some((ab) => ab.timing === 'trigger'));
      if (!implicit) old.push(a);
      s = applyAction(s, a);
    }
    expect(s.phase).toBe('gameover');
    expect(old.length).toBeLessThan(modern.length);
    expect(upgradeReplayActions(config, old)).toEqual(modern);
    // Um roteiro já na versão nova não muda.
    expect(upgradeReplayActions(config, modern)).toEqual(modern);
  });
});
