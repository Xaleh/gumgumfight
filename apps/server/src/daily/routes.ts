// Rotas do Desafio do dia. O navegador recebe só a visão do jogador (viewFor, com apelidos de carta) e manda as
// jogadas; o servidor refaz a tentativa inteira a cada pedido (o desafio é determinístico), joga pelo oponente,
// confere o objetivo e grava o resultado. A solução nunca sai do servidor.
//
//   GET  /api/daily[?brief=1]    desafio de hoje: enunciado, mesa (sem `brief`), resultado e sequência de quem pede
//   POST /api/daily/play         { day, actions }: refaz a tentativa e devolve a mesa e a situação
//   GET  /api/admin/daily        fila publicada e próximos da fila (admin e dev)
//   GET  /api/admin/daily/challenges          todos os desafios (catálogo e Administração), com os dias em que saíram
//   POST /api/admin/daily/challenges          salva um desafio do editor, depois de conferido (vai para a fila)
//   DELETE /api/admin/daily/challenges/:id    apaga um desafio da Administração que ainda não saiu

import { createHmac, randomBytes } from 'node:crypto';
import {
  type Action,
  actionFromView,
  type Aliases,
  buildChallenge,
  type CardData,
  type ChallengeRun,
  createAliases,
  type DeckList,
  type GameState,
  runChallenge,
  SOLVER,
  viewFor,
} from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAdmin, type User } from '../auth/store';
import { type DB, getCards, getDeck } from '../db';
import { fail } from '../errors';
import type { ApiCard } from '../present';
import { allChallenges, type DailyChallenge, deleteChallenge, publishedDays, saveChallenge, verifyChallenge, type VerifyError } from './challenges';
import { DAY, dayOf, dayStats, historyOf, previousDay, publish, publishedOn, queueOrder, recentSchedule, recordAttempt, resultOf, streakOf } from './store';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  now?: () => number;
}

/** Jogadas por tentativa (um desafio de um turno não chega perto disso). */
const MAX_ACTIONS = 300;
/** Pedidos de jogada por IP por minuto (só na memória). */
const PLAYS_PER_MINUTE = 240;
/** A mesa montada de cada desafio fica guardada por um tempo (o motor monta igual toda vez). */
const BUILD_TTL_MS = 10 * 60_000;

function dailySecret(db: DB): Buffer {
  const row = db.prepare("SELECT value FROM server_keys WHERE name = 'daily'").get() as { value: string } | undefined;
  if (row) return Buffer.from(row.value, 'base64url');
  const secret = randomBytes(32);
  db.prepare("INSERT OR IGNORE INTO server_keys (name, value) VALUES ('daily', ?)").run(secret.toString('base64url'));
  return dailySecret(db);
}

interface Built {
  start: GameState;
  aliases: Aliases;
  /** Cartas do enunciado: a mão do oponente no começo, quando o desafio a mostra. */
  extra: string[];
  at: number;
}

