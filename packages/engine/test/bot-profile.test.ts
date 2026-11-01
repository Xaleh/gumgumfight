// Perfil de deck do Bot do Time (docs/plano-bot-time.md): o conhecimento do deck entra na avaliação como valores.

import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, handCardValue, fieldCardValue } from '../src/bot/evaluate';
import { chooseBotAction } from '../src/bot/planner';
import { ARCHETYPE_WEIGHTS, type DeckProfile, donInPlay, keepHand, profileWeights, validateProfile } from '../src/bot/profile';
import { cardDef } from '../src/engine';
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
