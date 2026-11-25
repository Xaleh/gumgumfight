// Análise da partida no navegador (roadmap B1): as contas da barra do replay e a análise rodando na página.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Action, actingPlayer, applyAction, type CardData, chooseSimpleBotAction, createGame, type DecisionReview, type DeckList, type GameState } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { type AnalysisMessage, condenseLine, nearestMark, runAnalysisInPage } from '../src/game/analysis';
import analysisPtBR from '../src/i18n/analysis/pt-BR';
import analysisEn from '../src/i18n/analysis/en';
import analysisEs from '../src/i18n/analysis/es';
import analysisJa from '../src/i18n/analysis/ja';
import analysisFr from '../src/i18n/analysis/fr';
import analysisDe from '../src/i18n/analysis/de';

const mark = (index: number, over: Partial<DecisionReview> = {}): DecisionReview => ({
  index,
  player: 0,
  turn: 3,
  kind: 'turn',
  played: { type: 'endTurn', player: 0 },
  best: [],
  bestScore: 0,
  playedScore: 0,
  loss: 2000,
  severity: 'inaccuracy',
  tag: 'better',
  accuracy: 70,
  ...over,
});

describe('análise da partida: barra do replay', () => {
  it('acha o marcador anterior e o seguinte', () => {
    const marks = [mark(30), mark(10), mark(20)];
    expect(nearestMark(marks, 20, 1)?.index).toBe(30);
    expect(nearestMark(marks, 20, -1)?.index).toBe(10);
    expect(nearestMark(marks, 15, -1)?.index).toBe(10);
    expect(nearestMark(marks, 30, 1)).toBeNull();
    expect(nearestMark(marks, 10, -1)).toBeNull();
  });

  it('resume a linha sugerida em jogadas (DON!! juntos, sem as respostas do meio)', () => {
    const p = 0 as const;
    const best: Action[] = [
      { type: 'playCard', player: p, uid: 'c3' },
      { type: 'choose', player: p, uids: ['c60'] },
      { type: 'attachDon', player: p, target: 'c1' },
      { type: 'attachDon', player: p, target: 'c1' },
      { type: 'attack', player: p, attacker: 'c1', target: 'c52' },
      { type: 'endTurn', player: p },
    ];
    const line = condenseLine({ kind: 'turn', best });
    expect(line.map((l) => [l.action.type, l.count])).toEqual([
      ['playCard', 1],
      ['attachDon', 2],
      ['attack', 1],
    ]);
    expect(condenseLine({ kind: 'turn', best: [{ type: 'endTurn', player: p }] }).map((l) => l.action.type)).toEqual(['endTurn']);
    expect(condenseLine({ kind: 'pending', best: [{ type: 'pass', player: p }, { type: 'endTurn', player: p }] })).toHaveLength(1);
  });

  it('os seis idiomas têm as mesmas chaves', () => {
    const keys = Object.keys(analysisPtBR).sort();
    for (const d of [analysisEn, analysisEs, analysisJa, analysisFr, analysisDe]) expect(Object.keys(d).sort()).toEqual(keys);
  });
});

describe('análise da partida: na página (sem worker)', () => {
  const DATA = join(__dirname, '../../../data');
  const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
  const cards: CardData[] = ['st01', 'st02'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
  const luffy: DeckList = load('decks/st01-luffy.json');
  const kid: DeckList = load('decks/st02-kid.json');

  function playOut(): { initial: GameState; actions: Action[] } {
    const initial = createGame({ seed: 5, firstPlayer: 0, cards, players: [{ name: 'A', deck: luffy }, { name: 'B', deck: kid }] });
    let s = initial;
    const actions: Action[] = [];
    for (let i = 0; i < 3000 && s.phase !== 'gameover'; i++) {
      const a = chooseSimpleBotAction(s, actingPlayer(s)!);
      actions.push(a);
      s = applyAction(s, a);
    }
    return { initial, actions };
  }

  it('recusa o replay que não terminou', () => {
    const { initial, actions } = playOut();
    const got: AnalysisMessage[] = [];
    runAnalysisInPage({ initial, actions: actions.slice(0, 20) }, (m) => got.push(m));
    expect(got).toEqual([{ type: 'error', code: 'notFinished' }]);
  });

  it('cancela no meio sem mandar mais nada', async () => {
    const { initial, actions } = playOut();
    const got: AnalysisMessage[] = [];
    const stop = runAnalysisInPage({ initial, actions }, (m) => got.push(m));
    stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([]);
  });
});
