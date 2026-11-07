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
// Torneio com hora marcada e check-in (`checkIn`): o check-in abre 30 min antes e cada
// rodada iniciada tem alguns minutos de tolerância para entrar na sala (W.O. automático;
// ver clock.ts). Com `autoStart`, o torneio começa sozinho na hora; sem ele, o organizador
// dá o start mesmo com a hora atingida.
//
// Rodadas em duas etapas: gerar (`start`/`next`: os pareamentos aparecem e os jogadores
// marcam "Estou pronto") e iniciar (`rounds/begin`: as salas abrem para todos ao mesmo
// tempo e a tolerância começa a contar). `{ begin: true }` faz as duas de uma vez.
//
// Judge: o organizador escolhe as contas que são Judge só deste torneio (sem nenhuma, ele é o
// Judge). O Judge entra em qualquer sala vendo as mãos e o log, retoma uma partida pausada por um
// "Chamar o Judge" e dá warnings; só o organizador elimina (e decide, ao atingir o limite de
// warnings: a próxima rodada não é gerada enquanto ele não decidir).
//
// Ferramentas do organizador para situações de mesa: derrota dupla lançada à mão
// (penalidade: os dois perdem e seguem no torneio, a menos que ele os tire), desfazer
// a desistência de um jogador (ele volta a ser pareado na próxima rodada e, se a saída
// decidiu a partida da rodada atual, ela pode voltar a ficar pendente) e inscrição
// atrasada (só no suíço, durante a rodada 1: quem entra começa a rodada 2 com uma derrota).

import { createHash } from 'node:crypto';
import { artImage, type CardData, type DeckList, type FormatIssue, formatIssues, playMode, playModeLabel, spoilerRule } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, createsTournaments, isAdmin, isTeam, supporterTiers, type User } from '../auth/store';
import { atLeast, DEFAULT_PRIORITY_HOURS, SUPPORTER_MAX_PLAYERS, SUPPORTER_TOURNAMENTS_PER_MONTH } from '../support/tiers';
import { dataVersion, ResponseCache } from '../cache';
import { type DB, getCards, getDeck } from '../db';
import { fail, isPlayerError, type PlayerError } from '../errors';
import type { Lobby } from '../online/lobby';
import { playableDeck } from '../online/routes';
import { tournamentSpoilerSet } from '../spoiler-set';
import { TIME_BANK_MS } from '../online/room';
import type { ApiCard } from '../present';
import { isFormat, isPlayFormat, tierFor } from '../stats/catalog';
import { ensurePlayer, findPlayer } from '../stats/store';
import { listReports } from '../reports/store';
import { getSponsor, imageType, publicSponsor } from '../support/sponsors';
import { pushText, roundName } from '../push/messages';
import { noNotifier, type Notifier } from '../push/routes';
import {
  absentSides,
  advanceRound,
  type AutoHold,
  autoNextHold,
  beginTournament,
  CHECK_IN_MS,
  checkInOpen,
  checkInOpensAt,
  DEFAULT_TOLERANCE_MIN,
  deckIssue,
  MAX_TOLERANCE_MIN,
  MIN_TOLERANCE_MIN,
  nextStep,
  pendingWarnings,
  roundComplete,
  roundDeadline,
  staleDecks,
  toleranceMs,
  tournamentTick,
} from './clock';
import {
  elimLabel,
  losersOf,
  singleNextRound,
  singleRounds,
  standings,
  swissRounds,
  winnerOf,
  winsNeeded,
} from './pairing';
import {
  accountsByName,
  actsAsJudge,
  addIntervention,
  addJudge,
  addPrize,
  addWarning,
  APP_OUTCOMES,
  CALL_OUTCOMES,
  CALL_REASONS,
  type CallOutcome,
  type CallReason,
  checkInPlayer,
  createCall,
  countPlayers,
  isVirtualId,
  listVirtuals,
  createTournament,
  deletePrize,
  deleteTournament,
  dropPlayer,
  finishTournament,
  getMatch,
  getTournament,
  type InterventionRole,
  lateRegister,
  listCalls,
  listGames,
  listInterventions,
  listJudges,
  listMatches,
  listPlayers,
  listPrizes,
  listTournaments,
  listWarnings,
  markEntered,
  MAX_PRIZE_IMAGE_BYTES,
  MAX_PRIZES,
  openCall,
  myTournaments,
  type PrizeInput,
  prizeImage,
  quotaUsed,
  registerPlayer,
  reinstatePlayer,
  releaseQuota,
  removeJudge,
  replaceInMatch,
  resolveCalls,
  reviewWarnings,
  revokeWarning,
  seriesResult,
  setDoubleLoss,
  setLateEntry,
  setMatchRoom,
  setMatchScore,
  setPrizeImage,
  setReady,
  startRound,
  type Tournament,
  type TournamentCall,
  type TournamentGame,
  type TournamentInput,
  type TournamentMatch,
  type TournamentPlayer,
  type TournamentPrize,
  type TournamentWarning,
  tournamentsOf,
  unregisterPlayer,
  updatePrize,
  updateTournament,
  vacateInMatch,
  warningStatus,
} from './store';
import { fixTicket, pointedText } from './calls';
import {
  advanceChamber,
  beginChamber,
  chamberDecks,
  type ChamberEntrant,
  type ChamberPreset,
  ChamberPresets,
  entrants,
  humanTable,
  MAX_CHAMBER_PLAYERS,
  MIN_CHAMBER_PLAYERS,
  SIM_REPORTER,
} from './chamber';
import { buildMeta } from './meta';
import { buildRecap } from './recap';
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
  /** Sala do Tempo: o treino contra o bot do servidor está ligado (ONLINE_BOT_ROOMS); sem ele, a sala não abre. */
  botRooms?: boolean;
  /** Sala do Tempo: os presets dos eventos (`data/chamber`; os testes passam outra pasta). */
  chamberPresets?: ChamberPresets;
}

export const MAX_PLAYERS = 256;
const MAX_SWISS_ROUNDS = 15;
/** Teto do limite de warnings por jogador. */
export const MAX_WARNINGS = 10;
/** Tamanho do motivo de um warning e da nota do Judge. */
const REASON_MAX = 300;
/** Tamanhos aceitos do top cut e das fases da eliminatória (vagas). */
const CUT_SIZES = [2, 4, 8, 16, 32, 64];
const PHASE_SIZES = [2, 4, 8, 16, 32, 64, 128, 256];

type Body = {
  name?: unknown;
  description?: unknown;
  /** Standard, EGB ou Livre (vale tudo, inclusive as banidas). */
  format?: unknown;
  /** Aceita cartas de spoiler (Standard ou EGB + spoilers; o Livre sempre aceita). */
  spoilers?: unknown;
  /** Quem transmite vê as mãos dos jogadores ao vivo (sem o atraso mínimo). */
  liveHands?: unknown;
  structure?: unknown;
  rounds?: unknown;
  swissBestOf?: unknown;
  topCut?: unknown;
  bo3From?: unknown;
  bo5From?: unknown;
  maxPlayers?: unknown;
  startsAt?: unknown;
  checkIn?: unknown;
  /** Com check-in: o torneio começa sozinho na hora marcada. */
  autoStart?: unknown;
  /** Warnings até o organizador decidir a eliminação (1 a 10; vazio = sem regra). */
  maxWarnings?: unknown;
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
  if (!isPlayFormat(b.format)) return fail('invalidFormat', 'Formato inválido.');
  const { format, spoilers } = playMode(b.format, b.spoilers === true);
  const liveHands = b.liveHands === true;
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
  const autoStart = checkIn && Boolean(b.autoStart);
  const maxWarnings = int(b.maxWarnings);
  if (maxWarnings !== null && (!Number.isInteger(maxWarnings) || maxWarnings < 1 || maxWarnings > MAX_WARNINGS)) {
    return fail('invalidMaxWarnings', `Limite de warnings inválido (1 a ${MAX_WARNINGS}, ou vazio).`, { max: MAX_WARNINGS });
  }
  const toleranceMin = int(b.toleranceMin) ?? DEFAULT_TOLERANCE_MIN;
  if (!Number.isInteger(toleranceMin) || toleranceMin < MIN_TOLERANCE_MIN || toleranceMin > MAX_TOLERANCE_MIN) {
    return fail('invalidTolerance', `Tolerância inválida (${MIN_TOLERANCE_MIN} a ${MAX_TOLERANCE_MIN} minutos).`, { min: MIN_TOLERANCE_MIN, max: MAX_TOLERANCE_MIN });
  }
  return {
    name,
    description,
    format,
    spoilers,
    liveHands,
    structure: b.structure,
    rounds,
    swissBestOf,
    topCut,
    bo3From,
    bo5From,
    maxPlayers,
    startsAt,
    checkIn,
    autoStart,
    maxWarnings,
    toleranceMin,
    official: Boolean(b.official),
    prize: typeof b.prize === 'string' && b.prize.trim() ? b.prize.trim().replace(/\s+/g, ' ').slice(0, 200) : null,
    sponsorId: typeof b.sponsorId === 'string' && b.sponsorId.trim() ? b.sponsorId.trim().slice(0, 40) : null,
    priorityUntil: null,
    priority: Boolean(b.official) && Boolean(b.priority),
  };
}

type PrizeBody = { place?: unknown; title?: unknown; url?: unknown; image?: unknown };

/** Valida um item da premiação: o que é (obrigatório), a colocação e o link do produto. */
function parsePrize(b: PrizeBody | undefined): PrizeInput | PlayerError {
  if (!b || typeof b !== 'object') return fail('invalidBody', 'Corpo inválido.');
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
  const title = clean(b.title, 120);
  if (!title) return fail('prizeTitleRequired', 'Diga qual é o prêmio.');
  const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim().slice(0, 500) : null;
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return fail('prizeUrlInvalid', 'O link do produto precisa começar com http:// ou https://.');
  return { place: clean(b.place, 40), title, url };
}

/**
 * Foto do prêmio no corpo: `undefined` = não mexe; null = apaga; texto = PNG, JPEG ou WebP
 * em base64 (ou data URL), conferida pelos primeiros bytes.
 */
function parsePrizeImage(raw: unknown): { data: Buffer; type: string } | null | undefined | PlayerError {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== 'string') return fail('prizeImageType', 'Use uma foto PNG, JPEG ou WebP.');
  const data = Buffer.from(raw.replace(/^data:[^,]*,/, ''), 'base64');
  if (data.length > MAX_PRIZE_IMAGE_BYTES) {
    const kb = Math.round(MAX_PRIZE_IMAGE_BYTES / 1024);
    return fail('prizeImageSize', `A foto pode ter até ${kb} KB.`, { kb });
  }
  const type = imageType(data);
  return type ? { data, type } : fail('prizeImageType', 'Use uma foto PNG, JPEG ou WebP.');
}

/** O que a página do torneio mostra de um prêmio. */
const publicPrize = (tournamentId: string, p: TournamentPrize) => ({
  id: p.id,
  place: p.place,
  title: p.title,
  url: p.url,
  imageUrl: p.imageType ? `/api/tournaments/${encodeURIComponent(tournamentId)}/prizes/${p.id}/image?v=${p.imageVersion}` : null,
});

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
const lateWindow = (t: Tournament) =>
  t.status === 'running' && t.structure === 'swiss' && t.round === 1 && (t.rounds ?? 0) >= 2 && t.chamber === null;

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
/** Validade do painel do meta em cache (cada torneio alterado já o invalida). */
const META_TTL_MS = 60_000;

