import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { audio } from './audio';

export type CardLang = 'pt' | 'en';
/** `system` segue o tema do aparelho (prefers-color-scheme). */
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  /** Idioma dos textos das cartas. */
  lang: CardLang;
  /** Preferência do jogador por imagens (só vale se o servidor permitir). */
  images: boolean;
  /** O servidor permite imagens? (CARD_IMAGES) */
  serverImages: boolean;
  /** Etapa de Counter: tocar/arrastar usa a carta na hora, sem confirmar. */
  quickCounter: boolean;
  /** Cartas voando pela mesa, faixa de turno e sorteio com dados. */
  animations: boolean;
  /** Replay: mostra o clique/seleção do jogador (contorno, toque e legenda) antes de cada ação. */
  replayCues: boolean;
  /** Tema claro, escuro ou o do sistema. */
  theme: Theme;
  /** Online: mostrar as mensagens e os emotes que o oponente manda. */
  opponentChat: boolean;
  /** Volume dos efeitos sonoros (0 = mudo … 1). */
  sfxVolume: number;
  /** Volume da música de fundo (0 = mudo … 1). */
  musicVolume: number;
}

interface Ctx extends Settings {
  showImages: boolean;
  /** Tema em uso depois de resolver `system`. */
  resolvedTheme: 'light' | 'dark';
  update: (
    patch: Partial<Pick<Settings, 'lang' | 'images' | 'quickCounter' | 'animations' | 'replayCues' | 'theme' | 'opponentChat' | 'sfxVolume' | 'musicVolume'>>,
  ) => void;
}

const KEY = 'gumgum.settings';
const DEFAULTS: Settings = {
  lang: 'pt',
  images: true,
  serverImages: false,
  quickCounter: false,
  animations: true,
  replayCues: true,
  theme: 'system',
  opponentChat: true,
  sfxVolume: 0.8,
  musicVolume: 0.5,
};

/** Volume salvo: número entre 0 e 1 (qualquer outra coisa volta ao padrão). */
function volume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** Cor da barra do navegador/PWA em cada tema (igual ao `--bg` escuro e ao azul-marinho da marca). */
const THEME_COLOR = { light: '#12304b', dark: '#0b1726' } as const;

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const theme: Theme = saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system';
    return {
      ...DEFAULTS,
      ...saved,
      theme,
      serverImages: false,
      sfxVolume: volume(saved.sfxVolume, DEFAULTS.sfxVolume),
      musicVolume: volume(saved.musicVolume, DEFAULTS.musicVolume),
    };
  } catch {
    return DEFAULTS;
  }
}

function systemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme;
}

/**
 * Aplica o tema no `<html>` (`data-theme`, lido pelo CSS) e na cor da barra do navegador.
 * O `index.html` faz o mesmo antes do React carregar, para não piscar o tema claro.
 */
