// Visão de um jogador: o estado da partida sem o que ele não pode ver.
//
// No online o servidor guarda o estado completo e manda a cada jogador só a sua
// visão. Ela tem o mesmo formato do GameState, então a interface, legalActions e
// as consultas do motor funcionam sobre ela. O que muda:
//
// - Os uids viram apelidos aleatórios da partida. Os uids do motor ("c1", "c2"…)
//   seguem a ordem da lista do deck, então revelariam qual carta é qual.
// - Cartas escondidas (mão do oponente, decks, Vida virada para baixo) aparecem
//   como HIDDEN_CARD, com um identificador de posição ("~0:deck:3") que muda a cada
//   visão; assim não dá para seguir uma carta depois que ela some de vista.
// - Definições só das cartas que o jogador já pode ver; seed e RNG zerados.
// - Escolhas pendentes e a pilha do oponente sem os detalhes; log sem as linhas secretas.

import type { Action, CardDef, Frame, GameState, ManualOp, Pending, PlayerId, PlayerState } from './types';

export const HIDDEN_CARD = '?';
/** Referência para uma carta que o jogador não vê (fora das zonas). */
export const HIDDEN_REF = '~';

export const HIDDEN_DEF: CardDef = {
  id: HIDDEN_CARD,
  name: 'Carta escondida',
  category: 'character',
  colors: [],
  types: [],
  text: '',
  keywords: [],
  abilities: [],
  scripted: false,
  manual: false,
};

type Zone = 'hand' | 'deck' | 'life';

/** Apelidos dos uids (uid real → apelido) e o caminho inverso. */
export interface Aliases {
  toAlias: Record<string, string>;
  toUid: Record<string, string>;
}

/** Cria apelidos únicos para todas as cartas da partida. `randomId` deve ser imprevisível (crypto). */
export function createAliases(state: GameState, randomId: () => string): Aliases {
  const toAlias: Record<string, string> = {};
  const toUid: Record<string, string> = {};
  for (const uid of Object.keys(state.cards)) {
    let a = randomId();
    while (toUid[a] || a.startsWith(HIDDEN_REF) || a === HIDDEN_CARD) a = randomId();
    toAlias[uid] = a;
    toUid[a] = uid;
  }
  return { toAlias, toUid };
}

const handle = (owner: PlayerId, zone: Zone, index: number) => `${HIDDEN_REF}${owner}:${zone}:${index}`;

/**
 * Cartas que `viewer` pode ver agora (null = espectador: só o público). `extra`:
 * cartas a mais que ele está vendo (ex.: o topo do próprio deck nas ferramentas manuais).
 */
export function visibleCards(state: GameState, viewer: PlayerId | null, extra: Iterable<string> = []): Set<string> {
  if (state.phase === 'gameover') return new Set(Object.keys(state.cards));
  const out = new Set<string>(extra);
  for (const ps of state.players) {
    out.add(ps.leader.uid);
    for (const c of ps.characters) out.add(c.uid);
    if (ps.stage) out.add(ps.stage.uid);
    for (const u of ps.trash) out.add(u);
    for (const u of ps.lifeFaceUp ?? []) if (ps.life.includes(u)) out.add(u);
    if (ps.id === viewer) for (const u of ps.hand) out.add(u);
  }
  // Cartas reveladas por efeitos em resolução ("reveal …").
  for (const f of state.stack) if (f.kind === 'effect') for (const u of f.revealed ?? []) out.add(u);
  const p = state.pending;
  if (p && viewer !== null && p.player === viewer) {
    if (p.kind === 'selectTargets' || p.kind === 'block' || p.kind === 'counter') for (const u of p.options) out.add(u);
    if (p.kind === 'selectTargets') for (const u of p.shown ?? []) out.add(u);
    if (p.kind === 'trigger') out.add(p.card);
  }
  return out;
}

