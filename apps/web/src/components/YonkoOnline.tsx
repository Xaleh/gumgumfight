// Mesa online do Yonko: a sala de espera (lugares, decks, "pronto", bots, regras e o código para convidar) e,
// quando a partida começa, a mesa (`YonkoTable`) ligada ao servidor, com o relógio de cada jogador.

import { type PlayerId, type TableRules, yonkoBannedIn } from '@gumgum/engine';
import { useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary, type YonkoRoomInfo, type YonkoSeatRef } from '../api';
import { yonkoLegal } from '../deckLibrary';
import { useYonkoOnline } from '../game/useYonkoOnline';
import { type Translate, useT, useTryT } from '../i18n';
import { DeckPicker } from './DeckPicker';
import { Icon } from './Icons';
import { RulesPanel } from './YonkoRules';
import { type SeatStatus, YonkoTable } from './YonkoTable';

/** "21:10" (minutos e segundos). */
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Link de convite para a mesa (abre a tela do Yonko com o código preenchido). */
export const inviteLink = (code: string) => `${location.origin}/?yonko=${encodeURIComponent(code)}`;

/** O deck serve para a mesa: um deck de 60 do Yonko ou um deck completo de 50 (vira deck de teste), sem carta proibida. */
export const usableForYonko = (d: DeckSummary) => (yonkoLegal(d) || d.valid) && !yonkoBannedIn({ leader: d.leader, cards: [] });

/** Por que o deck não serve para a mesa (`null`: serve). */
export const whyNotYonko = (d: DeckSummary, t: Translate): string | null =>
  usableForYonko(d) ? null : yonkoBannedIn({ leader: d.leader, cards: [] }) ? t('yonko.bannedLeader') : (d.errors[0] ?? t('yonko.deckInvalid'));