function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  // O servidor pode ainda estar subindo: tenta algumas vezes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = (attempt: number) =>
      api
        .config()
        .then((c) => !cancelled && setSettings((s) => ({ ...s, serverImages: c.cardImages })))
        .catch(() => {
          if (!cancelled && attempt < 15) timer = setTimeout(() => load(attempt + 1), 2000);
        });
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Áudio: destrava no primeiro gesto do usuário e segue os volumes escolhidos.
  useEffect(() => audio.install(), []);
  useEffect(() => audio.setVolumes({ sfx: settings.sfxVolume, music: settings.musicVolume }), [settings.sfxVolume, settings.musicVolume]);

  // Tema: aplica na hora e, em "Automático", acompanha a troca do sistema.
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(settings.theme));
  useEffect(() => {
    const sync = () => {
      const resolved = resolveTheme(settings.theme);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    sync();
    if (settings.theme !== 'system' || typeof matchMedia !== 'function') return;
    const query = matchMedia(DARK_QUERY);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [settings.theme]);

  const update: Ctx['update'] = (patch) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            lang: next.lang,
            images: next.images,
            quickCounter: next.quickCounter,
            animations: next.animations,
            replayCues: next.replayCues,
            theme: next.theme,
            opponentChat: next.opponentChat,
            sfxVolume: next.sfxVolume,
            musicVolume: next.musicVolume,
          }),
        );
      } catch {
        /* armazenamento indisponível: vale só nesta sessão */
      }
      return next;
    });

  return (
    <SettingsContext.Provider
      value={{ ...settings, showImages: settings.serverImages && settings.images, resolvedTheme, update }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings fora do SettingsProvider');
  return ctx;
}

const THEMES: { id: Theme; label: string; title: string }[] = [
  { id: 'system', label: 'Automático', title: 'Segue o tema do aparelho' },
  { id: 'light', label: 'Claro', title: 'Tema claro' },
  { id: 'dark', label: 'Escuro', title: 'Tema escuro' },
];

function LangSeg() {
  const s = useSettings();
  return (
    <div className="seg small" role="group" aria-label="Textos das cartas">
      <button className={s.lang === 'pt' ? 'on' : ''} onClick={() => s.update({ lang: 'pt' })} title="Tradução para português">
        Português
      </button>
      <button className={s.lang === 'en' ? 'on' : ''} onClick={() => s.update({ lang: 'en' })} title="Texto original em inglês">
        English
      </button>
    </div>
  );
}

function ThemeSeg({ compact }: { compact?: boolean }) {
  const s = useSettings();
  return (
    <div className="seg small" role="group" aria-label="Tema">
      {THEMES.map((t) => (
        <button key={t.id} className={s.theme === t.id ? 'on' : ''} onClick={() => s.update({ theme: t.id })} title={t.title}>
          {compact && t.id === 'system' ? 'Auto' : t.label}
        </button>
      ))}
    </div>
  );
}

/** Interruptor liga/desliga de uma opção. */
function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={['switch', on ? 'on' : ''].join(' ')}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

/**
 * Volume de um canal: botão de mudo (🔊/🔇) e barra de 0 a 100. O botão guarda o último volume
 * para o som voltar como estava; com tudo em zero, volta ao padrão.
 */
function VolumeControl({ kind, label }: { kind: 'sfxVolume' | 'musicVolume'; label: string }) {
  const s = useSettings();
  const value = s[kind];
  const before = useRef(value);
  if (value > 0) before.current = value;
  const toggle = () => s.update({ [kind]: value > 0 ? 0 : before.current > 0 ? before.current : DEFAULTS[kind] });
  return (
    <div className="volume">
      <button
        type="button"
        className="volume-mute"
        onClick={toggle}
        aria-label={value > 0 ? `Silenciar ${label}` : `Ligar ${label}`}
        title={value > 0 ? 'Silenciar' : 'Ligar'}
      >
        {value === 0 ? '🔇' : value < 0.5 ? '🔉' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => s.update({ [kind]: Number(e.target.value) / 100 })}
        onPointerUp={() => kind === 'sfxVolume' && audio.play('play')}
      />
    </div>
  );
}

/** Uma opção do modal: título e explicação à esquerda, controle à direita. */
function OptionRow({ title, hint, disabled, children }: { title: string; hint?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <div className={['option-row', disabled ? 'disabled' : ''].join(' ')}>
      <div className="option-text">
        <div className="option-title">{title}</div>
        {hint && <div className="option-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Apelido do jogador: o nome do perfil deste navegador (`/api/players/me`), que aparece para o oponente nas
 * partidas online, contra o bot e no ranking. Salva no servidor; quem ouvir `gumgum:nickname` atualiza na hora.
 */
export const NICKNAME_EVENT = 'gumgum:nickname';

export function NicknameField({ compact }: { compact?: boolean }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .player()
      .then((p) => {
        if (!cancelled && p) {
          setSaved(p.name);
          setName(p.name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const dirty = trimmed !== (saved ?? '');
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.rename(trimmed);
      setSaved(p.name);
      setName(p.name);
      window.dispatchEvent(new CustomEvent(NICKNAME_EVENT, { detail: p.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={['nickname', compact ? 'compact' : ''].join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && trimmed.length >= 2) void save();
      }}
    >
      <input
        value={name}
        maxLength={24}
        placeholder={saved ?? 'Apelido'}
        aria-label="Apelido"
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn small primary" disabled={!dirty || busy || trimmed.length < 2}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
      {error && <span className="warn small">{error}</span>}
    </form>
  );
}

/** Controles compactos de idioma, tema, imagens, Counter e animações (menu da partida). */
export function SettingsControls() {
  const s = useSettings();
  return (
    <div className="settings">
      <div className="setting nickname-setting">
        <label className="sheet-label">Apelido</label>
        <NicknameField compact />
      </div>
      <div className="setting">
        <LangSeg />
      </div>
      <div className="setting">
        <ThemeSeg compact />
      </div>
      <label
        className={['check', s.serverImages ? '' : 'disabled'].join(' ')}
        title={s.serverImages ? '' : 'Imagens desativadas neste servidor (CARD_IMAGES=off)'}
      >
        <input
          type="checkbox"
          checked={s.showImages}
          disabled={!s.serverImages}
          onChange={(e) => s.update({ images: e.target.checked })}
        />
        Imagens das cartas
      </label>
      <label className="check" title="Na etapa de Counter, tocar numa carta ou arrastá-la até a mesa usa o Counter na hora">
        <input type="checkbox" checked={s.quickCounter} onChange={(e) => s.update({ quickCounter: e.target.checked })} />
        Counter sem confirmação
      </label>
      <label className="check" title="Cartas voando pela mesa, faixa de troca de turno e sorteio inicial com dados">
        <input type="checkbox" checked={s.animations} onChange={(e) => s.update({ animations: e.target.checked })} />
        Animações
      </label>
      <label className="check" title="No replay, mostra o que o jogador clicou ou escolheu (contorno nas cartas, toque e legenda) antes de cada ação">
        <input type="checkbox" checked={s.replayCues} onChange={(e) => s.update({ replayCues: e.target.checked })} />
        Cliques no replay
      </label>
      <label className="check" title="Nas partidas online, mostra as mensagens e os emotes que o oponente manda">
        <input type="checkbox" checked={s.opponentChat} onChange={(e) => s.update({ opponentChat: e.target.checked })} />
        Chat do oponente
      </label>
      <div className="setting volume-setting">
        <label className="sheet-label">Efeitos sonoros</label>
        <VolumeControl kind="sfxVolume" label="efeitos sonoros" />
      </div>
      <div className="setting volume-setting">
        <label className="sheet-label">Música</label>
        <VolumeControl kind="musicVolume" label="música" />
      </div>
    </div>
  );
}

/**
 * Modal de configurações (aberto no menu): cada opção de jogo com uma explicação e um interruptor
 * ou seletor. As escolhas ficam guardadas neste navegador (`localStorage`).
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet settings-sheet" role="dialog" aria-label="Configurações" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>⚙️ Configurações</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="option-list">
            <OptionRow title="Apelido" hint="O nome que o oponente vê nas partidas online e contra o bot, e que aparece no ranking (2 a 24 letras).">
              <NicknameField />
            </OptionRow>
            <OptionRow title="Textos das cartas" hint="Tradução automática para português ou o texto original em inglês.">
              <LangSeg />
            </OptionRow>
            <OptionRow title="Tema" hint="Claro, escuro ou o mesmo do aparelho.">
              <ThemeSeg />
            </OptionRow>
            <OptionRow
              title="Imagens das cartas"
              hint={
                s.serverImages
                  ? 'Mostra a arte oficial das cartas. Desligue para carregar menos dados.'
                  : 'Desativadas neste servidor (CARD_IMAGES=off).'
              }
              disabled={!s.serverImages}
            >
              <Switch on={s.showImages} disabled={!s.serverImages} label="Imagens das cartas" onChange={(on) => s.update({ images: on })} />
            </OptionRow>
            <OptionRow title="Counter sem confirmação" hint="Na etapa de Counter, tocar numa carta (ou arrastá-la até a mesa) usa o Counter na hora.">
              <Switch on={s.quickCounter} label="Counter sem confirmação" onChange={(on) => s.update({ quickCounter: on })} />
            </OptionRow>
            <OptionRow title="Animações" hint="Cartas voando pela mesa, faixa de troca de turno e sorteio inicial com dados.">
              <Switch on={s.animations} label="Animações" onChange={(on) => s.update({ animations: on })} />
            </OptionRow>
            <OptionRow
              title="Cliques no replay"
              hint="Ao assistir a um replay, mostra o que o jogador clicou ou escolheu (contorno nas cartas, toque e legenda) antes de cada ação. Desligue para ver só a mesa."
            >
              <Switch on={s.replayCues} label="Cliques no replay" onChange={(on) => s.update({ replayCues: on })} />
            </OptionRow>
            <OptionRow
              title="Chat do oponente"
              hint="Nas partidas online, mostra as mensagens e os emotes que o oponente manda. Desligue para não ver nada que ele escreve; as suas mensagens continuam saindo."
            >
              <Switch on={s.opponentChat} label="Chat do oponente" onChange={(on) => s.update({ opponentChat: on })} />
            </OptionRow>
            <OptionRow title="Efeitos sonoros" hint="Cartas, DON!!, ataques, dano, dados e o resultado da partida. No iPhone, a chave de silencioso também vale.">
              <VolumeControl kind="sfxVolume" label="efeitos sonoros" />
            </OptionRow>
            <OptionRow title="Música" hint="Trilha original do GumGum Fight no menu e na partida.">
              <VolumeControl kind="musicVolume" label="música" />
            </OptionRow>
          </div>
          <p className="muted small">As configurações ficam guardadas neste navegador e valem para todas as partidas. O apelido fica no servidor, ligado a este navegador.</p>
        </div>
      </div>
    </div>
  );
}

/** Texto da carta no idioma escolhido. */
export function cardText(
  card: { text: string; trigger?: string; i18n?: { pt?: { text: string; trigger?: string; source: string } } },
  lang: CardLang,
) {
  const pt = lang === 'pt' ? card.i18n?.pt : undefined;
  return {
    text: pt?.text ?? card.text,
    trigger: pt ? pt.trigger : card.trigger,
    source: pt?.source ?? 'original',
  };
}
