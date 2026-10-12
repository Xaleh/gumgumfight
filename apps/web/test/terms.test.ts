import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../src/game/tutorial/lessons';
import { splitTerms, termOf } from '../src/game/tutorial/terms';

describe('termos clicáveis do texto da carta', () => {
  it('reconhece as palavras-chave em inglês e na tradução', () => {
    expect(termOf('[Blocker]')).toBe('blocker');
    expect(termOf('[On Play]')).toBe('onPlay');
    expect(termOf('[Ao Jogar]')).toBe('onPlay');
    expect(termOf('[Ativar: Principal]')).toBe('activateMain');
    expect(termOf('[Activate:Main]')).toBe('activateMain');
    expect(termOf('[Uma Vez por Turno]')).toBe('oncePerTurn');
    expect(termOf('[DON!! x1]')).toBe('donX');
    expect(termOf('DON!! −4')).toBe('donMinus');
    expect(termOf('DON!! -1')).toBe('donMinus');
    expect(termOf('[Straw Hat Crew]')).toBeNull();
    expect(termOf('[Monkey.D.Luffy]')).toBeNull();
  });

  it('divide o texto mantendo tudo, na ordem', () => {
    const text = '[Activate: Main] [Once Per Turn] DON!! −4: Return [Monkey.D.Luffy] and gain [Rush].';
    const parts = splitTerms(text);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.term).map((p) => p.term)).toEqual(['activateMain', 'oncePerTurn', 'donMinus', 'rush']);
  });

  it('todo termo reconhecido existe no glossário', () => {
    const ids = new Set(GLOSSARY.map((g) => g.id));
    for (const id of ['onPlay', 'whenAttacking', 'activateMain', 'oncePerTurn', 'blocker', 'rush', 'doubleAttack', 'banish', 'counter', 'trigger', 'donX', 'donMinus']) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
