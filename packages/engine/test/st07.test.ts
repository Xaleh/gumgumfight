import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { applyAction, hasKeyword } from '../src/engine';
import type { GameState } from '../src/types';
import { bigMom, fetchToHand, luffy, putOnField, started, toTurn } from './helpers';

// Jogador 0 = Big Mom (ST07, lida automaticamente), jogador 1 = Luffy (ST01).
const begin = (turn = 3, seed = 1) => toTurn(started(seed, [bigMom, luffy]), turn);
const option = (s: GameState, player: 0 | 1, index: number) => applyAction(s, { type: 'option', player, index });

describe('ST07 — Big Mom Pirates (Vida e escolhas)', () => {
  it('Big Mom (líder): tira 1 da Vida (topo ou fundo) e põe 1 da mão no topo da Vida', () => {
    let s = begin(3);
    const ps = s.players[0];
    ps.life.splice(0, 3); // 2 cartas de Vida → condição "2 or less"
    const [bottom, top] = ps.life;
    s = applyAction(s, { type: 'attachDon', player: 0, target: ps.leader.uid });
    s.players[0].donActive = 1;
    s = applyAction(s, { type: 'attachDon', player: 0, target: ps.leader.uid });
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'option', options: ['Topo da Vida', 'Fundo da Vida'] });
    s = option(s, 0, 1);
    expect(s.players[0].hand).toContain(bottom);
    expect(s.players[0].life).toEqual([top]);
    const card = s.players[0].hand[0];
    s = applyAction(s, { type: 'choose', player: 0, uids: [card] });
    expect(s.players[0].life).toEqual([top, card]);
  });

  it('Pudding olha o topo da Vida do oponente e manda para o fundo', () => {
    let s = begin(3);
    const opp = s.players[1].life;
    const [first, , , , topCard] = opp;
    s = applyAction(s, { type: 'playCard', player: 0, uid: fetchToHand(s, 0, 'ST07-008') });
    expect(s.pending).toMatchObject({ kind: 'option', options: ['Olhar a sua Vida', 'Olhar a Vida do oponente', 'Não olhar'] });
    s = option(s, 0, 1);
    expect(s.pending?.kind === 'option' && s.pending.prompt).toContain(s.defs[s.cards[topCard].cardId].name);
    s = option(s, 0, 1);
    expect(s.players[1].life[0]).toBe(topCard);
    expect(s.players[1].life[1]).toBe(first);
    expect(s.players[1].life).toHaveLength(5);
  });

  it('Big Mom (personagem): o oponente escolhe entre perder 1 Vida ou dar 1 Vida', () => {
    let s = begin(7);
    s.players[0].donActive = 7;
    s = applyAction(s, { type: 'playCard', player: 0, uid: fetchToHand(s, 0, 'ST07-010') });
    expect(s.pending).toMatchObject({ kind: 'option', player: 1 });
    const myLife = s.players[0].life.length;
    s = applyAction(s, chooseBotAction(s, 1)); // o bot (oponente) escolhe a última opção
    expect(s.players[0].life.length).toBe(myLife + 1);

    let t = begin(7);
    t.players[0].donActive = 7;
    t = applyAction(t, { type: 'playCard', player: 0, uid: fetchToHand(t, 0, 'ST07-010') });
    t = option(t, 1, 0);
    expect(t.players[1].life).toHaveLength(4);
  });

  it('Katakuri ganha [Rush] se tiver menos Vida que o oponente', () => {
    let s = begin(5);
    s.players[0].life.splice(0, 2);
    const kata = fetchToHand(s, 0, 'ST07-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: kata });
    s = option(s, 0, 2); // não olhar
    expect(hasKeyword(s, kata, 'rush')).toBe(true);
  });

  it('Charlotte Snack ganha [Banish] e +1000 ao pagar com a Vida', () => {
    let s = begin(5);
    const snack = putOnField(s, 0, 'ST07-004');
    s = applyAction(s, { type: 'attachDon', player: 0, target: snack });
    s.players[1].hand = [];
    s = applyAction(s, { type: 'attack', player: 0, attacker: snack, target: s.players[1].leader.uid });
    s = applyAction(s, { type: 'answer', player: 0, yes: true });
    s = option(s, 0, 0);
    s = applyAction(s, { type: 'pass', player: 1 });
    // [Banish]: a carta de Vida do oponente vai para o descarte (não para a mão).
    expect(s.players[1].life).toHaveLength(4);
    expect(s.players[1].trash).toHaveLength(1);
    expect(s.players[1].hand).toHaveLength(0);
  });
});
