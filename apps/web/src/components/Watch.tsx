import { formatLabel } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type BroadcastInfo, broadcastUrl, type LiveRoom, ROLE_LABEL, type WatchTarget } from '../api';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { LeaderArt } from './LeaderArt';
import { QUEUE_LABEL, tierName } from './Online';

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
  /** Modo transmissão (quem vê as mãos): o link do OBS e a partida na live. */
  const [broadcast, setBroadcast] = useState<(BroadcastInfo & { key: string | null }) | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

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
  useEffect(() => {
    if (!canHands) return setBroadcast(null);
    api.broadcast.mine().then(setBroadcast, fail);
  }, [canHands, user?.id]);

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
  /** Manda a partida para a tela de transmissão (com as mãos, se "Ver as mãos" estiver marcado). */
  const transmit = (r: LiveRoom | null) => {
    setError(null);
    api.broadcast.choose(r?.id ?? null, Boolean(r && hands && !r.mine)).then(setBroadcast, fail);
  };
  const onAir = broadcast?.key ? broadcast.roomId : null;

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

        {broadcast && (
          <BroadcastPanel
            info={broadcast}
            onAir={rooms?.find((r) => r.id === onAir) ?? null}
            onNewKey={() => {
              if (broadcast.key && !window.confirm(t('broadcast.newKeyConfirm'))) return;
              api.broadcast.newKey().then(setBroadcast, fail);
            }}
            onClear={() => transmit(null)}
          />
        )}

        <div className="watch-list">
          {rooms === null && !error && <p className="muted">{t('common.loading')}</p>}
          {rooms?.length === 0 && <p className="muted">{t('watch.empty')}</p>}
          {rooms?.map((r) => (
            <div key={r.id} className={['watch-room-row', onAir === r.id ? 'on-air' : ''].join(' ')}>
              <button className="watch-room" onClick={() => watch(r.id, r.mine)}>
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
              {broadcast?.key && (
                <button
                  className={['btn', 'small', 'broadcast-btn', onAir === r.id ? 'primary' : ''].join(' ')}
                  onClick={() => transmit(onAir === r.id ? null : r)}
                  title={onAir === r.id ? t('broadcast.onAirTitle') : t('broadcast.transmitTitle')}
                >
                  {onAir === r.id ? t('broadcast.onAir') : t('broadcast.transmit')}
                </button>
              )}
            </div>
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

/** Painel do modo transmissão: o link para a fonte de navegador do OBS e a partida que está na live. */
function BroadcastPanel({
  info,
  onAir,
  onNewKey,
  onClear,
}: {
  info: BroadcastInfo & { key: string | null };
  /** A partida na transmissão, se ainda está na lista. */
  onAir: LiveRoom | null;
  onNewKey: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = info.key ? broadcastUrl(info.key) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem acesso à área de transferência: o campo fica selecionado para copiar à mão */
    }
  };
  const minutes = Math.max(1, Math.round(info.delayMs / 60_000));
  return (
    <section className="broadcast-panel">
      <h3>{t('broadcast.title')}</h3>
      {!info.key ? (
        <>
          <p className="muted small">{t('broadcast.intro')}</p>
          <button className="btn primary" onClick={onNewKey}>
            {t('broadcast.createLink')}
          </button>
        </>
      ) : (
        <>
          <p className="muted small">{t('broadcast.obsHint')}</p>
          <div className="join-row">
            <input className="broadcast-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('broadcast.linkLabel')} />
            <button className="btn" onClick={copy}>
              {copied ? t('broadcast.copied') : t('broadcast.copy')}
            </button>
          </div>
          <p className="small">
            {info.roomId ? (
              <>
                <b>{t('broadcast.nowOnAir')}</b>{' '}
                {onAir ? onAir.players.map((p) => p.name).join(` ${t('watch.vs')} `) : t('broadcast.onAirEnded')}
                {info.hands ? ` · ${t('broadcast.withHands', { n: minutes })}` : ''}
              </>
            ) : (
              <span className="muted">{t('broadcast.nothingOnAir')}</span>
            )}
          </p>
          <p className="muted small">{t('broadcast.handsDelayHint', { n: minutes })}</p>
          <div className="btn-row">
            {info.roomId && (
              <button className="btn small" onClick={onClear}>
                {t('broadcast.clear')}
              </button>
            )}
            <button className="btn small" onClick={onNewKey}>
              {t('broadcast.newKey')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
