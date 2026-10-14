import type { PlayerId } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import { audio } from '../audio';
import { errorMessage, type OnlineRoomInfo, type RoomQueue } from '../api';
import { formatClock, type OnlineGame, remainingNow } from '../game/useOnlineGame';
import { type MessageKey, type Translate, useLocale, useT, useTryT } from '../i18n';
import { fmtBerries, fmtNumber } from '../i18n/format';
import { useSettings } from '../settings';
import { ReportModal } from './ReportModal';

/** Nome de cada liga da ranqueada: chave do dicionário (mostrar com `tierName`). */
export const TIER_LABEL: Record<string, MessageKey> = {
  'east-blue': 'online.tier.eastBlue',
  paradise: 'online.tier.paradise',
  'new-world': 'online.tier.newWorld',
  supernova: 'online.tier.supernova',
  warlord: 'online.tier.warlord',
  emperor: 'online.tier.emperor',
};

/** Nome da liga no idioma em vigor (liga desconhecida: o próprio id). */
export function tierName(t: Translate, tier: string): string {
  const key = TIER_LABEL[tier];
  return key ? t(key) : tier;
}

/** Nome de cada tipo de sala na lista "Assistir" e na tela de transmissão. */
export const QUEUE_LABEL: Record<RoomQueue, MessageKey> = {
  ranked: 'watch.queue.ranked',
  casual: 'watch.queue.casual',
  private: 'watch.queue.private',
  bot: 'watch.queue.bot',
  tournament: 'watch.queue.tournament',
};

/** Ids dos emotes (o que vai para o servidor); o texto fica em `online.emote.<id>`. */
const EMOTES = ['hello', 'gg', 'nice', 'think', 'wow', 'oops', 'thanks', 'hurry'] as const;
const emoteKey = (id: (typeof EMOTES)[number]) => `online.emote.${id}` as const;
/** Igual ao limite do servidor (CHAT_MAX_LENGTH em room.ts). */
const CHAT_MAX_LENGTH = 120;

/** Placar da série de torneio depois deste jogo (na ordem dos assentos) e se ela acabou. */
export function seriesAfter(t: NonNullable<OnlineRoomInfo['tournament']>, winner: PlayerId | null) {
  const score = [t.score[0] ?? 0, t.score[1] ?? 0];
  if (winner !== null) score[winner]++;
  const need = Math.floor(t.bestOf / 2) + 1;
  return { score, decided: score.some((n) => n >= need) };
}

