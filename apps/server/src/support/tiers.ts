// Planos de apoio (assinatura mensal) e o que cada um destrava.
//
// Nenhum plano dá vantagem dentro da partida: os benefícios são reconhecimento,
// acesso antecipado (homologação), estatísticas competitivas, organização de
// torneios e prioridade de inscrição nos torneios premiados do time.

export const SUPPORTER_TIERS = ['grumete', 'tripulante', 'capitao', 'almirante'] as const;
export type SupporterTier = (typeof SUPPORTER_TIERS)[number];
export const isSupporterTier = (v: unknown): v is SupporterTier => SUPPORTER_TIERS.includes(v as SupporterTier);

/** Torneios que um apoiador Capitão ou acima pode criar por mês. */
export const SUPPORTER_TOURNAMENTS_PER_MONTH = 5;
/** Limite de jogadores nos torneios criados pela cota de apoiador. */
export const SUPPORTER_MAX_PLAYERS = 64;
/**
 * Apoia.se: o apoio pago no mês vale até este dia do mês seguinte. A folga cobre a
 * cobrança do cartão (no 1º dia útil) e o boleto (até 3 dias para compensar).
 */
export const APOIASE_GRACE_DAY = 10;
/** Ko-fi: dias que um pagamento mensal mantém o plano ativo (30 dias + folga para a próxima cobrança). */
export const PAYMENT_GRACE_DAYS = 35;
/** Janela de inscrição antecipada dos Almirantes nos torneios do time (horas). */
export const DEFAULT_PRIORITY_HOURS = 48;

export interface TierInfo {
  id: SupporterTier;
  label: string;
  /** Preço mensal em reais. */
  price: number;
  perks: string[];
}

export const TIER_INFO: Record<SupporterTier, TierInfo> = {
  grumete: {
    id: 'grumete',
    label: 'Grumete',
    price: 5,
    perks: ['Seu nome na lista de Apoiadores (se quiser)', 'Badge de apoiador no Discord'],
  },
  tripulante: {
    id: 'tripulante',
    label: 'Tripulante',
    price: 15,
    perks: ['Tudo do Grumete', 'Estatísticas Pro: ranqueada, torneios e filtro por faixa de recompensa', 'Ambiente de homologação: novidades antes de todos', 'Voto no roadmap'],
  },
  capitao: {
    id: 'capitao',
    label: 'Capitão',
    price: 30,
    perks: ['Tudo do Tripulante', `Organize até ${SUPPORTER_TOURNAMENTS_PER_MONTH} torneios por mês, de até ${SUPPORTER_MAX_PLAYERS} jogadores`, 'Nome nos créditos'],
  },
  almirante: {
    id: 'almirante',
    label: 'Almirante',
    price: 50,
    perks: ['Tudo do Capitão', 'Prioridade de inscrição nos torneios premiados do time', 'Destaque na lista de Apoiadores'],
  },
};

/** De onde veio o plano: dado à mão pelo admin, ou pago na Apoia.se ou no Ko-fi. */
export const SUPPORTER_SOURCES = ['manual', 'apoiase', 'kofi'] as const;
export type SupporterSource = (typeof SUPPORTER_SOURCES)[number];
export const isSupporterSource = (v: unknown): v is SupporterSource => SUPPORTER_SOURCES.includes(v as SupporterSource);

/** Posição do plano na escada (0 = sem plano). */
export const tierRank = (t: SupporterTier | null | undefined) => (t ? SUPPORTER_TIERS.indexOf(t) + 1 : 0);
/** O plano `t` inclui os benefícios de `min`. */
export const atLeast = (t: SupporterTier | null | undefined, min: SupporterTier) => tierRank(t) >= tierRank(min);

/** Remove acentos e caixa ("Capitão" → "capitao"), para casar o nome do plano vindo da plataforma. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Plano de um pagamento: pelo nome do plano na plataforma (Grumete, Tripulante,
 * Capitão, Almirante, com ou sem acento) ou, se o nome não bater, pelo valor em reais.
 */
export function tierFromPayment(tierName: string | null | undefined, amount: number, currency: string): SupporterTier | null {
  if (tierName) {
    const name = fold(tierName);
    const byName = SUPPORTER_TIERS.find((t) => name.includes(t));
    if (byName) return byName;
  }
  if (currency.toUpperCase() !== 'BRL' || !Number.isFinite(amount)) return null;
  return [...SUPPORTER_TIERS].reverse().find((t) => amount + 0.001 >= TIER_INFO[t].price) ?? null;
}
