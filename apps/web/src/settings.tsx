import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { audio } from './audio';
import { Flag } from './components/Flags';
import { DEFAULT_LOCALE, detectLocale, I18nProvider, isLocale, type Locale, LOCALES, type MessageKey, useT } from './i18n';

export type { Locale };
/** `system` segue o tema do aparelho (prefers-color-scheme). */
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  /** Idioma da interface. O texto das cartas sai traduzido só em pt-BR; nos demais, o original em inglês. */
  locale: Locale;
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
    patch: Partial<Pick<Settings, 'locale' | 'images' | 'quickCounter' | 'animations' | 'replayCues' | 'theme' | 'opponentChat' | 'sfxVolume' | 'musicVolume'>>,
  ) => void;
}

const KEY = 'gumgum.settings';
const DEFAULTS: Settings = {
  locale: DEFAULT_LOCALE,
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

/**
 * Idioma salvo. Versões antigas guardavam `lang: 'pt' | 'en'` (só do texto das cartas): vira
 * `locale`. Sem nada salvo, o idioma do navegador.
 */
function savedLocale(saved: Partial<Settings> & { lang?: unknown }): Locale {
  if (isLocale(saved.locale)) return saved.locale;
  if (saved.lang === 'pt') return 'pt-BR';
  if (saved.lang === 'en') return 'en';
  return detectLocale();
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, locale: detectLocale() };
    const saved = JSON.parse(raw) as Partial<Settings>;
    const theme: Theme = saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system';
    return {
      ...DEFAULTS,
      ...saved,
      locale: savedLocale(saved),
      theme,
      serverImages: false,
      sfxVolume: volume(saved.sfxVolume, DEFAULTS.sfxVolume),
      musicVolume: volume(saved.musicVolume, DEFAULTS.musicVolume),
    };
  } catch {
    return { ...DEFAULTS, locale: detectLocale() };
  }
}

/** Idioma que o app vai usar no primeiro render (para `main.tsx` carregar o dicionário antes). */
export function initialLocale(): Locale {
  return load().locale;
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
            locale: next.locale,
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
      <I18nProvider locale={settings.locale}>{children}</I18nProvider>
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings fora do SettingsProvider');
  return ctx;
}

const THEMES: { id: Theme; label: MessageKey; short?: MessageKey; title: MessageKey }[] = [
  { id: 'system', label: 'settings.themeSystem', short: 'settings.themeSystemShort', title: 'settings.themeSystemTitle' },
  { id: 'light', label: 'settings.themeLight', title: 'settings.themeLightTitle' },
  { id: 'dark', label: 'settings.themeDark', title: 'settings.themeDarkTitle' },
];

/** Seletor de idioma: só as bandeiras, com o nome do idioma no `title`/`aria-label`. */
export function LocaleSeg({ onChange, flagWidth = 26 }: { onChange?: (locale: Locale) => void; flagWidth?: number }) {
  const s = useSettings();
  const t = useT();
  return (
    <div className="seg small locale-seg" role="group" aria-label={t('settings.language')}>
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={s.locale === l.code ? 'on' : ''}
          aria-pressed={s.locale === l.code}
          aria-label={l.name}
          title={l.name}
          lang={l.code}
          onClick={() => {
            s.update({ locale: l.code });
            onChange?.(l.code);
          }}
        >
          <Flag locale={l.code} width={flagWidth} />
        </button>
      ))}
    </div>
  );
}

