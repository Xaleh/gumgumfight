// Rotas do apoio ao projeto: o que o modal "Apoiar" mostra, a lista de Apoiadores,
// o webhook da plataforma de apoio (Ko-fi), a consulta usada pela homologação e o
// plano dado à mão pelo admin.

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  applySupporterPayment,
  getUser,
  isAdmin,
  setSupporter,
  setSupporterPublic,
  type User,
  userByVerifiedEmail,
} from '../auth/store';
import type { SupportOptions } from '../config';
import type { DB } from '../db';
import { pixPayload } from './pix';
import {
  createSponsor,
  deleteSponsor,
  getSponsor,
  imageType,
  listSponsors,
  MAX_LOGO_BYTES,
  type Placement,
  PLACEMENTS,
  publicSponsor,
  setSponsorLogo,
  type SponsorInput,
  sponsorLogo,
  updateSponsor,
} from './sponsors';
import { isSupporterTier, SUPPORTER_TIERS, type SupporterTier, TIER_INFO, tierFromPayment, tierRank } from './tiers';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  options: SupportOptions;
}

/** Valores sugeridos do café (o primeiro, sem valor, deixa quem paga digitar). */
export const COFFEE_AMOUNTS = [null, 5, 10, 25] as const;

/** Comparação de tokens em tempo constante. */
export function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** O apoio está configurado (pelo menos um jeito de apoiar): o item "Apoiar" aparece no site. */
export const supportEnabled = (o: SupportOptions | undefined) => Boolean(o && ((o.pixKey && o.pixName && o.pixCity) || o.coffeeUrl || o.monthlyUrl));

/** Plano de quem está ativo agora, por plano (contagem). */
function activeCounts(db: DB): Record<SupporterTier, number> {
  const rows = db
    .prepare(
      `SELECT supporter_tier AS tier, COUNT(*) AS n FROM users
       WHERE supporter_tier IS NOT NULL AND (supporter_until IS NULL OR supporter_until > ?)
       GROUP BY supporter_tier`,
    )
    .all(new Date().toISOString()) as Array<{ tier: string; n: number }>;
  const out = Object.fromEntries(SUPPORTER_TIERS.map((t) => [t, 0])) as Record<SupporterTier, number>;
  for (const r of rows) if (isSupporterTier(r.tier)) out[r.tier] = Number(r.n);
  return out;
}

/** Data "AAAA-MM-DD" (fim do dia, horário de Brasília; `startOfDay` = início) ou ISO completo. */
function parseUntil(v: unknown, startOfDay = false): string | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return 'invalid';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${startOfDay ? '00:00:00' : '23:59:59'}-03:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

type SponsorBody = { name?: unknown; url?: unknown; offer?: unknown; placements?: unknown; startsAt?: unknown; endsAt?: unknown; sort?: unknown };

function parseSponsor(b: SponsorBody | undefined): SponsorInput | string {
  if (!b || typeof b !== 'object') return 'Corpo inválido.';
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (name.length < 2) return 'Dê o nome da loja.';
  const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim().slice(0, 300) : null;
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return 'O link precisa começar com http:// ou https://.';
  const offer = typeof b.offer === 'string' && b.offer.trim() ? b.offer.trim().replace(/\s+/g, ' ').slice(0, 160) : null;
  const placements = Array.isArray(b.placements) ? PLACEMENTS.filter((p) => (b.placements as unknown[]).includes(p)) : (['tournaments'] as Placement[]);
  if (!placements.length) return 'Escolha onde a loja aparece.';
  const startsAt = parseUntil(b.startsAt, true);
  const endsAt = parseUntil(b.endsAt);
  if (startsAt === 'invalid' || endsAt === 'invalid') return 'Data inválida.';
  if (startsAt && endsAt && endsAt <= startsAt) return 'O fim precisa ser depois do início.';
  const sort = Number.isInteger(Number(b.sort)) ? Math.max(-999, Math.min(999, Number(b.sort))) : 0;
  return { name, url, offer, placements, startsAt, endsAt, sort };
}

