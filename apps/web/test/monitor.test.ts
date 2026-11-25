import { describe, expect, it } from 'vitest';
import { createReporter, isNoise, MAX_PER_PAGE, type WebErrorReport } from '../src/monitor';

const base: WebErrorReport = { kind: 'window', message: 'TypeError: x is undefined', url: '/', release: 'index-abc.js' };

describe('relator de erros do navegador', () => {
  it('manda o caminho sem query string e corta mensagens longas', () => {
    const sent: WebErrorReport[] = [];
    const report = createReporter({ send: (r) => sent.push(r) });
    expect(report({ ...base, url: '/?sala=ABCDEF&t=segredo', message: 'x'.repeat(900) })).toBe(true);
    expect(sent[0].url).toBe('/');
    expect(sent[0].message.length).toBe(500);
  });

  it('não repete o mesmo erro em menos de 1 min e para no limite da página', () => {
    let t = 0;
    const sent: WebErrorReport[] = [];
    const report = createReporter({ send: (r) => sent.push(r), now: () => t });
    expect(report(base)).toBe(true);
    expect(report(base)).toBe(false);
    t += 61_000;
    expect(report(base)).toBe(true);
    for (let i = 0; i < MAX_PER_PAGE * 2; i++) report({ ...base, message: `erro ${i}` });
    expect(sent.length).toBe(MAX_PER_PAGE);
  });

  it('ignora o barulho que não é erro do site', () => {
    expect(isNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isNoise('Script error.')).toBe(true);
    expect(isNoise('TypeError: boom', 'at f (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(isNoise('TypeError: boom', 'at f (https://gumgumfight.app/assets/index.js:1:1)')).toBe(false);
    const sent: WebErrorReport[] = [];
    createReporter({ send: (r) => sent.push(r) })({ ...base, message: 'Script error.' });
    expect(sent).toEqual([]);
  });
});
