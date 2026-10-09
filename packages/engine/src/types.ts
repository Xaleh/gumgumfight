// Tipos centrais do motor de regras.
// O estado do jogo é um objeto serializável (JSON puro): nada de classes ou funções,
// para que possa ser enviado pela rede, salvo como replay ou comparado em testes.

export type PlayerId = 0 | 1;

export type Color = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';
export type CardCategory = 'leader' | 'character' | 'event' | 'stage';
/** rushCharacter = [Rush: Character] (pode atacar Personagens no turno em que entra). */
/** unblockable = [Unblockable] (não pode ser bloqueado). */
export type Keyword = 'rush' | 'blocker' | 'doubleAttack' | 'banish' | 'rushCharacter' | 'unblockable';

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
  /**
   * Carta já anunciada que ainda não está na API oficial (dados de sites de spoiler).
   * Some sozinho quando a API publica a carta: os dados oficiais substituem os do spoiler.
   */
  spoiler?: CardSpoiler;
}

export interface CardSpoiler {
  /** Site de onde vieram os dados (ex.: "optcgleaks.com"). */
  source: string;
  /** Página da carta ou da lista de spoilers. */
  url?: string;
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
  /** "… and the other": não pode ser a carta escolhida no passo anterior (OP08-118). */
  notLast?: true;
  /** 'any' = personagens de qualquer jogador ("Return up to 1 Character…"). */
  side: 'own' | 'opponent' | 'any';
  kinds: Array<'leader' | 'character' | 'stage'>;
  upTo: number;
  /**
   * Quantidade sem "up to" ("return 1 of your Characters", "your Leader or 1 of your Characters"):
   * o jogador escolhe o máximo possível até `upTo`, não pode escolher menos (8-4-4-1).
   */
  required?: boolean;
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
  /** "with a [Trigger]" */
  hasTrigger?: boolean;
  /** "that has 2 or more DON!! cards given" */
  minDon?: number;
  /** "your {X} type Characters or Characters with a [Trigger]": basta atender a um dos filtros. */
  either?: Array<Partial<TargetSpec>>;
  /** "[San-Gorou] or [Sanji] Character": um destes nomes. */
  names?: string[];
  /** "your "Slash" attribute Characters" */
  attribute?: string;
  /** "your Characters or [X]": o Líder só vale se tiver este nome. */
  leaderOnlyNamed?: string;
  /** "without an [On Play] effect" */
  withoutTiming?: 'onPlay' | 'whenAttacking';
  color?: Color;
  /** "with a type including "Whitebeard Pirates"" (parte do nome do tipo) */
  typeIncludes?: string;
  /** "with a total power of 4000 or less": soma das cartas escolhidas. */
  totalMaxPower?: number;
  /** "with a total cost of 4 or less" */
  totalMaxCost?: number;
  /** "with no base effect" (sem texto de efeito impresso) */
  noEffect?: boolean;
  /** "with both the {A} and {B} types": todos estes tipos. */
  hasAllTypes?: string[];
  /** "without [Blocker]" */
  withoutKeyword?: Keyword;
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
  /** "with a cost equal to or less than the number of DON!! cards on your field" (calculado na hora) */
  maxCostDon?: boolean;
  /** "{Neptunian} type Character card or "Megalo"": este nome dispensa o tipo. */
  orName?: string;
  /** "[Sabo], [Portgas.D.Ace], or [Monkey.D.Luffy]" */
  names?: string[];
  /** "Slash" attribute (ou, com orName, "either [Perona] or has the "Slash" attribute") */
  attribute?: string;
  /** "{Muggy Kingdom} type or "Slash" attribute": o atributo dispensa o tipo. */
  orAttribute?: string;
  /** "a "Slash" attribute card or green Event": basta um dos filtros. */
  either?: CardFilter[];
  /** custo até o número de DON!! do oponente */
  maxCostOppDon?: boolean;
  /** "with different card names" (várias cartas escolhidas) */
  distinctNames?: boolean;
  /** "and a total cost of 9 or less" (várias cartas escolhidas) */
  totalMaxCost?: number;
  /** "the same card name as the trashed card" (a carta descartada no custo) */
  sameNameAsChosen?: boolean;
  /** "with both the {A} and {B} types": todos estes tipos. */
  hasAllTypes?: string[];
  /** "without [Blocker]" */
  withoutKeyword?: Keyword;
}

/**
 * Condição de uma habilidade ("If you have 3 or more Characters, …") ou de um passo
 * ("draw 1 card if you have 3 or less cards in your hand"). Todas as condições presentes precisam valer.
 */
