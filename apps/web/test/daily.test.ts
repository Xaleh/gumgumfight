import { describe, expect, it } from 'vitest';
import { dailyShareText, scriptName } from '../src/game/daily';
import { type MessageKey, type Params, translate } from '../src/i18n';
import ptBR from '../src/i18n/pt-BR';

const t = (key: MessageKey, params?: Params) => translate('pt-BR', key, params);

const data = {
  day: '2026-10-12',
  number: 12,
  history: [
    { day: '2026-10-12', number: 12, attempts: 2, solved: true },
    { day: '2026-10-11', number: 11, attempts: 1, solved: true },
    { day: '2026-10-10', number: 10, attempts: 3, solved: false },
  ],
};

describe('desafio do dia: compartilhar', () => {
  it('leva o número, as tentativas, a sequência e os dias, sem a mesa', () => {
    const text = dailyShareText(t, data, { attempts: 2, solved: true }, { current: 2, best: 4, solved: 9 }, 'https://gumgumfight.app');
    expect(text.split('\n')).toEqual([
      'GumGum Fight · Desafio do dia #12',
      '✅ Resolvido em 2 tentativas',
      '🔥 2 dias seguidos',
      '⬛✅✅',
      'https://gumgumfight.app/?desafio',
    ]);
  });

  it('sem resolver e sem sequência', () => {
    const text = dailyShareText(t, { ...data, history: [] }, { attempts: 1, solved: false }, { current: 0, best: 0, solved: 0 }, 'https://x');
    expect(text).toContain('❌ Ainda não (1 tentativa)');
    expect(text).not.toContain('🔥');
  });

  it('nomes do roteiro de ataques', () => {
    const view = { defs: { 'ST03-012': { name: 'Pacifista' } } } as never;
    expect(scriptName(t, view, 'leader', 'attacker')).toBe('o Líder dele');
    expect(scriptName(t, view, 'leader', 'target')).toBe('o seu Líder');
    expect(scriptName(t, view, 'ST03-012', 'attacker')).toBe('Pacifista');
  });

  it('as chaves do desafio existem no dicionário', () => {
    expect(Object.keys(ptBR).filter((k) => k.startsWith('daily.')).length).toBeGreaterThan(30);
  });

  it('nenhum plural dos textos do desafio tem parâmetro dentro (o formatador não lê)', () => {
    const bad = Object.entries(ptBR).filter(([k, v]) => k.startsWith('daily.') && /\{n\|[^}]*\{/.test(v));
    expect(bad).toEqual([]);
    expect(t('daily.admin.days', { n: 2, days: '2026-10-12, 2026-10-19' })).toBe('saiu 2 vezes (2026-10-12, 2026-10-19)');
  });
});

describe('desafio do dia: defesa e enunciado', () => {
  it('linhas da defesa conforme o desafio', async () => {
    const { defenseLines } = await import('../src/game/daily');
    expect(defenseLines({ eventCounters: false, triggers: false })).toEqual(['daily.defense.block', 'daily.defense.characters', 'daily.defense.noEvents', 'daily.defense.noTriggers']);
    expect(defenseLines({ eventCounters: true, triggers: true }).slice(2)).toEqual(['daily.defense.events', 'daily.defense.triggers']);
    expect(defenseLines(undefined)).toHaveLength(4);
  });

  it('o enunciado vem no idioma da interface, senão em português', async () => {
    const { introFor } = await import('../src/game/daily');
    expect(introFor({ 'pt-BR': 'Olá', en: 'Hi' }, 'en')).toBe('Hi');
    expect(introFor({ 'pt-BR': 'Olá', en: '  ' }, 'en')).toBe('Olá');
    expect(introFor({ 'pt-BR': 'Olá' }, 'ja')).toBe('Olá');
    expect(introFor(null, 'pt-BR')).toBeNull();
  });
});
