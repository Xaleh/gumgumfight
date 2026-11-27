// Endereços dos amigos (roadmap E2), lidos pelo App ao abrir a página ou ao tocar numa notificação:
//   /?amigo=CÓDIGO   abre a folha de amigos com o código já preenchido (link para adicionar)
//   /?amigos=1       abre a folha (toque no aviso de pedido de amizade)
//   /?convite=SALA   entra direto na sala privada do convite (toque no aviso de convite)
//   /?yonko=MESA&convite=1   senta direto na mesa do Yonko do convite (toque no aviso de convite).
//                            Sem o `convite`, `/?yonko=MESA` é o link da mesa: abre a entrada do Yonko (App.tsx).

export const FRIEND_PARAM = 'amigo';
export const FRIENDS_PARAM = 'amigos';
export const INVITE_PARAM = 'convite';
export const YONKO_PARAM = 'yonko';

/** Pedido vindo de um endereço (link, notificação): o que fazer ao chegar na tela inicial. */
export interface FriendLink {
  /** Código de amigo para preencher. */
  add?: string;
  /** Abrir a folha. */
  open?: boolean;
  /** Código da sala do convite: entrar direto. */
  invite?: string;
  /** Código da mesa do Yonko do convite: sentar direto. */
  yonko?: string;
  /** Muda a cada pedido (o mesmo link duas vezes ainda abre de novo). */
  at: number;
}

const FRIEND_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const ROOM_CODE = /^[A-Z0-9]{6}$/;

/** Lê (e tira) os parâmetros dos amigos de um endereço. null: nenhum. */
export function friendLinkFrom(url: URL): FriendLink | null {
  const add = url.searchParams.get(FRIEND_PARAM)?.trim().toUpperCase() ?? '';
  const invite = url.searchParams.get(INVITE_PARAM)?.trim().toUpperCase() ?? '';
  const open = url.searchParams.has(FRIENDS_PARAM);
  if (!add && !invite && !open) return null;
  // Convite para a mesa do Yonko: o código vem em `yonko`, e o `convite` só marca que é um convite.
  const yonko = invite ? (url.searchParams.get(YONKO_PARAM)?.trim().toUpperCase() ?? '') : '';
  if (yonko) url.searchParams.delete(YONKO_PARAM);
  url.searchParams.delete(FRIEND_PARAM);
  url.searchParams.delete(INVITE_PARAM);
  url.searchParams.delete(FRIENDS_PARAM);
  return {
    ...(FRIEND_CODE.test(add) ? { add, open: true } : {}),
    ...(open ? { open: true } : {}),
    ...(yonko ? (ROOM_CODE.test(yonko) ? { yonko } : {}) : ROOM_CODE.test(invite) ? { invite } : {}),
    at: Date.now(),
  };
}

/** Link para alguém me adicionar. */
export const friendLink = (code: string) => `${location.origin}/?${FRIEND_PARAM}=${code}`;
