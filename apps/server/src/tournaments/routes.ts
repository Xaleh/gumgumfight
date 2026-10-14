// Rotas dos torneios.
//
// Quem cria: contas com perfil Organizador ou Admin. Quem gerencia: o organizador que
// criou o torneio e qualquer admin. Quem joga: contas Google inscritas, com um deck
// válido no formato (a lista fica congelada na inscrição).
//
// Fases: suíço (com top cut opcional no fim) ou eliminação simples. Cada partida é
// uma série melhor de 1, 3 ou 5 (o organizador escolhe a partir de qual fase da
// eliminatória entram a melhor de 3 e a de 5). Não há empate.
//
// Os jogos são disputados nas salas online (fila "tournament"): o placar da série
// soma sozinho no fim de cada jogo. O organizador pode lançar ou corrigir o placar
// de qualquer partida (W.O., problema de conexão, partida jogada fora do site,
// resultado lançado errado) e é quem avança as rodadas.
//
// Torneio com hora marcada e check-in (`checkIn`): o check-in abre 30 min antes, o
// torneio começa sozinho na hora e cada rodada tem 5 min de tolerância para entrar na
// sala (W.O. automático; ver clock.ts).
//
// Ferramentas do organizador para situações de mesa: derrota dupla lançada à mão
// (penalidade: os dois perdem e seguem no torneio, a menos que ele os tire), desfazer
// a desistência de um jogador (ele volta a ser pareado na próxima rodada e, se a saída
// decidiu a partida da rodada atual, ela pode voltar a ficar pendente) e inscrição
// atrasada (só no suíço, durante a rodada 1: quem entra começa a rodada 2 com uma derrota).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, createsTournaments, isAdmin, supporterTiers, type User } from '../auth/store';
import { atLeast, DEFAULT_PRIORITY_HOURS, SUPPORTER_MAX_PLAYERS, SUPPORTER_TOURNAMENTS_PER_MONTH } from '../support/tiers';
import { dataVersion, ResponseCache } from '../cache';
import { type DB, getCards } from '../db';
import { fail, isPlayerError, type PlayerError } from '../errors';
import type { Lobby } from '../online/lobby';
import { playableDeck } from '../online/routes';
import { TIME_BANK_MS } from '../online/room';
import type { ApiCard } from '../present';
import { FORMATS, isFormat, tierFor } from '../stats/catalog';
import { ensurePlayer, findPlayer } from '../stats/store';
import { listReports } from '../reports/store';
import { getSponsor, publicSponsor } from '../support/sponsors';
import { pushText, roundName } from '../push/messages';
import { noNotifier, type Notifier } from '../push/routes';
import {
  absentSides,
  beginTournament,
  CHECK_IN_MS,
  checkInOpen,
  checkInOpensAt,
  DEFAULT_TOLERANCE_MIN,
  elimRound,
  MAX_TOLERANCE_MIN,
  MIN_TOLERANCE_MIN,
  roundDeadline,
  toleranceMs,
  tournamentTick,
} from './clock';
import {
  elimLabel,
  losersOf,
  singleFirstRound,
  singleNextRound,
  singleRounds,
  standings,
  swissPairings,
  swissRounds,
  winnerOf,
  winsNeeded,
} from './pairing';
import {
  accountsByName,
  checkInPlayer,
  countPlayers,
  createTournament,
  deleteTournament,
  dropPlayer,
  finishTournament,
  getMatch,
  getTournament,
  insertRound,
  lateRegister,
  listGames,
  listMatches,
  listPlayers,
  listTournaments,
  markEntered,
  myTournaments,
  quotaUsed,
  registerPlayer,
  reinstatePlayer,
  releaseQuota,
  replaceInMatch,
  seriesResult,
  setDoubleLoss,
  setLateEntry,
  setMatchRoom,
  setMatchScore,
  type Tournament,
  type TournamentInput,
  type TournamentMatch,
  type TournamentPlayer,
  tournamentsOf,
  unregisterPlayer,
  updateTournament,
  vacateInMatch,
} from './store';
import { isApprentice } from '../tutorial/store';

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  present: (cards: ApiCard[]) => ApiCard[];
  lobby: Lobby;
  /** Imagens das cartas ligadas (CARD_IMAGES). */
  cardImages: boolean;
  /** Relógio (testes). */
  now?: () => number;
  /** Intervalo do relógio dos torneios (0 = não liga; os testes chamam `tournamentTick` à mão). */
  tickMs?: number;
  /** Notificações no celular (check-in aberto, rodada nova, oponente esperando na sala). */
  notifier?: Notifier;
}

export const MAX_PLAYERS = 256;
const MAX_SWISS_ROUNDS = 15;
/** Tamanhos aceitos do top cut e das fases da eliminatória (vagas). */
const CUT_SIZES = [2, 4, 8, 16, 32, 64];
const PHASE_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];

type Body = {
  name?: unknown;
  description?: unknown;
  format?: unknown;
  structure?: unknown;
  rounds?: unknown;
  swissBestOf?: unknown;
  topCut?: unknown;
  bo3From?: unknown;
  bo5From?: unknown;
  maxPlayers?: unknown;
  startsAt?: unknown;
  checkIn?: unknown;
  toleranceMin?: unknown;
  /** Só admin: torneio do time, prêmio, loja patrocinadora e inscrição antecipada para Almirantes. */
  official?: unknown;
  prize?: unknown;
  sponsorId?: unknown;
  priority?: unknown;
};

/** Formulário validado; `priority` vira `priorityUntil` na rota (depende do relógio). */
type ParsedInput = TournamentInput & { priority: boolean };

