// Motor de regras do One Piece Card Game.
//
// Modelo: `applyAction(estado, ação) -> novo estado`. O estado nunca é mutado:
// cada ação trabalha sobre uma cópia. Efeitos, batalhas e dano são "frames" em uma
// pilha (`state.stack`); quando um frame precisa de uma decisão de um jogador, o
// motor para e registra `state.pending` até a próxima ação.

import { buildCardDef } from './cards';
import { shuffleInPlace } from './rng';
import type {
  Ability,
  AbilityTiming,
  Action,
  CardDef,
  EffectStep,
  FieldCard,
  Frame,
  GameConfig,
  GameState,
  Keyword,
  ManualOp,
  PlayerId,
  PlayerState,
  TargetRef,
  TargetSpec,
} from './types';

export const MAX_CHARACTERS = 5;
export const DON_DECK_SIZE = 10;
export const DECK_SIZE = 50;
export const HAND_SIZE = 5;

export class IllegalActionError extends Error {}

type Located = { player: PlayerId; zone: 'leader' | 'character' | 'stage'; fc: FieldCard };
type EffectFrame = Extract<Frame, { kind: 'effect' }>;
type DamageFrame = Extract<Frame, { kind: 'damage' }>;
type PlayFrame = Extract<Frame, { kind: 'play' }>;

// ---------------------------------------------------------------------------
// Criação da partida
// ---------------------------------------------------------------------------

export function createGame(config: GameConfig): GameState {
  // Só as cartas dos dois decks entram no estado (que é copiado a cada ação).
  const used = new Set(config.players.flatMap((p) => [p.deck.leader, ...p.deck.cards.map((c) => c.id)]));
  const defs: Record<string, CardDef> = {};
  for (const c of config.cards) if (used.has(c.id)) defs[c.id] = buildCardDef(c);

  const holder = { rng: config.seed | 0 };
  const cards: GameState['cards'] = {};
  let counter = 0;
  const makeInstance = (cardId: string, owner: PlayerId) => {
    if (!defs[cardId]) throw new Error(`Carta desconhecida: ${cardId}`);
    const uid = `c${++counter}`;
    cards[uid] = { uid, cardId, owner };
    return uid;
  };

  const players = config.players.map((setup, idx) => {
    const id = idx as PlayerId;
    const leaderDef = defs[setup.deck.leader];
    if (!leaderDef || leaderDef.category !== 'leader') {
      throw new Error(`Líder inválido no deck ${setup.deck.name}`);
    }
    const leaderUid = makeInstance(setup.deck.leader, id);
    const deck: string[] = [];
    for (const entry of setup.deck.cards) {
      for (let i = 0; i < entry.count; i++) deck.push(makeInstance(entry.id, id));
    }
    if (deck.length !== DECK_SIZE) {
      throw new Error(`O deck ${setup.deck.name} tem ${deck.length} cartas (precisa de ${DECK_SIZE})`);
    }
    shuffleInPlace(holder, deck);
    const p: PlayerState = {
      id,
      name: setup.name,
      isBot: Boolean(setup.isBot),
      leader: { uid: leaderUid, rested: false, don: 0, playedOnTurn: 0 },
      characters: [],
      stage: null,
      hand: [],
      deck,
      trash: [],
      life: [],
      donDeck: DON_DECK_SIZE,
      donActive: 0,
      donRested: 0,
      mulliganDone: false,
    };
    return p;
  }) as [PlayerState, PlayerState];

  const firstPlayer: PlayerId = config.firstPlayer ?? (holder.rng & 1 ? 0 : 1);

  const state: GameState = {
    version: 1,
    seed: config.seed,
    rng: holder.rng,
    turn: 0,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'mulligan',
    players,
    cards,
    defs,
    battle: null,
    stack: [],
    pending: { kind: 'mulligan', player: firstPlayer },
    modifiers: [],
    usedThisTurn: [],
    winner: null,
    winReason: null,
    log: [],
    actionCount: 0,
  };

  for (const p of players) drawCards(state, p.id, HAND_SIZE);
  log(state, null, `${players[firstPlayer].name} joga primeiro.`);
  return state;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const opponent = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function cardDef(state: GameState, uid: string): CardDef {
  return state.defs[state.cards[uid].cardId];
}

export function ownerOf(state: GameState, uid: string): PlayerId {
  return state.cards[uid].owner;
}

export function locate(state: GameState, uid: string): Located | null {
  for (const ps of state.players) {
    if (ps.leader.uid === uid) return { player: ps.id, zone: 'leader', fc: ps.leader };
    const ch = ps.characters.find((c) => c.uid === uid);
    if (ch) return { player: ps.id, zone: 'character', fc: ch };
    if (ps.stage?.uid === uid) return { player: ps.id, zone: 'stage', fc: ps.stage };
  }
  return null;
}

function conditionsMet(state: GameState, uid: string, ability: Ability): boolean {
  const loc = locate(state, uid);
  const owner = ownerOf(state, uid);
  if (ability.don && (!loc || loc.fc.don < ability.don)) return false;
  if (ability.yourTurn && state.activePlayer !== owner) return false;
  if (ability.opponentsTurn && state.activePlayer === owner) return false;
  const cond = ability.condition;
  if (cond?.minCharacters !== undefined && state.players[owner].characters.length < cond.minCharacters) return false;
  if (cond?.selfRested && !loc?.fc.rested) return false;
  return true;
}

/** Bate com um filtro de tipos ("{A} or {B} type")? Tolerante a tipos mal separados. */
export function matchesAnyType(def: CardDef, types: string[] | undefined): boolean {
  return !types?.length || types.some((t) => hasType(def, t));
}

/** Filtro de cartas fora do campo (busca no deck etc.). */
export function matchesFilter(def: CardDef, f: import('./types').CardFilter): boolean {
  if (!matchesAnyType(def, f.hasAnyType)) return false;
  if (f.category && def.category !== f.category) return false;
  if (f.maxCost !== undefined && (def.cost ?? 0) > f.maxCost) return false;
  if (f.minCost !== undefined && (def.cost ?? 0) < f.minCost) return false;
  if (f.excludeName && def.name === f.excludeName) return false;
  return true;
}

/** Soma das auras ativas que afetam a carta (bônus de outras cartas do mesmo jogador). */
function auraPower(state: GameState, uid: string, zone: 'leader' | 'character' | 'stage'): number {
  if (zone === 'stage') return 0;
  const ps = state.players[ownerOf(state, uid)];
  const target = cardDef(state, uid);
  let bonus = 0;
  for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
    for (const a of cardDef(state, fc.uid).abilities) {
      if (a.timing !== 'static' || !a.aura || !a.aura.kinds.includes(zone)) continue;
      if (!matchesAnyType(target, a.aura.hasAnyType) || !conditionsMet(state, fc.uid, a)) continue;
      bonus += a.aura.power;
    }
  }
  return bonus;
}