export interface Condition {
  minCharacters?: number;
  /** "If there is a [X] Character" (de qualquer jogador) */
  anyCharacterNamed?: string;
  /** "If you only have Characters with a type including "X"" */
  onlyTypeIncludes?: string;
  /** "If all of your DON!! cards are rested" */
  allDonRested?: boolean;
  /** "the number of … on your field is at least N less than the number on your opponent's field" */
  deficit?: { what: 'don' | 'hand' | 'characters'; n: number };
  /** "If you have [X] and [Y] in your trash" */
  trashHasNames?: string[];
  /** "If there is a Character with N base power or more" */
  anyCharacterMinBasePower?: number;
  /** "If your opponent's Character has been K.O.'d during this turn" */
  opponentCharacterKOThisTurn?: boolean;
  /** "If you have 5 {X} type Characters with different card names" */
  distinctTyped?: { type: string; count: number };
  /** haveNamed: "… Characters with 6000 base power" */
  haveNamedBasePower?: number;
  /** "If the chosen Character has a cost equal to the number of DON!! cards given to it" */
  chosenCostEqualsDon?: boolean;
  /** "your opponent's Character attacks" ([On Your Opponent's Attack] só contra Personagens) */
  attackerCharacter?: boolean;
  /** "If that Character has the "Slash" attribute" (o atacante) */
  attackerAttribute?: string;
  /** "During the turn in which a card in your hand is trashed by an effect" */
  handTrashedThisTurn?: boolean;
  /** "your opponent has 5 or more rested cards" (cartas + DON!!) */
  opponentRestedCardsMin?: number;
  /** "If you have 8 or more rested cards" (cartas + DON!!) */
  ownRestedCardsMin?: number;
  /** "If your Leader is [A] or [B]" */
  leaderNames?: string[];
  /** "If you only have Characters without a Counter" */
  onlyCharactersWithoutCounter?: boolean;
  /** "If your Leader is active" */
  leaderActive?: boolean;
  /** "If your Leader's colors include blue" */
  leaderColor?: Color;
  /** "If your Leader has N power or less" */
  leaderMaxPower?: number;
  /** "If your opponent's Leader has N power or more" */
  opponentLeaderMinPower?: number;
  /** "If you and your opponent have a total of N or more Life cards" */
  totalLifeMin?: number;
  /** "If your opponent has N or less DON!! cards on their field" */
  opponentMaxDonOnField?: number;
  /** "If this Character is active" */
  selfActive?: boolean;
  /** "If your Leader's card name includes "X"" */
  leaderNameIncludes?: string;
  /** "If your Leader has N power or more" */
  leaderMinPower?: number;
  /** "If you have less Characters than your opponent" */
  fewerCharacters?: boolean;
  /** "If there are N or more Characters with a cost of N or more" (dos dois jogadores) */
  anyCharactersWithCost?: { count: number; cost: number };
  /** "If this Character is rested" */
  selfRested?: boolean;
  /** "If you have N or more DON!! cards on your field" */
  minDonOnField?: number;
  /** "if you have N or less cards in your hand" */
  handMax?: number;
  /** "If your Leader has the {X} type" */
  leaderHasType?: string;
  /** "If your Leader's type includes "CP"" / "has a type including "CP"" (CP9, CP0… contam) */
  leaderTypeIncludes?: string;
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
  leaderMonocolor?: boolean;
  leaderAttribute?: string;
  faceUpLifeMin?: number;
  anyCharacterMinPower?: number;
  /** Negação: vale quando a condição interna NÃO vale. */
  not?: Condition;
  /** "If this Leader battles your opponent's Character during this turn" */
  selfBattledCharacter?: boolean;
  maxActiveDon?: number;
  /** "you have [Satori] and [Hotori]" */
  haveNamed?: string[];
  /** "If the revealed card has the chosen cost" (passos chooseCost + revealOpponentTop) */
  revealedHasChosenCost?: boolean;
  ownMatchingMax?: { count: number; spec: TargetSpec };
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
  /** "If you have [X]" / "If you have a [X] Character" / "If you have [X] on your field" (Personagem ou Stage) */
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
  /** "the only Characters on your field are {X} type Characters" (e pelo menos um). */
  onlyTypedCharacters?: string;
  ownTypedCharacterMinPower?: { type: string; power: number };
  /** Cartas de Vida + mão, no máximo. */
  lifeHandMax?: number;
  totalCharacterCostMin?: number;
  /** "you have 2 or more Characters with 6000 base power" — contagem de cartas suas (ou do oponente) que atendem ao alvo. */
  ownMatching?: { count: number; spec: TargetSpec };
  opponentMatching?: { count: number; spec: TargetSpec };
  /** "you have 2 or more Characters with a cost of 8 or more" */
  charactersWithCost?: { count: number; cost: number };
  /** Você ativou neste turno um Evento com custo base a partir deste. */
  activatedEventMinCost?: number;
  /** O ataque atual é contra o Líder do oponente. */
  attackingLeader?: boolean;
  /** A partir deste número de turno da partida ("it is your second turn or later" = 3). */
  minTurn?: number;
  opponentLeaderAttribute?: string;
  /** "you have a Character with 7000 base power or more" */
  ownCharacterMinBasePower?: number;
  /** Basta uma das condições. */
  anyOf?: Condition[];
  /** "If your opponent has N or more cards in their hand" */
  opponentHandMin?: number;
  /** "If this Character has N power or more" */
  selfMinPower?: number;
  /** "If you have any DON!! cards given" */
  anyDonGiven?: boolean;
  /** "If this Character was played on this turn" */
  selfPlayedThisTurn?: boolean;
  /** "If you have N or more {X} type Characters" ("{X} or {Y}": `types` traz todos; `type` é o primeiro). */
  minTypedCharacters?: { count: number; type: string; types?: string[] };
  /** "If your opponent has N or more Life cards" */
  opponentLifeMin?: number;
  /** "If the revealed card / that card is …": testa a carta escolhida/revelada no passo anterior. */
  chosenMatches?: CardFilter;
  /** "If you do": o passo anterior afetou ao menos uma carta. */
  lastDone?: boolean;
  /** "If you have a {X} type Character with a cost of N or more" */
  ownTypedCharacterMinCost?: { type: string; cost: number };
  /** "If your opponent has a Character with a cost of N or more" */
  opponentCharacterMinCost?: number;
  /** "If your Leader has the {X} type or is [Y]" */
  leaderTypeOrName?: { type: string; name: string };
  /** "If you have no other [X] Characters" */
  noOtherNamed?: string;
  /** "If you have no other [X] with a base cost of N": só conta os [X] com esse custo impresso. */
  noOtherNamedBaseCost?: number;
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
  /** "If you have a total of N or more given DON!! cards" */
  minGivenDon?: number;
  /** "If your opponent has any DON!! cards given" */
  opponentAnyDonGiven?: boolean;
  /** "If you have N or more rested {X} type Characters" (type opcional) */
  minRestedDon?: number;
  minRestedTyped?: { count: number; types?: string[] };
}

export type AbilityCondition = Condition;
export type StepCondition = Condition;

/** Bônus contínuo para outras cartas do mesmo jogador ("your {Navy} type Characters gain +1000"). */
export type RestrictionKind =
  | 'noPlayCharacters'
  | 'noPlayFromHand'
  | 'noLifeToHand'
  | 'noAttackLeader'
  | 'noDrawByEffect'
  | 'noSetDonActiveByCharacter'
  /** "cannot activate [Blocker]": nenhum [Blocker] do jogador pode ser ativado. */
  | 'noBlocker';

export interface Restriction {
  /** Quem fica restrito: o controlador do efeito ("you cannot …") ou o oponente dele ("your opponent cannot …"). */
  player: PlayerId;
  kind: RestrictionKind;
  /** noPlayCharacters: só os de custo base a partir deste. */
  minCost?: number;
  /** Último turno em que vale (inclusive), como em `Modifier.untilTurn`; sem ele, só o turno em que foi criada. */
  untilTurn?: number;
}

export type LeaderRule =
  | { kind: 'donDeck'; size: number }
  | { kind: 'deckOutWin' }
  | { kind: 'deckOutEndOfTurn' }
  | { kind: 'donPhaseToLeader' }
  | { kind: 'playRested' }
  | { kind: 'faceUpLifeToDeck' }
  | { kind: 'counterBonus'; type: string; amount: number }
  | { kind: 'deckMaxCost'; cost: number; category?: 'event' }
  /** "you can only include {East Blue} type cards in your deck" */
  | { kind: 'deckOnlyType'; type: string }
  | { kind: 'startStage'; type: string }
  | { kind: 'ownOnPlayNegated' };

