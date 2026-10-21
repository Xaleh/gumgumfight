// Relógio dos torneios com hora marcada (`check_in`): o check-in abre 30 minutos antes
// do início; com `auto_start`, na hora marcada o torneio começa sozinho (rodada 1 sorteada
// entre todos os inscritos e iniciada na hora; sem a opção, o organizador dá o start, mesmo
// com a hora atingida); e em cada rodada iniciada pelo organizador (`round_started_at`)
// cada jogador tem alguns minutos para entrar na sala. Quem não entra perde por W.O. e sai
// do torneio; se nenhum dos dois entra, os dois perdem (W.O. duplo). Na rodada 1, o
// check-in feito antes também vale como presença. Os 5 minutos são o padrão: o
// organizador escolhe a tolerância (`tolerance_min`).
//
// `tournamentTick` roda a cada poucos segundos no servidor (ver routes.ts) e é
// idempotente: cada rodada é varrida uma vez (`round_wo`) e o aviso de check-in sai uma
// vez por hora de início (`checkin_notice`).

import { type CardData, type DeckList, type FormatIssue, formatIssues, spoilerIssues, tournamentSpoilerRule } from '@gumgum/engine';
import { randomInt } from 'node:crypto';
import { type DB, getCards } from '../db';
import { elimBestOf, type Pairing, singleFirstRound, singleRounds, swissPairings, swissRounds } from './pairing';
import {
  listAutomatic,
  listMatches,
  listPlayers,
  markCheckInNotice,
  markRoundSwept,
  noShow,
  type RoundSpec,
  startRound,
  startTournament,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
  unregisterPlayer,
} from './store';

/** O check-in abre este tempo antes do início. */
export const CHECK_IN_MS = 30 * 60_000;
/** Tolerância para entrar na sala em cada rodada: minutos escolhidos pelo organizador (padrão e limites). */
export const DEFAULT_TOLERANCE_MIN = 5;
export const MIN_TOLERANCE_MIN = 1;
export const MAX_TOLERANCE_MIN = 60;
export const toleranceMs = (t: Pick<Tournament, 'toleranceMin'>) => t.toleranceMin * 60_000;
/** Passado isto da hora marcada sem começar (servidor fora do ar, por exemplo), o organizador começa à mão. */
export const AUTO_START_GRACE_MS = 60 * 60_000;

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Quando o check-in abre (ISO), ou null sem hora marcada. */
export const checkInOpensAt = (t: Pick<Tournament, 'checkIn' | 'startsAt'>): string | null =>
  t.checkIn && t.startsAt ? new Date(ms(t.startsAt) - CHECK_IN_MS).toISOString() : null;

/** O check-in está aberto agora (inscrições abertas e já passou a hora de abrir). */
export const checkInOpen = (t: Pick<Tournament, 'checkIn' | 'startsAt' | 'status'>, now: number): boolean =>
  t.checkIn && t.status === 'registration' && Boolean(t.startsAt) && now >= ms(t.startsAt) - CHECK_IN_MS;

/** Prazo para entrar na sala na rodada atual (ISO), ou null quando não há tolerância correndo (rodada ainda não iniciada). */
export const roundDeadline = (t: Pick<Tournament, 'checkIn' | 'status' | 'roundStartedAt' | 'roundSwept' | 'toleranceMin'>): string | null =>
  t.checkIn && t.status === 'running' && t.roundStartedAt && !t.roundSwept ? new Date(ms(t.roundStartedAt) + toleranceMs(t)).toISOString() : null;

/** Rodada da eliminatória: melhor de N pelo tamanho da fase. */
export const elimRound = (t: Tournament, round: number, pairings: Pairing[]): RoundSpec => ({
  round,
  stage: 'elim',
  bestOf: elimBestOf(pairings.length * 2, t),
  pairings,
});

/**
 * O que impede a lista congelada de valer no torneio em `at` (formato e spoilers); null = vale.
 * Spoilers: sem a opção, nenhum; com ela, só os das coleções já reveladas por completo.
 */
export function deckIssue(db: DB, deck: DeckList, t: Pick<Tournament, 'format' | 'spoilers'>, at: Date): FormatIssue | null {
  const issue = formatIssues(deck, t.format, at)[0];
  const rule = tournamentSpoilerRule(t);
  if (issue || rule === 'all') return issue ?? null;
  const ids = [deck.leader, ...deck.cards.map((c) => c.id)];
  return spoilerIssues(deck, new Map(getCards(db, ids).map((c) => [c.id, c as CardData])), rule)[0] ?? null;
}

/**
 * Inscritos cujo deck (a lista congelada na inscrição) não vale mais no torneio em `at`: uma
 * carta banida com data marcada (ou incluída na lista depois da inscrição), ou um spoiler de
 * coleção ainda incompleta (inscrições de antes de os torneios com spoilers exigirem a coleção
 * completa). Uma carta só deixa de ser spoiler, e uma coleção só passa a estar completa.
 */
