// Imagens que chegam por fora (promos da China, scans cedidos...): uma pasta de PNG/JPEG/WebP com o
// número da carta no nome vai para a CDN própria e vira a imagem da carta ou uma arte alternativa.
//
//   npm run cards:import -- --images-from ./promos-cn --images-lang cn
//
//   nome do arquivo   <número da carta>[_<sufixo>].<ext>   ex.: P-123.png (impressão base), P-123_cn1.png
//   chave no bucket   <coleção>/<idioma>/<nome>.<ext>      ex.: P/cn/P-123.png
//
// O que entrou fica em `card_local_images` e é reaplicado em toda rodada da CDN (`applyLocalImages`):
// reimportar a carta ou sincronizar os spoilers não desfaz nada. A impressão base (sem sufixo) vira a
// imagem principal da carta quando ela não tem nenhuma; se já tem (fonte de dados ou lista oficial da
// Bandai), vira arte alternativa como as outras. O arquivo igual ao que já está no bucket não sobe de novo.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardArt, CardData } from '@gumgum/engine';
import { type DB, transaction } from '../db';
import { contentHash, EXT, IMMUTABLE, type ImageStore, MAX_BYTES, sniffImageType } from './store';

/** `P-123.png`, `OP01-016_cn1.webp`: número da carta, sufixo opcional e extensão de imagem. */
const FILE_NAME = /^([A-Za-z]{1,4}\d{0,2}-\d{3})(_[A-Za-z0-9]+)?\.(png|jpe?g|webp)$/;
const LANG = /^[a-z]{2,3}$/;

export interface LocalImportResult {
  /** Arquivos gravados no bucket nesta rodada (novos ou com conteúdo diferente). */
  imported: number;
  /** Arquivos iguais ao que já está no bucket. */
  unchanged: number;
  skipped: Array<{ file: string; reason: string }>;
}

interface LocalRow {
  object_key: string;
  card_id: string;
  art_id: string;
  lang: string;
  hash: string;
  main: number;
  label: string | null;
}

/**
 * Lê a pasta, grava no bucket o que é novo e registra em `card_local_images`. Não mexe nas cartas:
 * isso é `applyLocalImages`, na rodada da CDN que vem logo depois.
 */
export async function importLocalImages(
  db: DB,
  store: ImageStore,
  dir: string,
  opts: { lang: string; label?: string; log?: (msg: string) => void },
): Promise<LocalImportResult> {
  const lang = opts.lang.trim().toLowerCase();
  if (!LANG.test(lang)) throw new Error(`idioma inválido "${opts.lang}": use 2 ou 3 letras (ex.: cn, jp, en)`);
  const result: LocalImportResult = { imported: 0, unchanged: 0, skipped: [] };
  const findCard = db.prepare('SELECT id, set_code FROM cards WHERE id = ?');
  const known = db.prepare('SELECT hash FROM card_local_images WHERE object_key = ?');
  const remember = db.prepare(`
    INSERT INTO card_local_images (object_key, card_id, art_id, lang, hash, main, label, content_type, bytes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(object_key) DO UPDATE SET card_id = excluded.card_id, art_id = excluded.art_id, hash = excluded.hash,
      main = excluded.main, label = excluded.label, content_type = excluded.content_type, bytes = excluded.bytes,
      updated_at = excluded.updated_at
  `);
  const skip = (file: string, reason: string) => result.skipped.push({ file, reason });
  const seenArts = new Set<string>();

  for (const file of readdirSync(dir).sort()) {
    const m = FILE_NAME.exec(file);
    if (!m) {
      if (!file.startsWith('.')) skip(file, 'nome fora do padrão <número da carta>[_sufixo].png/jpg/webp');
      continue;
    }
    const cardId = m[1].toUpperCase();
    const stem = file.replace(/\.[a-z0-9]+$/i, '');
    const card = findCard.get(cardId) as { id: string; set_code: string | null } | undefined;
    if (!card) {
      skip(file, `carta ${cardId} não está no banco`);
      continue;
    }
    const body = readFileSync(join(dir, file));
    const type = sniffImageType(body);
    if (!type) {
      skip(file, 'não é PNG, JPEG nem WebP');
      continue;
    }
    if (body.length > MAX_BYTES) {
      skip(file, `${(body.length / 1024 / 1024).toFixed(1)} MB (máximo ${MAX_BYTES / 1024 / 1024} MB)`);
      continue;
    }
    // A impressão base recebe o idioma no id da arte para nunca coincidir com o número da carta.
    const main = !m[2];
    const artId = main ? `${stem}_${lang}` : stem;
    if (seenArts.has(artId)) {
      skip(file, `arte ${artId} repetida na pasta`);
      continue;
    }
    seenArts.add(artId);
    const key = `${card.set_code || cardId.split('-')[0]}/${lang}/${stem}.${EXT[type]}`;
    const hash = contentHash(body);
    const before = known.get(key) as { hash: string } | undefined;
    if (before?.hash === hash) {
      result.unchanged++;
      continue;
    }
    await store.put(key, body, type, IMMUTABLE);
    remember.run(key, cardId, artId, lang, hash, main ? 1 : 0, opts.label?.trim() || null, type, body.length);
    result.imported++;
  }
  for (const s of result.skipped) opts.log?.(`Imagem local ignorada: ${s.file} (${s.reason})`);
  return result;
}

