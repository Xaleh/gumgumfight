// Banco local SQLite (arquivo único, sem custo de serviço externo).
// Usa o SQLite embutido no Node (`node:sqlite`): nenhum módulo nativo para
// compilar ou baixar, então funciona igual no Windows, Linux e macOS.
// Toda a SQL fica aqui, em stats/store.ts (consultas das estatísticas), em
// auth/store.ts (contas e sessões), em tournaments/store.ts (torneios) e em
// push/store.ts (notificações); se um dia for preciso migrar para Postgres, só esses
// arquivos mudam.

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type CardArt, type CardData, type DeckList, fixCard, needsManual } from '@gumgum/engine';
import { DatabaseSync } from 'node:sqlite';
import { baseCardId } from './optcgapi';
import { DB_PATH } from './paths';

export type DB = DatabaseSync;

export function openDb(path = DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/** Bancos com uma transação aberta: uma `transaction` dentro de outra só roda a função (vale a de fora). */
const inTransaction = new WeakSet<DB>();

export function transaction<T>(db: DB, fn: () => T): T {
  if (inTransaction.has(db)) return fn();
  db.exec('BEGIN');
  inTransaction.add(db);
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction.delete(db);
  }
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id          TEXT PRIMARY KEY,
      set_code    TEXT,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      data        TEXT NOT NULL,          -- JSON no formato CardData
      provisional INTEGER NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT 'fixture',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS cards_set ON cards(set_code);

    -- Imagens copiadas para a CDN própria (card-cdn/): endereço de origem -> objeto no bucket.
    CREATE TABLE IF NOT EXISTS card_images (
      source_url   TEXT PRIMARY KEY,
      object_key   TEXT NOT NULL,
      hash         TEXT NOT NULL,
      lang         TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes        INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Impressões vistas nas listas oficiais da Bandai (card-cdn/official.ts) e quando cada coleção foi consultada.
    CREATE TABLE IF NOT EXISTS card_official_images (
      card_id   TEXT NOT NULL,
      variant   TEXT NOT NULL,
      region    TEXT NOT NULL,
      lang      TEXT NOT NULL,
      image_url TEXT NOT NULL,
      label     TEXT,
      PRIMARY KEY (card_id, variant, region)
    );
    CREATE TABLE IF NOT EXISTS card_official_checks (
      region     TEXT NOT NULL,
      series     TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (region, series)
    );

    CREATE TABLE IF NOT EXISTS decks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      leader     TEXT NOT NULL,
      cards      TEXT NOT NULL,           -- JSON: [{ id, count }]
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      seed       INTEGER NOT NULL,
      mode       TEXT NOT NULL,
      deck0      TEXT NOT NULL,
      deck1      TEXT NOT NULL,
      winner     INTEGER,
      turns      INTEGER,
      reason     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Traduções revisadas manualmente (têm prioridade sobre a tradução automática).
    CREATE TABLE IF NOT EXISTS card_translations (
      card_id    TEXT NOT NULL,
      lang       TEXT NOT NULL,
      text       TEXT NOT NULL,
      trigger    TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (card_id, lang)
    );
  `);
  // Colunas adicionadas depois da primeira versão.
  const cols = (db.prepare('PRAGMA table_info(cards)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // raw: resposta original da API, para poder remapear sem baixar de novo.
  if (!cols.includes('raw')) db.exec('ALTER TABLE cards ADD COLUMN raw TEXT');
  const deckCols = (db.prepare('PRAGMA table_info(decks)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!deckCols.includes('kind')) db.exec("ALTER TABLE decks ADD COLUMN kind TEXT NOT NULL DEFAULT 'builtin'");
  // arts: JSON { número da carta: arte alternativa } (fora de `cards`, para não mudar o deck nas estatísticas).
  if (!deckCols.includes('arts')) db.exec('ALTER TABLE decks ADD COLUMN arts TEXT');
  // Dono do deck: SHA-256 do código do navegador (nunca o código em si) ou
  // "user:<id>" quando o deck pertence a uma conta (ver auth/store.ts).
  if (!deckCols.includes('owner_hash')) db.exec('ALTER TABLE decks ADD COLUMN owner_hash TEXT');
  migrateStats(db);
  migrateAuth(db);
  migratePush(db);
  migrateTournaments(db);
  migrateCardIds(db);
  migrateSupport(db);
  migrateTutorial(db);
  migratePartners(db);
  migrateEngineTexts(db);
  migrateCardGaps(db);
  migrateDecks(db);
}

/**
 * Favoritos (por conta ou, sem login, por navegador) e limpeza: deck sem Líder não
 * fica salvo (o construtor não deixa mais salvar; os antigos são apagados aqui).
 */
function migrateDecks(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deck_favorites (
      owner_hash TEXT NOT NULL,
      deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (owner_hash, deck_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS seats_deck ON match_seats(deck_id);
  `);
  db.exec("DELETE FROM decks WHERE kind = 'user' AND trim(leader) = ''");
}

/**
 * Texto para o motor (card-engine-texts.ts): redação que o leitor entende, escrita pelo Dev, usada
 * no lugar do texto oficial só para montar as habilidades. `base_key` é o hash do texto oficial
 * quando foi escrito: se o oficial mudar (errata, fonte nova), o texto para o motor deixa de valer
 * até o Dev revisar. O histórico guarda cada gravação e remoção, com quem fez.
 */
function migrateEngineTexts(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_engine_texts (
      card_id     TEXT PRIMARY KEY,
      text        TEXT NOT NULL,
      trigger     TEXT,
      base_key    TEXT NOT NULL,
      author_id   TEXT,
      author_name TEXT,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_engine_text_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     TEXT NOT NULL,
      action      TEXT NOT NULL,        -- set | remove
      text        TEXT,
      trigger     TEXT,
      base_key    TEXT,
      author_id   TEXT,
      author_name TEXT,
      at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS card_engine_text_history_card ON card_engine_text_history(card_id, id);
  `);
}

export interface EngineTextRow {
  cardId: string;
  text: string;
  trigger: string | null;
  baseKey: string;
  authorName: string | null;
  updatedAt: string;
}

export interface EngineTextHistoryRow {
  action: 'set' | 'remove';
  text: string | null;
  trigger: string | null;
  authorName: string | null;
  at: string;
}

export function listEngineTexts(db: DB): EngineTextRow[] {
  const rows = db.prepare('SELECT card_id, text, trigger, base_key, author_name, updated_at FROM card_engine_texts ORDER BY card_id').all() as unknown as Array<{
    card_id: string;
    text: string;
    trigger: string | null;
    base_key: string;
    author_name: string | null;
    updated_at: string;
  }>;
  return rows.map((r) => ({ cardId: r.card_id, text: r.text, trigger: r.trigger, baseKey: r.base_key, authorName: r.author_name, updatedAt: r.updated_at }));
}

export function getEngineText(db: DB, cardId: string): EngineTextRow | null {
  return listEngineTexts(db).find((r) => r.cardId === cardId) ?? null;
}

/** Grava (ou troca) o texto para o motor de uma carta, com o hash do texto oficial de agora. */
export function setEngineText(
  db: DB,
  e: { cardId: string; text: string; trigger: string | null; baseKey: string; author: { id: string; name: string | null } },
  now = new Date(),
) {
  const at = now.toISOString();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO card_engine_texts (card_id, text, trigger, base_key, author_id, author_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET text = excluded.text, trigger = excluded.trigger, base_key = excluded.base_key,
        author_id = excluded.author_id, author_name = excluded.author_name, updated_at = excluded.updated_at
    `).run(e.cardId, e.text, e.trigger, e.baseKey, e.author.id, e.author.name, at);
    db.prepare(
      "INSERT INTO card_engine_text_history (card_id, action, text, trigger, base_key, author_id, author_name, at) VALUES (?, 'set', ?, ?, ?, ?, ?, ?)",
    ).run(e.cardId, e.text, e.trigger, e.baseKey, e.author.id, e.author.name, at);
  });
}

