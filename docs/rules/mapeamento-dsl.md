# Mapeamento das interações para a DSL

Como cada interação do [catálogo](interacoes/README.md) é (ou não) expressa pela DSL de efeitos do motor:
`packages/engine/src/types.ts` (tipos), `cards/parser.ts` (leitor do texto oficial), `cards/scripts.ts` (scripts à mão) e `engine.ts` (execução). Levantamento feito lendo o código em 07/10/2026; as linhas citadas são desse momento.

Legenda: **Existe** = há primitiva e ela segue a regra · **Parcial** = existe, mas com diferença de regra (ver [divergencias.md](divergencias.md)) · **Falta** = não há primitiva.

## Interação → primitiva

| Interação (tema) | Primitiva(s) | Situação |
|---|---|---|
| K.O. por efeito / por batalha (1) | `do: 'ko'`, `koCharacter` (engine.ts:4359), `onKO` | Existe; o [On K.O.] de Personagem negado ainda dispara (Parcial) |
| Trash / voltar à mão / fundo do deck sem ser K.O. (1) | `trashTarget`, `returnToHand`, `toDeckBottom`, `opponentChoosesOwn`, `fieldToLife` | Existe; `fieldToLife` e `opponentChoosesOwn` não oferecem substituição nem emitem `characterRemoved` (Parcial) |
| "Cannot be K.O.'d (in battle / by effects)" (1) | `cannotBeKO{inBattle,byEffect}`, `staticNoBattleKO`, `staticNoEffectKO`, `noBattleKOVsAttribute`, auras | Parcial: "by your opponent's effects" também bloqueia K.O. por efeito próprio |
| "Cannot be removed from the field by your opponent's effects" (1) | `staticNoRemoval`, `aura.noRemoval` → `removalBlocked` | Existe |
| [Banish] / [Double Attack] (2) | palavra-chave + frame `damage` (`stepDamage`) | Existe |
| Dano por efeito (2) | `takeDamage` (frame `damage`, com [Trigger]) | Existe |
| Vida: adicionar, trashar, virar para cima, olhar (2) | `handToLife{faceUp}`, `addLifeFromDeck`, `trashLife`, `lifeToTrash`, `lifeFace`, `peekLife`, `arrangeLife`, `fieldToLife` | Parcial: `fieldToLife` ignora "face-up" |
| "When you take damage" / "when you deal damage" / "when a Life card is removed" (2) | eventos `damageTaken`, `damageDealt`, `attackDamage`, `lifeRemoved`, `lifeZero` | Existe; a ordem em relação ao [Trigger] precisa ser conferida (ver divergências) |
| [Trigger] (3) | timing `trigger`, pendência `lifeCard`, `playThis`, `addThisToHand`, `useMainEffect`, `useCounterEffect` | Parcial: a carta vai ao trash **antes** de resolver (deveria estar em área nenhuma) |
| Substituição de K.O./remoção/rest/dano (4) | timing `replace` + `Replacement`, `tempReplace`, `replaceRemoval`, `replaceRest`, `replaceDamage` | Parcial: só a primeira substituição aplicável é oferecida; remoção por efeito próprio não é substituível; sem substituição para Líder/Stage |
| Substituição de outros acontecimentos (comprar, mão, Vida) (4) | — | Falta (nenhuma carta precisa hoje) |
| [Blocker], [Unblockable], "cannot activate [Blocker]" (5) | `blockerOptions`, `noBlockerThisBattle`, `noBlockerWhenAttacking`, `cannotBlock` | Existe |
| [Rush], [Rush: Character], atacar Personagens ativos (5) | palavras-chave, `attackError`, `canAttackActive` | Existe |
| Redirecionar ataque (5) | `redirectAttack` | Existe |
| Counter da mão, Evento [Counter], "during this battle" (6) | pendência `counter`, `counterValue`, `handCounter`, duração `battle` | Existe; redução de custo na mão não vale para Eventos [Counter] (Parcial) |
| «Set Power to 0» (6) | lido como `basePower: 0` | Parcial: deveria ser −(poder atual) (CR 4-12) |
| Poder base / troca de poder base (6, 12) | `basePower`, `swapBasePower`, `staticBasePower` | Existe |
| Dar DON!!, DON!! −X, [DON!! xX] (7) | `giveRestedDon`, `giveActiveDon`, `moveGivenDon`, `AbilityCost.donMinus`, `returnDonChoice`, `Ability.don` | Existe |
| Stage único, K.O. de Stage (7) | `playFree` (substitui Stage), `ko` em Stage | Parcial: `ko` em Stage vai direto ao trash, sem proteções, substituição nem eventos |
| Fonte sai de cena no meio do efeito (8) | o frame continua com o `uid`; `delayed` | Existe |
| "If you do" / "If" / "Then" (8) | `lastDone`, `EffectStep.if`, `payCost{scope}` | Existe |
| Ordem de resolução de efeitos simultâneos (9) | fila `state.triggered` (`queueTriggered`, `nextTriggered`, pendência `option` com `order`) | Existe |
| [End of Your Turn] / [End of Your Opponent's Turn] (9) | timing `endOfTurn` / — | Existe / Falta (0 cartas hoje) |
| "At the start of your turn" (9) | timing `startOfTurn` | Existe |
| [Once Per Turn] (10) | `Ability.oncePerTurn`, `usedThisTurn` | Existe; não é conferido no [On K.O.] (Parcial) |
| Custos de ativação (10) | `AbilityCost` (`payImmediateCost`, `canPayCost`) | Existe |
| Redução de custo (10) | `cost`, `handCost`, `handCostAura`, `nextPlayDiscount` | Existe; custo com valor negativo oculto (CR 1-3-6-2-1) a conferir |
| "Up to", busca no deck, revelar (10, 13) | `TargetSpec.upTo`, `search`, `tutor`, `revealTop`, `arrangeTop` | Existe |
| Limite de 5 Personagens (11) | `stepPlay` (escolha de qual trashar) | Existe |
| Jogar por efeito (mão, trash, deck, Vida) (11) | `playFrom`, `playThis`, `playRevealed`, `handPlayOrLife`, `opponentPlays` | Existe |
| Negar efeitos / negar [On Play] (12) | `negate`, `aura.negate`, `negateOnPlay`, regra `ownOnPlayNegated` | Existe (ver [On K.O.] acima) |
| Regras de Líder (deck, DON!!, início da partida) (12) | `leaderRule` (`donDeck`, `deckOutWin`, `startStage`, `deckMaxCost`…) | Existe |
| Restrição imposta ao oponente ("your opponent cannot ...") (12) | `restrict` vale só para quem controla o efeito; `staticTaunt` | Falta como primitiva genérica (2 cartas resolvidas com `staticTaunt`) |
| Copiar/ganhar efeitos de outra carta | — | Falta (0 cartas hoje) |
| Gatilho de carta fora do campo ("when this card is removed from Life", na mão, no trash) | — | Falta (0 cartas hoje) |

---

# Catálogo da DSL

## 0. Visão geral e números de cobertura

- **Montagem da carta:** `cards/index.ts:6` `buildCardDef` — se existe script em `CARD_SCRIPTS` (scripts.ts), ele vence; senão
  `parseCard` (parser.ts:3060). Linha não reconhecida vira habilidade manual (`manualAbility`, split.ts:68) e entra em
  `unparsed`. `CardDef.scripted` = tudo reconhecido; `CardDef.manual` = sobrou linha manual.
- **Status de cobertura:** `automationStatus` / `computeStatus` (cards/index.ts:39 / :58):
  `scripted` (tem script) → `vanilla` (só palavras-chave/lembretes, `KEYWORD_ONLY` split.ts:61) → `auto` (nenhuma linha
  em `unparsed`) → `partial` (algumas linhas manuais) → `manual` (todas). Usado em `GET /api/coverage`
  (apps/server/src/app.ts:75) e no importador (apps/server/src/import-cards.ts:81).
- **Medição feita agora** :

| Base | Cartas | auto | vanilla | scripted | partial | manual |
|---|---|---|---|---|---|---|
| `data/cards/*.json` (OP01, OP02, ST) | 735 únicas (750 entradas) | 551 | 123 | 61 | 0 | 0 |
| + `test/fixtures/spoilers-eb05-op18.json` | 822 | 635 | 126 | 61 | 0 | 0 |
| Base completa da optcgapi (allSetCards + allSTCards, EB01–EB04, OP01–OP17, PRB01–02, ST01–ST36, P) | 2711 | 2333 | 316 | 62 | **0** | **0** |

  **Hoje nenhuma carta conhecida cai no modo manual.** "auto" significa que *toda linha casou com algum padrão*; não
  garante que a semântica esteja certa. As lacunas reais (seção 5) são aproximações de semântica, não falta de leitura.
- **README desatualizado:** `README.md` seção "Regras implementadas" ainda diz que não há efeitos de substituição,
  [End of Your Turn] e custos DON!! −X; os três existem (timing `replace`, `endOfTurn`, `AbilityCost.donMinus`).
- **Comentário divergente:** `types.ts:824` diz que `[DON!! xN]` "só vale no seu turno", mas `conditionsMet`
  (engine.ts:217) só confere a quantidade de DON!! anexados. O código está alinhado com as cartas (`[DON!! x1]
  [Opponent's Turn]` existe, ex.: OP01-051); o comentário é que está errado.

---

## 1. Momentos (`AbilityTiming`, types.ts:738-753)

Modificadores comuns da habilidade (`Ability`, types.ts:822-895): `don` ([DON!! xN]), `oncePerTurn`, `yourTurn`,
`opponentsTurn`, `condition`, `cost`. Checados em `conditionsMet` (engine.ts:213): carta negada → falso (216),
DON!! anexados (217), [Your Turn] (218), [Opponent's Turn] (219), `condition` via `conditionHolds` (226/238).

| timing | Palavra-chave oficial / texto | Onde dispara (engine.ts) | Onde o parser cria |
|---|---|---|---|
| `onPlay` | [On Play] | Personagem: `stepPlay` :1670 (depois de entrar em campo); Stage da mão: `handleMainAction` :1247; jogado por efeito: `playFree` :1929 (Stage) / frame `play` (Personagem); ferramenta manual :4159. Anulação: `pushAbilities` :1627 (`onPlayNegated` :1618 — passo `negateOnPlay` ou regra `ownOnPlayNegated`) | `TIMINGS` parser.ts:46 |
| `whenAttacking` | [When Attacking] | `stepBattle` passo `whenAttacking` :1692 | parser.ts:46; "When this Leader attacks your opponent's Leader" :2551 (+`attackingLeader`); "attacks or is attacked" :2549 |
| `onOpponentAttack` | [On Your Opponent's Attack]; "This effect can be activated when your opponent('s Character) attacks" | `stepBattle` :1690 (campo do defensor, empilhado antes do [When Attacking] → resolve depois) | parser.ts:46; :2582 (`attackerCharacter`/`attackerAttribute`), :2608 |
| `activateMain` | [Activate: Main] (e "[Once Per Turn] You may X: Y" sem marcação, :2602) | Ação `activate` em `handleMainAction` :1284 (validação `activateError` :779; custo `payImmediateCost` :1973) | parser.ts:46, `parseLine` :3022 (custo vai para `Ability.cost`) |
| `main` | [Main] (só Eventos) | Evento jogado da mão :1251; `activateEventFromHand/Trash` :3468; `useMainEffect` (Trigger) :3902 → `useOwnEffect` :1934 | parser.ts:46 |
| `counter` | [Counter] (só Eventos) | Pendência `counter` :1158 (paga `def.cost` em DON!!); `useCounterEffect` :3904 | parser.ts:46 |
| `trigger` | [Trigger] (campo `CardData.trigger`) | Pendência `lifeCard` aberta em `stepDamage` :1802; resposta "sim" :1206-1211 (a carta vai ao descarte, efeito empilhado, evento `triggerActivated`) | `parseTriggerText` parser.ts:3041 |
| `onKO` | [On K.O.]; "When this Character is K.O.'d (by an effect / by your opponent's effect)" (`koBy`) | `koCharacter` :4385-4392 (confere só o turno e `koBy`, não `conditionsMet`) | parser.ts:46; :2618, :2728 |
| `onBlock` | [On Block] | Pendência `block` :1132 | parser.ts:46 |
| `endOfTurn` | [End of Your Turn] | Ação `endTurn` :1330 (antes de passar o turno; depois os `delayed` :1333) | parser.ts:46 |
| `battlesCharacter` | "If this Character battles your opponent's Character, …" / "At the end of a battle in which this Character battles …" | `stepBattle` passo `end` :1750 (`last` = o oponente da batalha) | parser.ts:2540, :2655 |
| `event` | "When …" (reação a um `GameEvent`, `Ability.event`) | `emit` :1490 (varre Líder, Personagens e Stage dos dois jogadores) + `eventMatches` :1512 | parser.ts:2567, :2627, :2738 (`parseEvent` :2407) |
| `replace` | "If … would be K.O.'d / removed from the field / rested / If you would take damage, you may … instead" (`Ability.replace` + `cost`) | K.O./remoção: `offerReplacement` :4240 (chamado em `koCharacter` :4374, `returnToHand` :2283, `trashTarget` :2616, `toDeckBottom` :3915); virar: `restCard` :1591-1603; dano: `offerDamageReplacement` :4286 (chamado em `stepDamage` :1779) | parser.ts:2665-2719 |
| `startOfTurn` | "This effect can be activated at the start of your turn." | `startTurn` :1358-1365 (antes da Renovação; a condição do 1º passo é vista nesse momento) | parser.ts:2524-2533 |
| `static` | Efeito contínuo (sem marcação) | Lido sob demanda: `getPower` :584, `getCost` :448, `hasKeyword` :631, `aurasOn` :530, `koProtected` :4328, `removalBlocked` :4320, `attackError` :686, `playCost` :736, `counterValue` :165, `noRefreshByAura` :1400, `restCard` :1585, `leaderRule` :156 | `parseStatic` parser.ts:2521 |

Não existem: `[End of Your Opponent's Turn]` (parseHeader devolve null — parser.ts:2210 — e a linha iria para o
modo manual; 0 cartas hoje), "at the start of your opponent's turn" (0 cartas).

### [Once Per Turn], [DON!! xX], [Your Turn]/[Opponent's Turn]
- **Once Per Turn:** chave `uid:índice` em `state.usedThisTurn` (`usedKey` :657), limpa em `endTurn` :1419. Marcado ao
  empilhar (`pushAbilities` :1638, `emit` :1501, `activate` :1289) e na substituição (:3038, :3641, :3674). Se a
  habilidade começa com custo opcional e o jogador recusa, o uso é devolvido (`abilitySteps` :667, `releaseOncePerTurn`
  :674). `onKO` não confere Once Per Turn.
- **[DON!! xX]:** `Ability.don`, conferido em `conditionsMet` :217 (qualquer turno).
- **[Your Turn]/[Opponent's Turn]:** `Ability.yourTurn/opponentsTurn` (:218-219); para `onKO` só o turno é checado
  (:4388), pois a carta já saiu do campo.

---

## 2. Efeitos (`EffectStepBody`, types.ts:488-731)

Todo passo aceita `if?: Condition` (types.ts:734), avaliado em `stepConditionMet` (engine.ts:1866) **na hora de
resolver**; falhou = passo pulado. Execução: `execStep` (engine.ts:2162). Alvos: `TargetRef` (types.ts:436:
`'self' | 'ownLeader' | 'chosen' | 'battleTarget' | TargetSpec`), resolvidos em `resolveTargets` (:1820; `chosen` = `frame.last`
do passo anterior; `TargetSpec.all` = sem escolha). Cada passo grava `frame.last`, que alimenta `chosen`, `lastDone`
("If you do") e `chosenMatches`.

Colunas: **types** = linha em types.ts; **engine** = `case` em `execStep`.

### 2.1 Comprar, olhar e buscar no deck
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `draw` | count | Compra N (bloqueado por restrição `noDrawByEffect`; emite `drawByEffect`) | 494 | 2246 |
| `drawUntil` | count | "Draw cards so that you have N cards in your hand" | 619 | 3852 |
| `drawPerMatching` | spec | Compra 1 por carta sua que casa com `spec` | 518 | 2927 |
| `drawEventCount` | returned? | Compra `eventCount` cartas (ex.: devolvidas ao deck) | 581 | 3255 |
| `opponentDraws` | count | O oponente compra N | 567 | 3151 |
| `search` | look, upTo, filter, rest: bottom/trash/topOrBottom, play?, toLife?, lifeFaceDown?, rested?, toTrash? | "Look at N…; reveal up to M … and add it to your hand. Then, place the rest…" (também jogar/Vida/descarte) | 625 | 2351 |
| `tutor` | upTo, filter | Procura no deck inteiro e adiciona à mão | 627 | 2547 |
| `arrangeTop` | look, topOnly? | Olha N e devolve ao topo/fundo em qualquer ordem | 703 | 3980 |
| `revealTop` | — | Revela o topo do deck (vira `chosen`/`revealed`) | 659 | 2705 |
| `revealedToHand` | filter? | A revelada vai para a mão (se casar) | 508 | 2721 |
| `revealedToBottom` | — | A revelada vai para o fundo | 663 | 3573 |
| `revealedToTopOrBottom` | — | Jogador escolhe topo/fundo para a revelada | 587 | 3332 |
| `playRevealed` | filter?, rested? | Joga a carta revelada (do deck ou da Vida) | 661 | 2712 |
| `powerPerRevealedCost` | target, amount, duration | +N de poder por ponto de custo da revelada | 554 | 3121 |
| `millDeck` | count | Descarta N do topo do deck | 723 | 3876 |
| `shuffleDeck` | — | Embaralha | 701 | 3976 |
| `lookOpponentTop` / `revealOpponentTop` | — | Olha/revela o topo do deck do oponente | 509 / 597 | 3564 / 2809 |
| `chooseCost` | — | "Choose a cost" (0–10), guardado em `frame.chosenCost` (usado por `revealedHasChosenCost`) | 591 | 2801 |

### 2.2 K.O.
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `ko` | target | K.O. (Personagem via `koCharacter` :4359 com proteções e substituição; Stage vai direto ao descarte, sem proteção) | 490 | 2187 |
| `koSelf` | — | K.O. da própria carta (`force`: ignora proteção/substituição) | 512 | 3400 |
| `koOwn` | count, spec | Custo "K.O. N of your …" (`force`) | 655 | 2582 |
| `anyNumberForPower` | source field/trash, action ko/hand/bottom, spec/filter, power, every, target, duration | "You may K.O./return/place any number of … +N power for every …" | 529 | 2985 |

`koCharacter` (:4359): `koProtected` (:4328) → `removalBlocked` (:4320, só por efeito) → `offerReplacement` (:4374) →
move ao descarte, DON!! anexados voltam virados, emite `characterKO` e `characterRemoved` (:4381-4383), empilha [On K.O.].

### 2.3 Devolver à mão
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `returnToHand` | target | Devolve Personagem/Stage à mão do dono (proteção `removalBlocked`, substituição, eventos `characterRemoved` + `returnedToHand`) | 497 | 2267 |
| `returnOwn` | count, spec | Custo "return N of your Characters to hand" | 641 | 2563 |
| `returnSelfToHand` | — | Custo "return this Character to the owner's hand" | 643 | 2636 |
| `opponentChoosesOwn` | count, spec, action hand/bottom | "Your opponent returns/places 1 of their Characters …" (o oponente escolhe) | 571 | 3166 |
| `fromTrashToHand` | upTo, filter | Do descarte para a mão | 697 | 3924 |
| `addThisToHand` | — | [Trigger] "… and add this card to your hand" | 727 | 3887 |

### 2.4 Para o deck (topo/fundo)
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `toDeckBottom` | target | Personagem para o fundo do deck do dono (proteção + substituição) | 695 | 3906 |
| `selfToDeckBottom` | — | Custo "place this Character at the bottom" | 657 | 2600 |
| `ownToBottom` | count, spec, toLife? | Custo "place N of your Characters at the bottom" (ou na Vida virada para cima) | 599 | 2829 |
| `handToDeck` | count, where top/bottom/choose | Da mão para topo/fundo | 615 | 3536 |
| `handToDeckBottom` | count | Custo "place N cards from your hand at the bottom" | 687 | 3827 |
| `handAllToDeck` | who | "Return all cards in your hand to your deck and shuffle" (`eventCount`) | 566 | 3142 |
| `trashToDeckBottom` | count, filter? | Do descarte para o fundo do deck | 644 | 2645 |
| `opponentTrashToBottom` | count, upTo?, chooser?, filter? | Descarte do oponente → fundo do deck dele | 593 | 2730 |
| `opponentHandToBottom` | count | O oponente põe N da mão no fundo | 669 | 3595 |
| `lastToDeckTop` | — | As cartas `last` (da mão) vão ao topo | 586 | 3392 |
| `lifeOneToDeckTop` | — | Olha a Vida, 1 vai ao topo do deck, reordena o resto | 588 | 3345 |
| `opponentLifeToBottom` | count | Vida do oponente → fundo do deck dele | 526 | 2971 |

### 2.5 Descarte (mão, campo, Vida)
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `trashFromHand` | count, filter?, upTo? | Descartar da mão (custo ou efeito; emite `handTrashedByEffect`) | 617 | 2320 |
| `trashHand` | — | Descarta a mão inteira | 569 | 3157 |
| `trashHandUntil` | count, both? | Descarta até ficar com N (um ou os dois jogadores) | 577 | 3210 |
| `trashEventCount` | from hand/deck | Descarta a mesma quantidade (`eventCount`) | 520 | 2938 |
| `opponentDiscards` | count | O oponente escolhe e descarta N | 721 | 2523 |
| `opponentPicksFromHand` | count | O oponente escolhe N da **sua** mão; você descarta | 522 | 2950 |
| `trashRandomFromOpponentHand` | count | Descarta N ao acaso da mão do oponente | 653 | 2625 |
| `revealOpponentHand` | count | Revela N cartas ao acaso da mão do oponente | 524 | 2961 |
| `trashTarget` | target | "Trash up to 1 of … Characters" (vai ao descarte sem ser K.O.; proteção + substituição) | 651 | 2608 |
| `trashSelf` | — | Custo "trash this Character/Stage" | 642 | 2635 |
| `trashOwn` | count, spec | Custo "trash N of your Characters" | 656 | 2583 |
| `trashAnyForPower` | categories?, filter?, power, duration, target? | "Trash any number of … from your hand for +N power each" | 606 | 3473 |

### 2.6 Vida (inclui "banish-like" = Vida para o descarte)
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `trashLife` | side own/opponent, count | Vida (do topo) para o descarte, sem [Trigger] | 713 | 2480 |
| `lifeToTrash` | count, choose? | Custo: Vida (topo, ou topo/fundo) para o descarte | 645 | 2660 |
| `lifeTrashUntil` | count | Descarta Vida até ficar com N | 575 | 3201 |
| `trashFaceUpLife` | — | Descarta todas as Vidas viradas para cima | 585 | 3319 |
| `lifeToHand` | count, choose? | Vida → mão (topo ou topo/fundo); bloqueado por `noLifeToHand` | 629 | 3687 |
| `opponentLifeToHand` | count | Vida do oponente → mão dele | 667 | 3587 |
| `handToLife` | upTo, filter?, faceUp?, fromTrash?, trashOnly?, choose? | Mão (ou descarte) → topo/fundo da Vida, opcionalmente virada para cima | 632 | 3701 |
| `handPlayOrLife` | filter, from? | "Select … from your hand and play it or add it to the top of your Life cards face-up" | 516 | 2890 |
| `fieldToLife` | target, choose? | Personagem do campo → topo/fundo da Vida do dono (**sempre virada para baixo**, ver 5) | 634 | 3733 |
| `addLifeFromDeck` | count | Topo do deck → topo da Vida | 729 | 3896 |
| `lifeFace` | count, up | Vira N Vidas para cima/baixo (custo ou efeito) | 647 | 2685 |
| `revealLifeTop` | — | Revela o topo da Vida | 511 | 3439 |
| `peekLife` | whose either/own/opponent | Olha a Vida do topo e põe no topo ou fundo | 636 | 3757 |
| `arrangeLife` | whose | Olha toda a Vida e reordena | 594 | 2756 |
| `takeDamage` | count, opponent? | "You take N damage" / "deal N damage" (frame `damage`, com [Trigger]) | 573 | 3198 |

Estado: `PlayerState.life` (último = topo) e `lifeFaceUp` (types.ts:946, :952). [Banish] no ataque: `stepDamage` :1789-1792.

### 2.7 Poder, custo e durações
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `power` | target, amount, duration, per? | ±N de poder (modificador `power`; `per` multiplica pela contagem) | 489 | 2168 |
| `powerPerDon` | target, amount, duration | ±N por DON!! anexado ao alvo | 552 | 3112 |
| `restDonForPower` | power, target | Vira quantos DON!! quiser; +N por DON!! (nesta batalha) | 582 | 3263 |
| `basePower` | target, amount?, copy opponentLeader/chosen/attacker, duration | "base power becomes N / the same as …" (modificador `basePower`) | 604 | 3418 |
| `swapBasePower` | spec, duration, withLeader? | Troca o poder base de 2 cartas | 584 | 3296 |
| `cost` | target, amount, duration | ±N de custo (modificador `cost`; "Set the cost to 0" = −99) | 719 | 2508 |
| `nextPlayDiscount` | filter, amount | "The next time you play X from your hand during this turn, the cost will be reduced by N" (`state.costReductions`) | 602 | 3415 |
| `gainAttribute` | target, attribute, duration | Ganha atributo ("Slash") | 556 | 3130 |

Durações (`Duration`, types.ts:447): `turn`, `battle`, `nextOpponentTurn` ("until the end of your opponent's next
turn/End Phase"), `untilYourNextTurn` ("until the start of your next turn"), `endOfYourNextTurn`. `addModifier`
(engine.ts:1944) calcula `untilTurn`; expiram em `endTurn` :1414-1418 (turn / nextOpponentTurn / endOfYourNextTurn),
`startTurn` :1353 (untilYourNextTurn) e no fim da batalha :1742 (battle). `power` com `battle` fora de batalha vira
`turn` (:2177). Leitura: `getPower` :584 (base impresso → aura `basePower` → `staticBasePower` → modificador `basePower`
→ +1000 por DON!! no turno do dono → `staticPower`/`powerPer`/`battleVsAttribute` → auras de poder → modificadores
`power`); `getCost` :448 (mínimo 0); custo de jogar `playCost` :736 (`handCost`, `costReductions`, `handCostAura`).

Estáticos de poder/custo (`Ability`): `staticPower`, `staticCost`, `staticBasePower` (número ou `'leader'`), `costPer`,
`powerPer` (hand/restedDon/trash/trashEvents/distinctCharacters), `battleVsAttribute`, `handCost`, `handCostAura`,
`handCounter`, `selfHandCounter`; auras (`Aura`, types.ts:386) com `power`, `cost`, `basePower`, `basePowerCopyLeader`.

### 2.8 Palavras-chave (Rush, Blocker, Double Attack, Banish, Unblockable, Rush: Character)
- Tipo `Keyword` (types.ts:11). Impressas: `detectKeywords` (split.ts:39, só no início de linha).
- Concessão: passo `gainKeyword` {target, keyword, duration} (types 715, engine 2488 → modificador `keyword`);
  estático `staticKeyword`; aura `aura.keyword`; regra de Líder não há.
- Verificação: `hasKeyword` engine.ts:631 (palavra impressa some se a carta estiver negada). Uso: Rush/Rush: Character em
  `attackError` :724-728; Blocker/Unblockable em `blockerOptions` :817-829; Double Attack e Banish em `stepDamage` via
  frame `damage` (:1727-1733, :1789).
- Relacionados: `canAttackActive` (689/3844, e `staticCanAttackActive`), `noBlockerThisBattle` (499/2294:
  minPower/maxPower/maxCost), `noBlockerWhenAttacking` (501/2309), `cannotBlock` (589/3373, modificador `cannotBlock`).

### 2.9 Virar / desvirar
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `rest` | target | Vira (via `restCard` :1578: respeita `cannotBeRested`, `staticNoRest`, substituição `rest`; emite `selfRested`/`restedByEffect`) | 491 | 2202 |
| `setActive` | target | Desvira | 492 | 2214 |
| `restOwn` / `restOwnCharacters` | count, spec / count | Custos "rest N of your …" | 640 / 685 | 2562 / 3814 |
| `restDonOrCharacter` | spec | "Rest up to 1 of your opponent's DON!! cards or Characters …" | 596 | 2772 |
| `skipRefresh` | target | Não desvira na próxima Renovação | 649 | 2695 |
| `cannotBeRested` | target, duration | Modificador `cannotBeRested` (não vira para atacar/bloquear/custos) | 665 | 3581 |

### 2.10 DON!!
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `giveRestedDon` | target, count, fromOpponent?, anyState? | Dá DON!! virados (do seu ou do oponente) | 493 | 2226 |
| `giveActiveDon` | count, target | Dá DON!! ativos (também custo `giveDon`) | 598 | 2815 |
| `moveGivenDon` | count, target | Move DON!! já anexados para outra carta | 514 | 2859 |
| `addDonFromDeck` | count, rested? | Do deck de DON!! para a área de custo | 495 | 2252 |
| `opponentAddDon` | count | O oponente pode adicionar DON!! ativos | 548 | 3096 |
| `setDonActive` | count | Desvira N DON!! (bloqueado por `noSetDonActiveByCharacter`) | 623 | 2343 |
| `restOpponentDon` | count | Vira DON!! ativos do oponente | 496 | 2259 |
| `skipRefreshDon` | count | DON!! virados do oponente não desviram (`state.donSkipRefresh`) | 540 | 3019 |
| `returnDonChoice` | min | Custo "DON!! −N ou mais": pergunta quantos devolver (e passa a `returnDon`) | 711 | 2463 |
| `returnDon` | count, opponent? | Devolve N DON!! ao deck; o dono escolhe de onde, um por vez (pendência `option` com `don`) | 717 | 2614 |
| `returnGivenDon` | count | Custo: anexados voltam virados à área de custo | 590 | 3379 |
| `opponentReturnsDon` | count, activeOnly? | O oponente devolve N DON!! ao deck (ele escolhe quais, via `returnDon`) | 621 | 3860 |
| `donMatchOpponent` | — | Devolve até igualar o número de DON!! do oponente | 550 | 3104 |

DON!! −X como custo: `AbilityCost.donMinus` (+`donMinusOpen`), pago em `payImmediateCost` com o passo
`returnDon` (o dono escolhe quais DON!! devolver; emite `donReturned`). Virar DON!! (①②③): `AbilityCost.restDon` (`payDon` :4405).

### 2.11 Jogar cartas (mão, descarte, deck, Vida)
| do | parâmetros | semântica | types | engine |
|---|---|---|---|---|
| `playFrom` | from deck/hand/trash/handOrTrash, upTo, filter, rested?, notColorOfLast? | Joga sem pagar (respeita `noPlayByEffect`, `noPlayCharacters`) | 699 | 3938 |
| `playThis` | rested? | [Trigger] "Play this card" / "Play this Character card from your trash" | 507 | 2315 |
| `playRevealed` | filter?, rested? | Joga a carta revelada (deck ou Vida) | 661 | 2712 |
| `opponentPlays` | upTo, filter | O oponente joga da própria mão | 546 | 3073 |
| `activateEventFromHand` / `activateEventFromTrash` | filter | Ativa o [Main] de um Evento da mão/descarte | 510 / 558 | 3446 / 3445 |
| `useMainEffect` / `useCounterEffect` / `useOwnEffect` | — / — / timing | Resolve outro efeito da própria carta ([Trigger]) | 503 / 693 / 725 | 3902 / 3904 / 3885 |

Infra: `playFree` :1912 (Personagem → frame `play` com `byEffect`; Stage substitui o anterior), `stepPlay` :1643
(limite de 5 Personagens, regra `playRested`).

### 2.12 Restrições e proteções
| Primitivo | Forma | Onde vale |
|---|---|---|
| `restrict` {kind, minCost?} (types 601, engine 3412) | `RestrictionKind` (types.ts:359): `noPlayCharacters`, `noPlayFromHand`, `noLifeToHand`, `noAttackLeader`, `noDrawByEffect`, `noSetDonActiveByCharacter`. **Sempre para quem controla o efeito e até o fim do turno** (`state.restrictions`, limpo em :1421) | `restricted` :754, `playBlocked` :759, `playError` :764, `attackError` :699, `draw` :2247, `lifeToHand` :3688, `setDonActive` :2344 |
| `cannotAttack` (691/3845) | modificador `cannotAttack` | `attackError` :694 |
| `cannotAttackCharacters` (580/3250) | "this Leader cannot attack Characters with base cost ≤ N" | `attackError` :700-703 |
| `attackTax` (564/3136) | "cannot attack unless your opponent trashes N" | `attackError` :722; ataque :1317-1318 |
| `cannotBeKO` {inBattle?, byEffect?} (731/2498) | modificadores `cannotBeKO`, `cannotBeKOInBattle`, `cannotBeKOByEffect` | `koProtected` :4328 |
| `cannotBeRested` (665/3581) | modificador | `cannotBeRested` :1573 |
| `negate` (600/3403) | modificador `negated` | `isNegated` :207 → `conditionsMet` :216, `hasKeyword` :633 |
| `negateOnPlay` (579/3242) | `state.onPlayNegated` | `pushAbilities` :1627 |
| `redirectAttack` (614/3502) | muda o alvo do ataque | `state.battle.target` |
| Estáticos (`Ability`) | `staticNoRemoval`, `staticNoBattleKO`, `staticNoEffectKO`, `noBattleKOVsAttribute`, `noBattleKOByLeader`, `noEffectKOUnlessAttribute`, `noEffectKOByMaxBasePower`, `staticNoRest`, `staticCannotAttack`, `staticTaunt`, `noLeaderAttackOnPlayTurn`, `noPlayByEffect`, `noRefreshMaxCost` | `koProtected`, `removalBlocked`, `restCard`, `attackError`, `playFrom`, `noRefreshByAura` |
| Auras (`Aura`) | `noEffectKO`, `noBattleKO`, `noRemoval`, `negate`, `cannotAttack`, `keyword` (com `side`, `bothSides`, filtros) | `collectAuras` :542 |

### 2.13 Substituição ("instead")
Existe primitivo: **timing `replace`** + `Ability.replace: Replacement` (types.ts:450: `who: 'self' | TargetSpec`,
`event: 'ko' | 'removal' | 'koOrRemoval' | 'rest' | 'damage'`, `by: 'any' | 'battle' | 'effect' | 'opponentEffect'`) +
`Ability.cost` (o que se paga "instead") + `steps` extras (ex.: "trash this Character and draw 1 card instead").

Fluxo "If this Character would be K.O.'d, you may X instead":
1. `koCharacter` (engine.ts:4374) chama `offerReplacement` (:4240), que procura no campo do dono da vítima (Líder →
   Personagens → Stage) a **primeira** habilidade `replace` aplicável (vítima, evento, causa, condição, Once Per Turn,
   custo pagável/`costAsksOwner`) e empilha o passo interno `replaceRemoval` (types 672, engine 3619).
2. `replaceRemoval` abre `confirm` (`askPay` :2062). "Não" → `performRemoval` (:4304, com `noReplace`). "Sim" → marca
   Once Per Turn, paga o custo (`payImmediateCost`), aplica `victimPowerMinus`/`victimToLife` e insere `steps`.
- Virar: `restCard` :1591 → passo `replaceRest` (562/3025). Dano: `offerDamageReplacement` :4286 → `replaceDamage` (681/3657).
- Temporária ("If any of your Characters would be K.O.'d in battle during this turn, you may … instead"):
  passo `tempReplace` (560/3042) → `state.tempReplacements`, consultado no fim de `offerReplacement` :4272-4277.
- Custos exclusivos de substituição em `AbilityCost` (types.ts:755-820): `koSelf`, `victimPowerMinus`, `victimToLife`,
  `restOpponentChars`, `selfPowerMinus`, `either`.
- Outras "instead" sem ser remoção: "If X, choose Y instead of Z" (troca de alvo, `parseSpecialPair` parser.ts:1950);
  "… instead of drawing N" (`parseBody` :2021-2033, vira `chooseOne`); regras de Líder `deckOutWin` e `faceUpLifeToDeck`.

### 2.14 Escolhas
| Primitivo | Uso |
|---|---|
| `chooseOne` {chooser self/opponent, options: EffectStep[][], labels} (638/3797) | "Choose one: • … • …", "Your opponent chooses one"; a opção herda `last` |
| `select` {target} (717/2494) | "Select up to 1 …" (só grava `last`) |
| `payCost` {cost, scope?, ability?} (709/2432) | Custo opcional no meio do efeito / "you may X" (`scope` = quantos passos pular se recusar; sem `scope` aborta o efeito) |
| `payEither` {options} (583/3284) | "trash 1 card or rest 1 DON!!" |
| `opponentMay` {pay lifeTrash/discard/returnDon, count, otherwise} (544/3052) | "Your opponent may X. If they do not, Y." |
| `delayed` {steps, when?: battle, keepChosen?} (683/3681) | "at the end of this turn/battle" (`state.delayed` ou `battle.after`) |
| `manual` {text} (505/2428) | Fallback: abre pendência `manual` (o jogador só confirma) |
| `winGame` (541/3045), `extraTurn` (542/3048) | Vitória imediata / turno extra |

Pendências (`Pending`, types.ts:1003-1051): `selectTargets` (`askCards` :1885 / `resolveTargets` :1820), `confirm`
(`askPay` :2062), `option` (`askOption` :1957), `manual`, `block`, `counter`, `lifeCard`, `mulligan`, `chooseFirst`.
Respostas em `handlePendingResponse` :1062.

### 2.15 Condições (`Condition`, types.ts:166-353; avaliação `evalCondition` engine.ts:238)
Usadas em `Ability.condition` (habilidade inteira) e `EffectStep.if` (passo). Todas as chaves presentes precisam valer;
`anyOf` = OU, `not` = negação. Famílias:
- **"If you have …" (campo):** `minCharacters`, `maxCharacters`, `fewerCharacters`, `haveCharacterNamed`,
  `noCharacterNamed`, `noOtherNamed`, `haveNamed`(+`haveNamedBasePower`), `minTypedCharacters`, `distinctTyped`,
  `onlyTypeIncludes`, `onlyTypedCharacters`, `onlyCharactersWithoutCounter`, `ownCharacterMinCost/MinPower/MinBasePower`,
  `ownTypedCharacterMinCost/MinPower`, `charactersWithCost`, `totalCharacterCostMin`, `minRestedCharacters`,
  `minRestedTyped`, `ownMatching`, `ownMatchingMax`, `selfActive`, `selfRested`, `selfMinPower`, `selfPlayedThisTurn`,
  `selfBattledCharacter`.
- **Oponente / qualquer:** `opponentMatching`, `opponentCharacterMinPower/MinCost`, `opponentMinRestedCharacters`,
  `opponentRestedCardsMin`, `anyCharacterNamed`, `anyCharacterCost`, `anyCharacterMinPower/MinBasePower`,
  `anyCharactersWithCost`, `opponentCharacterKOThisTurn`.
- **Líder (tipo/nome/cor/poder):** `leaderName`, `leaderNames`, `leaderNameIncludes`, `leaderHasType`,
  `leaderHasAnyType`, `leaderTypeIncludes`, `leaderTypeOrName`, `leaderColor`, `leaderMulticolor`, `leaderMonocolor`,
  `leaderAttribute`, `leaderActive`, `leaderMinPower`, `leaderMaxPower`, `opponentLeaderMinPower`, `opponentLeaderAttribute`.
- **Vida:** `lifeMin`, `lifeMax`, `opponentLifeMin`, `opponentLifeMax`, `totalLifeMin`, `totalLifeMax`,
  `lifeLessThanOpponent`, `lifeLeqOpponent`, `lifeHandMax`, `faceUpLifeMin`.
- **DON!!:** `minDonOnField`, `maxDonOnField`, `opponentMinDonOnField`, `opponentMaxDonOnField`, `opponentMoreDon`,
  `donLeqOpponent`, `minActiveDon`, `maxActiveDon`, `minRestedDon`, `allDonRested`, `minGivenDon`, `anyDonGiven`,
  `opponentAnyDonGiven`, `deficit` (don/hand/characters).
- **Mão / descarte / deck:** `handMin`, `handMax`, `opponentHandMin`, `trashMin`, `trashEventsMin`, `trashHasNames`,
  `deckMax`, `handTrashedThisTurn`.
- **Contexto do efeito/batalha/turno:** `lastDone` ("If you do"), `chosenMatches`, `chosenCostEqualsDon`,
  `revealedHasChosenCost`, `attackerCharacter`, `attackerAttribute`, `attackingLeader`, `activatedEventMinCost`, `minTurn`.

Leitura do texto: `parseCondition` parser.ts:621-858 (~104 padrões).

### 2.16 Custos (`AbilityCost`, types.ts:755-820)
Pagamento imediato + passos de escolha: `payImmediateCost` engine.ts:1973; viabilidade `canPayCost` :2067;
descrição `describeCost` :2122. Em [Activate: Main] o custo fica em `Ability.cost`; nos outros momentos o parser
transforma em passo `payCost` no começo (parser.ts:3027-3030). Leitura: `parseCost` :2376 e `parseCostPart` :2218.

| Custo oficial | Campo | Passo gerado |
|---|---|---|
| ①②③ (virar DON!!) | `restDon` | imediato (`payDon`) |
| DON!! −X (e "or more") | `donMinus`, `donMinusOpen` | imediato / `returnDonChoice` |
| Virar esta carta | `restSelf` | imediato (`restCard`) |
| Descartar da mão (com filtro) | `trashFromHand`, `trashFilter` | `trashFromHand` |
| Mão → fundo/topo do deck | `handToBottom` / `handToTop` | `handToDeckBottom` / `handToDeck` |
| Revelar da mão | `reveal` | `revealFromHand` |
| Virar Personagens / cartas suas | `restCharacters` / `restOwn` | `restOwnCharacters` / `restOwn` |
| Devolver Personagens / esta carta à mão | `returnOwn` / `returnSelf` | `returnOwn` / `returnSelfToHand` |
| K.O. / descartar Personagens seus | `koOwn` / `trashOwn` / `koSelf` / `trashSelf` | idem |
| Esta carta / Personagens para o fundo do deck | `selfToBottom` / `ownToBottom` | `selfToDeckBottom` / `ownToBottom` |
| Personagem seu → Vida virada para cima | `ownToLife` | `ownToBottom{toLife}` |
| Vida → mão / descarte / virar | `lifeToHand`(+`lifeChoice`) / `lifeToTrash` / `lifeFace` | idem |
| Topo do deck → descarte | `mill` | `millDeck` |
| Descarte → fundo do deck / deck | `trashToBottom` / `trashToDeck` | `trashToDeckBottom` (+`shuffleDeck`) |
| −N de poder no Líder / nesta carta | `leaderPowerMinus` / `selfPowerMinus` | imediato / `power` |
| Dar DON!! ativo / DON!! do oponente | `giveDon` / `giveOppDon` | `giveActiveDon` / `giveRestedDon{fromOpponent}` |
| Devolver DON!! anexados | `returnGivenDon` | `returnGivenDon` |
| Jogar uma carta da mão | `playFromHand` | `playFrom` |
| "A ou B" | `either` | `payEither` |
| Requisito de custo mínimo desta carta | `selfMinCost` | — |

Informação oculta: custos que leem a mão abrem a pergunta mesmo sem poder pagar (`costReadsHand` :2032, `publicCost` :2040,
`costAsksOwner` :2057, `confirm.cannot`).

---

## 3. Acontecimentos (`GameEvent`, types.ts:462-486) para "When X happens"

Todos disparam habilidades `timing: 'event'` **de cartas em campo** (Líder, Personagens, Stage) via `emit` (engine.ts:1490);
`last` = carta do acontecimento, `eventCount` = quantidade. Casamento em `eventMatches` :1512.

| kind | Texto | Emitido em (engine.ts) |
|---|---|---|
| `donReturned` {min?} | "When a DON!! card on your field is returned to your DON!! deck" / "N or more" | `returnDonAndEmit` :1614; passo `returnDon` |
| `characterPlayed` {who, filter?, from?: trash, byEffect?} | "When you/your opponent play(s) a …", "is played from your trash", "using a Character's effect" | `stepPlay` :1671 |
| `lifeRemoved` {whose} | "When a card is removed from your/your opponent's Life cards" | `lifeRemoved` :4440 (dano, `trashLife`, `lifeToHand`, `lifeToTrash`, `trashFaceUpLife`, `lifeOneToDeckTop`) |
| `lifeZero` | "When your number of Life cards becomes 0" | `lifeRemoved` :4441 |
| `restedByEffect` | "When/If a Character is rested by your effect" | `restCard` :1607 |
| `handTrashedByEffect` {sourceType?} | "When a card is trashed from your hand by (your {X} type card's) effect" | `trashFromHand` :2339; `trashHand` :3162; `trashHandUntil` :3237 |
| `donGiven` | "When this Leader or 1 of your Characters is given a DON!! card" | `attachDon` :1265; `giveRestedDon` :2240; `giveActiveDon` :2824; `moveGivenDon` :2886 |
| `damageTaken` / `damageDealt` | "When you take damage" / "When you deal damage to your opponent's Life" | `stepDamage` :1770-1771 (uma vez por frame de dano) |
| `anyOf` {events} | "When X or Y" | (composição, `emit` :1496) |
| `characterRemoved` {whose, by, filter?, orKO?} | "When … is removed from the field (by your/your opponent's effect) (or K.O.'d)" | `koCharacter` :4383; `returnToHand` :2289; `trashTarget` :2621; `opponentChoosesOwn` :3194; `toDeckBottom` :3920 |
| `characterKO` {whose, filter?} | "When a Character / your opponent's Character / your {X} Character is K.O.'d" | `koCharacter` :4381 |
| `eventActivated` {who} | "When you/your opponent activate(s) an Event" | :1161, :1253, :3469 |
| `blockerActivated` {who} | "When your opponent activates [Blocker]" | :1133 |
| `selfRested` {byOpponent?, byCharacter?} | "When this Character becomes rested (by your opponent's (Character's) effect)" | `restCard` :1606; `replaceRest` :3035 |
| `attackDamage` | "When this Character's attack deals damage to your opponent's Life" | `stepBattle` :1727 |
| `battleKO` | "When this Character battles and K.O.'s your opponent's Character" | `stepBattle` :1736 |
| `triggerActivated` {who} | "When a [Trigger] activates" | :1211 |
| `drawByEffect` | "When you draw a card outside of your Draw Phase" | `draw` :2250; `drawPerMatching` :2935 |
| `leaderBattle` {filter?} | "When your Leader … attacks or is attacked" | ataque :1321 |
| `lifeToHand` | "When a card is added to your hand from your Life" | `lifeToHandCard` :4434 |
| `returnedToHand` {whose: opponent, by: self} | "When your opponent's Character is returned to the owner's hand by your effect" | `returnToHand` :2290 |

Leitura do texto: `parseEvent` parser.ts:2407-2488.

---

## 4. Cobertura do leitor automático (parser.ts)

### 4.1 Pipeline
1. `effectLines` (:3048) usa `splitEffects` (split.ts:24, `EFFECT_START` :16) para quebrar em efeitos; opções "• …"
   e "Then, …" depois de "Choose one" são juntadas.
2. `clean` (:102-282): normaliza o texto da API — remove lembretes entre parênteses (`stripReminders` :72), uniformiza
   `DON!! −N`, `[DON!! xN]`, `{Tipo}`, corrige ~90 erros/variações conhecidos da API e de spoilers (ex.: "K.O'd",
   "Ad up to", reescreve frases fora do padrão para a forma canônica, como "If this Character would leave the field …
   If there is a [X] Character, this effect is negated" → condição + substituição :262-265).
3. `parseHeader` (:2195): marcações `[DON!! xN]`, `[Once Per Turn]`, `[Your Turn]`, `[Opponent's Turn]`, momentos
   (`TIMINGS` :46) e palavras-chave (`KEYWORDS` :36). `[Trigger]` e `[End of Your Opponent's Turn]` no texto
   principal → `null` (manual).
4. `parseLine` (:2996): sem momento → `parseStatic` (:2521); com momento → condição de ativação "If X, you may COST: Y"
   (:3006-3013), `parseCost` (:2376) e `parseBody` (:2019).
5. `parseBody`: modais (`chooseOne`), "Then, …", "This effect can be activated when …" (porta), pares especiais
   (`parseSpecialPair` :1941: `tempReplace`, troca de alvo "instead", `opponentMay`, `anyNumberForPower`), buscas
   "Look at N…; reveal…" (:2096-2140), "If X, …" (condição do passo), "If you do, …" (estende `payCost.scope` ou
   `lastDone`), orações separadas por ", then"/"and then".
6. `parseClause` (:1906): tenta as **229 regras de `CLAUSES`** (parser.ts:888-1905) em ordem; senão divide em
   " and " e tenta as duas metades; senão "… if COND" no fim.
7. `parseCard` (:3060): linha que falha vira `manualAbility` (split.ts:68: momento detectado pelas marcações, passo
   `{do:'manual', text}`; sem momento vira `static` só informativa) e vai para `unparsed`. [Trigger] não lido →
   `manualTrigger` (split.ts:87).
8. Diagnóstico: `diagnoseLine` (:2990) devolve o primeiro trecho que falhou (`fail` :62).

### 4.2 Famílias de padrões (CLAUSES, parser.ts)
| Família | Linhas | Passos gerados |
|---|---|---|
| K.O. ("K.O. up to N …", "K.O. A and B", "K.O. or rest", "K.O. or return", "Choose … and K.O. it", Stages) | 1102, 1256, 1261, 1269, 1350, 1359 | `ko`, `chooseOne` |
| Devolver à mão / fundo do deck | 889, 939, 1152, 1161, 1282, 1340, 1403, 1407, 1480 | `returnToHand`, `toDeckBottom`, `opponentChoosesOwn` |
| Poder ("Give … ±N power", "gains +N", Líder e Personagens, "for every", "an additional") | 895, 1052, 1056, 1307, 1388, 1423-1441, 1781 | `power`, `powerPerDon`, `powerPerRevealedCost` |
| Poder base / custo ("base power becomes", "Set the power/cost", copiar Líder/atacante/selecionado, trocar) | 919, 923, 973-982, 1115, 1176, 1244, 1251, 1437, 1543, 1634-1650, 1706 | `basePower`, `swapBasePower`, `cost` |
| Palavras-chave e atributos ("gains [X] (and +N)", "[Rush: Character] and attribute") | 997, 1025, 1240, 1445, 1553, 1849 | `gainKeyword`, `gainAttribute` |
| Blocker ("cannot activate [Blocker]" com poder/custo, "when attacks") | 1020, 1023, 1579, 1583, 1752, 1877-1887 | `noBlockerThisBattle`, `noBlockerWhenAttacking`, `cannotBlock` |
| Proteções ("cannot be K.O.'d … during this turn", "cannot be rested", "cannot attack") | 1217, 1221, 1229, 1690, 1771, 1775, 1801, 1891 | `cannotBeKO`, `cannotBeRested`, `cannotAttack` |
| Negar | 1013, 1236, 1314, 1525, 1609, 1615 | `negate`, `negateOnPlay` |
| Restrições ("you cannot …") e desconto | 1616-1627 | `restrict`, `nextPlayDiscount` |
| Comprar / descartar / mão | 935-936, 1140-1148, 1188, 1203, 1398, 1450-1465, 1463, 1698, 1734, 1744-1756, 1784, 1797, 1842 | `draw`, `trashFromHand`, `opponentDiscards`, `handToDeck`, `drawUntil`, … |
| Buscar/olhar/revelar deck | 1211, 1321, 1325, 1458, 1484, 1491, 1497, 1605, 1686-1687, 1760, 1900 (+ `parseBody` :2096) | `search`, `tutor`, `arrangeTop`, `revealTop`, `playRevealed`, `chooseCost` |
| Vida | 937, 996, 1059, 1061, 1170-1172, 1329, 1336, 1476, 1505, 1549, 1554-1560, 1586, 1592, 1694, 1746, 1805-1818, 1838, 1876 | `handToLife`, `fieldToLife`, `lifeToHand`, `trashLife`, `peekLife`, `arrangeLife`, … |
| Jogar (mão/descarte/deck, "each of", cor diferente, mesmo nome, oponente joga) | 904, 963, 1032, 1329, 1507, 1518, 1570, 1688, 1789, 1858 | `playFrom`, `playThis`, `handPlayOrLife`, `opponentPlays` |
| DON!! | 949, 1038-1039, 1119, 1130, 1343, 1367-1383, 1411-1419, 1472, 1514, 1534, 1596, 1683, 1702, 1748, 1786 | `giveRestedDon`, `addDonFromDeck`, `setDonActive`, `moveGivenDon`, `restDonForPower`, … |
| Refresh | 1070, 1083-1086, 1174, 1215, 1723 | `skipRefresh`, `skipRefreshDon` |
| Ataque | 910, 912, 1098, 1192, 1529, 1673, 1741, 1767 | `redirectAttack`, `attackTax`, `cannotAttackCharacters`, `canAttackActive` |
| Adiados / jogo | 1041, 1048, 1067-1068, 1145, 1171, 1727 | `delayed`, `winGame`, `extraTurn`, `takeDamage` |
| [Trigger]-only | 1214, 1789-1794 | `playThis`, `addThisToHand`, `useMainEffect`, `useCounterEffect`, `useOwnEffect` |
| Opcional sem custo "you may X" | 1823 | `payCost{cost:{}, scope}` + passos |
| Condicional embutido "X and, if Y, Z" | 1132 | passos com `if` |

Estáticos (`parseStatic` :2521-2985): regras de Líder (`parseRule` :2493), substituições (:2662-2720), reações
"When …" (:2620-2741), `battlesCharacter`, `startOfTurn`, auras ("All of your {X} type Characters gain …",
:2914-2984), proteções (`staticNoRemoval`, `staticNoEffectKO`, `staticNoBattleKO`…), custo/Counter na mão
(`handCost`, `handCostAura`, `handCounter`, `selfHandCounter`), `powerPer`, `costPer`, `staticBasePower`, `staticTaunt`.

### 4.3 O que cai no modo manual
- Qualquer linha em que **um único trecho** não case (o parser é tudo-ou-nada por linha). Casos já conhecidos no código:
  `[Trigger]` dentro do texto principal e `[End of Your Opponent's Turn]` (parser.ts:2210); palavra-chave seguida de
  texto na mesma linha (`keyword+texto`, :3001); momento de Evento em não-Evento (:3003).
- Na base atual (2711 cartas): **0 linhas manuais**. O mecanismo existe para coleções novas (spoilers/importações).
- Em jogo, a pendência `manual` (types.ts:1051) só mostra o texto e espera "Continuar"; as ferramentas `ManualOp`
  (`applyManualOp` engine.ts:4085) seguem no motor só para testes (o servidor recusa `manual` online, README).

---

## 5. Lacunas: formas de efeito / interações sem primitivo (ou só parcial)

Contagens = cartas cujo `text`/`trigger` casam com o padrão, na base local (`data/cards`, 750 entradas) e na base
completa da optcgapi (2711 cartas). Exemplos da base completa.

| # | Forma | Situação | Local / Completa | Detalhes |
|---|---|---|---|---|
| 1 | Substituição genérica ("instead") | **Parcial** | 12 / 76 | Primitivo só para K.O., remoção do campo, virar e dano (2.13); cobre ~69 cartas "would be K.O.'d/removed/rested". Sem primitivo para substituir outros acontecimentos (comprar, ir para a mão, descartar da mão, Vida…) — hoje nenhuma carta precisa. |
| 1a | Várias substituições aplicáveis ao mesmo evento | **Não existe** | — | `offerReplacement` oferece só a primeira (ordem Líder → Personagens → Stage, engine.ts:4250-4271); recusada, `performRemoval` usa `noReplace` (:4307) e as outras nunca são oferecidas. Exemplo: OP13-047 + substituição própria da vítima. |
| 1b | "would be removed from the field" sem "by your opponent" / "would leave the field" | **Parcial** | 0 / ~3 (OP17-043, EB04-044, OP05-100) | Remoção que não é K.O. só é substituída quando o efeito é do oponente (`eventOk`, :4258-4259); sair do campo por efeito próprio não oferece a substituição. "leave the field" vira `koOrRemoval` (clean :262). |
| 1c | Remoções que não oferecem substituição nem emitem `characterRemoved` | **Parcial** | — | `fieldToLife` (:3733) e `opponentChoosesOwn` (:3166) respeitam `removalBlocked`, mas não chamam `offerReplacement`; `fieldToLife` também não emite `characterRemoved`. |
| 1d | Substituição para Líder/Stage | **Não existe** | 0 / 0 | `offerReplacement` exige `zone === 'character'` (:4247). |
| 2 | "cannot be removed from the field by effects" | **Existe** (só "by your opponent's effects") | 1 / 11 | `staticNoRemoval` / `aura.noRemoval` → `removalBlocked` (:4320). Não há versão temporária ("during this turn") — 0 cartas. |
| 3 | "cannot be K.O.'d in battle" | **Existe** | 8 / 19 | `staticNoBattleKO`, `noBattleKOVsAttribute`, `noBattleKOByLeader`, `aura.noBattleKO`, `cannotBeKO{inBattle}`. |
| 4 | "cannot be K.O.'d by your opponent's effects" | **Parcial** | 7 / 17 | Vira `staticNoEffectKO` (parser.ts:2898), que em `koProtected` (:4328) também bloqueia K.O. por efeito **próprio** (só custos usam `force`). |
| 5 | "your opponent cannot activate [Blocker]" | **Existe** | 9 / 20 | `noBlockerThisBattle`, `noBlockerWhenAttacking`, `cannotBlock`. |
| 6 | "gains the effect(s) of" / copiar efeitos | **Não existe** | 0 / 0 | Só há cópia de **poder base** (`basePower.copy`, `staticBasePower:'leader'`, `aura.basePowerCopyLeader`). |
| 7 | Trocar poder | **Existe** | 0 / 3 | `swapBasePower` (troca poder base). |
| 8 | "When this card is removed from Life" | **Não existe** | 0 / 0 | `emit` só olha cartas em campo; `lifeRemoved` não carrega qual carta saiu. "When a card is removed from your/opponent's Life" existe (0 / 3). |
| 9 | Gatilhos fora do campo (na mão, no descarte) | **Não existe** | 0 / 0 | `emit` (:1490) varre só Líder, Personagens e Stage. |
| 10 | Redução estática de custo na mão | **Existe** | 5 / 17 | `handCost`, `handCostAura`, `nextPlayDiscount` → `playCost` (:736). Não vale para o custo de Eventos [Counter] (`counterOptions` :837 e pagamento :1155 usam `def.cost`). |
| 11 | Jogar esta carta do descarte / da Vida | **Existe** | 2 / 7 ("Play this (Character) card from your trash"); "play … from your trash" em geral 6 / 82; jogar da Vida fora de [Trigger]: 0 (o único acerto, OP01-008, é falso positivo) | `playThis`, `playFrom{trash}`, `playRevealed` (deck/Vida). Detalhe: no [Trigger] a carta vai ao descarte antes de resolver (:1208) e `playFree` (:1915) a marca como `from: 'trash'` → dispararia "When … is played from your trash" (OP16-079) indevidamente. |
| 12 | "base power becomes X" | **Existe** | 3 / 22 | `basePower`, `staticBasePower`, `aura.basePower`. |
| 13 | "Set the power … to 0" | **Parcial** | 0 / 2 (OP07-002, EB04-010) | Lido como `basePower` 0 (parser.ts:1646): DON!!, auras e +poder posteriores continuam somando. "Set the cost … to 0" = `cost −99` (1 carta, OP03-091). |
| 14 | Negar efeitos de Personagem/Líder | **Existe** (com ressalva) | 1 / 15 | `negate`, `aura.negate`, `negateOnPlay`, regra `ownOnPlayNegated`. `isNegated` desliga habilidades e palavras impressas, mas o [On K.O.] de um Personagem negado ainda dispara (`koCharacter` :4385-4392 não verifica, e `removeCharacter` :4397 apaga o modificador antes). |
| 15 | Vida virada para cima | **Parcial** | 12 / 48 | Há `lifeFaceUp`, `lifeFace`, `handToLife{faceUp}`, `search{toLife}`, custo `ownToLife`, `trashFaceUpLife`, `faceUpLifeMin`, regra `faceUpLifeToDeck`. Mas **`fieldToLife` ignora "face-up"** (o passo nem tem o campo; parser.ts:1336, 1814, 1818): ~16 cartas (OP04-117, OP04-097, OP05-096, OP03-123, OP11-116, EB01-053, ST09-015, OP06-103…) põem a carta virada para baixo. `trashLife`/`lifeToTrash`/`opponentLifeToBottom` não limpam `lifeFaceUp` (ids velhos, inofensivos). |
| 16 | [End of Your Opponent's Turn] / início do turno do oponente | **Não existe** | 0 / 0 | `parseHeader` recusa (:2210). |
| 17 | Restrições ao oponente ("your opponent cannot play / attack …") | **Não existe** como primitivo | 1 / 2 | `Restriction.player` é sempre quem controla o efeito (:3412) e dura só o turno. As 2 cartas ("cannot attack any card other than …") usam `staticTaunt`. |
| 18 | Ordem de efeitos automáticos simultâneos | **Não existe** | — | `emit`/`pushAbilities` empilham em ordem fixa (jogador 0 → 1, ordem do campo; pilha LIFO); o jogador do turno não escolhe a ordem nem resolve os seus primeiro. |
| 19 | "Your opponent rests N active DON!! at the start of their next Main Phase" | **Aproximado** | — | Lido como `skipRefreshDon` (parser.ts:1084). |
| 20 | Virar Personagem do oponente em `restDonOrCharacter` | **Parcial** | — | Chama `restCard(state, uid)` sem `byEffectOf` (:2798): ignora `staticNoRest`, a substituição `rest` e não emite `restedByEffect`. |
| 21 | K.O. de Stage | **Parcial** | — | `ko` em Stage vai direto ao descarte, sem proteções, substituição nem eventos (:2193-2198). |
| 22 | [On K.O.] e Once Per Turn | **Parcial** | — | `koCharacter` não confere `oncePerTurn` nem `condition` do [On K.O.]. |

Formas listadas na pergunta que **não aparecem em nenhuma carta da base** (não há demanda hoje): copiar efeitos (#6),
"when this card is removed from Life" (#8), [End of Your Opponent's Turn] (#16), "If you would take damage … instead"
(primitivo existe, 0 cartas), "gains [Trigger]".

### Contagens auxiliares (base local / completa)
`[On K.O.]` 33/161 · `[Once Per Turn]` 79/303 · `[DON!! xX]` 103/203 · `DON!! −X` 43/105 · `[Your Turn]` 31/102 ·
`[Opponent's Turn]` 15/75 · `[On Your Opponent's Attack]` 6/58 · `[End of Your Turn]` 10/51 · `[On Block]` 8/14 ·
"When …" 18/76 · "Choose one" 2/20 · "at the end of this turn/battle" 4/18 · "cannot attack" 6/39 ·
"cannot be rested" 1/12 · "you cannot" 2/19 · "any number of" 3/11 · "for every/each" 7/21 ·
regras de Líder ("according to the rules"/"Under the rules") 4/17 · [Unblockable] 1/11 · [Rush: Character] 3/10 ·
[Banish] 6/21 · [Double Attack] 10/29.
