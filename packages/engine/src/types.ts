// Tipos centrais do motor de regras.
// O estado do jogo é um objeto serializável (JSON puro): nada de classes ou funções,
// para que possa ser enviado pela rede, salvo como replay ou comparado em testes.

export type PlayerId = 0 | 1;

export type Color = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';
export type CardCategory = 'leader' | 'character' | 'event' | 'stage';
/** rushCharacter = [Rush: Character] (pode atacar Personagens no turno em que entra). */
export type Keyword = 'rush' | 'blocker' | 'doubleAttack' | 'banish' | 'rushCharacter';

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
  /** "All of your …": afeta todas as cartas válidas, sem escolha. */
  all?: boolean;
  minCost?: number;
  minPower?: number;
  /** "other than [Nome]" */
  excludeName?: string;
  /** "[Nome]" */
  name?: string;
  /** "base cost" / "base power": compara com os valores impressos, sem modificadores. */
  base?: boolean;
  /** "with a cost equal to or less than the number of your opponent's Life cards" */
  maxCostDynamic?: 'opponentLife' | 'ownLife' | 'totalLife';
  color?: Color;
  /** "with a type including "Whitebeard Pirates"" (parte do nome do tipo) */
  typeIncludes?: string;
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
  /** "red Character card" */
  color?: Color;
  /** "with a type including "X"" */
  typeIncludes?: string;
  /** "no base effect": carta sem texto de efeito */
  noEffect?: boolean;
  maxPower?: number;
  minPower?: number;
  /** "and a [Trigger]" */
  hasTrigger?: boolean;
}

/**
 * Condição de uma habilidade ("If you have 3 or more Characters, …") ou de um passo
 * ("draw 1 card if you have 3 or less cards in your hand"). Todas as condições presentes precisam valer.
 */
export interface Condition {
  minCharacters?: number;
  /** "If this Character is rested" */
  selfRested?: boolean;
  /** "If you have N or more DON!! cards on your field" */
  minDonOnField?: number;
  /** "if you have N or less cards in your hand" */
  handMax?: number;
  /** "If your Leader has the {X} type" */
  leaderHasType?: string;
  /** "If your Leader is [X]" */
  leaderName?: string;
  /** "If your opponent has more DON!! cards on their field than you" */
  opponentMoreDon?: boolean;
  /** "If you have N or less Life cards" */
  lifeMax?: number;
  /** "If your opponent has N or less Life cards" */
  opponentLifeMax?: number;
  /** "you and your opponent have a total of N or less Life cards" */
  totalLifeMax?: number;
  /** "If there is a Character with a cost of N (or more / or less)" (de qualquer jogador) */
  anyCharacterCost?: { min?: number; max?: number };
  /** "If you don't have [X]" (nenhum Personagem seu com esse nome) */
  noCharacterNamed?: string;
  /** "If your Leader is multicolored" */
  leaderMulticolor?: boolean;
  /** "If you have N or more cards in your hand" */
  handMin?: number;
  /** "If you have N or more rested Characters" */
  minRestedCharacters?: number;
  /** "If your opponent has N or more rested Characters" */
  opponentMinRestedCharacters?: number;
  /** "if you have less Life cards than your opponent" */
  lifeLessThanOpponent?: boolean;
  /** "If you have N or less DON!! cards on your field" */
  maxDonOnField?: number;
  /** "If you have N or more Life cards" */
  lifeMin?: number;
  /** "If your opponent has a Character with N or more power" */
  opponentCharacterMinPower?: number;
  /** "If you have [X]" / "If you have a [X] Character" */
  haveCharacterNamed?: string;
  /** "If your opponent has N or more DON!! cards on their field" */
  opponentMinDonOnField?: number;
  /** "If you have N or more cards in your trash" */
  trashMin?: number;
  /** "If the number of DON!! cards on your field is equal to or less than the number on your opponent's field" */
  donLeqOpponent?: boolean;
  /** "If your Leader has the {A} or {B} type" */
  leaderHasAnyType?: string[];
  /** "If you have a Character with a cost of N or more" */
  ownCharacterMinCost?: number;
  /** "If your opponent has N or more cards in their hand" */
  opponentHandMin?: number;
  /** "If this Character has N power or more" */
  selfMinPower?: number;
  /** "If you have any DON!! cards given" */
  anyDonGiven?: boolean;
  /** "If this Character was played on this turn" */
  selfPlayedThisTurn?: boolean;
  /** "If you have N or more {X} type Characters" */
  minTypedCharacters?: { count: number; type: string };
  /** "If your opponent has N or more Life cards" */
  opponentLifeMin?: number;
  /** "If the revealed card / that card is …": testa a carta escolhida/revelada no passo anterior. */
  chosenMatches?: CardFilter;
  /** "If you have a {X} type Character with a cost of N or more" */
  ownTypedCharacterMinCost?: { type: string; cost: number };
  /** "If your opponent has a Character with a cost of N or more" */
  opponentCharacterMinCost?: number;
  /** "If your Leader has the {X} type or is [Y]" */
  leaderTypeOrName?: { type: string; name: string };
  /** "If you have no other [X] Characters" */
  noOtherNamed?: string;
  /** "If you have N or less Characters" */
  maxCharacters?: number;
  /** "If you have N or more active DON!! cards" */
  minActiveDon?: number;
  /** "If you have N or more Events in your trash" */
  trashEventsMin?: number;
  /** "If you have a Character with N power or more" */
  ownCharacterMinPower?: number;
  /** "If the number of your Life cards is equal to or less than the number of your opponent's Life cards" */
  lifeLeqOpponent?: boolean;
  /** "If you have N or less cards in your deck" */
  deckMax?: number;
  /** "If you have N or more rested {X} type Characters" (type opcional) */
  minRestedTyped?: { count: number; types?: string[] };
}