/** Valida o formulário de criação/edição. */
function parseInput(b: Body | undefined): ParsedInput | PlayerError {
  if (!b || typeof b !== 'object') return fail('invalidBody', 'Corpo inválido.');
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (name.length < 3) return fail('tourNameTooShort', 'Dê um nome ao torneio (pelo menos 3 letras).');
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 2000) : '';
  if (!isFormat(b.format)) return fail('invalidFormat', 'Formato inválido.');
  if (b.structure !== 'swiss' && b.structure !== 'single') return fail('invalidStructure', 'Estrutura inválida.');
  const swiss = b.structure === 'swiss';
  const int = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const rounds = swiss ? int(b.rounds) : null;
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_SWISS_ROUNDS)) {
    return fail('invalidRounds', `Número de rodadas inválido (1 a ${MAX_SWISS_ROUNDS}, ou vazio para calcular pelo número de inscritos).`, { max: MAX_SWISS_ROUNDS });
  }
  const swissBestOf = swiss ? (int(b.swissBestOf) ?? 1) : 1;
  if (swissBestOf !== 1 && swissBestOf !== 3) return fail('invalidSwissBestOf', 'As partidas do suíço são melhor de 1 ou de 3.');
  const topCut = swiss ? int(b.topCut) : null;
  if (topCut !== null && !CUT_SIZES.includes(topCut)) return fail('invalidTopCut', `Top cut inválido (${CUT_SIZES.join(', ')} ou nenhum).`, { sizes: CUT_SIZES.join(', ') });
  // Fases da eliminatória só existem na eliminação simples ou no top cut.
  const elim = !swiss || topCut !== null;
  const bo3From = elim ? int(b.bo3From) : null;
  const bo5From = elim ? int(b.bo5From) : null;
  for (const v of [bo3From, bo5From]) if (v !== null && !PHASE_SIZES.includes(v)) return fail('invalidElimPhase', 'Fase da eliminatória inválida.');
  const maxPlayers = int(b.maxPlayers);
  if (maxPlayers !== null && (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS)) {
    return fail('invalidMaxPlayers', `Limite de jogadores inválido (2 a ${MAX_PLAYERS}).`, { max: MAX_PLAYERS });
  }
  let startsAt: string | null = null;
  if (typeof b.startsAt === 'string' && b.startsAt.trim()) {
    const d = new Date(b.startsAt);
    if (Number.isNaN(d.getTime())) return fail('invalidStartDate', 'Data de início inválida.');
    startsAt = d.toISOString();
  }
  const checkIn = Boolean(b.checkIn);
  if (checkIn && !startsAt) return fail('checkInNeedsStart', 'O check-in e o início automático precisam de uma data e hora de início.');
  const toleranceMin = int(b.toleranceMin) ?? DEFAULT_TOLERANCE_MIN;
  if (!Number.isInteger(toleranceMin) || toleranceMin < MIN_TOLERANCE_MIN || toleranceMin > MAX_TOLERANCE_MIN) {
    return fail('invalidTolerance', `Tolerância inválida (${MIN_TOLERANCE_MIN} a ${MAX_TOLERANCE_MIN} minutos).`, { min: MIN_TOLERANCE_MIN, max: MAX_TOLERANCE_MIN });
  }
  return {
    name,
    description,
    format: b.format,
    structure: b.structure,
    rounds,
    swissBestOf,
    topCut,
    bo3From,
    bo5From,
    maxPlayers,
    startsAt,
    checkIn,
    toleranceMin,
    official: Boolean(b.official),
    prize: typeof b.prize === 'string' && b.prize.trim() ? b.prize.trim().replace(/\s+/g, ' ').slice(0, 200) : null,
    sponsorId: typeof b.sponsorId === 'string' && b.sponsorId.trim() ? b.sponsorId.trim().slice(0, 40) : null,
    priorityUntil: null,
    priority: Boolean(b.official) && Boolean(b.priority),
  };
}

/** Início do mês civil em Brasília (UTC−3, sem horário de verão desde 2019), em ISO. */
export function monthStart(ms: number): string {
  const local = new Date(ms - 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + 3 * 3_600_000).toISOString();
}

/**
 * Quem pode criar torneios e com que limites: Organizador e Admin sem limite; apoiador
 * Capitão ou Almirante pela cota mensal; os demais não criam.
 */
export interface OrganizeLimits {
  kind: 'role' | 'supporter';
  /** Torneios por mês (null = sem limite). */
  perMonth: number | null;
  /** Criados neste mês pela cota. */
  used: number;
  maxPlayers: number;
}

/** Nome de uma rodada: "Rodada 3" no suíço, "Semifinal" na eliminatória. */
const roundLabel = (matches: TournamentMatch[], round: number) => {
  const ms = matches.filter((m) => m.round === round);
  return ms[0]?.stage === 'elim' ? elimLabel(ms.length * 2) : `Rodada ${round}`;
};

/**
 * Placar pedido pelo organizador: `wins` = [p1, p2], ou `result` (p1/p2) como atalho
 * para a vitória mais curta. null/[0, 0] apaga. Recusa placares impossíveis.
 */
function parseScore(body: { wins?: unknown; result?: unknown } | undefined, bestOf: number): [number, number] | PlayerError {
  const need = winsNeeded(bestOf);
  if (body?.result === 'p1') return [need, 0];
  if (body?.result === 'p2') return [0, need];
  if (body?.result === 'draw') return fail('noDraws', 'No One Piece TCG não há empate.');
  if (body?.result === null || body?.wins === null) return [0, 0];
  const w = body?.wins;
  if (!Array.isArray(w) || w.length !== 2 || !w.every((n) => Number.isInteger(n) && n >= 0 && n <= need)) return fail('invalidScore', 'Placar inválido.');
  if (w[0] === need && w[1] === need) return fail('invalidScore', 'Placar inválido.');
  return [w[0], w[1]];
}

/**
 * Janela da inscrição atrasada: suíço com pelo menos 2 rodadas, enquanto a rodada 1
 * está em andamento (gerar a rodada 2 fecha a janela sozinho).
 */
const lateWindow = (t: Tournament) => t.status === 'running' && t.structure === 'swiss' && t.round === 1 && (t.rounds ?? 0) >= 2;

/** A conta pode se inscrever atrasada agora (liberada para todos ou só para ela). */
const lateAllowed = (t: Tournament, u: User | null) => Boolean(u && lateWindow(t) && (t.lateEntry === '*' || t.lateEntry === u.id));

/**
 * Desfazer a desistência: se o jogador pode voltar e o que acontece com a partida da
 * rodada atual que a saída decidiu (`drop`/`noshow`, com ele perdendo): `no` = não há o
 * que devolver; `optional` = o organizador escolhe; `required` = na chave, ele só volta
 * devolvendo a partida (senão já perdeu nesta fase).
 */
type ReinstateOptions = { restore: 'no' | 'optional' | 'required'; match: TournamentMatch | null };

function reinstateOptions(
  t: Tournament,
  players: TournamentPlayer[],
  matches: TournamentMatch[],
  userId: string,
): ReinstateOptions | ({ code: number } & PlayerError) {
  if (t.status !== 'running') return { code: 409, ...fail('tourNotRunning', 'O torneio não está em andamento.') };
  const p = players.find((x) => x.userId === userId);
  if (!p) return { code: 404, ...fail('playerNotRegistered', 'Jogador não inscrito.') };
  if (!p.dropped) return { code: 409, ...fail('playerNotDropped', 'Este jogador não saiu do torneio.') };
  const current = matches.filter((m) => m.round === t.round);
  const mine = current.find((m) => m.p1 === userId || m.p2 === userId) ?? null;
  const lost = Boolean(mine && losersOf(mine).includes(userId));
  const opp = mine && (mine.p1 === userId ? mine.p2 : mine.p1);
  const oppDropped = Boolean(opp && players.find((x) => x.userId === opp)?.dropped);
  // A partida volta a ficar pendente se foi a saída que a decidiu e o oponente segue no
  // torneio (num W.O. duplo os dois saíram: o oponente pode voltar depois).
  const restorable =
    mine && mine.p2 && lost && (mine.reportedBy === 'drop' || mine.reportedBy === 'noshow') && (!oppDropped || mine.result === 'none') ? mine : null;
  if (current[0]?.stage === 'elim') {
    const out = matches.some((m) => m.stage === 'elim' && m.round < t.round && losersOf(m).includes(userId));
    if (!mine || out) return { code: 409, ...fail('reinstateNotInBracket', 'Na chave, só volta quem ainda está na fase atual.') };
    if (lost && !restorable) return { code: 409, ...fail('reinstateLostInBracket', 'O jogador já perdeu nesta fase da chave.') };
    return { restore: lost ? 'required' : 'no', match: restorable };
  }
  return { restore: restorable ? 'optional' : 'no', match: restorable };
}