export interface Aura {
  kinds: Array<'leader' | 'character'>;
  hasAnyType?: string[];
  typeIncludes?: string;
  power: number;
  /** Afeta as cartas do oponente ("Give all of your opponent's Characters −5 cost"). */
  side?: 'own' | 'opponent';
  /** Custo em vez de poder. */
  cost?: number;
  /** Só cartas com um destes nomes ("All of your [Portgas.D.Ace] and [Monkey.D.Luffy] cards"). */
  names?: string[];
  /** Só cartas com custo atual a partir deste ("with a cost of 12 or more"; com `baseCost`, o impresso). */
  minCost?: number;
  /** Filtros pelos valores impressos (cor, poder base). */
  color?: Color;
  /** Só cartas com custo atual até este (com `baseCost`, o impresso). */
  maxCost?: number;
  /** "with a base cost of N or less": minCost/maxCost comparam o custo impresso. */
  baseCost?: boolean;
  minPower?: number;
  maxPower?: number;
  /** "cannot be K.O.'d by effects" (`true`) ou "… by your opponent's effects" (`'opponent'`). */
  noEffectKO?: true | 'opponent';
  /** Só cartas viradas (`true`) ou só ativas (`false`): "your active Characters with a base cost of 5" (OP04-119). */
  rested?: boolean;
  excludeName?: string;
  /** Concede uma palavra-chave em vez de poder ("All of your Characters with a cost of 12 or more gain [Blocker]"). */
  keyword?: Keyword;
  /** "cannot be removed from the field by your opponent's effects" */
  noRemoval?: boolean;
  /** "other than this Character" */
  excludeSelf?: boolean;
  /** "… base power becomes N" (poder base em vez de bônus) */
  basePower?: number;
  /** "base power becomes the same as your Leader's base power" */
  basePowerCopyLeader?: boolean;
  /** "cannot be K.O.'d in battle" */
  noBattleKO?: boolean;
  /** "have their effects negated" */
  negate?: boolean;
  /** "that do not have a type including "X"" */
  notTypeIncludes?: string;
  /** "cannot attack" */
  cannotAttack?: boolean;
  /** Vale para as cartas dos dois jogadores. */
  bothSides?: boolean;
  /** "with a [Trigger]" */
  hasTrigger?: boolean;
  /** Custo exato / mínimo além de maxCost */
  exactCosts?: number[];
  /** "with both the {A} and {B} types": todos estes tipos. */
  hasAllTypes?: string[];
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

/** Efeito de substituição: protege 'self' ou Personagens seus que batem com `spec`. */
export interface Replacement {
  who: 'self' | TargetSpec;
  /**
   * ko = só K.O.; removal = sair do campo (K.O. incluído; "by your opponent's effect" restringe a causa);
   * koOrRemoval = os dois ("would be K.O.'d or removed from the field", "would leave the field");
   * damage = "If you would take damage": o dono da carta sofreria dano.
   */
  event: 'ko' | 'removal' | 'koOrRemoval' | 'rest' | 'damage';
  /**
   * Causa: any = qualquer uma (inclusive efeito próprio e, na remoção, K.O. em batalha); battle = em batalha;
   * effect = por efeito; opponentEffect = por efeito do oponente; opponent = "by your opponent" (sem "'s effect"):
   * qualquer causa do oponente, K.O. em batalha e efeitos dele (K.O., descarte, mão, deck…), menos efeito próprio.
   */
  by: 'any' | 'battle' | 'effect' | 'opponentEffect' | 'opponent';
  /** Em `koOrRemoval`, causa só da parte da remoção, quando difere de `by` ("removed … by your opponent's effect or K.O.'d"). */
  removalBy?: 'any' | 'battle' | 'effect' | 'opponentEffect' | 'opponent';
}

/** Remoção do campo em andamento (passos internos `replaceRemoval` e `removeFromField`). */
export interface RemovalStep {
  victims: string[];
  action: 'ko' | 'hand' | 'deckBottom' | 'trash' | 'life';
  inBattle?: boolean;
  /** Jogador cujo efeito remove (ausente em batalha). */
  byPlayer?: PlayerId;
  /** Carta cujo efeito remove (proteções "cannot be K.O.'d by …"). */
  by?: string;
  /** Vida: no fundo em vez do topo. */
  bottom?: boolean;
  /** Vida: virada para cima (pública, 3-10-2-1). */
  faceUp?: boolean;
  /** Substituições já oferecidas (recusadas ou aplicadas) para estas remoções: `uid:índice` ou `temp:índice`. */
  skip?: string[];
}

/** Acontecimentos a que uma carta pode reagir ("When a DON!! card on your field is returned…"). */
export type GameEvent =
  | { kind: 'donReturned'; min?: number; byYourEffect?: true } // DON!! do seu campo voltou ao deck de DON!! ("2 or more", "by your effect")
  | {
      kind: 'characterPlayed';
      who: 'self' | 'opponent';
      filter?: CardFilter;
      from?: 'trash';
      byEffect?: boolean;
      /** "… using a Character's effect" */
      byCharacterEffect?: true;
      /** "When you play a Character … from your hand" */
      fromHand?: true;
    }
  | { kind: 'lifeRemoved'; whose: 'any' | 'own' | 'opponent' } // "a card is removed from your (or your opponent's) Life cards"
  | { kind: 'lifeZero' } // "When your number of Life cards becomes 0"
  | { kind: 'restedByEffect' } // "If a Character is rested by your effect"
  /** "When a card is trashed from your hand by your {Navy} type card's effect" */
  | { kind: 'handTrashedByEffect'; sourceType?: string }
  | { kind: 'donGiven' } // "When this Leader or 1 of your Characters is given a DON!! card"
  | { kind: 'damageTaken' } // "When you take damage"
  | { kind: 'anyOf'; events: GameEvent[] }
  /** Personagem saiu do campo por efeito (byWho) — com orKO, também nocauteado em batalha. */
  | { kind: 'characterRemoved'; whose: 'any' | 'own' | 'opponent'; by: 'self' | 'opponent' | 'any'; filter?: CardFilter; orKO?: boolean }
  | { kind: 'characterKO'; whose: 'any' | 'own' | 'opponent'; filter?: CardFilter }
  | { kind: 'eventActivated'; who: 'self' | 'opponent' }
  | { kind: 'blockerActivated'; who: 'self' | 'opponent' }
  | { kind: 'selfRested'; byOpponent?: boolean; byCharacter?: boolean } // "When this Character becomes rested"
  | { kind: 'attackDamage' } // "When this Character's attack deals damage to your opponent's Life"
  | { kind: 'battleKO' } // "When this Character battles and K.O.'s your opponent's Character"
  | { kind: 'triggerActivated'; who: 'any' | 'opponent' } // "When a [Trigger] activates"
  | { kind: 'drawByEffect' } // "When you draw a card outside of your Draw Phase"
  | { kind: 'damageDealt' } // "When you deal damage to your opponent's Life"
  | { kind: 'leaderBattle'; filter?: CardFilter } // "When your Leader … attacks or is attacked"
  | { kind: 'lifeToHand' } // "When a card is added to your hand from your Life"
  | { kind: 'returnedToHand'; whose: 'opponent'; by: 'self' }; // "When your opponent's Character is returned to the owner's hand by your effect"

type EffectStepBody =
  | { do: 'power'; target: TargetRef; amount: number; duration: Duration; per?: TargetSpec }
  | { do: 'ko'; target: TargetRef }
  | { do: 'rest'; target: TargetRef }
  | { do: 'setActive'; target: TargetRef }
  | { do: 'giveRestedDon'; target: TargetRef; count: number; fromOpponent?: boolean; anyState?: boolean }
  /** "Draw N cards"; com `upTo` ("draw up to N cards", 4-5-4), uma por vez, podendo parar antes de cada uma. */
  | { do: 'draw'; count: number; upTo?: true }
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
  | { do: 'playThis'; rested?: boolean }
  | { do: 'revealedToHand'; filter?: CardFilter }
  | { do: 'lookOpponentTop' }
  | { do: 'activateEventFromHand'; filter: CardFilter }
  | { do: 'revealLifeTop' }
  | { do: 'koSelf' }
  /** "Give up to 2 total of your currently given DON!! cards to 1 of your Characters" */
  | { do: 'moveGivenDon'; count: number; target: TargetRef }
  /** "Select up to 1 X card from your hand and play it or add it to the top of your Life cards face-up" */
  | { do: 'handPlayOrLife'; filter: CardFilter; from?: 'trash' }
  /** "Draw a card for each of your {X} type Characters" (eventCount = cartas compradas) */
  | { do: 'drawPerMatching'; spec: TargetSpec }
  /** "Your Leader gains +1000 power for each of your Characters during this turn" (conta ao resolver). */
  | { do: 'powerPerMatching'; target: TargetRef; amount: number; spec: TargetSpec; duration: Duration }
  /** "trash the same number of cards from your hand" / "from the top of your deck" (usa eventCount) */
  | { do: 'trashEventCount'; from: 'hand' | 'deck' }
  /** "Your opponent chooses 1 card from your hand; trash that card" */
  | { do: 'opponentPicksFromHand'; count: number }
  /** "Choose 1 card from your opponent's hand; your opponent reveals that card" (ao acaso) */
  | { do: 'revealOpponentHand'; count: number }
  /** "place up to 1 card from your opponent's Life area at the bottom of the owner's deck" */
  | { do: 'opponentLifeToBottom'; count: number }
  /** "you may K.O./return/place any number of … . +N power for every …" */
  | {
      do: 'anyNumberForPower';
      source: 'field' | 'trash';
      action: 'ko' | 'hand' | 'bottom';
      spec?: TargetSpec;
      filter?: CardFilter;
      power: number;
      every: number;
      target: TargetRef;
      duration: Duration;
    }
  /** "up to 1 of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase" */
  | { do: 'skipRefreshDon'; count: number }
  | { do: 'winGame' }
  | { do: 'extraTurn' }
  /** "Your opponent may trash N … . If they do not, …" */
  | { do: 'opponentMay'; pay: 'lifeTrash' | 'discard' | 'returnDon'; count: number; otherwise: EffectStep[] }
  /** "your opponent plays up to 1 Character card … from their hand" */
  | { do: 'opponentPlays'; upTo: number; filter: CardFilter }
  /** "your opponent may add 1 DON!! card from their DON!! deck and set it as active" */
  | { do: 'opponentAddDon'; count: number }
  /** "return DON!! cards … until you have the same number of DON!! cards on your field as your opponent" */
  | { do: 'donMatchOpponent' }
  /** "give all of your opponent's Characters -1000 power … for every DON!! card given to that Character" */
  | { do: 'powerPerDon'; target: TargetRef; amount: number; duration: Duration }
  /** "This Character gains +1000 power during this turn per 1 cost on the revealed card" */
  | { do: 'powerPerRevealedCost'; target: TargetRef; amount: number; duration: Duration }
  /** "… gains the "Slash" attribute during this turn" */
  | { do: 'gainAttribute'; target: TargetRef; attribute: string; duration: Duration }
  /** "activate the [Main] effect of up to 1 Event card … in your trash" */
  | { do: 'activateEventFromTrash'; filter: CardFilter }
  /** "If any of your Characters would be K.O.'d in battle during this turn, you may trash 1 card from your hand instead." */
  | { do: 'tempReplace'; by: 'battle' | 'any'; cost: AbilityCost }
  /** "If this Character would be rested by your opponent's Character's effect, you may … instead." */
  | { do: 'replaceRest'; victim: string; ability: number; byPlayer: PlayerId }
  /** "none of the selected Characters can attack unless your opponent trashes 2 cards from their hand whenever they attack" */
  | { do: 'attackTax'; target: TargetRef; count: number; duration: Duration }
  /**
   * "Return all cards in your hand to your deck and shuffle your deck" (eventCount = cartas devolvidas);
   * `bottom`: "place all cards in your hand at the bottom of your deck in any order", sem embaralhar.
   */
  | { do: 'handAllToDeck'; who: 'self' | 'opponent'; bottom?: boolean }
  | { do: 'opponentDraws'; count: number }
  /** "trash all cards from your hand" */
  | { do: 'trashHand' }
  /** "Your opponent returns 1 of their Characters to the owner's hand" (o oponente escolhe). */
  | { do: 'opponentChoosesOwn'; count: number; spec: TargetSpec; action: 'hand' | 'bottom' }
  /** "you take 1 damage" / "deal 1 damage to your opponent" */
  | { do: 'takeDamage'; count: number; opponent?: boolean }
  /** "trash cards from the top of your Life cards until you have N Life card" */
  | { do: 'lifeTrashUntil'; count: number }
  /** "Trash cards from your hand until you have N cards in your hand" (both: os dois jogadores). */
  | { do: 'trashHandUntil'; count: number; both?: boolean }
  /** "Your opponent's [On Play] effects are negated until …" */
  | { do: 'negateOnPlay'; who: 'opponent' | 'self'; duration: Duration }
  | { do: 'cannotAttackCharacters'; maxBaseCost: number; duration: Duration }
  | { do: 'drawEventCount'; returned?: boolean }
  | { do: 'restDonForPower'; power: number; target: TargetRef }
  | { do: 'payEither'; options: AbilityCost[] }
  | { do: 'swapBasePower'; spec: TargetSpec; duration: Duration; withLeader?: boolean }
  | { do: 'trashFaceUpLife' }
  | { do: 'lastToDeckTop' }
  | { do: 'revealedToTopOrBottom' }
  | { do: 'lifeOneToDeckTop' }
  | { do: 'cannotBlock'; target: TargetRef; duration: Duration }
  | { do: 'returnGivenDon'; count: number }
  | { do: 'chooseCost' }
  /** chooser 'self': "Place up to 1 card from your opponent's trash at the bottom of the owner's deck" (você escolhe). */
  | { do: 'opponentTrashToBottom'; count: number; upTo?: boolean; chooser?: 'self'; filter?: CardFilter }
  | { do: 'arrangeLife'; whose: 'own' | 'opponent' }
  /** "Rest up to 1 of your opponent's DON!! cards or Characters with a cost of 3 or less" */
  /** 1 carta do oponente ou 1 DON!! dele ("your opponent's cards" inclui DON!!): vira, ou (`skipRefresh`) uma já virada não desvira. */
  | { do: 'restDonOrCharacter'; spec: TargetSpec; skipRefresh?: true }
  | { do: 'revealOpponentTop' }
  | { do: 'giveActiveDon'; count: number; target: TargetRef }
  | { do: 'ownToBottom'; count: number; spec: TargetSpec; toLife?: boolean }
  | { do: 'negate'; target: TargetRef; duration: Duration }
  /**
   * "You cannot … during this turn". `opponent`: quem fica restrito é o oponente ("your opponent
   * cannot …"). `duration`: 'nextOpponentTurn' = "until the end of your opponent's next turn"; sem
   * ela, até o fim deste turno.
   */
  | { do: 'restrict'; kind: RestrictionKind; minCost?: number; opponent?: true; duration?: 'nextOpponentTurn' }
  | { do: 'nextPlayDiscount'; filter: CardFilter; amount: number }
  /** "base power becomes N" ou "the same as your opponent's Leader('s power)" */
  | { do: 'basePower'; target: TargetRef; amount?: number; copy?: 'opponentLeader' | 'chosen' | 'attacker'; duration: Duration }
  /** «Set Power to 0» (4-12): −(poder atual na ativação), nada se já é 0 ou negativo. */
  | { do: 'setPowerZero'; target: TargetRef; duration: Duration }
  | {
      do: 'trashAnyForPower';
      categories?: Array<'event' | 'stage' | 'character'>;
      filter?: CardFilter;
      power: number;
      duration: Duration;
      target?: TargetRef;
    }
  /** "Change the attack target to your Leader or 1 of your … Characters" */
  | { do: 'redirectAttack'; spec: TargetSpec; toChosen?: boolean; noLeader?: boolean }
  | { do: 'handToDeck'; count: number; where: 'top' | 'bottom' | 'choose' }
  /** Descartar cartas da mão (custo "You may trash N card from your hand"). */
  | { do: 'trashFromHand'; count: number; filter?: CardFilter; upTo?: boolean }
  /** "Draw cards so that you have N cards in your hand." */
  | { do: 'drawUntil'; count: number }
  /** "Your opponent returns N DON!! cards from their field to their DON!! deck." */
  | { do: 'opponentReturnsDon'; count: number; activeOnly?: boolean }
  /** "Set up to N of your DON!! cards as active." */
  | { do: 'setDonActive'; count: number }
  /** "Look at N cards from the top of your deck; reveal up to M … and add it to your hand. Then, place the rest…" */
  | { do: 'search'; look: number; upTo: number; filter: CardFilter; rest: 'bottom' | 'trash' | 'topOrBottom'; play?: boolean; toLife?: boolean; lifeFaceDown?: boolean; rested?: boolean; toTrash?: boolean }
  /** "Reveal up to 1 [X] from your deck and add it to your hand." (procura no deck inteiro) */
  | { do: 'tutor'; upTo: number; filter: CardFilter }
  /** "add 1 card from the top or bottom of your Life cards to your hand" (choose = o jogador escolhe topo/fundo) */
  | { do: 'lifeToHand'; count: number; choose?: boolean }
  /** "add up to 1 card from your hand to the top of your Life cards" */
  /** `choose`: "to the top or bottom of your Life cards" (o jogador escolhe a posição). */
  | { do: 'handToLife'; upTo: number; filter?: CardFilter; faceUp?: boolean; fromTrash?: boolean; trashOnly?: boolean; choose?: boolean }
  /** "Add up to 1 of your Characters … to the top of the owner's Life cards [face-up]" (`faceUp`: virada para cima, pública) */
  | { do: 'fieldToLife'; target: TargetRef; choose?: boolean; faceUp?: boolean }
  /** "Look at up to 1 card from the top of your or your opponent's Life cards, and place it at the top or bottom" */
  | { do: 'peekLife'; whose: 'either' | 'own' | 'opponent' }
  /** "Choose one: • … • …" / "Your opponent chooses one: …" */
  | { do: 'chooseOne'; chooser: 'self' | 'opponent'; options: EffectStep[][]; labels: string[] }
  /** Custos com escolha (ver AbilityCost): */
  | { do: 'restOwn'; count: number; spec: TargetSpec; withDon?: true }
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
  | { do: 'playRevealed'; filter?: CardFilter; rested?: boolean; /** "play up to 1 …": pergunta antes. */ upTo?: true }
  /** "place the revealed card at the bottom of your deck" */
  | { do: 'revealedToBottom' }
  /** "… cannot be rested until the end of your opponent's next turn" */
  | { do: 'cannotBeRested'; target: TargetRef; duration: Duration }
  /** "add up to N card from the top of your opponent's Life cards to the owner's hand" */
  | { do: 'opponentLifeToHand'; count: number; upTo?: true }
  /** "your opponent places N card from their hand at the bottom of their deck" */
  | { do: 'opponentHandToBottom'; count: number }
  /**
   * Pergunta do efeito de substituição (o motor cria; não vem do texto). `victims` sairiam do campo
   * juntos; `covered` são os que esta substituição salva com um só pagamento (8-1-3-4).
   */
  | ({
      do: 'replaceRemoval';
      covered: string[];
      ability: number;
      /** Identifica esta substituição em `skip` (`uid:índice` ou `temp:índice`). */
      key: string;
      /** Substituição criada por efeito (sem habilidade na carta): o custo vem aqui. */
      inlineCost?: AbilityCost;
    } & RemovalStep)
  /** Continua a remoção depois de uma substituição: oferece as que faltam ou tira do campo (o motor cria). */
  | ({ do: 'removeFromField' } & RemovalStep)
  /** Pergunta da substituição de dano ("If you would take damage, you may … instead"). */
  | { do: 'replaceDamage'; ability: number }
  /** "… at the end of this turn": passos adiados para o fim do turno. */
  | { do: 'delayed'; steps: EffectStep[]; when?: 'battle'; keepChosen?: boolean }
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
  | {
      do: 'playFrom';
      from: 'deck' | 'hand' | 'trash' | 'handOrTrash';
      upTo: number;
      filter: CardFilter;
      rested?: boolean;
      notColorOfLast?: boolean;
      /** Custo ("You may play 1 [Kotori] from your hand:"): tem de jogar 1 carta que sirva. */
      required?: boolean;
    }
  /** "… then shuffle your deck." */
  | { do: 'shuffleDeck' }
  /** "Look at N cards from the top of your deck and return them to the top or bottom of the deck in any order." */
  | { do: 'arrangeTop'; look: number; topOnly?: boolean }
  /**
   * Custo opcional no meio de um efeito automático ("[On Play] DON!! −1: …", "You may trash 1 card from your
   * hand: …"). O jogador decide se paga; se não pagar (ou não puder), o resto do efeito não acontece.
   * `ability`: índice da habilidade [Once Per Turn] dona do custo; recusar (ou não poder pagar) devolve o uso do turno.
   */
  | { do: 'payCost'; cost: AbilityCost; scope?: number; ability?: number }
  /** Custo "DON!! −N ou mais": pergunta quantos DON!! devolver (no mínimo `min`) e devolve. */
  | { do: 'returnDonChoice'; min: number }
  /**
   * Devolve `count` DON!! ao deck de DON!! (DON!! −X, CR 10-2-10-1). O dono escolhe de onde, um por
   * vez: área de custo (ativos ou virados), Líder, Personagens ou Stage. Sem escolha quando só há
   * uma origem ou quando todos os DON!! do campo vão. `opponent`: os DON!! são do oponente, que escolhe.
   */
  | { do: 'returnDon'; count: number; opponent?: true; activeOnly?: true }
  /** "Trash up to N of your opponent's Life cards." (do topo) */
  | { do: 'trashLife'; side: 'own' | 'opponent'; count: number; upTo?: true }
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
  | { do: 'addLifeFromDeck'; count: number; upTo?: true }
  /** "… cannot be K.O.'d during this turn" (só Personagens; inBattle = apenas em batalha). */
  | { do: 'cannotBeKO'; target: TargetRef; duration: Duration; inBattle?: boolean; byEffect?: true | 'opponent' };

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
  | 'endOfOpponentTurn' // [End of Your Opponent's Turn] (6-6-1-1-2)
  | 'battlesCharacter' // "If this Character battles your opponent's Character" (ao fim da batalha)
  | 'event' // "When …": reação a um acontecimento (Ability.event)
  | 'onOpponentAttack' // [On Your Opponent's Attack]
  | 'replace' // "If … would be K.O.'d / removed from the field, you may … instead" (Ability.replace + cost)
  | 'startOfTurn' // "This effect can be activated at the start of your turn"
  | 'startOfOpponentTurn' // "… at the start of your opponent's turn" (6-2-2)
  | 'startOfMainPhase' // "… at the start of your Main Phase" (6-5-1)
  | 'static'; // efeito contínuo

export interface AbilityCost {
  restSelf?: boolean; // "You may rest this Character/Stage"
  koSelf?: boolean; // "K.O. this Character" (custo de substituição)
  leaderPowerMinus?: number; // "give your 1 active Leader −5000 power during this turn"
  giveDon?: { count: number; spec: TargetSpec }; // "give 1 active DON!! card to 1 of your [X]"
  ownToBottom?: { count: number; spec: TargetSpec }; // "place 1 of your Characters at the bottom of the owner's deck"
  ownToLife?: { count: number; spec: TargetSpec }; // "add 1 of your Characters … to the top of your Life cards face-up"
  either?: AbilityCost[]; // "trash 1 card from your hand or rest 1 of your DON!! cards"
  victimPowerMinus?: number;
  returnGivenDon?: number; // "return 2 total of your currently given DON!! cards to your cost area rested" // substituição: "give that Character −1000 power during this turn instead"
  restDon?: number; // ① ② ③ ... (virar DON!! ativos da área de custo)
  donMinus?: number; // DON!! −X (devolver DON!! ao deck de DON!!)
  /** "You may return 1 or more DON!! cards …": o jogador escolhe quantos devolver (no mínimo `donMinus`). */
  donMinusOpen?: boolean;
  /** "You may return N of your active DON!! cards to your DON!! deck": só DON!! ativos da área de custo. */
  donMinusActive?: boolean;
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
  /** `withDon`: "rest N of your cards" (qualquer carta sua no campo, DON!! ativos incluídos). */
  restOwn?: { count: number; spec: TargetSpec; withDon?: true };
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
  /** "you may rest 1 of your opponent's Characters instead" */
  restOpponentChars?: number;
  /** "give this Character −2000 power during this turn" */
  selfPowerMinus?: number;
  /** "return 20 cards from your trash to your deck and shuffle it" */
  trashToDeck?: number;
  /** "play 1 [Kotori] from your hand" */
  playFromHand?: CardFilter;
  /** "give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters" */
  giveOppDon?: number;
  /** "place 1 card from your hand at the top of your deck" */
  handToTop?: number;
  /** "trash this Character with a cost of 20 or more": exige este custo mínimo da carta. */
  selfMinCost?: number;
  /** "rest your Leader or 1 [Corrida Coliseum]": substituição que vira a carta escolhida (ver either). */
  victimToLife?: boolean;
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
  /** "This Character cannot be removed from the field by your opponent's effects." */
  staticNoRemoval?: boolean;
  /** "give this card in your hand −N cost" (vale na mão, com a condição da habilidade) */
  handCost?: number;
  /** Regra especial do Líder (texto "according to the rules" / "Under the rules of this game"). */
  rule?: LeaderRule;
  staticPower?: number;
  staticKeyword?: Keyword;
  staticCanAttackActive?: boolean;
  /** "This Character cannot be K.O.'d in battle." */
  staticNoBattleKO?: boolean;
  /** "This Character cannot be K.O.'d by effects." (`true`) ou "… by your opponent's effects" (`'opponent'`). */
  staticNoEffectKO?: true | 'opponent';
  /** "This Leader cannot attack." */
  staticCannotAttack?: boolean;
  /** "This Character cannot be K.O.'d in battle by "Strike" attribute Characters." */
  noBattleKOVsAttribute?: string;
  /** "… by "Strike" attribute Characters" (OP01-024): só Personagens; o Líder com o atributo ainda nocauteia. */
  noBattleKOVsAttributeCharacters?: true;
  /** "This Character cannot be K.O.'d in battle by Leaders." */
  noBattleKOByLeader?: boolean;
  /** "This Character cannot be K.O.'d in battle by Characters without the "Special" attribute." */
  noBattleKOUnlessAttribute?: string;
  /** "This Character gains +N cost." */
  staticCost?: number;
  /** "this Character's base power becomes 9000" / "… the same as your Leader's base power" */
  staticBasePower?: number | 'leader';
  /** "this Character gains +N cost for every M cards in your trash" (N pode ser negativo) */
  costPer?: { cost: number; every: number; what: 'trash' };
  /** [On K.O.] só quando nocauteado por efeito (do oponente). */
  koBy?: 'effect' | 'opponentEffect';
  /** "If this Character is rested, your opponent cannot attack any card other than this Character." */
  staticTaunt?: boolean;
  /** "This card in your hand cannot be played by effects." */
  noPlayByEffect?: boolean;
  /** "This Character cannot attack a Leader on the turn in which it is played." */
  noLeaderAttackOnPlayTurn?: boolean;
  /** "cannot be K.O.'d by effects of Characters without the "Special" attribute" */
  noEffectKOUnlessAttribute?: string;
  /** "cannot be K.O.'d by effects of your opponent's Characters with 5000 base power or less" */
  noEffectKOByMaxBasePower?: number;
  /** "This Character cannot be rested by your opponent's effects." */
  staticNoRest?: boolean;
  /** Counter das suas cartas na mão: "+1000 Counter" para as sem Counter, ou "becomes +2000" (set). */
  handCounter?: { filter: CardFilter; amount: number; set?: boolean; withoutCounter?: boolean };
  /** "this card in your hand has a +2000 Counter" (com a condição da habilidade) */
  selfHandCounter?: number;
  /** "all Characters with a cost of 5 or less do not become active in your and your opponent's Refresh Phases" */
  noRefreshMaxCost?: number;
  /** "Give blue Events in your hand -1 cost", "The cost of playing … will be reduced by 1" */
  handCostAura?: { filter: CardFilter; amount: number };
  /** "This Character gains +N power for every M <coisas>" */
  powerPer?: { power: number; every: number; what: 'hand' | 'restedDon' | 'trash' | 'trashEvents' | 'distinctCharacters' };
  /** "When this Character battles {attribute} attribute Characters, this Character gains +N power". */
  battleVsAttribute?: { attribute: string; power: number };
  /** Para timing 'event': o acontecimento que dispara a habilidade. */
  event?: GameEvent;
  /** Para timing 'replace': o que é substituído. */
  replace?: Replacement;
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
  /**
   * DON!! "soltos": anexados neste turno e ainda não usados (ver `detachDon`). Qualquer
   * ação que possa ter contado com eles (ataque, habilidade, carta jogada, fim do turno…)
   * zera o contador de todas as cartas do jogador.
   */
  donLoose?: number;
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
    | 'cannotBeKOByEffect'
    | 'cannotBeKOByOpponentEffect'
    | 'canAttackActive'
    | 'cannotAttack'
    | 'skipRefresh'
    | 'cannotBeRested'
    | 'negated' // "Negate the effect of …"
    | 'basePower' // "base power becomes N" (amount = novo poder base)
  | 'cannotAttackCharMaxCost' // "cannot attack your opponent's Characters with a base cost of N or less"
    | 'cannotBlock' // "cannot activate [Blocker]"
    | 'attribute' // "gains the "Slash" attribute" (keyword = atributo)
    | 'attackTax'; // "cannot attack unless your opponent trashes N cards"
  amount: number;
  /** Para 'nextOpponentTurn': o efeito acaba no fim deste turno. */
  untilTurn?: number;
  keyword?: Keyword;
  /** kind 'attribute': o atributo ganho. */
  attribute?: string;
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
  /** Os efeitos de fim de batalha já foram disparados (a batalha espera eles resolverem para terminar). */
  endFired?: boolean;
  /** "at the end of this battle, …" */
  after?: Array<{ controller: PlayerId; source: string; steps: EffectStep[]; last?: string[] }>;
}

/** De onde sai um DON!! do campo: área de custo (ativo ou virado) ou a carta (uid) a que está dado. */
export type DonSource = 'active' | 'rested' | (string & {});

/** Escolhas que o motor aguarda de um jogador. */
export type Pending =
  /** O vencedor do sorteio escolhe se joga primeiro (`answer` yes) ou segundo (no). */
  | { kind: 'chooseFirst'; player: PlayerId }
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
      /**
       * Todas as cartas olhadas, na ordem (ex.: topo do deck numa busca). As que não
       * estão em `options` aparecem desabilitadas, para o jogador saber o que vai para o fundo.
       */
      shown?: string[];
      /**
       * As opções vêm de uma zona escondida do dono (mão, deck). A escolha abre mesmo sem
       * opção (`options` vazio, só `choose []` é legal): pular contaria ao oponente o que
       * há (ou não há) na mão ou no deck.
       */
      hidden?: true;
    }
  | { kind: 'block'; player: PlayerId; options: string[] }
  /**
   * Etapa de Counter do defensor. Abre sempre, mesmo sem carta de Counter na mão
   * (`options` vazio): pular a etapa contaria ao atacante que a mão não tem Counter.
   */
  | { kind: 'counter'; player: PlayerId; options: string[] }
  /**
   * Carta que saiu da Vida, mostrada só ao dono. `answer` yes ativa o [Trigger] (só
   * vale quando a carta tem um); no coloca a carta na mão. Abre para toda carta de
   * Vida, com ou sem [Trigger], para o oponente não descobrir qual era o caso.
   */
  | { kind: 'lifeCard'; player: PlayerId; card: string }
  /**
   * Pergunta sim/não (ex.: pagar um custo opcional). Responder com `answer`. Com `cannot`,
   * só o "não" é legal: o custo lê a mão e não pode ser pago, mas a pergunta abre mesmo
   * assim, para o oponente não deduzir a mão pelo pulo. Só o dono vê `cannot`. Com `drawUpTo`,
   * é o "comprar mais 1?" do "draw up to N cards" (4-5-4): sim compra 1, não para.
   */
  | { kind: 'confirm'; player: PlayerId; source: string; prompt: string; cannot?: true; drawUpTo?: true }
  /**
   * Escolha entre opções com texto (modo "Choose one", topo/fundo...). Responder com `option`.
   * Com `order`, é a escolha de qual efeito disparado resolve primeiro: cada opção é o
   * `TriggeredEffect.id` correspondente. Com `don`, é a escolha de qual DON!! devolver ao deck
   * de DON!!: cada opção é a origem correspondente.
   */
  | { kind: 'option'; player: PlayerId; source: string; prompt: string; options: string[]; order?: number[]; don?: DonSource[] }
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
      /** Custo escolhido em "Choose a cost". */
      chosenCost?: number;
      /** Quantidade do acontecimento que disparou o efeito (ex.: cartas descartadas). */
      eventCount?: number;
      /** Carta revelada do topo do deck ("place the revealed card …" depois de outras escolhas). */
      revealed?: string[];
      /** Cartas descartadas da mão neste efeito ("the same card name as the trashed card"). */
      trashed?: string[];
      /**
       * Efeito de [Trigger]: a carta (`source`) fica fora de qualquer área enquanto ele resolve
       * (`GameState.limbo`) e vai para o descarte quando o frame termina, se o efeito não a moveu
       * (10-1-5-3).
       */
      trigger?: true;
    }
  | { kind: 'battle' }
  | {
      kind: 'damage';
      defender: PlayerId;
      remaining: number;
      banish: boolean;
      /** Dano de ataque: a vitória por 0 de Vida só é decidida antes do 1º ponto (7-1-4-1-1-1). */
      attack?: boolean;
      lifeCard?: string;
      answered?: boolean;
      lost?: number;
      /** A substituição de dano já foi oferecida para este dano. */
      replaceAsked?: boolean;
    }
  | {
      kind: 'play';
      uid: string;
      replaceChoice?: string[];
      rested?: boolean;
      from?: 'trash';
      byEffect?: boolean;
      /** Jogado da mão (pela regra ou por efeito). */
      fromHand?: boolean;
      /** Jogado pelo efeito de um Personagem. */
      byCharacterEffect?: boolean;
    }
  /**
   * Fecha o turno depois que os efeitos de [End of Your Turn]/[End of Your Opponent's Turn] e os
   * "at the end of this turn" (inclusive os criados na própria End Phase) resolverem (6-6-1).
   */
  | { kind: 'endTurn' }
  /**
   * Continua o Refresh Phase (devolver DON!!, desvirar), o Draw e o DON!! Phase depois que os
   * efeitos "at the start of your/your opponent's turn" resolverem (6-2-2).
   */
  | { kind: 'refresh' }
  /** Fecha a preparação depois dos efeitos "at the start of the game" (5-2-1-5): mãos e mulligan. */
  | { kind: 'startGame' };

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
  /**
   * Texto com cartas que só `player` pode ver. Os outros jogadores (no online)
   * recebem `text`, sem os nomes das cartas.
   */
  secret?: string;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  /** Estado do RNG de 128 bits (partidas online); ausente = mulberry32 com `rng`. */
  rng128?: [number, number, number, number];
  turn: number; // 1 = primeiro turno do primeiro jogador
  firstPlayer: PlayerId;
  /** Quem venceu o sorteio e escolhe se joga primeiro ou segundo (só com `GameConfig.chooseFirst`). */
  rollWinner?: PlayerId;
  activePlayer: PlayerId;
  phase: 'mulligan' | 'main' | 'gameover';
  players: [PlayerState, PlayerState];
  cards: Record<string, CardInstance>;
  defs: Record<string, CardDef>;
  battle: BattleState | null;
  stack: Frame[];
  /**
   * Efeitos automáticos já disparados que ainda não foram para a pilha (CR 8-6). Esperam
   * não haver efeito nem dano em resolução; depois resolvem um de cada vez, em ordem de
   * disparo, primeiro os do jogador do turno.
   */
  triggered?: TriggeredEffect[];
  /** Lote atual de `triggered` (sobe a cada efeito disparado que ativa). */
  triggerBatch?: number;
  /** Último `TriggeredEffect.id` usado. */
  triggerSeq?: number;
  /**
   * Cartas fora de qualquer área: a carta do [Trigger] enquanto ele resolve (10-1-5-3). Não está
   * na Vida nem no descarte (não conta para "cards in your trash", não sai "from your trash");
   * é pública (foi revelada) e vai para o descarte no fim do efeito, se ele não a moveu.
   */
  limbo?: string[];
  pending: Pending | null;
  modifiers: Modifier[];
  usedThisTurn: string[];
  /** Restrições a um jogador ("you cannot play Character cards during this turn", "your opponent cannot …"). */
  restrictions?: Restriction[];
  /** "The next time you play X from your hand during this turn, the cost will be reduced by N." */
  costReductions?: Array<{ player: PlayerId; filter: CardFilter; amount: number }>;
  /** "[On Play] effects are negated" até o turno indicado (inclusive). */
  onPlayNegated?: Array<{ player: PlayerId; untilTurn: number }>;
  /** Cartas que batalharam com um Personagem do oponente neste turno. */
  battledCharacter?: string[];
  /** Eventos ativados neste turno (custo base), para "if you have activated an Event … during this turn". */
  eventsThisTurn?: Array<{ player: PlayerId; cost: number }>;
  /** Efeitos adiados para o fim do turno ("at the end of this turn"). */
  delayed?: Array<{ controller: PlayerId; source: string; steps: EffectStep[]; last?: string[] }>;
  /** Jogadores que tiveram Personagens nocauteados neste turno. */
  koThisTurn?: PlayerId[];
  /** Jogadores que descartaram da mão por efeito neste turno. */
  handTrashedThisTurn?: PlayerId[];
  /** "take an extra turn after this one" */
  extraTurn?: PlayerId;
  /** Substituições criadas por efeitos até o fim do turno. */
  tempReplacements?: Array<{ player: PlayerId; source: string; by: 'battle' | 'any'; cost: AbilityCost }>;
  /** DON!! que não ficam ativos na próxima Renovação do jogador. */
  donSkipRefresh?: Array<{ player: PlayerId; count: number }>;
  /** Vencedor. Com `phase` 'gameover', null é empate (derrota simultânea, 9-2-1; laço infinito, 11-1). */
  winner: PlayerId | null;
  winReason: string | null;
  /** Partida criada com `GameConfig.legacySetup` (replays até a versão 8). */
  legacySetup?: true;
  log: LogEntry[];
  actionCount: number;
  /**
   * Ação principal em andamento que o jogador ainda pode cancelar (`cancel`): ele começou
   * a ação, o motor espera uma escolha dele e o oponente ainda não decidiu nada. `blocked`
   * explica por que não dá mais para cancelar (a interface mostra o motivo).
   */
  cancel?: CancelInfo;
  /** Estado de antes da ação em `cancel` (só no estado completo: não vai para as visões). */
  checkpoint?: Checkpoint;
}