/**
 * Põe as imagens locais nas cartas: a base vira a imagem principal da carta sem imagem (com
 * `imageLang`), o resto entra em `arts` pelo id. Idempotente; devolve quantas cartas mudaram.
 */
export function applyLocalImages(db: DB, store: ImageStore): number {
  const rows = db.prepare('SELECT object_key, card_id, art_id, lang, hash, main, label FROM card_local_images ORDER BY card_id, main DESC, art_id').all() as unknown as LocalRow[];
  if (!rows.length) return 0;
  const byCard = new Map<string, LocalRow[]>();
  for (const r of rows) byCard.set(r.card_id, [...(byCard.get(r.card_id) ?? []), r]);
  const url = (r: LocalRow) => `${store.publicBase}/${r.object_key}?v=${r.hash}`;
  const read = db.prepare('SELECT data FROM cards WHERE id = ?');
  const update = db.prepare('UPDATE cards SET data = ? WHERE id = ?');
  let changed = 0;
  transaction(db, () => {
    for (const [id, locals] of byCard) {
      const row = read.get(id) as { data: string } | undefined;
      if (!row) continue;
      const c = JSON.parse(row.data) as CardData;
      const next: CardData = { ...c };
      // Sem imagem de nenhuma fonte: a impressão base local é a imagem da carta.
      const base = locals.find((r) => r.main);
      const asMain = base && (!c.imageUrl || c.imageUrl.startsWith(`${store.publicBase}/${base.object_key}?`)) ? base : undefined;
      if (asMain) {
        next.imageUrl = url(asMain);
        if (asMain.lang !== 'en') next.imageLang = asMain.lang;
        else delete next.imageLang;
      }
      const arts: CardArt[] = (c.arts ?? []).filter((a) => !asMain || a.id !== asMain.art_id);
      for (const r of locals) {
        if (r === asMain) continue;
        const art: CardArt = { id: r.art_id, imageUrl: url(r), ...(r.label ? { label: r.label } : {}) };
        const i = arts.findIndex((a) => a.id === r.art_id);
        if (i >= 0) arts[i] = { ...arts[i], ...art };
        else arts.push(art);
      }
      if (arts.length) next.arts = arts;
      else delete next.arts;
      const data = JSON.stringify(next);
      if (data !== JSON.stringify(c)) {
        update.run(data, id);
        changed++;
      }
    }
  });
  return changed;
}
