/**
 * Áudio do jogo: efeitos sonoros e música de fundo, com a Web Audio API.
 *
 * - Dois canais com volume próprio (efeitos e música), ajustados em Configurações.
 * - Os navegadores só tocam som depois de um gesto do usuário: o primeiro toque ou tecla
 *   "destrava" o áudio (`install`). Até lá os pedidos de música ficam guardados e os
 *   efeitos são ignorados.
 * - Os efeitos têm variações (`draw-1.mp3`, `draw-2.mp3`, …), sorteadas a cada toque e com
 *   uma pequena variação de tom, para não soar repetitivo. São baixados e decodificados
 *   assim que o áudio destrava.
 * - A música é um `AudioBufferSourceNode` em loop (emenda sem corte, ao contrário do
 *   `<audio loop>`) e troca de faixa com crossfade. É baixada só quando pedida.
 * - Aba escondida: o contexto é suspenso (a música para e não gasta bateria).
 * - No iPhone a Web Audio respeita a chave de silencioso, como o card pede.
 *
 * Os arquivos ficam em `assets/audio` (MP3, o único formato que iOS, Android e desktop tocam
 * sem dúvida); a origem e a licença de cada um estão em `assets/audio/CREDITS.md`.
 */

export type SfxName =
  | 'draw'
  | 'shuffle'
  | 'play'
  | 'don'
  | 'attack'
  | 'block'
  | 'counter'
  | 'hit'
  | 'ko'
  | 'ability'
  | 'trigger'
  | 'turn'
  | 'dice-shake'
  | 'dice-throw'
  | 'chat'
  | 'win'
  | 'lose'
  | 'tie';
export type MusicName = 'menu' | 'battle';

// Vite empacota os arquivos com hash no nome e devolve só a URL (o download fica para a hora de usar).
const SFX_URLS = import.meta.glob('./assets/audio/sfx/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const MUSIC_URLS = import.meta.glob('./assets/audio/music/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Vinhetas do fim da partida: tocam no canal dos efeitos (quem desliga a música ainda ouve o resultado). */
const JINGLES: Record<string, SfxName> = { win: 'win', lose: 'lose', draw: 'tie' };

/** `draw-1.mp3` → `draw`; `shuffle.mp3` → `shuffle`. */
function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.mp3$/, '');
  return file.replace(/-\d+$/, '');
}

function groupVariants(): Map<SfxName, string[]> {
  const out = new Map<SfxName, string[]>();
  for (const [path, url] of Object.entries(SFX_URLS)) {
    const name = baseName(path) as SfxName;
    const list = out.get(name) ?? [];
    list.push(url);
    out.set(name, list);
  }
  for (const [path, url] of Object.entries(MUSIC_URLS)) {
    const jingle = JINGLES[baseName(path)];
    if (jingle) out.set(jingle, [url]);
  }
  return out;
}

interface PlayOptions {
  /** Ganho relativo (1 = normal). */
  gain?: number;
  /** Variação de tom em semitons para cada lado (0 = sem variação). */
  detune?: number;
  /** Atraso em ms. */
  delay?: number;
}

const FADE = 0.9;
/** Curva do volume: o ouvido percebe o ganho em escala logarítmica. */
const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

class GameAudio {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private volumes = { sfx: 0.8, music: 0.5 };
  private readonly variants = groupVariants();
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly lastVariant = new Map<SfxName, number>();
  private playing: { name: MusicName; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Música pedida (toca quando o áudio destravar ou quando o arquivo chegar). */
  private wanted: MusicName | null = null;
  private musicRequest = 0;
  private installed = false;

  /** O áudio já foi destravado por um gesto do usuário? */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Registra o destravamento no primeiro gesto e a pausa com a aba escondida. Chame uma vez. */
  install() {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const unlock = () => {
      if (this.unlock()) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        window.removeEventListener('touchend', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private unlock(): boolean {
    if (this.ctx) return true;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return true; // navegador sem Web Audio: fica mudo, sem erro
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(ctx.destination);
      this.musicBus.connect(ctx.destination);
      this.applyVolumes();
      void ctx.resume();
    } catch {
      return true;
    }
    // Pré-carrega os efeitos (pequenos: uns 330 KB ao todo) e começa a música pedida.
    for (const urls of this.variants.values()) for (const u of urls) void this.load(u);
    if (this.wanted) void this.start(this.wanted);
    return true;
  }

  setVolumes(v: { sfx: number; music: number }) {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.02);
    this.musicBus.gain.setTargetAtTime(curve(this.volumes.music), t, 0.05);
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }

  /** Toca um efeito (ignorado antes do destravamento ou com o volume em zero). */
  play(name: SfxName, opts: PlayOptions = {}) {
    const ctx = this.ctx;
    const urls = this.variants.get(name);
    if (!ctx || !this.sfxBus || !urls?.length || this.volumes.sfx <= 0) return;
    // Sorteia uma variação diferente da última.
    let i = Math.floor(Math.random() * urls.length);
    if (urls.length > 1 && i === this.lastVariant.get(name)) i = (i + 1) % urls.length;
    this.lastVariant.set(name, i);
    const bus = this.sfxBus;
    void this.load(urls[i]).then((buffer) => {
      if (!buffer || this.ctx !== ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const detune = opts.detune ?? 1;
      if (detune > 0) src.detune.value = (Math.random() * 2 - 1) * detune * 100;
      const gain = ctx.createGain();
      gain.gain.value = opts.gain ?? 1;
      src.connect(gain).connect(bus);
      src.start(ctx.currentTime + (opts.delay ?? 0) / 1000);
    });
  }

  /** Vinheta do resultado: vitória, derrota ou empate. */
  jingle(kind: 'win' | 'lose' | 'draw') {
    this.play(JINGLES[kind], { detune: 0, gain: 0.9 });
  }

  /** Troca a música de fundo (com crossfade) ou a desliga (`null`). */
  music(name: MusicName | null) {
    this.wanted = name;
    if (!this.ctx) return;
    if (name === null) this.stop();
    else if (this.playing?.name !== name) void this.start(name);
  }

  private async start(name: MusicName) {
    const ctx = this.ctx;
    const url = MUSIC_URLS[`./assets/audio/music/${name}.mp3`];
    if (!ctx || !this.musicBus || !url) return;
    const request = ++this.musicRequest;
    const buffer = await this.load(url);
    // Enquanto o arquivo baixava, outra faixa foi pedida (ou a mesma já está tocando).
    if (!buffer || request !== this.musicRequest || this.wanted !== name || this.playing?.name === name) return;
    this.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + FADE);
    source.connect(gain).connect(this.musicBus);
    source.start(t);
    this.playing = { name, source, gain };
  }

  private stop() {
    const ctx = this.ctx;
    const cur = this.playing;
    if (!ctx || !cur) return;
    this.playing = null;
    const t = ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(Math.max(0.0001, cur.gain.gain.value), t);
    cur.gain.gain.exponentialRampToValueAtTime(0.0001, t + FADE);
    cur.source.stop(t + FADE + 0.05);
  }
}

export const audio = new GameAudio();
