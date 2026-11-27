// Amigos e convite direto para partida (roadmap E2).
//
// Só com login: a amizade liga duas contas Google. Cada conta tem um código de amigo (8 letras)
// e um link `/?amigo=CÓDIGO`; quem recebe o pedido aceita ou recusa, e qualquer um dos dois
// desfaz a amizade quando quiser.
//
// O que um amigo vê do outro: o nome público (`players.name`, nunca o nome da conta Google), a
// foto que a pessoa enviou no jogo (nunca a do Google; sem foto enviada, o navegador mostra a inicial), a
// recompensa e o status (online, jogando, offline) que o lobby já conhece pela presença (menu
// aberto, sala de espera, fila, partida). Nunca qual partida nem o código de uma sala: o código
// só chega a quem foi convidado. Quem não é amigo (pedido pendente) não vê o status.
//
// Convite: quem convida cria uma sala privada pelo caminho de sempre (`POST /api/online/rooms`)
// e manda `POST /api/friends/:id/invite {roomId, token}`. O servidor confere que o lugar de quem
// criou é dele e que a sala ainda espera oponente, guarda o convite em memória enquanto a sala
// espera e avisa o amigo por push (`/?convite=CÓDIGO`, que entra direto na sala). Com o app
// aberto, o convite aparece na tela inicial (o `GET /api/friends` traz os convites).
//
// Convite para o Yonko: o mesmo pedido com `{tableId, token}` de uma mesa em que quem convida tem
// lugar (`POST /api/yonko/tables`). Qualquer um sentado pode chamar os amigos (o código da mesa já
// está à vista de todos na sala de espera), e o convite vale enquanto a mesa espera com lugar vago.
// O aviso abre `/?yonko=CÓDIGO&convite=1`, que senta o amigo na mesa.

import { formatLabel } from '@gumgum/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountOwnerKey, customPictureOf, getUser, type User } from '../auth/store';
import type { DB } from '../db';
import { fail } from '../errors';
import type { Lobby } from '../online/lobby';
import { type PushKey, pushText } from '../push/messages';
import type { Notifier } from '../push/routes';
import { ensurePlayer } from '../stats/store';
import type { YonkoTables } from '../yonko/routes';
import { acceptFriend, areFriends, friendCode, friendship, friendSlots, isFriendCode, listFriendships, MAX_FRIENDS, removeFriend, requestFriend, userByFriendCode } from './store';

/** Convites guardados por pessoa (os mais antigos saem primeiro). */
const MAX_INVITES = 20;
/** O convite vale enquanto a sala espera, e no máximo isto (o mesmo prazo da sala privada). */
export const INVITE_TTL_MS = 30 * 60_000;
/** Entre dois convites para o mesmo amigo. */
export const INVITE_GAP_MS = 15_000;
/** Pedidos de amizade por conta numa janela (o código tem 40 bits: isso impede varrer códigos). */
export const REQUEST_LIMIT = 30;
export const REQUEST_WINDOW_MS = 60 * 60_000;

interface Invite {
  from: string;
  /** Sala privada de dois jogadores ou mesa do Yonko. */
  kind: 'room' | 'yonko';
  roomId: string;
  code: string;
  format: string;
  at: number;
}

interface Deps {
  db: DB;
  user: (req: FastifyRequest) => User | null;
  lobby: Lobby;
  yonko: Pick<YonkoTables, 'get' | 'presenceOf'>;
  notifier: Notifier;
  now?: () => number;
}

