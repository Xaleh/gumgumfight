// Cenários prontos (tutorial): uma partida já em andamento, montada a partir de uma descrição
// de cada lado da mesa (mão, Personagens, Vida, DON!!...). A partida é criada normalmente
// (decks, mulligans) e as cartas são então redistribuídas entre as áreas, de modo que o
// estado continua válido: cada carta do deck está em exatamente uma área e há 10 DON!!.

import { applyAction, createGame, DON_DECK_SIZE, opponent } from './engine';
import { legalActions } from './actions';
import type { Action, FieldCard, GameConfig, GameState, PlayerId } from './types';

/** Carta no campo: virada, com DON!! dados, ou recém-jogada (não ataca neste turno). */
export interface ScenarioCard {
  id: string;
  rested?: boolean;
  don?: number;
  /** Jogada neste turno (sem [Rush], não pode atacar). */
  fresh?: boolean;
}

export interface ScenarioSide {
  /** Cartas na mão (números das cartas, ex.: "ST01-013"). Padrão: nenhuma. */
  hand?: string[];
  characters?: Array<string | ScenarioCard>;
  stage?: string | ScenarioCard;
  leader?: { rested?: boolean; don?: number };
  /**
   * Vida: a quantidade (cartas tiradas do fundo do deck) ou as cartas exatas, a última no topo.
   * Padrão: a Vida do Líder.
   */
  life?: number | string[];
  /** Cartas no topo do deck, a primeira no topo. O resto do deck segue a ordem embaralhada. */
  deckTop?: string[];
  trash?: string[];
  donActive?: number;
  donRested?: number;
}

export interface ScenarioSpec {
  /** Turno da partida (1 = primeiro turno de quem começou). */
  turn: number;
  /** De quem é o turno. */
  active: PlayerId;
  sides: [ScenarioSide, ScenarioSide];
}

const cardOf = (c: string | ScenarioCard): ScenarioCard => (typeof c === 'string' ? { id: c } : c);

/**
 * Monta a partida descrita em `spec` com os decks de `config`. As cartas citadas saem do deck do
 * jogador (lança erro se o deck não tiver cópias suficientes). A Main Phase do jogador ativo começa
 * sem escolhas pendentes e com o histórico vazio.
 */
export function createScenario(config: GameConfig, spec: ScenarioSpec): GameState {
  if (spec.turn < 1) throw new Error('turn deve ser 1 ou mais');
  const first: PlayerId = spec.turn % 2 === 1 ? spec.active : opponent(spec.active);
  let s = createGame({ ...config, firstPlayer: first, chooseFirst: false });
  for (let guard = 0; s.pending?.kind === 'mulligan' && guard < 4; guard++) {
    s = applyAction(s, { type: 'mulligan', player: s.pending.player, redraw: false });
  }
  if (s.pending || s.phase !== 'main') throw new Error('a preparação da partida não terminou');
  s = JSON.parse(JSON.stringify(s)) as GameState;

  for (const player of [0, 1] as PlayerId[]) {
    const side = spec.sides[player];
    const ps = s.players[player];
    const pool = [...ps.hand, ...ps.deck, ...ps.life, ...ps.trash];
    for (const fc of ps.characters) pool.push(fc.uid);
    if (ps.stage) pool.push(ps.stage.uid);
    const take = (cardId: string): string => {
      const i = pool.findIndex((u) => s.cards[u].cardId === cardId);
      if (i < 0) throw new Error(`${cardId}: sem cópias livres no deck de ${ps.name}`);
      return pool.splice(i, 1)[0];
    };
    const field = (c: ScenarioCard): FieldCard => ({
      uid: take(c.id),
      rested: Boolean(c.rested),
      don: c.don ?? 0,
      playedOnTurn: c.fresh ? spec.turn : 0,
    });

    ps.hand = (side.hand ?? []).map(take);
    ps.characters = (side.characters ?? []).map((c) => field(cardOf(c)));
    ps.stage = side.stage ? field(cardOf(side.stage)) : null;
    ps.trash = (side.trash ?? []).map(take);
    ps.leader = { ...ps.leader, rested: Boolean(side.leader?.rested), don: side.leader?.don ?? 0, playedOnTurn: 0 };
    const explicitLife = Array.isArray(side.life) ? side.life.map(take) : null;
    const top = (side.deckTop ?? []).map(take);
    const lifeCount = typeof side.life === 'number' ? side.life : (s.defs[s.cards[ps.leader.uid].cardId]?.life ?? 5);
    if (explicitLife) ps.life = explicitLife;
    else {
      if (lifeCount > pool.length) throw new Error(`Vida maior que o deck de ${ps.name}`);
      ps.life = pool.splice(pool.length - lifeCount, lifeCount);
    }
    ps.deck = [...top, ...pool];
    ps.lifeFaceUp = undefined;

    const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
    ps.donActive = side.donActive ?? 0;
    ps.donRested = side.donRested ?? 0;
    ps.donDeck = DON_DECK_SIZE - ps.donActive - ps.donRested - attached;
    if (ps.donDeck < 0) throw new Error(`mais de ${DON_DECK_SIZE} DON!! para ${ps.name}`);
    ps.mulliganDone = true;
  }

  s.turn = spec.turn;
  s.firstPlayer = first;
  s.activePlayer = spec.active;
  s.pending = null;
  s.battle = null;
  s.stack = [];
  s.modifiers = [];
  s.usedThisTurn = [];
  s.log = [];
  delete s.cancel;
  delete s.checkpoint;
  return s;
}

/**
 * Jogada de um oponente que não reage: não bloqueia, não usa Counter, põe a Vida na mão sem
 * [Trigger], fica com a mão no mulligan e encerra o próprio turno sem fazer nada. Nas demais
 * escolhas, a primeira opção legal.
 */
export function passiveAction(state: GameState, player: PlayerId): Action | null {
  const legal = legalActions(state, player).filter((a) => a.type !== 'cancel');
  if (legal.length === 0) return null;
  const pending = state.pending;
  if (!pending) return legal.find((a) => a.type === 'endTurn') ?? null;
  const pick =
    legal.find((a) => a.type === 'mulligan' && !a.redraw) ??
    legal.find((a) => a.type === 'pass') ??
    legal.find((a) => a.type === 'choose' && a.uids.length === 0) ??
    legal.find((a) => a.type === 'answer' && !a.yes) ??
    legal[0];
  return pick;
}
