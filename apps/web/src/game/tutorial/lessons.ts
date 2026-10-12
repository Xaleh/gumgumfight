// As lições do tutorial "Aprender a jogar": cenário na mesa, passos e o que cada passo espera.
// Os textos ficam no dicionário (`tutorial.<lição>.<passo>.title/body`, ver i18n/tutorial).
// Este arquivo não importa nada da interface: os testes resolvem cada lição sem navegador.

import {
  type Action,
  type CardData,
  createGame,
  createScenario,
  type DeckList,
  type GameConfig,
  type GameState,
  type PlayerId,
  type ScenarioSpec,
} from '@gumgum/engine';

export const ME: PlayerId = 0;
export const OPP: PlayerId = 1;

/** Decks do tutorial: Luffy (ST01) para quem aprende e Crocodile (ST03) para o bot. */
export const TUTORIAL_DECKS = ['st01-luffy', 'st03-crocodile'] as const;

/**
 * Áreas da mesa que um passo destaca. `card:` = cartas suas com esse número (mão ou campo);
 * `opp-card:` = do oponente.
 */
export type Spot =
  | 'my-leader'
  | 'my-characters'
  | 'my-stage'
  | 'my-life'
  | 'my-cost'
  | 'my-don-deck'
  | 'my-deck'
  | 'my-trash'
  | 'my-hand'
  | 'opp-leader'
  | 'opp-characters'
  | 'opp-life'
  | 'opp-hand'
  | 'opp-trash'
  | 'end-turn'
  | 'decision'
  | `card:${string}`
  | `opp-card:${string}`;

export interface LessonStep {
  id: string;
  spot?: Spot[];
  /** Carta mostrada ao lado do texto (lições sem mesa). */
  card?: string;
  /** Ilustração própria do passo (lições sem mesa). */
  extra?: 'curve' | 'deck-rules';
  /**
   * Passo de ação: o jogador faz uma jogada na mesa. Sem `do`, é um passo de leitura (botão "Próximo")
   * ou de quiz (`quiz`).
   */
  do?: {
    /** Jogadas permitidas na Main Phase (escolhas pendentes do próprio jogador são sempre livres). */
    allow?: (a: Action, s: GameState) => boolean;
    /** Respostas permitidas às escolhas pendentes (padrão: todas). */
    respond?: (a: Action, s: GameState) => boolean;
    /** O passo foi cumprido (`start` = a mesa quando o passo começou). */
    done: (s: GameState, start: GameState) => boolean;
    /** Deu errado: o jogador recomeça o passo (texto `.fail`). */
    fail?: (s: GameState, start: GameState) => boolean;
  };
  /** Quiz: `options` alternativas (textos `.o1`, `.o2`...), a certa e a explicação (`.why`). */
  quiz?: { options: number; correct: number };
}

/** O que o oponente faz: nada (passa e não se defende), uma lista de ataques ou o bot de verdade. */
export type OpponentPlan = 'passive' | 'bot' | { attacks: Array<{ attacker: string; target: 'leader' | string }> };

export interface Lesson {
  id: string;
  chapter: 1 | 2 | 3 | 4;
  minutes: number;
  format: 'explain' | 'discover' | 'guided' | 'challenge' | 'quiz' | 'build' | 'match';
  /** Mesa da lição. Sem ela, a lição é um painel (texto, carta, quiz). */
  board?: {
    build: (ctx: TutorialData) => GameState;
    opponent: OpponentPlan;
  };
  /** Lição com tela própria (anatomia da carta). */
  view?: 'anatomy';
  steps: LessonStep[];
}

export interface TutorialData {
  cards: CardData[];
  decks: [DeckList, DeckList];
  names: [string, string];
}

// ---------------------------------------------------------------------- ajudas

export const cardIdOf = (s: GameState, uid: string) => s.cards[uid]?.cardId;

/** Cartas de `player` com o número `cardId` na mão ou no campo. */
export function uidsOf(s: GameState, player: PlayerId, cardId: string): string[] {
  const ps = s.players[player];
  const zone = [ps.leader.uid, ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : []), ...ps.hand];
  return zone.filter((u) => cardIdOf(s, u) === cardId);
}

const onField = (s: GameState, player: PlayerId, cardId: string) =>
  s.players[player].characters.some((c) => cardIdOf(s, c.uid) === cardId);
