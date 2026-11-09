// Escolha "até N" deixada em branco: fica no histórico (`log.skipChoice`), para o oponente e o replay
// não lerem como falha do efeito. Relato de torneio: "[Trigger] Absalom ativado!" e nada aconteceu, mas
// a jogada gravada era a escolha vazia do próprio jogador.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { replayConfig, upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, GameConfig, PlayerId } from '../src/types';
import { putOnField, started, toTurn } from './helpers';

const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/replay-absalom-trigger.json'), 'utf8')) as {
  decks: [DeckList, DeckList];
  cards: CardData[];
  replay: { version: number; seed: number; seed128: number[]; firstPlayer: PlayerId; chooseFirst?: boolean; names: [string, string]; actions: Action[] };
};

describe('escolha deixada em branco', () => {
  it('replay do Absalom OP14-100: o [Trigger] oferece as 12 cartas e a resposta vazia fica no histórico', () => {
    const { replay } = fx;
    const config: GameConfig = replayConfig(
      {
        seed: replay.seed,
        seed128: replay.seed128,
        firstPlayer: replay.chooseFirst ? undefined : replay.firstPlayer,
        chooseFirst: replay.chooseFirst,
        cards: fx.cards,
        players: [
          { name: replay.names[0], deck: fx.decks[0] },
          { name: replay.names[1], deck: fx.decks[1] },
        ],
      },
      replay.version,
    );
    let s = createGame(config);
    const actions = upgradeReplayActions(config, replay.actions);
    expect(actions).toHaveLength(replay.actions.length);
    const id = (u: string) => s.cards[u].cardId;
    actions.forEach((a, i) => {
      s = applyAction(s, a);
      if (i === 103) {
        // Turno 9: o Trigger abriu a escolha do descarte, com só {Thriller Bark Pirates} de custo 4 ou menos.
        expect(s.log.at(-1)).toMatchObject({ key: 'log.triggerActivated', params: { card: 'Absalom' } });
        expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1, min: 0, max: 1 });
        const options = (s.pending as { options: string[] }).options;
        expect(options).toHaveLength(12);
        for (const u of options) {
          const def = s.defs[id(u)];
          expect(def.types).toContain('Thriller Bark Pirates');
          expect(def.cost).toBeLessThanOrEqual(4);
        }
        // A carta do Trigger está fora das áreas, não entre as opções (10-1-5-3).
        expect(s.limbo?.map(id)).toEqual(['OP14-100']);
      }
      if (i === 104) {
        expect(a).toEqual({ type: 'choose', player: 1, uids: [] });
        expect(s.log.at(-1)).toMatchObject({
          key: 'log.skipChoice',
          text: 'Absalom: Jogador 2 não escolheu nenhuma carta.',
          params: { source: 'Absalom', player: 'Jogador 2' },
          player: 1,
        });
        expect(s.players[1].characters.map((c) => id(c.uid))).not.toContain('OP06-090');
      }
    });
    expect(s.phase).toBe('gameover');
  });

  it('sem nada a escolher (só cartas mostradas, "Continuar") não registra nada', () => {
    let s = toTurn(started(), 4);
    const bonney = putOnField(s, 1, 'ST02-007');
    const deck = s.players[1].deck;
    const isSuper = (u: string) => s.defs[s.cards[u].cardId].types.includes('Supernovas');
    const others = deck.filter((u) => !isSuper(u));
    s.players[1].deck = [...others.slice(0, 5), ...deck.filter((u) => !others.slice(0, 5).includes(u))];
    s = applyAction(s, { type: 'activate', player: 1, uid: bonney, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [], max: 0 });
    const before = s.log.length;
    s = applyAction(s, { type: 'choose', player: 1, uids: [] });
    expect(s.log.slice(before).map((l) => l.key)).not.toContain('log.skipChoice');
  });
});