export function registerSupportRoutes(app: FastifyInstance, { db, user, options }: Deps) {
  // O Ko-fi manda o webhook como formulário (campo `data` com o JSON).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const pix = (() => {
    const { pixKey, pixName, pixCity } = options;
    if (!pixKey || !pixName || !pixCity) return null;
    try {
      return {
        key: pixKey,
        name: pixName,
        city: pixCity,
        codes: COFFEE_AMOUNTS.map((amount) => ({ amount, code: pixPayload({ key: pixKey, name: pixName, city: pixCity, amount, message: 'GumGum Fight' }) })),
      };
    } catch (e) {
      app.log.error(e, 'Pix do apoio: chave, nome ou cidade inválidos');
      return null;
    }
  })();

  /** Tudo o que o modal "Apoiar o projeto" mostra. */
  app.get('/api/support', async (req) => {
    const counts = activeCounts(db);
    const u = user(req);
    return {
      enabled: supportEnabled(options),
      pix,
      coffeeUrl: options.coffeeUrl ?? null,
      monthlyUrl: options.monthlyUrl ?? null,
      contactUrl: options.contactUrl ?? null,
      goal: options.goalBrl ?? null,
      /** Soma mensal dos planos ativos (estimativa do que já está coberto). */
      covered: SUPPORTER_TIERS.reduce((sum, t) => sum + counts[t] * TIER_INFO[t].price, 0),
      supporters: SUPPORTER_TIERS.reduce((sum, t) => sum + counts[t], 0),
      tiers: SUPPORTER_TIERS.map((t) => TIER_INFO[t]),
      me: u ? { tier: u.supporterTier, until: u.supporterUntil, source: u.supporterSource, public: u.supporterPublic } : null,
    };
  });

  /** Lista pública de Apoiadores: só quem aceitou aparecer, com o nome público (do perfil), Almirantes primeiro. */
  app.get('/api/support/supporters', async () => {
    const rows = db
      .prepare(
        `SELECT u.supporter_tier AS tier, p.name AS name FROM users u
         JOIN players p ON p.owner_hash = 'user:' || u.id
         WHERE u.supporter_public = 1 AND u.supporter_tier IS NOT NULL AND (u.supporter_until IS NULL OR u.supporter_until > ?)
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all(new Date().toISOString()) as Array<{ tier: string; name: string }>;
    return rows
      .filter((r) => isSupporterTier(r.tier))
      .map((r) => ({ name: r.name, tier: r.tier as SupporterTier }))
      .sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
  });

  /** Aparecer (ou não) na lista de Apoiadores. */
  app.put<{ Body: { public?: unknown } }>('/api/support/me', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(401).send({ error: 'Entre com a conta Google.' });
    if (typeof req.body?.public !== 'boolean') return reply.code(400).send({ error: 'Valor inválido.' });
    setSupporterPublic(db, u.id, req.body.public);
    return { public: req.body.public };
  });

  /**
   * Webhook do Ko-fi: cada pagamento chega aqui. Assinatura mensal com plano
   * reconhecido liga o plano na conta do mesmo e-mail (confirmado pelo Google) por
   * 35 dias; se a conta ainda não existe, o plano é aplicado no primeiro login.
   * O Ko-fi não avisa cancelamentos: o plano vence sozinho quando o pagamento para.
   */
  app.post<{ Body: { data?: unknown } }>('/api/support/kofi', async (req, reply) => {
    if (!options.kofiToken) return reply.code(404).send({ error: 'Não encontrado' });
    let data: Record<string, unknown>;
    try {
      data = typeof req.body?.data === 'string' ? JSON.parse(req.body.data) : (req.body?.data as Record<string, unknown>);
    } catch {
      return reply.code(400).send({ error: 'Dados inválidos.' });
    }
    if (!data || typeof data !== 'object') return reply.code(400).send({ error: 'Dados inválidos.' });
    if (!sameToken(String(data.verification_token ?? ''), options.kofiToken)) return reply.code(401).send({ error: 'Token inválido.' });
    const id = String(data.kofi_transaction_id ?? data.message_id ?? '').slice(0, 100);
    if (!id) return reply.code(400).send({ error: 'Transação sem id.' });
    const email = typeof data.email === 'string' && data.email.includes('@') ? data.email.trim().toLowerCase().slice(0, 200) : null;
    const kind = String(data.type ?? 'Donation').slice(0, 30);
    const amount = Number(data.amount);
    const currency = String(data.currency ?? '').slice(0, 8);
    const paidAt = Number.isNaN(Date.parse(String(data.timestamp))) ? new Date().toISOString() : new Date(String(data.timestamp)).toISOString();
    const subscription = data.is_subscription_payment === true || data.is_subscription_payment === 'true' || kind === 'Subscription';
    const tier = subscription ? tierFromPayment(typeof data.tier_name === 'string' ? data.tier_name : null, amount, currency) : null;

    const inserted = db
      .prepare('INSERT OR IGNORE INTO supporter_payments (id, email, kind, tier, amount, currency, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, kind, tier, Number.isFinite(amount) ? amount : 0, currency, paidAt);
    // Reenvio da mesma transação: já foi tratada.
    if (Number(inserted.changes) === 0) return { ok: true, duplicate: true };
    const account = email ? userByVerifiedEmail(db, email) : null;
    if (account) db.prepare('UPDATE supporter_payments SET user_id = ? WHERE id = ?').run(account.id, id);
    const applied = Boolean(account && tier && applySupporterPayment(db, account.id, tier, paidAt));
    req.log.info({ kind, tier, applied, matched: Boolean(account) }, 'apoio: pagamento recebido do Ko-fi');
    return { ok: true, tier, applied };
  });

  /**
   * Consulta do plano pela homologação (ACCESS=supporters em outro servidor), com o
   * mesmo INTERNAL_TOKEN dos dois lados. Só responde por e-mails confirmados.
   */
  app.get<{ Querystring: { email?: string } }>('/api/internal/supporter', async (req, reply) => {
    if (!options.internalToken) return reply.code(404).send({ error: 'Não encontrado' });
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!sameToken(auth, options.internalToken)) return reply.code(401).send({ error: 'Token inválido.' });
    const email = typeof req.query.email === 'string' ? req.query.email.slice(0, 200) : '';
    if (!email.includes('@')) return reply.code(400).send({ error: 'E-mail inválido.' });
    const u = userByVerifiedEmail(db, email);
    return { tier: u?.supporterTier ?? null, admin: Boolean(u && isAdmin(u.role)) };
  });

  // ---------------------------------------------------------------- lojas patrocinadoras

  /** Lojas ativas (de um lugar do site, se pedido) e o contato para quem quer patrocinar. */
  app.get<{ Querystring: { placement?: string } }>('/api/sponsors', async (req) => {
    const placement = PLACEMENTS.find((p) => p === req.query.placement);
    return {
      sponsors: listSponsors(db)
        .filter((sp) => sp.active && (!placement || sp.placements.includes(placement)))
        .map(publicSponsor),
      contactUrl: options.contactUrl ?? null,
    };
  });

  app.get<{ Params: { id: string } }>('/api/sponsors/:id/logo', async (req, reply) => {
    const logo = sponsorLogo(db, req.params.id);
    if (!logo) return reply.code(404).send({ error: 'Sem logo.' });
    // A URL muda a cada novo logo (?v=), então pode ficar em cache por bastante tempo.
    return reply
      .header('content-type', logo.type)
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(logo.data);
  });

  // ---------------------------------------------------------------- admin

  const admin = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send({ error: 'Entre com a conta Google.' });
    else if (!isAdmin(u.role)) void reply.code(403).send({ error: 'Só administradores podem fazer isso.' });
    else return u;
    return null;
  };

  /** Plano dado à mão (Pix mensal, parceria, cortesia). `tier` null tira o plano; `until` vazio = sem prazo. */
  app.put<{ Params: { id: string }; Body: { tier?: unknown; until?: unknown } }>('/api/admin/users/:id/supporter', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const tier = req.body?.tier ?? null;
    if (tier !== null && !isSupporterTier(tier)) return reply.code(400).send({ error: 'Plano inválido.' });
    const until = parseUntil(req.body?.until);
    if (until === 'invalid') return reply.code(400).send({ error: 'Data inválida.' });
    if (!setSupporter(db, req.params.id, tier, until)) return reply.code(404).send({ error: 'Conta não encontrada.' });
    const u = getUser(db, req.params.id)!;
    return { id: u.id, supporterTier: u.supporterTier, supporterUntil: u.supporterUntil, supporterSource: u.supporterSource };
  });

  app.get('/api/admin/sponsors', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    return listSponsors(db).map((sp) => ({ ...sp, ...publicSponsor(sp) }));
  });

  app.post<{ Body: SponsorBody }>('/api/admin/sponsors', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const input = parseSponsor(req.body);
    if (typeof input === 'string') return reply.code(400).send({ error: input });
    const sp = createSponsor(db, input);
    return reply.code(201).send({ ...sp, ...publicSponsor(sp) });
  });

  app.put<{ Params: { id: string }; Body: SponsorBody }>('/api/admin/sponsors/:id', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const input = parseSponsor(req.body);
    if (typeof input === 'string') return reply.code(400).send({ error: input });
    const sp = updateSponsor(db, req.params.id, input);
    return sp ? { ...sp, ...publicSponsor(sp) } : reply.code(404).send({ error: 'Loja não encontrada.' });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/sponsors/:id', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    return deleteSponsor(db, req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'Loja não encontrada.' });
  });

  /** Logo da loja: imagem PNG, JPEG ou WebP em base64 (ou data URL); null apaga. */
  app.put<{ Params: { id: string }; Body: { image?: unknown } }>('/api/admin/sponsors/:id/logo', { bodyLimit: 600 * 1024 }, async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!getSponsor(db, req.params.id)) return reply.code(404).send({ error: 'Loja não encontrada.' });
    const raw = req.body?.image;
    if (raw === null) {
      setSponsorLogo(db, req.params.id, null, null);
    } else {
      if (typeof raw !== 'string') return reply.code(400).send({ error: 'Imagem inválida.' });
      const data = Buffer.from(raw.replace(/^data:[^,]*,/, ''), 'base64');
      if (data.length > MAX_LOGO_BYTES) return reply.code(400).send({ error: `O logo pode ter até ${Math.round(MAX_LOGO_BYTES / 1024)} KB.` });
      const type = imageType(data);
      if (!type) return reply.code(400).send({ error: 'Use uma imagem PNG, JPEG ou WebP.' });
      setSponsorLogo(db, req.params.id, data, type);
    }
    const sp = getSponsor(db, req.params.id)!;
    return { ...sp, ...publicSponsor(sp) };
  });

  /** Últimos pagamentos recebidos (conferência do admin). */
  app.get('/api/admin/support/payments', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    return db
      .prepare(
        `SELECT sp.id, sp.email, sp.kind, sp.tier, sp.amount, sp.currency, sp.paid_at AS paidAt, sp.user_id AS userId, u.name AS userName
         FROM supporter_payments sp LEFT JOIN users u ON u.id = sp.user_id ORDER BY sp.paid_at DESC LIMIT 100`,
      )
      .all();
  });
}
