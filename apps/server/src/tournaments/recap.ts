// Kit de divulgação do torneio encerrado: tudo o que as imagens para redes sociais e o
// PDF precisam, já agregado (campeão e campanha com play/draw por jogo, listas do top 4
// com as cartas, líderes do top 8 e de todos os inscritos). As peças são desenhadas no
// navegador de quem organiza (ver apps/web/src/components/TournamentRecap.tsx).

import { proxiedImageUrl } from '../card-images';
import { type DB, getCards } from '../db';
import type { ApiCard } from '../present';
import type { publicSponsor } from '../support/sponsors';
import { type Stage, standings, winnerOf } from './pairing';
import { listGames, listMatches, listPlayers, type Tournament, type TournamentMatch, type TournamentPlayer } from './store';

type PublicSponsorInfo = ReturnType<typeof publicSponsor>;

export interface RecapCard {
  id: string;
  name: string;
  /** Coleção (OP01, ST10…): separa líderes de mesmo nome. */
  set: string | null;
  cost: number | null;
  category: string;
  colors: string[];
  /** Imagem pelo mesmo domínio (`/card-img/…`), para desenhar no canvas; null = sem arte. */
  image: string | null;
}

export interface RecapRecord {
  wins: number;
  losses: number;
  byes: number;
}

export interface RecapPlayer {
  rank: number;
  userId: string;
  name: string;
  dropped: boolean;
  deckName: string;
  leader: RecapCard;
  /** Cartas do deck (sem o líder), ordenadas por custo; cada carta uma vez, com a quantidade. */
  cards: Array<RecapCard & { count: number }>;
  /** Campanha no suíço (null = eliminação simples). */
  swiss: RecapRecord | null;
  /** Campanha na eliminatória (top cut ou a chave; null = não entrou). */
  elim: RecapRecord | null;
}

export interface RecapGame {
  game: number;
  /** O campeão venceu este jogo (null = jogo sem vencedor). */
  won: boolean | null;
  /** O campeão começou (na play) ou foi o segundo (na draw); null = sem o dado. */
  first: boolean | null;
}

export interface RecapRound {
  round: number;
  stage: Stage;
  /** Vagas da fase (eliminatória): 2 = final, 4 = semifinal… */
  size: number;
  bestOf: number;
  opponent: { name: string; leader: RecapCard } | null;
  outcome: 'win' | 'loss' | 'bye' | 'none' | 'pending';
  /** Placar da série do ponto de vista do campeão. */
  score: [number, number];
  /** Como o resultado saiu: jogos no site, bye, desistência, W.O. automático, inscrição atrasada ou lançado pelo organizador. */
  how: 'game' | 'bye' | 'drop' | 'noshow' | 'late' | 'organizer' | null;
  games: RecapGame[];
}

export interface LeaderCount {
  leader: RecapCard;
  count: number;
}

export interface TournamentRecap {
  tournament: {
    id: string;
    name: string;
    format: string;
    /** Aceita cartas de spoiler (Standard ou EGB + spoilers; o Livre sempre aceita). */
    spoilers: boolean;
    structure: Tournament['structure'];
    topCut: number | null;
    players: number;
    /** Rodadas do suíço jogadas (null = eliminação simples). */
    swissRounds: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    organizerName: string | null;
    official: boolean;
    prize: string | null;
    sponsor: PublicSponsorInfo | null;
    /** Encerrado antes da última rodada: o campeão é o 1º da classificação naquele momento. */
    earlyFinish: boolean;
  };
  champion: RecapPlayer | null;
  campaign: RecapRound[];
  /** Top 4 (o campeão incluído), na ordem da classificação. */
  top: RecapPlayer[];
  leadersTop8: LeaderCount[];
  leadersAll: LeaderCount[];
  /** Imagens das cartas ligadas no servidor (CARD_IMAGES); desligadas, o kit sai sem arte. */
  cardImages: boolean;
}

interface Options {
  present: (cards: ApiCard[]) => ApiCard[];
  cardImages: boolean;
  sponsor: PublicSponsorInfo | null;
  /** O torneio chegou ao fim pelas rodadas previstas (false = encerrado antes, por /finish). */
  naturalEnd: boolean;
}

/** Data do SQLite ("2026-10-14 02:06:46", em UTC) em ISO; as que já são ISO ficam como estão. */
export const iso = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d) ? `${d.replace(' ', 'T')}Z` : d);

const how = (m: TournamentMatch): RecapRound['how'] => {
  if (!m.result) return null;
  if (m.reportedBy === null) return 'organizer';
  return (['game', 'bye', 'drop', 'noshow', 'late'] as const).find((r) => r === m.reportedBy) ?? 'organizer';
};

/** Quem começou cada jogo gravado nas estatísticas, por conta (`user:<id>`). */
function wentFirst(db: DB, statsMatchId: number, userId: string): boolean | null {
  const r = db
    .prepare(
      `SELECT s.went_first FROM match_seats s JOIN players p ON p.id = s.player_id
       WHERE s.match_id = ? AND p.owner_hash = ?`,
    )
    .get(statsMatchId, `user:${userId}`) as { went_first: number } | undefined;
  return r ? Boolean(r.went_first) : null;
}

