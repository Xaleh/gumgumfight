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