export type AbilityCondition = Condition;
export type StepCondition = Condition;

/** Bônus contínuo para outras cartas do mesmo jogador ("your {Navy} type Characters gain +1000"). */
export interface Aura {
  kinds: Array<'leader' | 'character'>;
  hasAnyType?: string[];
  typeIncludes?: string;
  power: number;
  /** Afeta as cartas do oponente ("Give all of your opponent's Characters −5 cost"). */
  side?: 'own' | 'opponent';
  /** Custo em vez de poder. */
  cost?: number;
}

/** Referência a cartas em um passo de efeito. */
export type TargetRef =
  | 'self' // a carta fonte do efeito
  | 'ownLeader'
  | 'chosen' // as cartas escolhidas no passo anterior ("that card", "that Character")
  | 'battleTarget' // a carta sendo atacada na batalha atual
  | TargetSpec; // o jogador escolhe

/**
 * nextOpponentTurn = "until the end of your opponent's next turn";
 * untilYourNextTurn = "until the start of your next turn"; endOfYourNextTurn = "until the end of your next turn".
 */
export type Duration = 'turn' | 'battle' | 'nextOpponentTurn' | 'untilYourNextTurn' | 'endOfYourNextTurn';

/** Acontecimentos a que uma carta pode reagir ("When a DON!! card on your field is returned…"). */
export type GameEvent =
  | { kind: 'donReturned' } // DON!! do seu campo voltou ao deck de DON!!
  | { kind: 'characterKO'; whose: 'any' | 'own' | 'opponent' }
  | { kind: 'eventActivated'; who: 'self' | 'opponent' }
  | { kind: 'blockerActivated'; who: 'self' | 'opponent' }
  | { kind: 'selfRested' } // "When this Character becomes rested"
  | { kind: 'attackDamage' } // "When this Character's attack deals damage to your opponent's Life"
  | { kind: 'battleKO' }; // "When this Character battles and K.O.'s your opponent's Character"

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
  | { do: 'noBlockerThisBattle'; minPower?: number; maxPower?: number; maxCost?: number }
  /** Se o alvo atacar neste turno, o oponente não pode usar [Blocker]. */
  | { do: 'noBlockerWhenAttacking'; target: TargetRef }
  /** Resolve os passos do efeito [Main] da própria carta (usado por [Trigger]). */
  | { do: 'useMainEffect' }
  /** Efeito ainda não automatizado: o jogador aplica à mão com as ferramentas manuais. */
  | { do: 'manual'; text: string }
  /** "Play this card" (ex.: [Trigger]): joga a própria carta, sem custo. */
  | { do: 'playThis' }
  /** Descartar cartas da mão (custo "You may trash N card from your hand"). */
  | { do: 'trashFromHand'; count: number; filter?: CardFilter; upTo?: boolean }
  /** "Draw cards so that you have N cards in your hand." */
  | { do: 'drawUntil'; count: number }
  /** "Your opponent returns N DON!! cards from their field to their DON!! deck." */
  | { do: 'opponentReturnsDon'; count: number }
  /** "Set up to N of your DON!! cards as active." */
  | { do: 'setDonActive'; count: number }
  /** "Look at N cards from the top of your deck; reveal up to M … and add it to your hand. Then, place the rest…" */
  | { do: 'search'; look: number; upTo: number; filter: CardFilter; rest: 'bottom' | 'trash' | 'topOrBottom'; play?: boolean }
  /** "Reveal up to 1 [X] from your deck and add it to your hand." (procura no deck inteiro) */
  | { do: 'tutor'; upTo: number; filter: CardFilter }
  /** "add 1 card from the top or bottom of your Life cards to your hand" (choose = o jogador escolhe topo/fundo) */
  | { do: 'lifeToHand'; count: number; choose?: boolean }
  /** "add up to 1 card from your hand to the top of your Life cards" */
  | { do: 'handToLife'; upTo: number; filter?: CardFilter }
  /** "Add up to 1 of your Characters … to the top of the owner's Life cards" */
  | { do: 'fieldToLife'; target: TargetRef; choose?: boolean }
  /** "Look at up to 1 card from the top of your or your opponent's Life cards, and place it at the top or bottom" */
  | { do: 'peekLife'; whose: 'either' | 'own' | 'opponent' }
  /** "Choose one: • … • …" / "Your opponent chooses one: …" */
  | { do: 'chooseOne'; chooser: 'self' | 'opponent'; options: EffectStep[][]; labels: string[] }
  /** Custos com escolha (ver AbilityCost): */
  | { do: 'restOwn'; count: number; spec: TargetSpec }
  | { do: 'returnOwn'; count: number; spec: TargetSpec }
  | { do: 'trashSelf' }
  | { do: 'returnSelfToHand' }
  | { do: 'trashToDeckBottom'; count: number; filter?: CardFilter }
  | { do: 'lifeToTrash'; count: number; choose?: boolean }
  | { do: 'revealFromHand'; count: number; filter?: CardFilter }
  | { do: 'lifeFace'; count: number; up: boolean }
  /** "… will not become active in your opponent's next Refresh Phase" */
  | { do: 'skipRefresh'; target: TargetRef }
  /** "Trash up to 1 of your opponent's Characters" (vai para o descarte sem ser K.O.) */
  | { do: 'trashTarget'; target: TargetRef }
  /** "trash N cards from your opponent's hand" (escolhidas ao acaso: a mão é oculta) */
  | { do: 'trashRandomFromOpponentHand'; count: number }
  /** Custos: "K.O. N of your …", "trash N of your Characters", "place this Character at the bottom of the owner's deck" */
  | { do: 'koOwn'; count: number; spec: TargetSpec }
  | { do: 'trashOwn'; count: number; spec: TargetSpec }
  | { do: 'selfToDeckBottom' }
  /** "Reveal 1 card from the top of your deck." (a carta vira 'chosen') */
  | { do: 'revealTop' }
  /** "you may play that card (rested)" / "play up to 1 … (dentre as reveladas)" */
  | { do: 'playRevealed'; filter?: CardFilter; rested?: boolean }
  /** "place the revealed card at the bottom of your deck" */
  | { do: 'revealedToBottom' }
  /** "… cannot be rested until the end of your opponent's next turn" */
  | { do: 'cannotBeRested'; target: TargetRef; duration: Duration }
  /** "add up to N card from the top of your opponent's Life cards to the owner's hand" */
  | { do: 'opponentLifeToHand'; count: number }
  /** "your opponent places N card from their hand at the bottom of their deck" */
  | { do: 'opponentHandToBottom'; count: number }
  /** "… at the end of this turn": passos adiados para o fim do turno. */
  | { do: 'delayed'; steps: EffectStep[] }
  /** Virar N Personagens ativos seus (custo "You may rest 2 of your Characters"). */
  | { do: 'restOwnCharacters'; count: number }
  /** Colocar cartas da mão no fundo do deck (custo "You may place 1 card from your hand at the bottom of your deck"). */
  | { do: 'handToDeckBottom'; count: number }
  /** "This Character can also attack your opponent's active Characters during this turn." */
  | { do: 'canAttackActive'; target: TargetRef; duration: Duration }
  /** "… cannot attack until the end of your opponent's next turn." */
  | { do: 'cannotAttack'; target: TargetRef; duration: Duration }
  /** Resolve os passos do efeito [Counter] da própria carta (usado por [Trigger]). */
  | { do: 'useCounterEffect' }
  /** "Place … at the bottom of the owner's deck." */
  | { do: 'toDeckBottom'; target: TargetRef }
  /** "Add up to N … from your trash to your hand." */
  | { do: 'fromTrashToHand'; upTo: number; filter: CardFilter }
  /** "Play up to N … from your deck/hand/trash" (sem pagar custo). */
  | { do: 'playFrom'; from: 'deck' | 'hand' | 'trash' | 'handOrTrash'; upTo: number; filter: CardFilter; rested?: boolean }
  /** "… then shuffle your deck." */
  | { do: 'shuffleDeck' }
  /** "Look at N cards from the top of your deck and return them to the top or bottom of the deck in any order." */
  | { do: 'arrangeTop'; look: number }
  /**
   * Custo opcional no meio de um efeito automático ("[On Play] DON!! −1: …", "You may trash 1 card from your
   * hand: …"). O jogador decide se paga; se não pagar (ou não puder), o resto do efeito não acontece.
   */
  | { do: 'payCost'; cost: AbilityCost; scope?: number }
  /** "Trash up to N of your opponent's Life cards." (do topo) */
  | { do: 'trashLife'; side: 'own' | 'opponent'; count: number }
  /** "This Character gains [Rush] during this turn." */
  | { do: 'gainKeyword'; target: TargetRef; keyword: Keyword; duration: Duration }
  /** "Select up to 1 …": só escolhe (o passo seguinte usa 'chosen'). */
  | { do: 'select'; target: TargetRef }
  /** "Give up to 1 of your opponent's Characters −2 cost during this turn." */
  | { do: 'cost'; target: TargetRef; amount: number; duration: Duration }
  /** "Your opponent chooses N cards from their hand and trashes them." (quem escolhe é o oponente) */
  | { do: 'opponentDiscards'; count: number }
  /** "Trash N cards from the top of your deck." */
  | { do: 'millDeck'; count: number }
  /** "Activate this card's [On Play] effect." (usado por [Trigger]) */
  | { do: 'useOwnEffect'; timing: 'onPlay' | 'onKO' | 'main' | 'counter' }
  /** "… and add this card to your hand." ([Trigger]) */
  | { do: 'addThisToHand' }
  /** "Add up to N card from the top of your deck to the top of your Life cards." */
  | { do: 'addLifeFromDeck'; count: number }
  /** "… cannot be K.O.'d during this turn" (só Personagens; inBattle = apenas em batalha). */
  | { do: 'cannotBeKO'; target: TargetRef; duration: Duration; inBattle?: boolean };

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
  | 'event' // "When …": reação a um acontecimento (Ability.event)
  | 'onOpponentAttack' // [On Your Opponent's Attack]
  | 'static'; // efeito contínuo