export function getPower(state: GameState, uid: string): number {
  const def = cardDef(state, uid);
  let power = def.power ?? 0;
  const loc = locate(state, uid);
  if (!loc) return power;
  if (loc.player === state.activePlayer) power += loc.fc.don * 1000;
  for (const a of def.abilities) {
    if (a.timing === 'static' && a.staticPower && conditionsMet(state, uid, a)) power += a.staticPower;
  }
  power += auraPower(state, uid, loc.zone);
  for (const m of state.modifiers) if (m.uid === uid && m.kind === 'power') power += m.amount;
  return power;
}

export function hasKeyword(state: GameState, uid: string, kw: Keyword): boolean {
  const def = cardDef(state, uid);
  if (def.keywords.includes(kw)) return true;
  return def.abilities.some((a) => a.timing === 'static' && a.staticKeyword === kw && conditionsMet(state, uid, a));
}

/**
 * Verifica o tipo ({Straw Hat Crew}). Tolera listas mal separadas vindas de APIs
 * (ex.: "Supernovas Straw Hat Crew" como um único item).
 */
export function hasType(def: CardDef, type: string): boolean {
  if (def.types.includes(type)) return true;
  return ` ${def.types.join(' ')} `.includes(` ${type} `);
}

function canAttackActive(state: GameState, uid: string): boolean {
  return cardDef(state, uid).abilities.some(
    (a) => a.timing === 'static' && a.staticCanAttackActive && conditionsMet(state, uid, a),
  );
}

function usedKey(uid: string, index: number) {
  return `${uid}:${index}`;
}

export function isIdle(state: GameState): boolean {
  return state.phase === 'main' && !state.pending && state.stack.length === 0;
}

/** Motivo pelo qual o ataque é ilegal, ou null se for legal. */
export function attackError(state: GameState, player: PlayerId, attacker: string, target: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível atacar agora.';
  if (state.turn <= 2) return 'Nenhum jogador pode atacar no seu primeiro turno.';
  const a = locate(state, attacker);
  if (!a || a.player !== player || a.zone === 'stage') return 'Atacante inválido.';
  if (a.fc.rested) return 'O atacante está virado.';
  if (a.zone === 'character' && a.fc.playedOnTurn === state.turn && !hasKeyword(state, attacker, 'rush')) {
    return 'Personagens não podem atacar no turno em que entram (sem [Rush]).';
  }
  const t = locate(state, target);
  if (!t || t.player === player || t.zone === 'stage') return 'Alvo inválido.';
  if (t.zone === 'character' && !t.fc.rested && !canAttackActive(state, attacker)) {
    return 'Só é possível atacar personagens virados.';
  }
  return null;
}

export function playError(state: GameState, player: PlayerId, uid: string): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível jogar cartas agora.';
  const ps = state.players[player];
  if (!ps.hand.includes(uid)) return 'A carta não está na sua mão.';
  const def = cardDef(state, uid);
  if ((def.cost ?? 0) > ps.donActive) return 'DON!! insuficientes.';
  if (def.category === 'event' && !def.abilities.some((a) => a.timing === 'main')) {
    return 'Este evento não tem efeito [Main].';
  }
  if (def.category === 'leader') return 'Líderes não podem ser jogados.';
  return null;
}

export function activateError(state: GameState, player: PlayerId, uid: string, index: number): string | null {
  if (!isIdle(state) || state.activePlayer !== player) return 'Não é possível ativar efeitos agora.';
  const loc = locate(state, uid);
  if (!loc || loc.player !== player) return 'Carta inválida.';
  const ability = cardDef(state, uid).abilities[index];
  if (!ability || ability.timing !== 'activateMain') return 'Habilidade inválida.';
  if (!conditionsMet(state, uid, ability)) return 'Condições não atendidas.';
  if (ability.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, index))) return 'Já usada neste turno.';
  const ps = state.players[player];
  if (ability.cost?.restSelf && loc.fc.rested) return 'A carta já está virada.';
  if ((ability.cost?.restDon ?? 0) > ps.donActive) return 'DON!! ativos insuficientes.';
  if ((ability.cost?.donMinus ?? 0) > totalDonOnField(ps)) return 'DON!! insuficientes em campo.';
  if ((ability.cost?.trashFromHand ?? 0) > ps.hand.length) return 'Cartas insuficientes na mão.';
  return null;
}

function totalDonOnField(ps: PlayerState): number {
  const attached = ps.leader.don + ps.characters.reduce((s, c) => s + c.don, 0) + (ps.stage?.don ?? 0);
  return ps.donActive + ps.donRested + attached;
}

export function blockerOptions(state: GameState, defender: PlayerId): string[] {
  const b = state.battle;
  if (!b || b.noBlocker) return [];
  return state.players[defender].characters
    .filter((c) => !c.rested && c.uid !== b.target && hasKeyword(state, c.uid, 'blocker'))
    .filter((c) => b.noBlockerMinPower === null || getPower(state, c.uid) < b.noBlockerMinPower)
    .map((c) => c.uid);
}

