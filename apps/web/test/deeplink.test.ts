import { parseDeckList } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url, parseDeckLink } from '../src/deeplink';

const LIST = '1xOP01-001\n4xOP01-016\n2xST01-013';

describe('deep link do construtor (?deck=)', () => {
  it('lê uma lista válida, com nome e formato', () => {
    const params = new URLSearchParams({ deck: encodeBase64Url(LIST), name: '  Meu   Luffy  ', format: 'egb' });
    const r = parseDeckLink(params);
    expect(r).toEqual({ link: { text: LIST, name: 'Meu Luffy', format: 'egb' }, invalid: false });
    const parsed = parseDeckList(r.link!.text);
    expect(parsed.cards).toEqual([
      { id: 'OP01-001', count: 1 },
      { id: 'OP01-016', count: 4 },
      { id: 'ST01-013', count: 2 },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it('aceita base64url com ou sem padding, com acentos no texto, e o formato do btoa do navegador', () => {
    const text = '1xOP01-001 # Líder ação\n4xOP01-016';
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
    const padded = btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_');
    expect(padded.endsWith('=')).toBe(true);
    expect(decodeBase64Url(padded)).toBe(text);
  });

  it('base64 quebrado ou lista vazia: inválido; sem o parâmetro: não é um link', () => {
    expect(parseDeckLink(new URLSearchParams({ deck: '%%%não' }))).toEqual({ link: null, invalid: true });
    expect(parseDeckLink(new URLSearchParams({ deck: 'abc' }))).toEqual({ link: null, invalid: true });
    expect(parseDeckLink(new URLSearchParams({ deck: encodeBase64Url('   \n  ') }))).toEqual({ link: null, invalid: true });
    expect(parseDeckLink(new URLSearchParams({ deck: encodeBase64Url('x'.repeat(10_000)) }))).toEqual({ link: null, invalid: true });
    expect(decodeBase64Url('gA')).toBeNull(); // byte inválido em UTF-8
    expect(parseDeckLink(new URLSearchParams({ name: 'x' }))).toEqual({ link: null, invalid: false });
  });

  it('ignora formato desconhecido e corta o nome em 60 caracteres', () => {
    const r = parseDeckLink(new URLSearchParams({ deck: encodeBase64Url(LIST), name: 'a'.repeat(80), format: 'legacy' }));
    expect(r.link).toEqual({ text: LIST, name: 'a'.repeat(60) });
  });

  it('uma linha inválida chega ao parser do construtor como erro, sem derrubar o resto', () => {
    const r = parseDeckLink(new URLSearchParams({ deck: encodeBase64Url('1xOP01-001\nisto não é carta\n4xOP01-016') }));
    const parsed = parseDeckList(r.link!.text);
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.errorDetails).toEqual([expect.objectContaining({ code: 'rules.listBadLine' })]);
  });
});
