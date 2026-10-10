import { describe, expect, it } from 'vitest';
import { censor, hasProfanity } from '../src/online/profanity';

describe('filtro de palavrões', () => {
  it('censura o termo inteiro, mantendo o resto do texto', () => {
    expect(censor('que porra é essa')).toBe('que ***** é essa');
    expect(censor('Caralho, que jogada!')).toBe('*******, que jogada!');
    expect(censor('fuck this game')).toBe('**** this game');
  });

  it('reconhece acentos, maiúsculas, símbolos no lugar de letras e letras repetidas', () => {
    expect(censor('MERDA')).toBe('*****');
    expect(censor('p0rr@')).toBe('*****');
    expect(censor('m3rdaaaa')).toBe('********');
    expect(censor('pút@')).toBe('****');
    expect(censor('sh1t')).toBe('****');
  });

  it('reconhece plural e a palavra soletrada com separadores', () => {
    expect(censor('putas')).toBe('*****');
    expect(censor('p.o.r.r.a')).toBe('*********');
    expect(censor('p o r r a de jogo')).toBe('********* de jogo');
    expect(censor('f-u-c-k')).toBe('*******');
  });

  it('não toca em palavras comuns que só contêm um termo', () => {
    for (const ok of ['cuidado com o counter', 'vou assistir depois', 'classe de carta', 'bom jogo!', 'o scuba', 'put the card', 'a mesa', 'deck de 50 cartas']) {
      expect(censor(ok)).toBe(ok);
      expect(hasProfanity(ok)).toBe(false);
    }
  });

  it('censura várias ocorrências e abreviações', () => {
    expect(censor('vsf, fdp, que merda')).toBe('***, ***, que *****');
    expect(censor('wtf is this')).toBe('*** is this');
    expect(hasProfanity('vai se foder')).toBe(true);
  });

  it('texto vazio e só números continuam iguais', () => {
    expect(censor('')).toBe('');
    expect(censor('5000 de poder')).toBe('5000 de poder');
  });
});
