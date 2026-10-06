import type { PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import type { OnlineRoomInfo } from '../api';
import { formatClock, type OnlineGame, remainingNow } from '../game/useOnlineGame';

export const TIER_LABEL: Record<string, string> = {
  'east-blue': 'East Blue',
  paradise: 'Paradise',
  'new-world': 'Novo Mundo',
  supernova: 'Supernova',
  warlord: 'Shichibukai',
  emperor: 'Yonkou',
};

const EMOTES: Array<[string, string]> = [
  ['hello', 'Olá! 👋'],
  ['gg', 'Boa partida! 🤝'],
  ['nice', 'Boa jogada! 👏'],
  ['think', 'Hmm… 🤔'],
  ['wow', 'Uau! 😮'],
  ['oops', 'Ops! 😅'],
  ['thanks', 'Valeu! 🙏'],
  ['hurry', 'Vamos lá? ⏳'],
];
const EMOTE_TEXT = Object.fromEntries(EMOTES);

/** Placar da série de torneio depois deste jogo (na ordem dos assentos) e se ela acabou. */
export function seriesAfter(t: NonNullable<OnlineRoomInfo['tournament']>, winner: PlayerId | null) {
  const score = [t.score[0] ?? 0, t.score[1] ?? 0];
  if (winner !== null) score[winner]++;
  const need = Math.floor(t.bestOf / 2) + 1;
  return { score, decided: score.some((n) => n >= need) };
}

const bounty = (n: number) => `฿ ${n.toLocaleString('pt-BR')}`;

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
  const { room, clockAt } = online;
  const running = room?.status === 'playing' && room.clock.running === player;
  useTick(running);
  if (!room) return null;
  const left = remainingNow(room, clockAt)[player];
  const low = left < 60_000;
  return (
    <span
      className={['clock', running ? 'running' : '', low ? 'low' : ''].join(' ')}
      title="Tempo total do jogador: só corre quando a ação ou a decisão é dele"
    >
      ⏱ {formatClock(left)}
    </span>
  );
}

/** Relógio e conexão de um jogador, na faixa com o nome. */
export function OnlineBanner({ online, player }: { online: OnlineGame; player: PlayerId }) {
  const { room } = online;
  if (!room) return null;
  const info = room.players[player];
  return (
    <div className="online-banner">
      <OnlineClock online={online} player={player} />
      {player !== room.you && (
        <span className={['presence', info?.connected ? 'on' : 'off'].join(' ')} title={info?.connected ? 'Conectado' : 'Desconectado'} />
      )}
      {room.queue === 'ranked' && info && <span className="tier-tag">{TIER_LABEL[info.tier] ?? info.tier}</span>}
    </div>
  );
}

/** Avisos de conexão (a sua e a do oponente). */
export function OnlineStatus({ online }: { online: OnlineGame }) {
  const { room, conn } = online;
  if (conn === 'lost') return <div className="toast online-toast">Conexão perdida. Reconectando…</div>;
  if (conn === 'gone' && room?.status !== 'finished') {
    // Espectador recusado (ex.: espectadores demais): o motivo já vem do servidor.
    if (online.watching && online.error) return null;
    return <div className="toast error online-toast">A partida não existe mais.</div>;
  }
  if (!room || room.status !== 'playing') return null;
  if (room.you === null) {
    const away = room.players.find((p) => !p.connected && !p.bot);
    return away ? <div className="toast online-toast">{away.name} desconectou.</div> : null;
  }
  const opp = room.players[room.you === 0 ? 1 : 0];
  if (opp && !opp.connected) {
    return (
      <div className="toast online-toast">
        {opp.name} desconectou. Se ficar 2 minutos fora na vez dele, perde por abandono.
      </div>
    );
  }
  return null;
}