export function staleDecks(db: DB, t: Pick<Tournament, 'format' | 'spoilers'>, players: TournamentPlayer[], at: Date): TournamentPlayer[] {
  return players.filter((p) => deckIssue(db, p.deck, t, at) !== null);
}

/** Fecha as inscrições, sorteia a ordem e gera a primeira rodada. Exige pelo menos 2 inscritos. */
export function beginTournament(db: DB, t: Tournament, players: TournamentPlayer[], at: string) {
  // Embaralha (Fisher-Yates) para sortear a ordem dos cabeças de chave e da 1ª rodada.
  const order = players.map((p) => p.userId);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seeded = players.map((p) => ({ ...p, seed: order.indexOf(p.userId) + 1 }));
  if (t.structure === 'swiss') {
    const rounds = t.rounds ?? swissRounds(players.length);
    startTournament(db, t.id, order, rounds, { round: 1, stage: 'swiss', bestOf: t.swissBestOf, pairings: swissPairings(seeded, []) }, at);
  } else {
    startTournament(db, t.id, order, singleRounds(players.length), elimRound(t, 1, singleFirstRound(seeded)), at);
  }
}

/** Lados ausentes de uma partida pendente da rodada atual (vazio = ninguém falta ou a série já começou). */
export function absentSides(t: Tournament, m: TournamentMatch, players: TournamentPlayer[]): Array<'p1' | 'p2'> {
  if (!m.p2 || m.result || m.wins[0] + m.wins[1] > 0) return [];
  const checked = (userId: string) => t.round === 1 && Boolean(players.find((p) => p.userId === userId)?.checkedInAt);
  const out: Array<'p1' | 'p2'> = [];
  if (!m.entered[0] && !checked(m.p1)) out.push('p1');
  if (!m.entered[1] && !checked(m.p2)) out.push('p2');
  return out;
}

export interface TickResult {
  started: string[];
  /** Inscrições canceladas no início automático porque o deck não valia mais no formato. */
  removed: Array<{ tournamentId: string; userIds: string[] }>;
  /** Torneios cujo check-in acabou de abrir (o aviso por notificação sai uma vez por hora de início). */
  checkIns: string[];
  /** Partidas decididas por W.O., por torneio. */
  noShows: Array<{ tournamentId: string; matchId: number; absent: Array<'p1' | 'p2'> }>;
}

/**
 * Um passo do relógio: começa os torneios com início automático cuja hora chegou (a rodada 1
 * já sai iniciada: `round_started_at`) e dá W.O. a quem não entrou na sala dentro da tolerância
 * da rodada iniciada. `closeRoom`: fecha a sala em espera de uma partida decidida.
 */
export function tournamentTick(db: DB, now: number, closeRoom?: (roomId: string) => void): TickResult {
  const result: TickResult = { started: [], removed: [], checkIns: [], noShows: [] };
  for (const t of listAutomatic(db)) {
    if (t.status === 'registration') {
      if (t.startsAt && checkInOpen(t, now) && t.checkInNotice !== t.startsAt && now < ms(t.startsAt)) {
        markCheckInNotice(db, t.id, t.startsAt);
        result.checkIns.push(t.id);
      }
      const start = ms(t.startsAt);
      if (!t.autoStart || Number.isNaN(start) || now < start || now - start > AUTO_START_GRACE_MS) continue;
      // Deck que deixou de valer (banimento com data, spoiler de coleção incompleta) não joga: a inscrição é cancelada.
      // No início à mão, o organizador é avisado antes e decide (ver a rota /start).
      const stale = staleDecks(db, t, listPlayers(db, t.id), new Date(now));
      for (const p of stale) unregisterPlayer(db, t.id, p.userId);
      if (stale.length) result.removed.push({ tournamentId: t.id, userIds: stale.map((p) => p.userId) });
      const players = listPlayers(db, t.id);
      if (players.length < 2) continue;
      const at = new Date(now).toISOString();
      beginTournament(db, t, players, at);
      // Sem o organizador para dar o start, a rodada 1 começa na hora.
      startRound(db, t.id, at);
      result.started.push(t.id);
      continue;
    }
    if (t.status !== 'running' || t.roundSwept || !t.roundStartedAt || now < ms(t.roundStartedAt) + toleranceMs(t)) continue;
    const players = listPlayers(db, t.id);
    for (const m of listMatches(db, t.id).filter((x) => x.round === t.round)) {
      const absent = absentSides(t, m, players);
      if (!absent.length) continue;
      if (m.roomId) closeRoom?.(m.roomId);
      noShow(db, t.id, m, absent);
      result.noShows.push({ tournamentId: t.id, matchId: m.id, absent });
    }
    markRoundSwept(db, t.id);
  }
  return result;
}