export function counterOptions(state: GameState, defender: PlayerId): string[] {
  const ps = state.players[defender];
  return ps.hand.filter((uid) => {
    const def = cardDef(state, uid);
    if (def.category === 'character') return (def.counter ?? 0) > 0;
    if (def.category === 'event') {
      return def.abilities.some((a) => a.timing === 'counter') && (def.cost ?? 0) <= ps.donActive;
    }
    return false;
  });
}

export function targetCandidates(state: GameState, controller: PlayerId, source: string, spec: TargetSpec): string[] {
  const ps = state.players[spec.side === 'own' ? controller : opponent(controller)];
  const pool: FieldCard[] = [];
  if (spec.kinds.includes('leader')) pool.push(ps.leader);
  if (spec.kinds.includes('character')) pool.push(...ps.characters);
  if (spec.kinds.includes('stage') && ps.stage) pool.push(ps.stage);
  return pool
    .filter((fc) => {
      const def = cardDef(state, fc.uid);
      if (spec.excludeSelf && fc.uid === source) return false;
      if (spec.maxPower !== undefined && getPower(state, fc.uid) > spec.maxPower) return false;
      if (spec.maxCost !== undefined && (def.cost === undefined || def.cost > spec.maxCost)) return false;
      if (spec.rested !== undefined && fc.rested !== spec.rested) return false;
      if (spec.hasType && !hasType(def, spec.hasType)) return false;
      if (spec.keyword && !hasKeyword(state, fc.uid, spec.keyword)) return false;
      if (!matchesAnyType(def, spec.hasAnyType)) return false;
      return true;
    })
    .map((fc) => fc.uid);
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): GameState {
  if (prev.phase === 'gameover') throw new IllegalActionError('A partida já terminou.');
  const state: GameState = structuredClone(prev);
  const p = action.player;
  const pending = state.pending;

  if (action.type === 'concede') {
    gameOver(state, opponent(p), `${state.players[p].name} desistiu.`);
    state.actionCount++;
    return state;
  }

  if (action.type === 'manual') {
    if (!manualAllowed(prev, p)) throw new IllegalActionError('Ferramentas manuais indisponíveis agora.');
    applyManualOp(state, p, action.op);
    checkDefeat(state);
    run(state);
    state.actionCount++;
    return state;
  }

  if (pending) {
    if (pending.player !== p) throw new IllegalActionError('Aguardando o outro jogador.');
    handlePendingResponse(state, action);
  } else {
    if (state.phase !== 'main' || state.activePlayer !== p) throw new IllegalActionError('Não é o seu turno.');
    if (state.stack.length) throw new IllegalActionError('Há efeitos em resolução.');
    handleMainAction(state, action);
  }

  run(state);
  state.actionCount++;
  return state;
}

function handlePendingResponse(state: GameState, action: Action) {
  const pending = state.pending!;
  const p = action.player;

  switch (pending.kind) {
    case 'mulligan': {
      if (action.type !== 'mulligan') throw new IllegalActionError('Escolha manter ou trocar a mão.');
      const ps = state.players[p];
      if (action.redraw) {
        ps.deck.push(...ps.hand);
        ps.hand = [];
        shuffleInPlace(state, ps.deck);
        drawCards(state, p, HAND_SIZE);
        log(state, p, `${ps.name} trocou a mão inicial.`);
      } else {
        log(state, p, `${ps.name} manteve a mão inicial.`);
      }
      ps.mulliganDone = true;
      state.pending = null;
      const other = state.players[opponent(p)];
      if (!other.mulliganDone) {
        state.pending = { kind: 'mulligan', player: other.id };
      } else {
        for (const pl of state.players) {
          const life = cardDef(state, pl.leader.uid).life ?? 5;
          // A carta do topo do deck fica por baixo da pilha de Vida.
          for (let i = 0; i < life; i++) pl.life.unshift(pl.deck.shift()!);
        }
        state.turn = 1;
        state.activePlayer = state.firstPlayer;
        startTurn(state);
      }
      return;
    }

    case 'selectTargets': {
      if (action.type !== 'choose') throw new IllegalActionError('Escolha os alvos.');
      const uids = [...new Set(action.uids)];
      if (uids.length < pending.min || uids.length > pending.max) {
        throw new IllegalActionError(`Escolha entre ${pending.min} e ${pending.max} alvo(s).`);
      }
      if (uids.some((u) => !pending.options.includes(u))) throw new IllegalActionError('Alvo inválido.');
      const top = state.stack[state.stack.length - 1];
      if (top.kind === 'effect') top.choice = uids;
      else if (top.kind === 'play') top.replaceChoice = uids;
      state.pending = null;
      return;
    }

    case 'block': {
      if (action.type !== 'choose') throw new IllegalActionError('Escolha um bloqueador ou nenhum.');
      if (action.uids.length > 1) throw new IllegalActionError('Apenas um bloqueador.');
      state.pending = null;
      const blocker = action.uids[0];
      if (blocker) {
        if (!pending.options.includes(blocker)) throw new IllegalActionError('Bloqueador inválido.');
        const loc = locate(state, blocker)!;
        loc.fc.rested = true;
        state.battle!.target = blocker;
        state.battle!.blocked = true;
        log(state, p, `${cardDef(state, blocker).name} bloqueia o ataque!`);
        pushAbilities(state, blocker, 'onBlock');
      }
      return;
    }

    case 'counter': {
      const ps = state.players[p];
      if (action.type === 'pass') {
        state.pending = null;
        state.battle!.step = 'damage';
        return;
      }
      if (action.type !== 'counter') throw new IllegalActionError('Use um Counter ou passe.');
      if (!pending.options.includes(action.uid)) throw new IllegalActionError('Carta de Counter inválida.');
      const def = cardDef(state, action.uid);
      removeFrom(ps.hand, action.uid);
      ps.trash.push(action.uid);
      state.pending = null;
      if (def.category === 'character') {
        const target = state.battle!.target;
        state.modifiers.push({ uid: target, kind: 'power', amount: def.counter!, duration: 'battle' });
        log(state, p, `Counter: ${def.name} dá +${def.counter} a ${cardDef(state, target).name}.`);
      } else {
        payDon(ps, def.cost ?? 0);
        const ability = def.abilities.find((a) => a.timing === 'counter')!;
        log(state, p, `${ps.name} usa o evento ${def.name}.`);
        pushEffect(state, action.uid, p, ability.steps);
      }
      return;
    }

    case 'manual': {
      if (action.type !== 'manualDone') throw new IllegalActionError('Aplique o efeito e clique em Concluir.');
      const top = state.stack[state.stack.length - 1];
      if (top?.kind === 'effect') top.choice = [];
      state.pending = null;
      log(state, p, `Efeito de ${cardDef(state, pending.source).name} resolvido manualmente.`);
      return;
    }

    case 'trigger': {
      if (action.type !== 'answer') throw new IllegalActionError('Responda se ativa o [Trigger].');
      const frame = state.stack[state.stack.length - 1] as DamageFrame;
      const card = pending.card;
      const ps = state.players[p];
      frame.lifeCard = undefined;
      state.pending = null;
      if (action.yes) {
        ps.trash.push(card);
        const def = cardDef(state, card);
        log(state, p, `[Trigger] ${def.name} ativado!`);
        const trig = def.abilities.find((a) => a.timing === 'trigger')!;
        pushEffect(state, card, p, trig.steps);
      } else {
        ps.hand.push(card);
        log(state, p, `${ps.name} adiciona a carta de Vida à mão.`);
      }
      return;
    }
  }
}

