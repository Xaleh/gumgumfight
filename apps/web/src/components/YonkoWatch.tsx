// Assistir a uma mesa do Yonko: a mesa (`YonkoTable`) só para olhar, ligada ao canal de quem assiste
// (`useYonkoWatch`). Serve ao espectador do app (pela lista "Assistir partidas" ou pelo código da mesa) e à tela de
// transmissão (`broadcast`: a fonte do OBS, sem menus nem botões).
//
// O servidor decide o que chega (`room.watch`): a visão pública, sem a mão de ninguém; a de um jogador (o streamer
// que transmite a própria partida); ou as mãos de todos, onde a mesa as liberou, sempre com atraso. Aqui só se
// escolhe de quem é o lugar de baixo: um jogador fixo, ou quem está jogando.

import type { PlayerId } from '@gumgum/engine';
import { useState } from 'react';
import type { WatchTarget, YonkoRoomInfo } from '../api';
import { useYonkoWatch } from '../game/useYonkoOnline';
import { useT } from '../i18n';
import { Icon } from './Icons';
import { BroadcastIdle } from './Online';
import { useSeatStatus } from './YonkoOnline';
import { YonkoTable } from './YonkoTable';

type Watching = ReturnType<typeof useYonkoWatch>;

export function YonkoWatch({ target, broadcast, onExit }: { target: WatchTarget; broadcast?: boolean; onExit: () => void }) {
  const watch = useYonkoWatch(target);
  const t = useT();
  const { room, state, link } = watch;

  if (link === 'closed') {
    if (broadcast) return <BroadcastIdle title={t('broadcast.matchOver')} text={t('broadcast.waitingHint')} />;
    return (
      <Lobby onExit={onExit}>
        <h3>{t('yonko.closedTitle')}</h3>
        <p className="muted">{t('yonko.watchClosedText')}</p>
      </Lobby>
    );
  }
  if (!room) {
    if (broadcast) return <BroadcastIdle title={t('common.loading')} />;
    return (
      <Lobby onExit={onExit}>
        <p className="muted">{t('common.loading')}</p>
      </Lobby>
    );
  }
  if (!state) {
    // A mesa está na sala de espera (antes da primeira partida, ou entre uma e outra): a partida aparece ao começar.
    if (broadcast) return <BroadcastIdle title={t('yonko.watchWaitingTitle')} text={t('yonko.watchWaitingText')} />;
    return (
      <Lobby onExit={onExit}>
        <h3>{t('yonko.watchWaitingTitle')}</h3>
        <p className="muted">{t('yonko.watchWaitingText')}</p>
        <div className="yk-watch-seats">
          {room.seats.map(
            (s, i) =>
              s && (
                <span key={i} className="yk-chip" title={s.leaderName}>
                  {s.bot && <Icon name="bot" size={14} />} {s.name} · {s.leaderName}
                </span>
              ),
          )}
        </div>
        {link === 'lost' && <p className="notice">{t('yonko.linkLost')}</p>}
      </Lobby>
    );
  }
  return <WatchTable watch={watch} room={room} broadcast={broadcast} onExit={onExit} />;
}

/** As telas de espera de quem assiste, no desenho da sala do Yonko. */
function Lobby({ onExit, children }: { onExit: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="yk-lobby">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('common.back')}
        </button>
        <h2>{t('yonko.title')}</h2>
      </header>
      <div className="yk-lobby-wrap">
        <div className="yk-panel">{children}</div>
      </div>
    </div>
  );
}

function WatchTable({ watch, room, broadcast, onExit }: { watch: Watching; room: YonkoRoomInfo; broadcast?: boolean; onExit: () => void }) {
  const t = useT();
  const state = watch.state!;
  const status = useSeatStatus(room, watch.clockAt);
  /** A visão que chega é a de um jogador (o streamer que transmite a própria partida): o lugar de baixo é o dele. */
  const fixed = room.watch?.pov ?? null;
  // Com as mãos de todos à vista, a tela acompanha quem está jogando (a mão que importa agora); sem elas, fica
  // com quem começou, para a mesa não girar à toa.
  const [choice, setChoice] = useState<PlayerId | 'turn' | null>(null);
  const valid = choice === 'turn' || (choice !== null && choice < state.players.length) ? choice : null;
  const follow: PlayerId | 'turn' = fixed ?? valid ?? (room.watch?.hands ? 'turn' : state.firstPlayer);
  const me = follow === 'turn' ? state.activePlayer : follow;
  const delayMin = Math.round(((room.watch?.delay ?? 0) / 60_000) * 10) / 10;

  return (
    <YonkoTable
      game={{ state, dispatch: () => undefined, error: null }}
      me={me}
      onExit={onExit}
      watch={{ follow, onFollow: fixed === null && !broadcast ? setChoice : undefined, broadcast }}
      extras={{
        pill: broadcast ? t('yonko.title') : delayMin ? t('yonko.pillWatchDelay', { n: delayMin }) : t('yonko.pillWatch'),
        status,
        notice: watch.link === 'lost' ? t('yonko.linkLost') : null,
        spectators: broadcast ? undefined : room.spectators,
      }}
    />
  );
}
