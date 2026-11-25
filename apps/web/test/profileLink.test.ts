import { describe, expect, it } from 'vitest';
import de from '../src/i18n/profile/de';
import en from '../src/i18n/profile/en';
import es from '../src/i18n/profile/es';
import fr from '../src/i18n/profile/fr';
import ja from '../src/i18n/profile/ja';
import ptBR from '../src/i18n/profile/pt-BR';
import { PROFILE_PARAM, parseProfileParam, profileUrl } from '../src/profileLink';

describe('link do perfil público (?perfil=)', () => {
  it('lê um id de jogador válido (sem diferenciar maiúsculas)', () => {
    expect(parseProfileParam(new URLSearchParams({ [PROFILE_PARAM]: 'p-0123456789ab' }))).toBe('p-0123456789ab');
    expect(parseProfileParam(new URLSearchParams({ [PROFILE_PARAM]: ' P-0123456789AB ' }))).toBe('p-0123456789ab');
  });

  it('ignora o que não é id de jogador', () => {
    for (const v of ['', 'p-123', 'u-0123456789ab', '../api/admin', 'p-0123456789ab/x']) {
      expect(parseProfileParam(new URLSearchParams({ [PROFILE_PARAM]: v }))).toBeNull();
    }
    expect(parseProfileParam(new URLSearchParams())).toBeNull();
  });

  it('monta o endereço para compartilhar, que volta ao mesmo id', () => {
    const url = profileUrl('p-0123456789ab', 'https://gumgumfight.app');
    expect(url).toBe('https://gumgumfight.app/?perfil=p-0123456789ab');
    expect(parseProfileParam(new URL(url).searchParams)).toBe('p-0123456789ab');
  });

  it('os seis idiomas têm as mesmas chaves do pt-BR e os mesmos parâmetros', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const dict of [en, es, ja, fr, de] as Array<Record<string, string>>) {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(ptBR).sort());
      for (const [k, v] of Object.entries(ptBR)) expect(params(dict[k]), k).toEqual(params(v));
    }
  });
});
