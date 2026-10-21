// Limpeza de decks (Admin e Dev): cópias idênticas, rascunhos abandonados e decks sem uso.
//
//   GET  /api/admin/decks/cleanup?kind=dupes|drafts|idle   candidatos, em grupos
//   POST /api/admin/decks/delete { ids }                   apaga decks de jogadores (nunca os prontos)

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isAdmin, type User } from '../auth/store';
import { type DB, deckGames, deleteDeck, getCards, listDecks, type StoredDeck, transaction } from '../db';
import { fail } from '../errors';
import { deckHash } from '../stats/derive';

export const CLEANUP_KINDS = ['dupes', 'drafts', 'idle'] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

/** Rascunho abandonado: menos cartas que isto, sem alteração há `DRAFT_DAYS` dias. */
export const DRAFT_MAX_CARDS = 20;
export const DRAFT_DAYS = 30;
/** Sem uso: ninguém jogou nem editou há `IDLE_DAYS` dias. */
export const IDLE_DAYS = 90;
const MAX_GROUPS = 200;
const MAX_ROWS = 500;

export type CleanupRow = {
  id: string;
  name: string;
  kind: StoredDeck['kind'];
  /** Conta (com o nome dela) ou navegador sem login; vazio nos decks prontos. */
  owner: 'account' | 'browser' | null;
  ownerName: string | null;
  size: number;
  games: number;
  lastPlayedAt: string | null;
  updatedAt: string;
  /** Fica (o original de um grupo de cópias, ou um deck pronto). */
  keep: boolean;
};
export type CleanupGroup = { leader: string; leaderName: string | null; colors: string[]; rows: CleanupRow[] };

const size = (d: StoredDeck) => d.cards.reduce((s, c) => s + c.count, 0);
/** Data no formato do SQLite (`YYYY-MM-DD HH:MM:SS`, UTC), para comparar com `updated_at`. */
const sqliteDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export function cleanupCandidates(db: DB, kind: CleanupKind, now: number) {
  const decks = listDecks(db);
  const user = decks.filter((d) => d.kind === 'user');
  const games = deckGames(db);
  const lastPlayed = new Map(
    (
      db.prepare("SELECT deck_id, MAX(played_at) AS at FROM match_seats WHERE controller = 'human' AND deck_id IS NOT NULL GROUP BY deck_id").all() as Array<{
        deck_id: string;
        at: string;
      }>
    ).map((r) => [r.deck_id, r.at]),
  );
  const accounts = new Map(
    (db.prepare('SELECT id, name FROM users').all() as Array<{ id: string; name: string }>).map((u) => [`user:${u.id}`, u.name]),
  );
  const leaders = new Map(getCards(db, [...new Set(decks.map((d) => d.leader))]).map((c) => [c.id, c]));
  const row = (d: StoredDeck, keep = false): CleanupRow => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    owner: d.kind === 'builtin' ? null : d.ownerHash?.startsWith('user:') ? 'account' : 'browser',
    ownerName: (d.ownerHash && accounts.get(d.ownerHash)) ?? null,
    size: size(d),
    games: games.get(d.id) ?? 0,
    lastPlayedAt: lastPlayed.get(d.id) ?? null,
    updatedAt: d.updatedAt,
    keep: keep || d.kind === 'builtin',
  });
  const group = (leader: string, rows: CleanupRow[]): CleanupGroup => ({
    leader,
    leaderName: leaders.get(leader)?.name ?? null,
    colors: leaders.get(leader)?.colors ?? [],
    rows,
  });

  // Ordem de criação (o rowid não muda quando o deck é editado): no empate, o original é o criado primeiro.
  const created = new Map(
    (db.prepare('SELECT id, rowid AS n FROM decks').all() as Array<{ id: string; n: number }>).map((r) => [r.id, Number(r.n)]),
  );
  // Cópias idênticas: mesmo Líder e mesmas cartas. Fica o deck pronto, se houver; senão o mais jogado (o criado primeiro no empate).
  const byHash = new Map<string, StoredDeck[]>();
  for (const d of decks) {
    if (!d.leader || !size(d)) continue;
    const h = deckHash(d);
    byHash.set(h, [...(byHash.get(h) ?? []), d]);
  }
  const dupeGroups = [...byHash.values()]
    .filter((g) => g.length > 1 && g.some((d) => d.kind === 'user'))
    .map((g) => {
      const original =
        g.find((d) => d.kind === 'builtin') ??
        [...g].sort((a, b) => (games.get(b.id) ?? 0) - (games.get(a.id) ?? 0) || (created.get(a.id) ?? 0) - (created.get(b.id) ?? 0))[0];
      return group(g[0].leader, [original, ...g.filter((d) => d !== original)].map((d) => row(d, d === original)));
    })
    .sort((a, b) => b.rows.length - a.rows.length);

  const draftCut = sqliteDate(now - DRAFT_DAYS * 86_400_000);
  const drafts = user.filter((d) => size(d) < DRAFT_MAX_CARDS && d.updatedAt < draftCut);
  const idleCut = sqliteDate(now - IDLE_DAYS * 86_400_000);
  const idle = user.filter((d) => size(d) >= DRAFT_MAX_CARDS && d.updatedAt < idleCut && (lastPlayed.get(d.id) ?? '') < idleCut);

  const counts = {
    dupes: dupeGroups.reduce((s, g) => s + g.rows.filter((r) => !r.keep).length, 0),
    drafts: drafts.length,
    idle: idle.length,
  };
  const groups =
    kind === 'dupes'
      ? dupeGroups.slice(0, MAX_GROUPS)
      : (kind === 'drafts' ? drafts : idle).length
        ? [group('', (kind === 'drafts' ? drafts : idle).slice(0, MAX_ROWS).map((d) => row(d)))]
        : [];
  return {
    kind,
    userDecks: user.length,
    counts,
    rules: { draftMaxCards: DRAFT_MAX_CARDS, draftDays: DRAFT_DAYS, idleDays: IDLE_DAYS },
    groups,
  };
}

export function registerDeckCleanupRoutes(
  app: FastifyInstance,
  opts: { db: DB; user: (req: FastifyRequest) => User | null; now?: () => number },
) {
  const { db, user } = opts;
  const now = opts.now ?? Date.now;
  const staffOnly = (req: FastifyRequest) => {
    const me = user(req);
    if (!me) return { code: 401, body: fail('loginRequired', 'Entre com a conta Google.') };
    if (!isAdmin(me.role)) return { code: 403, body: fail('adminOnly', 'Só para administradores.') };
    return null;
  };

  app.get<{ Querystring: { kind?: string } }>('/api/admin/decks/cleanup', async (req, reply) => {
    const denied = staffOnly(req);
    if (denied) return reply.code(denied.code).send(denied.body);
    const kind = CLEANUP_KINDS.includes(req.query.kind as CleanupKind) ? (req.query.kind as CleanupKind) : 'dupes';
    return cleanupCandidates(db, kind, now());
  });

  app.post<{ Body: { ids?: unknown } }>('/api/admin/decks/delete', async (req, reply) => {
    const denied = staffOnly(req);
    if (denied) return reply.code(denied.code).send(denied.body);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > MAX_ROWS || ids.some((id) => typeof id !== 'string')) {
      return reply.code(400).send(fail('invalidBody', 'Lista de decks inválida.'));
    }
    // deleteDeck nunca apaga um deck pronto.
    const deleted = transaction(db, () => (ids as string[]).filter((id) => deleteDeck(db, id)).length);
    return { deleted };
  });
}
