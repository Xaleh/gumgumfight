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

import type { Action, CardDef, EffectStep, Frame, GameState, ManualOp, Pending, PlayerId, PlayerState } from './types';

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

/** Apelidos iguais aos uids: para montar a visão de um jogador numa partida local (o bot no navegador). */
export function identityAliases(state: GameState): Aliases {
  const map: Record<string, string> = {};
  for (const uid of Object.keys(state.cards)) map[uid] = uid;
  return { toAlias: map, toUid: map };
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
  // A carta do [Trigger] em resolução, fora de qualquer área (10-1-5-3): foi revelada.
  for (const u of state.limbo ?? []) out.add(u);
  const p = state.pending;
  if (p && viewer !== null && p.player === viewer) {
    if (p.kind === 'selectTargets' || p.kind === 'block' || p.kind === 'counter') for (const u of p.options) out.add(u);
    if (p.kind === 'selectTargets') for (const u of p.shown ?? []) out.add(u);
    if (p.kind === 'lifeCard') out.add(p.card);
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
    stack: state.stack.map((f) => sanitizeFrame(state, f, viewer, ref, vis)),
    ...(state.limbo ? { limbo: state.limbo.map(alias) } : {}),
    // Efeitos disparados esperando a vez: os do próprio jogador inteiros (ele precisa simulá-los para
    // decidir; os passos são o texto da carta dele); os do oponente só com a carta de origem.
    triggered: state.triggered?.map((e) =>
      viewer !== null && e.controller === viewer
        ? { ...e, source: ref(e.source), last: refs(e.last) }
        : { id: e.id, source: ref(e.source), controller: e.controller, steps: [], label: e.label, batch: e.batch },
    ),
    pending: state.pending ? viewPending(state.pending, viewer, ref) : null,
    modifiers: state.modifiers.filter((m) => vis.has(m.uid)).map((m) => ({ ...m, uid: alias(m.uid) })),
    usedThisTurn: state.usedThisTurn.map(usedKey).filter((k): k is string => k !== null),
    battledCharacter: refs(state.battledCharacter),
    delayed: state.delayed?.filter((d) => vis.has(d.source)).map((d) => ({ ...d, source: alias(d.source), last: refs(d.last) })),
    tempReplacements: state.tempReplacements?.filter((t) => vis.has(t.source)).map((t) => ({ ...t, source: alias(t.source) })),
    log: state.log.map(({ secret, ...e }) => (secret !== undefined && viewer !== null && e.player === viewer ? { ...e, text: secret } : e)),
    // A ação cancelável é pública (a interface mostra o botão); o estado guardado para restaurar, não.
    cancel: state.cancel ? { ...state.cancel, action: aliasAction(state.cancel.action, ref) } : undefined,
  };
  delete view.rng128;
  delete view.checkpoint;
  if (!view.cancel) delete view.cancel;
  return view;
}