export function registerFriendRoutes(app: FastifyInstance, { db, user, lobby, yonko, notifier, now = () => Date.now() }: Deps) {
  /** Convites recebidos, por conta convidada (só em memória: um reinício do servidor os apaga, como as salas de espera). */
  const invites = new Map<string, Invite[]>();
  /** Último convite de A para B (`A>B`), para o intervalo entre convites. */
  const lastInvite = new Map<string, number>();
  /** Pedidos de amizade recentes por conta. */
  const requests = new Map<string, number[]>();

  const nameOf = (userId: string) => ensurePlayer(db, accountOwnerKey(userId)).name;
  /** Status para os amigos: o do lobby (menu, fila, sala, partida) junto com o das mesas do Yonko. */
  const presence = (userId: string) => {
    const key = accountOwnerKey(userId);
    const duel = lobby.presenceOf(key);
    return duel === 'playing' ? duel : (yonko.presenceOf(key, userId) ?? duel);
  };

  const needUser = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const me = user(req);
    if (!me) void reply.code(401).send(fail('friendsLoginRequired', 'Entre com a conta Google para ter amigos.'));
    return me;
  };

  /** O convite ainda leva a algum lugar: a sala espera oponente; a mesa espera, tem lugar vago e a pessoa ainda não sentou nela. */
  const stillOpen = (i: Invite, me: string) => {
    if (i.kind === 'room') return lobby.isWaiting(i.code);
    const table = yonko.get(i.roomId);
    return Boolean(table?.open && !table.tokenOf(accountOwnerKey(me), me));
  };

  /** Convites ainda válidos para a conta (a sala continua à espera e quem convidou ainda é amigo). */
  const invitesFor = (me: string): Invite[] => {
    const at = now();
    const list = (invites.get(me) ?? []).filter((i) => at - i.at < INVITE_TTL_MS && stillOpen(i, me) && areFriends(db, me, i.from));
    if (list.length) invites.set(me, list);
    else invites.delete(me);
    return list;
  };

  const dropInvites = (to: string, from?: string) => {
    const list = invites.get(to);
    if (!list) return;
    const left = from ? list.filter((i) => i.from !== from) : [];
    if (left.length) invites.set(to, left);
    else invites.delete(to);
  };

  const notify = (to: string, key: { title: PushKey; body: PushKey }, params: Record<string, string>, tag: string, url: string, ttl: number) =>
    void notifier.notify(
      { userIds: [to] },
      {
        category: 'friends',
        text: (locale) => ({ title: pushText(locale, key.title), body: pushText(locale, key.body, params) }),
        tag,
        url,
        ttl,
        urgency: ttl <= 600 ? 'high' : 'normal',
      },
    );

  app.get('/api/friends', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    // Quem está com a lista aberta também conta como online para os amigos.
    lobby.touch(accountOwnerKey(me.id));
    const all = listFriendships(db, me.id);
    const person = (id: string) => {
      const p = ensurePlayer(db, accountOwnerKey(id));
      return { id, name: p.name, bounty: p.bounty };
    };
    const order = { playing: 0, online: 1, offline: 2 } as const;
    const friends = all
      .filter((f) => f.status === 'accepted')
      .map((f) => ({ ...person(f.other), picture: customPictureOf(db, f.other), status: presence(f.other), since: f.acceptedAt }))
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    return {
      code: friendCode(db, me.id),
      // Como os amigos me veem: o apelido e a foto enviada no jogo (null: a inicial).
      me: { name: nameOf(me.id), picture: customPictureOf(db, me.id) },
      max: MAX_FRIENDS,
      friends,
      incoming: all.filter((f) => f.status === 'pending' && !f.mine).map((f) => ({ ...person(f.other), at: f.createdAt })),
      outgoing: all.filter((f) => f.status === 'pending' && f.mine).map((f) => ({ ...person(f.other), at: f.createdAt })),
      invites: invitesFor(me.id).map((i) => ({ from: { id: i.from, name: nameOf(i.from), picture: customPictureOf(db, i.from) }, kind: i.kind, code: i.code, format: i.format, at: new Date(i.at).toISOString() })),
    };
  });

  app.post<{ Body: { code?: unknown } }>('/api/friends/requests', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    const code = req.body?.code;
    if (!isFriendCode(code)) return reply.code(400).send(fail('invalidFriendCode', 'Código de amigo inválido.'));
    const at = now();
    const recent = (requests.get(me.id) ?? []).filter((t) => at - t < REQUEST_WINDOW_MS);
    if (recent.length >= REQUEST_LIMIT) {
      return reply.code(429).send(fail('tooManyFriendRequests', 'Muitos pedidos de amizade em pouco tempo. Tente de novo mais tarde.'));
    }
    recent.push(at);
    requests.set(me.id, recent);
    const other = userByFriendCode(db, code);
    if (!other) return reply.code(404).send(fail('friendNotFound', 'Nenhum jogador com esse código de amigo.'));
    if (other === me.id) return reply.code(400).send(fail('ownFriendCode', 'Esse é o seu próprio código de amigo.'));
    const before = friendship(db, me.id, other);
    // Aceitar um pedido recebido não ocupa vaga nova do outro lado: só o pedido novo é conferido.
    if (!before) {
      if (friendSlots(db, me.id) >= MAX_FRIENDS) return reply.code(409).send(fail('friendLimit', `Você chegou ao limite de ${MAX_FRIENDS} amigos.`, { max: MAX_FRIENDS }));
      if (friendSlots(db, other) >= MAX_FRIENDS) return reply.code(409).send(fail('friendLimitOther', 'Esse jogador chegou ao limite de amigos.'));
    }
    const r = requestFriend(db, me.id, other);
    const name = nameOf(me.id);
    if (r.changed && r.status === 'pending') {
      notify(other, { title: 'friendRequestTitle', body: 'friendRequestBody' }, { name }, `friend-${me.id}`, '/?amigos=1', 86_400);
    } else if (r.changed) {
      notify(other, { title: 'friendAcceptedTitle', body: 'friendAcceptedBody' }, { name }, `friend-${me.id}`, '/?amigos=1', 86_400);
    }
    return reply.code(r.changed ? 201 : 200).send({ id: other, name: nameOf(other), status: r.status });
  });

  app.post<{ Params: { id: string } }>('/api/friends/:id/accept', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    const other = req.params.id;
    if (!acceptFriend(db, me.id, other)) return reply.code(404).send(fail('friendRequestNotFound', 'Pedido de amizade não encontrado.'));
    notify(other, { title: 'friendAcceptedTitle', body: 'friendAcceptedBody' }, { name: nameOf(me.id) }, `friend-${me.id}`, '/?amigos=1', 86_400);
    return { id: other, status: 'accepted' };
  });

  /** Recusar um pedido, cancelar o que enviei ou desfazer a amizade. */
  app.delete<{ Params: { id: string } }>('/api/friends/:id', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    const other = req.params.id;
    if (!removeFriend(db, me.id, other)) return reply.code(404).send(fail('friendshipNotFound', 'Amizade ou pedido não encontrado.'));
    dropInvites(me.id, other);
    dropInvites(other, me.id);
    return reply.code(204).send();
  });

  /** A sala privada de quem convida (`roomId`) ou a mesa do Yonko em que tem lugar (`tableId`), ou o motivo da recusa. */
  const inviteTarget = (me: User, body: { roomId?: unknown; tableId?: unknown; token?: unknown } | undefined): Pick<Invite, 'kind' | 'roomId' | 'code' | 'format'> | ReturnType<typeof fail> & { status: number } => {
    const mine = (seat: { userId: string | null; ownerHash: string | null } | null | undefined) => Boolean(seat && (seat.userId === me.id || seat.ownerHash === accountOwnerKey(me.id)));
    if (typeof body?.tableId === 'string') {
      const table = yonko.get(body.tableId);
      const seat = table?.seatOfToken(body.token) ?? null;
      // O token prova o lugar; a conta também tem de ser a de quem senta nele.
      if (!table || seat === null || !mine(table.data.seats[seat])) return { status: 404, ...fail('yonkoNotFound', 'Mesa não encontrada.') };
      if (table.status !== 'waiting') return { status: 409, ...fail('yonkoStarted', 'A partida desta mesa já começou.') };
      if (!table.open) return { status: 409, ...fail('yonkoFull', 'A mesa está cheia.') };
      return { kind: 'yonko', roomId: table.id, code: table.data.code, format: 'Yonko' };
    }
    const room = typeof body?.roomId === 'string' ? lobby.ownWaitingRoom(body.roomId, body.token) : null;
    // O token prova o lugar; a conta também tem de ser a de quem criou a sala.
    if (!room?.data.code || !mine(room.data.seats[0])) return { status: 404, ...fail('roomNotFound', 'Sala não encontrada ou já começou.') };
    return { kind: 'room', roomId: room.id, code: room.data.code, format: formatLabel(room.data.format) };
  };

  app.post<{ Params: { id: string }; Body: { roomId?: unknown; tableId?: unknown; token?: unknown } }>('/api/friends/:id/invite', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    const other = req.params.id;
    if (!getUser(db, other) || !areFriends(db, me.id, other)) return reply.code(404).send(fail('notFriends', 'Vocês não são amigos.'));
    const target = inviteTarget(me, req.body);
    if ('status' in target) {
      const { status, ...body } = target;
      return reply.code(status).send(body);
    }
    // O amigo já está sentado nesta mesa: não há o que avisar.
    if (target.kind === 'yonko' && yonko.get(target.roomId)?.tokenOf(accountOwnerKey(other), other)) return { ok: true };
    const at = now();
    const key = `${me.id}>${other}`;
    const last = lastInvite.get(key);
    // Convidar de novo para a mesma sala é só repetir o aviso: o intervalo evita a rajada de notificações.
    if (last !== undefined && at - last < INVITE_GAP_MS) return reply.code(429).send(fail('inviteTooSoon', 'Espere um pouco antes de convidar de novo.'));
    lastInvite.set(key, at);
    if (lastInvite.size > 10_000) for (const [k, t] of lastInvite) if (at - t >= INVITE_GAP_MS) lastInvite.delete(k);
    const list = (invites.get(other) ?? []).filter((i) => i.from !== me.id);
    list.push({ from: me.id, ...target, at });
    invites.set(other, list.slice(-MAX_INVITES));
    const name = nameOf(me.id);
    if (target.kind === 'yonko') {
      notify(other, { title: 'friendInviteTitle', body: 'friendInviteYonkoBody' }, { name }, `invite-${me.id}`, `/?yonko=${target.code}&convite=1`, 600);
    } else {
      notify(other, { title: 'friendInviteTitle', body: 'friendInviteBody' }, { name, format: target.format }, `invite-${me.id}`, `/?convite=${target.code}`, 600);
    }
    return reply.code(201).send({ ok: true });
  });

  /** Recusar um convite: some da tela inicial (a sala de quem convidou continua aberta). */
  app.delete<{ Params: { code: string } }>('/api/friends/invites/:code', async (req, reply) => {
    const me = needUser(req, reply);
    if (!me) return reply;
    const code = req.params.code.toUpperCase();
    const list = (invites.get(me.id) ?? []).filter((i) => i.code !== code);
    if (list.length) invites.set(me.id, list);
    else invites.delete(me.id);
    return reply.code(204).send();
  });
}
