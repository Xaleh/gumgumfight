import { formatLabel } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type LiveRoom, ROLE_LABEL, type WatchTarget } from '../api';
import { useAuth } from '../auth';
import { type MessageKey, useT } from '../i18n';
import { LeaderArt } from './LeaderArt';
import { tierName } from './Online';

const QUEUE_LABEL: Record<LiveRoom['queue'], MessageKey> = {
  ranked: 'watch.queue.ranked',
  casual: 'watch.queue.casual',
  private: 'watch.queue.private',
  bot: 'watch.queue.bot',
  tournament: 'watch.queue.tournament',
};

const HANDS_PREF = 'gumgum.watchHands';

function savedHands(): boolean {
  try {
    return localStorage.getItem(HANDS_PREF) === '1';
  } catch {
    return false;
  }
}

/** Lista das partidas online em andamento para assistir (modo espectador). */
export function Watch({ onExit, onWatch }: { onExit: () => void; onWatch: (t: WatchTarget) => void }) {
  const t = useT();
  const { user } = useAuth();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [canHands, setCanHands] = useState(false);
  const [hands, setHands] = useState(savedHands);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A lista muda sozinha (partidas começam e terminam): atualiza a cada 5 s.
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.online
        .live()
        .then((r) => {
          if (stop) return;
          setRooms(r.rooms);
          setCanHands(r.hands);
        })
        .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [user?.id]);

  const toggleHands = (on: boolean) => {
    setHands(on);
    try {
      localStorage.setItem(HANDS_PREF, on ? '1' : '0');
    } catch {
      /* sem armazenamento */
    }
  };
  // Na própria partida o servidor não mostra as mãos: assiste sem elas.
  const watch = (roomId: string, mine = false) => onWatch({ roomId, hands: canHands && hands && !mine });

  const byCode = async () => {
    setError(null);
    try {
      const room = await api.online.byCode(code);
      watch(room.id, room.mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="coverage watch">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('watch.menu')}
        </button>
        <h2>{t('watch.title')}</h2>
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}

        {canHands ? (
          <label className="check watch-hands">
            <input type="checkbox" checked={hands} onChange={(e) => toggleHands(e.target.checked)} /> {t('watch.showHands')}
            <span className="muted small"> {t('watch.handsRole', { role: user ? t(ROLE_LABEL[user.role]) : t('labels.role.streamer') })}</span>
          </label>
        ) : (
          <p className="muted small">{t('watch.noHandsHint')}</p>
        )}

        <div className="watch-list">
          {rooms === null && !error && <p className="muted">{t('common.loading')}</p>}
          {rooms?.length === 0 && <p className="muted">{t('watch.empty')}</p>}
          {rooms?.map((r) => (
            <button key={r.id} className="watch-room" onClick={() => watch(r.id, r.mine)}>
              <div className="watch-meta">
                <span className="watch-queue">
                  {r.tournament
                    ? `${t('watch.tourLine', { name: r.tournament.name, label: r.tournament.label })}${r.tournament.bestOf > 1 ? t('watch.tourGame', { n: r.tournament.game }) : ''}`
                    : t(QUEUE_LABEL[r.queue])}
                </span>
                {r.mine && (
                  <span className="muted small" title={t('watch.mineTitle')}>
                    {t('watch.mine')}
                  </span>
                )}
                <span className="muted small">
                  {formatLabel(r.format)} · {r.turn ? t('watch.turn', { n: r.turn }) : t('watch.openingHand')}
                  {r.spectators ? ` · 👁 ${r.spectators}` : ''}
                </span>
              </div>
              <div className="watch-players">
                {r.players.map((p, i) => (
                  <div key={i} className={['watch-player', i === 1 ? 'right' : ''].join(' ')}>
                    <LeaderArt name={p.leaderName ?? p.leader} image={p.leaderImage} colors={p.colors} size="small" />
                    <span className="watch-name">
                      <b>{p.bot ? '🤖 ' : ''}{p.name}</b>
                      <span className="muted small">
                        {r.queue === 'ranked' ? `${tierName(t, p.tier)} · ` : ''}❤ {p.life} · ✋ {p.hand}
                      </span>
                    </span>
                  </div>
                ))}
                <span className="vs-badge">{t('watch.vs')}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="field">
          <label>{t('watch.privateRoom')}</label>
          <p className="muted small">{t('watch.privateHint')}</p>
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder={t('watch.codePlaceholder')}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn" disabled={code.length !== 6} onClick={byCode}>
              {t('watch.watch')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
