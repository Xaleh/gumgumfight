import type { SandboxSpec } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { encodeBase64Url } from '../src/deeplink';
import { encodeSandbox, parseSandboxLink, SANDBOX_PARAM, sandboxUrl } from '../src/game/sandboxLink';

const spec: SandboxSpec = {
  turn: 4,
  active: 1,
  sides: [
    { leader: { id: 'ST01-001', don: 1 }, hand: ['ST01-014'], characters: [{ id: 'ST01-013', rested: true, don: 2 }], life: 3, donActive: 2 },
    { leader: { id: 'ST03-001' }, characters: [{ id: 'ST03-008', fresh: true }], stage: { id: 'ST03-015' }, trash: ['ST03-017'], deckTop: ['ST03-004'] },
  ],
};

const params = (url: string) => new URL(url).searchParams;

describe('link do Sandbox de regras', () => {
  it('ida e volta pelo endereço', () => {
    const url = sandboxUrl(spec, 'https://gumgum.example');
    expect(url.startsWith(`https://gumgum.example/?${SANDBOX_PARAM}=`)).toBe(true);
    expect(parseSandboxLink(params(url))).toEqual({ spec, invalid: false });
  });

  it('o link não leva os valores padrão (fica curto)', () => {
    const verbose: SandboxSpec = {
      ...spec,
      sides: [{ ...spec.sides[0], leader: { id: 'ST01-001', rested: false, don: 1 }, trash: [] }, spec.sides[1]],
    };
    expect(encodeSandbox(verbose)).toBe(encodeSandbox(spec));
    expect(encodeSandbox(spec).length).toBeLessThan(500);
  });

  it('sem o parâmetro não é um link do sandbox; com lixo, é inválido', () => {
    expect(parseSandboxLink(new URLSearchParams('deck=abc'))).toEqual({ spec: null, invalid: false });
    for (const raw of ['%%%', encodeBase64Url('não é json'), encodeBase64Url('{"turn":1}'), 'A'.repeat(9000)]) {
      expect(parseSandboxLink(new URLSearchParams({ [SANDBOX_PARAM]: raw }))).toEqual({ spec: null, invalid: true });
    }
  });
});
