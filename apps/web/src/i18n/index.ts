// Idiomas da interface: dicionários por idioma, função `t()` e o hook `useT()`.
//
// Cada idioma é um arquivo em `./<locale>.ts` com as mesmas chaves de `pt-BR.ts` (o TypeScript
// falha se faltar ou sobrar alguma). O português fica no bundle principal; os demais carregam
// por `import()` quando escolhidos. Fora de componentes (abilityText, replayCue, api) vale o
// `t()` deste módulo, que usa o idioma em vigor; dentro de componentes use `useT()`, que
// re-renderiza ao trocar o idioma.
//
// Sintaxe das mensagens:
//   {nome}               valor do parâmetro `nome`
//   {n|# carta|# cartas} plural pelo parâmetro `n` (Intl.PluralRules: forma "one" | "other");
//                        `#` vira o número formatado no idioma. Com uma forma só, serve para tudo.

import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import ptBR, { type MessageKey, type Messages } from './pt-BR';

export type { MessageKey, Messages };

export type Locale = 'pt-BR' | 'en' | 'es' | 'ja' | 'fr' | 'de';

/** Idiomas na ordem do seletor; `name` é o nome no próprio idioma (não se traduz). */
export const LOCALES: ReadonlyArray<{ code: Locale; name: string }> = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && LOCALES.some((l) => l.code === v);
}

/** Idioma do navegador na primeira visita (sem preferência salva). Nada reconhecido → inglês. */
export function detectLocale(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (base === 'en') return 'en';
    if (base === 'es') return 'es';
    if (base === 'ja') return 'ja';
    if (base === 'fr') return 'fr';
    if (base === 'de') return 'de';
  }
  return 'en';
}

export type Params = Record<string, string | number | undefined | null>;

const loaded: Partial<Record<Locale, Messages>> = { 'pt-BR': ptBR };
const loaders: Record<Exclude<Locale, 'pt-BR'>, () => Promise<{ default: Messages }>> = {
  en: () => import('./en'),
  es: () => import('./es'),
  ja: () => import('./ja'),
  fr: () => import('./fr'),
  de: () => import('./de'),
};

/** Garante o dicionário do idioma em memória (o pt-BR já está). */
export async function loadLocale(locale: Locale): Promise<Messages> {
  const have = loaded[locale];
  if (have) return have;
  const mod = await loaders[locale as Exclude<Locale, 'pt-BR'>]();
  loaded[locale] = mod.default;
  return mod.default;
}

const plurals = new Map<Locale, Intl.PluralRules>();
function pluralRules(locale: Locale): Intl.PluralRules {
  let pr = plurals.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    plurals.set(locale, pr);
  }
  return pr;
}

const PLURAL = /\{(\w+)\|([^{}]*)\}/g;
const PARAM = /\{(\w+)\}/g;

/** Preenche parâmetros e plurais de uma mensagem já escolhida. */
export function format(message: string, locale: Locale, params?: Params): string {
  if (!params) return message;
  const out = message
    .replace(PLURAL, (_, name: string, body: string) => {
      const raw = params[name];
      const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
      const forms = body.split('|');
      const form = forms.length > 1 && pluralRules(locale).select(n) !== 'one' ? forms[1] : forms[0];
      return form.replace(/#/g, Number.isFinite(n) ? n.toLocaleString(locale) : String(raw ?? ''));
    })
    .replace(PARAM, (m, name: string) => {
      const v = params[name];
      return v === undefined || v === null ? m : String(v);
    });
  return out;
}

export type Translate = (key: MessageKey, params?: Params) => string;

/** Tradução de uma chave num idioma específico (cai no inglês, depois no português, se faltar). */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const msg = loaded[locale]?.[key] ?? loaded.en?.[key] ?? ptBR[key] ?? key;
  return format(msg, locale, params);
}

let current: Locale = DEFAULT_LOCALE;
/** Idioma em vigor (o do `I18nProvider`). */
export const currentLocale = () => current;

/** `t()` fora de componentes: usa o idioma em vigor. Em componentes, prefira `useT()`. */
export const t: Translate = (key, params) => translate(current, key, params);

/** A chave existe no dicionário? (Para chaves que chegam do motor ou do servidor como texto.) */
export function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(ptBR, key);
}

/**
 * Tradução de uma chave que pode não existir (`promptKey` do motor, `code` do servidor):
 * `undefined` quando o dicionário não a conhece, para quem chama cair no texto que veio junto.
 */
export function tryT(key: string | undefined | null, params?: Params, locale: Locale = current): string | undefined {
  return key && hasKey(key) ? translate(locale, key, params) : undefined;
}

interface I18nCtx {
  locale: Locale;
  t: Translate;
}
const I18nContext = createContext<I18nCtx | null>(null);

/**
 * Carrega o dicionário do idioma escolhido e expõe `t`. Enquanto um idioma novo baixa, a tela
 * continua no anterior; `main.tsx` carrega o idioma salvo antes do primeiro render.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [ready, setReady] = useState<Locale>(() => (loaded[locale] ? locale : current));
  useEffect(() => {
    if (loaded[locale]) {
      setReady(locale);
      return;
    }
    let cancelled = false;
    loadLocale(locale)
      .then(() => !cancelled && setReady(locale))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locale]);
  current = ready;
  useEffect(() => {
    document.documentElement.lang = ready;
  }, [ready]);
  const tr = useCallback<Translate>((key, params) => translate(ready, key, params), [ready]);
  return createElement(I18nContext.Provider, { value: { locale: ready, t: tr } }, children);
}

/** `t` do idioma em vigor; o componente re-renderiza quando o idioma troca. */
export function useT(): Translate {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT fora do I18nProvider');
  return ctx.t;
}

/** `tryT` do idioma em vigor (re-renderiza ao trocar o idioma). */
export function useTryT(): (key: string | undefined | null, params?: Params) => string | undefined {
  const locale = useLocale();
  return useCallback((key, params) => tryT(key, params, locale), [locale]);
}

/** Idioma em vigor (já carregado), para formatar datas e números. */
export function useLocale(): Locale {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale fora do I18nProvider');
  return ctx.locale;
}
