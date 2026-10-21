// Datas, horas e números no idioma em vigor (fora de componentes usa `currentLocale()`).

import { currentLocale, type Locale } from './index';

const loc = (l?: Locale) => l ?? currentLocale();

/** 10/10/2026 14:03 (curto, com hora). */
export const fmtDateTime = (d: Date | string | number, locale?: Locale) =>
  new Date(d).toLocaleString(loc(locale), { dateStyle: 'short', timeStyle: 'short' });

/** 10/10/2026 (só a data, curta). */
export const fmtDate = (d: Date | string | number, locale?: Locale) => new Date(d).toLocaleDateString(loc(locale), { dateStyle: 'short' });

/** 14:03. */
export const fmtTime = (d: Date | string | number, locale?: Locale) =>
  new Date(d).toLocaleTimeString(loc(locale), { hour: '2-digit', minute: '2-digit' });

/** sáb., 10/10 14:03 (dia da semana curto, dia/mês e hora). */
export const fmtWeekdayTime = (d: Date | string | number, locale?: Locale) =>
  new Date(d).toLocaleString(loc(locale), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 12.345 / 12,345 conforme o idioma. */
export const fmtNumber = (n: number, locale?: Locale) => n.toLocaleString(loc(locale));

/** Bounty em Berries: ฿ 12.345. */
export const fmtBerries = (n: number, locale?: Locale) => `฿ ${fmtNumber(n, locale)}`;

/** "há 2 horas", "ontem", "há 3 semanas"… (relativo a `now`, pelo Intl do navegador). */
export function fmtAgo(ms: number, locale?: Locale, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(loc(locale), { numeric: 'auto' });
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(0, 'minute');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(s / 86_400), 'day');
  if (abs < 30 * 86_400) return rtf.format(Math.round(s / (7 * 86_400)), 'week');
  if (abs < 365 * 86_400) return rtf.format(Math.round(s / (30 * 86_400)), 'month');
  return rtf.format(Math.round(s / (365 * 86_400)), 'year');
}
