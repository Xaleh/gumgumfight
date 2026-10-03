// Carrega os JSON de `data/` (cartas provisórias e decks) no banco.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardCategory, CardData, DeckList } from '@gumgum/engine';
import { type DB, pruneSpoilers, SPOILER_SOURCE, upsertCards, upsertDeck, upsertTranslations } from './db';
import { DATA_DIR } from './paths';

export function seed(db: DB) {
  const cardsDir = join(DATA_DIR, 'cards');
  const decksDir = join(DATA_DIR, 'decks');
  let written = 0;
  let skipped = 0;
  for (const f of readdirSync(cardsDir).filter((f) => f.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(join(cardsDir, f), 'utf8')) as { provisional?: boolean; cards: CardData[] };
    const r = upsertCards(db, file.cards, { provisional: file.provisional ?? true, source: `fixture:${f}` });
    written += r.written;
    skipped += r.skipped;
  }
  const spoilers = seedSpoilers(db, join(DATA_DIR, 'spoilers'));
  let decks = 0;
  for (const f of readdirSync(decksDir).filter((f) => f.endsWith('.json'))) {
    upsertDeck(db, JSON.parse(readFileSync(join(decksDir, f), 'utf8')) as DeckList);
    decks++;
  }
  // Traduções manuais: data/translations/<lang>.json -> { "cards": { "ID": { "text", "trigger" } } }
  let translations = 0;
  const trDir = join(DATA_DIR, 'translations');
  if (existsSync(trDir)) {
    for (const f of readdirSync(trDir).filter((f) => f.endsWith('.json'))) {
      const file = JSON.parse(readFileSync(join(trDir, f), 'utf8')) as {
        cards?: Record<string, { text: string; trigger?: string }>;
      };
      const rows = Object.entries(file.cards ?? {}).map(([id, t]) => ({ id, ...t }));
      upsertTranslations(db, f.replace(/\.json$/, ''), rows);
      translations += rows.length;
    }
  }
  return { written, skipped, decks, translations, spoilers };
}

/**
 * Arquivo de spoilers (data/spoilers/<coleção>.json): cartas anunciadas que a API
 * ainda não tem. `source`/`url` do arquivo valem para as cartas que não têm os seus.
 */
export interface SpoilerFile {
  set: string;
  title?: string;
  release?: string;
  source: string;
  url?: string;
  cards: Array<Partial<CardData> & { id: string; name: string; category: CardCategory }>;
}

const CATEGORIES: CardCategory[] = ['leader', 'character', 'event', 'stage'];

/** Completa uma carta de spoiler; null se faltar o essencial (número, nome, categoria). */
export function spoilerCard(file: SpoilerFile, c: SpoilerFile['cards'][number]): CardData | null {
  const id = typeof c.id === 'string' ? c.id.trim().toUpperCase() : '';
  if (!/^[A-Z]+\d*-\d+$/.test(id) || !c.name || !CATEGORIES.includes(c.category)) return null;
  return {
    ...c,
    id,
    colors: c.colors ?? [],
    types: c.types ?? [],
    text: c.text ?? '',
    set: c.set ?? id.split('-')[0],
    spoiler: c.spoiler ?? { source: file.source, ...(file.url ? { url: file.url } : {}) },
  };
}

/**
 * Grava as cartas de spoiler como provisórias: nunca sobrescrevem uma carta que já
 * veio da API, e a importação oficial as substitui (imagem e textos oficiais).
 */
export function seedSpoilers(db: DB, dir: string) {
  const out = { written: 0, official: 0, invalid: [] as string[], removed: 0 };
  const seen: string[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SpoilerFile;
      const cards: CardData[] = [];
      for (const c of file.cards ?? []) {
        const card = spoilerCard(file, c);
        if (card) cards.push(card);
        else out.invalid.push(`${f}: ${c?.id ?? '?'}`);
      }
      const r = upsertCards(db, cards, { provisional: true, source: `${SPOILER_SOURCE}${f}` });
      out.written += r.written;
      out.official += r.skipped;
      seen.push(...cards.map((c) => c.id));
    }
  }
  out.removed = pruneSpoilers(db, seen);
  return out;
}
