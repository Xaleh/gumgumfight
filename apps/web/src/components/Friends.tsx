// Amigos (roadmap E2): a folha "Amigos" (meu código, adicionar pelo código, pedidos recebidos e
// enviados, a lista com quem está online e o botão Convidar, que deixa escolher o formato: 1 contra 1
// em cada formato ou a mesa do Yonko), a faixa de convite na tela inicial e o painel "Chamar amigos"
// da sala de espera do Yonko.
//
// O servidor guarda tudo (`/api/friends`): o status de cada amigo vem da presença que o lobby e as
// mesas do Yonko já conhecem, e o convite leva o código da sala privada (ou da mesa) só para o amigo
// convidado. Os endereços (`/?amigo=`, `/?amigos=1`, `/?convite=`) ficam em friendLink.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type FriendInvite, type FriendList, type FriendPresence } from '../api';
import { useAuth } from '../auth';
import { type MessageKey, useT } from '../i18n';
import { poll } from '../poll';
import { friendLink } from '../friendLink';
import { Icon } from './Icons';

export type { FriendLink } from '../friendLink';

/** Lista de amigos, consultada a cada 10 s enquanto há login (a consulta também me conta como online). */
export function useFriends(loggedIn: boolean) {
  const [data, setData] = useState<FriendList | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const load = useCallback(
    () =>
      api.friends
        .list()
        .then((d) => {
          if (!live.current) return;
          setData(d);
          setFailed(false);
        })
        .catch((e) => {
          if (live.current) setFailed(!(e instanceof ApiError && e.status === 401));
          throw e;
        }),
    [],
  );
  useEffect(() => {
    live.current = true;
    if (!loggedIn) {
      setData(null);
      return;
    }
    const cancel = poll(load, 10_000);
    return () => {
      live.current = false;
      cancel();
    };
  }, [loggedIn, load]);
  return { data, failed, refresh: () => void load().catch(() => undefined) };
}

/** Pedidos recebidos e convites: o número no item "Amigos" do menu. */
export const friendsBadge = (data: FriendList | null) => (data ? data.incoming.length + data.invites.length : 0);

const STATUS_KEY: Record<FriendPresence, MessageKey> = {
  playing: 'friends.statusPlaying',
  online: 'friends.statusOnline',
  offline: 'friends.statusOffline',
};