/** Apaga o texto para o motor (a carta volta a ser lida pelo texto oficial). false = não havia. */
export function removeEngineText(db: DB, cardId: string, author: { id: string; name: string | null }, now = new Date()): boolean {
  let removed = false;
  transaction(db, () => {
    removed = Number(db.prepare('DELETE FROM card_engine_texts WHERE card_id = ?').run(cardId).changes) > 0;
    if (removed) {
      db.prepare("INSERT INTO card_engine_text_history (card_id, action, author_id, author_name, at) VALUES (?, 'remove', ?, ?, ?)").run(
        cardId,
        author.id,
        author.name,
        now.toISOString(),
      );
    }
  });
  return removed;
}

export function engineTextHistory(db: DB, cardId: string, limit = 20): EngineTextHistoryRow[] {
  const rows = db
    .prepare('SELECT action, text, trigger, author_name, at FROM card_engine_text_history WHERE card_id = ? ORDER BY id DESC LIMIT ?')
    .all(cardId, limit) as unknown as Array<{ action: 'set' | 'remove'; text: string | null; trigger: string | null; author_name: string | null; at: string }>;
  return rows.map((r) => ({ action: r.action, text: r.text, trigger: r.trigger, authorName: r.author_name, at: r.at }));
}

/**
 * Cartas com efeito que o leitor não entende (⚙), para o aviso de "novas" ao Dev (card-gaps.ts):
 * `text_key` é o hash do texto quando a carta entrou na lista (texto novo = carta nova de novo) e
 * `reviewed_at`, quando o Dev marcou como vista. Num banco que já tinha cartas, as ⚙ de antes da
 * tabela entram como vistas: só as que chegarem depois são novas.
 */
function migrateCardGaps(db: DB) {
  const existed = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_gaps'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_gaps (
      card_id     TEXT PRIMARY KEY,
      text_key    TEXT NOT NULL,
      first_seen  TEXT NOT NULL,
      reviewed_at TEXT
    );
  `);
  if (!existed) recordCardGaps(db, { reviewed: true });
}

/** Hash do texto oficial (texto e [Trigger], depois das correções e da errata). */
export const officialTextKey = (c: Pick<CardData, 'text' | 'trigger'>) =>
  createHash('sha1').update(`${c.text ?? ''}\u0000${c.trigger ?? ''}`).digest('hex').slice(0, 16);

/**
 * Atualiza a lista das cartas ⚙ com o banco atual: carta ⚙ que não estava (ou cujo texto mudou)
 * entra como nova; carta que deixou de ser ⚙ (ou sumiu) sai. Roda ao subir o servidor, depois
 * da sincronização dos spoilers e do `cards:import`. `reviewed`: entram já como vistas.
 */
export function recordCardGaps(db: DB, opts: { reviewed?: boolean; now?: Date } = {}): { added: number; removed: number } {
  const at = (opts.now ?? new Date()).toISOString();
  const known = new Map(
    (db.prepare('SELECT card_id, text_key FROM card_gaps').all() as unknown as Array<{ card_id: string; text_key: string }>).map((r) => [r.card_id, r.text_key]),
  );
  const put = db.prepare(`
    INSERT INTO card_gaps (card_id, text_key, first_seen, reviewed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET text_key = excluded.text_key, first_seen = excluded.first_seen, reviewed_at = excluded.reviewed_at
  `);
  const del = db.prepare('DELETE FROM card_gaps WHERE card_id = ?');
  let added = 0;
  let removed = 0;
  transaction(db, () => {
    const gaps = new Set<string>();
    for (const c of listCards(db)) {
      if (!needsManual(c)) continue;
      gaps.add(c.id);
      const key = officialTextKey(c);
      if (known.get(c.id) === key) continue;
      put.run(c.id, key, at, opts.reviewed ? at : null);
      added++;
    }
    for (const id of known.keys()) {
      if (gaps.has(id)) continue;
      del.run(id);
      removed++;
    }
  });
  return { added, removed };
}

export interface CardGapRow {
  cardId: string;
  firstSeen: string;
  reviewedAt: string | null;
}

export function listCardGaps(db: DB): Map<string, CardGapRow> {
  const rows = db.prepare('SELECT card_id, first_seen, reviewed_at FROM card_gaps').all() as unknown as Array<{
    card_id: string;
    first_seen: string;
    reviewed_at: string | null;
  }>;
  return new Map(rows.map((r) => [r.card_id, { cardId: r.card_id, firstSeen: r.first_seen, reviewedAt: r.reviewed_at }]));
}

/** Marca como vistas as cartas novas (todas, ou só `ids`). Devolve quantas mudaram. */
export function markCardGapsReviewed(db: DB, ids?: string[], now = new Date()): number {
  const at = now.toISOString();
  if (!ids) return Number(db.prepare('UPDATE card_gaps SET reviewed_at = ? WHERE reviewed_at IS NULL').run(at).changes);
  const mark = db.prepare('UPDATE card_gaps SET reviewed_at = ? WHERE card_id = ? AND reviewed_at IS NULL');
  let n = 0;
  transaction(db, () => {
    for (const id of ids) n += Number(mark.run(at, id).changes);
  });
  return n;
}

/**
 * API para parceiros (ver partners/): tokens de acesso que agem em nome de uma conta
 * (pessoais ou do OAuth), os clientes OAuth cadastrados e os codes do fluxo de autorização.
 * Dos tokens, codes e segredos só o sha256 fica no banco (como as sessões).
 */
function migratePartners(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id           TEXT PRIMARY KEY,          -- 'tk-' + 12 hex, mostrado na tela
      token_hash   TEXT NOT NULL UNIQUE,      -- sha256(token) em hex
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id    TEXT,                      -- NULL = token pessoal; senão oauth_clients.id
      kind         TEXT NOT NULL,             -- 'personal' | 'access' | 'refresh'
      name         TEXT,                      -- rótulo dado pelo usuário ("sweetapp")
      scopes       TEXT NOT NULL,             -- separados por espaço
      parent_id    TEXT,                      -- access → o refresh que o gerou
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT,                      -- NULL = sem validade (pessoal)
      last_used_at TEXT,
      revoked_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id);

    CREATE TABLE IF NOT EXISTS oauth_clients (
      id             TEXT PRIMARY KEY,        -- 'sweetapp'
      name           TEXT NOT NULL,           -- mostrado na tela de consentimento
      secret_hash    TEXT NOT NULL,           -- sha256 do client_secret
      redirect_uris  TEXT NOT NULL,           -- JSON: lista exata de URIs aceitas
      scopes         TEXT NOT NULL,           -- scopes que o cliente pode pedir
      webhook_url    TEXT,                    -- aviso "partida terminada"
      webhook_secret TEXT,                    -- guardado em claro: é usado para assinar
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash      TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scopes         TEXT NOT NULL,
      redirect_uri   TEXT NOT NULL,
      code_challenge TEXT NOT NULL,           -- S256
      expires_at     TEXT NOT NULL,           -- agora + 5 min
      used_at        TEXT,
      token_id       TEXT                     -- refresh token emitido com este code (revogado se o code for usado de novo)
    );
  `);
}