/** Botão de emotes (lista fixa, sem chat livre). */
export function EmoteBar({ online }: { online: OnlineGame }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="emote-bar">
      <button className="round-btn" onClick={() => setOpen((o) => !o)} aria-label="Emotes" title="Mensagens rápidas">
        💬
      </button>
      {open && (
        <div className="emote-list">
          {EMOTES.map(([id, text]) => (
            <button
              key={id}
              className="btn small"
              onClick={() => {
                void online.sendEmote(id);
                setOpen(false);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmoteBubbles({ online, bottom }: { online: OnlineGame; bottom: PlayerId }) {
  return (
    <>
      {online.emotes.map((e) => (
        <div key={e.key} className={['emote-bubble', e.seat === bottom ? 'mine' : 'theirs'].join(' ')}>
          {EMOTE_TEXT[e.emote] ?? e.emote}
        </div>
      ))}
    </>
  );
}

/** Fim da partida online: recompensa (ranqueada) e revanche. */
export function OnlineResultInfo({ online }: { online: OnlineGame }) {
  const { room } = online;
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
  const t = room.tournament;
  const series = t && t.bestOf > 1 && online.state ? seriesAfter(t, online.state.winner) : null;
  return (
    <div className="online-result">
      {t && (
        <p className="small">
          🏆 {t.name} · {t.label}
          {series && (
            <>
              {' '}
              · placar da série <b>{series.score[me]}–{series.score[opp]}</b>
              {series.decided ? (series.score[me] > series.score[opp] ? ' — você venceu a série!' : ' — série encerrada.') : ''}
            </>
          )}
        </p>
      )}
      {room.queue === 'ranked' && mine && mine.before !== null && mine.after !== null && (
        <p className="bounty-change">
          Recompensa: {bounty(mine.before)} → <b>{bounty(mine.after)}</b>{' '}
          <span className={mine.after >= mine.before ? 'up' : 'down'}>
            ({mine.after >= mine.before ? '+' : '−'}
            {bounty(Math.abs(mine.after - mine.before)).replace('฿ ', '')})
          </span>
        </p>
      )}
      {room.result?.error && <p className="muted small">{room.result.error}</p>}
      {room.queue === 'private' && room.rematch[opp] && !room.rematch[me] && (
        <p className="muted small">{room.players[opp]?.name} quer revanche!</p>
      )}
    </div>
  );
}

/** Antes da partida: conectando ou esperando o segundo jogador na sala privada. */
export function OnlineWaiting({ online, onCancel }: { online: OnlineGame; onCancel: () => void }) {
  const { room, conn } = online;
  const [copied, setCopied] = useState(false);
  const link = room?.code ? `${location.origin}/?sala=${room.code}` : '';
  const copy = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'GumGum Fight', text: `Vamos jogar? Código da sala: ${room?.code}`, url: link });
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
              <h2>{online.watching && online.error ? 'Não foi possível assistir' : 'Partida não encontrada'}</h2>
              <p className="muted">{online.error ?? 'A sala foi cancelada ou expirou.'}</p>
            </>
          ) : room?.status === 'waiting' && room.tournament ? (
            <>
              <h2>🏆 {room.tournament.name}</h2>
              <p className="muted">
                {room.tournament.label}
                {room.tournament.bestOf > 1 &&
                  ` · Jogo ${room.tournament.game} da melhor de ${room.tournament.bestOf} (placar ${room.tournament.score[0] ?? 0}–${room.tournament.score[1] ?? 0})`}
                . O jogo começa quando o seu oponente clicar em "Jogar" na página do torneio.
              </p>
              <p className="muted small waiting-dots">
                Aguardando o oponente<span className="dots" />
              </p>
            </>
          ) : room?.status === 'waiting' ? (
            <>
              <h2>Sala privada</h2>
              <p className="muted">Envie o código ou o link para quem vai jogar com você. A partida começa quando a pessoa entrar.</p>
              <div className="room-code">{room.code}</div>
              <div className="btn-row center">
                <button className="btn primary" onClick={copy}>
                  {copied ? 'Link copiado!' : 'Compartilhar link'}
                </button>
              </div>
              <p className="muted small waiting-dots">
                Aguardando o oponente<span className="dots" />
              </p>
            </>
          ) : (
            <p className="muted waiting-dots">
              {conn === 'lost' ? 'Reconectando' : 'Conectando'}
              <span className="dots" />
            </p>
          )}
          <div className="btn-row center">
            <button className="btn" onClick={onCancel}>
              {room?.status === 'waiting' ? 'Cancelar sala' : 'Voltar ao menu'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Quantos estão assistindo (aparece para jogadores e espectadores). */
export function SpectatorCount({ online }: { online: OnlineGame }) {
  const n = online.room?.spectators ?? 0;
  if (!n) return null;
  return (
    <span className="spectator-count" title={n === 1 ? '1 pessoa assistindo' : `${n} pessoas assistindo`}>
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
  return (
    <div className="spectator-bar">
      <span className="spectator-tag" title={`${online.room?.spectators ?? 1} assistindo`}>
        👁 Assistindo · {online.room?.spectators ?? 1}
      </span>
      {canHands && (
        <button
          className={['auto-toggle', online.hands ? 'on' : ''].join(' ')}
          onClick={onToggleHands}
          title="Mostra as mãos dos dois jogadores (perfil Streamer ou Admin)"
        >
          <span className="knob" />
          Ver mãos
        </button>
      )}
    </div>
  );
}