export function YonkoOnline({ seat, onExit, onBuildDecks }: { seat: YonkoSeatRef; onExit: () => void; onBuildDecks: () => void }) {
  const online = useYonkoOnline(seat);
  const t = useT();
  const { room, state, link } = online;

  if (link === 'closed') {
    return (
      <div className="yk-lobby">
        <header className="builder-header">
          <button className="btn small" onClick={onExit}>
            {t('common.back')}
          </button>
          <h2>{t('yonko.title')}</h2>
        </header>
        <div className="yk-lobby-wrap">
          <div className="yk-panel">
            <h3>{t('yonko.closedTitle')}</h3>
            <p className="muted">{t('yonko.closedText')}</p>
            <button type="button" className="btn" onClick={onExit}>
              {t('yonko.backToHub')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="yk-lobby">
        <div className="yk-lobby-wrap">
          <p className="muted">{t('common.loading')}</p>
        </div>
      </div>
    );
  }
  if (room.status === 'waiting' || !state || room.player === null) return <WaitingRoom online={online} room={room} seat={seat} onExit={onExit} onBuildDecks={onBuildDecks} />;
  return <OnlineTable online={online} room={room} seat={seat} onExit={onExit} />;
}

type Online = ReturnType<typeof useYonkoOnline>;

function OnlineTable({ online, room, seat, onExit }: { online: Online; room: YonkoRoomInfo; seat: YonkoSeatRef; onExit: () => void }) {
  const t = useT();
  const state = online.state!;
  const me = room.player!;
  const [now, setNow] = useState(() => performance.now());
  // O relógio da vez anda entre uma mensagem do servidor e outra.
  useEffect(() => {
    if (room.status !== 'playing') return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [room.status]);

  const status = (id: PlayerId): SeatStatus => {
    const clock = room.clock;
    const player = room.players?.[id];
    if (!clock || !player) return {};
    const ticking = clock.running === id && room.status === 'playing';
    const left = Math.max(0, clock.remaining[id] - (ticking ? now - online.clockAt : 0));
    return { ...(player.bot ? {} : { clock: fmtClock(left), low: left < 120_000, ticking }), away: !player.connected };
  };

  const host = room.you === room.host;
  const out = state.players[me]?.out;
  const leave = () => {
    if (state.phase === 'gameover' || out) return onExit();
    if (!window.confirm(t('yonko.leaveOnlineConfirm'))) return;
    void online.request(api.yonko.leave(seat.id, seat.token)).then(onExit);
  };

  return (
    <YonkoTable
      game={{ state, dispatch: online.dispatch, error: online.error }}
      me={me}
      onExit={leave}
      onRematch={host ? () => void online.request(api.yonko.reopen(seat.id, seat.token)) : undefined}
      extras={{
        pill: t('yonko.pillOnline', { code: room.code }),
        status,
        notice: online.link === 'lost' ? t('yonko.linkLost') : null,
        rematchNote: host ? undefined : t('yonko.rematchWait'),
      }}
    />
  );
}

/** Um lugar da sala de espera, com os controles de quem criou a mesa. */
function SeatCard({
  room,
  index,
  t,
  onBot,
  onClear,
  children,
}: {
  room: YonkoRoomInfo;
  index: number;
  t: Translate;
  onBot: () => void;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  const s = room.seats[index];
  const host = room.you === room.host;
  if (!s) {
    return (
      <div className="yk-seat empty">
        <span className="yk-avatar empty">?</span>
        <span className="muted">{t('yonko.seatEmpty')}</span>
        {host && (
          <button type="button" className="btn small" onClick={onBot}>
            {t('yonko.addBot')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={['yk-seat', s.you ? 'me' : ''].join(' ')}>
      <span className={['yk-avatar', s.bot ? 'bot' : ''].join(' ')} data-c={s.colors[0] ?? 'red'}>
        {s.bot ? <Icon name="bot" size={30} /> : s.name.slice(0, 1).toUpperCase()}
      </span>
      <b className="yk-seat-name">{s.you ? t('yonko.you') : s.name}</b>
      <span className="muted small">
        {index === room.host ? t('yonko.seatHost') : s.bot ? t('yonko.seatBot') : s.connected ? t('yonko.seatConnected') : t('yonko.seatOffline')}
      </span>
      <span className="yk-chip" title={s.deckName}>
        {s.leaderName}
      </span>
      {s.test && <span className="yk-chip warn">{t('yonko.testDeck')}</span>}
      {!s.bot && index !== room.host && <span className={['yk-chip', s.ready ? 'ok' : 'gold'].join(' ')}>{s.ready ? t('yonko.ready') : t('yonko.notReady')}</span>}
      {children}
      {host && !s.you && (
        <button type="button" className="btn small" onClick={onClear}>
          {s.bot ? t('yonko.removeBot') : t('yonko.kick')}
        </button>
      )}
    </div>
  );
}

function WaitingRoom({ online, room, seat, onExit, onBuildDecks }: { online: Online; room: YonkoRoomInfo; seat: YonkoSeatRef; onExit: () => void; onBuildDecks: () => void }) {
  const t = useT();
  const tryT = useTryT();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const host = room.you === room.host;
  const mine = room.you !== null ? room.seats[room.you] : null;
  const ask = (p: Promise<unknown>) => void online.request(p);

  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch(() => setDecks([]));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('yonko.copyPrompt'), inviteLink(room.code));
    }
  };

  const leave = () => {
    if (!window.confirm(t('yonko.leaveWaitingConfirm'))) return;
    void online.request(api.yonko.leave(seat.id, seat.token)).then(onExit);
  };

  const problem = room.problem ? (tryT(`errors.${room.problem.code}`, room.problem.params) ?? room.problem.text) : null;
  const rules: TableRules = room.rules;
  const usable = useMemo(() => (decks ?? []).filter((d) => !d.allBlue), [decks]);

  return (
    <div className="yk-lobby">
      <header className="builder-header">
        <button className="btn small" onClick={leave}>
          {t('yonko.leaveTable')}
        </button>
        <h2>{t('yonko.title')}</h2>
      </header>
      <div className="yk-lobby-wrap">
        <div className="yk-lobby-head">
          <div>
            <div className="yk-kicker">{t('yonko.onlineKicker')}</div>
            <h1 className="yk-h1">{t('yonko.lobbyTitle')}</h1>
          </div>
          <div className="yk-code">
            <span className="yk-kicker">{t('yonko.codeLabel')}</span>
            <b>{room.code}</b>
            <button type="button" className="btn small" onClick={() => void copy()}>
              {copied ? t('yonko.copied') : t('yonko.copyLink')}
            </button>
          </div>
        </div>

        {online.error && (
          <div className="error" onClick={() => online.setError(null)}>
            {online.error}
          </div>
        )}
        {online.link === 'lost' && <div className="notice">{t('yonko.linkLost')}</div>}

        <div className="yk-seats">
          {room.seats.map((_, i) => (
            <SeatCard
              key={i}
              room={room}
              index={i}
              t={t}
              onBot={() => ask(api.yonko.bot(seat.id, seat.token, i))}
              onClear={() => ask(api.yonko.clear(seat.id, seat.token, i))}
            >
              {room.seats[i]?.you && (
                <div className="yk-seat-actions">
                  <button type="button" className="btn small" disabled={!decks} onClick={() => setPicking(true)}>
                    {t('yonko.changeDeck')}
                  </button>
                  {!host && (
                    <button type="button" className={['btn small', mine?.ready ? '' : 'primary'].join(' ')} onClick={() => ask(api.yonko.ready(seat.id, seat.token, !mine?.ready))}>
                      {mine?.ready ? t('yonko.unready') : t('yonko.imReady')}
                    </button>
                  )}
                </div>
              )}
            </SeatCard>
          ))}
        </div>
        <p className="muted small">{host ? t('yonko.hostHint') : t('yonko.guestHint')}</p>

        <div className="yk-lobby-grid">
          <RulesPanel rules={rules} editable={host} onChange={(next) => ask(api.yonko.rules(seat.id, seat.token, next))} onBuildDecks={onBuildDecks} />
          <div className="yk-lobby-col">
            <section className="yk-panel">
              <h3>{t('yonko.howWin')}</h3>
              <p className="muted">{t('yonko.onlineHowText')}</p>
            </section>
            {host ? (
              <>
                {problem && <p className="muted small">{problem}</p>}
                <button type="button" className="mode-btn yk-cta" disabled={Boolean(room.problem)} onClick={() => ask(api.yonko.start(seat.id, seat.token))}>
                  {t('yonko.startOnline')}
                </button>
              </>
            ) : (
              <div className="notice">{t('yonko.waitHost')}</div>
            )}
          </div>
        </div>
      </div>

      {picking && decks && (
        <DeckPicker
          title={t('yonko.pickDeck')}
          context={t('yonko.pickDeckOnline')}
          decks={usable}
          value=""
          canUse={usableForYonko}
          whyNot={(d) => whyNotYonko(d, t)}
          onPick={(id) => {
            setPicking(false);
            ask(api.yonko.deck(seat.id, seat.token, id));
          }}
          onClose={() => setPicking(false)}
          onFavorite={() => undefined}
        />
      )}
    </div>
  );
}