/** Estado visto por `viewer`. */
export function viewFor(state: GameState, viewer: PlayerId | null, aliases: Aliases, extra?: Iterable<string>): GameState {
  const vis = visibleCards(state, viewer, extra);
  const alias = (uid: string) => aliases.toAlias[uid] ?? uid;
  const ref = (uid: string) => (vis.has(uid) ? alias(uid) : HIDDEN_REF);
  const refs = (uids: string[] | undefined) => uids?.filter((u) => vis.has(u)).map(alias);

  const cards: GameState['cards'] = { [HIDDEN_REF]: { uid: HIDDEN_REF, cardId: HIDDEN_CARD, owner: 0 } };
  const defs: GameState['defs'] = { [HIDDEN_CARD]: HIDDEN_DEF };
  for (const uid of vis) {
    const c = state.cards[uid];
    cards[alias(uid)] = { uid: alias(uid), cardId: c.cardId, owner: c.owner };
    defs[c.cardId] = state.defs[c.cardId];
  }
  const zone = (ps: PlayerState, name: Zone) =>
    ps[name].map((uid, i) => {
      if (vis.has(uid)) return alias(uid);
      const h = handle(ps.id, name, i);
      cards[h] = { uid: h, cardId: HIDDEN_CARD, owner: ps.id };
      return h;
    });
  const field = <T extends { uid: string }>(fc: T): T => ({ ...fc, uid: ref(fc.uid) });

  const players = state.players.map(
    (ps): PlayerState => ({
      ...ps,
      leader: field(ps.leader),
      characters: ps.characters.map(field),
      stage: ps.stage ? field(ps.stage) : null,
      hand: zone(ps, 'hand'),
      deck: zone(ps, 'deck'),
      trash: ps.trash.map(alias),
      life: zone(ps, 'life'),
      ...(ps.lifeFaceUp ? { lifeFaceUp: refs(ps.lifeFaceUp) } : {}),
    }),
  ) as [PlayerState, PlayerState];

  const usedKey = (k: string) => {
    const i = k.lastIndexOf(':');
    const uid = k.slice(0, i);
    return vis.has(uid) ? `${alias(uid)}${k.slice(i)}` : null;
  };

  const view: GameState = {
    ...state,
    seed: 0,
    rng: 0,
    players,
    cards,
    defs,
    battle: state.battle
      ? {
          ...state.battle,
          attacker: ref(state.battle.attacker),
          target: ref(state.battle.target),
          originalTarget: ref(state.battle.originalTarget),
          fought: refs(state.battle.fought),
          after: undefined,
        }
      : null,
    stack: state.stack.map((f) => sanitizeFrame(f, ref)),
    pending: state.pending ? viewPending(state.pending, viewer, ref) : null,
    modifiers: state.modifiers.filter((m) => vis.has(m.uid)).map((m) => ({ ...m, uid: alias(m.uid) })),
    usedThisTurn: state.usedThisTurn.map(usedKey).filter((k): k is string => k !== null),
    battledCharacter: refs(state.battledCharacter),
    delayed: state.delayed?.filter((d) => vis.has(d.source)).map((d) => ({ ...d, source: alias(d.source), last: refs(d.last) })),
    tempReplacements: state.tempReplacements?.filter((t) => vis.has(t.source)).map((t) => ({ ...t, source: alias(t.source) })),
    log: state.log.map(({ secret, ...e }) => (secret !== undefined && viewer !== null && e.player === viewer ? { ...e, text: secret } : e)),
  };
  delete view.rng128;
  return view;
}

function sanitizeFrame(f: Frame, ref: (uid: string) => string): Frame {
  switch (f.kind) {
    case 'effect':
      return { kind: 'effect', source: ref(f.source), controller: f.controller, steps: [], i: 0 };
    case 'damage':
      return { kind: 'damage', defender: f.defender, remaining: f.remaining, banish: f.banish };
    case 'play':
      return { kind: 'play', uid: ref(f.uid) };
    default:
      return f;
  }
}