export function registerDailyRoutes(app: FastifyInstance, { db, viewerHash, user, present, now = Date.now }: Deps) {
  const secret = dailySecret(db);
  const built = new Map<string, Built>();

  const deckOf = (id: string): DeckList => {
    const d = getDeck(db, id);
    if (!d) throw new Error(`deck ${id} não encontrado`);
    return d;
  };

  /** A mesa do desafio publicado em `day` (os apelidos mudam de um dia para outro). */
  const cardsFor = (decks: DeckList[]) =>
    present(getCards(db, [...new Set(decks.flatMap((d) => [d.leader, ...d.cards.map((x) => x.id)]))])) as CardData[];

  const build = (day: string, c: DailyChallenge): Built => {
    const key = `${day}:${c.id}`;
    const cached = built.get(key);
    if (cached && now() - cached.at < BUILD_TTL_MS) return cached;
    // Desafio da Administração: as listas congeladas quando foi salvo (editar o deck depois não muda o desafio).
    const decks = c.lists ?? (c.decks.map(deckOf) as [DeckList, DeckList]);
    const cards = cardsFor(decks);
    const name = (d: DeckList) => cards.find((x) => x.id === d.leader)?.name ?? d.name;
    const start = buildChallenge({ seed: c.seed, cards, players: [{ name: name(decks[0]), deck: decks[0] }, { name: name(decks[1]), deck: decks[1] }] }, c);
    let i = 0;
    const aliases = createAliases(start, () => `d${createHmac('sha256', secret).update(`${day}:${c.id}:${i++}`).digest('base64url').slice(0, 10)}`);
    const extra = c.revealHand ? [...start.players[1].hand] : [];
    const out = { start, aliases, extra, at: now() };
    if (built.size > 64) built.clear();
    built.set(key, out);
    return out;
  };

  const viewOf = (b: Built, state: GameState) => viewFor(state, SOLVER, b.aliases, b.extra);

  /** Enunciado: o que o jogador precisa saber, sem a solução. */
  const statement = (c: DailyChallenge) => ({
    id: c.id,
    goal: c.goal,
    level: c.level ?? 1,
    revealHand: Boolean(c.revealHand),
    attacks: c.goal === 'survive' ? (c.attacks ?? []) : [],
  });

  const ownerSummary = (owner: string | null, day: string, today: string) =>
    owner
      ? { result: resultOf(db, owner, day), streak: streakOf(db, owner, today), history: historyOf(db, owner, today, 7) }
      : { result: { attempts: 0, solved: false }, streak: { current: 0, best: 0, solved: 0 }, history: historyOf(db, null, today, 7) };

  app.get<{ Querystring: { brief?: string } }>('/api/daily', async (req) => {
    const today = dayOf(now());
    const pub = publish(db, today, allChallenges(db));
    const brief = req.query.brief === '1';
    const b = brief ? null : build(today, pub.challenge);
    return {
      day: today,
      number: pub.number,
      challenge: statement(pub.challenge),
      ...(b ? { view: viewOf(b, runChallenge(b.start, pub.challenge, []).state) } : {}),
      stats: dayStats(db, today),
      ...ownerSummary(viewerHash(req), today, today),
    };
  });

  const recent = new Map<string, { start: number; n: number }>();
  app.post<{ Body: { day?: unknown; actions?: unknown } }>('/api/daily/play', async (req, reply) => {
    const t = now();
    const key = req.ip ?? '?';
    const r = recent.get(key);
    if (!r || t - r.start > 60_000) recent.set(key, { start: t, n: 1 });
    else if (++r.n > PLAYS_PER_MINUTE) return reply.code(429).send(fail('tooManyPlays', 'Jogadas demais. Espere um pouco.'));
    if (recent.size > 10_000) recent.clear();

    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const body = req.body ?? {};
    const today = dayOf(t);
    const day = typeof body.day === 'string' && DAY.test(body.day) ? body.day : '';
    // Vale o desafio de hoje e o de ontem (quem começou antes da meia-noite termina).
    if (day !== today && day !== previousDay(today)) return reply.code(409).send(fail('dayOver', 'Este desafio já terminou. Abra o de hoje.'));
    const pub = publishedOn(db, day, allChallenges(db));
    if (!pub) return reply.code(404).send(fail('noChallenge', 'Nenhum desafio publicado neste dia.'));
    if (!Array.isArray(body.actions) || body.actions.length > MAX_ACTIONS || !body.actions.every((a) => a && typeof a === 'object')) {
      return reply.code(400).send(fail('badActions', 'Jogadas inválidas.'));
    }
    const b = build(day, pub.challenge);
    let run: ChallengeRun;
    try {
      run = runChallenge(b.start, pub.challenge, body.actions as Action[], (s, a) => actionFromView(s, b.aliases, a, b.extra));
    } catch (e) {
      req.log.warn({ err: e, challenge: pub.challenge.id }, 'desafio do dia: erro ao refazer a tentativa');
      return reply.code(400).send(fail('badActions', 'Jogadas inválidas.'));
    }
    // A tentativa conta quando termina sem jogada recusada.
    const result = run.status !== 'playing' && !run.error ? recordAttempt(db, owner, day, run.status === 'solved') : resultOf(db, owner, day);
    return {
      day,
      status: run.status,
      applied: run.applied,
      ...(run.error ? { error: run.error } : {}),
      view: viewOf(b, run.state),
      result,
      streak: streakOf(db, owner, today),
    };
  });

  app.get('/api/admin/daily', async (req, reply) => {
    const me = user(req);
    if (!me) return reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    if (!isAdmin(me.role)) return reply.code(403).send(fail('adminOnly', 'Só para administradores.'));
    const today = dayOf(now());
    return {
      today,
      catalog: allChallenges(db).length,
      published: recentSchedule(db, 30).map((r) => ({ ...r, ...dayStats(db, r.day) })),
      queue: queueOrder(db, allChallenges(db))
        .slice(0, 10)
        .map((c) => ({ id: c.id, goal: c.goal, level: c.level ?? 1 })),
    };
  });

  // ---------------------------------------------------------------- editor de desafios (Administração)

  const adminOnly = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const me = user(req);
    if (!me) {
      void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
      return null;
    }
    if (!isAdmin(me.role)) {
      void reply.code(403).send(fail('adminOnly', 'Só para administradores.'));
      return null;
    }
    return me;
  };

  app.get('/api/admin/daily/challenges', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    const days = publishedDays(db);
    const all = allChallenges(db);
    const leaders = new Map(
      getCards(db, [...new Set(all.map((c) => c.lists?.map((l) => l.leader) ?? c.decks.map((d) => getDeck(db, d)?.leader ?? '')).flat().filter(Boolean))]).map(
        (c) => [c.id, c.name],
      ),
    );
    const queue = queueOrder(db, all).map((c) => c.id);
    return {
      challenges: all.map((c) => {
        const ls = c.lists?.map((l) => l.leader) ?? c.decks.map((d) => getDeck(db, d)?.leader ?? '');
        return {
          id: c.id,
          source: c.source,
          goal: c.goal,
          level: c.level ?? 1,
          decks: c.lists?.map((l) => l.name) ?? c.decks,
          leaders: ls.map((id) => ({ id, name: leaders.get(id) ?? id })),
          note: c.note ?? null,
          createdAt: c.createdAt ?? null,
          days: days.get(c.id) ?? [],
          /** Posição na fila (0 = o próximo a sair). */
          next: queue.indexOf(c.id),
        };
      }),
    };
  });

  const VERIFY_TEXT: Record<VerifyError['code'], string> = {
    challengeInvalid: 'Desafio inválido: confira o campo indicado.',
    challengeDeck: 'Deck não encontrado.',
    challengeBoard: 'Não deu para montar a mesa.',
    challengeManualCards: 'A mesa tem cartas com efeito ⚙ (não automático).',
    challengeNotSolved: 'A solução não resolve o desafio.',
    challengeWrongSolves: 'A linha errada não falha.',
  };

  app.post<{ Body: { spec?: unknown; solution?: unknown; wrong?: unknown; note?: unknown; allowManual?: unknown } }>(
    '/api/admin/daily/challenges',
    async (req, reply) => {
      const me = adminOnly(req, reply);
      if (!me) return reply;
      const body = req.body ?? {};
      const v = verifyChallenge(body, { deck: (id) => getDeck(db, id), cards: (ids) => present(getCards(db, ids)) as CardData[] });
      if ('code' in v) {
        const { code, ...rest } = v;
        const params = Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, Array.isArray(x) ? x.join(', ') : String(x)]));
        return reply.code(400).send(fail(code, VERIFY_TEXT[code], params));
      }
      const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const id = saveChallenge(db, v, note, me.id);
      return reply.code(201).send({ id, next: queueOrder(db, allChallenges(db)).findIndex((c) => c.id === id) });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/daily/challenges/:id', async (req, reply) => {
    if (!adminOnly(req, reply)) return reply;
    const r = deleteChallenge(db, req.params.id);
    if (r === 'notFound') return reply.code(404).send(fail('challengeNotFound', 'Desafio não encontrado (os do catálogo em código não se apagam).'));
    if (r === 'published') return reply.code(409).send(fail('challengePublished', 'Este desafio já saiu e fica no histórico.'));
    return reply.code(204).send();
  });
}
