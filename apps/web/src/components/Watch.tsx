import { useEffect, useState } from 'react';
import { api, type BroadcastInfo, type BroadcastSettings, broadcastUrl, type LiveRoom, modeLabel, ROLE_LABEL, type WatchTarget } from '../api';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { poll } from '../poll';
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
  const [broadcast, setBroadcast] = useState<BroadcastInfo | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  // A lista muda sozinha (partidas começam e terminam): atualiza a cada 5 s (ver `poll`).
  useEffect(() => {
    let stop = false;
    const cancel = poll(
      () =>
        api.online.live().then(
          (r) => {
            if (stop) return;
            setRooms(r.rooms);
            setCanHands(r.hands);
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
  // As mãos só aparecem no torneio e nas salas privadas liberadas, e nunca na própria partida.
  const watch = (r: Pick<LiveRoom, 'id' | 'mine' | 'handsAllowed'>) => onWatch({ roomId: r.id, hands: canHands && hands && !r.mine && Boolean(r.handsAllowed) });
  /** Manda a partida para a tela de transmissão (o que ela mostra sai das opções do painel). */
  const transmit = (r: LiveRoom | null) => {
    setError(null);
    api.broadcast.choose(r?.id ?? null).then(setBroadcast, fail);
  };
  const onAir = broadcast?.key ? broadcast.roomId : null;

  /** Sala privada pelo código: assistir ou mandar para a transmissão. */
  const byCode = async (send = false) => {
    setError(null);
    try {
      const room = await api.online.byCode(code);
      if (send) transmit(room);
      else watch(room);
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
            onSettings={(s) => {
              setBroadcast({ ...broadcast, ...s });
              api.broadcast.settings(s).then(setBroadcast, fail);
            }}
          />
        )}

        <div className="watch-list">
          {rooms === null && !error && <p className="muted">{t('common.loading')}</p>}
          {rooms?.length === 0 && <p className="muted">{t('watch.empty')}</p>}
          {rooms?.map((r) => (
            <div key={r.id} className={['watch-room-row', onAir === r.id ? 'on-air' : ''].join(' ')}>
              <LiveRoomRow room={r} onClick={() => watch(r)} />
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
            <button className="btn" disabled={code.length !== 6} onClick={() => void byCode()}>
              {t('watch.watch')}
            </button>
            {broadcast?.key && (
              <button className="btn" disabled={code.length !== 6} onClick={() => void byCode(true)} title={t('broadcast.transmitTitle')}>
                {t('broadcast.transmit')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Linha de uma partida ao vivo: tipo de sala (ou torneio), formato, turno, espectadores e os dois jogadores.
 * `short`: dentro do grupo do torneio (painel de quem transmite), só a rodada e o jogo. `current`: a partida assistida agora.
 */
export function LiveRoomRow({ room: r, onClick, short, current }: { room: LiveRoom; onClick: () => void; short?: boolean; current?: boolean }) {
  const t = useT();
  const tour = r.tournament;
  const game = tour && tour.bestOf > 1 ? t('watch.tourGame', { n: tour.game }) : '';
  return (
    <button className={['watch-room', current ? 'current' : ''].join(' ')} onClick={onClick} aria-current={current ? 'true' : undefined}>
      <div className="watch-meta">
        <span className="watch-queue">{tour ? (short ? `${tour.label}${game}` : `${t('watch.tourLine', { name: tour.name, label: tour.label })}${game}`) : t(QUEUE_LABEL[r.queue])}</span>
        {current && <span className="watch-current">{t('watch.current')}</span>}
        {r.mine && (
          <span className="muted small" title={t('watch.mineTitle')}>
            {t('watch.mine')}
          </span>
        )}
        <span className="muted small">
          {modeLabel(r)} · {r.turn ? t('watch.turn', { n: r.turn }) : t('watch.openingHand')}
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
  );
}

/** Atrasos oferecidos (s); 0 = ao vivo onde o atraso não é obrigatório. */
const DELAYS = [0, 60, 120, 180, 300, 600];

/** O que a live mostra numa partida (como o servidor decide em `broadcastView`) e com quanto atraso (s). */
export function broadcastShows(s: BroadcastInfo, room: Pick<LiveRoom, 'mine' | 'queue' | 'handsAllowed' | 'handsLive'>): { what: 'players' | 'own' | 'none'; delayS: number } {
  const plain = room.queue === 'tournament' && s.delayTournaments ? s.delayS : 0;
  if (room.mine) return s.handsOwn ? { what: 'own', delayS: s.delayS } : { what: 'none', delayS: plain };
  // Torneio com mãos ao vivo: vale o atraso escolhido, até nenhum; fora disso, nunca abaixo do mínimo.
  if (s.handsPlayers && room.handsAllowed) return { what: 'players', delayS: room.handsLive ? s.delayS : Math.max(s.minHandsDelayS, s.delayS) };
  return { what: 'none', delayS: plain };
}

const SHOWS_LABEL = { players: 'broadcast.showsPlayers', own: 'broadcast.showsOwn', none: 'broadcast.showsNone' } as const;

/** Painel do modo transmissão: o link para a fonte de navegador do OBS, a partida na live e as opções. */
function BroadcastPanel({
  info,
  onAir,
  onNewKey,
  onClear,
  onSettings,
}: {
  info: BroadcastInfo;
  /** A partida na transmissão, se ainda está na lista. */
  onAir: LiveRoom | null;
  onNewKey: () => void;
  onClear: () => void;
  onSettings: (s: Partial<BroadcastSettings>) => void;
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
  const delayText = (sec: number) => (sec ? t('broadcast.delayMin', { n: Math.round((sec / 60) * 10) / 10 }) : t('broadcast.delayLive'));
  const shows = onAir ? broadcastShows(info, onAir) : null;
  const flag = (key: 'handsPlayers' | 'handsOwn' | 'delayTournaments' | 'chat', label: string, hint?: string) => (
    <label className="check">
      <input type="checkbox" checked={info[key]} onChange={(e) => onSettings({ [key]: e.target.checked })} /> {label}
      {hint && <span className="muted small"> {hint}</span>}
    </label>
  );
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
                {shows && ` · ${t(SHOWS_LABEL[shows.what])} · ${delayText(shows.delayS)}`}
              </>
            ) : (
              <span className="muted">{t('broadcast.nothingOnAir')}</span>
            )}
          </p>

          <div className="broadcast-settings">
            <label className="broadcast-delay">
              {t('broadcast.delay')}{' '}
              <select value={info.delayS} onChange={(e) => onSettings({ delayS: Number(e.target.value) })}>
                {[...new Set([...DELAYS, info.delayS])]
                  .sort((a, b) => a - b)
                  .map((sec) => (
                    <option key={sec} value={sec}>
                      {sec ? t('broadcast.delayMin', { n: Math.round((sec / 60) * 10) / 10 }) : t('broadcast.delayNone')}
                    </option>
                  ))}
              </select>
            </label>
            {flag('handsPlayers', t('broadcast.handsPlayers'), t('broadcast.handsPlayersHint', { n: Math.round(info.minHandsDelayS / 60) }))}
            {flag('handsOwn', t('broadcast.handsOwn'), t('broadcast.handsOwnHint'))}
            {flag('delayTournaments', t('broadcast.delayTournaments'))}
            {flag('chat', t('broadcast.chat'))}
          </div>

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
