// DON!! −X: o dono escolhe quais DON!! devolver (CR 8-3-1-6, 10-2-10-1; Q&A OP02-085 Magellan).
// Área de custo (ativos ou virados), Líder, Personagens ou Stage (docs/rules/divergencias.md, DV-09).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef } from '../src/cards';
import { applyAction, createGame, getPower } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, CardData, GameConfig, GameState, PlayerId } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards, luffy, putOnField, shanks, started, toTurn } from './helpers';

const op02 = (JSON.parse(readFileSync(join(__dirname, '../../../data/cards/op02.json'), 'utf8')) as { cards: CardData[] }).cards;

/** Jogador 0 = Shanks (ST05) no turno 5, com `active` DON!! ativos, `rested` virados e `onLeader` dados ao Líder. */
function shanksTurn(active: number, rested = 0, onLeader = 0): GameState {
  const s = toTurn(started(1, [shanks, luffy]), 5);
  const ps = s.players[0];
  ps.donDeck += ps.donActive + ps.donRested - active - rested - onLeader;
  ps.donActive = active;
  ps.donRested = rested;
  ps.leader.don = onLeader;
  return s;
}
const activateLeader = (s: GameState) => applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
const option = (s: GameState, player: PlayerId, index: number) => applyAction(s, { type: 'option', player, index });
/** Responde a escolha de DON!! pela origem (`'active'`, `'rested'` ou o uid da carta). */
function pick(s: GameState, src: string): GameState {
  const p = s.pending;
  if (p?.kind !== 'option' || !p.don) throw new Error(`esperava a escolha de DON!!, veio ${p?.kind}`);
  const index = p.don.indexOf(src);
  if (index < 0) throw new Error(`origem ${src} fora das opções ${p.don.join(', ')}`);
  return option(s, p.player, index);
}

