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
  /** Observações da fonte que não fazem parte do efeito (errata, reimpressão...). */
  notes?: string[];
  /** "Also treat this card's name as [X]": nomes alternativos para regras e efeitos. */
  aliases?: string[];
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
  /** 'any' = personagens de qualquer jogador ("Return up to 1 Character…"). */
  side: 'own' | 'opponent' | 'any';
  kinds: Array<'leader' | 'character' | 'stage'>;
  upTo: number;
  maxPower?: number;
  maxCost?: number;
  rested?: boolean; // true = somente virados; false = somente ativos
  hasType?: string; // ex.: "Straw Hat Crew"
  excludeSelf?: boolean;
  keyword?: Keyword;
  /** Pelo menos um destes tipos ("{Supernovas} or {Heart Pirates} type"). */
  hasAnyType?: string[];
}

/** Filtro de cartas fora do campo (busca no deck, mão...). */
export interface CardFilter {
  hasAnyType?: string[];
  maxCost?: number;
  minCost?: number;
  category?: CardCategory;
  /** "other than [Nome]" */
  excludeName?: string;
  /** "[Pacifista]": nome exato (ou nome alternativo). */
  name?: string;
}

/** Condição verificada quando o passo vai resolver ("draw 1 card if you have 3 or less cards in your hand"). */
export interface StepCondition {
  handMax?: number;
  /** "If your Leader has the {X} type" */
  leaderHasType?: string;
}

/** Condições extras de uma habilidade ("If you have 3 or more Characters", "If this Character is rested"). */
export interface AbilityCondition {
  minCharacters?: number;
  selfRested?: boolean;
}

/** Bônus contínuo para outras cartas do mesmo jogador ("your {Navy} type Characters gain +1000"). */
export interface Aura {
  kinds: Array<'leader' | 'character'>;
  hasAnyType?: string[];
  power: number;
}

/** Referência a cartas em um passo de efeito. */
export type TargetRef =
  | 'self' // a carta fonte do efeito
  | 'ownLeader'
  | 'battleTarget' // a carta sendo atacada na batalha atual
  | TargetSpec; // o jogador escolhe

export type Duration = 'turn' | 'battle';

type EffectStepBody =
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
  | { do: 'useMainEffect' }
  /** Efeito ainda não automatizado: o jogador aplica à mão com as ferramentas manuais. */
  | { do: 'manual'; text: string }
  /** "Play this card" (ex.: [Trigger]): joga a própria carta, sem custo. */
  | { do: 'playThis' }
  /** Descartar cartas da mão (custo "You may trash N card from your hand"). */
  | { do: 'trashFromHand'; count: number }
  /** "Set up to N of your DON!! cards as active." */
  | { do: 'setDonActive'; count: number }
  /** "Look at N cards from the top of your deck; reveal up to M … and add it to your hand. Then, place the rest…" */
  | { do: 'search'; look: number; upTo: number; filter: CardFilter; rest: 'bottom' | 'trash' }
  /** Resolve os passos do efeito [Counter] da própria carta (usado por [Trigger]). */
  | { do: 'useCounterEffect' }
  /** "Place … at the bottom of the owner's deck." */
  | { do: 'toDeckBottom'; target: TargetRef }
  /** "Add up to N … from your trash to your hand." */
  | { do: 'fromTrashToHand'; upTo: number; filter: CardFilter }
  /** "Play up to N … from your deck/hand/trash" (sem pagar custo). */
  | { do: 'playFrom'; from: 'deck' | 'hand' | 'trash'; upTo: number; filter: CardFilter; rested?: boolean }
  /** "… then shuffle your deck." */
  | { do: 'shuffleDeck' }
  /** "Look at N cards from the top of your deck and return them to the top or bottom of the deck in any order." */
  | { do: 'arrangeTop'; look: number }
  /**
   * Custo opcional no meio de um efeito automático ("[On Play] DON!! −1: …", "You may trash 1 card from your
   * hand: …"). O jogador decide se paga; se não pagar (ou não puder), o resto do efeito não acontece.
   */
  | { do: 'payCost'; cost: AbilityCost }
  /** "Trash up to N of your opponent's Life cards." (do topo) */
  | { do: 'trashLife'; side: 'own' | 'opponent'; count: number }
  /** "This Character gains [Rush] during this turn." */
  | { do: 'gainKeyword'; target: TargetRef; keyword: Keyword; duration: Duration };