const record = (ms: TournamentMatch[], userId: string): RecapRecord | null => {
  const mine = ms.filter((m) => m.p1 === userId || m.p2 === userId);
  if (!mine.length) return null;
  const r = { wins: 0, losses: 0, byes: 0 };
  for (const m of mine) {
    if (m.result === 'bye') r.byes++;
    else if (winnerOf(m) === userId) r.wins++;
    else if (m.result) r.losses++;
  }
  return r;
};

export function buildRecap(db: DB, t: Tournament, { present, cardImages, sponsor, naturalEnd }: Options): TournamentRecap {
  const players = listPlayers(db, t.id);
  const matches = listMatches(db, t.id);
  const games = listGames(db, t.id);
  const table = standings(players, matches);
  const byId = new Map(players.map((p) => [p.userId, p] as const));

  const cards = new Map(
    present(getCards(db, [...new Set(players.flatMap((p) => [p.deck.leader, ...p.deck.cards.map((c) => c.id)]))])).map((c) => [c.id, c] as const),
  );
  const card = (id: string): RecapCard => {
    const c = cards.get(id);
    return {
      id,
      name: c?.name ?? id,
      set: c?.set ?? id.split('-')[0] ?? null,
      cost: c?.cost ?? null,
      category: c?.category ?? 'character',
      colors: c?.colors ?? [],
      image: cardImages ? proxiedImageUrl(c?.imageUrl) : null,
    };
  };

  const swiss = matches.filter((m) => m.stage === 'swiss');
  const elim = matches.filter((m) => m.stage === 'elim');
  const player = (p: TournamentPlayer, rank: number): RecapPlayer => ({
    rank,
    userId: p.userId,
    name: p.name,
    dropped: p.dropped,
    deckName: p.deck.name,
    leader: card(p.deck.leader),
    cards: p.deck.cards
      .map((c) => ({ ...card(c.id), count: c.count }))
      .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.id.localeCompare(b.id)),
    swiss: t.structure === 'swiss' ? (record(swiss, p.userId) ?? { wins: 0, losses: 0, byes: 0 }) : null,
    elim: record(elim, p.userId),
  });

  const top = table.slice(0, 4).map((s) => player(byId.get(s.userId)!, s.rank));
  const champion = top[0] ?? null;

  const campaign: RecapRound[] = champion
    ? matches
        .filter((m) => m.p1 === champion.userId || m.p2 === champion.userId)
        .map((m) => {
          const mine = m.p1 === champion.userId;
          const oppId = mine ? m.p2 : m.p1;
          const opp = oppId ? byId.get(oppId) : undefined;
          const winner = winnerOf(m);
          const outcome: RecapRound['outcome'] =
            m.result === 'bye' ? 'bye' : m.result === 'none' ? 'none' : !m.result ? 'pending' : winner === champion.userId ? 'win' : 'loss';
          return {
            round: m.round,
            stage: m.stage,
            size: matches.filter((x) => x.round === m.round).length * 2,
            bestOf: m.bestOf,
            opponent: opp ? { name: opp.name, leader: card(opp.deck.leader) } : null,
            outcome,
            score: mine ? m.wins : [m.wins[1], m.wins[0]],
            how: how(m),
            // Só os jogos que contaram no placar da série, na ordem.
            games: games
              .filter((g) => g.matchId === m.id && g.counted)
              .sort((a, b) => a.game - b.game)
              .map((g) => ({
                game: g.game,
                won: g.winner ? g.winner === champion.userId : null,
                first: g.statsMatchId ? wentFirst(db, g.statsMatchId, champion.userId) : null,
              })),
          };
        })
    : [];

  const countLeaders = (ps: TournamentPlayer[]): LeaderCount[] => {
    const counts = new Map<string, number>();
    for (const p of ps) counts.set(p.deck.leader, (counts.get(p.deck.leader) ?? 0) + 1);
    return [...counts]
      .map(([id, count]) => ({ leader: card(id), count }))
      .sort((a, b) => b.count - a.count || a.leader.name.localeCompare(b.leader.name) || a.leader.id.localeCompare(b.leader.id));
  };

  return {
    tournament: {
      id: t.id,
      name: t.name,
      format: t.format,
      spoilers: t.spoilers,
      structure: t.structure,
      topCut: t.topCut,
      players: players.length,
      swissRounds: t.structure === 'swiss' ? new Set(swiss.map((m) => m.round)).size : null,
      startedAt: iso(t.startedAt),
      finishedAt: iso(t.finishedAt),
      organizerName: t.organizerName,
      official: t.official,
      prize: t.prize,
      sponsor,
      earlyFinish: !naturalEnd,
    },
    champion,
    campaign,
    top,
    leadersTop8: countLeaders(table.slice(0, 8).map((s) => byId.get(s.userId)!)),
    leadersAll: countLeaders(players),
    cardImages,
  };
}
