// optcgapi.com como fonte da cadeia: o mapeamento continua em ../optcgapi.ts.

import { readFileSync } from 'node:fs';
import { type FetchJson, mapApiBodies } from '../card-import';
import { allEndpoints, rowsOf, setEndpoint } from '../optcgapi';
import type { CardSource } from './chain';

/** Endpoints de uma coleção; "P" (promocionais) fica em /allPromos/. */
export function apiEndpoints(base: string, sets?: string[]): string[] {
  if (!sets) return allEndpoints(base);
  return [...new Set(sets.map((s) => (/^P-?$/i.test(s.trim()) ? `${base}/allPromos/` : setEndpoint(base, s))))];
}

export function optcgapiSource(opts: {
  base: string;
  fetchJson: FetchJson;
  /** Respostas salvas (--file): substituem a rede. */
  files?: string[];
  /** Avisa cada resposta baixada ("<url>: N entradas"). */
  onBody?: (label: string, entries: number) => void;
}): CardSource {
  const base = opts.base.replace(/\/$/, '');
  return {
    id: 'optcgapi',
    host: opts.files?.length ? 'arquivo' : new URL(base).host,
    async fetch({ sets }) {
      const sources = opts.files?.length
        ? opts.files.map((f) => ({ label: f, load: async () => JSON.parse(readFileSync(f, 'utf8')) as unknown }))
        : apiEndpoints(base, sets).map((url) => ({ label: url, load: () => opts.fetchJson(url) }));
      // Baixa tudo antes de mapear: o vocabulário de tipos vem dos textos de todas as respostas.
      const bodies: unknown[] = [];
      for (const src of sources) {
        const body = await src.load();
        opts.onBody?.(src.label, rowsOf(body).length);
        bodies.push(body);
      }
      return mapApiBodies(bodies);
    },
  };
}
