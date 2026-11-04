// Relatório da partida do Bot do Time: o texto que a mesa monta com os passos marcados como errados.

import type { Action } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import type { CoachEntry } from '../src/api';
import { buildReport, feedbackMarks } from '../src/game/botReport';
import ptBR from '../src/i18n/pt-BR';

const tr = (key: string, params: Record<string, string | number> = {}) => {
  let s = (ptBR as Record<string, string>)[key] ?? key;
  // Plural simples ({n|# um|# vários}) e parâmetros.
  s = s.replace(/\{(\w+)\|([^|}]*)\|?([^}]*)\}/g, (_, k: string, one: string, other: string) => (Number(params[k]) === 1 || !other ? one : other).replace('#', String(params[k])));
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
};
const describe_ = (a: Action) => (a.type === 'attack' ? `ataca ${a.target} com ${a.attacker}` : a.type === 'playCard' ? `baixa ${a.uid}` : a.type === 'endTurn' ? 'encerra o turno' : a.type);

const entries: CoachEntry[] = [
  {
    kind: 'turn',
    turn: 5,
    index: 40,
    seat: 1,
    score: 12345,
    actions: [
      { type: 'playCard', player: 1, uid: 'Newgate' },
      { type: 'attack', player: 1, attacker: 'Xebec', target: 'Luffy' },
      { type: 'endTurn', player: 1 },
    ],
    terms: [
      { key: 'hand', delta: -2100 },
      { key: 'lifeOpp', delta: 4450 },
    ],
    alternatives: [
      // Igual à linha escolhida por extenso (outra cópia da mesma carta): fica de fora.
      { actions: [{ type: 'playCard', player: 1, uid: 'Newgate' }, { type: 'attack', player: 1, attacker: 'Xebec', target: 'Luffy' }, { type: 'endTurn', player: 1 }], score: 12340 },
      { actions: [{ type: 'playCard', player: 1, uid: 'Buckin' }, { type: 'endTurn', player: 1 }], score: 12000 },
      // Repetida: fica de fora.
      { actions: [{ type: 'playCard', player: 1, uid: 'Buckin' }, { type: 'endTurn', player: 1 }], score: 11990 },
    ],
  },
  { kind: 'pending', turn: 6, index: 52, seat: 1, score: 900, actions: [{ type: 'pass', player: 1 }], terms: [], alternatives: [] },
];

const base = {
  entries,
  tr,
  describe: describe_,
  termLabel: (k: string) => tr(`coach.term.${k}`),
  num: (n: number) => String(n),
  bot: { deckId: 'op17-xebec', leaderName: 'Rocks.D.Xebec', leaderId: 'OP17-039' },
  opponent: { name: 'Alexandre', leaderName: 'Monkey.D.Luffy', leaderId: 'ST01-001' },
};

describe('relatório do Bot do Time', () => {
  it('cada passo marcado vira um item, com a linha, o certo, o porquê, o que pesou e a posição', () => {
    const text = buildReport({
      ...base,
      marks: [
        { index: 52, step: 0 },
        { index: 40, step: 1, alt: 1, why: 'segurar o Xebec para a defesa' },
      ],
      result: { turn: 9, over: true, botWon: false },
      matchId: 123,
      level: 'team',
      rating: 3,
      comment: 'Jogou rápido demais.',
    });
    expect(text).toMatch(/^# Bot do Time: relatório da partida/);
    expect(text).toContain('Deck do bot: op17-xebec (Líder Rocks.D.Xebec, OP17-039)');
    expect(text).toContain('Oponente: Alexandre com Monkey.D.Luffy (ST01-001)');
    expect(text).toContain('Resultado: o bot perdeu no turno 9');
    expect(text).toContain('Partida: #123');
    expect(text).toContain('Nota: ★★★☆☆ (3/5)');
    expect(text).toContain('## Jogadas erradas (2)');
    // Em ordem de jogada: a linha do turno 5 antes da resposta do turno 6.
    expect(text.indexOf('Turno 5')).toBeLessThan(text.indexOf('Turno 6'));
    expect(text).toContain('### 1. Turno 5: linha do turno (passo 2 de 3)');
    expect(text).toContain('Jogada errada: **ataca Luffy com Xebec**');
    expect(text).toContain('Linha inteira do bot: baixa Newgate → **ataca Luffy com Xebec** → encerra o turno');
    expect(text).toContain('O certo era: baixa Buckin → encerra o turno');
    expect(text).toContain('Por quê: segurar o Xebec para a defesa');
    // Só as alternativas que se distinguem por extenso.
    expect(text).toContain('Ele também considerou: baixa Buckin → encerra o turno (12000)\n');
    expect(text).toContain('O que pesou para o bot: sua mão −2100; Vida do oponente +4450');
    expect(text).toContain('Posição no replay: ação 40 (nota do bot 12345)');
    expect(text).toContain('### 2. Turno 6: resposta');
    expect(text).toContain('## Comentário geral\n\nJogou rápido demais.');
  });

  it('sem marcações e com a partida em andamento; as marcações vão ao servidor com o passo e o texto do certo', () => {
    const text = buildReport({ ...base, marks: [], result: { turn: 4, over: false } });
    expect(text).toContain('Partida em andamento (turno 4)');
    expect(text).toContain('Nenhuma jogada marcada.');
    expect(text).not.toContain('Nota:');
    expect(feedbackMarks([{ index: 40, step: 1, alt: 1, why: ' cedo ' }, { index: 52, step: 0 }], entries, describe_)).toEqual([
      { index: 40, step: 1, expected: 'baixa Buckin → encerra o turno', comment: 'cedo' },
      { index: 52, step: 0 },
    ]);
  });
});
