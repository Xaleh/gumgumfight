// Endereços dos amigos (roadmap E2), lidos pelo App ao abrir a página ou ao tocar numa notificação:
//   /?amigo=CÓDIGO   abre a folha de amigos com o código já preenchido (link para adicionar)
//   /?amigos=1       abre a folha (toque no aviso de pedido de amizade)
//   /?convite=SALA   entra direto na sala privada do convite (toque no aviso de convite)

export const FRIEND_PARAM = 'amigo';
export const FRIENDS_PARAM = 'amigos';
export const INVITE_PARAM = 'convite';

/** Pedido vindo de um endereço (link, notificação): o que fazer ao chegar na tela inicial. */
export interface FriendLink {
  /** Código de amigo para preencher. */
  add?: string;
  /** Abrir a folha. */
  open?: boolean;
  /** Código da sala do convite: entrar direto. */
  invite?: string;
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
  url.searchParams.delete(FRIEND_PARAM);
  url.searchParams.delete(INVITE_PARAM);
  url.searchParams.delete(FRIENDS_PARAM);
  return {
    ...(FRIEND_CODE.test(add) ? { add, open: true } : {}),
    ...(open ? { open: true } : {}),
    ...(ROOM_CODE.test(invite) ? { invite } : {}),
    at: Date.now(),
  };
}

/** Link para alguém me adicionar. */
export const friendLink = (code: string) => `${location.origin}/?${FRIEND_PARAM}=${code}`;
