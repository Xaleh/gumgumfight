// Partes da importação usadas pelo comando cards:import e pela sincronização dos spoilers.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { type DB, upsertCards } from './db';
import { mapApiResponse, rowsOf, typeVocabulary } from './optcgapi';
import { DATA_DIR } from './paths';

/** Lista curada de tipos (data/card-types.json), usada para separar o sub_types da API. */
export function knownTypes(): string[] {
  try {
    return (JSON.parse(readFileSync(join(DATA_DIR, 'card-types.json'), 'utf8')) as { types: string[] }).types;
  } catch {
    return [];
  }
}

export type FetchJson = (url: string) => Promise<unknown>;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`${url} respondeu ${status} ${statusText}`);
  }
}

export const fetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'gumgumfight-importer' } });
  if (!res.ok) throw new HttpError(url, res.status, res.statusText);
  return res.json();
};

/** Mapeia respostas da API (o vocabulário de tipos vem de todas juntas) e grava como cartas oficiais. */
export function importBodies(db: DB, bodies: unknown[], source: string): CardData[] {
  // Todas as linhas juntas: a mesma carta aparece em vários corpos (coleção e starter deck
  // que a reimprime), e a escolha da versão certa precisa ver todas (mergeRows).
  const rows = bodies.flatMap(rowsOf);
  const vocab = typeVocabulary(rows, knownTypes());
  const { cards: list, raw } = mapApiResponse(rows, vocab);
  if (list.length) upsertCards(db, list, { provisional: false, source, raw });
  return list;
}