const inTrash = (s: GameState, player: PlayerId, cardId: string) => s.players[player].trash.some((u) => cardIdOf(s, u) === cardId);
const inHand = (s: GameState, player: PlayerId, cardId: string) => s.players[player].hand.some((u) => cardIdOf(s, u) === cardId);
const fieldCard = (s: GameState, player: PlayerId, cardId: string) => s.players[player].characters.find((c) => cardIdOf(s, c.uid) === cardId);
const lifeOf = (s: GameState, player: PlayerId) => s.players[player].life.length;
/** Nenhuma batalha nem escolha em aberto (a jogada terminou de resolver). */
const settled = (s: GameState) => !s.battle && !s.pending && s.stack.length === 0;

const plays = (cardId: string) => (a: Action, s: GameState) => a.type === 'playCard' && cardIdOf(s, a.uid) === cardId;
/** Ataque de `attacker` ('leader' = o Líder) contra `target` ('leader' = o Líder do oponente). */
const attacks = (attacker: string, target: string) => (a: Action, s: GameState) => {
  if (a.type !== 'attack') return false;
  const okAttacker = attacker === 'leader' ? a.attacker === s.players[ME].leader.uid : cardIdOf(s, a.attacker) === attacker;
  const okTarget = target === 'leader' ? a.target === s.players[OPP].leader.uid : cardIdOf(s, a.target) === target;
  return okAttacker && okTarget;
};
const gives = (target: string) => (a: Action, s: GameState) =>
  a.type === 'attachDon' && (target === 'leader' ? a.target === s.players[ME].leader.uid : cardIdOf(s, a.target) === target);
const either =
  (...fs: Array<(a: Action, s: GameState) => boolean>) =>
  (a: Action, s: GameState) =>
    fs.some((f) => f(a, s));

function scenario(ctx: TutorialData, spec: ScenarioSpec): GameState {
  return createScenario(config(ctx), spec);
}

function config(ctx: TutorialData): GameConfig {
  return {
    seed: 20261012,
    cards: ctx.cards,
    players: [
      { name: ctx.names[0], deck: ctx.decks[0] },
      { name: ctx.names[1], deck: ctx.decks[1], isBot: true },
    ],
  };
}

// ---------------------------------------------------------------------- lições