/** Faixa "Convite de amigo" na tela inicial, um por convite. */
export function FriendInvites({ invites, onJoin, onDecline }: { invites: FriendInvite[]; onJoin: (invite: FriendInvite) => void; onDecline: (code: string) => void }) {
  const t = useT();
  return (
    <>
      {invites.map((i) => (
        <div key={i.code} className="home-banner friend-invite" role="status">
          <span className="play-ico">
            <Icon name="user" size={16} />
          </span>
          <div className="home-banner-text">
            <strong>{t('friends.inviteKicker')}</strong>
            <span>{t('friends.inviteBanner', { name: i.from.name, format: i.kind === 'yonko' ? t('friends.inviteYonko') : i.format })}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => onDecline(i.code)}>
              {t('friends.inviteDecline')}
            </button>
            <button type="button" className="btn primary" onClick={() => onJoin(i)}>
              {t('friends.inviteJoin')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/** Um formato para o qual dá para convidar: 1 contra 1 nas regras de cartas de `label`, ou a mesa do Yonko. */
export interface InviteOption {
  key: string;
  label: string;
  /** O deck que vai para a partida. */
  deck?: string;
  /** Por que não dá para convidar neste formato (null: dá). */
  blocked: string | null;
}

/**
 * Folha "Amigos". Convidar abre os formatos (`inviteOptions`); `onInvite` cria a sala (ou a mesa) do formato
 * escolhido e avisa o amigo; `inviteBlocked` diz por que não dá para convidar agora (partida em andamento).
 */
export function FriendsSheet({
  loggedIn,
  data,
  failed,
  refresh,
  initialCode,
  linked,
  inviteOptions,
  onInvite,
  inviteBlocked,
  onClose,
}: {
  loggedIn: boolean;
  data: FriendList | null;
  failed: boolean;
  refresh: () => void;
  initialCode?: string;
  /** Chegou por um link de amigo. */
  linked?: boolean;
  inviteOptions: InviteOption[];
  onInvite: (friend: { id: string; name: string }, option: string) => Promise<void>;
  inviteBlocked: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(linked ? t('friends.linkAdd') : null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Amigo com os formatos do convite abertos. */
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<string | null | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    act(async () => {
      const r = await api.friends.request(code.trim().toUpperCase());
      setCode('');
      return r.status === 'accepted' ? t('friends.nowFriends', { name: r.name }) : t('friends.requestSent', { name: r.name });
    });

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(friendLink(data.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem área de transferência: o código continua à vista */
    }
  };

  const online = data?.friends.filter((f) => f.status !== 'offline').length ?? 0;

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet" onClick={onClose}>
      <div className="sheet friends-sheet" role="dialog" aria-modal="true" aria-labelledby="friends-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3 id="friends-title">{t('friends.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {!loggedIn ? (
            <p className="muted">{t('friends.loginNeeded')}</p>
          ) : !data ? (
            failed ? <p className="error">{t('friends.loadFailed')}</p> : <p className="muted small">{t('common.loading')}</p>
          ) : (
            <>
              <section className="friends-me">
                <div className="friends-code">
                  <span className="muted small">{t('friends.myCode')}</span>
                  <strong className="friend-code">{data.code}</strong>
                </div>
                <button type="button" className="btn-outline" onClick={() => void copy()}>
                  {copied ? t('friends.copied') : t('friends.copyLink')}
                </button>
                <p className="muted small">{t('friends.shareHint')}</p>
              </section>

              <form
                className="mode-field friends-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === 8) void add();
                }}
              >
                <label htmlFor="friend-code">{t('friends.addLabel')}</label>
                <div className="code-row">
                  <input
                    id="friend-code"
                    value={code}
                    maxLength={8}
                    placeholder={t('friends.addPlaceholder')}
                    autoComplete="off"
                    autoCapitalize="characters"
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  />
                  <button type="submit" className="btn primary" disabled={busy || code.length !== 8}>
                    {t('friends.add')}
                  </button>
                </div>
              </form>
              {notice && <p className="home-notice">{notice}</p>}
              {error && <p className="error">{error}</p>}

              {data.incoming.length > 0 && (
                <section>
                  <h4>{t('friends.incoming')}</h4>
                  <ul className="friends-list">
                    {data.incoming.map((f) => (
                      <li key={f.id}>
                        <span className="friend-name">{f.name}</span>
                        <span className="btn-row">
                          <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.friends.remove(f.id))}>
                            {t('friends.decline')}
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={() => void act(async () => (await api.friends.accept(f.id), t('friends.nowFriends', { name: f.name })))}
                          >
                            {t('friends.accept')}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h4>
                  {t('friends.listTitle')} {data.friends.length > 0 && <span className="muted small">· {t('friends.onlineCount', { n: online })}</span>}
                </h4>
                {data.friends.length === 0 ? (
                  <p className="muted small">{t('friends.empty')}</p>
                ) : (
                  <ul className="friends-list">
                    {data.friends.map((f) => (
                      <li key={f.id} className={`friend-${f.status}`}>
                        <span className={`friend-dot ${f.status}`} aria-hidden="true" />
                        <span className="friend-name">
                          {f.name}
                          <small className="muted">{t(STATUS_KEY[f.status])}</small>
                        </span>
                        <span className="btn-row">
                          <button
                            type="button"
                            className="btn-outline"
                            disabled={busy}
                            onClick={() => window.confirm(t('friends.removeConfirm', { name: f.name })) && void act(() => api.friends.remove(f.id))}
                          >
                            {t('friends.remove')}
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy || Boolean(inviteBlocked) || f.status === 'playing'}
                            title={inviteBlocked ?? t('friends.inviteTitle', { name: f.name })}
                            aria-expanded={choosing === f.id}
                            onClick={() => setChoosing(choosing === f.id ? null : f.id)}
                          >
                            {t('friends.invite')}
                          </button>
                        </span>
                        {choosing === f.id && !inviteBlocked && f.status !== 'playing' && (
                          <div className="friend-formats" role="group" aria-label={t('friends.inviteTo', { name: f.name })}>
                            <span className="muted small">{t('friends.inviteTo', { name: f.name })}</span>
                            {inviteOptions.map((o) => (
                              <button
                                key={o.key}
                                type="button"
                                className="friend-format"
                                disabled={busy || Boolean(o.blocked)}
                                onClick={() => {
                                  setChoosing(null);
                                  void act(() => onInvite(f, o.key));
                                }}
                              >
                                <b>{o.label}</b>
                                <small>{o.blocked ?? (o.deck ? t('friends.inviteDeck', { deck: o.deck }) : '')}</small>
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {inviteBlocked && data.friends.length > 0 && <p className="muted small">{inviteBlocked}</p>}
              </section>

              {data.outgoing.length > 0 && (
                <section>
                  <h4>{t('friends.outgoing')}</h4>
                  <ul className="friends-list">
                    {data.outgoing.map((f) => (
                      <li key={f.id}>
                        <span className="friend-name">{f.name}</span>
                        <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.friends.remove(f.id))}>
                          {t('friends.cancelRequest')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Entre dois convites para o mesmo amigo (o intervalo do servidor): o botão volta depois disso. */
const INVITE_AGAIN_MS = 15_000;

/**
 * Painel "Chamar amigos" de uma mesa já aberta (a sala de espera do Yonko): a lista de amigos com o status
 * e um botão por amigo, que manda o aviso sem sair da mesa. Só com login; `full`: a mesa não tem lugar vago.
 */
export function TableFriends({ invite, full }: { invite: (friendId: string) => Promise<unknown>; full: boolean }) {
  const t = useT();
  const { user } = useAuth();
  const { data } = useFriends(Boolean(user));
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent'>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  if (!user || !data) return null;

  const mark = (id: string, state?: 'sending' | 'sent') =>
    setSent((s) => {
      const { [id]: _, ...rest } = s;
      return state ? { ...rest, [id]: state } : rest;
    });
  const call = async (id: string) => {
    mark(id, 'sending');
    setError(null);
    try {
      await invite(id);
      mark(id, 'sent');
      timers.current.push(setTimeout(() => mark(id), INVITE_AGAIN_MS));
    } catch (e) {
      mark(id);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="yk-panel table-friends">
      <h3>{t('friends.tableTitle')}</h3>
      {data.friends.length === 0 ? (
        <p className="muted small">{t('friends.tableEmpty')}</p>
      ) : (
        <>
          <p className="muted small">{t('friends.tableHint')}</p>
          {error && <p className="error">{error}</p>}
          <ul className="friends-list">
            {data.friends.map((f) => (
              <li key={f.id} className={`friend-${f.status}`}>
                <span className={`friend-dot ${f.status}`} aria-hidden="true" />
                <span className="friend-name">
                  {f.name}
                  <small className="muted">{t(STATUS_KEY[f.status])}</small>
                </span>
                <button type="button" className="btn small primary" disabled={full || f.status === 'playing' || Boolean(sent[f.id])} onClick={() => void call(f.id)}>
                  {sent[f.id] === 'sent' ? t('friends.inviteSent') : t('friends.invite')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
