// Lojas patrocinadoras: cadastro (só admin), logo e o que aparece no site.
//
// Só a marca da loja e a oferta: nada de arte de carta nem logo da Bandai/One Piece nos
// banners (o projeto é de fã). Sem rede de anúncios de terceiros.

import { randomBytes } from 'node:crypto';
import { dataVersion } from '../cache';
import type { DB } from '../db';

export const PLACEMENTS = ['tournaments', 'home'] as const;
export type Placement = (typeof PLACEMENTS)[number];
/** Tamanho máximo do logo (bytes). */
export const MAX_LOGO_BYTES = 300 * 1024;

export interface Sponsor {
  id: string;
  name: string;
  url: string | null;
  offer: string | null;
  placements: Placement[];
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
  logoType: string | null;
  logoVersion: number;
  /** Dentro do período (ou sem período). */
  active: boolean;
  createdAt: string;
}

export interface SponsorInput {
  name: string;
  url: string | null;
  offer: string | null;
  placements: Placement[];
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
}

type Row = {
  id: string;
  name: string;
  url: string | null;
  offer: string | null;
  placements: string;
  starts_at: string | null;
  ends_at: string | null;
  sort: number;
  logo_type: string | null;
  logo_version: number;
  created_at: string;
};

const COLS = 'id, name, url, offer, placements, starts_at, ends_at, sort, logo_type, logo_version, created_at';

const toSponsor = (r: Row, now = Date.now()): Sponsor => ({
  id: r.id,
  name: r.name,
  url: r.url,
  offer: r.offer,
  placements: r.placements.split(',').filter((p): p is Placement => PLACEMENTS.includes(p as Placement)),
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  sort: r.sort,
  logoType: r.logo_type,
  logoVersion: r.logo_version,
  active: (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) > now),
  createdAt: r.created_at,
});

/** O que o site mostra de uma loja. */
export const publicSponsor = (s: Sponsor) => ({
  id: s.id,
  name: s.name,
  url: s.url,
  offer: s.offer,
  placements: s.placements,
  logoUrl: s.logoType ? `/api/sponsors/${encodeURIComponent(s.id)}/logo?v=${s.logoVersion}` : null,
});

export function getSponsor(db: DB, id: string): Sponsor | null {
  const r = db.prepare(`SELECT ${COLS} FROM sponsors WHERE id = ?`).get(id) as Row | undefined;
  return r ? toSponsor(r) : null;
}

export function listSponsors(db: DB): Sponsor[] {
  return (db.prepare(`SELECT ${COLS} FROM sponsors ORDER BY sort, name COLLATE NOCASE`).all() as Row[]).map((r) => toSponsor(r));
}

const values = (i: SponsorInput) => [i.name, i.url, i.offer, i.placements.join(','), i.startsAt, i.endsAt, i.sort] as const;

export function createSponsor(db: DB, input: SponsorInput): Sponsor {
  dataVersion.bump();
  const id = `sp-${randomBytes(4).toString('hex')}`;
  db.prepare('INSERT INTO sponsors (id, name, url, offer, placements, starts_at, ends_at, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ...values(input));
  return getSponsor(db, id)!;
}

export function updateSponsor(db: DB, id: string, input: SponsorInput): Sponsor | null {
  dataVersion.bump();
  const changed = db
    .prepare('UPDATE sponsors SET name = ?, url = ?, offer = ?, placements = ?, starts_at = ?, ends_at = ?, sort = ? WHERE id = ?')
    .run(...values(input), id).changes;
  return Number(changed) ? getSponsor(db, id) : null;
}

export function deleteSponsor(db: DB, id: string): boolean {
  dataVersion.bump();
  db.prepare('UPDATE tournaments SET sponsor_id = NULL WHERE sponsor_id = ?').run(id);
  return Number(db.prepare('DELETE FROM sponsors WHERE id = ?').run(id).changes) > 0;
}

export function setSponsorLogo(db: DB, id: string, logo: Buffer | null, type: string | null): boolean {
  dataVersion.bump();
  return Number(db.prepare('UPDATE sponsors SET logo = ?, logo_type = ?, logo_version = logo_version + 1 WHERE id = ?').run(logo, type, id).changes) > 0;
}

export function sponsorLogo(db: DB, id: string): { data: Buffer; type: string } | null {
  const r = db.prepare('SELECT logo, logo_type FROM sponsors WHERE id = ?').get(id) as { logo: Uint8Array | null; logo_type: string | null } | undefined;
  return r?.logo && r.logo_type ? { data: Buffer.from(r.logo), type: r.logo_type } : null;
}

/**
 * Tipo da imagem pelos primeiros bytes (não pelo que o navegador diz). Só PNG, JPEG e
 * WebP: SVG fica de fora porque pode carregar script.
 */
export function imageType(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
