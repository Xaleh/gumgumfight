// Guarda contra uma queda do WebKit de Linux (WPE/GTK, o que o Playwright usa no projeto iphone do e2e).
//
// Uma animação de `filter` (ou `backdrop-filter`) com dois quadros seguidos em `none` e uma função de
// filtro em outro quadro (`blur(10px) → none → none → blur(10px)`) derruba o processo da página: segfault
// de ponteiro nulo na thread ThreadedCompositor da libWPEWebKit. Foi assim que a faixa de troca de turno
// (`tb-sweep`) derrubava a mesa no CI. Com `blur(0)` no lugar de `none` o visual é o mesmo e não cai.
// A evidência está em docs/plano-testes-e2e.md ("Queda da mesa no WebKit de Linux").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROPS = ['filter', 'backdrop-filter', '-webkit-backdrop-filter'];

interface Frame {
  offset: number;
  decl: Record<string, string>;
}

/** Os `@keyframes` de um CSS: nome e quadros em ordem (`from`/`to` e seletores com vírgula já abertos). */
function keyframes(css: string): { name: string; frames: Frame[] }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const at = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m = at.exec(clean); m; m = at.exec(clean)) {
    let end = at.lastIndex;
    for (let depth = 1; end < clean.length && depth > 0; end++) depth += clean[end] === '{' ? 1 : clean[end] === '}' ? -1 : 0;
    const frames: Frame[] = [];
    for (const [, selectors, body] of clean.slice(at.lastIndex, end - 1).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl: Record<string, string> = {};
      for (const d of body.split(';')) {
        const colon = d.indexOf(':');
        if (colon > 0) decl[d.slice(0, colon).trim()] = d.slice(colon + 1).trim();
      }
      for (const s of selectors.split(',').map((x) => x.trim())) frames.push({ offset: s === 'from' ? 0 : s === 'to' ? 100 : parseFloat(s), decl });
    }
    out.push({ name: m[1], frames: frames.sort((a, b) => a.offset - b.offset) });
  }
  return out;
}

/** As animações com o formato que derruba: a propriedade tem uma função de filtro e dois quadros seguidos em `none`. */
function crashing(css: string): string[] {
  const bad = [];
  for (const { name, frames } of keyframes(css)) {
    for (const prop of PROPS) {
      const values = frames.filter((f) => prop in f.decl).map((f) => f.decl[prop]);
      const twoNone = values.some((v, i) => v === 'none' && values[i + 1] === 'none');
      if (twoNone && values.some((v) => v !== 'none')) bad.push(`${name} (${prop})`);
    }
  }
  return bad;
}

describe('animações de filter no CSS', () => {
  it('reconhece o formato que derruba o WebKit de Linux', () => {
    const none = '@keyframes a { 0% { filter: blur(10px); } 20%, 78% { filter: none; } to { filter: blur(10px); } }';
    expect(crashing(none)).toEqual(['a (filter)']);
    expect(crashing(none.replace('filter: none', 'filter: blur(0)'))).toEqual([]);
    // Um `none` só entre dois quadros com filtro não derruba.
    expect(crashing('@keyframes b { 0% { filter: blur(4px); } 50% { filter: none; } 100% { filter: blur(4px); } }')).toEqual([]);
  });

  it('nenhuma animação do app tem dois quadros seguidos com filter: none', () => {
    const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
    expect(keyframes(css).length).toBeGreaterThan(50);
    expect(crashing(css)).toEqual([]);
  });
});
