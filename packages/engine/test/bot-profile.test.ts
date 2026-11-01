// Perfil de deck do Bot do Time (docs/plano-bot-time.md): o conhecimento do deck entra na avaliação como valores.

import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, evaluate, evaluateTerms, fieldCardValue, handCardValue, nextTurnPlay } from '../src/bot/evaluate';
import { chooseBotAction } from '../src/bot/planner';
import { ARCHETYPE_WEIGHTS, type DeckProfile, donInPlay, keepHand, profileWeights, validateProfile } from '../src/bot/profile';
import { applyAction, cardDef } from '../src/engine';
import type { GameState } from '../src/types';
import { identityAliases, viewFor } from '../src/view';
import { fetchToHand, kid, luffy, newGame, started, toTurn } from './helpers';

const profile: DeckProfile = {
  id: 'st01-luffy',
  leader: 'ST01-001',
  archetype: 'aggro',
  mulligan: { keep: ['ST01-012'], minCheap: 2 },
  roles: { 'ST01-007': 'engine', 'ST01-014': 'defense', 'ST01-003': 'fuel', 'ST01-012': 'finisher' },
  hold: { 'ST01-012': { untilDon: 7 } },
  weights: { exposed: 100 },
  matchups: { 'ST02-001': { counterCard: 0.3, note: 'quase sem Counter' } },
};

describe('perfil de deck: validação', () => {
  it('aceita o perfil completo e recusa campos errados', () => {
    expect(validateProfile(profile)).toEqual(profile);
    expect(validateProfile(null)).toMatch(/objeto/);
    expect(validateProfile({ ...profile, archetype: 'tempo' })).toMatch(/archetype/);
    expect(validateProfile({ ...profile, roles: { 'ST01-007': 'motor' } })).toMatch(/roles/);
    expect(validateProfile({ ...profile, hold: { 'ST01-012': { untilDon: 99 } } })).toMatch(/untilDon/);
    expect(validateProfile({ ...profile, weights: { exposed: 'alto' } })).toMatch(/weights.exposed/);
    expect(validateProfile({ ...profile, weights: { nada: 1 } })).toMatch(/desconhecido/);
    expect(validateProfile({ ...profile, weights: { life: [1, 2] } })).toMatch(/lista de 6/);
    expect(validateProfile({ ...profile, matchups: { 'ST02-001': { counterCard: 2 } } })).toMatch(/counterCard/);
    // Campos a mais são ignorados; o texto é cortado.
    const extra = validateProfile({ ...profile, summary: 'x'.repeat(600), extra: true }) as DeckProfile;
    expect(extra.summary).toHaveLength(500);
    expect('extra' in extra).toBe(false);
  });
});

describe('perfil de deck: pesos', () => {
  it('arquétipo, ajustes do guia e o confronto com o Líder adversário, nesta ordem', () => {
    const w = profileWeights(profile, 'ST02-001');
    expect(w.lifeOpp).toEqual(ARCHETYPE_WEIGHTS.aggro.lifeOpp);
    expect(w.exposed).toBe(100); // o guia por cima do arquétipo (300)
    expect(w.counterCard).toBe(0.3); // o confronto
    expect(w.counterBig).toBe(DEFAULT_WEIGHTS.counterBig);
    expect(w.roles).toEqual(profile.roles);
    expect(w.hold).toEqual(profile.hold);
    // Outro Líder: sem a regra do confronto.
    expect(profileWeights(profile, 'ST03-001').counterCard).toBe(DEFAULT_WEIGHTS.counterCard);
    expect(profileWeights({ ...profile, archetype: 'midrange', weights: undefined }, null)).toMatchObject({ ...DEFAULT_WEIGHTS, roles: profile.roles });
  });
});

describe('perfil de deck: avaliação', () => {
  it('a carta de defesa vale mais na mão, a de combustível vale menos, a motor vale mais em campo', () => {
    const s = started(3);
    const me = s.players[0];
    const w = profileWeights(profile, 'ST02-001');
    const guard = fetchToHand(s, 0, 'ST01-014');
    const karoo = fetchToHand(s, 0, 'ST01-003');
    expect(handCardValue(s, w, me, guard) - handCardValue(s, DEFAULT_WEIGHTS, me, guard)).toBe(w.roleDefense);
    expect(handCardValue(s, DEFAULT_WEIGHTS, me, karoo) - handCardValue(s, w, me, karoo)).toBe(w.roleFuel);
    const nami = fetchToHand(s, 0, 'ST01-007');
    expect(fieldCardValue(s, w, nami) - fieldCardValue(s, DEFAULT_WEIGHTS, nami)).toBe(w.roleEngine);
  });

  it('a carta guardada vale o bônus até o DON!! da regra, e não depois', () => {
    let s = started(3);
    const w = profileWeights(profile, 'ST02-001');
    const luffy5 = fetchToHand(s, 0, 'ST01-012');
    expect(donInPlay(s.players[0])).toBeLessThan(7);
    expect(handCardValue(s, w, s.players[0], luffy5) - handCardValue(s, DEFAULT_WEIGHTS, s.players[0], luffy5)).toBe(w.holdBonus);
    s = toTurn(s, 7); // 8 DON!! no turno 7 do jogador 0
    expect(donInPlay(s.players[0])).toBeGreaterThanOrEqual(7);
    expect(handCardValue(s, w, s.players[0], luffy5)).toBe(handCardValue(s, DEFAULT_WEIGHTS, s.players[0], luffy5));
  });
});