/** Efeito automático disparado, esperando a vez de resolver (ver `GameState.triggered`). */
export interface TriggeredEffect {
  id: number;
  source: string;
  controller: PlayerId;
  steps: EffectStep[];
  /** Nome mostrado na escolha de ordem. */
  label: string;
  /** Disparados entre duas resoluções são simultâneos (mesmo lote). */
  batch: number;
  /**
   * Resolve mesmo com a carta fora do campo: [On K.O.] (com a carta no descarte, 10-2-17) e os
   * efeitos adiados ("at the end of this turn/battle"). Os outros não ativam se a carta saiu do
   * campo antes da vez deles (8-1-3-1-3).
   */
  offField?: true;
  /** Índice da habilidade: as condições dela são conferidas de novo na ativação (8-4-1-1). */
  ability?: number;
  /** Chave do [Once Per Turn] gasto ao disparar (devolvida se o efeito não chegar a ativar). */
  opt?: string;
  last?: string[];
  eventCount?: number;
}

export interface CancelInfo {
  player: PlayerId;
  /** A ação que seria desfeita. */
  action: Action;
  /** 'revealed': uma carta escondida ficou visível desde o começo da ação. */
  blocked?: 'revealed';
}

/** O que o `cancel` restaura. As definições, as instâncias das cartas e o log ficam como estão. */
export type StateSnapshot = Omit<GameState, 'defs' | 'cards' | 'log' | 'actionCount' | 'cancel' | 'checkpoint'>;

