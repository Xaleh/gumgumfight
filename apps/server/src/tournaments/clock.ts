// Relógio dos torneios com hora marcada (`check_in`): o check-in abre 30 minutos antes
// do início; com `auto_start`, na hora marcada o torneio começa sozinho (rodada 1 sorteada
// entre todos os inscritos e iniciada na hora; sem a opção, o organizador dá o start, mesmo
// com a hora atingida) e, assim que todas as partidas de uma rodada têm resultado, a rodada
// seguinte (ou o top cut, a próxima fase ou o encerramento) é gerada e iniciada sozinha, a
// menos que haja relatos não resolvidos, chamados de Judge abertos ou warnings à espera da
// decisão do organizador (aí a rodada fica à espera, o organizador e os Judges são avisados
// uma vez e o torneio segue sozinho quando tudo for resolvido, ou à mão por `next`); e em
// cada rodada iniciada pelo organizador (`round_started_at`)
// cada jogador tem alguns minutos para entrar na sala. Quem não entra perde por W.O. e sai
// do torneio; se nenhum dos dois entra, os dois perdem (W.O. duplo). Na rodada 1, o
// check-in feito antes também vale como presença. Os 5 minutos são o padrão: o
// organizador escolhe a tolerância (`tolerance_min`).
//
// `tournamentTick` roda a cada poucos segundos no servidor (ver routes.ts) e é
// idempotente: cada rodada é varrida uma vez (`round_wo`), o aviso de check-in sai uma
// vez por hora de início (`checkin_notice`) e o aviso de rodada à espera sai uma vez por
// rodada (`auto_hold_round`).

