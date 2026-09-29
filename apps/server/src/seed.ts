// Carrega os JSON de `data/` (cartas provisórias e decks) no banco.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData, DeckList } from '@gumgum/engine';
import { type DB, upsertCards, upsertDeck, upsertTranslations } from './db';
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
  return { written, skipped, decks, translations };
}