export const LESSONS: Lesson[] = [
  // ------------------------------------------------ Capítulo 1: Fundamentos
  {
    id: 'goal',
    chapter: 1,
    minutes: 2,
    format: 'explain',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 9,
          active: ME,
          sides: [
            { hand: ['ST01-003', 'ST01-007', 'ST01-014'], characters: ['ST01-013', 'ST01-008'], life: 2, donActive: 3, donRested: 6 },
            { hand: ['ST03-002', 'ST03-006', 'ST03-011'], characters: [{ id: 'ST03-012', rested: true }], life: 0, donRested: 8 },
          ],
        }),
    },
    steps: [
      { id: 'welcome' },
      { id: 'leader', spot: ['opp-leader', 'my-leader'] },
      { id: 'life', spot: ['opp-life', 'my-life'] },
      {
        id: 'attack',
        spot: ['card:ST01-013', 'opp-leader'],
        do: {
          allow: attacks('ST01-013', 'leader'),
          done: (s) => s.phase === 'gameover' && s.winner === ME,
        },
      },
      { id: 'won' },
    ],
  },
  {
    id: 'card',
    chapter: 1,
    minutes: 3,
    format: 'discover',
    view: 'anatomy',
    steps: [{ id: 'intro' }, { id: 'discover' }, { id: 'types' }],
  },
  {
    id: 'table',
    chapter: 1,
    minutes: 3,
    format: 'explain',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 5,
          active: ME,
          sides: [
            {
              hand: ['ST01-003', 'ST01-007', 'ST01-010', 'ST01-014'],
              characters: ['ST01-013', 'ST01-009'],
              stage: 'ST01-017',
              trash: ['ST01-016', 'ST01-002'],
              life: 4,
              donActive: 3,
              donRested: 2,
            },
            { hand: ['ST03-002', 'ST03-006', 'ST03-011', 'ST03-017'], characters: ['ST03-012'], trash: ['ST03-016'], life: 4, donRested: 4 },
          ],
        }),
    },
    steps: [
      { id: 'intro' },
      { id: 'leader', spot: ['my-leader'] },
      { id: 'characters', spot: ['my-characters'] },
      { id: 'stage', spot: ['my-stage'] },
      { id: 'don', spot: ['my-cost', 'my-don-deck'] },
      { id: 'deck', spot: ['my-deck', 'my-trash'] },
      { id: 'life', spot: ['my-life'] },
      { id: 'hand', spot: ['my-hand'] },
      { id: 'opponent', spot: ['opp-leader', 'opp-characters', 'opp-hand'] },
      { id: 'quiz', quiz: { options: 3, correct: 2 } },
    ],
  },
  {
    id: 'setup',
    chapter: 1,
    minutes: 3,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) => createGame({ ...config(ctx), firstPlayer: ME, chooseFirst: false }),
    },
    steps: [
      { id: 'deck' },
      { id: 'leader', spot: ['my-leader', 'opp-leader'] },
      { id: 'first' },
      { id: 'hand', spot: ['my-hand'] },
      {
        id: 'mulligan',
        spot: ['decision'],
        do: { done: (s) => s.phase === 'main' && !s.pending },
      },
      { id: 'life', spot: ['my-life', 'opp-life'] },
      { id: 'firstTurn', spot: ['my-cost', 'my-hand'] },
    ],
  },

  // ------------------------------------------------ Capítulo 2: O turno
  {
    id: 'turn',
    chapter: 2,
    minutes: 3,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 3,
          active: ME,
          sides: [
            {
              hand: ['ST01-003', 'ST01-014'],
              characters: [{ id: 'ST01-008', rested: true }],
              leader: { rested: true, don: 1 },
              life: 5,
              donRested: 2,
            },
            { hand: ['ST03-002', 'ST03-006', 'ST03-011', 'ST03-017', 'ST03-008'], life: 5, donActive: 2 },
          ],
        }),
    },
    steps: [
      { id: 'phases' },
      { id: 'main', spot: ['my-characters', 'my-cost'] },
      {
        id: 'end',
        spot: ['end-turn'],
        do: {
          allow: (a) => a.type === 'endTurn',
          done: (s) => s.turn === 5 && s.activePlayer === ME && settled(s),
        },
      },
      { id: 'refresh', spot: ['my-cost', 'my-characters', 'my-leader'] },
      { id: 'draw', spot: ['my-hand', 'my-deck'] },
      { id: 'don', spot: ['my-don-deck', 'my-cost'] },
      { id: 'endPhase' },
      { id: 'quiz', quiz: { options: 4, correct: 3 } },
    ],
  },
  {
    id: 'don',
    chapter: 2,
    minutes: 4,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 5,
          active: ME,
          sides: [
            { hand: ['ST01-013', 'ST01-007', 'ST01-004', 'ST01-015'], life: 5, donActive: 4 },
            { hand: ['ST03-002', 'ST03-006', 'ST03-011', 'ST03-017'], characters: ['ST03-006'], life: 5, donRested: 4 },
          ],
        }),
    },
    steps: [
      { id: 'what', spot: ['my-don-deck'] },
      { id: 'phase', spot: ['my-cost'] },
      { id: 'cost', spot: ['card:ST01-013'] },
      {
        id: 'play',
        spot: ['card:ST01-013'],
        do: { allow: plays('ST01-013'), done: (s) => onField(s, ME, 'ST01-013') && settled(s) },
      },
      { id: 'rested', spot: ['my-cost', 'card:ST01-013'] },
      { id: 'quiz', quiz: { options: 3, correct: 1 } },
      {
        id: 'playNami',
        spot: ['card:ST01-007'],
        do: { allow: plays('ST01-007'), done: (s) => onField(s, ME, 'ST01-007') && settled(s) },
      },
      { id: 'recap', spot: ['my-cost'] },
    ],
  },
  {
    id: 'cards',
    chapter: 2,
    minutes: 4,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 9,
          active: ME,
          sides: [
            {
              hand: ['ST01-017', 'ST01-015', 'ST01-011'],
              characters: ['ST01-003', 'ST01-006', 'ST01-002', 'ST01-009', 'ST01-008'],
              life: 3,
              donActive: 9,
            },
            { hand: ['ST03-002', 'ST03-011'], characters: ['ST03-012'], life: 3, donRested: 8 },
          ],
        }),
    },
    steps: [
      { id: 'types' },
      {
        id: 'stage',
        spot: ['card:ST01-017'],
        do: { allow: plays('ST01-017'), done: (s) => Boolean(s.players[ME].stage) && settled(s) },
      },
      { id: 'stageOne', spot: ['my-stage'] },
      {
        id: 'event',
        spot: ['card:ST01-015', 'opp-card:ST03-012'],
        do: {
          allow: plays('ST01-015'),
          done: (s) => inTrash(s, OPP, 'ST03-012') && settled(s),
          fail: (s) => inTrash(s, ME, 'ST01-015') && onField(s, OPP, 'ST03-012') && settled(s),
        },
      },
      { id: 'eventTrash', spot: ['my-trash', 'opp-trash'] },
      { id: 'limit', spot: ['my-characters'] },
      {
        id: 'sixth',
        spot: ['card:ST01-011'],
        do: { allow: plays('ST01-011'), done: (s) => onField(s, ME, 'ST01-011') && settled(s) },
      },
      { id: 'notKo', spot: ['my-trash'] },
    ],
  },

  // ------------------------------------------------ Capítulo 3: Combate
  {
    id: 'attack',
    chapter: 3,
    minutes: 4,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 5,
          active: ME,
          sides: [
            { hand: ['ST01-003', 'ST01-014'], characters: ['ST01-013'], life: 4, donRested: 5 },
            {
              hand: ['ST03-002', 'ST03-017'],
              characters: [{ id: 'ST03-011', rested: true }, 'ST03-002'],
              life: 4,
              donRested: 4,
            },
          ],
        }),
    },
    steps: [
      { id: 'declare', spot: ['my-leader', 'my-characters'] },
      { id: 'targets', spot: ['opp-leader', 'opp-characters'] },
      { id: 'power' },
      {
        id: 'hitLeader',
        spot: ['card:ST01-013', 'opp-leader'],
        do: { allow: attacks('ST01-013', 'leader'), done: (s, start) => lifeOf(s, OPP) < lifeOf(start, OPP) && settled(s) },
      },
      { id: 'damage', spot: ['opp-life', 'opp-hand'] },
      {
        id: 'hitCharacter',
        spot: ['my-leader', 'opp-card:ST03-011'],
        do: { allow: attacks('leader', 'ST03-011'), done: (s) => inTrash(s, OPP, 'ST03-011') && settled(s) },
      },
      { id: 'ko', spot: ['opp-trash', 'opp-card:ST03-002'] },
    ],
  },
  {
    id: 'giveDon',
    chapter: 3,
    minutes: 3,
    format: 'guided',
    board: {
      opponent: 'passive',
      build: (ctx) =>
        scenario(ctx, {
          turn: 7,
          active: ME,
          sides: [
            { hand: ['ST01-003', 'ST01-004'], characters: ['ST01-008'], life: 4, donActive: 3, donRested: 4 },
            { hand: ['ST03-002', 'ST03-017'], characters: [{ id: 'ST03-012', rested: true }], life: 4, donRested: 6 },
          ],
        }),
    },
    steps: [
      { id: 'why', spot: ['card:ST01-008', 'opp-card:ST03-012'] },
      { id: 'how', spot: ['my-cost'] },
      {
        id: 'give',
        spot: ['my-cost', 'card:ST01-008'],
        do: { allow: gives('ST01-008'), done: (s) => (fieldCard(s, ME, 'ST01-008')?.don ?? 0) >= 1 },
      },
      {
        id: 'attack',
        spot: ['card:ST01-008', 'opp-card:ST03-012'],
        do: {
          allow: either(gives('ST01-008'), attacks('ST01-008', 'ST03-012')),
          done: (s) => inTrash(s, OPP, 'ST03-012') && settled(s),
        },
      },
      {
        id: 'leader',
        spot: ['my-leader', 'opp-leader'],
        do: {
          allow: either(gives('leader'), attacks('leader', 'leader')),
          done: (s, start) => lifeOf(s, OPP) < lifeOf(start, OPP) && settled(s),
        },
      },
      { id: 'donX', card: 'ST01-013' },
      { id: 'back', spot: ['my-cost'] },
    ],
  },
  {
    id: 'defense',
    chapter: 3,
    minutes: 5,
    format: 'challenge',
    board: {
      opponent: { attacks: [{ attacker: 'leader', target: 'leader' }, { attacker: 'ST03-012', target: 'leader' }] },
      build: (ctx) =>
        scenario(ctx, {
          turn: 6,
          active: OPP,
          sides: [
            { hand: ['ST01-007', 'ST01-011', 'ST01-004'], characters: ['ST01-006'], life: 4, donRested: 5 },
            { hand: ['ST03-002', 'ST03-006'], characters: ['ST03-012'], life: 4, donActive: 6 },
          ],
        }),
    },
    steps: [
      { id: 'theirTurn' },
      { id: 'steps' },
      { id: 'incoming', do: { done: (s) => s.pending?.kind === 'block' && s.pending.player === ME } },
      {
        id: 'block',
        spot: ['card:ST01-006', 'decision'],
        do: {
          respond: (a, s) => a.type === 'choose' && a.uids.length === 1 && cardIdOf(s, a.uids[0]) === 'ST01-006',
          done: (s) => Boolean(s.battle) && cardIdOf(s, s.battle!.target) === 'ST01-006',
        },
      },
      {
        id: 'blocked',
        spot: ['decision'],
        do: { respond: (a) => a.type === 'pass', done: (s) => !s.battle && inTrash(s, ME, 'ST01-006') },
      },
      { id: 'next', do: { done: (s) => s.pending?.kind === 'counter' && s.pending.player === ME } },
      {
        id: 'counter',
        spot: ['my-hand', 'decision'],
        do: {
          done: (s, start) => !s.battle && lifeOf(s, ME) === lifeOf(start, ME),
          fail: (s, start) => lifeOf(s, ME) < lifeOf(start, ME),
        },
      },
      { id: 'recap', spot: ['my-trash'] },
    ],
  },
  {
    id: 'damage',
    chapter: 3,
    minutes: 4,
    format: 'guided',
    board: {
      opponent: { attacks: [{ attacker: 'ST03-012', target: 'leader' }] },
      build: (ctx) =>
        scenario(ctx, {
          turn: 6,
          active: OPP,
          sides: [
            { hand: ['ST01-004', 'ST01-012'], life: ['ST01-003', 'ST01-015'], donRested: 5 },
            { hand: ['ST03-002', 'ST03-006'], characters: ['ST03-012'], life: 3, donActive: 6 },
          ],
        }),
    },
    steps: [
      { id: 'life', spot: ['my-life'] },
      { id: 'incoming', do: { done: (s) => s.pending?.kind === 'counter' && s.pending.player === ME } },
      {
        id: 'noCounter',
        spot: ['decision'],
        do: { respond: (a) => a.type === 'pass', done: (s) => s.pending?.kind === 'lifeCard' && s.pending.player === ME },
      },
      {
        id: 'trigger',
        spot: ['decision', 'opp-card:ST03-012'],
        do: {
          done: (s) => inTrash(s, OPP, 'ST03-012') && settled(s),
          fail: (s) => onField(s, OPP, 'ST03-012') && (inHand(s, ME, 'ST01-015') || inTrash(s, ME, 'ST01-015')) && !s.pending,
        },
      },
      { id: 'recap', spot: ['my-life', 'my-hand'] },
      { id: 'more' },
      { id: 'lose', spot: ['my-life'] },
    ],
  },

  // ------------------------------------------------ Capítulo 4: Domínio
  {
    id: 'keywords',
    chapter: 4,
    minutes: 5,
    format: 'quiz',
    steps: [
      { id: 'intro' },
      { id: 'onPlay', card: 'ST01-011' },
      { id: 'whenAttacking', card: 'ST01-005' },
      { id: 'activateMain', card: 'ST01-007' },
      { id: 'oncePerTurn', card: 'ST01-001' },
      { id: 'donX', card: 'ST01-013' },
      { id: 'donMinus', card: 'ST03-001' },
      { id: 'rush', card: 'ST01-012' },
      { id: 'blocker', card: 'ST01-006' },
      { id: 'counter', card: 'ST01-014' },
      { id: 'trigger', card: 'ST01-015' },
      { id: 'q1', card: 'ST01-012', quiz: { options: 3, correct: 2 } },
      { id: 'q2', card: 'ST01-011', quiz: { options: 3, correct: 1 } },
      { id: 'q3', card: 'ST03-001', quiz: { options: 3, correct: 3 } },
    ],
  },
  {
    id: 'deck',
    chapter: 4,
    minutes: 4,
    format: 'build',
    steps: [
      { id: 'rules', extra: 'deck-rules' },
      { id: 'colors', card: 'ST01-001' },
      { id: 'curve', extra: 'curve' },
      { id: 'counters', card: 'ST01-011' },
      { id: 'triggers', card: 'ST01-015' },
      { id: 'q1', quiz: { options: 3, correct: 2 } },
      { id: 'q2', quiz: { options: 3, correct: 3 } },
      { id: 'builder' },
    ],
  },
  {
    id: 'battle',
    chapter: 4,
    minutes: 10,
    format: 'match',
    board: {
      opponent: 'bot',
      // Partida de verdade: cada tentativa embaralha diferente.
      build: (ctx) => createGame({ ...config(ctx), seed: Math.floor(Math.random() * 1_000_000_000), firstPlayer: ME, chooseFirst: false }),
    },
    steps: [
      { id: 'intro' },
      // Partida livre: qualquer jogada vale (sem `allow`, nada passaria na Main Phase).
      { id: 'play', do: { allow: () => true, done: (s) => s.phase === 'gameover' } },
      { id: 'over' },
    ],
  },
];