describe('DON!! −X: o jogador escolhe quais DON!! devolver (DV-09)', () => {
  it('Shanks (ST05-001) com 3 ativos e 3 dados ao Líder devolve os 3 do Líder e fica com os ativos', () => {
    let s = shanksTurn(3, 0, 3);
    const film = putOnField(s, 0, 'ST05-007');
    const deck = s.players[0].donDeck;
    const before = getPower(s, film);
    s = activateLeader(s);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, don: ['active', s.players[0].leader.uid] });
    expect((s.pending as { options: string[] }).options).toEqual(['DON!! ativo da área de custo (3)', 'DON!! dado a Shanks (Líder) (3)']);
    for (let i = 0; i < 3; i++) s = pick(s, s.players[0].leader.uid);
    expect(s.pending).toBeNull();
    // Antes: o motor devolvia os 3 ativos (sobrava 0 para jogar cartas).
    expect(s.players[0].donActive).toBe(3);
    expect(s.players[0].leader.don).toBe(0);
    expect(s.players[0].donDeck).toBe(deck + 3);
    expect(getPower(s, film)).toBe(before + 2000);
  });

  it('pode misturar origens: 1 virado, 1 ativo e 1 do Líder', () => {
    let s = shanksTurn(2, 2, 2);
    s = activateLeader(s);
    expect((s.pending as { don: string[] }).don).toEqual(['rested', 'active', s.players[0].leader.uid]);
    s = pick(s, 'rested');
    s = pick(s, 'active');
    s = pick(s, s.players[0].leader.uid);
    expect(s.pending).toBeNull();
    expect([s.players[0].donRested, s.players[0].donActive, s.players[0].leader.don]).toEqual([1, 1, 1]);
    expect(s.log.some((l) => l.text.includes('devolve 3 DON!! ao deck de DON!! (1 virado, 1 ativo, 1 de Shanks)'))).toBe(true);
  });

  it('não pergunta quando só existe uma forma: uma origem só, ou todos os DON!! do campo vão', () => {
    let s = activateLeader(shanksTurn(5));
    expect(s.pending).toBeNull();
    expect(s.players[0].donActive).toBe(2);

    s = activateLeader(shanksTurn(1, 0, 2));
    expect(s.pending).toBeNull();
    expect([s.players[0].donActive, s.players[0].leader.don]).toEqual([0, 0]);
  });

  it('para de perguntar quando a origem restante é uma só', () => {
    let s = activateLeader(shanksTurn(1, 0, 3));
    s = pick(s, 'active');
    // Sobram só os do Líder: o 2º e o 3º saem dele sem pergunta.
    expect(s.pending).toBeNull();
    expect([s.players[0].donActive, s.players[0].leader.don]).toEqual([0, 1]);
  });

  it('Magellan (OP02-085): o oponente escolhe quais dos seus DON!! devolver', () => {
    let s = shanksTurn(5);
    for (const c of op02) if (c.id === 'OP02-085') s.defs[c.id] = buildCardDef(c);
    const uid = s.players[0].hand[0];
    s.cards[uid] = { ...s.cards[uid], cardId: 'OP02-085' };
    const opp = s.players[1];
    opp.donDeck -= 3 - opp.donActive - opp.donRested;
    opp.donActive = 2;
    opp.donRested = 0;
    opp.leader.don = 1;
    const target = putOnField(s, 1, 'ST01-013');
    opp.characters.find((c) => c.uid === target)!.don = 1;
    opp.donDeck -= 1;
    s = applyAction(s, { type: 'playCard', player: 0, uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes: true }); // DON!! −1 (só ativos: devolve sem perguntar)
    expect(s.pending).toMatchObject({ kind: 'option', player: 1, don: ['active', opp.leader.uid, target] });
    s = pick(s, target);
    expect(s.pending).toBeNull();
    const after = s.players[1];
    expect([after.donActive, after.leader.don, after.characters.find((c) => c.uid === target)!.don]).toEqual([2, 1, 0]);
  });

  it('bot: no próprio turno devolve virados, depois os dados (antes os de quem já atacou) e só então os ativos', () => {
    let s = shanksTurn(3, 1, 3);
    const leader = s.players[0].leader.uid;
    s = activateLeader(s);
    const answers: string[] = [];
    while (s.pending?.kind === 'option' && s.pending.don) {
      const a = chooseBotAction(s, 0) as Extract<Action, { type: 'option' }>;
      answers.push(s.pending.don[a.index]);
      s = applyAction(s, a);
    }
    expect(answers).toEqual(['rested', leader, leader]);
    expect(s.players[0].donActive).toBe(3);

    // Com um Personagem já virado (atacou), os DON!! dele saem antes dos do Líder.
    s = shanksTurn(3, 0, 2);
    const film = putOnField(s, 0, 'ST05-007', { rested: true });
    s.players[0].characters.find((c) => c.uid === film)!.don = 1;
    s.players[0].donDeck -= 1;
    s = activateLeader(s);
    const a = chooseBotAction(s, 0) as Extract<Action, { type: 'option' }>;
    expect((s.pending as { don: string[] }).don[a.index]).toBe(film);
  });

  it('o oponente não vê as opções nem as origens da escolha', () => {
    const s = activateLeader(shanksTurn(3, 0, 3));
    let n = 0;
    const aliases = createAliases(s, () => `c${++n}`);
    const theirs = viewFor(s, 1, aliases).pending;
    expect(theirs).toMatchObject({ kind: 'option', player: 0, options: [] });
    expect(theirs).not.toHaveProperty('don');
    // O dono vê as origens com os aliases das cartas.
    const mine = viewFor(s, 0, aliases).pending as { don: string[] };
    expect(mine.don).toEqual(['active', aliases.toAlias[s.players[0].leader.uid]]);
  });

  it('replays antigos (versão 4) recebem a escolha implícita na ordem antiga: virados, ativos, dados', () => {
    const config: GameConfig = {
      seed: 1,
      firstPlayer: 0,
      cards,
      players: [
        { name: 'P0', deck: shanks },
        { name: 'P1', deck: luffy },
      ],
    };
    let s = createGame(config);
    const old: Action[] = [
      { type: 'mulligan', player: 0, redraw: false },
      { type: 'mulligan', player: 1, redraw: false },
    ];
    for (const a of old) s = applyAction(s, a);
    while (s.turn < 5) {
      const a: Action = { type: 'endTurn', player: s.activePlayer };
      old.push(a);
      s = applyAction(s, a);
    }
    const leader = s.players[0].leader.uid;
    for (let i = 0; i < 3; i++) old.push({ type: 'attachDon', player: 0, target: leader });
    old.push({ type: 'activate', player: 0, uid: leader, ability: 0 }, { type: 'endTurn', player: 0 });
    const modern = upgradeReplayActions(config, old);
    expect(modern.filter((a) => a.type === 'option')).toEqual([
      { type: 'option', player: 0, index: 0 },
      { type: 'option', player: 0, index: 0 },
    ]);
    s = createGame(config);
    for (const a of modern.slice(0, -1)) s = applyAction(s, a);
    // Como antes: os 2 ativos e 1 do Líder.
    expect([s.players[0].donActive, s.players[0].leader.don]).toEqual([0, 2]);
    expect(upgradeReplayActions(config, modern)).toEqual(modern);
  });
});