/**
 * Apoio ao projeto: o plano de cada conta, os pagamentos recebidos da plataforma de
 * apoio (Ko-fi), a cota de torneios dos apoiadores, os torneios do time e as lojas
 * patrocinadoras.
 */
function migrateSupport(db: DB) {
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // supporter_tier: grumete | tripulante | capitao | almirante (null = sem plano).
  if (!userCols.includes('supporter_tier')) db.exec('ALTER TABLE users ADD COLUMN supporter_tier TEXT');
  // supporter_until: até quando o plano vale (ISO; null = sem prazo, dado à mão pelo admin).
  if (!userCols.includes('supporter_until')) db.exec('ALTER TABLE users ADD COLUMN supporter_until TEXT');
  // supporter_source: manual (admin) | kofi (pagamento).
  if (!userCols.includes('supporter_source')) db.exec('ALTER TABLE users ADD COLUMN supporter_source TEXT');
  // supporter_public: a pessoa aceitou aparecer na lista de Apoiadores.
  if (!userCols.includes('supporter_public')) db.exec('ALTER TABLE users ADD COLUMN supporter_public INTEGER NOT NULL DEFAULT 0');
  // email_verified: o Google confirmou o e-mail (só e-mails confirmados recebem plano pago ou consultado pela homologação).
  if (!userCols.includes('email_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    // Contas de antes desta coluna: endereços do Gmail são sempre confirmados pelo Google; os outros
    // ficam confirmados no próximo login (até lá, o admin pode dar o plano à mão).
    db.exec("UPDATE users SET email_verified = 1 WHERE lower(email) LIKE '%@gmail.com' OR lower(email) LIKE '%@googlemail.com'");
  }
  db.exec(`
    -- Pagamentos recebidos pelo webhook da plataforma de apoio (auditoria e idempotência).
    CREATE TABLE IF NOT EXISTS supporter_payments (
      id          TEXT PRIMARY KEY,             -- id da transação na plataforma
      email       TEXT,                         -- e-mail de quem pagou (minúsculo)
      kind        TEXT NOT NULL,                -- Donation | Subscription | ...
      tier        TEXT,                         -- plano reconhecido (null = doação avulsa)
      amount      REAL NOT NULL,
      currency    TEXT NOT NULL,
      paid_at     TEXT NOT NULL,
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS supporter_payments_email ON supporter_payments(email, paid_at);

    -- Torneios criados pela cota de apoiador (Capitão e Almirante: 5 por mês). Apagar um
    -- torneio que não começou devolve a vaga; um que já começou continua contando.
    CREATE TABLE IF NOT EXISTS tournament_quota (
      tournament_id TEXT PRIMARY KEY,
      organizer_id  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tournament_quota_org ON tournament_quota(organizer_id, created_at);

    -- Lojas patrocinadoras: aparecem na página de torneios (e, se marcado, na home) e no
    -- torneio que patrocinam. O logo fica no próprio banco (sobrevive aos deploys).
    CREATE TABLE IF NOT EXISTS sponsors (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT,                         -- site ou loja online (http/https)
      offer       TEXT,                         -- oferta do mês (texto curto)
      placements  TEXT NOT NULL DEFAULT 'tournaments',  -- onde aparece: tournaments, home (separados por vírgula)
      starts_at   TEXT,                         -- período ativo (null = sem limite)
      ends_at     TEXT,
      sort        INTEGER NOT NULL DEFAULT 0,
      logo        BLOB,
      logo_type   TEXT,                         -- image/png | image/jpeg | image/webp
      logo_version INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const tCols = (db.prepare('PRAGMA table_info(tournaments)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // official: torneio do time (Torneio da Tripulação), marcado só por admin.
  if (!tCols.includes('official')) db.exec('ALTER TABLE tournaments ADD COLUMN official INTEGER NOT NULL DEFAULT 0');
  // prize: prêmio anunciado (texto livre, ex.: "1 booster box, cortesia da Loja X").
  if (!tCols.includes('prize')) db.exec('ALTER TABLE tournaments ADD COLUMN prize TEXT');
  // sponsor_id: loja patrocinadora (sponsors.id).
  if (!tCols.includes('sponsor_id')) db.exec('ALTER TABLE tournaments ADD COLUMN sponsor_id TEXT');
  // priority_until: até quando só Almirantes se inscrevem (inscrição antecipada).
  if (!tCols.includes('priority_until')) db.exec('ALTER TABLE tournaments ADD COLUMN priority_until TEXT');
  // quota: criado pela cota de apoiador (o criador gerencia mesmo sem o perfil Organizador).
  if (!tCols.includes('quota')) db.exec('ALTER TABLE tournaments ADD COLUMN quota INTEGER NOT NULL DEFAULT 0');
}

/** Deck com os números de carta sem sufixo de versão ("P-029_r1" -> "P-029"), juntando as cópias. */
export function normalizeDeckIds<T extends Pick<DeckList, 'leader' | 'cards'>>(deck: T): T {
  const counts = new Map<string, number>();
  for (const c of deck.cards) counts.set(baseCardId(c.id), (counts.get(baseCardId(c.id)) ?? 0) + c.count);
  return { ...deck, leader: baseCardId(deck.leader), cards: [...counts].map(([id, count]) => ({ id, count })) };
}

/**
 * As promos reimpressas em starter deck vinham da API com o número da imagem ("P-029_r1"), e
 * assim foram gravadas nas cartas, nos decks e nas inscrições de torneio. Agora a importação usa
 * o número da carta: apaga as cartas antigas (a importação e o seed gravam as certas) e troca os
 * números nos decks.
 */
function migrateCardIds(db: DB) {
  const suffixed = (id: string) => baseCardId(id) !== id;
  const like = `LIKE '%\\_%' ESCAPE '\\'`;
  const del = db.prepare('DELETE FROM cards WHERE id = ?');
  for (const { id } of db.prepare(`SELECT id FROM cards WHERE id ${like}`).all() as Array<{ id: string }>) if (suffixed(id)) del.run(id);
  const fix = (deck: Pick<DeckList, 'leader' | 'cards'>) =>
    suffixed(deck.leader) || deck.cards.some((c) => suffixed(c.id)) ? normalizeDeckIds(deck) : null;
  const decks = db.prepare(`SELECT id, leader, cards FROM decks WHERE leader ${like} OR cards ${like}`).all() as Array<{
    id: string;
    leader: string;
    cards: string;
  }>;
  const writeDeck = db.prepare('UPDATE decks SET leader = ?, cards = ? WHERE id = ?');
  for (const r of decks) {
    const d = fix({ leader: r.leader, cards: JSON.parse(r.cards) });
    if (d) writeDeck.run(d.leader, JSON.stringify(d.cards), r.id);
  }
  const entries = db.prepare(`SELECT tournament_id, user_id, deck FROM tournament_players WHERE deck ${like}`).all() as Array<{
    tournament_id: string;
    user_id: string;
    deck: string;
  }>;
  const writeEntry = db.prepare('UPDATE tournament_players SET deck = ? WHERE tournament_id = ? AND user_id = ?');
  for (const r of entries) {
    const d = fix(JSON.parse(r.deck) as DeckList);
    if (d) writeEntry.run(JSON.stringify(d), r.tournament_id, r.user_id);
  }
}

/**
 * Torneios criados pelos organizadores. A lista de cada inscrito fica congelada na
 * inscrição (mudar o deck salvo depois não muda o deck do torneio).
 */
function migrateTournaments(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      format       TEXT NOT NULL,
      structure    TEXT NOT NULL,             -- swiss | single (eliminação simples)
      rounds       INTEGER,                   -- rodadas do suíço: escolhidas pelo organizador ou calculadas no início
      swiss_best_of INTEGER NOT NULL DEFAULT 1, -- partidas do suíço: melhor de 1 ou de 3
      top_cut      INTEGER,                   -- suíço: quantos vão para a eliminatória depois (null = sem top cut)
      bo3_from     INTEGER,                   -- eliminatória: melhor de 3 a partir da fase com estas vagas (8 = quartas)
      bo5_from     INTEGER,                   -- eliminatória: melhor de 5 a partir da fase com estas vagas (2 = final)
      max_players  INTEGER,
      starts_at    TEXT,                      -- data e hora previstas (ISO); com check_in, o torneio começa sozinho nessa hora
      status       TEXT NOT NULL DEFAULT 'registration',  -- registration | running | finished
      round        INTEGER NOT NULL DEFAULT 0,  -- rodada atual (0 = não começou)
      organizer_id TEXT NOT NULL REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      started_at   TEXT,
      finished_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id),
      name          TEXT NOT NULL,             -- nome público (perfil de estatísticas) na inscrição
      deck_id       TEXT,
      deck          TEXT NOT NULL,             -- JSON DeckList congelado na inscrição
      seed          INTEGER,                   -- ordem sorteada no início (desempate e chave)
      dropped       INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round         INTEGER NOT NULL,
      stage         TEXT NOT NULL DEFAULT 'swiss',  -- swiss | elim (top cut ou eliminação simples)
      table_no      INTEGER NOT NULL,
      p1            TEXT NOT NULL,
      p2            TEXT,                      -- null = bye
      best_of       INTEGER NOT NULL DEFAULT 1,
      wins1         INTEGER NOT NULL DEFAULT 0,  -- jogos vencidos na série
      wins2         INTEGER NOT NULL DEFAULT 0,
      result        TEXT,                      -- p1 | p2 | bye | none (derrota dupla) | loss (inscrição atrasada); null = série em andamento; não há empate
      next_first    TEXT,                      -- quem começa o próximo jogo da série (quem perdeu o anterior)
      room_id       TEXT,                      -- sala online do jogo atual da série
      match_id      INTEGER,                   -- partida gravada nas estatísticas
      reported_by   TEXT,                      -- game (sala online), bye, drop (desistência), noshow (W.O. automático), late (inscrição atrasada) ou id de quem lançou
      updated_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS tournament_matches_round ON tournament_matches(tournament_id, round);
  `);
  // Check-in e W.O. automático (ver tournaments/clock.ts).
  const tCols = (db.prepare('PRAGMA table_info(tournaments)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // check_in: o torneio começa sozinho na hora marcada, com check-in 30 min antes e tolerância de 5 min por rodada.
  if (!tCols.includes('check_in')) db.exec('ALTER TABLE tournaments ADD COLUMN check_in INTEGER NOT NULL DEFAULT 0');
  // round_at: quando a rodada atual foi gerada (a tolerância conta a partir daqui).
  if (!tCols.includes('round_at')) db.exec('ALTER TABLE tournaments ADD COLUMN round_at TEXT');
  // round_wo: a varredura de ausentes da rodada atual já foi feita.
  if (!tCols.includes('round_wo')) db.exec('ALTER TABLE tournaments ADD COLUMN round_wo INTEGER NOT NULL DEFAULT 0');
  // tolerance_min: minutos para entrar na sala em cada rodada (escolha do organizador).
  if (!tCols.includes('tolerance_min')) db.exec('ALTER TABLE tournaments ADD COLUMN tolerance_min INTEGER NOT NULL DEFAULT 5');
  // checkin_notice: hora de início (starts_at) cujo aviso de check-in já foi enviado por notificação.
  if (!tCols.includes('checkin_notice')) db.exec('ALTER TABLE tournaments ADD COLUMN checkin_notice TEXT');
  // spoilers: o torneio aceita cartas de spoiler (ainda não lançadas); só com o formato EGB ("todas as cartas").
  if (!tCols.includes('spoilers')) db.exec('ALTER TABLE tournaments ADD COLUMN spoilers INTEGER NOT NULL DEFAULT 0');
  // late_entry: inscrição atrasada liberada pelo organizador durante a rodada 1 do suíço
  // ('*' = qualquer um; senão, o id da conta liberada; null = fechada).
  if (!tCols.includes('late_entry')) db.exec('ALTER TABLE tournaments ADD COLUMN late_entry TEXT');
  const pCols = (db.prepare('PRAGMA table_info(tournament_players)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!pCols.includes('checked_in_at')) db.exec('ALTER TABLE tournament_players ADD COLUMN checked_in_at TEXT');
  const mCols = (db.prepare('PRAGMA table_info(tournament_matches)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  // p1_in / p2_in: quando cada jogador entrou na sala da série (presença para o W.O. automático).
  if (!mCols.includes('p1_in')) db.exec('ALTER TABLE tournament_matches ADD COLUMN p1_in TEXT');
  if (!mCols.includes('p2_in')) db.exec('ALTER TABLE tournament_matches ADD COLUMN p2_in TEXT');
  // Judge, chamados e warnings; início manual das rodadas (ver tournaments/routes.ts).
  // auto_start: com check_in, o torneio começa sozinho na hora marcada (opção para quando o organizador não está).
  // Antes desta coluna todo torneio com check-in começava sozinho: os já marcados continuam assim.
  if (!tCols.includes('auto_start')) {
    db.exec('ALTER TABLE tournaments ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE tournaments SET auto_start = 1 WHERE check_in = 1 AND status = 'registration'");
  }
  // max_warnings: warnings até a eliminação (null = o organizador decide caso a caso).
  if (!tCols.includes('max_warnings')) db.exec('ALTER TABLE tournaments ADD COLUMN max_warnings INTEGER');
  // live_hands: o organizador libera as mãos ao vivo para quem transmite (sem o atraso mínimo de 1 min).
  if (!tCols.includes('live_hands')) db.exec('ALTER TABLE tournaments ADD COLUMN live_hands INTEGER NOT NULL DEFAULT 0');
  // round_started_at: quando o organizador iniciou a rodada atual (as salas abrem e a tolerância conta daqui);
  // null = rodada gerada, à espera do início. Rodadas em andamento antes da coluna contam como iniciadas.
  if (!tCols.includes('round_started_at')) {
    db.exec('ALTER TABLE tournaments ADD COLUMN round_started_at TEXT');
    db.exec("UPDATE tournaments SET round_started_at = round_at WHERE status = 'running'");
  }
  // warnings_reviewed_at: o organizador decidiu manter o jogador depois de ele atingir o limite de warnings.
  if (!pCols.includes('warnings_reviewed_at')) db.exec('ALTER TABLE tournament_players ADD COLUMN warnings_reviewed_at TEXT');
  // p1_ready / p2_ready: "Estou pronto" de cada jogador na rodada (sinal para o organizador iniciar).
  if (!mCols.includes('p1_ready')) db.exec('ALTER TABLE tournament_matches ADD COLUMN p1_ready INTEGER NOT NULL DEFAULT 0');
  if (!mCols.includes('p2_ready')) db.exec('ALTER TABLE tournament_matches ADD COLUMN p2_ready INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    -- Judges de um torneio (escolhidos pelo organizador; sem nenhum, o organizador é o Judge).
    CREATE TABLE IF NOT EXISTS tournament_judges (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id),
      added_by      TEXT NOT NULL,
      added_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tournament_id, user_id)
    );

    -- Chamados de Judge: a sala fica pausada de opened_at até resolved_at (nota = relato do Judge ao organizador).
    CREATE TABLE IF NOT EXISTS tournament_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      match_id      INTEGER NOT NULL,
      room_id       TEXT,
      game          INTEGER NOT NULL DEFAULT 1,
      opened_by     TEXT NOT NULL,              -- conta que chamou (jogador, Judge ou organizador)
      opened_at     TEXT NOT NULL,
      resolved_by   TEXT,
      resolved_at   TEXT,
      note          TEXT
    );
    CREATE INDEX IF NOT EXISTS tournament_calls_open ON tournament_calls(tournament_id, resolved_at);

    -- Warnings dados pelo Judge ou pelo organizador; valem o torneio inteiro (revoked_at = anulado pelo organizador).
    CREATE TABLE IF NOT EXISTS tournament_warnings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      given_by      TEXT NOT NULL,
      given_at      TEXT NOT NULL,
      round         INTEGER NOT NULL DEFAULT 0,
      match_id      INTEGER,
      call_id       INTEGER,
      reason        TEXT NOT NULL,
      revoked_at    TEXT,
      revoked_by    TEXT
    );
    CREATE INDEX IF NOT EXISTS tournament_warnings_player ON tournament_warnings(tournament_id, user_id);

    -- Intervenções do modo manual do Judge numa partida: entrar/sair, desfazer jogadas e corrigir a mesa.
    CREATE TABLE IF NOT EXISTS tournament_interventions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      match_id      INTEGER NOT NULL,
      room_id       TEXT,
      game          INTEGER NOT NULL DEFAULT 1,
      user_id       TEXT NOT NULL,              -- quem fez
      role          TEXT NOT NULL,              -- papel naquele momento: admin | dev | organizer | judge
      kind          TEXT NOT NULL,              -- manual_on | manual_off | undo | judge_action
      payload       TEXT,                       -- JSON: a correção (ação do motor) ou { to } no desfazer
      removed       TEXT,                       -- JSON: as ações desfeitas
      note          TEXT,
      at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tournament_interventions_match ON tournament_interventions(tournament_id, match_id);
  `);
  db.exec(`
    -- Todos os jogos disputados nas salas de cada partida (série), para a auditoria do organizador.
    CREATE TABLE IF NOT EXISTS tournament_games (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      match_id       INTEGER NOT NULL,          -- tournament_matches.id (a série)
      game           INTEGER NOT NULL,          -- jogo da série (1, 2, 3…)
      stats_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,  -- partida gravada (replay)
      room_id        TEXT,
      winner         TEXT,                      -- conta vencedora (null = sem vencedor)
      counted        INTEGER NOT NULL DEFAULT 1,  -- entrou no placar da série (0 = sala que não era a atual)
      played_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tournament_games_match ON tournament_games(tournament_id, match_id);

    -- Problemas (bugs) relatados pelos jogadores ao fim de uma partida.
    CREATE TABLE IF NOT EXISTS match_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,
      reporter_id   TEXT NOT NULL REFERENCES users(id),
      text          TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT,
      resolved_by   TEXT,
      note          TEXT,
      UNIQUE (match_id, reporter_id)
    );
    CREATE INDEX IF NOT EXISTS match_reports_open ON match_reports(resolved_at, created_at);
  `);
  // Formulário de bug: a carta, o que deveria ter acontecido e se o jogador quer ser avisado da correção
  // (`text` continua sendo a descrição do que aconteceu, a interação com problema).
  const reportCols = (db.prepare('PRAGMA table_info(match_reports)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!reportCols.includes('card')) db.exec('ALTER TABLE match_reports ADD COLUMN card TEXT');
  if (!reportCols.includes('expected')) db.exec('ALTER TABLE match_reports ADD COLUMN expected TEXT');
  if (!reportCols.includes('notify')) db.exec('ALTER TABLE match_reports ADD COLUMN notify INTEGER NOT NULL DEFAULT 0');
  // Quando o aviso da correção saiu (reabrir e resolver de novo não avisa duas vezes).
  if (!reportCols.includes('notified_at')) db.exec('ALTER TABLE match_reports ADD COLUMN notified_at TEXT');
}

/**
 * Tutorial "Aprender a jogar": o progresso de cada dono (conta `user:<id>` ou navegador, a mesma
 * chave das estatísticas) e as contagens anônimas de eventos das lições (sem dono, sem IP: só
 * lição, passo, evento e dia), para ver onde as pessoas desistem.
 */
function migrateTutorial(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tutorial_progress (
      owner_hash   TEXT PRIMARY KEY,
      done         TEXT NOT NULL DEFAULT '[]',  -- JSON: ids das lições concluídas
      dismissed    INTEGER NOT NULL DEFAULT 0,  -- "Já sei jogar": sem convite na home
      completed_at TEXT,                        -- concluiu a Rota inteira (título)
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tutorial_events (
      day    TEXT NOT NULL,                     -- AAAA-MM-DD (UTC)
      lesson TEXT NOT NULL,
      step   TEXT NOT NULL,                     -- '' para eventos da lição inteira
      event  TEXT NOT NULL,                     -- start | step | fail | exit | complete
      count  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, lesson, step, event)
    );
  `);
}

/** Contas (login com Google) e sessões abertas. Do token de sessão só o hash é guardado. */
function migrateAuth(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      google_sub    TEXT NOT NULL UNIQUE,       -- id permanente da conta Google
      email         TEXT,
      name          TEXT,                       -- nome da conta Google (só o próprio usuário vê)
      picture       TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  // Perfil da conta: player (padrão), streamer (assiste vendo as mãos), organizer (torneios) ou admin.
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!userCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'");
  // Foto escolhida pelo próprio usuário (no lugar da foto do Google): a imagem, o tipo e a versão (ms).
  if (!userCols.includes('custom_picture')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN custom_picture BLOB;
      ALTER TABLE users ADD COLUMN custom_picture_type TEXT;
      ALTER TABLE users ADD COLUMN custom_picture_at INTEGER;
    `);
  }
  // Modo transmissão (streamer): o link secreto da fonte do OBS e a partida escolhida para a live.
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      key               TEXT NOT NULL UNIQUE,          -- segredo do link (o streamer copia de novo quando quiser)
      room_id           TEXT,                          -- partida na transmissão (null = nenhuma)
      delay_s           INTEGER NOT NULL DEFAULT 180,  -- atraso escolhido (0 a 600 s)
      hands_players     INTEGER NOT NULL DEFAULT 1,    -- mãos dos dois jogadores nas partidas que assiste
      hands_own         INTEGER NOT NULL DEFAULT 0,    -- a própria mão nas partidas que joga
      delay_tournaments INTEGER NOT NULL DEFAULT 0,    -- atraso nas partidas de torneio mesmo sem mãos
      chat              INTEGER NOT NULL DEFAULT 1,    -- chat dos jogadores na tela de transmissão
      rev               INTEGER NOT NULL DEFAULT 0,    -- muda a cada troca de partida ou de opção
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Notificações (Web Push): uma linha por navegador inscrito. O dono é o navegador (hash do
 * código de dono) e, com login, também a conta; cada linha guarda o idioma e quais avisos
 * a pessoa quer. `server_keys` guarda o par de chaves VAPID gerado na primeira vez.
 */
function migratePush(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint    TEXT PRIMARY KEY,           -- URL do serviço de push (única por navegador)
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      owner_hash  TEXT NOT NULL,              -- navegador (SHA-256 do código de dono)
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      locale      TEXT NOT NULL DEFAULT 'pt-BR',
      matches     INTEGER NOT NULL DEFAULT 1, -- partidas online: oponente chegou, sua vez
      tournaments INTEGER NOT NULL DEFAULT 1, -- torneios: check-in, rodada nova, oponente na sala
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_owner ON push_subscriptions(owner_hash);
    CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS server_keys (
      name  TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Estatísticas. `matches` guarda a partida e o replay; `match_seats` é a tabela de
 * fatos: uma linha por lado da partida, com todas as dimensões dos filtros
 * (formato, fila, tier, Líderes, quem começou), para que as consultas não
 * precisem de joins. `match_cards` detalha cada carta do deck daquele lado.
 * `listed = 0`: partida que não entra nas estatísticas (Livre, spoilers; ver `countsInStats`).
 */
function migrateStats(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(matches)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes('format')) db.exec('ALTER TABLE matches ADD COLUMN format TEXT');
  if (!cols.includes('queue')) db.exec('ALTER TABLE matches ADD COLUMN queue TEXT');
  if (!cols.includes('first_player')) db.exec('ALTER TABLE matches ADD COLUMN first_player INTEGER');
  // JSON { seed, firstPlayer, decks, actions }: permite recalcular as estatísticas.
  if (!cols.includes('replay')) db.exec('ALTER TABLE matches ADD COLUMN replay TEXT');
  db.exec(`
    -- Jogador = conta ("user:<id>") ou, sem login, o navegador (hash do código de dono).
    CREATE TABLE IF NOT EXISTS players (
      id           TEXT PRIMARY KEY,
      owner_hash   TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      bounty       INTEGER NOT NULL DEFAULT 0,  -- recompensa em Beries (ranqueada)
      ranked_games INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Listas exatas usadas em partidas (imutáveis; o deck salvo pode mudar depois).
    CREATE TABLE IF NOT EXISTS deck_lists (
      hash       TEXT PRIMARY KEY,
      leader     TEXT NOT NULL,
      cards      TEXT NOT NULL,                 -- JSON: [{ id, count }]
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS match_seats (
      match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      seat           INTEGER NOT NULL,
      controller     TEXT NOT NULL,             -- human | bot
      player_id      TEXT REFERENCES players(id),
      deck_id        TEXT,
      deck_hash      TEXT NOT NULL REFERENCES deck_lists(hash),
      leader         TEXT NOT NULL,
      opp_leader     TEXT NOT NULL,
      opp_controller TEXT NOT NULL,
      tier           TEXT,                      -- tier do jogador no momento da partida
      bounty_before  INTEGER,
      bounty_after   INTEGER,
      went_first     INTEGER NOT NULL,
      won            INTEGER NOT NULL,
      mulligan       INTEGER NOT NULL,
      format         TEXT NOT NULL,
      queue          TEXT NOT NULL,
      played_at      TEXT NOT NULL,
      PRIMARY KEY (match_id, seat)
    );
    CREATE INDEX IF NOT EXISTS seats_dims ON match_seats(format, queue, controller, leader);
    CREATE INDEX IF NOT EXISTS seats_matchup ON match_seats(leader, opp_leader);
    CREATE INDEX IF NOT EXISTS seats_player ON match_seats(player_id);

    CREATE TABLE IF NOT EXISTS match_cards (
      match_id INTEGER NOT NULL,
      seat     INTEGER NOT NULL,
      card_id  TEXT NOT NULL,
      copies   INTEGER NOT NULL,                -- cópias no deck
      opening  INTEGER NOT NULL,                -- cópias na mão mantida após o mulligan
      drawn    INTEGER NOT NULL,                -- cópias que passaram pela mão
      played   INTEGER NOT NULL,                -- vezes jogada da mão (inclui Counter)
      PRIMARY KEY (match_id, seat, card_id),
      FOREIGN KEY (match_id, seat) REFERENCES match_seats(match_id, seat) ON DELETE CASCADE
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS match_cards_card ON match_cards(card_id);

    -- Partidas online em andamento (seed, decks e ações): refeitas ao reiniciar o servidor.
    CREATE TABLE IF NOT EXISTS live_matches (
      id         TEXT PRIMARY KEY,
      data       TEXT NOT NULL,                 -- JSON (online/room.ts: RoomData)
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const seatCols = (db.prepare('PRAGMA table_info(match_seats)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
  if (!seatCols.includes('listed')) {
    db.exec('ALTER TABLE match_seats ADD COLUMN listed INTEGER NOT NULL DEFAULT 1');
    // As partidas dos torneios que já aceitavam spoilers saem das estatísticas.
    const hasTournaments = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tournament_games'").get();
    if (hasTournaments) {
      db.exec(`UPDATE match_seats SET listed = 0 WHERE match_id IN (
        SELECT g.stats_match_id FROM tournament_games g JOIN tournaments t ON t.id = g.tournament_id
        WHERE t.spoilers = 1 AND g.stats_match_id IS NOT NULL)`);
    }
  }
}

// ------------------------------------------------------------------ partidas online

export function saveLiveMatch(db: DB, id: string, data: unknown) {
  db.prepare(
    `INSERT INTO live_matches (id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(data));
}

export function deleteLiveMatch(db: DB, id: string) {
  db.prepare('DELETE FROM live_matches WHERE id = ?').run(id);
}

export function listLiveMatches(db: DB): Array<{ id: string; data: string }> {
  return db.prepare('SELECT id, data FROM live_matches').all() as Array<{ id: string; data: string }>;
}

// ------------------------------------------------------------------ cartas

/**
 * Junta as artes alternativas já gravadas às da importação: a sincronização dos spoilers
 * importa só algumas coleções, e uma carta reimpressa nelas perderia as artes das outras (e a
 * escolha feita nos decks). As da importação vêm primeiro.
 */
function keepArts(card: CardData, storedData: string): CardData {
  let stored: CardArt[] | undefined;
  try {
    stored = (JSON.parse(storedData) as CardData).arts;
  } catch {
    return card;
  }
  if (!stored?.length) return card;
  // Pelo id da arte, não pela URL: a mesma arte já copiada para a CDN própria tem outro endereço.
  const seen = new Set([card.imageUrl, ...(card.arts ?? []).flatMap((a) => [a.imageUrl, a.id])]);
  const extra = stored.filter((a) => !seen.has(a.imageUrl) && !seen.has(a.id));
  return extra.length ? { ...card, arts: [...(card.arts ?? []), ...extra] } : card;
}

export function upsertCards(
  db: DB,
  cards: CardData[],
  opts: { provisional: boolean; source: string; raw?: Map<string, unknown> },
): { written: number; skipped: number } {
  const existing = db.prepare('SELECT provisional, data FROM cards WHERE id = ?');
  const write = db.prepare(`
    INSERT INTO cards (id, set_code, name, category, data, provisional, source, raw, updated_at)
    VALUES (@id, @set_code, @name, @category, @data, @provisional, @source, @raw, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      set_code = excluded.set_code, name = excluded.name, category = excluded.category,
      data = excluded.data, provisional = excluded.provisional, source = excluded.source,
      raw = excluded.raw, updated_at = excluded.updated_at
  `);
  let written = 0;
  let skipped = 0;
  transaction(db, () => {
    for (const card of cards) {
      let c = fixCard(card);
      const row = existing.get(c.id) as { provisional: number; data: string } | undefined;
      // Dados provisórios nunca sobrescrevem dados vindos da API.
      if (opts.provisional && row && !row.provisional) {
        skipped++;
        continue;
      }
      if (row) c = keepArts(c, row.data);
      write.run({
        id: c.id,
        set_code: c.set ?? c.id.split('-')[0],
        name: c.name,
        category: c.category,
        data: JSON.stringify(c),
        provisional: opts.provisional ? 1 : 0,
        source: opts.source,
        raw: opts.raw?.has(c.id) ? JSON.stringify(opts.raw.get(c.id)) : null,
      });
      written++;
    }
  });
  return { written, skipped };
}

/** Origem das cartas de spoiler (data/spoilers). Elas são provisórias: a API oficial as substitui. */
export const SPOILER_SOURCE = 'spoiler:';

/** Cartas de spoiler que ainda não chegaram na API oficial. */
export function pendingSpoilers(db: DB): string[] {
  return (
    db.prepare(`SELECT id FROM cards WHERE provisional = 1 AND source LIKE '${SPOILER_SOURCE}%' ORDER BY id`).all() as unknown as Array<{
      id: string;
    }>
  ).map((r) => r.id);
}

/**
 * Apaga as cartas de spoiler de uma origem que não estão mais nela (número corrigido,
 * carta desmentida). `source` é um padrão LIKE; `set` limita a uma coleção.
 */
export function pruneSpoilers(db: DB, keep: Iterable<string>, where: { source: string; set?: string }): number {
  const keepSet = new Set(keep);
  const rows = db
    .prepare(`SELECT id FROM cards WHERE provisional = 1 AND source LIKE ? ${where.set ? 'AND set_code = ?' : ''}`)
    .all(...[where.source, ...(where.set ? [where.set] : [])]) as unknown as Array<{ id: string }>;
  const gone = rows.map((r) => r.id).filter((id) => !keepSet.has(id));
  const del = db.prepare('DELETE FROM cards WHERE id = ? AND provisional = 1');
  transaction(db, () => gone.forEach((id) => del.run(id)));
  return gone.length;
}

/** A coleção já tem cartas vindas da API oficial. */
export function hasOfficialCards(db: DB, set: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM cards WHERE set_code = ? AND provisional = 0 LIMIT 1').get(set));
}

type CardRow = { data: string; provisional: number; e_text: string | null; e_trigger: string | null; e_base: string | null };
/** As colunas de `CardRow`: a carta e o texto para o motor (card_engine_texts), se houver. */
const CARD_COLUMNS = 'c.data, c.provisional, e.text AS e_text, e.trigger AS e_trigger, e.base_key AS e_base';
const CARD_FROM = 'cards c LEFT JOIN card_engine_texts e ON e.card_id = c.id';
// Correções de nome/tipos e errata valem também para as cartas já gravadas (importadas antes de a correção entrar na tabela).
// O texto para o motor só vale enquanto o texto oficial for o mesmo de quando foi escrito.
const toCard = (r: CardRow) => {
  const card: CardData & { provisional: boolean } = { ...fixCard(JSON.parse(r.data) as CardData), provisional: Boolean(r.provisional) };
  if (r.e_text !== null && r.e_base === officialTextKey(card)) card.engineText = { text: r.e_text, ...(r.e_trigger ? { trigger: r.e_trigger } : {}) };
  return card;
};

export function listCards(db: DB, set?: string) {
  const rows = (
    set
      ? db.prepare(`SELECT ${CARD_COLUMNS} FROM ${CARD_FROM} WHERE c.set_code = ? ORDER BY c.id`).all(set)
      : db.prepare(`SELECT ${CARD_COLUMNS} FROM ${CARD_FROM} ORDER BY c.id`).all()
  ) as unknown as CardRow[];
  return rows.map(toCard);
}

/** Todos os Líderes (para escolher o oponente na fila casual). */
export function listLeaders(db: DB) {
  const rows = db.prepare(`SELECT ${CARD_COLUMNS} FROM ${CARD_FROM} WHERE c.category = 'leader' ORDER BY c.id`).all() as unknown as CardRow[];
  return rows.map(toCard);
}

export function getCards(db: DB, ids: string[]) {
  if (!ids.length) return [];
  const rows = db
    .prepare(`SELECT ${CARD_COLUMNS} FROM ${CARD_FROM} WHERE c.id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as CardRow[];
  return rows.map(toCard);
}

export function countCards(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as unknown as { n: number }).n;
}

// ------------------------------------------------------------------ traduções

export interface TranslationRow {
  card_id: string;
  text: string;
  trigger: string | null;
}

export function upsertTranslations(db: DB, lang: string, rows: Array<{ id: string; text: string; trigger?: string }>) {
  const write = db.prepare(`
    INSERT INTO card_translations (card_id, lang, text, trigger, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(card_id, lang) DO UPDATE SET text = excluded.text, trigger = excluded.trigger,
      updated_at = excluded.updated_at
  `);
  transaction(db, () => {
    for (const r of rows) write.run(r.id, lang, r.text, r.trigger ?? null);
  });
}

export function getTranslations(db: DB, lang: string, ids?: string[]): Map<string, TranslationRow> {
  const rows = (
    ids
      ? ids.length
        ? db
            .prepare(`SELECT card_id, text, trigger FROM card_translations WHERE lang = ? AND card_id IN (${ids.map(() => '?').join(',')})`)
            .all(lang, ...ids)
        : []
      : db.prepare('SELECT card_id, text, trigger FROM card_translations WHERE lang = ?').all(lang)
  ) as unknown as TranslationRow[];
  return new Map(rows.map((r) => [r.card_id, r]));
}

// ------------------------------------------------------------------ decks

/** builtin = vem de data/decks (recriado a cada início); user = montado pelo jogador. */
export type DeckKind = 'builtin' | 'user';
export type StoredDeck = DeckList & { kind: DeckKind; updatedAt: string; ownerHash: string | null };

/** Grava um deck. O dono só é definido na criação (um update nunca troca o dono). */
export function upsertDeck(db: DB, deck: DeckList, kind: DeckKind = 'builtin', ownerHash: string | null = null) {
  db.prepare(`
    INSERT INTO decks (id, name, leader, cards, arts, kind, owner_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, leader = excluded.leader,
      cards = excluded.cards, arts = excluded.arts, kind = excluded.kind, updated_at = excluded.updated_at
  `).run(
    deck.id,
    deck.name,
    deck.leader,
    JSON.stringify(deck.cards),
    deck.arts && Object.keys(deck.arts).length ? JSON.stringify(deck.arts) : null,
    kind,
    ownerHash,
  );
}

type DeckRow = {
  id: string;
  name: string;
  leader: string;
  cards: string;
  arts: string | null;
  kind: DeckKind;
  updated_at: string;
  owner_hash: string | null;
};
const DECK_COLS = 'id, name, leader, cards, arts, kind, updated_at, owner_hash';
const toDeck = (r: DeckRow): StoredDeck => ({
  id: r.id,
  name: r.name,
  leader: r.leader,
  cards: JSON.parse(r.cards),
  ...(r.arts ? { arts: JSON.parse(r.arts) as Record<string, string> } : {}),
  kind: r.kind,
  updatedAt: r.updated_at,
  ownerHash: r.owner_hash,
});

export function listDecks(db: DB): StoredDeck[] {
  return (
    db.prepare(`SELECT ${DECK_COLS} FROM decks ORDER BY kind = 'builtin', updated_at DESC, id`).all() as unknown as DeckRow[]
  ).map(toDeck);
}

export function getDeck(db: DB, id: string): StoredDeck | null {
  const row = db.prepare(`SELECT ${DECK_COLS} FROM decks WHERE id = ?`).get(id) as unknown as DeckRow | undefined;
  return row ? toDeck(row) : null;
}

/** Só o nome (o dono e as cartas continuam). */
export function renameDeck(db: DB, id: string, name: string): boolean {
  return Number(db.prepare(`UPDATE decks SET name = ?, updated_at = datetime('now') WHERE id = ? AND kind = 'user'`).run(name, id).changes) > 0;
}

export function deleteDeck(db: DB, id: string): boolean {
  return Number(db.prepare(`DELETE FROM decks WHERE id = ? AND kind = 'user'`).run(id).changes) > 0;
}

/** Marca ou desmarca um deck como favorito de quem pede (conta ou navegador). */
export function setDeckFavorite(db: DB, ownerHash: string, deckId: string, on: boolean) {
  if (on) db.prepare('INSERT OR IGNORE INTO deck_favorites (owner_hash, deck_id) VALUES (?, ?)').run(ownerHash, deckId);
  else db.prepare('DELETE FROM deck_favorites WHERE owner_hash = ? AND deck_id = ?').run(ownerHash, deckId);
}

/** Ids dos decks favoritos de quem pede. */
export function deckFavorites(db: DB, ownerHash: string | null): Set<string> {
  if (!ownerHash) return new Set();
  const rows = db.prepare('SELECT deck_id FROM deck_favorites WHERE owner_hash = ?').all(ownerHash) as Array<{ deck_id: string }>;
  return new Set(rows.map((r) => r.deck_id));
}

/** Partidas jogadas por pessoas (não pelo robô) com cada deck salvo. */
export function deckGames(db: DB): Map<string, number> {
  const rows = db
    .prepare("SELECT deck_id, COUNT(*) AS n FROM match_seats WHERE controller = 'human' AND deck_id IS NOT NULL GROUP BY deck_id")
    .all() as Array<{ deck_id: string; n: number }>;
  return new Map(rows.map((r) => [r.deck_id, Number(r.n)]));
}

/** Última partida de quem pede com cada deck (para "Recentes"). */
export function deckLastPlayed(db: DB, ownerHash: string | null): Map<string, string> {
  if (!ownerHash) return new Map();
  const rows = db
    .prepare(
      `SELECT s.deck_id, MAX(s.played_at) AS at FROM match_seats s JOIN players p ON p.id = s.player_id
       WHERE p.owner_hash = ? AND s.deck_id IS NOT NULL GROUP BY s.deck_id`,
    )
    .all(ownerHash) as Array<{ deck_id: string; at: string }>;
  return new Map(rows.map((r) => [r.deck_id, r.at]));
}

// ------------------------------------------------------------------ partidas

export function recentMatches(db: DB, limit = 20) {
  return db
    .prepare(
      `SELECT id, seed, mode, deck0, deck1, winner, turns, reason, format, queue, first_player, created_at
       FROM matches ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
}