function handleMainAction(state: GameState, action: Action) {
  const p = action.player;
  const ps = state.players[p];

  switch (action.type) {
    case 'playCard': {
      const err = playError(state, p, action.uid);
      if (err) throw new IllegalActionError(err);
      const def = cardDef(state, action.uid);
      removeFrom(ps.hand, action.uid);
      payDon(ps, def.cost ?? 0);
      if (def.category === 'character') {
        log(state, p, `${ps.name} joga ${def.name}.`);
        state.stack.push({ kind: 'play', uid: action.uid });
      } else if (def.category === 'stage') {
        if (ps.stage) {
          ps.donRested += ps.stage.don;
          ps.trash.push(ps.stage.uid);
        }
        ps.stage = { uid: action.uid, rested: false, don: 0, playedOnTurn: state.turn };
        log(state, p, `${ps.name} joga o Stage ${def.name}.`);
        pushAbilities(state, action.uid, 'onPlay');
      } else {
        ps.trash.push(action.uid);
        log(state, p, `${ps.name} usa o evento ${def.name}.`);
        const main = def.abilities.find((a) => a.timing === 'main')!;
        pushEffect(state, action.uid, p, main.steps);
      }
      return;
    }

    case 'attachDon': {
      if (ps.donActive < 1) throw new IllegalActionError('Nenhum DON!! ativo.');
      const loc = locate(state, action.target);
      if (!loc || loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Alvo inválido.');
      ps.donActive--;
      loc.fc.don++;
      return;
    }

    case 'activate': {
      const err = activateError(state, p, action.uid, action.ability);
      if (err) throw new IllegalActionError(err);
      const loc = locate(state, action.uid)!;
      const ability = cardDef(state, action.uid).abilities[action.ability];
      if (ability.cost?.restSelf) loc.fc.rested = true;
      if (ability.cost?.restDon) payDon(ps, ability.cost.restDon);
      if (ability.cost?.donMinus) returnDon(ps, ability.cost.donMinus);
      if (ability.oncePerTurn) state.usedThisTurn.push(usedKey(action.uid, action.ability));
      log(state, p, `${cardDef(state, action.uid).name}: ${ability.label ?? 'efeito ativado'}.`);
      // Descartar da mão também é custo: resolve antes do efeito.
      const costSteps: EffectStep[] = ability.cost?.trashFromHand
        ? [{ do: 'trashFromHand', count: ability.cost.trashFromHand }]
        : [];
      pushEffect(state, action.uid, p, [...costSteps, ...ability.steps]);
      return;
    }

    case 'attack': {
      const err = attackError(state, p, action.attacker, action.target);
      if (err) throw new IllegalActionError(err);
      const attacker = locate(state, action.attacker)!;
      attacker.fc.rested = true;
      state.battle = {
        attacker: action.attacker,
        target: action.target,
        originalTarget: action.target,
        step: 'whenAttacking',
        blocked: false,
        noBlocker: state.modifiers.some((m) => m.uid === action.attacker && m.kind === 'noBlockerWhenAttacking'),
        noBlockerMinPower: null,
      };
      log(
        state,
        p,
        `${cardDef(state, action.attacker).name} (${getPower(state, action.attacker)}) ataca ${cardDef(state, action.target).name} (${getPower(state, action.target)}).`,
      );
      state.stack.push({ kind: 'battle' });
      return;
    }

    case 'endTurn': {
      // Efeitos de [End of Your Turn] resolvem antes de o turno passar.
      state.stack.push({ kind: 'endTurn' });
      for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) {
        pushAbilities(state, fc.uid, 'endOfTurn');
      }
      return;
    }

    default:
      throw new IllegalActionError(`Ação ${action.type} não permitida agora.`);
  }
}

// ---------------------------------------------------------------------------
// Fluxo de turno
// ---------------------------------------------------------------------------

function startTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  state.phase = 'main';
  log(state, ps.id, `— Turno ${state.turn}: ${ps.name} —`);

  // Refresh: DON!! anexados voltam à área de custo e tudo fica ativo.
  const fieldCards = [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])];
  for (const fc of fieldCards) {
    ps.donRested += fc.don;
    fc.don = 0;
    fc.rested = false;
  }
  ps.donActive += ps.donRested;
  ps.donRested = 0;

  // Draw: o primeiro jogador não compra no primeiro turno.
  if (state.turn !== 1) drawCards(state, ps.id, 1);

  // DON!!: 2 por turno (1 no primeiro turno do primeiro jogador).
  const n = Math.min(state.turn === 1 ? 1 : 2, ps.donDeck);
  ps.donDeck -= n;
  ps.donActive += n;
  checkDefeat(state);
}