function ThemeSeg({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const t = useT();
  return (
    <div className="seg small" role="group" aria-label={t('settings.theme')}>
      {THEMES.map((th) => (
        <button key={th.id} className={s.theme === th.id ? 'on' : ''} onClick={() => s.update({ theme: th.id })} title={t(th.title)}>
          {t(compact && th.short ? th.short : th.label)}
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
function VolumeControl({ kind }: { kind: 'sfxVolume' | 'musicVolume' }) {
  const s = useSettings();
  const t = useT();
  const label = t(kind === 'sfxVolume' ? 'settings.sfxLabel' : 'settings.musicLabel');
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
        aria-label={t(value > 0 ? 'settings.muteLabel' : 'settings.unmuteLabel', { what: label })}
        title={t(value > 0 ? 'settings.mute' : 'settings.unmute')}
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
  const t = useT();
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
        placeholder={saved ?? t('settings.nickname')}
        aria-label={t('settings.nickname')}
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn small primary" disabled={!dirty || busy || trimmed.length < 2}>
        {busy ? t('common.saving') : t('common.save')}
      </button>
      {error && <span className="warn small">{error}</span>}
    </form>
  );
}

/** Controles compactos de idioma, tema, imagens, Counter e animações (menu da partida). */
export function SettingsControls() {
  const s = useSettings();
  const t = useT();
  return (
    <div className="settings">
      <div className="setting nickname-setting">
        <label className="sheet-label">{t('settings.nickname')}</label>
        <NicknameField compact />
      </div>
      <div className="setting">
        <LocaleSeg flagWidth={22} />
      </div>
      <div className="setting">
        <ThemeSeg compact />
      </div>
      <label className={['check', s.serverImages ? '' : 'disabled'].join(' ')} title={s.serverImages ? '' : t('settings.imagesOffTitle')}>
        <input
          type="checkbox"
          checked={s.showImages}
          disabled={!s.serverImages}
          onChange={(e) => s.update({ images: e.target.checked })}
        />
        {t('settings.images')}
      </label>
      <label className="check" title={t('settings.quickCounterTitle')}>
        <input type="checkbox" checked={s.quickCounter} onChange={(e) => s.update({ quickCounter: e.target.checked })} />
        {t('settings.quickCounter')}
      </label>
      <label className="check" title={t('settings.animationsHint')}>
        <input type="checkbox" checked={s.animations} onChange={(e) => s.update({ animations: e.target.checked })} />
        {t('settings.animations')}
      </label>
      <label className="check" title={t('settings.replayCuesTitle')}>
        <input type="checkbox" checked={s.replayCues} onChange={(e) => s.update({ replayCues: e.target.checked })} />
        {t('settings.replayCues')}
      </label>
      <label className="check" title={t('settings.opponentChatTitle')}>
        <input type="checkbox" checked={s.opponentChat} onChange={(e) => s.update({ opponentChat: e.target.checked })} />
        {t('settings.opponentChat')}
      </label>
      <div className="setting volume-setting">
        <label className="sheet-label">{t('settings.sfx')}</label>
        <VolumeControl kind="sfxVolume" />
      </div>
      <div className="setting volume-setting">
        <label className="sheet-label">{t('settings.music')}</label>
        <VolumeControl kind="musicVolume" />
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
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet settings-sheet" role="dialog" aria-label={t('settings.dialog')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('settings.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="option-list">
            <OptionRow title={t('settings.nickname')} hint={t('settings.nicknameHint')}>
              <NicknameField />
            </OptionRow>
            <OptionRow title={t('settings.language')} hint={t('settings.languageHint')}>
              <LocaleSeg />
            </OptionRow>
            <OptionRow title={t('settings.theme')} hint={t('settings.themeHint')}>
              <ThemeSeg />
            </OptionRow>
            <OptionRow title={t('settings.images')} hint={s.serverImages ? t('settings.imagesHint') : t('settings.imagesOff')} disabled={!s.serverImages}>
              <Switch on={s.showImages} disabled={!s.serverImages} label={t('settings.images')} onChange={(on) => s.update({ images: on })} />
            </OptionRow>
            <OptionRow title={t('settings.quickCounter')} hint={t('settings.quickCounterHint')}>
              <Switch on={s.quickCounter} label={t('settings.quickCounter')} onChange={(on) => s.update({ quickCounter: on })} />
            </OptionRow>
            <OptionRow title={t('settings.animations')} hint={t('settings.animationsHint')}>
              <Switch on={s.animations} label={t('settings.animations')} onChange={(on) => s.update({ animations: on })} />
            </OptionRow>
            <OptionRow title={t('settings.replayCues')} hint={t('settings.replayCuesHint')}>
              <Switch on={s.replayCues} label={t('settings.replayCues')} onChange={(on) => s.update({ replayCues: on })} />
            </OptionRow>
            <OptionRow title={t('settings.opponentChat')} hint={t('settings.opponentChatHint')}>
              <Switch on={s.opponentChat} label={t('settings.opponentChat')} onChange={(on) => s.update({ opponentChat: on })} />
            </OptionRow>
            <OptionRow title={t('settings.sfx')} hint={t('settings.sfxHint')}>
              <VolumeControl kind="sfxVolume" />
            </OptionRow>
            <OptionRow title={t('settings.music')} hint={t('settings.musicHint')}>
              <VolumeControl kind="musicVolume" />
            </OptionRow>
          </div>
          <p className="muted small">{t('settings.footer')}</p>
        </div>
      </div>
    </div>
  );
}

/** Texto da carta no idioma escolhido: traduzido em pt-BR; original em inglês nos demais. */
export function cardText(
  card: { text: string; trigger?: string; i18n?: { pt?: { text: string; trigger?: string; source: string } } },
  locale: Locale,
) {
  const pt = locale === 'pt-BR' ? card.i18n?.pt : undefined;
  return {
    text: pt?.text ?? card.text,
    trigger: pt ? pt.trigger : card.trigger,
    source: pt?.source ?? 'original',
  };
}