export const CHAPTERS = [1, 2, 3, 4] as const;

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
export const lessonNumber = (id: string) => LESSONS.findIndex((l) => l.id === id) + 1;

// ---------------------------------------------------------------------- oponente

/**
 * Jogada do oponente com uma lista de ataques: cada ataque da lista que ainda é possível
 * (atacante ativo e ataque legal), na ordem; sem mais nenhum, encerra o turno. As escolhas
 * pendentes do oponente (Counter, Vida...) seguem o oponente passivo.
 */
export function scriptedAttack(s: GameState, plan: Extract<OpponentPlan, { attacks: unknown }>, legal: Action[]): Action | null {
  if (s.pending) return null;
  for (const a of plan.attacks) {
    const found = legal.find(
      (x) =>
        x.type === 'attack' &&
        (a.attacker === 'leader' ? x.attacker === s.players[OPP].leader.uid : cardIdOf(s, x.attacker) === a.attacker) &&
        (a.target === 'leader' ? x.target === s.players[ME].leader.uid : cardIdOf(s, x.target) === a.target),
    );
    if (found) return found;
  }
  return legal.find((x) => x.type === 'endTurn') ?? null;
}

// ---------------------------------------------------------------------- dicas da batalha final

/** Dica do treinador na partida da lição final, conforme o momento da partida. */
export function battleTip(s: GameState): string {
  if (s.phase === 'gameover') return 'over';
  const p = s.pending;
  if (p?.player === ME) {
    if (p.kind === 'mulligan') return 'mulligan';
    if (p.kind === 'block') return 'block';
    if (p.kind === 'counter') return 'counter';
    if (p.kind === 'lifeCard') return 'trigger';
    return 'choice';
  }
  if (s.activePlayer !== ME) return 'theirTurn';
  if (s.turn <= 2) return 'firstTurn';
  const me = s.players[ME];
  if (me.donActive > 0) return 'spend';
  return 'attack';
}
export const BATTLE_TIPS = ['mulligan', 'block', 'counter', 'trigger', 'choice', 'theirTurn', 'firstTurn', 'spend', 'attack', 'over'] as const;

