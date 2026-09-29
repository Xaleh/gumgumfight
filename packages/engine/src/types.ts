// Tipos centrais do motor de regras.
// O estado do jogo é um objeto serializável (JSON puro): nada de classes ou funções,
// para que possa ser enviado pela rede, salvo como replay ou comparado em testes.

export type PlayerId = 0 | 1;

export type Color = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';
export type CardCategory = 'leader' | 'character' | 'event' | 'stage';
export type Keyword = 'rush' | 'blocker' | 'doubleAttack' | 'banish';

/** Dados "crus" de uma carta, como vêm da API / banco de dados. */
export interface CardData {
  id: string; // ex.: "ST01-001"
  name: string;
  category: CardCategory;
  colors: Color[];
  cost?: number; // personagens, eventos e stages
  life?: number; // apenas líderes
  power?: number; // líderes e personagens
  counter?: number; // personagens
  attributes?: string[]; // Strike, Slash, Ranged, Special, Wisdom
  types: string[]; // ex.: ["Supernovas", "Straw Hat Crew"]
  text: string; // texto do efeito
  trigger?: string; // texto do [Trigger]
  set?: string;
  rarity?: string;
  imageUrl?: string;
  /** Textos traduzidos (preenchidos pelo servidor). */
  i18n?: Partial<Record<'pt', CardTextTranslation>>;
}

export interface CardTextTranslation {
  text: string;
  trigger?: string;
  /** manual = revisada por uma pessoa; auto = regras completas; partial = sobrou inglês. */
  source: 'manual' | 'auto' | 'partial';
}

// ---------------------------------------------------------------------------
// DSL de efeitos
// ---------------------------------------------------------------------------

/** Filtro para escolha de alvos. */
export interface TargetSpec {
  side: 'own' | 'opponent';
  kinds: Array<'leader' | 'character' | 'stage'>;
  upTo: number;
  maxPower?: number;
  maxCost?: number;
  rested?: boolean; // true = somente virados; false = somente ativos
  hasType?: string; // ex.: "Straw Hat Crew"
  excludeSelf?: boolean;
  keyword?: Keyword;
}

/** Referência a cartas em um passo de efeito. */
export type TargetRef =
  | 'self' // a carta fonte do efeito
  | 'ownLeader'
  | 'battleTarget' // a carta sendo atacada na batalha atual
  | TargetSpec; // o jogador escolhe

export type Duration = 'turn' | 'battle';

export type EffectStep =
  | { do: 'power'; target: TargetRef; amount: number; duration: Duration }
  | { do: 'ko'; target: TargetRef }
  | { do: 'rest'; target: TargetRef }
  | { do: 'setActive'; target: TargetRef }
  | { do: 'giveRestedDon'; target: TargetRef; count: number }
  | { do: 'draw'; count: number }
  | { do: 'addDonFromDeck'; count: number; rested?: boolean }
  | { do: 'restOpponentDon'; count: number }
  | { do: 'returnToHand'; target: TargetRef }
  /** A batalha atual não permite [Blocker] (opcionalmente só de quem tem >= minPower). */
  | { do: 'noBlockerThisBattle'; minPower?: number }
  /** Se o alvo atacar neste turno, o oponente não pode usar [Blocker]. */
  | { do: 'noBlockerWhenAttacking'; target: TargetRef }
  /** Resolve os passos do efeito [Main] da própria carta (usado por [Trigger]). */
  | { do: 'useMainEffect' };

export type AbilityTiming =
  | 'onPlay'
  | 'whenAttacking'
  | 'activateMain' // [Activate: Main] de líder / personagem / stage
  | 'main' // [Main] de evento
  | 'counter' // [Counter] de evento
  | 'trigger' // [Trigger] (ativado ao ser revelado da Vida)
  | 'onKO'
  | 'onBlock'
  | 'static'; // efeito contínuo

export interface AbilityCost {
  restSelf?: boolean; // "You may rest this Character/Stage"
  restDon?: number; // ① ② ③ ... (virar DON!! ativos da área de custo)
  donMinus?: number; // DON!! −X (devolver DON!! ao deck de DON!!)
}