/** Um passo de efeito; `if` é checado na hora de resolver (falhou = o passo é pulado). */
export type EffectStep = EffectStepBody & { if?: StepCondition };



export type AbilityTiming =
  | 'onPlay'
  | 'whenAttacking'
  | 'activateMain' // [Activate: Main] de líder / personagem / stage
  | 'main' // [Main] de evento
  | 'counter' // [Counter] de evento
  | 'trigger' // [Trigger] (ativado ao ser revelado da Vida)
  | 'onKO'
  | 'onBlock'
  | 'endOfTurn' // [End of Your Turn]
  | 'battlesCharacter' // "If this Character battles your opponent's Character" (ao fim da batalha)
  | 'static'; // efeito contínuo

export interface AbilityCost {
  restSelf?: boolean; // "You may rest this Character/Stage"
  restDon?: number; // ① ② ③ ... (virar DON!! ativos da área de custo)
  donMinus?: number; // DON!! −X (devolver DON!! ao deck de DON!!)
  trashFromHand?: number; // "You may trash N card from your hand:"
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
  condition?: AbilityCondition;
  /** Efeitos estáticos (timing = 'static'). */
  aura?: Aura;
  staticPower?: number;
  staticKeyword?: Keyword;
  staticCanAttackActive?: boolean;
  /** Texto curto exibido na interface. */
  label?: string;
  /** Habilidade derivada do texto, resolvida manualmente pelo jogador. */
  manual?: boolean;
  /** Trecho do texto da carta a que a habilidade corresponde. */
  text?: string;
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
  /** Tem efeito resolvido manualmente (sem script). */
  manual: boolean;
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
  kind: 'power' | 'noBlockerWhenAttacking' | 'keyword';
  amount: number;
  keyword?: Keyword;
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
  /** Personagens que batalharam entre si (registrado no dano, vale mesmo se um sair de campo). */
  fought?: string[];
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
      /** A ordem dos cliques importa (ex.: ordem das cartas no topo do deck). */
      ordered?: boolean;
    }
  | { kind: 'block'; player: PlayerId; options: string[] }
  | { kind: 'counter'; player: PlayerId; options: string[] }
  | { kind: 'trigger'; player: PlayerId; card: string }
  /** Pergunta sim/não (ex.: pagar um custo opcional). Responder com `answer`. */
  | { kind: 'confirm'; player: PlayerId; source: string; prompt: string }
  /** O jogador aplica à mão o efeito `text` da carta `source` e depois confirma. */
  | { kind: 'manual'; player: PlayerId; source: string; text: string };

export type Frame =
  | {
      kind: 'effect';
      source: string;
      controller: PlayerId;
      steps: EffectStep[];
      i: number;
      choice?: string[];
      /** Memória de passos com mais de uma escolha (ex.: arrangeTop). */
      memo?: string[];
    }
  | { kind: 'battle' }
  | { kind: 'damage'; defender: PlayerId; remaining: number; banish: boolean; lifeCard?: string; answered?: boolean }
  | { kind: 'play'; uid: string; replaceChoice?: string[]; rested?: boolean }
  /** Fecha o turno depois que os efeitos de [End of Your Turn] resolverem. */
  | { kind: 'endTurn' };

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
  | { type: 'concede'; player: PlayerId }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
  | { type: 'manualDone'; player: PlayerId };

/** Destinos de uma carta movida manualmente (sempre nas zonas do dono da carta). */
export type ManualZone = 'hand' | 'trash' | 'deckTop' | 'deckBottom' | 'life' | 'character' | 'stage';

/** Operações das ferramentas manuais (para efeitos ainda não automatizados). */
export type ManualOp =
  | { op: 'draw'; count: number }
  | { op: 'move'; uid: string; to: ManualZone; rested?: boolean }
  | { op: 'ko'; uid: string }
  | { op: 'setRested'; uid: string; rested: boolean }
  | { op: 'power'; uid: string; amount: number; duration: Duration }
  | { op: 'donFromDeck'; count: number; rested: boolean }
  | { op: 'donToDeck'; count: number }
  | { op: 'donGive'; uid: string; from: 'active' | 'rested' }
  | { op: 'donSetState'; player: PlayerId; rested: boolean; count: number }
  | { op: 'shuffle' };

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
