// Importa cartas de uma API externa para o banco local.
//
// Uso:
//   CARD_API_URL="https://..." npm run cards:import
//   CARD_API_URL="https://..." CARD_API_KEY="..." npm run cards:import
//
// O formato exato da API ainda não foi definido. `mapApiCard` tenta reconhecer os
// nomes de campo mais comuns; quando a API for escolhida, ajuste apenas essa função.

import type { CardCategory, CardData, Color } from '@gumgum/engine';
import { openDb, upsertCards } from './db';

const COLORS: Color[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

const pick = (raw: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
  return undefined;
};

const num = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '-' ? n : undefined;
};

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(/[/;,]/).map((s) => s.trim()).filter(Boolean);
  return [];
};

export function mapApiCard(raw: Record<string, unknown>): CardData | null {
  const id = pick(raw, 'id', 'card_id', 'cardId', 'code', 'card_set_id', 'number');
  const name = pick(raw, 'name', 'card_name', 'cardName');
  const categoryRaw = String(pick(raw, 'category', 'type', 'card_type', 'cardType') ?? '').toLowerCase();
  if (!id || !name) return null;

  const category = (['leader', 'character', 'event', 'stage'] as CardCategory[]).find((c) => categoryRaw.includes(c));
  if (!category) return null; // ignora DON!! e tipos desconhecidos

  const colors = list(pick(raw, 'colors', 'color', 'card_color'))
    .map((c) => c.toLowerCase())
    .filter((c): c is Color => COLORS.includes(c as Color));

  const text = String(pick(raw, 'text', 'effect', 'card_text', 'ability') ?? '');
  const trigger = pick(raw, 'trigger', 'trigger_text');

  return {
    id: String(id),
    name: String(name),
    category,
    colors,
    cost: category === 'leader' ? undefined : num(pick(raw, 'cost', 'card_cost')),
    life: category === 'leader' ? num(pick(raw, 'life', 'cost', 'card_cost')) : undefined,
    power: num(pick(raw, 'power', 'card_power')),
    counter: num(pick(raw, 'counter', 'counter_amount', 'card_counter')),
    attributes: list(pick(raw, 'attributes', 'attribute')),
    types: list(pick(raw, 'types', 'traits', 'feature', 'sub_types', 'family')),
    text,
    trigger: trigger ? String(trigger) : undefined,
    set: String(pick(raw, 'set', 'set_id', 'set_code') ?? String(id).split('-')[0]),
    rarity: pick(raw, 'rarity') ? String(pick(raw, 'rarity')) : undefined,
    imageUrl: pick(raw, 'imageUrl', 'image_url', 'image', 'img', 'card_image') as string | undefined,
  };
}

async function main() {
  const url = process.env.CARD_API_URL;
  if (!url) {
    console.error('Defina CARD_API_URL com o endereço da API de cartas.');
    process.exit(1);
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.CARD_API_KEY) headers['x-api-key'] = process.env.CARD_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API respondeu ${res.status} ${res.statusText}`);
  const body = (await res.json()) as unknown;
  const rows = (Array.isArray(body) ? body : ((body as { data?: unknown[]; cards?: unknown[] }).data ??
    (body as { cards?: unknown[] }).cards ?? [])) as Record<string, unknown>[];

  const cards = rows.map(mapApiCard).filter((c): c is CardData => c !== null);
  const db = openDb();
  const r = upsertCards(db, cards, { provisional: false, source: `api:${new URL(url).host}` });
  console.log(`Recebidas ${rows.length} entradas; ${cards.length} cartas válidas; gravadas ${r.written}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
