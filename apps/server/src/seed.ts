// Carrega os JSON de `data/` (cartas provisórias e decks) no banco.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData, DeckList } from '@gumgum/engine';
import { type DB, upsertCards, upsertDeck } from './db';
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
  let decks = 0;
  for (const f of readdirSync(decksDir).filter((f) => f.endsWith('.json'))) {
    upsertDeck(db, JSON.parse(readFileSync(join(decksDir, f), 'utf8')) as DeckList);
    decks++;
  }
  return { written, skipped, decks };
}