import { type CardData, type DeckList, type FormatIssue, formatIssues, spoilerIssues, spoilerRule } from '@gumgum/engine';
import { randomInt } from 'node:crypto';
import { type DB, getCards } from '../db';
import { listReports } from '../reports/store';
import { tournamentSpoilerSet } from '../spoiler-set';
import { elimBestOf, type Pairing, singleFirstRound, singleNextRound, singleRounds, standings, swissPairings, swissRounds } from './pairing';
import {
  finishTournament,
  getTournament,
  insertRound,
  listAutomatic,
  listCalls,
  listMatches,
  listPlayers,
  listWarnings,
  markAutoHold,
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
  warningStatus,
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
 * Spoilers: sem a opção, nenhum; com ela, só os da próxima coleção a ser lançada (`tournamentSpoilerSet`).
 */
export function deckIssue(
  db: DB,
  deck: DeckList,
  t: Pick<Tournament, 'format' | 'spoilers'> & Partial<Pick<Tournament, 'spoilerSet' | 'status'>>,
  at: Date,
): FormatIssue | null {
  const issue = formatIssues(deck, t.format, at)[0];
  const rule = spoilerRule(t);
  if (issue || rule === 'all') return issue ?? null;
  const ids = [deck.leader, ...deck.cards.map((c) => c.id)];
  const cards = new Map(getCards(db, ids).map((c) => [c.id, c as CardData]));
  return spoilerIssues(deck, cards, rule, tournamentSpoilerSet(db, t))[0] ?? null;
}

/**
 * Inscritos cujo deck (a lista congelada na inscrição) não vale mais no torneio em `at`: uma
 * carta banida com data marcada (ou incluída na lista depois da inscrição), ou um spoiler de
 * outra coleção que não a próxima a ser lançada (inscrições de antes da regra).
 */
export function staleDecks(db: DB, t: Pick<Tournament, 'format' | 'spoilers'> & Partial<Pick<Tournament, 'spoilerSet' | 'status'>>, players: TournamentPlayer[], at: Date): TournamentPlayer[] {
  return players.filter((p) => deckIssue(db, p.deck, t, at) !== null);
}

/**
 * Fecha as inscrições, sorteia a ordem e gera a primeira rodada. Exige pelo menos 2 inscritos.
 * Com spoilers, grava a coleção aceita (a próxima a ser lançada agora): ela fica no histórico.
 */
export function beginTournament(db: DB, t: Tournament, players: TournamentPlayer[], at: string) {
  const spoilerSet = tournamentSpoilerSet(db, t);
  // Embaralha (Fisher-Yates) para sortear a ordem dos cabeças de chave e da 1ª rodada.
  const order = players.map((p) => p.userId);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seeded = players.map((p) => ({ ...p, seed: order.indexOf(p.userId) + 1 }));
  if (t.structure === 'swiss') {
    const rounds = t.rounds ?? swissRounds(players.length);
    startTournament(db, t.id, order, rounds, { round: 1, stage: 'swiss', bestOf: t.swissBestOf, pairings: swissPairings(seeded, []) }, at, spoilerSet);
  } else {
    startTournament(db, t.id, order, singleRounds(players.length), elimRound(t, 1, singleFirstRound(seeded)), at, spoilerSet);
  }
}

/** Todas as partidas da rodada atual têm resultado. */
export const roundComplete = (t: Pick<Tournament, 'round'>, matches: TournamentMatch[]) => matches.filter((m) => m.round === t.round).every((m) => m.result);

/** Próximo passo depois da rodada atual: outra rodada do suíço, o top cut, a próxima fase ou o fim. */
export function nextStep(t: Tournament, players: TournamentPlayer[], matches: TournamentMatch[]): 'swiss' | 'cut' | 'elim' | 'finish' {
  const current = matches.filter((m) => m.round === t.round);
  const active = players.filter((p) => !p.dropped).length;
  if (current[0]?.stage === 'elim') return current.length <= 1 ? 'finish' : 'elim';
  if (t.round < (t.rounds ?? 0) && active >= 2) return 'swiss';
  return t.topCut && active >= 2 ? 'cut' : 'finish';
}

/** Jogadores com decisão de warnings pendente (atingiram o limite e o organizador ainda não decidiu manter ou eliminar). */
export function pendingWarnings(db: DB, t: Tournament, players: TournamentPlayer[]): TournamentPlayer[] {
  if (t.maxWarnings === null) return [];
  const all = listWarnings(db, t.id);
  return players.filter((p) => warningStatus(t, p, all.filter((w) => w.userId === p.userId)).pending);
}

/**
 * Com a rodada atual completa: gera a próxima rodada (do suíço, o top cut ou a próxima fase da chave) ou
 * encerra o torneio. Devolve o passo dado (`elim` sem ninguém para avançar, por W.O. duplo nas mesas que
 * restavam, também encerra). Não confere se a rodada está completa nem os warnings: ver `nextStep` e
 * `pendingWarnings`.
 */
export function advanceRound(db: DB, t: Tournament, players: TournamentPlayer[], matches: TournamentMatch[], at: string): 'swiss' | 'cut' | 'elim' | 'finish' {
  const step = nextStep(t, players, matches);
  const round = t.round + 1;
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
  return step;
}

/** O que segura a próxima rodada no início automático: relatos não resolvidos, chamados de Judge abertos e warnings à espera de decisão. */
export interface AutoHold {
  /** Relatos dos jogadores (e chamados de ajuste) deste torneio ainda não resolvidos. */
  reports: number;
  /** Chamados de Judge ainda abertos. */
  calls: number;
  /** Quem atingiu o limite de warnings e espera a decisão do organizador. */
  warnings: string[];
}

/**
 * Por que o início automático não gera a próxima rodada agora (null = nada segura). Vale para o torneio
 * com `autoStart` em andamento e a rodada completa; os relatos e os chamados são conferidos no torneio
 * inteiro (um problema relatado numa rodada passada ainda pode mudar um resultado).
 */
export function autoNextHold(db: DB, t: Tournament, players: TournamentPlayer[]): AutoHold | null {
  const hold: AutoHold = {
    reports: listReports(db, { tournamentId: t.id, status: 'open' }).length,
    calls: listCalls(db, t.id).filter((c) => !c.resolvedAt).length,
    warnings: pendingWarnings(db, t, players).map((p) => p.name),
  };
  return hold.reports || hold.calls || hold.warnings.length ? hold : null;
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
  /** Rodadas geradas e iniciadas sozinhas (`finished`: em vez de rodada nova, o torneio encerrou). */
  advanced: Array<{ tournamentId: string; round: number; step: 'swiss' | 'cut' | 'elim' | 'finish'; finished: boolean }>;
  /** Rodadas completas cuja próxima rodada ficou à espera (o aviso sai uma vez por rodada). */
  held: Array<{ tournamentId: string; round: number; hold: AutoHold }>;
}

/**
 * Um passo do relógio: começa os torneios com início automático cuja hora chegou (a rodada 1
 * já sai iniciada: `round_started_at`), gera e inicia a rodada seguinte dos torneios com início
 * automático cuja rodada terminou (salvo relatos, chamados ou warnings pendentes) e dá W.O. a
 * quem não entrou na sala dentro da tolerância da rodada iniciada. `closeRoom`: fecha a sala em
 * espera de uma partida decidida.
 */
export function tournamentTick(db: DB, now: number, closeRoom?: (roomId: string) => void): TickResult {
  const result: TickResult = { started: [], removed: [], checkIns: [], noShows: [], advanced: [], held: [] };
  for (const t of listAutomatic(db)) {
    if (t.status === 'registration') {
      if (t.startsAt && checkInOpen(t, now) && t.checkInNotice !== t.startsAt && now < ms(t.startsAt)) {
        markCheckInNotice(db, t.id, t.startsAt);
        result.checkIns.push(t.id);
      }
      const start = ms(t.startsAt);
      if (!t.autoStart || Number.isNaN(start) || now < start || now - start > AUTO_START_GRACE_MS) continue;
      // Deck que deixou de valer (banimento com data, spoiler de outra coleção) não joga: a inscrição é cancelada.
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
    if (t.status !== 'running') continue;
    if (t.autoStart) {
      const matches = listMatches(db, t.id);
      if (roundComplete(t, matches)) {
        const players = listPlayers(db, t.id);
        const hold = autoNextHold(db, t, players);
        if (hold) {
          if (t.autoHoldRound !== t.round) {
            markAutoHold(db, t.id, t.round);
            result.held.push({ tournamentId: t.id, round: t.round, hold });
          }
          continue;
        }
        const at = new Date(now).toISOString();
        const step = advanceRound(db, t, players, matches, at);
        const after = getTournament(db, t.id)!;
        // Sem o organizador para dar o start, a rodada gerada começa na hora.
        if (after.status === 'running') startRound(db, t.id, at);
        result.advanced.push({ tournamentId: t.id, round: after.round, step, finished: after.status === 'finished' });
        continue;
      }
    }
    if (t.roundSwept || !t.roundStartedAt || now < ms(t.roundStartedAt) + toleranceMs(t)) continue;
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
