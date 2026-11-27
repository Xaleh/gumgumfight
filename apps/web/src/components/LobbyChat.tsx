// Chat do lobby do torneio: uma conversa só para o torneio inteiro. Qualquer pessoa que abra o lobby
// lê; escrevem os inscritos, os Judges e o organizador (o servidor decide e diz por que não, em `post`).
// Quem escreveu apaga a própria mensagem; o Judge e o organizador apagam qualquer uma.
//
// Na tela larga o chat é uma coluna ao lado das mesas, sempre à vista. Na tela estreita vira uma barra
// presa embaixo, com a última mensagem e a contagem das que chegaram com ele fechado; tocar abre a conversa.
//
// A conversa é consultada a cada `POLL_MS` (o lobby não tem canal aberto com o servidor); sem novidade,
// a resposta é a mesma (`rev`) e nada é redesenhado. Sem animações: nada aqui se move sozinho.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type LobbyChat as Chat, type LobbyChatMessage } from '../api';
import { useLocale, useT } from '../i18n';
import { fmtTime } from '../i18n/format';
import { poll } from '../poll';

const POLL_MS = 2500;
/** A partir desta largura o chat é a coluna ao lado (o mesmo corte do CSS, em `.tour-lobby.has-chat`). */
const WIDE = '(min-width: 1100px)';
/** Distância do fim da conversa (px) até onde ela ainda acompanha as mensagens novas. */
const STICK_PX = 48;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A última mensagem que a pessoa já viu neste torneio, lembrada enquanto a aba vive (ela sai para jogar e volta). */
const seenKey = (id: string) => `gumgum.lobbyChatSeen.${id}`;
function readSeen(id: string): number | null {
  try {
    const v = sessionStorage.getItem(seenKey(id));
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}
function writeSeen(id: string, last: number) {
  try {
    sessionStorage.setItem(seenKey(id), String(last));
  } catch {
    /* sem sessionStorage: a contagem recomeça a cada visita */
  }
}

export function LobbyChat({ id, me }: { id: string; me: string | null }) {
  const tr = useT();
  const locale = useLocale();
  const wide = useWide();
  const [chat, setChat] = useState<Chat | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Chegou mensagem enquanto a pessoa lia o começo da conversa. */
  const [newBelow, setNewBelow] = useState(false);
  const [seen, setSeen] = useState<number | null>(() => readSeen(id));
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** A conversa está no fim (acompanha as mensagens novas). */
  const stick = useRef(true);
  /** Sobe a cada envio ou mensagem apagada: uma consulta que saiu antes volta com a conversa antiga e é descartada. */
  const epoch = useRef(0);

  const apply = (next: Chat) => setChat((prev) => (prev && prev.rev === next.rev && prev.post === next.post && prev.moderate === next.moderate ? prev : next));

  useEffect(() => {
    setChat(null);
    setSeen(readSeen(id));
    return poll(async () => {
      const at = epoch.current;
      const next = await api.tournaments.chat(id);
      if (at === epoch.current) apply(next);
    }, POLL_MS);
  }, [id]);

  const messages = chat?.messages ?? [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const visible = wide || open;

  // O que está à vista conta como lido. Na primeira visita, o que já estava na conversa não entra na contagem.
  useEffect(() => {
    if (!chat) return;
    const lastId = last?.id ?? 0;
    if (seen !== null && !visible) return;
    if (seen === lastId) return;
    if (seen !== null && lastId < seen) return;
    setSeen(lastId);
    writeSeen(id, lastId);
  }, [chat, last?.id, visible, seen, id]);

  const unread = visible || seen === null ? 0 : messages.filter((m) => m.id > seen && m.userId !== me).length;

  // Mensagem nova: a conversa desce junto se já estava no fim; senão, avisa que há mensagens abaixo.
  const lastId = last?.id ?? 0;
  const prevLast = useRef(0);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (lastId > prevLast.current) setNewBelow(true);
    prevLast.current = lastId;
  }, [lastId, visible]);

  const toEnd = () => {
    const el = logRef.current;
    stick.current = true;
    setNewBelow(false);
    if (el) el.scrollTop = el.scrollHeight;
  };
  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stick.current) setNewBelow(false);
  };

  /** Envio ou mensagem apagada: a resposta já traz a conversa atualizada. */
  const change = async (fn: () => Promise<Chat>): Promise<boolean> => {
    setError(null);
    epoch.current++;
    try {
      apply(await fn());
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      epoch.current++;
    }
  };
  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    stick.current = true;
    if (await change(() => api.tournaments.chatSend(id, text))) setDraft('');
    setSending(false);
    inputRef.current?.focus();
  };
  const remove = (m: LobbyChatMessage) => {
    if (!window.confirm(tr('lobbyChat.confirmRemove', { name: m.name }))) return;
    void change(() => api.tournaments.chatRemove(id, m.id));
  };

  if (!visible) {
    return (
      <aside className="lobby-chat dock" aria-label={tr('lobbyChat.title')}>
        <button
          type="button"
          className="lobby-chat-bar"
          aria-expanded={false}
          title={tr('lobbyChat.open')}
          onClick={() => {
            stick.current = true;
            setOpen(true);
          }}
        >
          <span className="lobby-chat-ico" aria-hidden="true">
            💬
          </span>
          <span className="lobby-chat-bar-text">
            <strong>{tr('lobbyChat.title')}</strong>
            <span className="muted small">{last ? `${last.name}: ${last.text}` : chat ? tr('lobbyChat.empty') : tr('common.loading')}</span>
          </span>
          {unread > 0 && (
            <span className="lobby-chat-badge" aria-label={tr('lobbyChat.unread', { n: unread })}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className={['lobby-chat', wide ? 'wide' : 'dock open'].join(' ')} aria-label={tr('lobbyChat.title')}>
      <div className="lobby-chat-head">
        <strong>
          <span aria-hidden="true">💬</span> {tr('lobbyChat.title')}
        </strong>
        {!wide && (
          <button type="button" className="btn small" onClick={() => setOpen(false)} aria-label={tr('online.closeChatLabel')}>
            ✕
          </button>
        )}
      </div>
      <div className="lobby-chat-body">
        <div className="lobby-chat-log" ref={logRef} onScroll={onScroll} aria-live="polite">
          {!chat && <p className="muted small">{tr('common.loading')}</p>}
          {chat && messages.length === 0 && <p className="muted small">{tr('lobbyChat.empty')}</p>}
          {messages.map((m) => (
            <div key={m.id} className={['lobby-chat-msg', m.userId === me ? 'mine' : ''].join(' ')}>
              <p>
                <time className="muted" dateTime={m.at}>
                  {fmtTime(m.at, locale)}
                </time>{' '}
                <b className="lobby-chat-who">{m.name}</b>
                {m.role !== 'player' && <span className={['lobby-chat-role', m.role].join(' ')}>{tr(`tour.interventionRole.${m.role}`)}</span>}
                <span className="lobby-chat-text">{m.text}</span>
              </p>
              {(chat?.moderate || m.userId === me) && (
                <button type="button" className="lobby-chat-del" title={tr('lobbyChat.remove')} aria-label={tr('lobbyChat.remove')} onClick={() => remove(m)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {newBelow && (
          <button type="button" className="btn small lobby-chat-new" onClick={toEnd}>
            {tr('lobbyChat.newMessages')}
          </button>
        )}
      </div>
      {error && (
        <div className="error small" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {chat?.post === 'ok' && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={inputRef}
            className="chat-input"
            value={draft}
            maxLength={chat.max}
            placeholder={tr('lobbyChat.placeholder')}
            aria-label={tr('lobbyChat.messageLabel')}
            autoComplete="off"
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn small primary" disabled={!draft.trim() || sending}>
            {tr('online.send')}
          </button>
        </form>
      )}
      {chat && chat.post !== 'ok' && (
        <p className="muted small lobby-chat-hint">
          {tr(chat.post === 'login' ? 'lobbyChat.loginHint' : chat.post === 'closed' ? 'lobbyChat.closedHint' : 'lobbyChat.participantsHint')}
        </p>
      )}
    </aside>
  );
}
