import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api';

export type CardLang = 'pt' | 'en';

export interface Settings {
  /** Idioma dos textos das cartas. */
  lang: CardLang;
  /** Preferência do jogador por imagens (só vale se o servidor permitir). */
  images: boolean;
  /** O servidor permite imagens? (CARD_IMAGES) */
  serverImages: boolean;
}

interface Ctx extends Settings {
  showImages: boolean;
  update: (patch: Partial<Pick<Settings, 'lang' | 'images'>>) => void;
}

const KEY = 'gumgum.settings';
const DEFAULTS: Settings = { lang: 'pt', images: true, serverImages: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw), serverImages: false } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
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

  const update: Ctx['update'] = (patch) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify({ lang: next.lang, images: next.images }));
      } catch {
        /* armazenamento indisponível: vale só nesta sessão */
      }
      return next;
    });

  return (
    <SettingsContext.Provider value={{ ...settings, showImages: settings.serverImages && settings.images, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings fora do SettingsProvider');
  return ctx;
}

/** Controles de idioma e imagens (usados no menu e durante a partida). */
export function SettingsControls({ compact }: { compact?: boolean }) {
  const s = useSettings();
  return (
    <div className={compact ? 'settings compact' : 'settings'}>
      <div className="setting">
        {!compact && <label>Textos das cartas</label>}
        <div className="seg small">
          <button className={s.lang === 'pt' ? 'on' : ''} onClick={() => s.update({ lang: 'pt' })} title="Tradução para português">
            Português
          </button>
          <button className={s.lang === 'en' ? 'on' : ''} onClick={() => s.update({ lang: 'en' })} title="Texto original em inglês">
            English
          </button>
        </div>
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
        Imagens das cartas{!s.serverImages && !compact ? ' (desativadas no servidor)' : ''}
      </label>
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