export interface Ability {
  timing: AbilityTiming;
  /** [DON!! xN]: requer N DON!! anexados (e só vale no seu turno). */
  don?: number;
  oncePerTurn?: boolean;
  yourTurn?: boolean;
  opponentsTurn?: boolean;
  cost?: AbilityCost;
  steps: EffectStep[];
  /** Efeitos estáticos (timing = 'static'). */
  staticPower?: number;
  staticKeyword?: Keyword;
  staticCanAttackActive?: boolean;
  /** Texto curto exibido na interface. */
  label?: string;
}

export interface CardScript {
  keywords?: Keyword[];
  abilities: Ability[];
  /** true quando o texto da carta está 100% coberto pelo script. */
  complete?: boolean;
}

/** Definição completa usada pelo motor: dados + script de efeitos. */
export interface CardDef extends CardData {
  keywords: Keyword[];
  abilities: Ability[];
  scripted: boolean;
}

// ---------------------------------------------------------------------------
// Estado do jogo
// ---------------------------------------------------------------------------

export interface CardInstance {
  uid: string;
  cardId: string;
  owner: PlayerId;
}

export interface FieldCard {
  uid: string;
  rested: boolean;
  don: number; // DON!! anexados
  playedOnTurn: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  isBot: boolean;
  leader: FieldCard;
  characters: FieldCard[];
  stage: FieldCard | null;
  hand: string[];
  deck: string[]; // índice 0 = topo
  trash: string[]; // último = topo
  life: string[]; // último = topo
  donDeck: number;
  donActive: number;
  donRested: number;
  mulliganDone: boolean;
}

export interface Modifier {
  uid: string;
  kind: 'power' | 'noBlockerWhenAttacking';
  amount: number;
  duration: Duration;
}

export interface BattleState {
  attacker: string;
  target: string;
  originalTarget: string;
  step: 'whenAttacking' | 'block' | 'counter' | 'damage' | 'end';
  blocked: boolean;
  noBlocker: boolean;
  noBlockerMinPower: number | null;
}

/** Escolhas que o motor aguarda de um jogador. */
export type Pending =
  | { kind: 'mulligan'; player: PlayerId }
  | {
      kind: 'selectTargets';
      player: PlayerId;
      options: string[];
      min: number;
      max: number;
      prompt: string;
      intent: 'harm' | 'help' | 'discard';
      source: string;
    }
  | { kind: 'block'; player: PlayerId; options: string[] }
  | { kind: 'counter'; player: PlayerId; options: string[] }
  | { kind: 'trigger'; player: PlayerId; card: string };

export type Frame =
  | {
      kind: 'effect';
      source: string;
      controller: PlayerId;
      steps: EffectStep[];
      i: number;
      choice?: string[];
    }
  | { kind: 'battle' }
  | { kind: 'damage'; defender: PlayerId; remaining: number; banish: boolean; lifeCard?: string; answered?: boolean }
  | { kind: 'play'; uid: string; replaceChoice?: string[] };

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  turn: number; // 1 = primeiro turno do primeiro jogador
  firstPlayer: PlayerId;
  activePlayer: PlayerId;
  phase: 'mulligan' | 'main' | 'gameover';
  players: [PlayerState, PlayerState];
  cards: Record<string, CardInstance>;
  defs: Record<string, CardDef>;
  battle: BattleState | null;
  stack: Frame[];
  pending: Pending | null;
  modifiers: Modifier[];
  usedThisTurn: string[];
  winner: PlayerId | null;
  winReason: string | null;
  log: LogEntry[];
  actionCount: number;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
  | { type: 'playCard'; player: PlayerId; uid: string }
  | { type: 'attachDon'; player: PlayerId; target: string }
  | { type: 'activate'; player: PlayerId; uid: string; ability: number }
  | { type: 'attack'; player: PlayerId; attacker: string; target: string }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'choose'; player: PlayerId; uids: string[] }
  | { type: 'answer'; player: PlayerId; yes: boolean }
  | { type: 'counter'; player: PlayerId; uid: string }
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId };

export interface DeckList {
  id: string;
  name: string;
  leader: string;
  cards: Array<{ id: string; count: number }>;
}

export interface PlayerSetup {
  name: string;
  deck: DeckList;
  isBot?: boolean;
}

export interface GameConfig {
  seed: number;
  players: [PlayerSetup, PlayerSetup];
  cards: CardData[];
  /** Se omitido, decidido pelo RNG (equivalente ao pedra-papel-tesoura). */
  firstPlayer?: PlayerId;
}