export function registerTournamentRoutes(
  app: FastifyInstance,
  { db, user, present, lobby, cardImages, now = Date.now, tickMs = 5_000, notifier = noNotifier, botRooms = true, chamberPresets = new ChamberPresets() }: Deps,
) {
  const cache = new ResponseCache();
  const nowIso = () => new Date(now()).toISOString();
  /** Sala do Tempo: inscritos e virtuais juntos (nos torneios comuns, só os inscritos). */
  const entrantsOf = (t: Tournament, players: TournamentPlayer[]): ChamberEntrant[] => entrants(db, t, players);
  /** O preset da Sala do Tempo, ou null (torneio comum ou preset apagado da pasta). */
  const presetOf = (t: Tournament): ChamberPreset | null => (t.chamber ? chamberPresets.get(t.chamber) : null);

  /**
   * Data em que os decks do torneio precisam valer: o início marcado, se ainda não chegou.
   * Assim um banimento com data anterior ao torneio já barra a inscrição.
   */
  const legalAt = (t: Pick<Tournament, 'startsAt'>) => new Date(Math.max(now(), t.startsAt ? Date.parse(t.startsAt) : 0));
  /** Data e hora de Brasília, para as mensagens em português. */
  const brDate = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const issueOut = (i: FormatIssue | null) => (i ? { message: i.message, code: i.code, params: i.params } : null);
  /** Aviso de torneio para uma conta (tocar abre a página do torneio, ou `url`). Avisos novos do mesmo torneio substituem os antigos. */
  const tournamentNotice = (t: Tournament, userId: string, body: (locale: string) => string, ttl: number, url?: string) =>
    isVirtualId(userId) ||
    void notifier.notify(
      { userIds: [userId] },
      {
        category: 'tournaments',
        text: (locale) => ({ title: t.name, body: body(locale) }),
        tag: `tour-${t.id}`,
        url: url ?? `/?torneio=${encodeURIComponent(t.id)}`,
        ttl,
        urgency: 'high',
      },
    );

  /** Quem recebe os chamados de Judge: os Judges da lista e sempre o organizador. */
  const judgeIds = (t: Tournament) => [...new Set([t.organizerId, ...listJudges(db, t.id).map((j) => j.userId)])];

  /**
   * Rodada nova (`started` = já iniciada): cada jogador recebe o nome do oponente (ou o aviso de
   * bye) e, com a rodada iniciada e W.O. automático, o prazo para entrar.
   */
  const notifyRound = (id: string, started: boolean) => {
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
            const key = started ? (t.checkIn ? 'roundStartDeadlineBody' : 'roundStartBody') : 'roundBody';
            return pushText(locale, key, { round: label, opponent: name(opp), minutes: t.toleranceMin });
          },
          started && t.checkIn ? toleranceMs(t) / 1000 : 3600,
        );
      }
    }
  };

  /** A rodada começou: só quem tem partida pendente (sem resultado, com oponente) é avisado. */
  const notifyRoundStart = (id: string) => {
    const t = getTournament(db, id);
    if (!t || t.status !== 'running') return;
    const players = listPlayers(db, t.id);
    const name = (userId: string) => players.find((p) => p.userId === userId)?.name ?? '?';
    const round = listMatches(db, t.id).filter((m) => m.round === t.round);
    for (const m of round) {
      if (!m.p2 || m.result) continue;
      for (const [me, opp] of [
        [m.p1, m.p2],
        [m.p2, m.p1],
      ] as const) {
        tournamentNotice(
          t,
          me,
          (locale) =>
            pushText(locale, t.checkIn ? 'roundStartDeadlineBody' : 'roundStartBody', {
              round: roundName(locale, m.stage, m.round, round.length),
              opponent: name(opp),
              minutes: t.toleranceMin,
            }),
          t.checkIn ? toleranceMs(t) / 1000 : 3600,
        );
      }
    }
  };

  /** Os motivos que seguram a próxima rodada, em texto, para o aviso ao organizador e aos Judges. */
  const holdReasons = (locale: string, hold: AutoHold) =>
    [
      ...(hold.reports ? [pushText(locale, 'holdReports', { n: hold.reports })] : []),
      ...(hold.calls ? [pushText(locale, 'holdCalls', { n: hold.calls })] : []),
      ...(hold.warnings.length ? [pushText(locale, 'holdWarnings', { names: hold.warnings.join(', ') })] : []),
    ].join('; ');

  /** Início automático: a rodada terminou, mas a próxima ficou à espera; o organizador e os Judges são avisados. */
  const notifyHold = (id: string, round: number, hold: AutoHold) => {
    const t = getTournament(db, id);
    if (!t || t.status !== 'running') return;
    const matches = listMatches(db, t.id).filter((m) => m.round === round);
    const stage = matches[0]?.stage ?? 'swiss';
    for (const userId of judgeIds(t)) {
      tournamentNotice(t, userId, (locale) => pushText(locale, 'autoNextHoldBody', { round: roundName(locale, stage, round, matches.length), reasons: holdReasons(locale, hold) }), 3600);
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
      for (const { tournamentId, userIds } of r.removed) {
        app.log.info(`torneio ${tournamentId}: inscrição cancelada no início (deck não vale mais no formato): ${userIds.join(', ')}`);
        const t = getTournament(db, tournamentId);
        if (t) for (const id of userIds) tournamentNotice(t, id, (locale) => pushText(locale, 'deckRemovedBody'), 3_600);
      }
      for (const id of r.started) {
        app.log.info(`torneio ${id}: começou sozinho na hora marcada`);
        notifyRound(id, true);
      }
      for (const w of r.noShows) app.log.info(`torneio ${w.tournamentId}: W.O. na partida ${w.matchId} (${w.absent.join(', ')} ausente)`);
      for (const a of r.advanced) {
        if (a.finished) app.log.info(`torneio ${a.tournamentId}: encerrado sozinho (última rodada completa)`);
        else {
          app.log.info(`torneio ${a.tournamentId}: rodada ${a.round} gerada e iniciada sozinha (${a.step})`);
          notifyRound(a.tournamentId, true);
        }
      }
      for (const h of r.held) {
        app.log.info(`torneio ${h.tournamentId}: rodada ${h.round} completa, a próxima espera (relatos: ${h.hold.reports}, chamados: ${h.hold.calls}, warnings: ${h.hold.warnings.join(', ') || '-'})`);
        notifyHold(h.tournamentId, h.round, h.hold);
      }
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
  // (mesmo que o plano vença depois, para não deixar o torneio sem dono). A Sala do Tempo é de quem a abriu.
  const canManage = (t: Tournament, u: User | null) =>
    Boolean(u && (isAdmin(u.role) || (u.id === t.organizerId && (createsTournaments(u.role) || t.quota || t.chamber !== null))));

  /** Judge do torneio: a lista do organizador, o próprio organizador e quem administra. */
  const isJudge = (t: Tournament, u: User | null) => Boolean(u && (canManage(t, u) || actsAsJudge(db, t, u)));

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

  /** Torneio em que a conta logada é Judge (ou organizador/admin), ou responde 401/403/404. */
  const judged = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): { t: Tournament; me: User } | null => {
    const me = account(req, reply);
    if (!me) return null;
    const t = getTournament(db, req.params.id);
    if (!t) {
      void reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
      return null;
    }
    if (!isJudge(t, me)) {
      void reply.code(403).send(fail('judgeForbidden', 'Só o Judge ou o organizador deste torneio pode fazer isso.'));
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
      spoilers: t.spoilers,
      spoilerSet: tournamentSpoilerSet(db, t),
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
      autoStart: t.autoStart,
      checkInOpensAt: checkInOpensAt(t),
      organizerName: t.organizerName,
      registered: mine.has(t.id),
      official: t.official,
      prize: t.prize,
      sponsor: sponsorOf(t.sponsorId),
      priorityUntil: t.priorityUntil,
      /** Sala do Tempo (torneio simulado do Time): o tamanho do evento simulado. */
      chamber: t.chamber !== null,
      chamberSize: t.chamberSize,
    };
  };

  app.get('/api/tournaments', async (req) => {
    const u = user(req);
    const mine = u ? tournamentsOf(db, u.id) : new Set<string>();
    const limits = organizeLimits(u);
    // A Sala do Tempo só aparece para quem é do Time (a página de cada uma continua pública pelo link).
    const team = isTeam(u);
    return {
      tournaments: listTournaments(db)
        .filter((t) => team || t.chamber === null)
        .map((t) => summary(t, mine)),
      canCreate: Boolean(limits && (limits.perMonth === null || limits.used < limits.perMonth)),
      /** Limites de quem pede (null = não organiza): a tela mostra "3 de 5 este mês". */
      organize: limits,
      /** Quem é do Time abre a Sala do Tempo (com o treino contra o bot do servidor ligado). */
      canChamber: team && botRooms,
    };
  });


  /**
   * Painel do meta: torneios encerrados (no formato e nos últimos `days` dias, se pedidos),
   * Líderes, campeões e o ranking de jogadores. Público: usa só o que a página de cada
   * torneio já mostra depois do fim.
   */
  app.get<{ Querystring: { format?: string; days?: string } }>('/api/tournaments/meta', async (req, reply) => {
    const format = isFormat(req.query.format) ? req.query.format : undefined;
    const days = Number(req.query.days);
    const period = Number.isInteger(days) && days > 0 && days <= 3650 ? days : undefined;
    return cache.send(req, reply, `meta:${format ?? '-'}:${period ?? '-'}`, META_TTL_MS, () =>
      buildMeta(db, { format, days: period, now: now(), present }),
    );
  });

  /** Leituras do torneio que não dependem de quem pede. */
  const detailData = (t: Tournament) => {
    const players = listPlayers(db, t.id);
    /** Sala do Tempo: inscritos e virtuais (o pareamento, a classificação e os nomes das mesas valem para todos). */
    const all = entrantsOf(t, players);
    const matches = listMatches(db, t.id);
    const gamesByMatch = new Map<number, TournamentGame[]>();
    for (const g of listGames(db, t.id)) {
      const list = gamesByMatch.get(g.matchId);
      if (list) list.push(g);
      else gamesByMatch.set(g.matchId, [g]);
    }
    const warningsByUser = new Map<string, TournamentWarning[]>();
    for (const w of listWarnings(db, t.id)) {
      const list = warningsByUser.get(w.userId);
      if (list) list.push(w);
      else warningsByUser.set(w.userId, [w]);
    }
    const calls = listCalls(db, t.id);
    return {
      t,
      players,
      matches,
      gamesByMatch,
      warningsByUser,
      calls,
      /** Chamado de Judge aberto de cada partida. */
      openCallByMatch: calls.reduce((map, c) => (c.resolvedAt || map.has(c.matchId) ? map : map.set(c.matchId, c)), new Map<number, TournamentCall>()),
      judges: listJudges(db, t.id),
      tiers: supporterTiers(db, players.map((p) => p.userId)),
      name: new Map(all.map((p) => [p.userId, p.name])),
      all,
      /** Sala do Tempo: o Líder de cada um (humano ou virtual), para as mesas e a classificação. */
      leaderOf: new Map(all.map((p) => [p.userId, p.deck.leader])),
      leaderCards: t.chamber ? new Map(present(getCards(db, [...new Set(all.map((p) => p.deck.leader))])).map((c) => [c.id, c] as const)) : null,
    };
  };
  type DetailData = ReturnType<typeof detailData>;
  /** Quem pede o torneio. `manage`/`judge` falsos com `u` qualquer = a mesma visão de quem não entrou, salvo o que é da própria conta. */
  interface DetailViewer {
    u: User | null;
    manage: boolean;
    judge: boolean;
  }
  const viewerOf = (t: Tournament, u: User | null): DetailViewer => ({ u, manage: canManage(t, u), judge: isJudge(t, u) });

  const judgeNameIn = (d: DetailData, id: string) =>
    id === d.t.organizerId ? (d.t.organizerName ?? '?') : (d.judges.find((j) => j.userId === id)?.name ?? findPlayer(db, accountOwnerKey(id))?.name ?? '?');
  /** Líder de um jogador para a Sala do Tempo (os Líderes são públicos assim que o torneio começa). */
  const leaderRef = (d: DetailData, id: string) => {
    if (!d.leaderCards) return {};
    const leader = d.leaderOf.get(id);
    const card = leader ? d.leaderCards.get(leader) : undefined;
    return { leader: leader ?? null, leaderName: card?.name ?? null, leaderImage: (cardImages && card && artImage(card, undefined)) || null, colors: card?.colors ?? [] };
  };
  const refIn = (d: DetailData, id: string | null) =>
    id ? { userId: id, name: d.name.get(id) ?? '?', ...(d.t.chamber ? { virtual: isVirtualId(id), ...leaderRef(d, id) } : {}) } : null;
  // Nas inscrições, só o organizador e o próprio jogador veem qual deck (Líder) cada
  // um inscreveu: o deck e a lista ficam congelados quando o torneio começa, e é aí
  // que o Líder aparece para todos (ninguém escolhe o deck olhando os dos outros).
  // As listas completas ficam escondidas até o fim (só o organizador e o próprio jogador as veem).
  const showLeaderTo = (d: DetailData, v: DetailViewer, userId: string) => v.manage || d.t.status !== 'registration' || userId === v.u?.id;
  const showDeckTo = (d: DetailData, v: DetailViewer, userId: string) => v.manage || d.t.status === 'finished' || userId === v.u?.id;
  /** Cartas (Líder e lista) que `v` vê destes inscritos. */
  const detailCards = (d: DetailData, v: DetailViewer, players: TournamentPlayer[]) => {
    const ids = players.flatMap((p) => [
      ...(showLeaderTo(d, v, p.userId) ? [p.deck.leader] : []),
      ...(showDeckTo(d, v, p.userId) ? p.deck.cards.map((c) => c.id) : []),
    ]);
    return new Map(present(getCards(db, [...new Set(ids)])).map((c) => [c.id, c] as const));
  };

  /** Uma partida da lista de rodadas. */
  const matchEntry = (d: DetailData, v: DetailViewer, m: TournamentMatch) => {
    const { t, players } = d;
    const absent = absentSides(t, m, players);
    /**
     * O replay de cada jogo (com as duas listas): para quem audita e, quando o torneio
     * termina, para os dois jogadores (até lá, as listas ficam fechadas).
     */
    const seesReplays = v.manage || v.judge || (t.status === 'finished' && (m.p1 === v.u?.id || m.p2 === v.u?.id));
    const call = d.openCallByMatch.get(m.id) ?? null;
    return {
      id: m.id,
      table: m.table,
      p1: refIn(d, m.p1)!,
      p2: refIn(d, m.p2),
      bestOf: m.bestOf,
      wins: m.wins,
      result: m.result,
      winner: winnerOf(m),
      /** Quem lançou: game (salas online), bye, drop (desistência), noshow (W.O. automático), late (inscrição atrasada), sim (mesa estatística) ou organizer. */
      reportedBy: m.reportedBy === null || ['game', 'bye', 'drop', 'noshow', 'late', SIM_REPORTER].includes(m.reportedBy) ? m.reportedBy : 'organizer',
      roomId: m.roomId,
      room: m.roomId ? (lobby.get(m.roomId)?.status ?? null) : null,
      /** Jogo da série em disputa agora (1, 2, 3…). */
      game: m.wins[0] + m.wins[1] + 1,
      /** Cada jogador já entrou na sala desta série (ou, na rodada 1, fez check-in). O virtual está sempre presente. */
      present: m.p2 ? [!absent.includes('p1') || isVirtualId(m.p1), !absent.includes('p2') || isVirtualId(m.p2)] : [true, false],
      /** "Estou pronto" de cada jogador (antes de a rodada começar). O virtual está sempre pronto. */
      ready: [m.ready[0] || isVirtualId(m.p1), m.ready[1] || isVirtualId(m.p2)],
      /** Chamado de Judge aberto: a sala está pausada à espera dele. */
      call: call ? { id: call.id, openedAt: call.openedAt, byName: d.name.get(call.openedBy) ?? judgeNameIn(d, call.openedBy) } : null,
      /** Jogos disputados nas salas desta série (auditoria): todos ficam gravados, com o replay. */
      games: (d.gamesByMatch.get(m.id) ?? []).map((g) => ({
        game: g.game,
        winner: refIn(d, g.winner),
        counted: g.counted,
        playedAt: g.playedAt,
        statsMatchId: seesReplays ? g.statsMatchId : null,
      })),
    };
  };

  /**
   * Rodadas (sem as partidas) e as partidas de cada uma, na ordem da lista. Na Sala do Tempo só as mesas
   * com humano vão na lista (as outras centenas são um passo estatístico: a rodada diz quantas foram).
   */
  const detailRounds = (d: DetailData) => {
    const byRound = Array.from({ length: d.t.round }, () => [] as TournamentMatch[]);
    for (const m of d.matches) byRound[m.round - 1]?.push(m);
    return byRound.map((ms, i) => ({
      head: {
        round: i + 1,
        stage: ms[0]?.stage ?? 'swiss',
        label: roundLabel(d.matches, i + 1),
        bestOf: ms[0]?.bestOf ?? 1,
        /** Mesas da rodada (todas, inclusive as só de virtuais) e quantas foram decididas no sorteio. */
        tables: ms.length,
        virtualTables: d.t.chamber ? ms.filter((m) => !humanTable(m)).length : 0,
      },
      matches: d.t.chamber ? ms.filter(humanTable) : ms,
    }));
  };


  /** Warnings de um inscrito: a contagem é pública; os motivos, só para o Judge, o organizador e o próprio jogador. */
  const warningsEntry = (d: DetailData, v: DetailViewer, p: TournamentPlayer) => {
    const { t } = d;
    const mine = d.warningsByUser.get(p.userId) ?? [];
    const st = warningStatus(t, p, mine);
    const detailed = v.manage || v.judge || p.userId === v.u?.id;
    return {
      count: st.count,
      max: t.maxWarnings,
      limitReached: st.limitReached,
      /** Para quem gerencia: o jogador atingiu o limite e falta decidir (manter ou eliminar). */
      pending: v.manage || v.judge ? st.pending : false,
      list: detailed
        ? mine.map((w) => ({
            id: w.id,
            reason: w.reason,
            givenAt: w.givenAt,
            round: w.round,
            byName: judgeNameIn(d, w.givenBy),
            revoked: Boolean(w.revokedAt),
          }))
        : null,
    };
  };

  /** Um inscrito da lista de jogadores. */
  const playerEntry = (d: DetailData, v: DetailViewer, cards: Map<string, ApiCard>, p: TournamentPlayer) => {
    const { t } = d;
    const showLeader = showLeaderTo(d, v, p.userId);
    const leader = showLeader ? cards.get(p.deck.leader) : undefined;
    const reinstate = () => {
      if (!v.manage || t.status !== 'running') return null;
      const r = reinstateOptions(t, d.players, d.matches, p.userId);
      return 'code' in r ? null : r.restore;
    };
    return {
      userId: p.userId,
      name: p.name,
      /** Plano de apoio ativo (selo ao lado do nome). */
      supporter: d.tiers.get(p.userId) ?? null,
      seed: t.status === 'registration' ? null : p.seed,
      dropped: p.dropped,
      /** Para quem gerencia: o jogador que saiu pode voltar (e se a partida da rodada pode ou precisa ser devolvida). */
      reinstate: p.dropped ? reinstate() : null,
      checkedIn: Boolean(p.checkedInAt),
      warnings: warningsEntry(d, v, p),
      /** Líder do deck: null enquanto as inscrições estão abertas (só o organizador e o próprio jogador o veem). */
      leader: showLeader ? p.deck.leader : null,
      leaderName: leader?.name ?? null,
      leaderImage: (cardImages && leader && artImage(leader, p.deck.arts?.[leader.id])) || null,
      colors: leader?.colors ?? [],
      deck: showDeckTo(d, v, p.userId)
        ? { name: p.deck.name, leader: p.deck.leader, cards: p.deck.cards.map((c) => ({ ...c, name: cards.get(c.id)?.name ?? null })) }
        : null,
    };
  };

  /** O que é só da conta que pede (fora da lista de jogadores e das rodadas). */
  const personalFields = (d: DetailData, v: DetailViewer) => {
    const { t, players, matches, judges } = d;
    const u = v.u;
    const me = u ? players.find((p) => p.userId === u.id) : undefined;
    const current = me && t.status === 'running' ? matches.find((m) => m.round === t.round && (m.p1 === me.userId || m.p2 === me.userId)) : undefined;
    return {
      /** Limite de jogadores dos torneios da cota de apoiador (para o formulário de edição). */
      maxPlayersCap: t.quota && !isAdmin(u?.role) && !createsTournaments(u?.role) ? SUPPORTER_MAX_PLAYERS : MAX_PLAYERS,
      canRegister: canRegisterNow(t, u) || Boolean(u && t.status === 'registration' && players.some((p) => p.userId === u.id) && !judges.some((j) => j.userId === u.id)),
      /** Inscrição atrasada liberada para quem pede (entra na rodada 2 com uma derrota). */
      canLateRegister: !me && lateAllowed(t, u),
      me: me
        ? {
            deckId: me.deckId,
            deckName: me.deck.name,
            leader: me.deck.leader,
            dropped: me.dropped,
            matchId: current?.id ?? null,
            /** "Estou pronto" na partida da rodada. */
            ready: current ? current.ready[current.p1 === me.userId ? 0 : 1] : false,
            checkedInAt: me.checkedInAt,
            warnings: warningsEntry(d, v, me),
            /** Antes do início: por que a lista inscrita não vai valer no torneio (null = vale). */
            deckIssue: t.status === 'registration' ? issueOut(deckIssue(db, me.deck, t, legalAt(t))) : null,
          }
        : null,
    };
  };

  /**
   * Classificação apresentada. Sala do Tempo: dos centenas de jogadores, só os 32 primeiros, os humanos,
   * os oponentes deles e os vizinhos de cada humano (a posição de cada um continua a do evento inteiro).
   */
  const standingsOut = (d: DetailData) => {
    const { t, matches, all, name } = d;
    if (t.status === 'registration') return [];
    const table = standings(all, matches);
    const entry = (s: (typeof table)[number]) => ({ ...s, name: name.get(s.userId) ?? '?', ...(t.chamber ? { virtual: isVirtualId(s.userId), ...leaderRef(d, s.userId) } : {}) });
    if (!t.chamber) return table.map(entry);
    const keep = new Set<string>();
    const humans = new Set(all.filter((p) => !p.virtual).map((p) => p.userId));
    for (const m of matches) {
      if (humans.has(m.p1) && m.p2) keep.add(m.p2);
      if (m.p2 && humans.has(m.p2)) keep.add(m.p1);
    }
    table.forEach((s, i) => {
      if (humans.has(s.userId)) for (const j of [i - 1, i, i + 1]) if (table[j]) keep.add(table[j].userId);
    });
    return table.filter((s, i) => i < 32 || keep.has(s.userId)).map(entry);
  };

  /** Sala do Tempo: o evento simulado (preset, distribuição dos Líderes com o deck que o bot joga por cada um, virtuais vivos). */
  const chamberFields = (d: DetailData) => {
    const { t, all } = d;
    if (!t.chamber) return null;
    const preset = presetOf(t);
    const virtuals = all.filter((p) => p.virtual);
    const decks = preset ? chamberDecks(db, preset, t, legalAt(t)) : null;
    // As cartas dos Líderes do preset (antes do início nenhum virtual existe ainda) e dos virtuais sorteados.
    const presetCards = new Map(present(getCards(db, [...new Set((decks?.leaders ?? []).map((l) => l.leader))])).map((c) => [c.id, c] as const));
    const card = (leader: string) => presetCards.get(leader) ?? d.leaderCards?.get(leader);
    const counts = new Map<string, number>();
    for (const v of virtuals) counts.set(v.deck.leader, (counts.get(v.deck.leader) ?? 0) + 1);
    const listed = new Set(decks?.leaders.map((l) => l.leader) ?? []);
    return {
      preset: t.chamber,
      presetName: preset?.name ?? t.chamber,
      description: preset?.description ?? '',
      /** O preset sumiu da pasta: a sala ainda não iniciada não pode começar. */
      presetMissing: preset === null,
      size: t.chamberSize,
      virtuals: virtuals.length,
      /** O treino contra o bot do servidor está ligado (sem ele, as mesas contra os virtuais não abrem). */
      botRooms,
      /** Decks prontos válidos no formato entre os quais a fatia "outros" sorteia. */
      otherDecks: decks?.others.length ?? 0,
      leaders: (decks?.leaders ?? []).map((l) => ({

        leader: l.leader,
        leaderName: card(l.leader)?.name ?? null,
        leaderImage: (cardImages && card(l.leader) && artImage(card(l.leader)!, undefined)) || null,
        colors: card(l.leader)?.colors ?? [],
        share: l.share,
        deckId: l.deckId,
        deckName: l.deckName,
        meta: l.meta,
        /** Virtuais com este Líder (depois do início). */
        count: counts.get(l.leader) ?? 0,
      })),
      /** Virtuais fora da distribuição do preset ("outros": decks prontos sorteados), por Líder. */
      others: [...counts]
        .filter(([leader]) => !listed.has(leader))
        .map(([leader, count]) => ({ leader, leaderName: card(leader)?.name ?? null, colors: card(leader)?.colors ?? [], count }))
        .sort((a, b) => b.count - a.count),
    };
  };

  /** O resto do torneio: igual para todos os que não gerenciam nem são Judge. */
  const commonFields = (d: DetailData, v: DetailViewer) => {
    const { t, players, matches, judges, calls, name, all } = d;
    const manage = v.manage;
    const judge = v.judge;
    const lateName = t.lateEntry && t.lateEntry !== '*' ? (findPlayer(db, accountOwnerKey(t.lateEntry))?.name ?? '?') : null;
    const currentRound = matches.filter((m) => m.round === t.round);
    // Sala do Tempo: as mesas que faltam são as com humano (as só de virtuais já saíram decididas).
    const tables = currentRound.filter((m) => m.p2 && !m.result && humanTable(m));
    const pending = manage || judge ? pendingWarnings(db, t, players) : [];
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
      spoilers: t.spoilers,
      /** Com spoilers, a coleção aceita ("Standard + EB05"); null = sem spoilers, Livre ou não se sabe. */
      spoilerSet: tournamentSpoilerSet(db, t),
      structure: t.structure,
      swissBestOf: t.swissBestOf,
      topCut: t.topCut,
      bo3From: t.bo3From,
      bo5From: t.bo5From,
      status: t.status,
      round: t.round,
      /** Fase da rodada atual. */
      stage: currentRound[0]?.stage ?? null,
      /** Rodadas previstas (suíço + top cut, ou a chave). Sala do Tempo: pelo tamanho do evento. */
      totalRounds: plannedRounds(t, t.chamber ? (t.chamberSize ?? all.length) : players.length),
      /** Rodadas do suíço (só no suíço). */
      swissRounds: t.structure === 'swiss' ? (t.rounds ?? swissRounds(t.chamber ? (t.chamberSize ?? all.length) : players.length)) : null,
      roundsAuto: t.rounds === null,
      /** Relógio de cada jogador em cada jogo: quem zera o tempo perde. */
      clockMs: TIME_BANK_MS,
      maxPlayers: t.maxPlayers,
      startsAt: t.startsAt,
      /** Torneio com hora marcada: check-in, início automático (opção) e W.O. por ausência. */
      checkIn: t.checkIn,
      autoStart: t.autoStart,
      /** Warnings até o organizador decidir a eliminação (null = sem regra). */
      maxWarnings: t.maxWarnings,
      /** Quem transmite vê as mãos dos jogadores ao vivo, sem o atraso mínimo. */
      liveHands: t.liveHands,
      checkInMs: CHECK_IN_MS,
      toleranceMin: t.toleranceMin,
      toleranceMs: toleranceMs(t),
      checkInOpensAt: checkInOpensAt(t),
      checkInOpen: checkInOpen(t, now()),
      checkedIn: players.filter((p) => p.checkedInAt).length,
      /** Prazo para entrar na sala na rodada atual (null = sem tolerância correndo). */
      roundAt: t.roundAt,
      /** A rodada atual foi iniciada pelo organizador (as salas estão abertas); null = pareamentos à espera do início. */
      roundStartedAt: t.roundStartedAt,
      /** Mesas da rodada atual ainda por jogar e quantas têm os dois jogadores prontos (o virtual está sempre pronto). */
      tables: tables.length,
      readyTables: tables.filter((m) => (m.ready[0] || isVirtualId(m.p1)) && (m.ready[1] || isVirtualId(m.p2))).length,
      deadline: roundDeadline(t),
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      organizerName: t.organizerName,
      official: t.official,
      prize: t.prize,
      sponsor: sponsorOf(t.sponsorId),
      /** Premiação apresentada pelo organizador (colocação, prêmio, link do produto e foto). */
      prizes: listPrizes(db, t.id).map((p) => publicPrize(t.id, p)),
      maxPrizes: MAX_PRIZES,
      /** Inscrição antecipada: até esta hora só Almirantes se inscrevem. */
      priorityUntil: t.priorityUntil,
      priorityOpen: priorityOpen(t),
      canManage: manage,
      /** Quem pede é Judge deste torneio (ou organizador/admin): entra nas salas vendo as mãos, retoma partidas e dá warnings. */
      isJudge: judge,
      /** Judges escolhidos pelo organizador (sem nenhum, o organizador é o Judge). */
      judges: judges.map((j) => ({ userId: j.userId, name: j.name })),
      /** Para quem gerencia: jogadores que atingiram o limite de warnings e esperam a decisão (a próxima rodada fica travada). */
      warningsPending: pending.map((p) => ({ userId: p.userId, name: p.name })),
      /** Chamados de Judge abertos agora (salas pausadas), para o Judge e o organizador. */
      openCalls: judge
        ? calls
            .filter((c) => !c.resolvedAt)
            .map((c) => {
              const m = matches.find((x) => x.id === c.matchId);
              return { id: c.id, matchId: c.matchId, table: m?.table ?? 0, roomId: c.roomId, openedAt: c.openedAt, names: m ? [name.get(m.p1) ?? '?', name.get(m.p2 ?? '') ?? '?'] : [] };
            })
        : [],
      /** Para quem gerencia: a janela da inscrição atrasada está aberta (suíço, rodada 1) e a quem ela foi liberada. */
      lateWindow: manage && lateWindow(t),
      lateEntry: manage && lateWindow(t) && t.lateEntry ? { all: t.lateEntry === '*', name: lateName } : null,
      /** Para quem gerencia, antes do início: inscritos cujo deck não vai valer no torneio. */
      staleDecks: manage && t.status === 'registration' ? staleDecks(db, t, players, legalAt(t)).map((p) => p.name) : [],
      standings: standingsOut(d),
      /** Jogadores classificados (Sala do Tempo: a lista acima é um recorte). */
      standingsTotal: t.status === 'registration' ? 0 : all.length,
      roundComplete: t.status === 'running' && roundComplete(t, matches),
      /** O que o botão de avançar faz agora. */
      next: t.status === 'running' ? nextStep(t, all, matches) : null,
      /** Sala do Tempo (torneio simulado do Time); null nos torneios comuns. */
      chamber: chamberFields(d),

      /** Relatos abertos dos jogadores (só para quem gerencia; a lista vem de GET /api/reports?tournament=). */
      openReports: manage ? listReports(db, { tournamentId: t.id, status: 'open' }).length : 0,
      /**
       * Início automático, para o Judge e o organizador: o que segura a próxima rodada quando esta terminar
       * (relatos não resolvidos, chamados de Judge abertos, warnings à espera); null = nada segura, ou sem início automático.
       */
      autoNextHold: judge && t.autoStart && t.status === 'running' ? autoNextHold(db, t, players) : null,
    };
  };

  /** Torneio completo: inscritos, rodadas, classificação e o que quem pede pode fazer. */
  const detail = (t: Tournament, u: User | null) => {
    const d = detailData(t);
    const v = viewerOf(t, u);
    const cards = detailCards(d, v, d.players);
    return {
      ...commonFields(d, v),
      ...personalFields(d, v),
      players: d.players.map((p) => playerEntry(d, v, cards, p)),
      rounds: detailRounds(d).map((r) => ({ ...r.head, matches: r.matches.map((m) => matchEntry(d, v, m)) })),
    };
  };
  // Exposto para os testes (o caminho comum de GET /api/tournaments/:id tem de dar o mesmo).
  app.decorate('tournamentDetail', (id: string, u: User | null) => detail(getTournament(db, id)!, u));

  /**
   * Parte comum do torneio para quem não gerencia nem é Judge (quase todos os que consultam):
   * montada e serializada uma vez por torneio e versão dos dados, e não uma vez por jogador.
   * Cada jogador e cada partida ficam em JSON à parte para trocar só o que é da conta que pede
   * (o próprio deck e, no fim, os replays das próprias partidas). `tag`: hash do conteúdo, para o ETag.
   */
  interface SharedDetail {
    version: number;
    at: number;
    data: DetailData;
    common: string;
    players: string[];
    playerIndex: Map<string, number>;
    rounds: Array<{ head: string; matches: string[] }>;
    /** Posição de cada partida em `rounds` ([rodada, partida]). */
    matchPos: Map<number, [number, number]>;
    tag: string;
  }
  const sharedDetails = new Map<string, SharedDetail>();
  const sha1 = (s: string) => createHash('sha1').update(s).digest('base64url');
  const sharedDetail = (t: Tournament, key: string): SharedDetail => {
    const hit = sharedDetails.get(key);
    const at = now();
    if (hit && hit.version === dataVersion.current && at - hit.at < DETAIL_TTL_MS) return hit;
    const version = dataVersion.current;
    const d = detailData(t);
    const v: DetailViewer = { u: null, manage: false, judge: false };
    const cards = detailCards(d, v, d.players);
    const common = JSON.stringify({ ...commonFields(d, v) });
    const players = d.players.map((p) => JSON.stringify(playerEntry(d, v, cards, p)));
    const matchPos = new Map<number, [number, number]>();
    const rounds = detailRounds(d).map((r, i) => ({
      head: JSON.stringify(r.head),
      matches: r.matches.map((m, j) => {
        matchPos.set(m.id, [i, j]);
        return JSON.stringify(matchEntry(d, v, m));
      }),
    }));
    const hash = createHash('sha1').update(common);
    for (const p of players) hash.update(p);
    for (const r of rounds) for (const m of [r.head, ...r.matches]) hash.update(m);
    const entry: SharedDetail = {
      version,
      at,
      data: d,
      common,
      players,
      playerIndex: new Map(d.players.map((p, i) => [p.userId, i])),
      rounds,
      matchPos,
      tag: hash.digest('base64url'),
    };
    // Entradas vencidas de outros torneios saem aqui (são poucos torneios ao mesmo tempo).
    for (const [k, e] of sharedDetails) if (at - e.at >= DETAIL_TTL_MS) sharedDetails.delete(k);
    sharedDetails.set(key, entry);
    return entry;
  };

  /**
   * O torneio para quem não gerencia nem é Judge, a partir da parte comum: troca só o próprio
   * inscrito (deck e motivos dos warnings) e, no fim, as próprias partidas (com os replays).
   * O ETag sai do hash da parte comum e do que é da conta, antes de montar a resposta: quando
   * nada mudou para ela, o 304 sai sem serializar nem copiar o torneio inteiro.
   */
  const sendSharedDetail = (req: FastifyRequest, reply: FastifyReply, t: Tournament, u: User | null) => {
    const open = checkInOpen(t, now()) ? 'open' : '';
    const s = sharedDetail(t, `${t.id}:${open}`);
    const d = s.data;
    const v: DetailViewer = { u, manage: false, judge: false };
    const personal = JSON.stringify(personalFields(d, v));
    const mine = u ? s.playerIndex.get(u.id) : undefined;
    const ownPlayer = mine === undefined ? null : JSON.stringify(playerEntry(d, v, detailCards(d, v, [d.players[mine]]), d.players[mine]));
    /** As próprias partidas, por rodada e posição (só no fim, quando os jogadores veem os próprios replays). */
    const ownMatches = new Map<number, Map<number, string>>();
    const ownJson: string[] = [];
    if (u && d.t.status === 'finished') {
      for (const m of d.matches) {
        const pos = s.matchPos.get(m.id);
        if (!pos || (m.p1 !== u.id && m.p2 !== u.id)) continue;
        const json = JSON.stringify(matchEntry(d, v, m));
        ownJson.push(json);
        const round = ownMatches.get(pos[0]) ?? new Map<number, string>();
        ownMatches.set(pos[0], round.set(pos[1], json));
      }
    }
    const etag = `"${sha1(`${s.tag}|${personal}|${ownPlayer ?? ''}|${ownJson.join(',')}`)}"`;
    reply.header('etag', etag).header('cache-control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const players = mine === undefined ? s.players : s.players.map((p, i) => (i === mine ? ownPlayer! : p));
    const rounds = s.rounds.map((r, i) => {
      const own = ownMatches.get(i);
      const matches = own ? r.matches.map((m, j) => own.get(j) ?? m) : r.matches;
      return `${r.head.slice(0, -1)},"matches":[${matches.join(',')}]}`;
    });
    const body = `${s.common.slice(0, -1)},${personal.slice(1, -1)},"players":[${players.join(',')}],"rounds":[${rounds.join(',')}]}`;
    return reply.type('application/json; charset=utf-8').send(body);
  };

  /**
   * A página do torneio consulta esta rota a cada 5 s por jogador. Para os jogadores e
   * visitantes, a parte comum sai de `sharedDetail` (uma vez por torneio e versão dos
   * dados), e o 304 é decidido antes de montar a resposta; para quem gerencia ou é Judge,
   * a resposta fica em cache por conta (invalidado a cada gravação).
   */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const u = user(req);
    // Jogadores e visitantes: a parte comum, montada uma vez para todos (ver `sendSharedDetail`).
    if (!canManage(t, u) && !isJudge(t, u)) return sendSharedDetail(req, reply, t, u);
    // Quem gerencia ou é Judge (poucas contas) vê o torneio inteiro, montado só para ele.
    // A abertura do check-in muda a resposta sem gravação: entra na chave do cache.
    const open = checkInOpen(t, now()) ? 'open' : '';
    return cache.send(req, reply, `tournament:${t.id}:${u?.id ?? '-'}:${open}`, DETAIL_TTL_MS, () => detail(t, u));
  });

  /**
   * Lobby do torneio: as mesas da rodada em cartões. Jogadores veem quem joga, quem venceu
   * (W) e quem perdeu (L); o Judge e o organizador veem também o relógio de cada jogador, quem
   * está conectado e os chamados de Judge abertos. Antes do início: os inscritos e o check-in.
   * Leve (sem as listas dos decks) e sem cache: o lobby do organizador consulta a cada 2 s.
   */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/lobby', async (req, reply) => {
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const u = user(req);
    const manage = canManage(t, u);
    const judge = isJudge(t, u);
    const players = listPlayers(db, t.id);
    const all = entrantsOf(t, players);
    const matches = listMatches(db, t.id);
    const warnings = listWarnings(db, t.id);
    const calls = listCalls(db, t.id).filter((c) => !c.resolvedAt);
    const judges = listJudges(db, t.id);
    const showLeader = manage || judge || t.status !== 'registration';
    const cards = new Map(present(getCards(db, [...new Set(all.map((p) => p.deck.leader))])).map((c) => [c.id, c] as const));
    const byId = new Map(all.map((p) => [p.userId, p]));
    const entry = (userId: string) => {
      const p = byId.get(userId);
      const leader = p && showLeader ? cards.get(p.deck.leader) : undefined;
      const st = p ? warningStatus(t, p, warnings.filter((w) => w.userId === userId)) : null;
      return {
        userId,
        name: p?.name ?? '?',
        leaderName: leader?.name ?? null,
        leaderImage: (cardImages && leader && artImage(leader, p?.deck.arts?.[leader.id])) || null,
        colors: leader?.colors ?? [],
        checkedIn: Boolean(p?.checkedInAt),
        dropped: Boolean(p?.dropped),
        warnings: st ? { count: st.count, max: t.maxWarnings, pending: judge ? st.pending : false } : null,
        /** Sala do Tempo: jogador virtual (o bot joga por ele). */
        virtual: isVirtualId(userId),
      };
    };
    const round = matches.filter((m) => m.round === t.round);
    // Sala do Tempo: só as mesas com humano (as só de virtuais já saíram decididas no sorteio).
    const tables = round.filter((m) => !t.chamber || humanTable(m)).map((m) => {
      const room = m.roomId ? lobby.get(m.roomId) : null;
      const absent = absentSides(t, m, players);
      const call = calls.find((c) => c.matchId === m.id) ?? null;
      const seatOf = (userId: string) => room?.data.seats.findIndex((s) => s.userId === userId) ?? -1;
      const clock = room && judge ? room.clock() : null;
      const side = (userId: string | null, i: 0 | 1) => {
        if (!userId) return null;
        const seat = room ? seatOf(userId) : -1;
        return {
          ...entry(userId),
          ready: m.ready[i] || isVirtualId(userId),
          present: !absent.includes(i === 0 ? 'p1' : 'p2') || isVirtualId(userId),
          /** Só para o Judge e o organizador: conectado à sala e o tempo que resta. */
          connected: judge && room && (seat === 0 || seat === 1) ? room.connected(seat) : null,
          remaining: clock && (seat === 0 || seat === 1) ? clock.remaining[seat] : null,
          running: clock && (seat === 0 || seat === 1) ? clock.running === seat : false,
        };
      };
      return {
        id: m.id,
        table: m.table,
        bestOf: m.bestOf,
        wins: m.wins,
        game: m.wins[0] + m.wins[1] + 1,
        result: m.result,
        winner: winnerOf(m),
        reportedBy: m.reportedBy === null || ['game', 'bye', 'drop', 'noshow', 'late'].includes(m.reportedBy) ? m.reportedBy : 'organizer',
        roomId: m.roomId,
        room: room?.status ?? null,
        paused: Boolean(room?.isPaused),
        p1: side(m.p1, 0)!,
        p2: side(m.p2, 1),
        /** Chamado de Judge aberto (só o Judge e o organizador veem quem chamou e desde quando). */
        call: call && judge ? { id: call.id, openedAt: call.openedAt, byName: byId.get(call.openedBy)?.name ?? '?', reason: call.reason } : call ? { id: call.id, openedAt: call.openedAt, byName: null, reason: null } : null,
      };
    });
    const pending = tables.filter((m) => m.p2 && !m.result);
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      round: t.round,
      label: t.round ? roundLabel(matches, t.round) : null,
      stage: round[0]?.stage ?? null,
      roundAt: t.roundAt,
      roundStartedAt: t.roundStartedAt,
      deadline: roundDeadline(t),
      clockMs: TIME_BANK_MS,
      startsAt: t.startsAt,
      checkIn: t.checkIn,
      autoStart: t.autoStart,
      checkInOpen: checkInOpen(t, now()),
      checkedIn: players.filter((p) => p.checkedInAt).length,
      roundComplete: t.status === 'running' && roundComplete(t, matches),
      /** Sala do Tempo: mesas da rodada (todas) e quantas foram decididas no sorteio. */
      chamber: t.chamber ? { tables: round.length, virtualTables: round.filter((m) => !humanTable(m)).length } : null,
      /** Quem pede: gerencia o torneio, é Judge dele (vê relógios e chamados) e a conta. */
      viewer: { userId: u?.id ?? null, manage, judge },
      judges: judges.map((j) => ({ userId: j.userId, name: j.name })),
      /** Para o Judge e o organizador: decisões de warnings pendentes. */
      warningsPending: judge ? pendingWarnings(db, t, players).map((p) => ({ userId: p.userId, name: p.name })) : [],
      players: players.map((p) => entry(p.userId)),
      tables,
      pendingTables: pending.length,
      readyTables: pending.filter((m) => m.p1.ready && m.p2!.ready).length,
      /** Salas pedindo a presença do Judge agora (só o Judge e o organizador). */
      calls: judge
        ? tables.filter((m) => m.call).map((m) => ({ matchId: m.id, table: m.table, roomId: m.roomId, openedAt: m.call!.openedAt, names: [m.p1.name, m.p2?.name ?? '?'], reason: m.call!.reason }))
        : [],
    };
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
          const name = oppId ? (entrantsOf(t, listPlayers(db, t.id)).find((p) => p.userId === oppId)?.name ?? '?') : null;

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
            /** A rodada já foi iniciada (as salas abriram). */
            roundStarted: Boolean(t.roundStartedAt),
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
                  ready: m.p1 === u.id ? m.ready[0] : m.ready[1],
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

  // ---------------------------------------------------------------- Sala do Tempo

  /** Os eventos simuláveis (presets) com, por Líder, o deck que o bot joga por ele. Só para quem é do Time. */
  app.get('/api/tournaments/chamber/presets', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    if (!isTeam(me)) return reply.code(403).send(fail('chamberTeamOnly', 'A Sala do Tempo é só para quem faz parte do Time.'));
    const at = new Date(now());
    const presets = chamberPresets.list().map((p) => {
      const { leaders, others } = chamberDecks(db, p, { format: p.format, spoilers: p.spoilers }, at);
      const cards = new Map(present(getCards(db, [...new Set(leaders.map((l) => l.leader))])).map((c) => [c.id, c] as const));
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        format: p.format,
        spoilers: p.spoilers,
        spoilerSet: tournamentSpoilerSet(db, { format: p.format, spoilers: p.spoilers }),
        players: p.players,
        rounds: p.rounds,
        topCut: p.topCut,
        bo3From: p.bo3From,
        bo5From: p.bo5From,
        leaders: leaders.map((l) => ({
          leader: l.leader,
          leaderName: cards.get(l.leader)?.name ?? null,
          colors: cards.get(l.leader)?.colors ?? [],
          share: l.share,
          deckId: l.deckId,
          deckName: l.deckName,
          meta: l.meta,
        })),
        /** Decks prontos válidos no formato entre os quais a fatia "outros" sorteia. */
        others: others.length,
      };
    });
    return { presets, botRooms, minPlayers: MIN_CHAMBER_PLAYERS, maxPlayers: MAX_CHAMBER_PLAYERS };
  });

  type ChamberBody = { preset?: unknown; name?: unknown; players?: unknown; rounds?: unknown; topCut?: unknown; bo3From?: unknown; bo5From?: unknown; swissBestOf?: unknown };

  /**
   * Abre uma Sala do Tempo a partir de um preset: um torneio suíço do Time, sem hora marcada nem check-in,
   * cujas vagas que os humanos não ocuparem serão preenchidas por virtuais no início. Quem abre gerencia.
   */
  app.post<{ Body: ChamberBody }>('/api/tournaments/chamber', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    if (!isTeam(me)) return reply.code(403).send(fail('chamberTeamOnly', 'A Sala do Tempo é só para quem faz parte do Time.'));
    if (!botRooms) return reply.code(409).send(fail('chamberNeedsBotRooms', 'A Sala do Tempo precisa do treino contra o bot do servidor, que está desligado.'));
    const b = req.body ?? {};
    const preset = typeof b.preset === 'string' ? chamberPresets.get(b.preset) : null;
    if (!preset) return reply.code(404).send(fail('chamberPresetNotFound', 'Evento não encontrado.'));
    const parsed = parseInput({
      name: typeof b.name === 'string' && b.name.trim() ? b.name : preset.name,
      description: preset.description,
      format: preset.format,
      spoilers: preset.spoilers,
      structure: 'swiss',
      rounds: b.rounds === undefined ? preset.rounds : b.rounds,
      swissBestOf: b.swissBestOf ?? 1,
      topCut: b.topCut === undefined ? preset.topCut : b.topCut,
      bo3From: b.bo3From === undefined ? preset.bo3From : b.bo3From,
      bo5From: b.bo5From === undefined ? preset.bo5From : b.bo5From,
      maxPlayers: null,
      startsAt: null,
      checkIn: false,
      toleranceMin: DEFAULT_TOLERANCE_MIN,
    });
    if (isPlayerError(parsed)) return reply.code(400).send(parsed);
    const size = b.players === undefined ? preset.players : Number(b.players);
    if (!Number.isInteger(size) || size < MIN_CHAMBER_PLAYERS || size > MAX_CHAMBER_PLAYERS) {
      return reply.code(400).send(fail('invalidChamberPlayers', `Jogadores do evento: de ${MIN_CHAMBER_PLAYERS} a ${MAX_CHAMBER_PLAYERS}.`, { min: MIN_CHAMBER_PLAYERS, max: MAX_CHAMBER_PLAYERS }));
    }
    if (parsed.topCut !== null && parsed.topCut > size) return reply.code(400).send(fail('invalidTopCut', 'Top cut maior que o evento.'));
    const { priority: _priority, ...input } = parsed;
    ensurePlayer(db, accountOwnerKey(me.id));
    const t = createTournament(db, { ...input, maxPlayers: size }, me.id, null, { preset: preset.id, size });
    app.log.info(`sala do tempo ${t.id}: aberta por ${me.id} (${preset.id}, ${size} jogadores)`);
    return reply.code(201).send(detail(t, me));
  });

  app.put<{ Params: { id: string }; Body: Body }>('/api/tournaments/:id', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    if (found.t.status !== 'registration') return reply.code(409).send(fail('tourStartedNoEdit', 'O torneio já começou: não dá para mudar as regras.'));
    if (found.t.chamber) return reply.code(409).send(fail('chamberNoEdit', 'A Sala do Tempo segue o evento escolhido: apague-a e abra outra para mudar as regras.'));
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
    // Mudar o formato, tirar os spoilers ou adiar o início (para depois de um banimento com
    // data) pode invalidar decks já inscritos: confere de novo as listas congeladas.
    if (input.format !== found.t.format || input.spoilers !== found.t.spoilers || input.startsAt !== found.t.startsAt) {
      const at = legalAt(input);
      const bad = listPlayers(db, found.t.id).filter((p) => deckIssue(db, p.deck, input, at));
      if (bad.length) {
        const format = playModeLabel({ ...input, spoilerSet: tournamentSpoilerSet(db, input) });
        return reply
          .code(400)
          .send(fail('tourDecksNotAllowed', `${bad.length} inscrito(s) usam decks que não valem no formato ${format}.`, { n: bad.length, format }));
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

  /** Inicia a rodada atual: as salas abrem para todas as mesas ao mesmo tempo e a tolerância do W.O. começa a contar. */
  const beginRound = (t: Tournament, generated = false) => {
    startRound(db, t.id, nowIso());
    app.log.info(`torneio ${t.id}: rodada ${t.round} iniciada`);
    // Gerada e iniciada de uma vez: todos sabem da rodada agora (byes incluídos); senão, só quem tem partida a jogar.
    if (generated) notifyRound(t.id, true);
    else notifyRoundStart(t.id);
  };

  /**
   * Fecha as inscrições, sorteia a ordem e gera a primeira rodada (à mão; com início automático,
   * também acontece sozinho na hora). `{ begin: true }`: já inicia a rodada (senão, os jogadores
   * marcam "Estou pronto" e o organizador inicia depois).
   */
  app.post<{ Params: { id: string }; Body: { begin?: unknown } }>('/api/tournaments/:id/start', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'registration') return reply.code(409).send(fail('tourStarted', 'O torneio já começou.'));
    const players = listPlayers(db, t.id);
    if (players.length < (t.chamber ? 1 : 2)) return reply.code(400).send(fail('tourNeedsTwoPlayers', 'São precisos pelo menos 2 inscritos.'));
    // Deck que deixou de valer depois da inscrição (banimento com data, spoiler de outra coleção): o organizador
    // decide, pedindo a troca do deck (nova inscrição) ou tirando o jogador.
    const stale = staleDecks(db, t, players, new Date(now()));
    if (stale.length) {
      const names = stale.map((p) => p.name).join(', ');
      const format = playModeLabel({ ...t, spoilerSet: tournamentSpoilerSet(db, t) });
      return reply
        .code(409)
        .send(
          fail(
            'tourDecksNoLongerAllowed',
            `${stale.length} inscrito(s) estão com deck que não vale mais no formato ${format}: ${names}. Peça para trocarem o deck ou tire-os do torneio.`,
            { n: stale.length, names, format },
          ),
        );
    }
    if (t.chamber) {
      // Sala do Tempo: os virtuais completam o evento; basta um humano.
      const preset = presetOf(t);
      if (!preset) return reply.code(409).send(fail('chamberPresetNotFound', 'Evento não encontrado.'));
      if (!botRooms) return reply.code(409).send(fail('chamberNeedsBotRooms', 'A Sala do Tempo precisa do treino contra o bot do servidor, que está desligado.'));
      const need = (t.chamberSize ?? preset.players) - players.length;
      const virtuals = beginChamber(db, t, preset, players, nowIso());
      if (need > 0 && !virtuals.length) return reply.code(409).send(fail('chamberNoDecks', 'Nenhum deck pronto vale neste formato: não há como sortear os virtuais.'));
      app.log.info(`sala do tempo ${t.id}: começou com ${players.length} do Time e ${virtuals.length} virtuais`);
    } else beginTournament(db, t, players, nowIso());
    const begin = Boolean(req.body?.begin);
    if (begin) beginRound(getTournament(db, t.id)!, true);
    else notifyRound(t.id, false);
    return detail(getTournament(db, t.id)!, me);
  });

  /**
   * Com a rodada atual completa: gera a próxima rodada (do suíço, o top cut ou a próxima fase) ou
   * encerra. Travada enquanto algum jogador que atingiu o limite de warnings espera a decisão do
   * organizador (manter ou eliminar). `{ begin: true }`: já inicia a rodada gerada. Com início
   * automático, o relógio faz o mesmo sozinho quando a rodada termina (ver clock.ts); esta rota
   * serve para o organizador passar por cima de relatos ou chamados pendentes.
   */
  app.post<{ Params: { id: string }; Body: { begin?: unknown } }>('/api/tournaments/:id/next', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'running') return reply.code(409).send(fail('tourNotRunning', 'O torneio não está em andamento.'));
    const matches = listMatches(db, t.id);
    if (!roundComplete(t, matches)) return reply.code(409).send(fail('roundIncomplete', 'Ainda há partidas da rodada sem resultado.'));
    const players = listPlayers(db, t.id);
    const pending = pendingWarnings(db, t, players);
    if (pending.length) {
      const names = pending.map((p) => p.name).join(', ');
      return reply
        .code(409)
        .send(fail('warningsPending', `Decida antes o que fazer com quem atingiu o limite de warnings: ${names} (manter ou eliminar).`, { names }));
    }
    const preset = presetOf(t);
    if (preset) advanceChamber(db, t, preset, entrantsOf(t, players), matches, nowIso());
    else advanceRound(db, t, entrantsOf(t, players), matches, nowIso());
    const after = getTournament(db, t.id)!;
    if (after.status === 'running' && req.body?.begin) beginRound(after, true);
    else notifyRound(t.id, false);
    return detail(getTournament(db, t.id)!, me);
  });

  /** Inicia a rodada atual (já gerada): as salas de todas as mesas abrem ao mesmo tempo. */
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/rounds/begin', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status !== 'running') return reply.code(409).send(fail('tourNotRunning', 'O torneio não está em andamento.'));
    if (t.roundStartedAt) return reply.code(409).send(fail('roundAlreadyStarted', 'A rodada já foi iniciada.'));
    beginRound(t);
    return detail(getTournament(db, t.id)!, me);
  });

  // ---------------------------------------------------------------- Judges

  /** Adiciona um Judge pelo apelido (`{ player }`). Um inscrito não pode ser Judge. */
  app.put<{ Params: { id: string }; Body: { player?: unknown } }>('/api/tournaments/:id/judges', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (t.status === 'finished') return reply.code(409).send(fail('tourFinished', 'O torneio já terminou.'));
    const name = typeof req.body?.player === 'string' ? req.body.player.trim().replace(/\s+/g, ' ') : '';
    if (!name) return reply.code(400).send(fail('judgeNameRequired', 'Digite o apelido do Judge.'));
    const accounts = accountsByName(db, name);
    if (!accounts.length) return reply.code(404).send(fail('lateEntryPlayerNotFound', `Nenhum jogador com o apelido "${name}".`, { name }));
    if (accounts.length > 1) return reply.code(409).send(fail('lateEntryPlayerAmbiguous', `Há mais de um jogador com o apelido "${name}".`, { name }));
    const [who] = accounts;
    if (listPlayers(db, t.id).some((p) => p.userId === who.userId)) {
      return reply.code(409).send(fail('judgeIsPlayer', `${who.name} está inscrito no torneio: um jogador não pode ser Judge.`, { name: who.name }));
    }
    addJudge(db, t.id, who.userId, me.id, nowIso());
    app.log.info(`torneio ${t.id}: ${who.userId} é Judge (por ${me.id})`);
    return detail(getTournament(db, t.id)!, me);
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/tournaments/:id/judges/:userId', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (!removeJudge(db, t.id, req.params.userId)) return reply.code(404).send(fail('judgeNotFound', 'Esta conta não é Judge do torneio.'));
    app.log.info(`torneio ${t.id}: ${req.params.userId} deixou de ser Judge (por ${me.id})`);
    return detail(getTournament(db, t.id)!, me);
  });

  // ---------------------------------------------------------------- premiação
  //
  // O organizador apresenta os prêmios na página do torneio (em qualquer fase: a foto da
  // entrega pode vir depois do fim). A foto vai junto no corpo, em base64.

  const PRIZE_BODY_LIMIT = Math.ceil((MAX_PRIZE_IMAGE_BYTES * 4) / 3) + 16 * 1024;

  /** Novo item da premiação (`{ place, title, url, image }`). */
  app.post<{ Params: { id: string }; Body: PrizeBody }>('/api/tournaments/:id/prizes', { bodyLimit: PRIZE_BODY_LIMIT }, async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    const input = parsePrize(req.body);
    if (isPlayerError(input)) return reply.code(400).send(input);
    const image = parsePrizeImage(req.body?.image);
    if (isPlayerError(image)) return reply.code(400).send(image);
    if (listPrizes(db, t.id).length >= MAX_PRIZES) {
      return reply.code(409).send(fail('prizeLimit', `A premiação tem até ${MAX_PRIZES} itens.`, { max: MAX_PRIZES }));
    }
    const prizeId = addPrize(db, t.id, input);
    if (image) setPrizeImage(db, t.id, prizeId, image.data, image.type);
    return reply.code(201).send(detail(t, me));
  });

  /** Edita um item; `image` ausente mantém a foto, null a apaga. */
  app.put<{ Params: { id: string; prizeId: string }; Body: PrizeBody }>(
    '/api/tournaments/:id/prizes/:prizeId',
    { bodyLimit: PRIZE_BODY_LIMIT },
    async (req, reply) => {
      const found = managed(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const input = parsePrize(req.body);
      if (isPlayerError(input)) return reply.code(400).send(input);
      const image = parsePrizeImage(req.body?.image);
      if (isPlayerError(image)) return reply.code(400).send(image);
      const prizeId = Number(req.params.prizeId);
      if (!updatePrize(db, t.id, prizeId, input)) return reply.code(404).send(fail('prizeNotFound', 'Prêmio não encontrado.'));
      if (image !== undefined) setPrizeImage(db, t.id, prizeId, image?.data ?? null, image?.type ?? null);
      return detail(t, me);
    },
  );

  app.delete<{ Params: { id: string; prizeId: string } }>('/api/tournaments/:id/prizes/:prizeId', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (!deletePrize(db, t.id, Number(req.params.prizeId))) return reply.code(404).send(fail('prizeNotFound', 'Prêmio não encontrado.'));
    return detail(t, me);
  });

  app.get<{ Params: { id: string; prizeId: string } }>('/api/tournaments/:id/prizes/:prizeId/image', async (req, reply) => {
    const img = prizeImage(db, req.params.id, Number(req.params.prizeId));
    if (!img) return reply.code(404).send(fail('prizeNotFound', 'Prêmio não encontrado.'));
    // A URL muda a cada nova foto (?v=), então pode ficar em cache por bastante tempo.
    return reply
      .header('content-type', img.type)
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(img.data);
  });

  // ---------------------------------------------------------------- modo manual do Judge
  //
  // Enquanto nem toda carta faz exatamente o que deveria, quem responde pela partida pode corrigir a
  // mesa: Admin e Dev em qualquer torneio, o organizador no dele e os Judges da lista só no torneio
  // deles e só enquanto ele está em andamento (`liveMatch` exige `running`: a permissão acaba sozinha
  // com o torneio). Só em partidas de torneio, sem confirmação dos jogadores, e tudo fica na auditoria
  // (`tournament_interventions`, nas ocorrências do torneio).

  /** Papel de quem intervém, para a auditoria. */
  const interventionRole = (t: Tournament, me: User): InterventionRole =>
    me.role === 'admin' || me.role === 'dev' ? me.role : me.id === t.organizerId ? 'organizer' : 'judge';
  /** Nome público de quem intervém (vai para o log da partida). */
  const publicName = (me: User) => findPlayer(db, accountOwnerKey(me.id))?.name ?? 'Judge';
  /** Nota obrigatória do desfazer e das correções: o motivo, para o organizador e para corrigirmos a carta. */
  const manualNote = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, REASON_MAX) : '');
  const gameOf = (m: TournamentMatch) => m.wins[0] + m.wins[1] + 1;

  /** Partida da rodada atual, com a sala em jogo (para o chamado de Judge e a retomada). */
  const liveMatch = (t: Tournament, matchId: number): { m: TournamentMatch; room: NonNullable<ReturnType<Lobby['get']>> } | ({ code: number } & PlayerError) => {
    const m = getMatch(db, t.id, matchId);
    if (!m) return { code: 404, ...fail('matchNotFound', 'Partida não encontrada.') };
    if (t.status !== 'running' || m.round !== t.round) return { code: 409, ...fail('matchNotCurrentRound', 'Esta partida não é da rodada atual.') };
    const room = m.roomId ? lobby.get(m.roomId) : null;
    if (!room || room.status !== 'playing') return { code: 409, ...fail('matchNotPlaying', 'Esta partida não está em andamento numa sala.') };
    return { m, room };
  };

  /**
   * "Chamar o Judge": um dos jogadores (ou o Judge/organizador) pausa a partida. O relógio para,
   * nenhuma jogada é aceita e os Judges e o organizador recebem o aviso.
   */
  app.post<{ Params: { id: string; matchId: string }; Body: { reason?: unknown; details?: unknown; logIndex?: unknown } }>('/api/tournaments/:id/matches/:matchId/call', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    if (!t) return reply.code(404).send(fail('tourNotFound', 'Torneio não encontrado.'));
    const live = liveMatch(t, Number(req.params.matchId));
    if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
    const { m, room } = live;
    const player = m.p1 === me.id || m.p2 === me.id;
    const judge = isJudge(t, me);
    if (!player && !judge) return reply.code(403).send(fail('notYourMatch', 'Esta partida não é sua.'));
    const seat = player ? room.data.seats.findIndex((s) => s.userId === me.id) : -1;
    // O relato de quem chama (tudo opcional): o motivo, um texto e a linha do histórico da jogada do problema
    // (o histórico de quem joga tem as mesmas linhas do da partida; a sala acha a jogada que a gerou).
    const reason = (CALL_REASONS as readonly unknown[]).includes(req.body?.reason) ? (req.body!.reason as CallReason) : null;
    const details = manualNote(req.body?.details) || null;
    const logIndex = req.body?.logIndex;
    const at = typeof logIndex === 'number' && Number.isInteger(logIndex) && logIndex >= 0 ? room.playAtLine(logIndex) : null;
    const plays = at ? room.plays() : null;
    const play = at && plays && room.state ? { ...at, text: pointedText(room.state, plays, at.count) } : null;
    const r = room.pause(seat === 0 || seat === 1 ? seat : null);
    if (!r.ok) return reply.code(r.code).send(fail(r.errorCode ?? 'invalidAction', r.error, r.errorParams));
    const call = createCall(db, t.id, { matchId: m.id, roomId: room.id, game: m.wins[0] + m.wins[1] + 1, openedBy: me.id, at: nowIso(), reason, details, play });
    const names = listPlayers(db, t.id);
    const name = (id: string | null) => names.find((p) => p.userId === id)?.name ?? '?';
    app.log.info(`torneio ${t.id}: chamado de Judge ${call.id} na partida ${m.id} (mesa ${m.table}) por ${me.id}`);
    for (const id of judgeIds(t)) {
      if (id === me.id) continue;
      tournamentNotice(t, id, (locale) => pushText(locale, 'judgeCallBody', { table: m.table, a: name(m.p1), b: name(m.p2) }), 1800, `/?torneio=${encodeURIComponent(t.id)}&lobby=1`);
    }
    return { callId: call.id };
  });

  /** Intervenções do Judge na partida desde que o chamado abriu (desfazer e correções). */
  const callFixes = (t: Tournament, m: TournamentMatch, call: TournamentCall) =>
    listInterventions(db, t.id)
      .filter((i) => i.matchId === m.id && i.at >= call.openedAt && (i.kind === 'undo' || i.kind === 'judge_action'))
      .reverse();

  /** O chamado de ajuste da plataforma do chamado aberto (null sem chamado ou sem a partida). */
  const callFix = (t: Tournament, m: TournamentMatch, room: NonNullable<ReturnType<Lobby['get']>>, me: User, outcome: CallOutcome, note: string | null) => {
    const call = openCall(db, t.id, m.id);
    const plays = room.plays();
    if (!call || !plays || !room.state) return null;
    const names = new Map(listPlayers(db, t.id).map((p) => [p.userId, p.name]));
    return fixTicket({
      call,
      outcome,
      note,
      judgeName: publicName(me),
      callerName: names.get(call.openedBy) ?? findPlayer(db, accountOwnerKey(call.openedBy))?.name ?? '?',
      where: `${t.name}, rodada ${m.round}, mesa ${m.table}, jogo ${gameOf(m)}`,
      state: room.state,
      plays,
      fixes: callFixes(t, m, call),
    });
  };

  /**
   * O chamado aberto da partida, para o painel do Judge: quem chamou, o motivo, o texto e a jogada apontada,
   * e o que o Judge já fez desde então (`undone`/`fixes`: o desfecho "erro do app" já vem sugerido).
   */
  app.get<{ Params: { id: string; matchId: string } }>('/api/tournaments/:id/matches/:matchId/call', async (req, reply) => {
    const found = judged(req, reply);
    if (!found) return reply;
    const { t } = found;
    const m = getMatch(db, t.id, Number(req.params.matchId));
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    const call = openCall(db, t.id, m.id);
    if (!call) return { call: null };
    const fixes = callFixes(t, m, call);
    const names = new Map(listPlayers(db, t.id).map((p) => [p.userId, p.name]));
    return {
      call: {
        id: call.id,
        openedAt: call.openedAt,
        byName: names.get(call.openedBy) ?? findPlayer(db, accountOwnerKey(call.openedBy))?.name ?? '?',
        /** Chamado por um dos jogadores (e não pelo próprio Judge ou pelo organizador). */
        byPlayer: call.openedBy === m.p1 || call.openedBy === m.p2,
        reason: call.reason,
        details: call.details,
        play: call.play,
        playTurn: call.playTurn,
        undone: fixes.filter((f) => f.kind === 'undo').reduce((n, f) => n + (f.removed?.length ?? 0), 0),
        fixes: fixes.filter((f) => f.kind === 'judge_action').length,
      },
    };
  });

  /**
   * O Judge (ou o organizador) retoma a partida pausada, com o desfecho do chamado (`outcome`, um toque:
   * `CALL_OUTCOMES`) e, opcional, o relato ao organizador (`note`, obrigatório só no "outro"). Erro do app
   * (`APP_OUTCOMES`) abre o chamado de ajuste da plataforma para Admin e Dev.
   */
  app.post<{ Params: { id: string; matchId: string }; Body: { note?: unknown; outcome?: unknown } }>('/api/tournaments/:id/matches/:matchId/resume', async (req, reply) => {
    const found = judged(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    const live = liveMatch(t, Number(req.params.matchId));
    if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
    const { m, room } = live;
    const raw = req.body?.outcome;
    if (raw !== undefined && raw !== null && !(CALL_OUTCOMES as readonly unknown[]).includes(raw)) return reply.code(400).send(fail('invalidOutcome', 'Desfecho inválido.'));
    const outcome = (raw ?? null) as CallOutcome | null;
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, REASON_MAX) : null;
    if (outcome === 'other' && !note) return reply.code(400).send(fail('outcomeNoteRequired', 'Escreva o que aconteceu.'));
    // O chamado de ajuste lê a mesa antes de a partida voltar a correr.
    const fix = outcome && APP_OUTCOMES.includes(outcome) ? callFix(t, m, room, me, outcome, note) : null;
    const manual = Boolean(room.manualMode);
    const r = room.resume();
    if (!r.ok) return reply.code(r.code).send(fail(r.errorCode ?? 'invalidAction', r.error, r.errorParams));
    resolveCalls(db, t.id, m.id, me.id, nowIso(), note, { outcome, fix });
    // Retomar também encerra o modo manual.
    if (manual) addIntervention(db, t.id, { matchId: m.id, roomId: room.id, game: gameOf(m), userId: me.id, role: interventionRole(t, me), kind: 'manual_off', note, at: nowIso() });
    app.log.info(`torneio ${t.id}: partida ${m.id} retomada por ${me.id}${note ? ` (${note})` : ''}`);
    return reply.code(204).send();
  });


  // ---------------------------------------------------------------- modo manual do Judge (rotas)

  /** Entra (`on: true`) ou sai do modo manual. Entrar pausa a partida (com um chamado aberto pelo Judge, se ainda não havia). */
  app.post<{ Params: { id: string; matchId: string }; Body: { on?: unknown; note?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/manual',
    async (req, reply) => {
      const found = judged(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const live = liveMatch(t, Number(req.params.matchId));
      if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
      const { m, room } = live;
      const on = req.body?.on !== false;
      const r = on ? room.enterManual({ id: me.id, name: publicName(me) }) : room.leaveManual();
      if (!r.ok) return reply.code(r.code).send(fail(r.errorCode ?? 'invalidAction', r.error, r.errorParams));
      const at = nowIso();
      if (on && 'pausedNow' in r && r.pausedNow) createCall(db, t.id, { matchId: m.id, roomId: room.id, game: gameOf(m), openedBy: me.id, at });
      const note = manualNote(req.body?.note) || null;
      addIntervention(db, t.id, { matchId: m.id, roomId: room.id, game: gameOf(m), userId: me.id, role: interventionRole(t, me), kind: on ? 'manual_on' : 'manual_off', note, at });
      app.log.info(`torneio ${t.id}: partida ${m.id} ${on ? 'entrou no' : 'saiu do'} modo manual (por ${me.id})`);
      return { manual: room.manualMode, actionCount: r.actionCount };
    },
  );

  /**
   * Todas as jogadas da partida em andamento (`Room.plays`), para o Judge e o organizador conferirem o
   * que cada jogador fez e escolheu (a pergunta aberta, as opções que havia e a resposta) e, no modo
   * manual, escolherem até onde desfazer. Não precisa do modo manual: conferir não pausa a mesa.
   */
  app.get<{ Params: { id: string; matchId: string } }>('/api/tournaments/:id/matches/:matchId/plays', async (req, reply) => {
    const found = judged(req, reply);
    if (!found) return reply;
    const live = liveMatch(found.t, Number(req.params.matchId));
    if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
    const plays = live.room.plays();
    return plays ?? reply.code(409).send(fail('matchNotStarted', 'A partida ainda não começou.'));
  });

  /** Desfaz as jogadas: ficam só as primeiras `to` ações (`seq`: a versão da mesa que o Judge viu). */
  app.post<{ Params: { id: string; matchId: string }; Body: { seq?: unknown; to?: unknown; note?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/undo',
    async (req, reply) => {
      const found = judged(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const live = liveMatch(t, Number(req.params.matchId));
      if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
      const { m, room } = live;
      const note = manualNote(req.body?.note);
      if (note.length < 3) return reply.code(400).send(fail('manualNoteRequired', 'Escreva o motivo da correção.'));
      const r = room.judgeUndo(req.body?.seq, req.body?.to);
      if (!r.ok) return reply.code(r.code).send(fail(r.errorCode ?? 'invalidAction', r.error, r.errorParams));
      addIntervention(db, t.id, {
        matchId: m.id,
        roomId: room.id,
        game: gameOf(m),
        userId: me.id,
        role: interventionRole(t, me),
        kind: 'undo',
        payload: { to: req.body?.to },
        removed: r.removed,
        note,
        at: nowIso(),
      });
      app.log.info(`torneio ${t.id}: partida ${m.id}: ${r.removed?.length ?? 0} jogada(s) desfeita(s) por ${me.id} (${note})`);
      return { actionCount: r.actionCount };
    },
  );

  /**
   * Correção do Judge pelo lado de `player`: `op` (ferramenta manual: comprar, mover, K.O., poder, DON!!…)
   * ou `action` (concluir um efeito manual, passar ou encerrar o turno no lugar do jogador).
   */
  app.post<{ Params: { id: string; matchId: string }; Body: { seq?: unknown; player?: unknown; op?: unknown; action?: unknown; note?: unknown } }>(
    '/api/tournaments/:id/matches/:matchId/judge-action',
    async (req, reply) => {
      const found = judged(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      const live = liveMatch(t, Number(req.params.matchId));
      if ('code' in live) return reply.code(live.code).send(fail(live.errorCode, live.error, live.errorParams));
      const { m, room } = live;
      const note = manualNote(req.body?.note);
      if (note.length < 3) return reply.code(400).send(fail('manualNoteRequired', 'Escreva o motivo da correção.'));
      const r = room.judgeAct(req.body?.seq, req.body?.player, { op: req.body?.op, action: req.body?.action });
      if (!r.ok) return reply.code(r.code).send(fail(r.errorCode ?? 'invalidAction', r.error, r.errorParams));
      const at = nowIso();
      addIntervention(db, t.id, { matchId: m.id, roomId: room.id, game: gameOf(m), userId: me.id, role: interventionRole(t, me), kind: 'judge_action', payload: r.action, note, at });
      // A correção terminou a partida: a sala voltou a correr sozinha e o chamado fecha como erro do app corrigido.
      if (!room.isPaused && openCall(db, t.id, m.id)) resolveCalls(db, t.id, m.id, me.id, at, note, { outcome: 'app_fixed', fix: callFix(t, m, room, me, 'app_fixed', note) });
      app.log.info(`torneio ${t.id}: partida ${m.id}: correção do Judge ${me.id} (${note})`);
      return { actionCount: r.actionCount };
    },
  );

  /** Partida decidida por fora (placar, derrota dupla, desistência): uma sala pausada volta a correr e o chamado fecha. */
  const releaseRoom = (t: Tournament, m: TournamentMatch, by: string) => {
    const room = m.roomId ? lobby.get(m.roomId) : null;
    if (room?.isPaused) room.resume();
    if (openCall(db, t.id, m.id)) resolveCalls(db, t.id, m.id, by, nowIso(), 'Resultado lançado pelo organizador.');
  };

  // ---------------------------------------------------------------- warnings

  /** Warning a um jogador (`{ reason, matchId? }`), pelo Judge ou pelo organizador; o jogador é avisado. */
  app.post<{ Params: { id: string; userId: string }; Body: { reason?: unknown; matchId?: unknown } }>(
    '/api/tournaments/:id/players/:userId/warnings',
    async (req, reply) => {
      const found = judged(req, reply);
      if (!found) return reply;
      const { t, me } = found;
      if (t.status === 'finished') return reply.code(409).send(fail('tourFinished', 'O torneio já terminou.'));
      const userId = req.params.userId;
      if (userId === me.id) return reply.code(400).send(fail('warningSelf', 'Você não pode dar warning a si mesmo.'));
      const p = listPlayers(db, t.id).find((x) => x.userId === userId);
      if (!p) return reply.code(404).send(fail('playerNotRegistered', 'Jogador não inscrito.'));
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().replace(/\s+/g, ' ').slice(0, REASON_MAX) : '';
      if (reason.length < 3) return reply.code(400).send(fail('warningReasonRequired', 'Escreva o motivo do warning.'));
      const matchId = Number.isInteger(req.body?.matchId) ? Number(req.body!.matchId) : null;
      const m = matchId !== null ? getMatch(db, t.id, matchId) : null;
      const call = m ? openCall(db, t.id, m.id) : null;
      addWarning(db, t.id, { userId, givenBy: me.id, at: nowIso(), round: t.round, matchId: m?.id ?? null, callId: call?.id ?? null, reason });
      const all = listWarnings(db, t.id).filter((w) => w.userId === userId);
      const st = warningStatus(t, p, all);
      app.log.info(`torneio ${t.id}: warning a ${userId} por ${me.id} (${st.count}${t.maxWarnings ? `/${t.maxWarnings}` : ''}): ${reason}`);
      tournamentNotice(
        t,
        userId,
        (locale) => pushText(locale, t.maxWarnings ? 'warningBody' : 'warningNoLimitBody', { reason, n: st.count, max: t.maxWarnings ?? 0 }),
        3600,
      );
      return detail(getTournament(db, t.id)!, me);
    },
  );

  /** O organizador anula um warning. */
  app.delete<{ Params: { id: string; warningId: string } }>('/api/tournaments/:id/warnings/:warningId', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (!revokeWarning(db, t.id, Number(req.params.warningId), me.id, nowIso())) return reply.code(404).send(fail('warningNotFound', 'Warning não encontrado.'));
    app.log.info(`torneio ${t.id}: warning ${req.params.warningId} anulado por ${me.id}`);
    return detail(getTournament(db, t.id)!, me);
  });

  /** O organizador decide manter o jogador que atingiu o limite de warnings (a próxima rodada destrava). */
  app.post<{ Params: { id: string; userId: string } }>('/api/tournaments/:id/players/:userId/warnings/keep', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t, me } = found;
    if (!listPlayers(db, t.id).some((p) => p.userId === req.params.userId)) return reply.code(404).send(fail('playerNotRegistered', 'Jogador não inscrito.'));
    reviewWarnings(db, t.id, req.params.userId, nowIso());
    app.log.info(`torneio ${t.id}: ${req.params.userId} mantido no torneio apesar dos warnings (por ${me.id})`);
    return detail(getTournament(db, t.id)!, me);
  });

  /** Ocorrências do torneio (Judge e organizador): chamados de Judge e warnings, com nomes. */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/incidents', async (req, reply) => {
    const found = judged(req, reply);
    if (!found) return reply;
    const { t } = found;
    const players = listPlayers(db, t.id);
    const judges = listJudges(db, t.id);
    const matches = listMatches(db, t.id);
    const name = (id: string | null) =>
      id === null ? '?' : (players.find((p) => p.userId === id)?.name ?? (id === t.organizerId ? t.organizerName : null) ?? judges.find((j) => j.userId === id)?.name ?? '?');
    const table = (matchId: number) => {
      const m = matches.find((x) => x.id === matchId);
      return m ? { round: m.round, table: m.table, names: [name(m.p1), m.p2 ? name(m.p2) : null] } : null;
    };
    return {
      calls: listCalls(db, t.id).map(({ fix: _fix, ...c }) => ({ ...c, openedByName: name(c.openedBy), resolvedByName: c.resolvedBy ? name(c.resolvedBy) : null, match: table(c.matchId) })),
      warnings: listWarnings(db, t.id)
        .slice()
        .reverse()
        .map((w) => ({ ...w, name: name(w.userId), byName: name(w.givenBy), match: w.matchId ? table(w.matchId) : null })),
      // Modo manual: quem desfez ou corrigiu o quê (as ações desfeitas só contam, não vão para a tela).
      interventions: listInterventions(db, t.id).map(({ removed, ...i }) => ({
        ...i,
        removedCount: removed?.length ?? 0,
        byName: name(i.userId) === '?' ? (findPlayer(db, accountOwnerKey(i.userId))?.name ?? '?') : name(i.userId),
        match: table(i.matchId),
      })),
    };
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
   * Kit de divulgação (só quem gerencia, só com o torneio encerrado): campeão, campanha
   * com play/draw por jogo, listas do top 4 e líderes. As imagens e o PDF são gerados no
   * navegador de quem pede, a partir destes dados.
   */
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/recap', async (req, reply) => {
    const found = managed(req, reply);
    if (!found) return reply;
    const { t } = found;
    if (t.status !== 'finished') return reply.code(409).send(fail('tourNotFinished', 'O kit de divulgação sai quando o torneio termina.'));
    return buildRecap(db, t, { present, cardImages, sponsor: sponsorOf(t.sponsorId), naturalEnd: endedNaturally(t), players: entrantsOf(t, listPlayers(db, t.id)) });

  });

  /** O torneio terminou pelas rodadas previstas (e não por "encerrar agora"). */
  const endedNaturally = (t: Tournament) => {
    const players = entrantsOf(t, listPlayers(db, t.id));
    const matches = listMatches(db, t.id);
    if (!matches.length || !roundComplete(t, matches)) return false;
    const step = nextStep(t, players, matches);
    if (step === 'finish') return true;
    // Chave sem ninguém para avançar (W.O. duplo nas mesas que restavam) também acaba sozinha.
    return step === 'elim' && singleNextRound(players, matches.filter((m) => m.round === t.round)).length === 0;
  };

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
    releaseRoom(t, m, me.id);
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
      if (result) releaseRoom(t, m, me.id);
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
      const pending = listMatches(db, t.id).find((m) => m.round === t.round && !m.result && m.p2 && (m.p1 === userId || m.p2 === userId));
      dropPlayer(db, t, userId);
      if (pending) releaseRoom(t, pending, userId);
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
    if (!already && listJudges(db, t.id).some((j) => j.userId === me.id)) {
      return reply.code(409).send(fail('judgeCannotRegister', 'Você é Judge deste torneio: um Judge não joga o torneio.'));
    }
    if (t.chamber && !isTeam(me)) return reply.code(403).send(fail('chamberTeamOnly', 'A Sala do Tempo é só para quem faz parte do Time.'));
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
    const deck = playableDeck(db, req.body?.deckId, t.format, { spoilers: spoilerRule(t), spoilerSet: tournamentSpoilerSet(db, t), at: new Date(now()) });
    if ('error' in deck) return reply.code(deck.code).send(fail(deck.errorCode, deck.error, deck.errorParams));
    // O deck precisa valer também no dia do torneio (banimento com data antes do início).
    const at = legalAt(t);
    const later = !late && at.getTime() > now() ? formatIssues(deck, t.format, at)[0] : undefined;
    if (later) {
      const date = brDate(at);
      return reply.code(400).send(
        fail('tourDeckNotAllowedAtStart', `Esse deck não vai valer no início do torneio (${date}). ${later.message}`, {
          date,
          issue: later.message,
          issueCode: later.code,
          issueParams: later.params,
        }),
      );
    }
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

  /** "Estou pronto" (`{ ready }`): sinal para o organizador iniciar a rodada; vale enquanto a partida não tem resultado. */
  app.put<{ Params: { id: string; matchId: string }; Body: { ready?: unknown } }>('/api/tournaments/:id/matches/:matchId/ready', async (req, reply) => {
    const me = account(req, reply);
    if (!me) return reply;
    const t = getTournament(db, req.params.id);
    const m = t && getMatch(db, t.id, Number(req.params.matchId));
    if (!t || !m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    if (m.p1 !== me.id && m.p2 !== me.id) return reply.code(403).send(fail('notYourMatch', 'Esta partida não é sua.'));
    if (t.status !== 'running' || m.round !== t.round) return reply.code(409).send(fail('matchNotCurrentRound', 'Esta partida não é da rodada atual.'));
    if (m.result) return reply.code(409).send(fail('matchHasResult', 'Esta partida já tem resultado.'));
    setReady(db, t.id, m.id, m.p1 === me.id ? 'p1' : 'p2', req.body?.ready !== false);
    return detail(getTournament(db, t.id)!, me);
  });

  /**
   * Abre (ou entra na) sala online do jogo atual da série, depois que o organizador iniciou a
   * rodada. O primeiro a entrar espera o oponente; o jogo começa quando os dois estão na sala.
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
    if (!t.roundStartedAt) return reply.code(409).send(fail('roundNotStarted', 'A rodada ainda não foi iniciada pelo organizador.'));
    const player = listPlayers(db, t.id).find((p) => p.userId === me.id)!;
    if (player.dropped) return reply.code(409).send(fail('youDropped', 'Você saiu do torneio.'));
    const opp = m.p1 === me.id ? m.p2 : m.p1;
    const virtual = isVirtualId(opp) ? listVirtuals(db, t.id).find((v) => v.id === opp) : undefined;
    const limit = lobby.admit(req.ip, virtual ? 'bot' : 'tournament');
    if (limit) return reply.code(limit.code).send(limit);
    const ownerHash = accountOwnerKey(me.id);
    const profile = ensurePlayer(db, ownerHash);
    const seat = {
      ownerHash,
      userId: me.id,
      name: profile.name,
      bounty: profile.bounty,
      tier: tierFor(profile.bounty).id,
      apprentice: isApprentice(db, ownerHash),
      deckId: player.deckId,
      deck: player.deck,
    };
    const mode = { format: t.format, spoilers: t.spoilers, ...(t.spoilerSet ? { spoilerSet: t.spoilerSet } : {}) };
    const roomTournament = {
      id: t.id,
      name: t.name,
      round: m.round,
      label: roundLabel(listMatches(db, t.id), m.round),
      matchId: m.id,
      game: m.wins[0] + m.wins[1] + 1,
      bestOf: m.bestOf,
      wins: { [m.p1]: m.wins[0], [m.p2]: m.wins[1] },
      firstUserId: m.nextFirst,
      liveHands: t.liveHands,
    };
    let r: ReturnType<typeof lobby.tournamentRoom>;
    if (virtual) {
      // Sala do Tempo: a mesa contra um virtual é uma sala de treino contra o Bot do Time, com o deck do
      // virtual, ligada à série do torneio. Voltar à sala em andamento devolve o mesmo assento.
      const open = m.roomId ? lobby.get(m.roomId) : null;
      const mine = open && open.status !== 'finished' ? open.data.seats.find((s) => s.ownerHash === ownerHash) : undefined;
      if (open && mine) r = { room: open, token: mine.token };
      else {
        if (!botRooms) return reply.code(409).send(fail('chamberNeedsBotRooms', 'A Sala do Tempo precisa do treino contra o bot do servidor, que está desligado.'));
        const stored = getDeck(db, virtual.deckId);
        if (!stored) return reply.code(409).send(fail('chamberNoDecks', 'O deck do jogador virtual não existe mais.'));
        const bot = {
          ownerHash: 'bot',
          userId: null,
          name: virtual.name,
          bounty: 0,
          tier: tierFor(0).id,
          deckId: stored.id,
          deck: { id: stored.id, name: stored.name, leader: stored.leader, cards: stored.cards, ...(stored.arts ? { arts: stored.arts } : {}) },
        };
        // Quem perdeu o jogo anterior da série começa; no primeiro, o sorteio.
        const first = m.nextFirst === me.id ? 0 : m.nextFirst === virtual.id ? 1 : undefined;
        r = lobby.createBotRoom(seat, bot, mode, first, 'team', { ...roomTournament, virtualId: virtual.id });
      }
    } else r = lobby.tournamentRoom(seat, mode, roomTournament);
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
