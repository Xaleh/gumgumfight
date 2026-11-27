import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** O mínimo da Web Audio que o `audio.ts` usa, com um aparelho que pode recusar ligar o som (como o iPhone). */
class FakeContext {
  static last: FakeContext;
  /** O aparelho recusa: é o que o WebKit devolve com uma ligação em curso ou outro app segurando o áudio. */
  static refuse = false;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = {};
  resumes = 0;
  started = 0;
  constructor() {
    FakeContext.last = this;
  }
  private node() {
    const node = { gain: { value: 1, setTargetAtTime: () => undefined }, detune: { value: 0 }, buffer: null as unknown, connect: (to: unknown) => to, start: () => void this.started++ };
    return node;
  }
  createGain() {
    return this.node();
  }
  createBufferSource() {
    return this.node();
  }
  decodeAudioData() {
    return Promise.resolve({});
  }
  resume() {
    this.resumes++;
    if (FakeContext.refuse) return Promise.reject(new DOMException('Failed to start the audio device', 'InvalidStateError'));
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

/** Deixa as promessas pendentes terminarem (e o Node acusar as rejeitadas sem tratamento). */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('áudio: o aparelho recusa ligar o som', () => {
  let win: EventTarget & { AudioContext?: typeof FakeContext };
  let doc: EventTarget & { hidden: boolean };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  const boot = async () => {
    const { audio } = await import('../src/audio');
    audio.install();
    return audio;
  };
  const gesture = () => win.dispatchEvent(new Event('pointerdown'));
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden;
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.resetModules();
    FakeContext.refuse = false;
    unhandled.length = 0;
    win = Object.assign(new EventTarget(), { AudioContext: FakeContext });
    doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.unstubAllGlobals();
  });

  it('no primeiro gesto: não vira erro sem tratamento e o gesto seguinte tenta de novo', async () => {
    FakeContext.refuse = true;
    await boot();
    gesture();
    await settle();
    const ctx = FakeContext.last;
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('suspended');
    expect(unhandled).toEqual([]);

    FakeContext.refuse = false;
    gesture();
    await settle();
    expect(FakeContext.last).toBe(ctx); // o mesmo contexto, religado
    expect(ctx.state).toBe('running');
  });

  it('na volta à aba: não vira erro sem tratamento e o próximo gesto religa', async () => {
    await boot();
    gesture();
    await settle();
    const ctx = FakeContext.last;
    setHidden(true);
    expect(ctx.state).toBe('suspended');

    FakeContext.refuse = true;
    setHidden(false);
    await settle();
    expect(ctx.state).toBe('suspended');
    expect(unhandled).toEqual([]);

    FakeContext.refuse = false;
    gesture();
    await settle();
    expect(ctx.state).toBe('running');
  });

  it('com o som ligado, os gestos não chamam resume() de novo', async () => {
    await boot();
    gesture();
    gesture();
    gesture();
    await settle();
    expect(FakeContext.last.resumes).toBe(1);
  });

  it('com a saída suspensa os efeitos não ficam guardados para tocar juntos na volta', async () => {
    const audio = await boot();
    gesture();
    await settle();
    const ctx = FakeContext.last;
    audio.play('draw');
    await settle();
    expect(ctx.started).toBe(1);

    setHidden(true);
    audio.play('draw');
    audio.play('draw');
    await settle();
    setHidden(false);
    await settle();
    expect(ctx.started).toBe(1);

    audio.play('draw');
    await settle();
    expect(ctx.started).toBe(2);
  });

  it('navegador sem Web Audio: fica mudo, sem erro', async () => {
    delete win.AudioContext;
    const audio = await boot();
    gesture();
    gesture();
    audio.play('draw');
    await settle();
    expect(audio.unlocked).toBe(false);
    expect(unhandled).toEqual([]);
  });
});