/** Troca as referências a cartas de uma ação (uid real → apelido, ou escondido). */
function aliasAction(action: Action, ref: (uid: string) => string): Action {
  switch (action.type) {
    case 'playCard':
    case 'activate':
      return { ...action, uid: ref(action.uid) };
    case 'counter':
      return { ...action, uid: ref(action.uid), ...(action.target !== undefined ? { target: ref(action.target) } : {}) };
    case 'attachDon':
    case 'detachDon':
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

/**
 * Frames da pilha. Os efeitos do próprio jogador vão inteiros (passos, escolhas, alvos): são o texto
 * das cartas dele e as respostas que ele mesmo deu, e o bot precisa deles para simular as escolhas
 * pendentes. Os do oponente ficam só com a carta de origem. Nos frames de dano, a carta da Vida só
 * aparece se o jogador a vê.
 */
function sanitizeFrame(state: GameState, f: Frame, viewer: PlayerId | null, ref: (uid: string) => string, vis: Set<string>): Frame {
  const refs = (uids: string[] | undefined) => uids?.map(ref);
  switch (f.kind) {
    case 'effect':
      if (viewer !== null && f.controller === viewer) {
        // Passos inseridos durante a resolução carregam uids (vítimas de uma substituição, DON!! dados…);
        // escolhas e memória podem ser uids ou marcadores ("yes", índices): só o que é uid muda.
        const isUid = (x: string) => x in state.cards;
        const deep = (x: unknown): unknown => {
          if (typeof x === 'string') return isUid(x) ? ref(x) : x;
          if (Array.isArray(x)) return x.map(deep);
          if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v)]));
          return x;
        };
        return {
          ...f,
          source: ref(f.source),
          steps: deep(f.steps) as EffectStep[],
          choice: f.choice?.map((c) => (isUid(c) ? ref(c) : c)),
          memo: f.memo?.map((m) => (isUid(m) ? ref(m) : m)),
          last: refs(f.last),
          revealed: refs(f.revealed),
          trashed: refs(f.trashed),
        };
      }
      return { kind: 'effect', source: ref(f.source), controller: f.controller, steps: [], i: 0, ...(f.trigger ? { trigger: true as const } : {}) };
    case 'damage': {
      const { lifeCard, ...rest } = f;
      return lifeCard && vis.has(lifeCard) ? { ...rest, lifeCard: ref(lifeCard) } : rest;
    }
    case 'play':
      return { ...f, uid: ref(f.uid), replaceChoice: refs(f.replaceChoice) };
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
    case 'selectTargets': {
      if (mine) return { ...p, options: p.options.map(ref), source: ref(p.source), ...(p.shown ? { shown: p.shown.map(ref) } : {}) };
      // O prompt (e sua chave/parâmetros, que o reconstroem) é só do dono.
      const { promptKey: _k, promptParams: _pp, ...rest } = p;
      return { ...rest, options: [], min: 0, max: 0, prompt: '', source: ref(p.source), shown: undefined };
    }
    case 'block':
    case 'counter':
      return { ...p, options: mine ? p.options.map(ref) : [] };
    case 'lifeCard':
      // O oponente vê que há uma carta da Vida sendo olhada, nunca qual (nem se tem [Trigger]).
      return { ...p, card: ref(p.card) };
    case 'confirm': {
      // O oponente não vê o prompt nem se o "sim" está disponível (isso contaria a mão). No "draw up
      // to N", só vê que há uma pergunta; quantas foram compradas ele vê pelo tamanho da mão.
      const { cannot, drawUpTo, promptKey, promptParams, ...rest } = p;
      return {
        ...rest,
        source: ref(p.source),
        prompt: mine ? p.prompt : '',
        ...(mine && promptKey ? { promptKey } : {}),
        ...(mine && promptParams ? { promptParams } : {}),
        ...(mine && cannot ? { cannot } : {}),
        ...(mine && drawUpTo ? { drawUpTo } : {}),
      };
    }
    case 'option': {
      const { don, promptKey, promptParams, optionKeys, ...rest } = p;
      return {
        ...rest,
        source: ref(p.source),
        prompt: mine ? p.prompt : '',
        ...(mine && promptKey ? { promptKey } : {}),
        ...(mine && promptParams ? { promptParams } : {}),
        options: mine ? p.options : [],
        ...(mine && optionKeys ? { optionKeys } : {}),
        ...(mine && don ? { don: don.map((d) => (d === 'active' || d === 'rested' ? d : ref(d))) } : {}),
      };
    }
    case 'manual':
      return { ...p, source: ref(p.source) };
  }
}

/**
 * Decisão que pode esconder informação do dono: Counter, carta da Vida, perguntas "pagar X?"
 * e escolhas que leem a mão ou o deck. Elas abrem sempre, e o bot responde a elas com um
 * tempo aleatório, para a pressa (ou a demora) não contar se havia algo a usar.
 */
export function hiddenDecision(p: Pending | null | undefined): boolean {
  if (!p) return false;
  return p.kind === 'counter' || p.kind === 'lifeCard' || p.kind === 'confirm' || (p.kind === 'selectTargets' && Boolean(p.hidden));
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
    case 'activate': {
      const uid = real(action.uid);
      return uid ? { ...action, uid } : bad;
    }
    case 'counter': {
      const uid = real(action.uid);
      if (!uid) return bad;
      if (action.target === undefined) return { ...action, uid };
      const target = real(action.target);
      return target ? { ...action, uid, target } : bad;
    }
    case 'attachDon':
    case 'detachDon': {
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
  return aliasAction(action, (uid) => (vis.has(uid) ? aliases.toAlias[uid] ?? uid : HIDDEN_REF));
}