function endTurn(state: GameState) {
  const ps = state.players[state.activePlayer];
  log(state, ps.id, `${ps.name} encerra o turno.`);
  state.modifiers = state.modifiers.filter((m) => m.duration !== 'turn');
  state.usedThisTurn = [];
  state.activePlayer = opponent(state.activePlayer);
  state.turn++;
  startTurn(state);
}

// ---------------------------------------------------------------------------
// Pilha de resolução
// ---------------------------------------------------------------------------

function run(state: GameState) {
  let guard = 0;
  while (!state.pending && state.stack.length && state.phase !== 'gameover') {
    if (++guard > 5000) throw new Error('Loop infinito na resolução de efeitos.');
    const frame = state.stack[state.stack.length - 1];
    switch (frame.kind) {
      case 'effect':
        stepEffect(state, frame);
        break;
      case 'battle':
        stepBattle(state);
        break;
      case 'damage':
        stepDamage(state, frame);
        break;
      case 'play':
        stepPlay(state, frame);
        break;
      case 'endTurn':
        state.stack.pop();
        endTurn(state);
        break;
    }
    checkDefeat(state);
  }
}

function pushEffect(state: GameState, source: string, controller: PlayerId, steps: EffectStep[]) {
  if (steps.length) state.stack.push({ kind: 'effect', source, controller, steps, i: 0 });
}

/** Empilha as habilidades automáticas de uma carta (onPlay, whenAttacking, ...). */
function pushAbilities(state: GameState, uid: string, timing: AbilityTiming) {
  const def = cardDef(state, uid);
  const owner = ownerOf(state, uid);
  const toPush: Array<[number, Ability]> = [];
  def.abilities.forEach((a, i) => {
    if (a.timing !== timing || !conditionsMet(state, uid, a)) return;
    if (a.oncePerTurn && state.usedThisTurn.includes(usedKey(uid, i))) return;
    toPush.push([i, a]);
  });
  // Empilha de trás para frente para resolver na ordem do texto.
  for (const [i, a] of toPush.reverse()) {
    if (a.oncePerTurn) state.usedThisTurn.push(usedKey(uid, i));
    pushEffect(state, uid, owner, a.steps);
  }
}

function stepPlay(state: GameState, frame: PlayFrame) {
  const owner = ownerOf(state, frame.uid);
  const ps = state.players[owner];
  if (ps.characters.length >= MAX_CHARACTERS) {
    if (!frame.replaceChoice) {
      state.pending = {
        kind: 'selectTargets',
        player: owner,
        options: ps.characters.map((c) => c.uid),
        min: 1,
        max: 1,
        prompt: 'Área de personagens cheia: escolha um personagem para descartar.',
        intent: 'discard',
        source: frame.uid,
      };
      return;
    }
    const out = frame.replaceChoice[0];
    const fc = ps.characters.find((c) => c.uid === out)!;
    ps.donRested += fc.don;
    removeCharacter(state, out);
    ps.trash.push(out);
    log(state, owner, `${cardDef(state, out).name} é descartado para abrir espaço.`);
  }
  ps.characters.push({ uid: frame.uid, rested: false, don: 0, playedOnTurn: state.turn });
  state.stack.pop();
  pushAbilities(state, frame.uid, 'onPlay');
}

function stepBattle(state: GameState) {
  const b = state.battle!;
  const attackerOwner = ownerOf(state, b.attacker);
  const defender = opponent(attackerOwner);

  if (b.step !== 'end' && (!locate(state, b.attacker) || !locate(state, b.target))) {
    log(state, null, 'A batalha termina (uma das cartas saiu do campo).');
    b.step = 'end';
  }

  switch (b.step) {
    case 'whenAttacking':
      b.step = 'block';
      pushAbilities(state, b.attacker, 'whenAttacking');
      return;

    case 'block': {
      b.step = 'counter';
      const options = blockerOptions(state, defender);
      if (options.length) state.pending = { kind: 'block', player: defender, options };
      return;
    }

    case 'counter': {
      const options = counterOptions(state, defender);
      if (!options.length) {
        b.step = 'damage';
        return;
      }
      state.pending = { kind: 'counter', player: defender, options };
      return;
    }

    case 'damage': {
      b.step = 'end';
      if (locate(state, b.attacker)?.zone === 'character' && locate(state, b.target)?.zone === 'character') {
        b.fought = [b.attacker, b.target];
      }
      const ap = getPower(state, b.attacker);
      const tp = getPower(state, b.target);
      const target = locate(state, b.target)!;
      if (ap < tp) {
        log(state, null, `O ataque falha (${ap} contra ${tp}).`);
        return;
      }
      if (target.zone === 'leader') {
        const n = hasKeyword(state, b.attacker, 'doubleAttack') ? 2 : 1;
        log(state, null, `O ataque acerta o líder (${ap} contra ${tp})${n > 1 ? ' — Double Attack!' : ''}.`);
        state.stack.push({
          kind: 'damage',
          defender,
          remaining: n,
          banish: hasKeyword(state, b.attacker, 'banish'),
        });
      } else {
        koCharacter(state, b.target);
      }
      return;
    }

    case 'end': {
      // "If this Character battles your opponent's Character": dispara ao fim da batalha.
      const fought = (b.fought ?? []).filter((uid) => locate(state, uid));
      state.modifiers = state.modifiers.filter((m) => m.duration !== 'battle');
      state.battle = null;
      state.stack.pop();
      for (const uid of fought) pushAbilities(state, uid, 'battlesCharacter');
      return;
    }
  }
}