describe('perfil de deck: mulligan', () => {
  const defs = (s: GameState) => (uid: string) => cardDef(s, uid);
  const withHand = (ids: string[]): GameState => {
    const s = newGame(1, 0);
    const ps = s.players[0];
    ps.deck.push(...ps.hand);
    ps.hand = [];
    for (const id of ids) fetchToHand(s, 0, id);
    return s;
  };
  it('segura com 2 baratos (regra padrão) ou com a carta de keep e 1 barato', () => {
    const two = withHand(['ST01-003', 'ST01-007', 'ST01-010', 'ST01-012', 'ST01-015']);
    expect(keepHand(two, 0, undefined, defs(two))).toBe(true);
    const one = withHand(['ST01-003', 'ST01-010', 'ST01-010', 'ST01-015', 'ST01-015']);
    expect(keepHand(one, 0, undefined, defs(one))).toBe(false);
    expect(keepHand(one, 0, profile, defs(one))).toBe(false); // sem a carta de keep
    const keep = withHand(['ST01-003', 'ST01-010', 'ST01-012', 'ST01-015', 'ST01-015']);
    expect(keepHand(keep, 0, undefined, defs(keep))).toBe(false);
    expect(keepHand(keep, 0, profile, defs(keep))).toBe(true);
    // E o planejador decide o mulligan pelo perfil (pela visão).
    const aliases = identityAliases(keep);
    expect(chooseBotAction(viewFor(keep, 0, aliases), 0, 'team', { profile })).toEqual({ type: 'mulligan', player: 0, redraw: false });
    expect(chooseBotAction(viewFor(keep, 0, aliases), 0, 'hard')).toEqual({ type: 'mulligan', player: 0, redraw: true });
  });
});

describe('perfil de deck: decks prontos', () => {
  it('o Líder adversário vem da visão', () => {
    const s = started(1, [luffy, kid]);
    expect(cardDef(s, s.players[1].leader.uid).id).toBe('ST02-001');
  });
});

describe('painel do treinador: explicação das decisões', () => {
  it('a fase principal explica a linha escolhida (nota, termos e alternativas) e uma escolha pendente, a resposta', () => {
    const s = toTurn(started(5), 3);
    const got: import('../src/bot/planner').BotExplanation[] = [];
    const aliases = identityAliases(s);
    const a = chooseBotAction(viewFor(s, 0, aliases), 0, 'team', { explain: (e) => got.push(e), random: () => 0.5, timeBudgetMs: 60_000 });
    expect(a.type).not.toBe('endTurn');
    expect(got).toHaveLength(1);
    const [e] = got;
    expect(e.kind).toBe('turn');
    expect(e.turn).toBe(3);
    expect(e.actions[0]).toEqual(a);
    expect(e.actions[e.actions.length - 1].type).toBe('endTurn');
    expect(Number.isFinite(e.score)).toBe(true);
    expect(e.terms.length).toBeGreaterThan(0);
    for (const t of e.terms) expect(typeof t.key).toBe('string');
    expect(e.alternatives.length).toBeGreaterThan(0);
    for (const alt of e.alternatives) expect(alt.score).toBeLessThanOrEqual(e.score + 1);
    // Soma dos termos = avaliação.
    const terms = evaluateTerms(s, 0);
    expect(Object.values(terms).reduce((x, y) => x + y, 0)).toBeCloseTo(evaluate(s, 0), 3);
  });
});

describe('fase 2: a curva do próximo turno e a memória das cartas reveladas', () => {
  it('nextTurn: ter na mão a jogada prevista para o DON!! do turno seguinte vale o bônus (só com plano)', () => {
    const s = started(3); // turno 1 do jogador 0: 1 DON!! em campo, 2 no próximo turno... o plano usa o DON!! do próximo turno
    const plan = [
      { don: 2, play: ['ST01-003'] },
      { don: 4, play: ['ST01-010'] },
    ];
    const ps = s.players[0];
    expect(nextTurnPlay(s, ps, undefined)).toBeNull();
    const next = ps.donActive + ps.donRested + Math.min(2, ps.donDeck);
    expect(nextTurnPlay(s, ps, plan)).toEqual(next >= 4 ? ['ST01-010'] : ['ST01-003']);
    const w = { ...DEFAULT_WEIGHTS, plan };
    const expected = nextTurnPlay(s, ps, plan)![0];
    ps.deck.push(...ps.hand);
    ps.hand = [];
    const without = evaluate(s, 0, w);
    fetchToHand(s, 0, expected);
    const base = evaluate(s, 0, DEFAULT_WEIGHTS);
    expect(evaluate(s, 0, w) - base).toBe(w.nextTurn);
    expect(evaluate(s, 0, w)).toBeGreaterThan(without);
    expect(evaluateTerms(s, 0, w).nextTurn).toBe(w.nextTurn);
  });

  it('knownHand: a carta da mão revelada fica à vista do oponente enquanto estiver na mão', () => {
    let s = started(4);
    const uid = s.players[1].hand[0];
    const aliases = identityAliases(s);
    expect(viewFor(s, 0, aliases).cards[uid]).toBeUndefined();
    s.knownHand = [uid];
    const view = viewFor(s, 0, aliases);
    expect(view.cards[uid]?.cardId).toBe(s.cards[uid].cardId);
    expect(view.players[1].hand).toContain(uid);
    // Continua lembrada depois de uma ação que não mexe na carta.
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.knownHand).toEqual([uid]);
    expect(viewFor(s, 0, identityAliases(s)).cards[uid]?.cardId).toBe(s.cards[uid].cardId);
    // Saiu da mão (para o deck): a próxima ação a esquece; na mão de novo, continua escondida.
    s.players[1].hand = s.players[1].hand.filter((u) => u !== uid);
    s.players[1].deck.unshift(uid);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(s.knownHand).toBeUndefined();
    s.players[1].deck = s.players[1].deck.filter((u) => u !== uid);
    s.players[1].hand.push(uid);
    expect(viewFor(s, 0, identityAliases(s)).cards[uid]).toBeUndefined();
  });
});