export interface AbilityCost {
  restSelf?: boolean; // "You may rest this Character/Stage"
  restDon?: number; // ① ② ③ ... (virar DON!! ativos da área de custo)
  donMinus?: number; // DON!! −X (devolver DON!! ao deck de DON!!)
  trashFromHand?: number; // "You may trash N card from your hand:"
  /** Filtro das cartas descartadas como custo ("trash 1 {FILM} type card from your hand"). */
  trashFilter?: CardFilter;
  /** "You may place N cards from your hand at the bottom of your deck:" */
  handToBottom?: number;
  /** "You may add 1 card from your Life area to your hand:" (do topo) */
  lifeToHand?: number;
  /** "… from the top or bottom of your Life cards …": o jogador escolhe de onde. */
  lifeChoice?: boolean;
  /** "You may rest N of your Characters:" (o jogador escolhe quais) */
  restCharacters?: number;
  /** "You may rest N of your {X} type Leader or Stage cards:" (filtro de alvo) */
  restOwn?: { count: number; spec: TargetSpec };
  /** "You may return N of your Characters … to the owner's hand:" */
  returnOwn?: { count: number; spec: TargetSpec };
  /** "You may trash this Character:" */
  trashSelf?: boolean;
  /** "You may place this Character at the bottom of the owner's deck:" */
  selfToBottom?: boolean;
  /** "You may K.O. N of your … Characters:" */
  koOwn?: { count: number; spec: TargetSpec };
  /** "You may trash N of your Characters:" */
  trashOwn?: { count: number; spec: TargetSpec };
  /** "You may return this Character to the owner's hand:" */
  returnSelf?: boolean;
  /** "You may trash N cards from the top of your deck:" */
  mill?: number;
  /** "You may place N cards (filtro) from your trash at the bottom of your deck in any order:" */
  trashToBottom?: { count: number; filter?: CardFilter };
  /** "You may trash N card from the top (or bottom) of your Life cards:" */
  lifeToTrash?: { count: number; choose?: boolean };
  /** "You may reveal N … from your hand:" */
  reveal?: { count: number; filter?: CardFilter };
  /** "You may turn N card from the top of your Life cards face-up / face-down:" */
  lifeFace?: { count: number; up: boolean };
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
  /** "This Character cannot be K.O.'d in battle." */
  staticNoBattleKO?: boolean;
  /** "This Character cannot be K.O.'d by effects." */
  staticNoEffectKO?: boolean;
  /** "This Leader cannot attack." */
  staticCannotAttack?: boolean;
  /** "This Character cannot be K.O.'d in battle by "Strike" attribute Characters." */
  noBattleKOVsAttribute?: string;
  /** "This Character cannot be K.O.'d in battle by Leaders." */
  noBattleKOByLeader?: boolean;
  /** "This Character gains +N cost." */
  staticCost?: number;
  /** "When this Character battles {attribute} attribute Characters, this Character gains +N power". */
  battleVsAttribute?: { attribute: string; power: number };
  /** Para timing 'event': o acontecimento que dispara a habilidade. */
  event?: GameEvent;
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
  /** Cartas de Vida viradas para cima. */
  lifeFaceUp?: string[];
}

