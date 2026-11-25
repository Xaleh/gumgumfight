// Perfil público do jogador (roadmap E1): a página aberta por link (`/?perfil=<id>`) com o cartaz
// WANTED, a recompensa, os Líderes mais jogados, as partidas recentes (com replay, quando liberado)
// e os decks escolhidos. O jogador escolhe o que aparece (`PUT /api/players/me/profile`).
//
//   GET /api/profiles/:id                        o perfil como os outros o veem (+ `settings` para o dono)
//   GET /api/profiles/:id/matches/:m/replay      replay de uma partida do perfil (regras em store.ts)
//   PUT /api/players/me/profile                  o que aparece: { visible, leaders, matches, replays, decks }

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type DB, getCards, getDeck } from '../db';
import { fail } from '../errors';
import type { ApiCard } from '../present';
import { matchReplay } from '../reports/store';
import { tierFor } from '../stats/catalog';
import { ensurePlayer, findPlayer } from '../stats/store';
import {
  PROFILE_MAX_DECKS,
  type ProfilePlayer,
  type ProfileSettings,
  playerById,
  profileDecks,
  profileMatch,
  profileMatches,
  profileRecord,
  profileSettings,
  saveProfileSettings,
} from './store';

interface Deps {
  db: DB;
  viewerHash: (req: FastifyRequest) => string | null;
  present: (cards: ApiCard[]) => ApiCard[];
}

/** Id de jogador bem formado (`p-` + 12 hex); o resto nem consulta o banco. */
const PLAYER_ID = /^p-[0-9a-f]{12}$/;

export function registerProfileRoutes(app: FastifyInstance, { db, viewerHash, present }: Deps) {
  const cardInfo = (ids: Iterable<string>) => {
    const out: Record<string, { name: string; category: string; colors: string[]; imageUrl?: string }> = {};
    for (const c of present(getCards(db, [...new Set(ids)]))) out[c.id] = { name: c.name, category: c.category, colors: c.colors, imageUrl: c.imageUrl };
    return out;
  };

  /** O jogador do perfil e se quem pede é o dono; null = não existe ou está escondido para quem pede. */
  const open = (req: FastifyRequest, id: string): { player: ProfilePlayer; settings: ProfileSettings; mine: boolean } | null => {
    if (!PLAYER_ID.test(id)) return null;
    const player = playerById(db, id);
    if (!player) return null;
    const mine = viewerHash(req) === player.ownerHash;
    const settings = profileSettings(db, player.id);
    // Escondido responde igual a inexistente: o link não confirma que o perfil existe.
    if (!settings.visible && !mine) return null;
    return { player, settings, mine };
  };
  const notFound = fail('profileNotFound', 'Perfil não encontrado.');

  app.get<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    const p = open(req, req.params.id);
    if (!p) return reply.code(404).send(notFound);
    const { player, settings, mine } = p;
    const record = settings.leaders ? profileRecord(db, player.id) : null;
    const matches = settings.matches ? profileMatches(db, player.id, settings) : null;
    const decks = profileDecks(db, player, settings.decks);
    return {
      id: player.id,
      name: player.name,
      bounty: player.bounty,
      tier: tierFor(player.bounty).id,
      rankedGames: player.rankedGames,
      since: player.createdAt,
      record: record ? { games: record.games, wins: record.wins } : null,
      leaders: record?.leaders ?? null,
      matches,
      decks,
      mine,
      /** Só para o dono: o que ele escolheu mostrar (a página abre o painel de edição). */
      ...(mine ? { settings } : {}),
      cards: cardInfo([
        ...(record?.leaders.map((l) => l.leader) ?? []),
        ...(matches?.flatMap((m) => [m.leader, m.oppLeader]) ?? []),
        ...decks.map((d) => d.leader),
      ]),
    };
  });

  app.get<{ Params: { id: string; matchId: string } }>('/api/profiles/:id/matches/:matchId/replay', async (req, reply) => {
    const p = open(req, req.params.id);
    if (!p) return reply.code(404).send(notFound);
    const matchId = Number(req.params.matchId);
    // Com as partidas escondidas, nenhuma delas (nem o replay) sai do perfil.
    const m = p.settings.matches && Number.isInteger(matchId) && matchId > 0 ? profileMatch(db, p.player.id, p.settings, matchId) : null;
    if (!m) return reply.code(404).send(fail('matchNotFound', 'Partida não encontrada.'));
    if (!m.replay) return reply.code(403).send(fail('profileReplayHidden', 'O replay desta partida não é público.'));
    return matchReplay(db, matchId) ?? reply.code(404).send(fail('noReplay', 'Esta partida não tem replay gravado.'));
  });

  app.put<{ Body: Partial<Record<keyof ProfileSettings, unknown>> }>('/api/players/me/profile', async (req, reply) => {
    const owner = viewerHash(req);
    if (!owner) return reply.code(400).send(fail('noOwner', 'Navegador sem código de dono (header x-deck-owner).'));
    const b = req.body ?? {};
    const me = ensurePlayer(db, owner);
    const now = profileSettings(db, me.id);
    const flag = (v: unknown, keep: boolean) => (typeof v === 'boolean' ? v : keep);
    let decks = now.decks;
    if (b.decks !== undefined) {
      if (!Array.isArray(b.decks) || b.decks.length > PROFILE_MAX_DECKS || b.decks.some((d) => typeof d !== 'string')) {
        return reply.code(400).send(fail('profileDecksInvalid', `Escolha até ${PROFILE_MAX_DECKS} decks.`, { max: PROFILE_MAX_DECKS }));
      }
      decks = [...new Set(b.decks as string[])];
      for (const id of decks) {
        const d = getDeck(db, id);
        if (!d || d.kind !== 'user' || d.ownerHash !== owner) return reply.code(400).send(fail('deckNotMine', 'Este deck pertence a outro jogador.'));
      }
    }
    const settings: ProfileSettings = {
      visible: flag(b.visible, now.visible),
      leaders: flag(b.leaders, now.leaders),
      matches: flag(b.matches, now.matches),
      replays: flag(b.replays, now.replays),
      decks,
    };
    saveProfileSettings(db, me.id, settings);
    return { id: findPlayer(db, owner)!.id, settings };
  });
}