function stepDamage(state: GameState, frame: DamageFrame) {
  if (frame.remaining <= 0) {
    state.stack.pop();
    return;
  }
  const ps = state.players[frame.defender];
  if (ps.life.length === 0) {
    gameOver(state, opponent(frame.defender), `O líder de ${ps.name} recebeu dano sem cartas de Vida.`);
    return;
  }
  const card = ps.life.pop()!;
  frame.remaining--;
  const def = cardDef(state, card);
  if (frame.banish) {
    ps.trash.push(card);
    log(state, frame.defender, `[Banish] A carta de Vida vai para o descarte.`);
    return;
  }
  if (def.abilities.some((a) => a.timing === 'trigger')) {
    frame.lifeCard = card;
    state.pending = { kind: 'trigger', player: frame.defender, card };
    return;
  }
  ps.hand.push(card);
  log(state, frame.defender, `${ps.name} perde 1 Vida (${ps.life.length} restante(s)).`);
}

function stepEffect(state: GameState, frame: EffectFrame) {
  if (frame.i >= frame.steps.length) {
    state.stack.pop();
    return;
  }
  const step = frame.steps[frame.i];
  const done = execStep(state, frame, step);
  if (done) {
    frame.i++;
    frame.choice = undefined;
  }
}

/** Resolve alvos. Retorna null quando o motor precisa esperar uma escolha. */
function resolveTargets(
  state: GameState,
  frame: EffectFrame,
  ref: TargetRef,
  intent: 'harm' | 'help',
  prompt: string,
): string[] | null {
  if (ref === 'self') return locate(state, frame.source) ? [frame.source] : [];
  if (ref === 'ownLeader') return [state.players[frame.controller].leader.uid];
  if (ref === 'battleTarget') return state.battle && locate(state, state.battle.target) ? [state.battle.target] : [];
  const options = targetCandidates(state, frame.controller, frame.source, ref);
  if (frame.choice) return frame.choice.filter((u) => options.includes(u));
  if (!options.length) return [];
  state.pending = {
    kind: 'selectTargets',
    player: frame.controller,
    options,
    min: 0,
    max: Math.min(ref.upTo, options.length),
    prompt,
    intent,
    source: frame.source,
  };
  return null;
}

