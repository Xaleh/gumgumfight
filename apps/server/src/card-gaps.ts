// Lacunas do leitor automático, para o perfil Dev (tela "Cobertura das cartas"): em cada carta ⚙
// (efeito parcial ou manual), as linhas que o leitor não entende e onde ele parou; o ranking das
// frases que faltam na base inteira; e as cartas que entraram com ⚙ desde a última vez que o Dev
// olhou (spoilers e importações; a lista é atualizada por `recordCardGaps`, em db.ts).
//
//   GET  /api/dev/card-gaps                      resumo: por coleção, ranking das frases, novas
//   GET  /api/dev/card-gaps/cards?set=OP19       cartas ⚙ com o diagnóstico (ou ?ids=a,b ou ?new=1)
//   GET  /api/dev/card-gaps/new-count            só o número de novas (selo do menu)
//   POST /api/dev/card-gaps/reviewed {ids?}      marca as novas como vistas (todas, sem `ids`)

import { type CardData, type CardDiagnosis, diagnoseCard, type GapStage, type LineDiagnosis, needsManual } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDev, type User } from './auth/store';
import { type CardGapRow, type DB, listCardGaps, listCards, markCardGapsReviewed } from './db';
import { fail } from './errors';

export interface GapCard {
  id: string;
  name: string;
  set: string;
  category: CardData['category'];
  status: 'partial' | 'manual';
  /** Carta de spoiler (ainda não oficial). */
  provisional: boolean;
  /** Entrou com ⚙ e o Dev ainda não marcou como vista. */
  isNew: boolean;
  firstSeen: string | null;
  lines: LineDiagnosis[];
}

export interface GapPattern {
  stage: GapStage;
  pattern: string;
  /** O primeiro trecho real com esse padrão. */
  example: string;
  /** Linhas com o padrão (uma carta pode ter mais de uma). */
  lines: number;
  cards: string[];
  sets: string[];
}

const setOf = (c: CardData) => c.set ?? c.id.split('-')[0];

const cache = new Map<string, CardDiagnosis>();
function diagnosis(c: CardData): CardDiagnosis {
  const key = `${c.id}\u0000${c.text}\u0000${c.trigger ?? ''}`;
  let d = cache.get(key);
  if (!d) {
    d = diagnoseCard(c);
    if (cache.size > 20000) cache.clear();
    cache.set(key, d);
  }
  return d;
}

/** As cartas ⚙ da base, com o diagnóstico e se são novas. */
export function gapCards(cards: Array<CardData & { provisional?: boolean }>, rows: Map<string, CardGapRow>): GapCard[] {
  const out: GapCard[] = [];
  for (const c of cards) {
    if (!needsManual(c)) continue;
    const d = diagnosis(c);
    const row = rows.get(c.id);
    out.push({
      id: c.id,
      name: c.name,
      set: setOf(c),
      category: c.category,
      status: d.status as GapCard['status'],
      provisional: Boolean(c.provisional),
      isNew: Boolean(row && !row.reviewedAt),
      firstSeen: row?.firstSeen ?? null,
      lines: d.lines,
    });
  }
  return out;
}

/** Frases que faltam, da que resolve mais cartas para a que resolve menos. */
export function gapPatterns(cards: GapCard[]): GapPattern[] {
  const by = new Map<string, GapPattern>();
  for (const c of cards) {
    for (const l of c.lines) {
      if (l.ok) continue;
      const key = `${l.stage}\u0000${l.pattern}`;
      let p = by.get(key);
      if (!p) by.set(key, (p = { stage: l.stage!, pattern: l.pattern!, example: l.fragment!, lines: 0, cards: [], sets: [] }));
      p.lines++;
      if (!p.cards.includes(c.id)) p.cards.push(c.id);
      if (!p.sets.includes(c.set)) p.sets.push(c.set);
    }
  }
  return [...by.values()].sort((a, b) => b.cards.length - a.cards.length || b.lines - a.lines || a.pattern.localeCompare(b.pattern));
}

/** Resumo para a tela: contagens por coleção e por parte do leitor, ranking das frases e novas. */
export function gapSummary(cards: GapCard[], limit = 300) {
  const sets = new Map<string, { set: string; partial: number; manual: number; new: number }>();
  const stages: Partial<Record<GapStage, number>> = {};
  for (const c of cards) {
    const row = sets.get(c.set) ?? { set: c.set, partial: 0, manual: 0, new: 0 };
    row[c.status]++;
    if (c.isNew) row.new++;
    sets.set(c.set, row);
    for (const l of c.lines) if (!l.ok) stages[l.stage!] = (stages[l.stage!] ?? 0) + 1;
  }
  const patterns = gapPatterns(cards);
  return {
    total: cards.length,
    newCount: cards.filter((c) => c.isNew).length,
    sets: [...sets.values()].sort((a, b) => a.set.localeCompare(b.set, 'en', { numeric: true })),
    stages,
    patternCount: patterns.length,
    patterns: patterns.slice(0, limit),
  };
}

const MAX_IDS = 500;

export function registerCardGapRoutes(app: FastifyInstance, { db, user }: { db: DB; user: (req: FastifyRequest) => User | null }) {
  /** Só o perfil Dev (a tela de Cobertura é dele); responde o erro e devolve false para os outros. */
  const devOnly = (req: FastifyRequest, reply: FastifyReply) => {
    const me = user(req);
    if (!me) void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    else if (!isDev(me.role)) void reply.code(403).send(fail('devOnly', 'Só para o perfil Dev.'));
    return Boolean(me && isDev(me.role));
  };
  const all = () => gapCards(listCards(db), listCardGaps(db));

  app.get('/api/dev/card-gaps', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    return gapSummary(all());
  });

  app.get('/api/dev/card-gaps/new-count', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    return { newCount: all().filter((c) => c.isNew).length };
  });

  app.get<{ Querystring: { set?: string; ids?: string; new?: string } }>('/api/dev/card-gaps/cards', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    const { set, ids, new: onlyNew } = req.query;
    const wanted = ids ? new Set(ids.split(',').slice(0, MAX_IDS)) : null;
    if (!set && !wanted && onlyNew !== '1') return reply.code(400).send(fail('gapFilterRequired', 'Escolha uma coleção, cartas ou as novas.'));
    const cards = gapCards(set ? listCards(db, set) : listCards(db), listCardGaps(db)).filter(
      (c) => (!set || c.set === set) && (!wanted || wanted.has(c.id)) && (onlyNew !== '1' || c.isNew),
    );
    return { cards };
  });

  app.post<{ Body: { ids?: unknown } }>('/api/dev/card-gaps/reviewed', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    const raw = req.body?.ids;
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > MAX_IDS || raw.some((x) => typeof x !== 'string'))) {
      return reply.code(400).send(fail('badGapIds', 'Lista de cartas inválida.'));
    }
    return { reviewed: markCardGapsReviewed(db, raw as string[] | undefined) };
  });
}