function viewPending(p: Pending, viewer: PlayerId | null, ref: (uid: string) => string): Pending {
  const mine = viewer !== null && p.player === viewer;
  switch (p.kind) {
    case 'chooseFirst':
    case 'mulligan':
      return p;
    case 'selectTargets':
      return mine
        ? { ...p, options: p.options.map(ref), source: ref(p.source), ...(p.shown ? { shown: p.shown.map(ref) } : {}) }
        : { ...p, options: [], min: 0, max: 0, prompt: '', source: ref(p.source), shown: undefined };
    case 'block':
    case 'counter':
      return { ...p, options: mine ? p.options.map(ref) : [] };
    case 'trigger':
      return { ...p, card: ref(p.card) };
    case 'confirm':
      return { ...p, source: ref(p.source), prompt: mine ? p.prompt : '' };
    case 'option':
      return { ...p, source: ref(p.source), prompt: mine ? p.prompt : '', options: mine ? p.options : [] };
    case 'manual':
      return { ...p, source: ref(p.source) };
  }
}

/**
 * Traduz uma ação feita sobre a visão de `player` para os uids reais. Aceita
 * apelidos de cartas que o jogador vê agora e identificadores de posição das
 * zonas escondidas. Devolve uma mensagem de erro se alguma referência não valer.
 */
export function actionFromView(state: GameState, aliases: Aliases, action: Action, extra?: Iterable<string>): Action | string {
  const vis = visibleCards(state, action.player, extra);
  const real = (ref: unknown): string | null => {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith(HIDDEN_REF)) {
      const m = /^~([01]):(hand|deck|life):(\d+)$/.exec(ref);
      if (!m) return null;
      const uid = state.players[Number(m[1]) as PlayerId][m[2] as Zone][Number(m[3])];
      return uid ?? null;
    }
    const uid = aliases.toUid[ref];
    return uid && vis.has(uid) ? uid : null;
  };
  const bad = 'Carta inválida ou fora de vista (a visão pode estar desatualizada).';
  switch (action.type) {
    case 'playCard':
    case 'activate':
    case 'counter': {
      const uid = real(action.uid);
      return uid ? { ...action, uid } : bad;
    }
    case 'attachDon': {
      const target = real(action.target);
      return target ? { ...action, target } : bad;
    }
    case 'attack': {
      const attacker = real(action.attacker);
      const target = real(action.target);
      return attacker && target ? { ...action, attacker, target } : bad;
    }
    case 'choose': {
      if (!Array.isArray(action.uids)) return bad;
      const uids = action.uids.map(real);
      return uids.every((u): u is string => u !== null) ? { ...action, uids } : bad;
    }
    case 'manual': {
      const op = action.op as ManualOp;
      if (op && 'uid' in op) {
        const uid = real(op.uid);
        return uid ? { ...action, op: { ...op, uid } as ManualOp } : bad;
      }
      return action;
    }
    default:
      return action;
  }
}

/** Apelido de um uid real (para traduzir a última ação para os clientes). */
export function aliasRefs(state: GameState, viewer: PlayerId | null, aliases: Aliases, action: Action, extra?: Iterable<string>): Action {
  const vis = visibleCards(state, viewer, extra);
  const ref = (uid: string) => (vis.has(uid) ? aliases.toAlias[uid] ?? uid : HIDDEN_REF);
  switch (action.type) {
    case 'playCard':
    case 'activate':
    case 'counter':
      return { ...action, uid: ref(action.uid) };
    case 'attachDon':
      return { ...action, target: ref(action.target) };
    case 'attack':
      return { ...action, attacker: ref(action.attacker), target: ref(action.target) };
    case 'choose':
      return { ...action, uids: action.uids.map(ref) };
    case 'manual':
      return 'uid' in action.op ? { ...action, op: { ...action.op, uid: ref(action.op.uid) } as ManualOp } : action;
    default:
      return action;
  }
}
