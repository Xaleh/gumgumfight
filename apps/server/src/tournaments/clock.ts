// Relógio dos torneios com hora marcada (`check_in`): o check-in abre 30 minutos antes
// do início; na hora marcada o torneio começa sozinho (rodada 1 sorteada entre todos os
// inscritos, com a sala de cada mesa pronta para os dois jogadores); e em cada rodada
// cada jogador tem alguns minutos para entrar na sala. Quem não entra perde por W.O. e sai
// do torneio; se nenhum dos dois entra, os dois perdem (W.O. duplo). Na rodada 1, o
// check-in feito antes também vale como presença. Os 5 minutos são o padrão: o
// organizador escolhe a tolerância (`tolerance_min`).
//
// `tournamentTick` roda a cada poucos segundos no servidor (ver routes.ts) e é
// idempotente: cada rodada é varrida uma vez (`round_wo`).

import { randomInt } from 'node:crypto';
import type { DB } from '../db';
import { elimBestOf, type Pairing, singleFirstRound, singleRounds, swissPairings, swissRounds } from './pairing';
import {
  listAutomatic,
  listMatches,
  listPlayers,
  markRoundSwept,
  noShow,
  type RoundSpec,
  startTournament,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
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

/** Prazo para entrar na sala na rodada atual (ISO), ou null quando não há tolerância correndo. */
export const roundDeadline = (t: Pick<Tournament, 'checkIn' | 'status' | 'roundAt' | 'roundSwept' | 'toleranceMin'>): string | null =>
  t.checkIn && t.status === 'running' && t.roundAt && !t.roundSwept ? new Date(ms(t.roundAt) + toleranceMs(t)).toISOString() : null;

/** Rodada da eliminatória: melhor de N pelo tamanho da fase. */
export const elimRound = (t: Tournament, round: number, pairings: Pairing[]): RoundSpec => ({
  round,
  stage: 'elim',
  bestOf: elimBestOf(pairings.length * 2, t),
  pairings,
});

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
  /** Partidas decididas por W.O., por torneio. */
  noShows: Array<{ tournamentId: string; matchId: number; absent: Array<'p1' | 'p2'> }>;
}

/**
 * Um passo do relógio: começa os torneios cuja hora chegou e dá W.O. a quem não entrou
 * na sala dentro da tolerância. `closeRoom`: fecha a sala em espera de uma partida decidida.
 */
export function tournamentTick(db: DB, now: number, closeRoom?: (roomId: string) => void): TickResult {
  const result: TickResult = { started: [], noShows: [] };
  for (const t of listAutomatic(db)) {
    if (t.status === 'registration') {
      const start = ms(t.startsAt);
      if (Number.isNaN(start) || now < start || now - start > AUTO_START_GRACE_MS) continue;
      const players = listPlayers(db, t.id);
      if (players.length < 2) continue;
      beginTournament(db, t, players, new Date(now).toISOString());
      result.started.push(t.id);
      continue;
    }
    if (t.status !== 'running' || t.roundSwept || !t.roundAt || now < ms(t.roundAt) + toleranceMs(t)) continue;
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
