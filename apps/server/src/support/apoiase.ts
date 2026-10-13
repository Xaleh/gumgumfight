// Apoia.se: o apoio mensal da campanha vira o plano da conta.
//
// A API pública da Apoia.se não avisa o site (não tem webhook): é o site que pergunta,
// pelo e-mail, se a pessoa apoia a campanha e quanto pagou no mês
// (GET /backers/charges/<e-mail>, com x-api-key e Authorization: Bearer <segredo>). A
// resposta traz `isBacker`, `isPaidThisMonth` e `thisMonthPaidValue`.
//
// Quando perguntar: no login, quando a pessoa toca em "Já apoio: verificar" e, a cada
// poucas horas, para quem já tem plano da Apoia.se (para renovar ou deixar vencer).
// O plano sai do valor pago no mês e vale até o dia 10 do mês seguinte: o cartão é
// cobrado no 1º dia útil e o boleto leva até 3 dias para compensar, então no começo do
// mês a resposta pode vir "não pago" sem que o apoio tenha parado.

import type { DB } from '../db';
import { applySupporterPlan, emailVerified, getUser, type User } from '../auth/store';
import { APOIASE_GRACE_DAY, type SupporterTier, tierFromPayment } from './tiers';

export interface ApoiaseStatus {
  isBacker: boolean;
  isPaidThisMonth: boolean;
  /** Valor pago no mês, em reais (0 se não pagou). */
  value: number;
}

export interface ApoiaseOptions {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
}

/** Consulta o apoio de um e-mail. Lança erro se a API não responder direito. */
export async function fetchApoiaseStatus(email: string, { apiKey, apiSecret, apiUrl, fetchImpl = fetch }: ApoiaseOptions): Promise<ApoiaseStatus> {
  const res = await fetchImpl(`${apiUrl}/backers/charges/${encodeURIComponent(email.trim().toLowerCase())}`, {
    headers: { 'x-api-key': apiKey, authorization: `Bearer ${apiSecret}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (res.status === 404) return { isBacker: false, isPaidThisMonth: false, value: 0 };
  if (!res.ok) throw new Error(`Apoia.se respondeu ${res.status}`);
  const body = (await res.json()) as { isBacker?: unknown; isPaidThisMonth?: unknown; thisMonthPaidValue?: unknown };
  const value = Number(String(body.thisMonthPaidValue ?? 0).replace(',', '.'));
  return { isBacker: body.isBacker === true, isPaidThisMonth: body.isPaidThisMonth === true, value: Number.isFinite(value) ? value : 0 };
}

/** Fim do dia APOIASE_GRACE_DAY do mês seguinte, no horário de Brasília (UTC−3), em ISO. */
export function apoiasePaidUntil(ms: number): string {
  const local = new Date(ms - 3 * 3_600_000);
  // 23:59:59 em Brasília = 02:59:59 UTC do dia seguinte.
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, APOIASE_GRACE_DAY + 1, 2, 59, 59)).toISOString();
}

export interface SyncResult {
  /** O que a Apoia.se respondeu (null = não deu para consultar ou a conta não tem e-mail confirmado). */
  status: ApoiaseStatus | null;
  /** Plano reconhecido pelo valor pago no mês. */
  tier: SupporterTier | null;
  /** O plano da conta mudou. */
  applied: boolean;
  user: User | null;
}

/**
 * Consulta a Apoia.se pela conta e, se o apoio do mês está pago, liga o plano até o dia
 * 10 do mês seguinte. Apoio não pago (ou fim do apoio) não tira nada: o plano vence
 * sozinho na data. Grava um registro por conta e mês em `supporter_payments`.
 */
export async function syncApoiase(db: DB, userId: string, opts: ApoiaseOptions, now = Date.now()): Promise<SyncResult> {
  const user = getUser(db, userId);
  if (!user?.email || !emailVerified(db, user.id)) return { status: null, tier: null, applied: false, user };
  const status = await fetchApoiaseStatus(user.email, opts);
  const tier = status.isBacker && status.isPaidThisMonth ? tierFromPayment(null, status.value, 'BRL') : null;
  let applied = false;
  if (tier) {
    applied = applySupporterPlan(db, user.id, tier, apoiasePaidUntil(now), 'apoiase');
    const month = new Date(now - 3 * 3_600_000).toISOString().slice(0, 7);
    db.prepare(
      `INSERT INTO supporter_payments (id, email, kind, tier, amount, currency, paid_at, user_id) VALUES (?, ?, 'Apoia.se', ?, ?, 'BRL', ?, ?)
       ON CONFLICT(id) DO UPDATE SET tier = excluded.tier, amount = excluded.amount`,
    ).run(`apoiase:${user.id}:${month}`, user.email.toLowerCase(), tier, status.value, new Date(now).toISOString(), user.id);
  }
  return { status, tier, applied, user: getUser(db, user.id) };
}

/** Contas para reconsultar de tempos em tempos: quem tem (ou teve há pouco) plano da Apoia.se. */
export function apoiaseAccounts(db: DB, now = Date.now()): string[] {
  const since = new Date(now - 45 * 86_400_000).toISOString();
  return (
    db
      .prepare(
        `SELECT id FROM users WHERE supporter_source = 'apoiase' AND (supporter_until IS NULL OR supporter_until > ?)
         ORDER BY supporter_until`,
      )
      .all(since) as Array<{ id: string }>
  ).map((r) => r.id);
}
