import { describe, expect, it } from 'vitest';
import { embedOriginAllowed, isReplayPath, parseEmbedCommand, parseReplayEmbed } from '../src/embed';

const TOKEN = `${(1_800_000_000).toString(36)}.${'a'.repeat(43)}`;

describe('link do replay embutido (/replay/<id>?t=)', () => {
  it('lê id, token, embed, idioma, layout e autoplay', () => {
    const r = parseReplayEmbed('/replay/42', `?t=${TOKEN}&embed=1&lang=pt-BR&layout=lateral&autoplay=1`);
    expect(r).toEqual({ matchId: 42, token: TOKEN, embed: true, lang: 'pt-BR', layout: 'lateral', autoplay: true });
  });

  it('sem os opcionais: fora do embed, parado no início, idioma e layout do aparelho', () => {
    expect(parseReplayEmbed('/replay/7/', new URLSearchParams({ t: TOKEN }))).toEqual({ matchId: 7, token: TOKEN, embed: false, autoplay: false });
  });

  it('idioma: o código exato ou só a língua; desconhecido fica de fora', () => {
    const lang = (v: string) => parseReplayEmbed('/replay/1', new URLSearchParams({ t: TOKEN, lang: v }))?.lang;
    expect(lang('en')).toBe('en');
    expect(lang('en-US')).toBe('en');
    expect(lang('pt')).toBe('pt-BR');
    expect(lang('PT-pt')).toBe('pt-BR');
    expect(lang('ja')).toBe('ja');
    expect(lang('xx')).toBeUndefined();
  });

  it('layout desconhecido fica de fora; embed só com 1', () => {
    const r = parseReplayEmbed('/replay/1', new URLSearchParams({ t: TOKEN, layout: 'grande', embed: 'true' }));
    expect(r).toEqual({ matchId: 1, token: TOKEN, embed: false, autoplay: false });
  });

  it('caminho ou token inválidos: null', () => {
    expect(parseReplayEmbed('/replay/abc', `?t=${TOKEN}`)).toBeNull();
    expect(parseReplayEmbed('/replay/0', `?t=${TOKEN}`)).toBeNull();
    expect(parseReplayEmbed('/replay/1/extra', `?t=${TOKEN}`)).toBeNull();
    expect(parseReplayEmbed('/replays/1', `?t=${TOKEN}`)).toBeNull();
    expect(parseReplayEmbed('/replay/1', '')).toBeNull();
    expect(parseReplayEmbed('/replay/1', '?t=abc')).toBeNull();
    expect(parseReplayEmbed('/replay/1', `?t=${TOKEN}x`)).toBeNull();
    expect(isReplayPath('/replay/abc')).toBe(true);
    expect(isReplayPath('/')).toBe(false);
  });
});

describe('comandos por postMessage', () => {
  it('seek com posição inteira, play e pause', () => {
    expect(parseEmbedCommand({ type: 'seek', pos: 5 })).toEqual({ type: 'seek', pos: 5 });
    expect(parseEmbedCommand({ type: 'seek', pos: 0 })).toEqual({ type: 'seek', pos: 0 });
    expect(parseEmbedCommand({ type: 'play', extra: 1 })).toEqual({ type: 'play' });
    expect(parseEmbedCommand({ type: 'pause' })).toEqual({ type: 'pause' });
  });

  it('o resto é ignorado (mensagens de outras bibliotecas, posição inválida)', () => {
    for (const bad of [null, undefined, 'play', 3, {}, { type: 'seek' }, { type: 'seek', pos: -1 }, { type: 'seek', pos: 1.5 }, { type: 'seek', pos: '3' }, { type: 'stop' }]) {
      expect(parseEmbedCommand(bad)).toBeNull();
    }
  });

  it('origem: só as liberadas pelo servidor e o próprio site', () => {
    const allowed = ['https://sweet.example'];
    expect(embedOriginAllowed('https://sweet.example', allowed, 'https://gumgumfight.app')).toBe(true);
    expect(embedOriginAllowed('https://gumgumfight.app', allowed, 'https://gumgumfight.app')).toBe(true);
    expect(embedOriginAllowed('https://evil.example', allowed, 'https://gumgumfight.app')).toBe(false);
    expect(embedOriginAllowed('null', allowed, 'https://gumgumfight.app')).toBe(false);
  });
});