/** Re-renderiza a cada `ms` enquanto `on` (relógios correndo). */
function useTick(on: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

/** Relógio de um jogador (tempo total da partida), atualizado a cada segundo enquanto corre. */
export function OnlineClock({ online, player }: { online: OnlineGame; player: PlayerId }) {
  const t = useT();
  const { room, clockAt } = online;
  const running = room?.status === 'playing' && room.clock.running === player;
  useTick(running);
  if (!room) return null;
  const left = remainingNow(room, clockAt)[player];
  const low = left < 60_000;
  return (
    <span className={['clock', running ? 'running' : '', low ? 'low' : ''].join(' ')} title={t('online.clockTitle')}>
      ⏱ {formatClock(left)}
    </span>
  );
}

/** Relógio e conexão de um jogador, na faixa com o nome. */
export function OnlineBanner({ online, player }: { online: OnlineGame; player: PlayerId }) {
  const t = useT();
  const { room } = online;
  if (!room) return null;
  const info = room.players[player];
  return (
    <div className="online-banner">
      <OnlineClock online={online} player={player} />
      {player !== room.you && (
        <span className={['presence', info?.connected ? 'on' : 'off'].join(' ')} title={info?.connected ? t('online.connected') : t('online.disconnected')} />
      )}
      {room.queue === 'ranked' && info && <span className="tier-tag">{tierName(t, info.tier)}</span>}
    </div>
  );
}

/** Avisos de conexão (a sua e a do oponente). */
export function OnlineStatus({ online }: { online: OnlineGame }) {
  const t = useT();
  const { room, conn } = online;
  if (conn === 'lost') return <div className="toast online-toast">{t('online.connLost')}</div>;
  if (conn === 'gone' && room?.status !== 'finished') {
    // Espectador recusado (ex.: espectadores demais): o motivo já vem do servidor.
    if (online.watching && online.error) return null;
    return <div className="toast error online-toast">{t('online.roomGone')}</div>;
  }
  if (!room || room.status !== 'playing') return null;
  if (room.you === null) {
    const away = room.players.find((p) => !p.connected && !p.bot);
    return away ? <div className="toast online-toast">{t('online.playerLeft', { name: away.name })}</div> : null;
  }
  const opp = room.players[room.you === 0 ? 1 : 0];
  if (opp && !opp.connected) {
    return <div className="toast online-toast">{t('online.opponentLeft', { name: opp.name })}</div>;
  }
  return null;
}

/**
 * O chat com o oponente está aberto? (configuração geral e o silêncio só desta partida).
 * Silenciado vale para os dois lados: não vê o que o oponente manda nem manda nada.
 */
function useShowOpponent(online: OnlineGame) {
  const { opponentChat } = useSettings();
  // Quem assiste silencia o chat dos dois jogadores só para si (botão na faixa do espectador).
  return online.watching ? !online.muted : opponentChat && !online.muted;
}

/** Painel de chat da partida: emotes (atalhos) e mensagens de texto curtas. */
export function ChatBar({ online }: { online: OnlineGame }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const showOpponent = useShowOpponent(online);
  const mine = online.room?.you ?? null;
  const messages = showOpponent ? online.chat : online.chat.filter((m) => m.seat === mine);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seen = useRef(0);

  // Mensagem ou emote do oponente: um toque curto (com o painel aberto ou fechado).
  const heard = useRef(messages.length);
  useEffect(() => {
    if (messages.length > heard.current && messages.slice(heard.current).some((m) => m.seat !== mine)) audio.play('chat', { detune: 0 });
    heard.current = messages.length;
  }, [messages, mine]);

  // Mensagens que chegaram com o painel fechado contam como não lidas.
  useEffect(() => {
    if (open) {
      seen.current = messages.length;
      setUnread(0);
      return;
    }
    const fresh = messages.slice(seen.current).filter((m) => m.seat !== mine).length;
    setUnread(fresh);
  }, [open, messages, mine]);

  useEffect(() => {
    if (!open) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    inputRef.current?.focus();
  }, [open, messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text || !showOpponent) return;
    void online.sendChat(text);
    setDraft('');
    inputRef.current?.focus();
  };
  const name = (seat: PlayerId) => (seat === mine ? t('online.you') : (online.room?.players[seat]?.name ?? t('online.opponent')));

  return (
    <div className="emote-bar">
      <button className="round-btn chat-btn" onClick={() => setOpen((o) => !o)} aria-label={t('online.chatLabel')} title={t('online.chatTitle')}>
        💬
        {unread > 0 && !open && <span className="chat-unread">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-head">
            <strong>{t('online.chat')}</strong>
            <button
              type="button"
              className={['btn small', online.muted ? 'on' : ''].join(' ')}
              aria-pressed={online.muted}
              onClick={() => online.setMuted(!online.muted)}
              title={online.muted ? t('online.unmuteTitle') : t('online.muteTitle')}
            >
              {online.muted ? t('online.muted') : t('online.mute')}
            </button>
            <button type="button" className="btn small" onClick={() => setOpen(false)} aria-label={t('online.closeChatLabel')}>
              ✕
            </button>
          </div>
          {showOpponent && (
            <div className="emote-list">
              {EMOTES.map((id) => (
                <button key={id} className="btn small" onClick={() => void online.sendEmote(id)}>
                  {t(emoteKey(id))}
                </button>
              ))}
            </div>
          )}
          <div className="chat-log" ref={logRef} aria-live="polite">
            {!showOpponent && <div className="muted small">{t('online.opponentHidden')}</div>}
            {showOpponent && messages.length === 0 && <div className="muted small">{t('online.noMessages')}</div>}
            {messages.map((m) => (
              <div key={m.key} className={['chat-msg', m.seat === mine ? 'mine' : 'theirs'].join(' ')}>
                <span className="chat-who">{name(m.seat)}</span> {m.text}
              </div>
            ))}
          </div>
          {showOpponent && (
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                ref={inputRef}
                className="chat-input"
                value={draft}
                maxLength={CHAT_MAX_LENGTH}
                placeholder={t('online.messagePlaceholder')}
                aria-label={t('online.messageLabel')}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="btn small primary" disabled={!draft.trim()}>
                {t('online.send')}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** Balões flutuantes com os emotes e as últimas mensagens de texto de cada lado. */
export function ChatBubbles({ online, bottom }: { online: OnlineGame; bottom: PlayerId }) {
  const tryT = useTryT();
  const showOpponent = useShowOpponent(online);
  const visible = <T extends { seat: PlayerId }>(list: T[]) => (showOpponent ? list : list.filter((x) => x.seat === bottom));
  return (
    <>
      {visible(online.emotes).map((e) => (
        <div key={e.key} className={['emote-bubble', e.seat === bottom ? 'mine' : 'theirs'].join(' ')}>
          {tryT(`online.emote.${e.emote}`) ?? e.emote}
        </div>
      ))}
      {visible(online.chatBubbles).map((m) => (
        <div key={m.key} className={['emote-bubble text', m.seat === bottom ? 'mine' : 'theirs'].join(' ')}>
          {m.text}
        </div>
      ))}
    </>
  );
}

/** Fim da partida online: recompensa (ranqueada), revanche e o relato de problema (ranqueada e torneio). */
export function OnlineResultInfo({ online }: { online: OnlineGame }) {
  const t = useT();
  const locale = useLocale();
  const bounty = (n: number) => fmtBerries(n, locale);
  const { room } = online;
  const [reporting, setReporting] = useState(false);
  if (!room) return null;
  if (room.you === null) {
    // Espectador: a recompensa dos dois.
    const change = room.queue === 'ranked' ? room.result?.bounty : null;
    return change ? (
      <div className="online-result">
        {change.map((c, i) =>
          c.before !== null && c.after !== null ? (
            <p key={i} className="bounty-change">
              {room.players[i]?.name}: {bounty(c.before)} → <b>{bounty(c.after)}</b>
            </p>
          ) : null,
        )}
      </div>
    ) : null;
  }
  const me = room.you;
  const opp = me === 0 ? 1 : 0;
  const mine = room.result?.bounty?.[me];
  const tour = room.tournament;
  const series = tour && tour.bestOf > 1 && online.state ? seriesAfter(tour, online.state.winner) : null;
  return (
    <div className="online-result">
      {tour && (
        <p className="small">
          🏆 {tour.name} · {tour.label}
          {series && (
            <>
              {' '}
              · {t('online.seriesScore')} <b>{series.score[me]}–{series.score[opp]}</b>
              {series.decided ? (series.score[me] > series.score[opp] ? t('online.seriesWon') : t('online.seriesOver')) : ''}
            </>
          )}
        </p>
      )}
      {room.queue === 'ranked' && mine && mine.before !== null && mine.after !== null && (
        <p className="bounty-change">
          {t('online.bounty')} {bounty(mine.before)} → <b>{bounty(mine.after)}</b>{' '}
          <span className={mine.after >= mine.before ? 'up' : 'down'}>
            ({mine.after >= mine.before ? '+' : '−'}
            {fmtNumber(Math.abs(mine.after - mine.before), locale)})
          </span>
        </p>
      )}
      {room.result?.error && <p className="muted small">{errorMessage(room.result, room.result.error)}</p>}
      {room.queue === 'private' && room.rematch[opp] && !room.rematch[me] && (
        <p className="muted small">{t('online.rematchWanted', { name: room.players[opp]?.name })}</p>
      )}
      {(room.queue === 'ranked' || room.queue === 'tournament') && room.result?.matchId != null && (
        <p className="small">
          <button className="btn small pill" onClick={() => setReporting(true)}>
            {t('online.report')}
          </button>
        </p>
      )}
      {reporting && room.result?.matchId != null && (
        <ReportModal matchId={room.result.matchId} tournament={tour?.name ?? null} onClose={() => setReporting(false)} />
      )}
    </div>
  );
}

/** Antes da partida: conectando ou esperando o segundo jogador na sala privada. */
export function OnlineWaiting({ online, onCancel }: { online: OnlineGame; onCancel: () => void }) {
  const t = useT();
  const { room, conn } = online;
  const [copied, setCopied] = useState(false);
  const link = room?.code ? `${location.origin}/?sala=${room.code}` : '';
  const copy = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'GumGum Fight', text: t('online.shareText', { code: room?.code }), url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* compartilhamento cancelado */
    }
  };
  return (
    <div className="menu">
      <div className="menu-box">
        <section className="menu-card online-wait">
          {conn === 'gone' ? (
            <>
              <h2>{online.watching && online.error ? t('online.cannotWatch') : t('online.notFound')}</h2>
              <p className="muted">{online.error ?? t('online.roomExpired')}</p>
            </>
          ) : room?.status === 'waiting' && room.tournament ? (
            <>
              <h2>🏆 {room.tournament.name}</h2>
              <p className="muted">
                {room.tournament.label}
                {room.tournament.bestOf > 1 &&
                  t('online.tourGame', {
                    game: room.tournament.game,
                    bestOf: room.tournament.bestOf,
                    a: room.tournament.score[0] ?? 0,
                    b: room.tournament.score[1] ?? 0,
                  })}
                . {t('online.tourStartHint')}
              </p>
              <p className="muted small waiting-dots">
                {t('online.waitingOpponent')}
                <span className="dots" />
              </p>
            </>
          ) : room?.status === 'waiting' ? (
            <>
              <h2>{t('online.privateRoom')}</h2>
              <p className="muted">{t('online.privateHint')}</p>
              <div className="room-code">{room.code}</div>
              {room.handsAllowed && <p className="small">{t('online.handsSharedHint')}</p>}
              <div className="btn-row center">
                <button className="btn primary" onClick={copy}>
                  {copied ? t('online.linkCopied') : t('online.shareLink')}
                </button>
              </div>
              <p className="muted small waiting-dots">
                {t('online.waitingOpponent')}
                <span className="dots" />
              </p>
            </>
          ) : (
            <p className="muted waiting-dots">
              {conn === 'lost' ? t('online.reconnecting') : t('online.connecting')}
              <span className="dots" />
            </p>
          )}
          <div className="btn-row center">
            <button className="btn" onClick={onCancel}>
              {room?.status === 'waiting' ? t('online.cancelRoom') : t('online.backToMenu')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Aviso para os jogadores de uma sala privada que liberou as mãos para quem transmite. */
export function HandsSharedTag({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  if (!room || room.queue !== 'private' || !room.handsAllowed) return null;
  return (
    <span className="delay-tag" title={t('online.handsSharedHint')}>
      {t('online.handsShared')}
    </span>
  );
}

/** Quantos estão assistindo (aparece para jogadores e espectadores). */
export function SpectatorCount({ online }: { online: OnlineGame }) {
  const t = useT();
  const n = online.room?.spectators ?? 0;
  if (!n) return null;
  return (
    <span className="spectator-count" title={t('online.spectatorsTitle', { n })}>
      👁 {n}
    </span>
  );
}

/** Faixa do espectador: aviso de que está assistindo e, para streamer/admin, o botão "Ver mãos". */
export function SpectatorBar({
  online,
  canHands,
  onToggleHands,
}: {
  online: OnlineGame;
  canHands: boolean;
  onToggleHands: () => void;
}) {
  const t = useT();
  const n = online.room?.spectators ?? 1;
  return (
    <div className="spectator-bar">
      <span className="spectator-tag" title={t('online.watchingTitle', { n })}>
        {t('online.watching', { n })}
      </span>
      {canHands && (
        <button className={['auto-toggle', online.hands ? 'on' : ''].join(' ')} onClick={onToggleHands} title={t('online.handsTitle')}>
          <span className="knob" />
          {t('online.hands')}
        </button>
      )}
      <button
        className={['auto-toggle', online.muted ? '' : 'on'].join(' ')}
        onClick={() => online.setMuted(!online.muted)}
        aria-pressed={!online.muted}
        title={t('online.watchChatTitle')}
      >
        <span className="knob" />
        {t('online.watchChat')}
      </button>
      {online.room?.delay ? <DelayTag ms={online.room.delay} /> : null}
    </div>
  );
}

/** Aviso de que a mesa (com as mãos) está atrasada. */
function DelayTag({ ms }: { ms: number }) {
  const t = useT();
  return (
    <span className="delay-tag" title={t('online.delayTitle')}>
      {t('online.delay', { n: Math.max(1, Math.round(ms / 60_000)) })}
    </span>
  );
}

/** Canto da tela de transmissão: o tipo de partida (ou o torneio), o atraso da mesa e quantos assistem. */
export function BroadcastTag({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  if (!room) return null;
  const tour = room.tournament;
  return (
    <div className="broadcast-tag">
      <span className="broadcast-match">
        {tour
          ? `${t('watch.tourLine', { name: tour.name, label: tour.label })}${tour.bestOf > 1 ? t('watch.tourGame', { n: tour.game }) : ''}`
          : t(QUEUE_LABEL[room.queue])}
      </span>
      {room.delay ? <DelayTag ms={room.delay} /> : null}
      {room.spectators > 0 && <span className="spectator-count">👁 {room.spectators}</span>}
    </div>
  );
}

/** Tela de transmissão sem partida na mesa (esperando a escolha no app, carregando ou link inválido). */
export function BroadcastIdle({ title, text }: { title: string; text?: string }) {
  return (
    <div className="broadcast-idle">
      <div className="broadcast-idle-box">
        <h1>GumGum Fight</h1>
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
      </div>
    </div>
  );
}
