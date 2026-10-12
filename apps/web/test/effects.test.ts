// Um useEffect escrito como `() => expressão` devolve o valor da expressão, e o React o chama como
// limpeza ao desmontar. Chamadas do navegador podem devolver algo que não é função (em navegadores
// novos `window.scrollTo` devolve uma Promise), o que derruba a tela com "is not a function".
// Efeitos que chamam APIs do navegador (window/document/navigator) devem usar chaves.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

describe('efeitos do React', () => {
  it('nenhum useEffect devolve o resultado de uma API do navegador', () => {
    const bad = files(SRC).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /use(Layout)?Effect\(\(\) =>\s*(window|document|navigator)\./.test(line))
        .map(({ i }) => `${relative(SRC, f)}:${i + 1}`),
    );
    expect(bad).toEqual([]);
  });
});
