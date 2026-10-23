import type { CardData } from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type LiveRoom, type RoomDecks } from '../api';
import { useT } from '../i18n';
import { poll } from '../poll';
import { StaticCard } from './CardView';
import { LiveRoomRow } from './Watch';

/**
 * Painel "Partidas" de quem transmite: as salas em transmissão agora, agrupadas por torneio (clicando
 * no torneio, as salas dos jogos) e as avulsas. Clicar numa sala troca a partida assistida.
 */
export function MatchesPanel({ currentId, onWatch }: { currentId: string | null; onWatch: (room: LiveRoom) => void }) {
  const t = useT();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Torneio expandido; null = o da partida assistida (ou o primeiro); '' = todos fechados. */
  const [open, setOpen] = useState<string | null>(null);

  // A lista muda sozinha (partidas começam e terminam): atualiza a cada 5 s, como na tela "Assistir".
  useEffect(() => {
    let stop = false;
    const cancel = poll(
      () =>
        api.online.live().then(
          (r) => {
            if (stop) return;
            setRooms(r.rooms);
            setError(null);
          },
          (e) => {
            if (!stop) setError(e instanceof Error ? e.message : String(e));
            throw e;
          },
        ),
      5000,
    );
    return () => {
      stop = true;
      cancel();
    };
  }, []);

  const groups = useMemo(() => {
    const tournaments = new Map<string, { id: string; name: string; rooms: LiveRoom[] }>();
    const single: LiveRoom[] = [];
    for (const r of rooms ?? []) {
      if (!r.tournament) {
        single.push(r);
        continue;
      }
      const g = tournaments.get(r.tournament.id) ?? { id: r.tournament.id, name: r.tournament.name, rooms: [] };
      g.rooms.push(r);
      tournaments.set(g.id, g);
    }
    return { tournaments: [...tournaments.values()], single };
  }, [rooms]);
  const currentTournament = rooms?.find((r) => r.id === currentId)?.tournament?.id ?? null;
  const opened = open === null ? (currentTournament ?? groups.tournaments[0]?.id ?? '') : open;

  return (
    <div className="matches-panel">
      {error && <div className="error">{error}</div>}
      <h4>{t('watch.tournamentsLive')}</h4>
      {rooms === null && !error && <p className="muted small">{t('common.loading')}</p>}
      {rooms && groups.tournaments.length === 0 && <p className="muted small">{t('watch.noTournaments')}</p>}
      {groups.tournaments.map((g) => (
        <section key={g.id} className={['live-group', opened === g.id ? 'open' : ''].join(' ')}>
          <button type="button" className="live-group-head" onClick={() => setOpen(opened === g.id ? '' : g.id)} aria-expanded={opened === g.id}>
            <span className="live-group-name">🏆 {g.name}</span>
            <span className="muted small">{t('watch.rooms', { n: g.rooms.length })}</span>
            <span className="chev" aria-hidden="true" />
          </button>
          {opened === g.id && (
            <div className="watch-list">
              {g.rooms.map((r) => (
                <LiveRoomRow key={r.id} room={r} short current={r.id === currentId} onClick={() => onWatch(r)} />
              ))}
            </div>
          )}
        </section>
      ))}
      <h4>{t('watch.standaloneLive')}</h4>
      {rooms && groups.single.length === 0 && <p className="muted small">{t('watch.noStandalone')}</p>}
      {groups.single.length > 0 && (
        <div className="watch-list">
          {groups.single.map((r) => (
            <LiveRoomRow key={r.id} room={r} current={r.id === currentId} onClick={() => onWatch(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

const CATEGORY_ORDER: Record<string, number> = { leader: 0, character: 1, event: 2, stage: 3 };

/**
 * Painel de decklist de quem transmite: o deck de um dos jogadores da partida (escolhido no alto).
 * O servidor só entrega os decks com a mesma permissão de "Ver mãos".
 */
export function DeckPanel({ roomId, onZoom }: { roomId: string; onZoom: (card: CardData) => void }) {
  const load = useCallback(() => api.online.decks(roomId), [roomId]);
  return <DeckListPanel load={load} onZoom={onZoom} />;
}

/**
 * Decklist da mesa: os decks que `load` traz (os dois, para quem transmite; só o próprio, para quem joga),
 * com o Líder e as cartas em ordem de tipo, custo e nome, cada uma com a quantidade; clicando, a carta
 * ampliada (`onZoom`, por cima da mesa). Com mais de um deck, o jogador é escolhido no alto.
 * `load` precisa ser estável (useCallback): cada nova função busca de novo.
 */
export function DeckListPanel({ load, onZoom }: { load: () => Promise<RoomDecks>; onZoom: (card: CardData) => void }) {
  const t = useT();
  const [data, setData] = useState<RoomDecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState(0);
  useEffect(() => {
    let stop = false;
    setData(null);
    setError(null);
    load().then(
      (d) => !stop && setData(d),
      (e: unknown) => !stop && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      stop = true;
    };
  }, [load]);
  const cards = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const player = data?.players[who] ?? data?.players[0];
  const leader = player ? cards.get(player.deck.leader) : undefined;
  const list = useMemo(() => {
    if (!player) return [];
    return player.deck.cards
      .map((c) => ({ card: cards.get(c.id), id: c.id, count: c.count }))
      .sort((a, b) => {
        const ca = a.card ? (CATEGORY_ORDER[a.card.category] ?? 9) : 9;
        const cb = b.card ? (CATEGORY_ORDER[b.card.category] ?? 9) : 9;
        return ca - cb || (a.card?.cost ?? 0) - (b.card?.cost ?? 0) || (a.card?.name ?? a.id).localeCompare(b.card?.name ?? b.id);
      });
  }, [player, cards]);
  const total = player ? player.deck.cards.reduce((n, c) => n + c.count, 0) : 0;
  return (
    <div className="deck-panel">
      {error && <p className="muted small">{error}</p>}
      {!data && !error && <p className="muted small">{t('common.loading')}</p>}
      {data && data.players.length > 1 && (
        <div className="seg small deck-who" role="tablist">
          {data.players.map((p, i) => (
            <button key={i} type="button" role="tab" aria-selected={who === i} className={who === i ? 'on' : ''} onClick={() => setWho(i)}>
              {p.bot ? '🤖 ' : ''}
              {p.name}
            </button>
          ))}
        </div>
      )}
      {player && (
        <>
          <div className="deck-head">
            <b>{player.deck.name}</b>
            <span className="muted small">{t('deck.curveCards', { n: total })}</span>
          </div>
          <div className="card-list deck-cards">
            {leader && <StaticCard card={leader} onClick={() => onZoom(leader)} />}
            {list.map(({ card, id, count }) =>
              card ? (
                <StaticCard key={id} card={card} badge={<span className="count-badge">×{count}</span>} onClick={() => onZoom(card)} />
              ) : (
                <span key={id} className="muted small">
                  {count}× {id}
                </span>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