/** Validade do torneio completo em cache (só por garantia: cada gravação já o invalida). */
const DETAIL_TTL_MS = 5_000;

export function registerTournamentRoutes(
  app: FastifyInstance,
  { db, user, present, lobby, cardImages, now = Date.now, tickMs = 5_000, notifier = noNotifier }: Deps,
) {
  const cache = new ResponseCache();
  const nowIso = () => new Date(now()).toISOString();

  /** Aviso de torneio para uma conta (tocar abre a página do torneio). Avisos novos do mesmo torneio substituem os antigos. */
  const tournamentNotice = (t: Tournament, userId: string, body: (locale: string) => string, ttl: number) =>
    void notifier.notify(
      { userIds: [userId] },
      {
        category: 'tournaments',
        text: (locale) => ({ title: t.name, body: body(locale) }),
        tag: `tour-${t.id}`,
        url: `/?torneio=${encodeURIComponent(t.id)}`,
        ttl,
        urgency: 'high',
      },
    );

  /** Rodada nova: cada jogador recebe o nome do oponente (ou o aviso de bye) e, com W.O. automático, o prazo para entrar. */
  const notifyRound = (id: string) => {
    const t = getTournament(db, id);
    if (!t || t.status !== 'running') return;
    const players = listPlayers(db, t.id);
    const name = (userId: string) => players.find((p) => p.userId === userId)?.name ?? '?';
    const round = listMatches(db, t.id).filter((m) => m.round === t.round);
    for (const m of round) {
      for (const [me, opp] of [
        [m.p1, m.p2],
        [m.p2, m.p1],
      ] as const) {
        if (!me) continue;
        tournamentNotice(
          t,
          me,
          (locale) => {
            const label = roundName(locale, m.stage, m.round, round.length);
            if (!opp) return pushText(locale, 'byeBody', { round: label });
            return pushText(locale, t.checkIn ? 'roundDeadlineBody' : 'roundBody', { round: label, opponent: name(opp), minutes: t.toleranceMin });
          },
          t.checkIn ? toleranceMs(t) / 1000 : 3600,
        );
      }
    }
  };

  /** Check-in aberto: avisa quem está inscrito e ainda não confirmou presença. */
  const notifyCheckIn = (id: string) => {
    const t = getTournament(db, id);
    if (!t || t.status !== 'registration' || !t.startsAt) return;
    const ttl = Math.max(60, Math.round((new Date(t.startsAt).getTime() - now()) / 1000));
    for (const p of listPlayers(db, t.id)) if (!p.checkedInAt && !p.dropped) tournamentNotice(t, p.userId, (locale) => pushText(locale, 'checkInBody'), ttl);
  };

  // Relógio dos torneios com hora marcada: início automático e W.O. por ausência.
  const tick = () => {
    try {
      const r = tournamentTick(db, now(), (roomId) => lobby.closeIfWaiting(roomId));
      for (const id of r.checkIns) notifyCheckIn(id);
      for (const id of r.started) {
        app.log.info(`torneio ${id}: começou sozinho na hora marcada`);
        notifyRound(id);
      }
      for (const w of r.noShows) app.log.info(`torneio ${w.tournamentId}: W.O. na partida ${w.matchId} (${w.absent.join(', ')} ausente)`);
      return r;
    } catch (err) {
      app.log.error(err, 'relógio dos torneios');
      return null;
    }
  };
  if (tickMs > 0) {
    const timer = setInterval(tick, tickMs);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  // Exposto para os testes.
  app.decorate('tournamentTick', tick);

  /** Conta logada, ou responde 401. */
  const account = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const u = user(req);
    if (!u) void reply.code(401).send(fail('loginRequired', 'Entre com a conta Google.'));
    return u;
  };
  // O criador gerencia o próprio torneio se é Organizador ou se o criou pela cota de apoiador
  // (mesmo que o plano vença depois, para não deixar o torneio sem dono).
  const canManage = (t: Tournament, u: User | null) =>
    Boolean(u && (isAdmin(u.role) || (u.id === t.organizerId && (createsTournaments(u.role) || t.quota))));

  const organizeLimits = (u: User | null): OrganizeLimits | null => {
    if (!u) return null;
    if (createsTournaments(u.role)) return { kind: 'role', perMonth: null, used: 0, maxPlayers: MAX_PLAYERS };
    if (atLeast(u.supporterTier, 'capitao')) {
      return {
        kind: 'supporter',
        perMonth: SUPPORTER_TOURNAMENTS_PER_MONTH,
        used: quotaUsed(db, u.id, monthStart(now())),
        maxPlayers: SUPPORTER_MAX_PLAYERS,
      };
    }
    return null;
  };

  /**
   * Campos do torneio do time (oficial, prêmio, loja, inscrição antecipada): só o admin
   * muda; para os outros, ficam como estavam.
   */
  const officialFields = ({ priority, ...input }: ParsedInput, me: User, existing: Tournament | null): TournamentInput | PlayerError => {
    if (!isAdmin(me.role)) {
      return {
        ...input,
        official: existing?.official ?? false,
        prize: existing?.prize ?? null,
        sponsorId: existing?.sponsorId ?? null,
        priorityUntil: existing?.priorityUntil ?? null,
      };
    }
    if (input.sponsorId && !getSponsor(db, input.sponsorId)) return fail('sponsorNotFound', 'Loja patrocinadora não encontrada.');
    const keep = existing?.priorityUntil && existing.official ? existing.priorityUntil : null;
    return {
      ...input,
      priorityUntil: priority ? (keep ?? new Date(now() + DEFAULT_PRIORITY_HOURS * 3_600_000).toISOString()) : null,
    };
  };

  /** Torneios da cota de apoiador: no máximo `max` jogadores (sem limite informado = o máximo). */
  const capPlayers = (input: TournamentInput, max: number): PlayerError | null => {
    if (max >= MAX_PLAYERS) return null;
    if (input.maxPlayers === null) input.maxPlayers = max;
    return input.maxPlayers > max ? fail('tourPlanMaxPlayers', `Torneios do seu plano têm até ${max} jogadores.`, { max }) : null;
  };

  /** Loja patrocinadora para mostrar no torneio (só as ativas). */
  const sponsorOf = (id: string | null) => {
    const sp = id ? getSponsor(db, id) : null;
    return sp && sp.active ? publicSponsor(sp) : null;
  };

  /** Inscrição antecipada aberta agora (só Almirantes e admins se inscrevem). */
  const priorityOpen = (t: Tournament) => Boolean(t.priorityUntil && Date.parse(t.priorityUntil) > now());
  const canRegisterNow = (t: Tournament, u: User | null) =>
    Boolean(u) && t.status === 'registration' && (!priorityOpen(t) || atLeast(u!.supporterTier, 'almirante') || isAdmin(u!.role));

  /** Torneio que a conta logada gerencia, ou responde 401/403/404. */
  const managed = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): { t: Tournament; me: User } | null => {
    const me = account(req, reply);
    if (!me) return null;
    const t = getTournament(db, req.params.id);
    if (!t) {
      void reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
      return null;
    }
    if (!canManage(t, me)) {
      void reply.code(403).send(fail('tourManageForbidden', 'Só o organizador do torneio (ou um admin) pode fazer isso.'));
      return null;
    }
    return { t, me };
  };

  /** Rodadas previstas: suíço (+ top cut) ou a chave inteira. */
  const plannedRounds = (t: Tournament, players: number) =>
    t.structure === 'single'
      ? singleRounds(players)
      : (t.rounds ?? swissRounds(players)) + (t.topCut ? singleRounds(Math.min(t.topCut, players)) : 0);

  const summary = (t: Tournament & { players?: number }, mine: Set<string>) => {
    const players = t.players ?? countPlayers(db, t.id);
    return {
      id: t.id,
      name: t.name,
      format: t.format,
      structure: t.structure,
      topCut: t.topCut,
      status: t.status,
      round: t.round,
      /** null = ainda depende do número de inscritos. */
      totalRounds: t.status === 'registration' ? null : plannedRounds(t, players),
      players,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      checkIn: t.checkIn,
      checkInOpensAt: checkInOpensAt(t),
      organizerName: t.organizerName,
      registered: mine.has(t.id),
      official: t.official,
      prize: t.prize,
      sponsor: sponsorOf(t.sponsorId),
      priorityUntil: t.priorityUntil,
    };
  };

  app.get('/api/tournaments', async (req) => {
    const u = user(req);
    const mine = u ? tournamentsOf(db, u.id) : new Set<string>();
    const limits = organizeLimits(u);
    return {
      tournaments: listTournaments(db).map((t) => summary(t, mine)),
      canCreate: Boolean(limits && (limits.perMonth === null || limits.used < limits.perMonth)),
      /** Limites de quem pede (null = não organiza): a tela mostra "3 de 5 este mês". */
      organize: limits,
    };
  });

  const roundComplete = (t: Tournament, matches: TournamentMatch[]) => matches.filter((m) => m.round === t.round).every((m) => m.result);

  /** Próximo passo depois da rodada atual: outra rodada do suíço, o top cut, a próxima fase ou o fim. */
  const nextStep = (t: Tournament, players: TournamentPlayer[], matches: TournamentMatch[]): 'swiss' | 'cut' | 'elim' | 'finish' => {
    const current = matches.filter((m) => m.round === t.round);
    const active = players.filter((p) => !p.dropped).length;
    if (current[0]?.stage === 'elim') return current.length <= 1 ? 'finish' : 'elim';
    if (t.round < (t.rounds ?? 0) && active >= 2) return 'swiss';
    return t.topCut && active >= 2 ? 'cut' : 'finish';
  };

  /** Torneio completo: inscritos, rodadas, classificação e o que quem pede pode fazer. */
  const detail = (t: Tournament, u: User | null) => {
    const players = listPlayers(db, t.id);
    const matches = listMatches(db, t.id);
    const games = listGames(db, t.id);
    const manage = canManage(t, u);
    const tiers = supporterTiers(db, players.map((p) => p.userId));
    // Nas inscrições, só o organizador e o próprio jogador veem qual deck (Líder) cada
    // um inscreveu: o deck e a lista ficam congelados quando o torneio começa, e é aí
    // que o Líder aparece para todos (ninguém escolhe o deck olhando os dos outros).
    // As listas completas ficam escondidas até o fim (só o organizador e o próprio jogador as veem).
    const showLeader = (userId: string) => manage || t.status !== 'registration' || userId === u?.id;
    const showDeck = (userId: string) => manage || t.status === 'finished' || userId === u?.id;
    const ids = players.flatMap((p) => [
      ...(showLeader(p.userId) ? [p.deck.leader] : []),
      ...(showDeck(p.userId) ? p.deck.cards.map((c) => c.id) : []),
    ]);
    const cards = new Map(present(getCards(db, [...new Set(ids)])).map((c) => [c.id, c] as const));
    const name = new Map(players.map((p) => [p.userId, p.name]));
    const ref = (id: string | null) => (id ? { userId: id, name: name.get(id) ?? '?' } : null);
    const rounds = Array.from({ length: t.round }, (_, i) => {
      const ms = matches.filter((m) => m.round === i + 1);
      return {
        round: i + 1,
        stage: ms[0]?.stage ?? 'swiss',
        label: roundLabel(matches, i + 1),
        bestOf: ms[0]?.bestOf ?? 1,
        matches: ms.map((m) => {
          const absent = absentSides(t, m, players);
          /** O replay de cada jogo: para quem audita e para os dois jogadores. */
          const seesReplays = manage || m.p1 === u?.id || m.p2 === u?.id;
          return {
            id: m.id,
            table: m.table,
            p1: ref(m.p1)!,
            p2: ref(m.p2),
            bestOf: m.bestOf,
            wins: m.wins,
            result: m.result,
            winner: winnerOf(m),
            /** Quem lançou: game (salas online), bye, drop (desistência), noshow (W.O. automático), late (inscrição atrasada) ou organizer. */
            reportedBy: m.reportedBy === null || ['game', 'bye', 'drop', 'noshow', 'late'].includes(m.reportedBy) ? m.reportedBy : 'organizer',
            roomId: m.roomId,
            room: m.roomId ? (lobby.get(m.roomId)?.status ?? null) : null,
            /** Jogo da série em disputa agora (1, 2, 3…). */
            game: m.wins[0] + m.wins[1] + 1,
            /** Cada jogador já entrou na sala desta série (ou, na rodada 1, fez check-in). */
            present: m.p2 ? [!absent.includes('p1'), !absent.includes('p2')] : [true, false],
            /** Jogos disputados nas salas desta série (auditoria): todos ficam gravados, com o replay. */
            games: games
              .filter((g) => g.matchId === m.id)
              .map((g) => ({
                game: g.game,
                winner: ref(g.winner),
                counted: g.counted,
                playedAt: g.playedAt,
                statsMatchId: seesReplays ? g.statsMatchId : null,
              })),
          };
        }),
      };
    });
    const me = u ? players.find((p) => p.userId === u.id) : undefined;
    const reinstate = (userId: string) => {
      if (!manage || t.status !== 'running') return null;
      const r = reinstateOptions(t, players, matches, userId);
      return 'code' in r ? null : r.restore;
    };
    const lateName = t.lateEntry && t.lateEntry !== '*' ? (findPlayer(db, accountOwnerKey(t.lateEntry))?.name ?? '?') : null;
    const current = me && t.status === 'running' ? matches.find((m) => m.round === t.round && (m.p1 === me.userId || m.p2 === me.userId)) : undefined;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
      structure: t.structure,
      swissBestOf: t.swissBestOf,
      topCut: t.topCut,
      bo3From: t.bo3From,
      bo5From: t.bo5From,
      status: t.status,
      round: t.round,
      /** Fase da rodada atual. */
      stage: matches.find((m) => m.round === t.round)?.stage ?? null,
      /** Rodadas previstas (suíço + top cut, ou a chave). */
      totalRounds: plannedRounds(t, players.length),
      /** Rodadas do suíço (só no suíço). */
      swissRounds: t.structure === 'swiss' ? (t.rounds ?? swissRounds(players.length)) : null,
      roundsAuto: t.rounds === null,
      /** Relógio de cada jogador em cada jogo: quem zera o tempo perde. */
      clockMs: TIME_BANK_MS,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      /** Torneio com hora marcada: check-in, início automático e W.O. por ausência. */
      checkIn: t.checkIn,
      checkInMs: CHECK_IN_MS,
      toleranceMin: t.toleranceMin,
      toleranceMs: toleranceMs(t),
      checkInOpensAt: checkInOpensAt(t),
      checkInOpen: checkInOpen(t, now()),
      checkedIn: players.filter((p) => p.checkedInAt).length,
      /** Prazo para entrar na sala na rodada atual (null = sem tolerância correndo). */
      roundAt: t.roundAt,
      deadline: roundDeadline(t),
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      organizerName: t.organizerName,
      official: t.official,
      prize: t.prize,
      sponsor: sponsorOf(t.sponsorId),
      /** Inscrição antecipada: até esta hora só Almirantes se inscrevem. */
      priorityUntil: t.priorityUntil,
      priorityOpen: priorityOpen(t),
      /** Limite de jogadores dos torneios da cota de apoiador (para o formulário de edição). */
      maxPlayersCap: t.quota && !isAdmin(u?.role) && !createsTournaments(u?.role) ? SUPPORTER_MAX_PLAYERS : MAX_PLAYERS,
      canManage: manage,
      canRegister: canRegisterNow(t, u) || Boolean(u && t.status === 'registration' && players.some((p) => p.userId === u.id)),
      /** Inscrição atrasada liberada para quem pede (entra na rodada 2 com uma derrota). */
      canLateRegister: !me && lateAllowed(t, u),
      /** Para quem gerencia: a janela da inscrição atrasada está aberta (suíço, rodada 1) e a quem ela foi liberada. */
      lateWindow: manage && lateWindow(t),
      lateEntry: manage && lateWindow(t) && t.lateEntry ? { all: t.lateEntry === '*', name: lateName } : null,
      me: me
        ? {
            deckId: me.deckId,
            deckName: me.deck.name,
            leader: me.deck.leader,
            dropped: me.dropped,
            matchId: current?.id ?? null,
            checkedInAt: me.checkedInAt,
          }
        : null,
      players: players.map((p) => {
        const leader = showLeader(p.userId) ? cards.get(p.deck.leader) : undefined;
        return {
          userId: p.userId,
          name: p.name,
          /** Plano de apoio ativo (selo ao lado do nome). */
          supporter: tiers.get(p.userId) ?? null,
          seed: t.status === 'registration' ? null : p.seed,
          dropped: p.dropped,
          /** Para quem gerencia: o jogador que saiu pode voltar (e se a partida da rodada pode ou precisa ser devolvida). */
          reinstate: p.dropped ? reinstate(p.userId) : null,
          checkedIn: Boolean(p.checkedInAt),
          /** Líder do deck: null enquanto as inscrições estão abertas (só o organizador e o próprio jogador o veem). */
          leader: showLeader(p.userId) ? p.deck.leader : null,
          leaderName: leader?.name ?? null,
          leaderImage: (cardImages && leader?.imageUrl) || null,
          colors: leader?.colors ?? [],
          deck: showDeck(p.userId)
            ? { name: p.deck.name, leader: p.deck.leader, cards: p.deck.cards.map((c) => ({ ...c, name: cards.get(c.id)?.name ?? null })) }
            : null,
        };
      }),
      rounds,
      standings: t.status === 'registration' ? [] : standings(players, matches).map((s) => ({ ...s, name: name.get(s.userId) ?? '?' })),
      roundComplete: t.status === 'running' && roundComplete(t, matches),
      /** O que o botão de avançar faz agora. */
      next: t.status === 'running' ? nextStep(t, players, matches) : null,
      /** Relatos abertos dos jogadores (só para quem gerencia; a lista vem de GET /api/reports?tournament=). */
      openReports: manage ? listReports(db, { tournamentId: t.id, status: 'open' }).length : 0,
    };
  };

  /**
   * A página do torneio consulta esta rota a cada 5 s por jogador: a resposta fica em
   * cache (por torneio e conta, invalidado a cada gravação) e sai como 304 quando o
   * navegador já a tem.
   */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const u = user(req);
    // A abertura do check-in muda a resposta sem gravação: entra na chave do cache.
    const open = checkInOpen(t, now()) ? 'open' : '';
    return cache.send(req, reply, `tournament:${t.id}:${u?.id ?? '-'}:${open}`, DETAIL_TTL_MS, () => detail(t, u));
  });

  /**
   * Atalho da tela inicial: os torneios em que a conta está "em jogo" agora, com a
   * partida da rodada (check-in aberto, torneio em andamento). Consultado a cada 10 s
   * pelo menu de quem está logado; a consulta é leve (só as inscrições da conta) e
   * depende da hora, então não passa pelo cache.
   */
  app.get('/api/tournaments/me', async (req) => {
    const u = user(req);
    if (!u) return { entries: [] };
    return {
      entries: myTournaments(db, u.id)
        .filter(({ tournament: t }) => t.status === 'running' || checkInOpen(t, now()))
        .map(({ tournament: t, checkedInAt }) => {
          const matches = t.status === 'running' ? listMatches(db, t.id) : [];
          const m = matches.find((x) => x.round === t.round && (x.p1 === u.id || x.p2 === u.id));
          const oppId = m ? (m.p1 === u.id ? m.p2 : m.p1) : null;
          const name = oppId ? (listPlayers(db, t.id).find((p) => p.userId === oppId)?.name ?? '?') : null;
          return {
            id: t.id,
            name: t.name,
            status: t.status,
            startsAt: t.startsAt,
            checkInOpensAt: checkInOpensAt(t),
            checkedIn: Boolean(checkedInAt),
            round: t.round,
            label: m ? roundLabel(matches, m.round) : null,
            deadline: roundDeadline(t),
            match: m
              ? {
                  id: m.id,
                  table: m.table,
                  opponent: name,
                  bestOf: m.bestOf,
                  game: m.wins[0] + m.wins[1] + 1,
                  result: m.result,
                  winner: winnerOf(m),
                  room: m.roomId ? (lobby.get(m.roomId)?.status ?? null) : null,
                }
              : null,
          };
        }),
    };
  });

  // ---------------------------------------------------------------- organizador

  app.post<{ Body: Body }>('/api/tournaments', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const limits = organizeLimits(me);
    if (!limits) {
      return reply
        .code(403)
        .send(fail('tourCreateNeedsPlan', 'Organizar torneios é um benefício dos planos Capitão e Almirante (ou do perfil Organizador).'));
    }
    if (limits.perMonth !== null && limits.used >= limits.perMonth) {
      return reply
        .code(403)
        .send(fail('tourQuotaReached', `Você já criou ${limits.perMonth} torneios este mês. A cota renova no dia 1º.`, { n: limits.perMonth }));
    }
    const parsed = parseInput(req.body);
    if (isPlayerError(parsed)) return reply.code(400).send(parsed);
    const input = officialFields(parsed, me, null);
    if (isPlayerError(input)) return reply.code(400).send(input);
    const cap = capPlayers(input, limits.maxPlayers);
    if (cap) return reply.code(400).send(cap);
    // O nome público do organizador vem do perfil de estatísticas.
    ensurePlayer(db, accountOwnerKey(me.id));
    const t = createTournament(db, input, me.id, limits.kind === 'supporter' ? { at: nowIso() } : null);
    return reply.code(201).send(detail(t, me));
  });

  app.put<{ Params: { id: string }; Body: Body }>('/api/tournaments/:id', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    if (found.t.status !== 'registration') return reply.code(409).send(fail('tourStartedNoEdit', 'O torneio já começou: não dá para mudar as regras.'));
    const parsed = parseInput(req.body);
    if (isPlayerError(parsed)) return reply.code(400).send(parsed);
    const input = officialFields(parsed, found.me, found.t);
    if (isPlayerError(input)) return reply.code(400).send(input);
    if (found.t.quota && !isAdmin(found.me.role) && !createsTournaments(found.me.role)) {
      const cap = capPlayers(input, SUPPORTER_MAX_PLAYERS);
      if (cap) return reply.code(400).send(cap);
    }
    if (input.maxPlayers !== null && input.maxPlayers < countPlayers(db, found.t.id)) {
      return reply.code(400).send(fail('maxBelowRegistered', 'O limite é menor que o número de inscritos.'));
    }
    // Mudar o formato pode invalidar decks já inscritos: confere de novo.
    if (input.format !== found.t.format) {
      const bad = listPlayers(db, found.t.id).filter((p) => p.deckId && 'error' in playableDeck(db, p.deckId, input.format, false));
      if (bad.length) {
        const format = FORMATS.find((f) => f.id === input.format)?.label;
        return reply
          .code(400)
          .send(fail('tourDecksNotAllowed', `${bad.length} inscrito(s) usam decks que não valem no formato ${format}.`, { n: bad.length, format: format ?? input.format }));
      }
    }
    updateTournament(db, found.t.id, input);
    return detail(getTournament(db, found.t.id)!, found.me);
  });

  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    // Apagar antes de começar devolve a vaga da cota de apoiador.
    if (found.t.status === 'registration') releaseQuota(db, found.t.id);
    deleteTournament(db, found.t.id);
    return reply.code(204).send();
  });

  /** Fecha as inscrições, sorteia a ordem e gera a primeira rodada (à mão; com check-in, também acontece sozinho na hora). */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'registration') return reply.code(409).send(fail('tourStarted', 'O torneio já começou.'));
    const players = listPlayers(db, t.id);
    if (players.length < 2) return reply.code(400).send(fail('tourNeedsTwoPlayers', 'São precisos pelo menos 2 inscritos.'));
    beginTournament(db, t, players, nowIso());
    notifyRound(t.id);
    return detail(getTournament(db, t.id)!, me);
  });

  /** Com a rodada atual completa: gera a próxima rodada (do suíço, o top cut ou a próxima fase) ou encerra. */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/next', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'running') return reply.code(409).send(fail('tourNotRunning', 'O torneio não está em andamento.'));
    const matches = listMatches(db, t.id);
    if (!roundComplete(t, matches)) return reply.code(409).send(fail('roundIncomplete', 'Ainda há partidas da rodada sem resultado.'));
    const players = listPlayers(db, t.id);
    const step = nextStep(t, players, matches);
    const round = t.round + 1;
    const at = nowIso();
    if (step === 'swiss') {
      insertRound(db, t.id, { round, stage: 'swiss', bestOf: t.swissBestOf, pairings: swissPairings(players, matches) }, at);
    } else if (step === 'cut') {
      // Os melhores do suíço (quem desistiu fica de fora), semeados pela classificação.
      const ranked = standings(players, matches).filter((s) => !s.dropped);
      const cut = ranked.slice(0, Math.min(t.topCut!, ranked.length)).map((s, i) => ({ userId: s.userId, seed: i + 1, dropped: false }));
      insertRound(db, t.id, elimRound(t, round, singleFirstRound(cut)), at);
    } else if (step === 'elim') {
      const pairings = singleNextRound(players, matches.filter((m) => m.round === t.round));
      // Sem ninguém para avançar (W.O. duplo nas mesas que restavam): acabou.
      if (pairings.length) insertRound(db, t.id, elimRound(t, round, pairings), at);
      else finishTournament(db, t.id);
    } else finishTournament(db, t.id);
    notifyRound(t.id);
    return detail(getTournament(db, t.id)!, me);
  });

  /** Encerra antes da última rodada (a classificação fica como está). */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/finish', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    if (found.t.status !== 'running') return reply.code(409).send(fail('tourNotRunning', 'O torneio não está em andamento.'));
    finishTournament(db, found.t.id);
    return detail(getTournament(db, found.t.id)!, found.me);
  });

  /**
   * Derrota dupla lançada à mão: os dois perdem e seguem no torneio (`dropBoth`: também
   * saem). Suíço: em qualquer rodada, até o top cut começar. Chave: na rodada atual os
   * dois saem da chave (a mesa seguinte fica com bye); numa rodada passada, só se a
   * partida seguinte ainda não começou: o vencedor antigo sai dela e o oponente fica de bye.
   */
  const doubleLoss = (t: Tournament, me: User, m: TournamentMatch, dropBoth: boolean): ({ code: number } & PlayerError) | null => {
    const matches = listMatches(db, t.id);
    const live = t.status === 'running' && m.round === t.round;
    let next: TournamentMatch | undefined;
    const oldWinner = winnerOf(m);
    if (!live && m.stage === 'swiss' && m.result !== 'none' && matches.some((x) => x.stage === 'elim')) {
      return { code: 409, ...fail('topCutStartedSwissLocked', 'O top cut já começou: os resultados do suíço não mudam mais.') };
    }
    if (!live && m.stage === 'elim' && oldWinner) {
      next = matches.find((x) => x.round === m.round + 1 && (x.p1 === oldWinner || x.p2 === oldWinner));
      if (next && !next.p2) {
        return { code: 409, ...fail('doubleLossByeNext', 'O vencedor desta partida passou de bye na fase seguinte: a mesa ficaria vazia.') };
      }
      if (next?.result) {
        const round = roundLabel(matches, next.round);
        return { code: 409, ...fail('fixNextMatchFirst', `Corrija antes o resultado da partida seguinte (${round}, mesa ${next.table}).`, { round, table: next.table }) };
      }
      if (next && (next.wins[0] + next.wins[1] > 0 || (next.roomId && lobby.get(next.roomId)?.status === 'playing'))) {
        return { code: 409, ...fail('nextMatchStarted', 'A partida seguinte da chave já começou: zere o placar dela antes de corrigir esta.') };
      }
    }
    if (m.roomId) lobby.closeIfWaiting(m.roomId);
    setDoubleLoss(db, t.id, m.id, me.id);
    if (next && oldWinner) {
      if (next.roomId) lobby.closeIfWaiting(next.roomId);
      vacateInMatch(db, t.id, next.id, oldWinner);
    }
    const out = dropBoth && t.status === 'running' ? [m.p1, m.p2!].filter((id) => !listPlayers(db, t.id).find((p) => p.userId === id)?.dropped) : [];
    for (const id of out) dropPlayer(db, getTournament(db, t.id)!, id);
    app.log.info(`torneio ${t.id}: derrota dupla na partida ${m.id} lançada por ${me.id}${out.length ? ` (saem: ${out.join(', ')})` : ''}`);
    return null;
  };

  /**
   * Lança ou corrige o placar de uma partida (`{ wins: [p1, p2] }` ou `{ result: p1 | p2 }`).
   * Rodada atual: qualquer placar, inclusive parcial ou zerado. Rodadas passadas: só
   * placares com vencedor, e só enquanto a troca de vencedor não desmontar o que veio depois.
   * `{ result: 'double', dropBoth? }`: derrota dupla (ver `doubleLoss`).
   */
  app.put<{ Params: { id: string; matchId: string }; Body: { wins?: unknown; result?: unknown; dropBoth?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/result',
    async (req, reply) => {
      const found = managed(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const m = getMatch(db, t.id, Number(req.params.matchId));
      if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
      if (t.status === 'registration') return reply.code(409).send(fail('tourNotStarted', 'O torneio ainda não começou.'));
      if (!m.p2) return reply.code(400).send(fail('matchIsBye', 'Esta partida é um bye.'));
      if (req.body?.result === 'double') {
        const r = doubleLoss(t, me, m, Boolean(req.body.dropBoth));
        return r ? reply.code(r.code).send(fail(r.errorCode, r.error, r.errorParams)) : detail(getTournament(db, t.id)!, me);
      }
      const wins = parseScore(req.body, m.bestOf);
      if (isPlayerError(wins)) return reply.code(400).send(wins);
      const result = seriesResult(m.bestOf, wins);
      const live = t.status === 'running' && m.round === t.round;
      if (!live) {
        if (!result) return reply.code(409).send(fail('pastRoundNeedsWinner', 'Partidas de rodadas passadas precisam de um vencedor.'));
        const matches = listMatches(db, t.id);
        const oldWinner = winnerOf(m);
        const newWinner = result === 'p1' ? m.p1 : m.p2;
        if (oldWinner && oldWinner !== newWinner) {
          if (m.stage === 'swiss' && matches.some((x) => x.stage === 'elim')) {
            return reply.code(409).send(fail('topCutStartedSwissLocked', 'O top cut já começou: os resultados do suíço não mudam mais.'));
          }
          if (m.stage === 'elim') {
            // Na chave, o vencedor já foi para a partida seguinte: troca-o lá, se ela ainda não começou.
            const next = matches.find((x) => x.round === m.round + 1 && (x.p1 === oldWinner || x.p2 === oldWinner));
            if (next) {
              if (next.result && next.result !== 'bye') {
                const round = roundLabel(matches, next.round);
                return reply
                  .code(409)
                  .send(fail('fixNextMatchFirst', `Corrija antes o resultado da partida seguinte (${round}, mesa ${next.table}).`, { round, table: next.table }));
              }
              if (next.wins[0] + next.wins[1] > 0 || (next.roomId && lobby.get(next.roomId)?.status === 'playing')) {
                return reply.code(409).send(fail('nextMatchStarted', 'A partida seguinte da chave já começou: zere o placar dela antes de corrigir esta.'));
              }
              replaceInMatch(db, t.id, next.id, oldWinner, newWinner!);
            }
          }
        }
      }
      setMatchScore(db, t.id, m.id, m.bestOf, wins, me.id);
      return detail(getTournament(db, t.id)!, me);
    },
  );

  /** Tira um jogador: nas inscrições, cancela a inscrição; durante o torneio, é uma desistência. */
  app.post<{ Params: { id: string; userId: string } }>('/api/tournaments/:id/players/:userId/drop', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    const r = removePlayer(t, req.params.userId);
    return r ? reply.code(r.code).send(fail(r.errorCode, r.error)) : detail(getTournament(db, t.id)!, me);
  });

  /**
   * Desfaz a desistência (ou a saída por W.O.): o jogador volta a ser pareado a partir da
   * próxima rodada. `restoreMatch`: a partida da rodada atual que a saída decidiu volta a
   * ficar pendente (ver `reinstateOptions`).
   */
  app.post<{ Params: { id: string; userId: string }; Body: { restoreMatch?: unknown } }>(
    '/api/tournaments/:id/players/:userId/reinstate',
    async (req, reply) => {
      const found = managed(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const userId = req.params.userId;
      const players = listPlayers(db, t.id);
      const opts = reinstateOptions(t, players, listMatches(db, t.id), userId);
      if ('code' in opts) return reply.code(opts.code).send(fail(opts.errorCode, opts.error, opts.errorParams));
      const restore = Boolean(req.body?.restoreMatch);
      if (restore && !opts.match) return reply.code(409).send(fail('reinstateNothingToRestore', 'Não há partida desta rodada para devolver.'));
      if (!restore && opts.restore === 'required') {
        return reply.code(409).send(fail('reinstateNeedsRestore', 'Na chave, o jogador só volta devolvendo a partida desta rodada.'));
      }
      reinstatePlayer(db, t.id, userId, restore ? opts.match!.id : null);
      app.log.info(`torneio ${t.id}: ${userId} voltou ao torneio por ${me.id}${restore ? ` (partida ${opts.match!.id} devolvida)` : ''}`);
      tournamentNotice(t, userId, (locale) => pushText(locale, restore ? 'reinstatedMatchBody' : 'reinstatedBody'), 3600);
      return detail(getTournament(db, t.id)!, me);
    },
  );

  /**
   * Libera (`{ open: true }`, para todos ou só para `player`, pelo apelido) ou fecha a
   * inscrição atrasada. Só no suíço com pelo menos 2 rodadas, durante a rodada 1.
   */
  app.put<{ Params: { id: string }; Body: { open?: unknown; player?: unknown } }>('/api/tournaments/:id/late', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (!lateWindow(t)) {
      return reply
        .code(409)
        .send(fail('lateEntryUnavailable', 'A inscrição atrasada só existe no suíço com pelo menos 2 rodadas, enquanto a rodada 1 está em andamento.'));
    }
    let value: string | null = null;
    if (req.body?.open) {
      const name = typeof req.body.player === 'string' ? req.body.player.trim().replace(/\s+/g, ' ') : '';
      if (!name) value = '*';
      else {
        const accounts = accountsByName(db, name);
        if (!accounts.length) return reply.code(404).send(fail('lateEntryPlayerNotFound', `Nenhum jogador com o apelido "${name}".`, { name }));
        if (accounts.length > 1) return reply.code(409).send(fail('lateEntryPlayerAmbiguous', `Há mais de um jogador com o apelido "${name}".`, { name }));
        if (listPlayers(db, t.id).some((p) => p.userId === accounts[0].userId)) {
          return reply.code(409).send(fail('lateEntryAlreadyRegistered', `${accounts[0].name} já está inscrito.`, { name: accounts[0].name }));
        }
        value = accounts[0].userId;
      }
    }
    setLateEntry(db, t.id, value);
    app.log.info(`torneio ${t.id}: inscrição atrasada ${value ? `liberada (${value})` : 'fechada'} por ${me.id}`);
    return detail(getTournament(db, t.id)!, me);
  });

  const removePlayer = (t: Tournament, userId: string): ({ code: number } & PlayerError) | null => {
    const p = listPlayers(db, t.id).find((x) => x.userId === userId);
    if (!p) return { code: 404, ...fail('playerNotRegistered', 'Jogador não inscrito.') };
    if (t.status === 'registration') unregisterPlayer(db, t.id, userId);
    else if (t.status === 'running') {
      if (p.dropped) return { code: 409, ...fail('playerAlreadyDropped', 'Este jogador já saiu do torneio.') };
      dropPlayer(db, t, userId);
    } else return { code: 409, ...fail('tourFinished', 'O torneio já terminou.') };
    return null;
  };

  // ---------------------------------------------------------------- jogadores

  /** Inscrição (ou troca de deck, enquanto as inscrições estão abertas). */
  app.post<{ Params: { id: string }; Body: { deckId?: unknown } }>('/api/tournaments/:id/register', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const already = listPlayers(db, t.id).some((p) => p.userId === me.id);
    // Inscrição atrasada (liberada pelo organizador na rodada 1 do suíço): entra com uma derrota.
    const late = t.status === 'running' && !already && lateAllowed(t, me);
    if (t.status !== 'registration' && !late) return reply.code(409).send(fail('registrationClosed', 'As inscrições deste torneio já fecharam.'));
    // Inscrição antecipada: só barra inscrições novas (quem já está inscrito pode trocar de deck).
    if (!already && !late && !canRegisterNow(t, me)) {
      const opens = new Date(t.priorityUntil!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
      return reply
        .code(403)
        .send(fail('tourPriorityWindow', `Inscrição antecipada para apoiadores Almirante: abre para todos em ${opens}.`, { date: opens }));
    }
    if (!already && t.maxPlayers !== null && countPlayers(db, t.id) >= t.maxPlayers) {
      return reply.code(409).send(fail('tourFull', 'O torneio está lotado.'));
    }
    const deck = playableDeck(db, req.body?.deckId, t.format, false);
    if ('error' in deck) return reply.code(deck.code).send(fail(deck.errorCode, deck.error, deck.errorParams));
    const profile = ensurePlayer(db, accountOwnerKey(me.id));
    if (late) {
      lateRegister(db, t, me.id, profile.name, deck.id ?? null, deck, nowIso());
      app.log.info(`torneio ${t.id}: inscrição atrasada de ${me.id} (derrota na rodada 1)`);
      return detail(getTournament(db, t.id)!, me);
    }
    registerPlayer(db, t.id, me.id, profile.name, deck.id ?? null, deck);
    return detail(t, me);
  });

  /** Check-in: confirma a presença (abre 30 min antes do início, para quem está inscrito). */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/checkin', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    if (!t.checkIn) return reply.code(400).send(fail('noCheckIn', 'Este torneio não tem check-in.'));
    if (t.status !== 'registration') return reply.code(409).send(fail('tourStartedJoinRoom', 'O torneio já começou: entre na sala da sua partida.'));
    if (!checkInOpen(t, now())) return reply.code(409).send(fail('checkInNotOpen', 'O check-in abre 30 minutos antes do início.'));
    if (!listPlayers(db, t.id).some((p) => p.userId === me.id)) return reply.code(404).send(fail('notRegistered', 'Você não está inscrito.'));
    checkInPlayer(db, t.id, me.id, nowIso());
    return detail(getTournament(db, t.id)!, me);
  });

  /** Cancela a inscrição ou, com o torneio em andamento, desiste. */
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id/register', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const r = removePlayer(t, me.id);
    return r ? reply.code(r.code).send(fail(r.errorCode, r.error)) : detail(getTournament(db, t.id)!, me);
  });

  /**
   * Abre (ou entra na) sala online do jogo atual da série. O primeiro a entrar
   * espera o oponente; o jogo começa quando os dois estão na sala.
   */
  app.post<{ Params: { id: string; matchId: string } }>('/api/tournaments/:id/matches/:matchId/play', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    const m = t && getMatch(db, t.id, Number(req.params.matchId));
    if (!t || !m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    if (m.p1 !== me.id && m.p2 !== me.id) return reply.code(403).send(fail('notYourMatch', 'Esta partida não é sua.'));
    if (t.status !== 'running' || m.round !== t.round) return reply.code(409).send(fail('matchNotCurrentRound', 'Esta partida não é da rodada atual.'));
    if (!m.p2) return reply.code(400).send(fail('youHaveBye', 'Você está de bye nesta rodada: a vitória já é sua.'));
    if (m.result) return reply.code(409).send(fail('matchHasResult', 'Esta partida já tem resultado.'));
    const player = listPlayers(db, t.id).find((p) => p.userId === me.id)!;
    if (player.dropped) return reply.code(409).send(fail('youDropped', 'Você saiu do torneio.'));
    const limit = lobby.admit(req.ip, 'tournament');
    if (limit) return reply.code(limit.code).send(limit);
    const ownerHash = accountOwnerKey(me.id);
    const profile = ensurePlayer(db, ownerHash);
    const r = lobby.tournamentRoom(
      {
        ownerHash,
        userId: me.id,
        name: profile.name,
        bounty: profile.bounty,
        tier: tierFor(profile.bounty).id,
        apprentice: isApprentice(db, ownerHash),
        deckId: player.deckId,
        deck: player.deck,
      },
      t.format,
      {
        id: t.id,
        name: t.name,
        round: m.round,
        label: roundLabel(listMatches(db, t.id), m.round),
        matchId: m.id,
        game: m.wins[0] + m.wins[1] + 1,
        bestOf: m.bestOf,
        wins: { [m.p1]: m.wins[0], [m.p2]: m.wins[1] },
        firstUserId: m.nextFirst,
      },
    );
    if ('error' in r) return reply.code(r.code).send(r);
    lobby.tagIp(r.room.id, req.ip);
    if (m.roomId !== r.room.id) {
      setMatchRoom(db, t.id, m.id, r.room.id);
      // Sala nova deste jogo, ainda sem o oponente: ele é avisado de que alguém o espera.
      const opp = m.p1 === me.id ? m.p2 : m.p1;
      if (r.room.status === 'waiting') tournamentNotice(t, opp, (locale) => pushText(locale, 'waitingBody', { opponent: profile.name }), toleranceMs(t) / 1000);
    }
    // Entrar na sala é a presença que o W.O. automático confere.
    markEntered(db, t.id, m.id, m.p1 === me.id ? 'p1' : 'p2', nowIso());
    // A sala mudou de estado (criada ou começou): a página do torneio mostra isso.
    dataVersion.bump();
    return { roomId: r.room.id, token: r.token };
  });
}