function execStep(state: GameState, frame: EffectFrame, step: EffectStep): boolean {
  const ps = state.players[frame.controller];
  const srcName = cardDef(state, frame.source).name;

  switch (step.do) {
    case 'power': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe +${step.amount} de poder.`);
      if (!t) return false;
      const duration = step.duration === 'battle' && !state.battle ? 'turn' : step.duration;
      for (const uid of t) {
        state.modifiers.push({ uid, kind: 'power', amount: step.amount, duration });
        log(state, frame.controller, `${cardDef(state, uid).name} recebe +${step.amount} de poder.`);
      }
      return true;
    }
    case 'ko': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para K.O.`);
      if (!t) return false;
      for (const uid of t) if (locate(state, uid)?.zone === 'character') koCharacter(state, uid);
      return true;
    }
    case 'rest': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha uma carta para virar.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          loc.fc.rested = true;
          log(state, frame.controller, `${cardDef(state, uid).name} é virado.`);
        }
      }
      return true;
    }
    case 'setActive': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha uma carta para desvirar.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc) {
          loc.fc.rested = false;
          log(state, frame.controller, `${cardDef(state, uid).name} fica ativo.`);
        }
      }
      return true;
    }
    case 'giveRestedDon': {
      if (ps.donRested === 0) return true;
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem recebe DON!! virado(s).`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        const n = Math.min(step.count, ps.donRested);
        if (loc && n > 0) {
          ps.donRested -= n;
          loc.fc.don += n;
          log(state, frame.controller, `${cardDef(state, uid).name} recebe ${n} DON!!.`);
        }
      }
      return true;
    }
    case 'draw':
      drawCards(state, frame.controller, step.count);
      log(state, frame.controller, `${ps.name} compra ${step.count} carta(s).`);
      return true;
    case 'addDonFromDeck': {
      const n = Math.min(step.count, ps.donDeck);
      ps.donDeck -= n;
      if (step.rested) ps.donRested += n;
      else ps.donActive += n;
      return true;
    }
    case 'restOpponentDon': {
      const o = state.players[opponent(frame.controller)];
      const n = Math.min(step.count, o.donActive);
      o.donActive -= n;
      o.donRested += n;
      if (n) log(state, frame.controller, `${n} DON!! de ${o.name} é virado.`);
      return true;
    }
    case 'returnToHand': {
      const t = resolveTargets(state, frame, step.target, 'harm', `${srcName}: escolha um personagem para devolver à mão.`);
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        if (loc?.zone !== 'character') continue;
        const owner = state.players[loc.player];
        owner.donRested += loc.fc.don;
        removeCharacter(state, uid);
        owner.hand.push(uid);
        log(state, frame.controller, `${cardDef(state, uid).name} volta para a mão.`);
      }
      return true;
    }
    case 'noBlockerThisBattle':
      if (state.battle) {
        if (step.minPower !== undefined) state.battle.noBlockerMinPower = step.minPower;
        else state.battle.noBlocker = true;
        log(
          state,
          frame.controller,
          step.minPower !== undefined
            ? `O oponente não pode usar [Blocker] com ${step.minPower}+ de poder nesta batalha.`
            : 'O oponente não pode usar [Blocker] nesta batalha.',
        );
      }
      return true;
    case 'noBlockerWhenAttacking': {
      const t = resolveTargets(state, frame, step.target, 'help', `${srcName}: escolha quem ataca sem poder ser bloqueado.`);
      if (!t) return false;
      for (const uid of t) state.modifiers.push({ uid, kind: 'noBlockerWhenAttacking', amount: 0, duration: 'turn' });
      return true;
    }
    case 'playThis': {
      const def = cardDef(state, frame.source);
      if (zoneOf(state, frame.source) === 'character' || zoneOf(state, frame.source) === 'stage') return true;
      if (def.category === 'character') {
        detach(state, frame.source);
        log(state, frame.controller, `${def.name} entra em campo.`);
        state.stack.push({ kind: 'play', uid: frame.source });
      } else if (def.category === 'stage') {
        detach(state, frame.source);
        if (ps.stage) {
          const old = ps.stage.uid;
          detach(state, old);
          ps.trash.push(old);
        }
        ps.stage = { uid: frame.source, rested: false, don: 0, playedOnTurn: state.turn };
        pushAbilities(state, frame.source, 'onPlay');
      }
      return true;
    }
    case 'trashFromHand': {
      const n = Math.min(step.count, ps.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options: [...ps.hand],
          min: n,
          max: n,
          prompt: `${srcName}: escolha ${n} carta(s) da mão para descartar.`,
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        log(state, frame.controller, `${ps.name} descarta ${cardDef(state, uid).name}.`);
      }
      return true;
    }
    case 'setDonActive': {
      const n = Math.min(step.count, ps.donRested);
      ps.donRested -= n;
      ps.donActive += n;
      if (n) log(state, frame.controller, `${n} DON!! de ${ps.name} fica(m) ativo(s).`);
      return true;
    }
    case 'search': {
      const top = ps.deck.slice(0, step.look);
      const options = top.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice && options.length) {
        state.pending = {
          kind: 'selectTargets',
          player: frame.controller,
          options,
          min: 0,
          max: Math.min(step.upTo, options.length),
          prompt: `${srcName}: olhe as ${top.length} cartas do topo e escolha até ${step.upTo} para adicionar à mão.`,
          intent: 'help',
          source: frame.source,
        };
        return false;
      }
      const chosen = (frame.choice ?? []).filter((u) => options.includes(u));
      for (const uid of top) removeFrom(ps.deck, uid);
      for (const uid of chosen) {
        ps.hand.push(uid);
        log(state, frame.controller, `${ps.name} revela ${cardDef(state, uid).name} e adiciona à mão.`);
      }
      const rest = top.filter((u) => !chosen.includes(u));
      if (step.rest === 'bottom') ps.deck.push(...rest);
      else ps.trash.push(...rest);
      return true;
    }
    case 'manual':
      if (frame.choice) return true; // o jogador já confirmou
      state.pending = { kind: 'manual', player: frame.controller, source: frame.source, text: step.text };
      return false;
    case 'useMainEffect': {
      const main = cardDef(state, frame.source).abilities.find((a) => a.timing === 'main');
      frame.i++;
      if (main) pushEffect(state, frame.source, frame.controller, main.steps);
      return false; // já avançamos o índice manualmente
    }
  }
}

// ---------------------------------------------------------------------------
// Ferramentas manuais (efeitos ainda não automatizados)
// ---------------------------------------------------------------------------

/**
 * Quando o jogador pode usar as ferramentas manuais: ao resolver um efeito manual,
 * na etapa de Counter (efeitos contínuos do defensor) e livremente no próprio turno.
 */
export function manualAllowed(state: GameState, player: PlayerId): boolean {
  if (state.phase !== 'main') return false;
  const pending = state.pending;
  if (pending) return (pending.kind === 'manual' || pending.kind === 'counter') && pending.player === player;
  return isIdle(state) && state.activePlayer === player;
}

type CardZone = 'hand' | 'deck' | 'trash' | 'life' | 'leader' | 'character' | 'stage';

export function zoneOf(state: GameState, uid: string): CardZone | null {
  const loc = locate(state, uid);
  if (loc) return loc.zone;
  const ps = state.players[ownerOf(state, uid)];
  if (ps.hand.includes(uid)) return 'hand';
  if (ps.deck.includes(uid)) return 'deck';
  if (ps.trash.includes(uid)) return 'trash';
  if (ps.life.includes(uid)) return 'life';
  return null;
}

/** Tira a carta de onde estiver (DON!! anexados voltam virados à área de custo). */
function detach(state: GameState, uid: string) {
  const ps = state.players[ownerOf(state, uid)];
  const loc = locate(state, uid);
  if (loc?.zone === 'character') {
    ps.donRested += loc.fc.don;
    removeCharacter(state, uid);
    return;
  }
  if (loc?.zone === 'stage') {
    ps.donRested += loc.fc.don;
    ps.stage = null;
    state.modifiers = state.modifiers.filter((m) => m.uid !== uid);
    return;
  }
  for (const zone of [ps.hand, ps.deck, ps.trash, ps.life]) removeFrom(zone, uid);
}

const ZONE_LABEL: Record<string, string> = {
  hand: 'a mão',
  trash: 'o descarte',
  deckTop: 'o topo do deck',
  deckBottom: 'o fundo do deck',
  life: 'a Vida',
  character: 'o campo',
  stage: 'o campo (Stage)',
};

function applyManualOp(state: GameState, p: PlayerId, op: ManualOp) {
  const ps = state.players[p];
  const tag = '(manual)';
  const fieldCard = (uid: string) => {
    const loc = locate(state, uid);
    if (!loc) throw new IllegalActionError('A carta precisa estar em campo.');
    return loc;
  };

  switch (op.op) {
    case 'draw': {
      const n = Math.max(1, Math.min(10, Math.floor(op.count)));
      drawCards(state, p, n);
      log(state, p, `${tag} ${ps.name} compra ${n} carta(s).`);
      return;
    }
    case 'move': {
      if (!state.cards[op.uid]) throw new IllegalActionError('Carta inválida.');
      const owner = ownerOf(state, op.uid);
      const from = zoneOf(state, op.uid);
      const def = cardDef(state, op.uid);
      if (!from || from === 'leader') throw new IllegalActionError('Essa carta não pode ser movida.');
      if (owner !== p && !['character', 'stage', 'life'].includes(from)) {
        throw new IllegalActionError('Do oponente, só é possível mover cartas em campo ou da Vida.');
      }
      const os = state.players[owner];
      if (op.to === 'character') {
        if (def.category !== 'character') throw new IllegalActionError('Só Personagens vão para a área de personagens.');
        if (from !== 'character' && os.characters.length >= MAX_CHARACTERS) {
          throw new IllegalActionError('Área de personagens cheia: descarte um antes.');
        }
      }
      if (op.to === 'stage' && def.category !== 'stage') throw new IllegalActionError('Só Stages vão para a área de Stage.');
      detach(state, op.uid);
      switch (op.to) {
        case 'hand':
          os.hand.push(op.uid);
          break;
        case 'trash':
          os.trash.push(op.uid);
          break;
        case 'deckTop':
          os.deck.unshift(op.uid);
          break;
        case 'deckBottom':
          os.deck.push(op.uid);
          break;
        case 'life':
          os.life.push(op.uid);
          break;
        case 'character':
          os.characters.push({ uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn });
          break;
        case 'stage':
          if (os.stage) {
            const old = os.stage.uid;
            detach(state, old);
            os.trash.push(old);
          }
          os.stage = { uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn };
          break;
      }
      const shown = ['deck', 'hand', 'life'].includes(from) && owner !== p ? 'Uma carta' : def.name;
      log(state, p, `${tag} ${shown} vai para ${ZONE_LABEL[op.to]}${owner !== p ? ` de ${os.name}` : ''}.`);
      if (op.to === 'character' || op.to === 'stage') pushAbilities(state, op.uid, 'onPlay');
      return;
    }
    case 'ko': {
      const loc = fieldCard(op.uid);
      if (loc.zone !== 'character') throw new IllegalActionError('Só Personagens podem ser nocauteados.');
      log(state, p, `${tag} K.O. em ${cardDef(state, op.uid).name}.`);
      koCharacter(state, op.uid);
      return;
    }
    case 'setRested': {
      const loc = fieldCard(op.uid);
      loc.fc.rested = op.rested;
      log(state, p, `${tag} ${cardDef(state, op.uid).name} fica ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'power': {
      fieldCard(op.uid);
      const duration = op.duration === 'battle' && !state.battle ? 'turn' : op.duration;
      state.modifiers.push({ uid: op.uid, kind: 'power', amount: op.amount, duration });
      log(state, p, `${tag} ${cardDef(state, op.uid).name}: ${op.amount > 0 ? '+' : ''}${op.amount} de poder.`);
      return;
    }
    case 'donFromDeck': {
      const n = Math.min(Math.max(1, op.count), ps.donDeck);
      ps.donDeck -= n;
      if (op.rested) ps.donRested += n;
      else ps.donActive += n;
      log(state, p, `${tag} +${n} DON!! ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'donToDeck': {
      returnDon(ps, Math.max(1, op.count));
      log(state, p, `${tag} DON!! −${op.count}.`);
      return;
    }
    case 'donGive': {
      const loc = fieldCard(op.uid);
      if (loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Escolha seu Líder ou um Personagem seu.');
      if (op.from === 'active' ? ps.donActive < 1 : ps.donRested < 1) throw new IllegalActionError('Sem DON!! disponível.');
      if (op.from === 'active') ps.donActive--;
      else ps.donRested--;
      loc.fc.don++;
      log(state, p, `${tag} ${cardDef(state, op.uid).name} recebe 1 DON!! ${op.from === 'active' ? 'ativo' : 'virado'}.`);
      return;
    }
    case 'donSetState': {
      const target = state.players[op.player];
      const n = Math.min(Math.max(1, op.count), op.rested ? target.donActive : target.donRested);
      if (op.rested) {
        target.donActive -= n;
        target.donRested += n;
      } else {
        target.donRested -= n;
        target.donActive += n;
      }
      log(state, p, `${tag} ${n} DON!! de ${target.name} fica ${op.rested ? 'virado' : 'ativo'}.`);
      return;
    }
    case 'shuffle':
      shuffleInPlace(state, ps.deck);
      log(state, p, `${tag} ${ps.name} embaralha o deck.`);
      return;
  }
}

// ---------------------------------------------------------------------------
// Utilitários de zonas
// ---------------------------------------------------------------------------

function koCharacter(state: GameState, uid: string) {
  const loc = locate(state, uid);
  if (!loc || loc.zone !== 'character') return;
  const ps = state.players[loc.player];
  ps.donRested += loc.fc.don;
  removeCharacter(state, uid);
  ps.trash.push(uid);
  log(state, loc.player, `${cardDef(state, uid).name} foi nocauteado (K.O.).`);
  const def = cardDef(state, uid);
  def.abilities.forEach((a) => {
    if (a.timing === 'onKO') pushEffect(state, uid, loc.player, a.steps);
  });
}

function removeCharacter(state: GameState, uid: string) {
  for (const ps of state.players) ps.characters = ps.characters.filter((c) => c.uid !== uid);
  state.modifiers = state.modifiers.filter((m) => m.uid !== uid);
}

function drawCards(state: GameState, player: PlayerId, n: number) {
  const ps = state.players[player];
  for (let i = 0; i < n && ps.deck.length; i++) ps.hand.push(ps.deck.shift()!);
}

function payDon(ps: PlayerState, n: number) {
  if (n > ps.donActive) throw new IllegalActionError('DON!! insuficientes.');
  ps.donActive -= n;
  ps.donRested += n;
}

function returnDon(ps: PlayerState, n: number) {
  for (let i = 0; i < n; i++) {
    if (ps.donRested > 0) ps.donRested--;
    else if (ps.donActive > 0) ps.donActive--;
    else {
      const fc = [ps.leader, ...ps.characters].find((c) => c.don > 0);
      if (!fc) break;
      fc.don--;
    }
    ps.donDeck++;
  }
}

function removeFrom(arr: string[], uid: string) {
  const i = arr.indexOf(uid);
  if (i >= 0) arr.splice(i, 1);
}

function checkDefeat(state: GameState) {
  if (state.phase === 'gameover' || state.phase === 'mulligan') return;
  for (const ps of state.players) {
    if (ps.deck.length === 0) {
      gameOver(state, opponent(ps.id), `${ps.name} ficou sem cartas no deck.`);
      return;
    }
  }
}

function gameOver(state: GameState, winner: PlayerId, reason: string) {
  state.phase = 'gameover';
  state.winner = winner;
  state.winReason = reason;
  state.pending = null;
  log(state, winner, `Fim de jogo: ${state.players[winner].name} venceu! ${reason}`);
}

function log(state: GameState, player: PlayerId | null, text: string) {
  state.log.push({ turn: state.turn, player, text });
}
