import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, getCost, hasKeyword, koProtected } from '../src/engine';
import type { GameState, PlayerId } from '../src/types';
import { fetchToHand, luffy, putOnField, sakazuki, started, toTurn } from './helpers';

// Jogador 0 = Sakazuki (ST06, efeitos lidos automaticamente do texto), jogador 1 = Luffy (ST01).
const begin = (turn = 3, seed = 1) => toTurn(started(seed, [sakazuki, luffy]), turn);
const lifeTrigger = (s: GameState, player: PlayerId, cardId: string) => {
  const ps = s.players[player];
  const uid = fetchToHand(s, player, cardId);
  ps.hand.splice(ps.hand.indexOf(uid), 1);
  ps.life.push(uid);
  return uid;
};

describe('ST06 — Absolute Justice (leitor automático)', () => {
  it('Sakazuki: ③ + descartar 1 nocauteia um personagem de custo 0 (depois de −custo)', () => {
    let s = begin(5);
    const hina = fetchToHand(s, 0, 'ST06-008');
    const nami = putOnField(s, 1, 'ST01-007'); // custo 1
    s = applyAction(s, { type: 'playCard', player: 0, uid: hina });
    s = applyAction(s, { type: 'choose', player: 0, uids: [nami] });
    expect(getCost(s, nami)).toBe(0);
    s.players[0].donActive = 3;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] }); // custo: descarte
    s = applyAction(s, { type: 'choose', player: 0, uids: [nami] });
    expect(s.players[1].trash).toContain(nami);
  });

  it('Great Eruption [Trigger]: quem escolhe o descarte é o oponente', () => {
    let s = begin(4); // turno do jogador 1, que ataca
    const card = lifeTrigger(s, 0, 'ST06-015');
    s.players[0].hand = [];
    const oppHand = s.players[1].hand.length;
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'trigger', card });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, min: 1, max: 1, intent: 'discard' });
    const action = chooseBotAction(s, 1);
    s = applyAction(s, action);
    expect(s.players[1].hand.length).toBe(oppHand - 1);
  });

  it('White Out [Trigger]: compra 1 e nenhum personagem seu pode ser nocauteado neste turno', () => {
    let s = begin(4);
    const koby = putOnField(s, 0, 'ST06-002');
    const card = lifeTrigger(s, 0, 'ST06-016');
    s.players[0].hand = [];
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'trigger', card });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.players[0].hand).toHaveLength(1); // a carta de Vida vai para o descarte; compra 1
    expect(koProtected(s, koby, false)).toBe(true);
    expect(koProtected(s, koby, true)).toBe(true);
  });

  it('Smoker ganha [Double Attack] com DON!! x1 se houver um personagem de custo 0', () => {
    let s = begin(5);
    const smoker = putOnField(s, 0, 'ST06-004');
    s = applyAction(s, { type: 'attachDon', player: 0, target: smoker });
    expect(hasKeyword(s, smoker, 'doubleAttack')).toBe(false);
    const nami = putOnField(s, 1, 'ST01-007');
    s.modifiers.push({ uid: nami, kind: 'cost', amount: -1, duration: 'turn' });
    expect(hasKeyword(s, smoker, 'doubleAttack')).toBe(true);
  });
});
