import { describe, expect, it } from 'vitest';
import { queuePillOnTop, queuePolicy } from '../src/queueScreens';

describe('fila e telas: quando a busca por oponente continua', () => {
  it('telas de navegar e ler mantêm a fila', () => {
    for (const screen of ['menu', 'stats', 'profile', 'learn', 'tournaments', 'watch-list', 'watch']) expect(queuePolicy(screen)).toBe('keep');
  });

  it('replay mantém a fila; partida contra o bot pede para sair', () => {
    expect(queuePolicy('game', true)).toBe('keep');
    expect(queuePolicy('game', false)).toBe('ask');
    expect(queuePolicy('game')).toBe('ask');
  });

  it('telas onde se joga ou se edita algo pedem para sair da fila', () => {
    for (const screen of ['builder', 'lesson', 'daily', 'sandbox', 'sealed', 'draft', 'yonko', 'yonko-game', 'admin', 'team', 'coverage']) {
      expect(queuePolicy(screen)).toBe('ask');
    }
    // Uma tela nova, ainda sem regra: pergunta antes (o lado seguro).
    expect(queuePolicy('tela-nova')).toBe('ask');
  });

  it('entrar numa sala do servidor sai da fila sem perguntar', () => {
    expect(queuePolicy('online')).toBe('leave');
    expect(queuePolicy('yonko-online')).toBe('leave');
  });

  it('nas telas de mesa a busca minimizada fica no alto', () => {
    expect(queuePillOnTop('watch')).toBe(true);
    expect(queuePillOnTop('game')).toBe(true);
    expect(queuePillOnTop('menu')).toBe(false);
    expect(queuePillOnTop('stats')).toBe(false);
  });
});