export interface Checkpoint {
  /** Cartas visíveis quando a ação começou, para cada jogador (0, 1) e para os espectadores (2). */
  seen: [string[], string[], string[]];
  snap: StateSnapshot;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
  | { type: 'playCard'; player: PlayerId; uid: string }
  | { type: 'attachDon'; player: PlayerId; target: string }
  /** Devolve à área de custo 1 DON!! anexado neste turno e ainda não usado (ver `FieldCard.donLoose`). */
  | { type: 'detachDon'; player: PlayerId; target: string }
  /** Desfaz a ação principal em andamento (ver `GameState.cancel` e `cancelError`). */
  | { type: 'cancel'; player: PlayerId }
  | { type: 'activate'; player: PlayerId; uid: string; ability: number }
  | { type: 'attack'; player: PlayerId; attacker: string; target: string }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'choose'; player: PlayerId; uids: string[] }
  | { type: 'answer'; player: PlayerId; yes: boolean }
  /**
   * Usa uma carta da mão no Counter Step. `target`: quem recebe o valor de Counter de um Personagem
   * ou Stage (o Líder ou 1 Personagem do defensor, 7-1-3-1-1); sem ele, o atacado.
   */
  | { type: 'counter'; player: PlayerId; uid: string; target?: string }
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId }
  /** O jogador ficou sem tempo (só o servidor das partidas online envia). */
  | { type: 'timeout'; player: PlayerId; abandoned?: boolean }
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
  | { op: 'shuffle' }
  /** Olhar as N cartas do topo do próprio deck (o oponente vê no log que você olhou). */
  | { op: 'peek'; count: number };

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
  /**
   * Sem `firstPlayer`: o RNG sorteia o vencedor e ele escolhe se joga primeiro ou
   * segundo (regra oficial). Desligado, o vencedor do sorteio simplesmente começa
   * (como nas partidas e replays gravados antes desta opção).
   */
  chooseFirst?: boolean;
  /**
   * Seed de 128 bits (4 inteiros de 32 bits) para o RNG sfc32. Usada nas partidas
   * online, em que a seed de 32 bits poderia ser descoberta por força bruta.
   */
  seed128?: number[];
  /**
   * Preparação como nos replays até a versão 8 (antes das DV-24/25): a Vida na ordem inversa
   * (a carta do topo do deck no topo da Vida) e o "at the start of the game" do Líder resolvido
   * na criação da partida, antes da escolha de quem começa, com o primeiro Stage elegível do deck.
   */
  legacySetup?: boolean;
}