// ---------------------------------------------------------------------- glossário

/** Termos do glossário e a lição que ensina cada um (textos `tutorial.term.<id>` e `.def`). */
export const GLOSSARY: Array<{ id: string; label: string; lesson: string }> = [
  { id: 'leader', label: 'Leader', lesson: 'table' },
  { id: 'life', label: 'Life', lesson: 'goal' },
  { id: 'don', label: 'DON!!', lesson: 'don' },
  { id: 'rest', label: 'Rest / Active', lesson: 'don' },
  { id: 'cost', label: 'Cost', lesson: 'don' },
  { id: 'power', label: 'Power', lesson: 'attack' },
  { id: 'counter', label: 'Counter', lesson: 'defense' },
  { id: 'blocker', label: '[Blocker]', lesson: 'defense' },
  { id: 'trigger', label: '[Trigger]', lesson: 'damage' },
  { id: 'rush', label: '[Rush]', lesson: 'keywords' },
  { id: 'onPlay', label: '[On Play]', lesson: 'keywords' },
  { id: 'whenAttacking', label: '[When Attacking]', lesson: 'keywords' },
  { id: 'activateMain', label: '[Activate: Main]', lesson: 'keywords' },
  { id: 'oncePerTurn', label: '[Once Per Turn]', lesson: 'keywords' },
  { id: 'donX', label: '[DON!! x1]', lesson: 'giveDon' },
  { id: 'donMinus', label: 'DON!! −1', lesson: 'keywords' },
  { id: 'doubleAttack', label: '[Double Attack]', lesson: 'damage' },
  { id: 'banish', label: '[Banish]', lesson: 'damage' },
  { id: 'ko', label: 'K.O.', lesson: 'attack' },
  { id: 'trash', label: 'Trash', lesson: 'cards' },
  { id: 'mulligan', label: 'Mulligan', lesson: 'setup' },
  { id: 'stage', label: 'Stage', lesson: 'cards' },
  { id: 'event', label: 'Event', lesson: 'cards' },
];