export interface Modifier {
  uid: string;
  kind:
    | 'power'
    | 'cost'
    | 'noBlockerWhenAttacking'
    | 'keyword'
    | 'cannotBeKO'
    | 'cannotBeKOInBattle'
    | 'canAttackActive'
    | 'cannotAttack'
    | 'skipRefresh'
    | 'cannotBeRested';
  amount: number;
  /** Para 'nextOpponentTurn': o efeito acaba no fim deste turno. */
  untilTurn?: number;
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
  /** "cannot activate a [Blocker] Character that has N or less power" */
  noBlockerMaxPower?: number;
  /** "cannot activate the [Blocker] of any Character with a cost of N or less" */
  noBlockerMaxCost?: number;
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
  /** Escolha entre opções com texto (modo "Choose one", topo/fundo...). Responder com `option`. */
  | { kind: 'option'; player: PlayerId; source: string; prompt: string; options: string[] }
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
      /** Alvos do último passo com alvo (para 'chosen'). */
      last?: string[];
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
  /** Efeitos adiados para o fim do turno ("at the end of this turn"). */
  delayed?: Array<{ controller: PlayerId; source: string; steps: EffectStep[] }>;
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
  | { type: 'manualDone'; player: PlayerId }
  | { type: 'option'; player: PlayerId; index: number };

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
