// Painel do meta dos torneios (inspirado em sites de estatísticas de torneios como o
// ChinoizeCupStats): totais, último torneio e campeão, próximos torneios, Líderes por
// participação e taxa de vitória, e o ranking de jogadores.
//
// Só entram torneios encerrados (como nas Estatísticas Pro, o meta competitivo não mostra
// torneio em andamento) e só o que já é público na página de cada um depois do fim: o
// Líder de cada inscrito, o resultado das séries e a classificação. As vitórias contam
// séries (melhor de 1, 3 ou 5), não jogos; bye, derrota dupla e espelho ficam de fora.

import { type DB, getCards } from '../db';
import type { ApiCard } from '../present';
import type { FormatId } from '../stats/catalog';
import { standings, winnerOf } from './pairing';
import { iso } from './recap';
import { listFinished, listMatches, listOpen, listPlayers, type Tournament } from './store';

export interface MetaEvent {
  id: string;
  name: string;
  format: FormatId;
  spoilers: boolean;
  official: boolean;
  finishedAt: string | null;
  players: number;
  /** Campeão: o 1º da classificação final (null = torneio sem partidas decididas). */
  champion: { name: string; leader: string } | null;
}

export interface MetaUpcoming {
  id: string;
  name: string;
  format: FormatId;
  spoilers: boolean;
  official: boolean;
  prize: string | null;
  status: 'registration' | 'running';
  startsAt: string | null;
  players: number;
  maxPlayers: number | null;
}

export interface MetaLeader {
  leader: string;
  /** Inscrições com este Líder. */
  entries: number;
  /** Fração das inscrições do período. */
  share: number;
  /** Séries vencidas e perdidas contra outros Líderes (espelho fora). */
  wins: number;
  losses: number;
  /** Torneios vencidos. */
  titles: number;
}

export interface MetaPlayer {
  name: string;
  events: number;
  titles: number;
  /** Séries vencidas e perdidas (bye fora). */
  wins: number;
  losses: number;
  /** Líder mais usado no período. */
  leader: string;
}

export interface TournamentMeta {
  totals: { events: number; players: number; leaders: number; matches: number };
  latest: MetaEvent | null;
  recent: MetaEvent[];
  upcoming: MetaUpcoming[];
  leaders: MetaLeader[];
  players: MetaPlayer[];
  cards: Record<string, { name: string; category: string; colors: string[]; imageUrl?: string }>;
}

export interface MetaOptions {
  format?: FormatId;
  /** Só torneios encerrados nos últimos N dias (sem: todos). */
  days?: number;
  now: number;
  present: (cards: ApiCard[]) => ApiCard[];
}

/** Torneios recentes no painel. */
const RECENT = 6;
/** Próximos torneios no painel. */
const UPCOMING = 4;
/** Jogadores no ranking. */
const TOP_PLAYERS = 10;

/** Data em JS → texto do SQLite ("2026-10-14 02:06:46", UTC), para comparar com `finished_at`. */
const sqliteDate = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export function buildMeta(db: DB, { format, days, now, present }: MetaOptions): TournamentMeta {
  const since = days ? sqliteDate(now - days * 86_400_000) : undefined;
  const leaders = new Map<string, MetaLeader>();
  const players = new Map<string, MetaPlayer & { uses: Map<string, number> }>();
  const events: MetaEvent[] = [];
  let matches = 0;

  const leaderRow = (id: string) => {
    let l = leaders.get(id);
    if (!l) leaders.set(id, (l = { leader: id, entries: 0, share: 0, wins: 0, losses: 0, titles: 0 }));
    return l;
  };

  for (const t of listFinished(db, { format, since })) {
    const ps = listPlayers(db, t.id);
    const ms = listMatches(db, t.id);
    // Encerrado sem nenhuma partida decidida: não chegou a acontecer.
    if (!ms.some((m) => m.result)) continue;
    const leaderOf = new Map(ps.map((p) => [p.userId, p.deck.leader] as const));
    for (const p of ps) {
      leaderRow(p.deck.leader).entries++;
      let row = players.get(p.userId);
      if (!row) players.set(p.userId, (row = { name: p.name, events: 0, titles: 0, wins: 0, losses: 0, leader: p.deck.leader, uses: new Map() }));
      row.events++;
      row.uses.set(p.deck.leader, (row.uses.get(p.deck.leader) ?? 0) + 1);
    }
    for (const m of ms) {
      if (!m.p2 || (m.result !== 'p1' && m.result !== 'p2')) continue;
      matches++;
      const w = winnerOf(m)!;
      const l = w === m.p1 ? m.p2 : m.p1;
      const wp = players.get(w);
      const lp = players.get(l);
      if (wp) wp.wins++;
      if (lp) lp.losses++;
      const [wl, ll] = [leaderOf.get(w), leaderOf.get(l)];
      if (wl && ll && wl !== ll) {
        leaderRow(wl).wins++;
        leaderRow(ll).losses++;
      }
    }
    const first = standings(ps, ms)[0];
    const champ = first ? ps.find((p) => p.userId === first.userId) : undefined;
    if (champ) {
      leaderRow(champ.deck.leader).titles++;
      players.get(champ.userId)!.titles++;
    }
    events.push(event(t, ps.length, champ ? { name: champ.name, leader: champ.deck.leader } : null));
  }

  const entries = [...leaders.values()].reduce((n, l) => n + l.entries, 0);
  const leaderList = [...leaders.values()]
    .map((l) => ({ ...l, share: entries ? l.entries / entries : 0 }))
    .sort((a, b) => b.entries - a.entries || b.titles - a.titles || b.wins - a.wins || a.leader.localeCompare(b.leader));
  const playerList = [...players.values()]
    .map(({ uses, ...p }) => ({ ...p, leader: [...uses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] }))
    .sort(
      (a, b) =>
        b.titles - a.titles ||
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.events - a.events ||
        a.name.localeCompare(b.name),
    )
    .slice(0, TOP_PLAYERS);
  const upcoming = listOpen(db, { format, limit: UPCOMING }).map(
    (t): MetaUpcoming => ({
      id: t.id,
      name: t.name,
      format: t.format,
      spoilers: t.spoilers,
      official: t.official,
      prize: t.prize,
      status: t.status === 'running' ? 'running' : 'registration',
      startsAt: t.startsAt,
      players: t.players,
      maxPlayers: t.maxPlayers,
    }),
  );

  const recent = events.slice(0, RECENT);
  const ids = [...leaderList.map((l) => l.leader), ...recent.flatMap((e) => (e.champion ? [e.champion.leader] : []))];
  const cards: TournamentMeta['cards'] = {};
  for (const c of present(getCards(db, [...new Set(ids)]))) {
    cards[c.id] = { name: c.name, category: c.category, colors: c.colors, imageUrl: c.imageUrl };
  }

  return {
    totals: { events: events.length, players: players.size, leaders: leaders.size, matches },
    latest: events[0] ?? null,
    recent,
    upcoming,
    leaders: leaderList,
    players: playerList,
    cards,
  };
}

const event = (t: Tournament, players: number, champion: MetaEvent['champion']): MetaEvent => ({
  id: t.id,
  name: t.name,
  format: t.format,
  spoilers: t.spoilers,
  official: t.official,
  finishedAt: iso(t.finishedAt),
  players,
  champion,
});
