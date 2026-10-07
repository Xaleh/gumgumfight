# Divergências do motor em relação às regras

O que o motor (`packages/engine`) faz hoje diferente das regras oficiais. Levantamento de 07/10/2026 sobre o commit `a296a24`: leitura do código e cenários executados contra o motor (marcados **[testado]**). As linhas citadas são desse commit.

Cada divergência tem um código (**DV-xx**). As que têm a mesma causa e se corrigem juntas formam um **card de correção** no Trello (coluna "Card"), para não dividir uma mudança em vários PRs.

Impacto: **alto** = muda o resultado de partidas comuns; **médio** = cartas específicas jogam errado; **baixo** = caso raro ou só cosmético.

## Resumo

| Código | Divergência | Regra | Impacto | Card |
|---|---|---|---|---|
| DV-01 | [Double Attack] com 1 de Vida vence a partida | 7-1-4-1-1-1, Q&A de regras | alto | C1 |
| DV-02 | Efeitos disparados resolvem antes (ou no meio) do efeito que os disparou | 8-6-3, 8-6-1-1 | alto | C2 |
| DV-03 | Jogador do turno não resolve os seus efeitos primeiro | 8-6-1 | alto | C2 |
| DV-04 | Auto effect de carta que já saiu do campo ainda resolve | 8-1-3-1-3 | médio | C2 |
| DV-05 | Efeitos disparados durante o dano resolvem no meio do dano | 8-6-2 | médio | C2 |
| DV-06 | Ordem dos efeitos simultâneos do mesmo jogador é fixa (sem escolha) | 6-6-1-1-3, 8-6-1 | baixo | C2 |
| DV-07 | [On K.O.] ignora [DON!! xX], condição, [Once Per Turn] e negação | 10-2-17-1, 8-2-1-1 | médio | C3 |
| DV-08 | Escolha sem "up to" aceita 0 alvos | 8-4-4-1 | médio | C4 |
| DV-09 | DON!! −X sem escolha de quais DON!! devolver | 8-3-1-6, Q&A de regras | médio | C5 |
| DV-10 | [Once Per Turn] não reinicia quando a carta sai e volta ao campo | 10-2-13-4 | médio | C6 |
| DV-11 | Só a primeira substituição aplicável é oferecida; recusar descarta as outras | 8-1-3-4-2 | médio | C7 |
| DV-12 | Remoção por efeito próprio não oferece substituição; `fieldToLife`/`opponentChoosesOwn` nunca oferecem | 8-1-3-4 | médio | C7 |
| DV-13 | "Cannot be K.O.'d by your opponent's effects" também bloqueia K.O. por efeito próprio | 1-3-1 (texto) | médio | C8 |
| DV-14 | "Cannot be K.O.'d" ignorado em custos "K.O. 1 of your Characters" | 1-3-3 | baixo | C8 |
| DV-15 | `restDonOrCharacter` vira Personagem sem passar pelas proteções | 1-3-3 | baixo | C8 |
| DV-16 | `ko` em Stage ignora proteções, substituição e eventos | 10-2-1 | baixo | C8 |
| DV-17 | Carta do [Trigger] vai para o trash **antes** de resolver | 10-1-5-3 | médio | C9 |
| DV-18 | `fieldToLife` ignora "face-up" | texto das cartas | médio | C10 |
| DV-19 | «Set Power to 0» lido como poder base 0 | 4-12 | baixo | C11 |
| DV-20 | Vários "base power becomes X": vale o último, não o maior | 4-9-2-1 | baixo | C11 |
| DV-21 | Counter da mão só pode ir para o alvo do ataque | 7-1-3-1-1, Q&A de regras | baixo | C12 |
| DV-22 | Evento [Counter] ignora redução de custo na mão | 2-7-6 | baixo | C12 |
| DV-23 | "During this battle" expira antes dos efeitos de fim de batalha | 7-1-5-2..4 | baixo | C12 |
| DV-24 | Ordem da Vida na preparação invertida | 5-2-1-7, 2-9-2-1 | baixo | C13 |
| DV-25 | "At the start of the game" roda antes da escolha de quem começa, sem escolha nem recusa | 5-2-1-5-1/2 | baixo | C13 |
| DV-26 | Derrota simultânea não empata | 9-2-1 | baixo | C13 |
| DV-27 | Laço infinito trava a partida em vez de empatar | 11-1 | baixo | C13 |
| DV-28 | "At the start of your turn" resolve depois do Draw e da DON!! Phase | 6-2-2 | baixo | C14 |
| DV-29 | "At the end of this turn" resolve antes dos [End of Your Turn] | 6-6-1-2 | baixo | C14 |
| DV-30 | Faltam momentos: "start of your opponent's turn", "start of the Main Phase", [End of Your Opponent's Turn] | 6-2-2, 6-5-1, 6-6-1-1 | baixo | C14 |
| DV-31 | "Draw up to X" vira compra obrigatória | 4-5-4 | baixo | C15 |
| DV-32 | Restrições ("you cannot ...") só valem para quem controla o efeito e só no turno | texto das cartas | baixo | C15 |
| DV-33 | Mão → Vida com filtro não revela a carta | 11-2-1 | baixo | C15 |
| DV-34 | Erratas oficiais não aplicadas ao texto das cartas | Errata oficial | médio | C16 |
| DV-35 | README "Regras implementadas" desatualizado (corrigido) | — | baixo | — |

Pontos **conformes** conferidos (não precisam de card): mulligan; Refresh, Draw e DON!! Phase; ninguém ataca no primeiro turno; +1000 por DON!! só no próprio turno; DON!! voltam rested quando a carta sai; alvos de ataque; checagem de saída de cena ao fim de cada etapa da batalha; [Blocker] (uma vez, não rested, não o próprio alvo) e [Unblockable]; [Banish]; dano um a um e [Trigger] antes do 2º dano; limite de 5 Personagens como regra (sem [On K.O.]); K.O. vs. trash; [Counter] e [Main] só nos momentos certos; custo negativo vale 0 (somando o negativo); poder negativo não trasha; informação oculta (`view.ts` e decisões que sempre abrem). A lista completa por regra está no fim deste arquivo.

---

## Detalhes

### C1 — Vitória por dano

**DV-01. [Double Attack] com 1 de Vida vence a partida** — alto **[testado]**
- Regra: 7-1-4-1-1-1 — o atacante vence se o oponente tem 0 de Vida **no momento em que se determina que haverá dano**. Q&A de regras: "If my opponent has 1 Life card, can I win the game by using a [Double Attack] to deal 2 damage? — No, you cannot."
- Atual: `stepDamage` (engine.ts:1765) repete o ponto de dano; no 2º ponto, com 0 de Vida, chama `gameOver`.
- Correto: checar a vitória só antes do 1º ponto do dano de ataque; pontos seguintes sem Vida não fazem nada.
- Cenário: Kouzuki Oden ST09-005 (Double Attack) ataca um Líder com 1 de Vida → o motor declara vitória; o certo é o oponente ficar com 0 e a partida seguir.
- A confirmar junto: dano de **efeito** de 2 ou mais com 1 de Vida (hoje perde no 2º ponto; o Q&A só fala de Double Attack) e a substituição de dano oferecida com 0 de Vida (`stepDamage` :1777).
- Onde: `engine.ts` (`stepBattle` caso `damage`, `stepDamage`; marcar no frame se o dano é de ataque).

### C2 — Fila de efeitos disparados (ordem de resolução)

Causa comum: `state.stack` é uma pilha LIFO, e os auto effects são empilhados (`pushEffect`) **no momento do acontecimento** (`emit` engine.ts:1490, `pushAbilities` :1623, `koCharacter` :4359), por cima do efeito que ainda está resolvendo. A correção é uma fila de "efeitos disparados e ainda não ativados", esvaziada quando o efeito atual termina, na ordem de 8-6-1.

**DV-02. Efeitos disparados resolvem antes (ou no meio) do efeito que os disparou** — alto **[testado]**
- Regra: 8-6-3 (o efeito disparado por usar uma carta espera ela resolver); 8-6-1-1 (C, disparado por A, resolve depois de B). Q&A OP03-094 Air Door, OP11-012 Franky, OP12-056 Garp.
- Atual: em `playCard` (engine.ts:1252) o Evento é empilhado e logo em seguida `emit('eventActivated')` empilha as reações **por cima** — elas resolvem primeiro. O mesmo acontece no Counter (:1160) e no [Trigger] (:1210).
- Cenários: (a) Líder Crocodile OP01-062 ("When you activate an Event, you may draw 1 card if you have 4 or less cards") com 5 cartas joga Great Eruption ST06-015: o motor compra pelo Crocodile antes do Evento (mão final 6); o certo é o Evento resolver primeiro e o Crocodile não comprar (mão 5). (b) Brachio Bomber ST04-015 ("K.O. …, then add up to 1 DON!!") nocauteia Caribou OP01-007: o [On K.O.] do Caribou resolve entre o K.O. e o "then".

**DV-03. Jogador do turno não resolve os seus efeitos primeiro** — alto **[testado]**
- Regra: 8-6-1, 1-3-10.
- Atual: `emit` percorre o jogador 0 e depois o 1, empilhando; com LIFO, o jogador 1 sempre resolve primeiro, seja ou não o jogador do turno — o resultado depende do assento. Em `koCharacter` o [On K.O.] é empilhado depois das reações ao K.O. e resolve antes delas.
- Cenário: P0 (turno, Líder Kaido OP01-061, "when your opponent's Character is K.O.'d") nocauteia Caribou de P1 → pilha `Brachio(P0) > Kaido(P0) > Caribou(P1)`: o [On K.O.] de P1 resolve primeiro.

**DV-04. Auto effect de carta que já saiu do campo ainda resolve** — médio **[testado]**
- Regra: 8-1-3-1-3 (se a carta sai da área antes de o efeito ser ativado, ele não ativa), 10-2-16. Q&A OP11-049 Carrot, OP04-024 Sugar, OP05-075 Mr.1.
- Atual: o efeito é "ativado" ao ser empilhado; `stepEffect` (engine.ts:1805) não confere se a fonte continua na área.
- Cenário: Nico Robin OP01-017 ataca; o [When Attacking] dela nocauteia Gordon ST16-002; o [On Your Opponent's Attack] do Gordon (já no trash) ainda abre as escolhas.
- Exceção a manter: [On K.O.] (resolve com a carta no trash, 10-2-17).

**DV-05. Efeitos disparados durante o dano resolvem no meio do dano** — médio
- Regra: 8-6-2 (só o próprio [Trigger] interrompe o dano, 8-6-2-1). Q&A OP05-098 Enel, OP13-002 Ace, OP08-105 Bonney.
- Atual: `damageTaken`/`damageDealt`/`lifeRemoved` já esperam o fim do dano (correto), mas `lifeToHandCard` (engine.ts:4425) emite `lifeToHand` na hora, e efeitos disparados pela resolução do [Trigger] (ex.: o [On K.O.] de quem o Trigger nocauteou) resolvem antes do 2º dano.
- Cenário: Double Attack; a 1ª Vida é ST01-015 (Trigger que dá K.O.), que nocauteia Caribou OP01-007 do atacante; o [On K.O.] do Caribou resolve antes do 2º dano, quando deveria vir depois.

**DV-06. Ordem fixa entre efeitos simultâneos do mesmo jogador** — baixo
- Regra: 6-6-1-1-3 (o jogador do turno escolhe a ordem dos seus [End of Your Turn]); 8-6-1-1 e Q&A OP10-042 Usopp, OP04-058 Crocodile, OP06-086 Moria (o dono escolhe a ordem).
- Atual: ordem fixa (Stage → Personagens do último para o primeiro → Líder).
- Correto: quando houver 2 ou mais efeitos do mesmo jogador prontos, perguntar a ordem (pode ser um `pending` de "escolha qual resolver primeiro").

### C3 — [On K.O.]

**DV-07. [On K.O.] ignora [DON!! xX], condição, [Once Per Turn] e negação** — médio **[testado]**
- Regra: 10-2-17-1 (as condições são checadas **no campo**, antes de a carta ir para o trash); 8-2-1-1 (efeito negado não ativa). Q&A OP01-061 Kaido, OP06-074 Zephyr, OP09-093 Teach.
- Atual: `koCharacter` (engine.ts:4385) só confere [Your Turn]/[Opponent's Turn], depois de `removeCharacter` já ter apagado os modificadores (`negated` incluso).
- Cenário: Jewelry Bonney ST21-004 "[DON!! x2] [On K.O.] Draw 1 card" nocauteada sem DON!! → compra 1 (não deveria). Personagem com efeitos negados também ativa o [On K.O.].
- Correto: avaliar `conditionsMet` (DON!!, condição, negação, [Once Per Turn]) antes de mover a carta; depois mover e resolver.

### C4 — Escolha obrigatória

**DV-08. Escolha sem "up to" aceita 0 alvos** — médio
- Regra: 8-4-4-1 (sem "up to", escolhe-se o máximo possível até o número pedido).
- Atual: `resolveTargets` (engine.ts:1857) sempre abre `selectTargets` com `min: 0`; `TargetSpec` não diz se a escolha é obrigatória.
- Cenários: Líder Trafalgar Law OP01-002 com 5 Personagens ("return 1 of your Characters to the owner's hand. Then, play up to 1…"): dá para devolver 0 e mesmo assim jogar. OP07-036: confirma "you may rest 1", escolhe 0 e o "If you do" ainda acontece.
- Onde: `types.ts` (`TargetSpec`: campo de escolha obrigatória), `engine.ts` (`resolveTargets`), `cards/parser.ts` (marcar textos sem "up to").

### C5 — DON!! −X

**DV-09. DON!! −X sem escolha de quais DON!! devolver** — médio **[testado]**
- Regra: 8-3-1-6, 10-2-10-1, 3-9-2. Q&A de regras: "You can choose to return any DON!! cards from your Leader area, Stage area, Character area, or cost area." Q&A OP02-085 Magellan: quem escolhe é o dono.
- Atual: `returnDon` (engine.ts:4411) devolve primeiro os rested, depois os **active** e só então os dados, sem perguntar.
- Cenário: Shanks ST05-001 com 3 DON!! active e 3 dados ao Líder paga "DON!! −3": o motor devolve os 3 active (sobra 0 para jogar cartas); o jogador queria devolver os 3 do Líder.
- Onde: `returnDon`, `payImmediateCost`, `returnDonChoice`, `canPayCost`. O mesmo vale para `opponentReturnsDon` (o oponente escolhe os dele).

### C6 — [Once Per Turn]

**DV-10. [Once Per Turn] não reinicia quando a carta sai e volta ao campo** — médio **[testado]**
- Regra: 10-2-13-4, 3-1-6 (é uma carta nova).
- Atual: `usedThisTurn` guarda `uid:índice` e só é zerado no fim do turno (engine.ts:1419); `removeCharacter` não limpa.
- Cenário: Jinbe ST14-004 usa o [Activate: Main], volta para a mão, é jogado de novo → "Já usada neste turno."
- Onde: limpar as chaves do uid em `removeCharacter`/`detach`.

### C7 — Substituição ("instead")

**DV-11. Só a primeira substituição aplicável é oferecida; recusar descarta as outras** — médio
- Regra: 8-1-3-4-2 (primeiro a da carta afetada, depois as do jogador do turno na ordem que ele escolher, depois as do outro). Q&A OP05-001 Sabo (recusar não gasta o [Once Per Turn]).
- Atual: `offerReplacement` (engine.ts:4240) devolve a primeira habilidade elegível (Líder → Personagens → Stage → `tempReplacements`); se recusada, `performRemoval(..., noReplace)` (:4307) remove sem oferecer as outras. A substituição da própria carta não tem precedência.
- Cenário: Líder com "If your Character would be K.O.'d, you may … instead" + Personagem com "If this Character would be K.O.'d, you may … instead": recusar a do Líder leva direto ao K.O.
- Outros simuladores tiveram o mesmo bug (OPTCGSim 1.43a; OPlayTCG oferece em cadeia — ver [interacoes/14](interacoes/14-comunidade-e-simuladores.md)).

**DV-12. Remoções que não oferecem substituição** — médio
- Atual: (a) remoção que não é K.O. só é substituída quando o efeito é do oponente (`eventOk`, engine.ts:4258), então "would be removed from the field" sem "by your opponent" não se aplica a efeito próprio; (b) `fieldToLife` (:3733) e `opponentChoosesOwn` (:3166) respeitam `removalBlocked`, mas não chamam `offerReplacement`; `fieldToLife` também não emite `characterRemoved`; (c) não há substituição para Líder/Stage (hoje nenhuma carta precisa).
- Cartas afetadas: as com "would be removed from the field" / "would leave the field" (ex.: OP17-043, EB04-044, OP05-100) e qualquer substituição contra "place at the bottom of the Life" ou "your opponent chooses".
- Remoções simultâneas: um pagamento salva todos (Q&A OP15-009, OP11-001, OP05-001) — conferir no conserto.

### C8 — Proteções e proibições

**DV-13. "Cannot be K.O.'d by your opponent's effects" também bloqueia K.O. por efeito próprio** — médio
- Atual: vira `staticNoEffectKO` (parser.ts:2898), que em `koProtected` (engine.ts:4328) bloqueia qualquer K.O. por efeito.
- Correto: só efeitos do oponente. ~17 cartas usam o texto.

**DV-14. "Cannot be K.O.'d" ignorado em custos de K.O.** — baixo
- Regra: 1-3-3 (proibição vence exigência); um custo que não pode ser pago não é pago (8-3-1-3).
- Atual: `koOwn` (engine.ts:2592) e `koSelf` (:3400) usam `force: true`.
- Correto: o Personagem protegido não serve para pagar o custo (ou, se a carta pedir, o custo não pode ser pago).

**DV-15. `restDonOrCharacter` vira Personagem sem passar pelas proteções** — baixo
- Atual: chama `restCard(state, uid)` sem `byEffectOf` (engine.ts:2798): ignora "cannot be rested" (`staticNoRest`), a substituição de rest e não emite `restedByEffect`.

**DV-16. `ko` em Stage ignora proteções, substituição e eventos** — baixo
- Atual: K.O. em Stage vai direto ao trash (engine.ts:2193). Só cartas que dizem "K.O. … Stage" podem fazer isso (Q&A OP13-098: um efeito que mira Personagens não alcança Stage).

### C9 — [Trigger]

**DV-17. A carta do [Trigger] vai para o trash antes de resolver** — médio
- Regra: 10-1-5-3 (enquanto o Trigger resolve, a carta não está em área nenhuma; vai para o trash depois). Q&A OP14-082 Oinkchuck, OP09-100 Karasu, OP15-097, OP15-079 Absalom.
- Atual: `ps.trash.push(card)` antes de `pushEffect` (engine.ts:1208).
- Consequências: contagens de trash incluem a carta (OP15-097 dá 10 em vez de 9); um [Trigger] "Play this card" sai como `from: 'trash'` (`playFree` :1915) e dispara "when a Character is played from your trash" (OP16-079); "add this card from your trash" pelo Trigger funcionaria quando não deveria.
- Correto: "limbo" durante a resolução; trash ao fim do frame, salvo se o efeito moveu a carta.

### C10 — Vida virada para cima

**DV-18. `fieldToLife` ignora "face-up"** — médio
- Atual: o passo `fieldToLife` não tem o campo `faceUp` (parser.ts:1336, 1814, 1818).
- Cartas: ~16, ex.: OP04-117, OP04-097, OP05-096, OP03-123, OP11-116, EB01-053, ST09-015, OP06-103 — põem a carta virada para baixo, escondendo do oponente uma carta que deveria ser pública (3-10-2-1).

### C11 — Poder base e «Set Power to 0»

**DV-19. «Set Power to 0» lido como poder base 0** — baixo
- Regra: 4-12 (reduz pelo valor do poder atual no momento da ativação; se já negativo, nada). Q&A OP07-002 Ain: com «Set Power to 0» e depois [Counter +1000], fica 1000.
- Atual: "Set the power of X to 0" vira `basePower: 0` (parser.ts:1646); DON!!, auras e bônus continuam somando por cima do 0, e o efeito não reage a poder negativo.
- Cartas: OP07-002, EB04-010.

**DV-20. Vários "base power becomes X": vale o último, não o maior** — baixo
- Regra: 4-9-2-1. Q&A ST34-004 Linlin, OP17-008 Jozu.
- Atual: `getPower` (engine.ts:589) aplica em sequência (aura → estático → modificador) e o último vence.

### C12 — Counter Step e fim de batalha

**DV-21. Counter da mão só pode ir para o alvo do ataque** — baixo
- Regra: 7-1-3-1-1 ("Leader or 1 Character card"). Q&A de regras: "Can I use a Counter to increase the power of a card not being attacked? Yes … the effect will end at the end of the current battle."
- Atual: engine.ts:1151 aplica sempre no alvo.

**DV-22. Evento [Counter] ignora redução de custo na mão** — baixo
- Atual: `counterOptions` (engine.ts:837) e o pagamento (:1155) usam `def.cost`, não `playCost`.

**DV-23. "During this battle" expira antes dos efeitos de fim de batalha** — baixo
- Regra: 7-1-5-2 (ativam os "at the end of this battle"), depois 7-1-5-3/4 (expira "during this battle").
- Atual: engine.ts:1744 remove os modificadores `battle` antes de empilhar os efeitos de fim de batalha; `state.battle` já é `null` para eles.

### C13 — Preparação e fim de partida

**DV-24. Ordem da Vida na preparação invertida** — baixo **[testado]**
- Regra: 5-2-1-7, 2-9-2-1 (a carta do topo do deck fica **no fundo** da Vida). Q&A de regras.
- Atual: `pl.life.unshift(pl.deck.shift())` (engine.ts:1098) deixa a carta do topo do deck no topo da Vida (a Vida tem o topo no fim do array). O comentário do código diz o contrário.
- Correto: `pl.life.push(pl.deck.shift()!)`. Atenção: muda replays e testes que dependem da seed.

**DV-25. "At the start of the game" fora de hora e sem escolha** — baixo
- Regra: 5-2-1-5-1/2 (depois da escolha de quem começa; quem escolheu processa primeiro; "up to 1" permite recusar; o deck é reembaralhado). Q&A OP13-079 Imu.
- Atual: a regra `startStage` roda em `createGame` (engine.ts:133), antes da escolha de primeiro/segundo, e pega o primeiro Stage elegível sem perguntar.

**DV-26. Derrota simultânea não empata** — baixo
- Regra: 9-2-1 (todos que cumprem a condição perdem → empate). Em torneio de eliminação simples, perde o jogador do turno (TRM 5.2).
- Atual: `checkDefeat` (engine.ts:4449) encerra no primeiro jogador; não há empate em `winner`.

**DV-27. Laço infinito trava a partida** — baixo
- Regra: 11-1 (empate, ou o jogador que pode parar diz quantas vezes repete).
- Atual: `run` (engine.ts:1449) lança `Error` depois de 5000 passos.

### C14 — Momentos do turno

**DV-28. "At the start of your turn" resolve depois do Draw e da DON!! Phase** — baixo
- Regra: 6-2-2 (no Refresh, antes de devolver DON!! e desvirar). Q&A OP11-040 Luffy.
- Atual: `startTurn` (engine.ts:1357) só empilha o efeito; ele resolve depois de devolver DON!!, desvirar, comprar e da DON!! Phase.

**DV-29. "At the end of this turn" resolve antes dos [End of Your Turn]** — baixo
- Regra: 6-6-1-2 (primeiro todos os [End of …]; depois os "at the end of this turn"). Q&A ST24-005 X.Drake.
- Atual: `state.delayed` é empilhado depois dos [End of Your Turn] (engine.ts:1333) e resolve antes deles; atrasados criados durante a End Phase ficam para o turno seguinte.

**DV-30. Momentos que faltam** — baixo
- "At the start of your opponent's turn" (6-2-2), "at the start of the Main Phase" (6-5-1), [End of Your Opponent's Turn] (6-6-1-1-2/4). Hoje nenhuma carta da base usa (0 cartas), mas o parser recusa [End of Your Opponent's Turn] (parser.ts:2210) e a carta cairia no modo manual.

### C15 — Pequenas formas de efeito

**DV-31. "Draw up to X" vira compra obrigatória** — baixo
- Regra: 4-5-4. Atual: o passo `draw` não tem `upTo` (engine.ts:2246). Cenário: OP02-066 compra 2 à força.

**DV-32. Restrições só valem para quem controla o efeito e só no turno** — baixo
- Atual: `Restriction.player` é sempre o controlador e dura até o fim do turno (engine.ts:3412). Cartas "your opponent cannot …" ou "until the end of your opponent's next turn" precisariam de alvo e duração.

**DV-33. Mão → Vida com filtro não revela a carta** — baixo (a confirmar)
- Regra: 11-2-1 (mover de área secreta para secreta revela). Atual: `handToLife` (engine.ts:3701) só registra a quantidade.

### C16 — Dados e documentação

**DV-34. Erratas oficiais não aplicadas ao texto das cartas** — médio
- Regra: a errata vale para todos os formatos e vence o texto impresso.
- Atual: `data/cards` (e a importação da optcgapi) trazem o texto antigo. Conferido em `data/cards`:

| Carta | Texto nos dados | Errata |
|---|---|---|
| OP01-002 Trafalgar Law | "return 1 of your Characters to your hand" | "to the owner's hand" |
| OP01-003 Monkey.D.Luffy | "{Supernova} or {Straw Hat Crew} type" | "{Supernovas}" (o tipo certo; com "Supernova" o filtro de tipo pode falhar) |
| OP02-002 Monkey.D.Garp | "When this Leader or 1 of your Characters is given a DON!! card" | "or **any** of your Characters" |
| OP02-071 Magellan | "When a DON!! card on your field is returned" | "on **the** field" (vale também DON!! do oponente) |
| ST02-013 Eustass"Captain"Kid | "Set this card as active" | "Set this **Character** as active" |
| ST04-001 Kaido | "Trash up to 1 of your opponent's Life cards" | "Trash up to 1 of your opponent's cards **from the top** of their Life cards" |
| ST14-014 Gum-Gum Giant Rifle | "If you have a Character with a cost of 8 or more" | "If **there is** a Character…" (inclui o lado do oponente) |

  Erratas posteriores (fora de `data/cards`, entram pela importação): OP09-058 Special Muggy Ball (**o oponente escolhe**), OP13-119 Portgas.D.Ace (versão Wanted Poster: texto todo trocado), OP13-077 ("during this **battle**"), OP15-023 Arlong (sem "rested"), OP16-081 Otama ("If there is"), OP05-032 Pica (sem "up to"), OP03-054 e OP03-047 (posição do "you may"), OP14-009 e OP06-034 (tipos). Lista completa em [fontes.md](fontes.md).
- Correto: tabela de erratas aplicada na importação (`apps/server/src/card-import.ts` / `optcgapi.ts`) e nos dados do repositório, com teste.

**DV-35. README "Regras implementadas" desatualizado** — baixo — **corrigido junto com esta base**
- Diz que substituição, [End of Your Turn] e DON!! −X não existem; os três existem (timing `replace`, `endOfTurn`, `AbilityCost.donMinus`). Não menciona as limitações reais (C2). Atualizar e apontar para `docs/rules/`.

---

## Itens a confirmar (sem ruling oficial claro)

- Dano de efeito de 2 ou mais com 1 de Vida (hoje perde no 2º ponto). O Q&A EB03-055 Robin diz que dano de efeito com 0 de Vida vence; não há ruling para "2 de dano de efeito com 1 de Vida".
- Substituição de dano ("If you would take damage, … instead") oferecida mesmo com 0 de Vida.
- `handCounter.set` sobrescrevendo um Counter maior (CR 2-10-4: vale o maior).
- Cadeia "If … Then …" (4-10): depende de o parser marcar o `if` em todos os passos seguintes; vale um teste por carta com "If … Then".
- `cancel` e `detachDon` (desfazer) estão fora das regras oficiais — o Q&A proíbe mover DON!! já dado. São conveniências de interface protegidas contra vazamento; manter documentado.

## Conferência completa por regra

| Área | Conforme | Divergente |
|---|---|---|
| Preparação e derrota (1-2, 5-2, 9) | Escolha de primeiro/segundo, mulligan, derrota por dano sem Vida e por deck 0 (checada a cada passo), desistência, vitória por efeito | DV-24, DV-25, DV-26 |
| Fases (6) | Expiração "until the start of your next turn", devolver DON!! e desvirar, Draw, DON!! Phase, sem ataque no 1º turno, [End of Your Turn] uma vez, expiração de "this turn" | DV-06, DV-28, DV-29, DV-30 |
| DON!! (6-5-5, 8-3) | Dar DON!!, +1000 só no próprio turno, DON!! voltam rested, [DON!! xX] | DV-09 |
| Batalha (7) | Alvos, [When Attacking] antes de [On Your Opponent's Attack], saída de cena ao fim de cada etapa, [Blocker], [On Block], vários Counters, ≥ vence, Double Attack fixo em 2, [Banish], K.O. do perdedor, efeitos de fim de batalha | DV-01, DV-21, DV-22, DV-23 |
| Dano e [Trigger] (4-6, 10-1-5) | Dano um a um, [Trigger] no lugar de ir para a mão, recusar sem revelar, Trigger antes do 2º dano, `damageTaken`/`lifeRemoved` depois do dano | DV-05, DV-17 |
| Efeitos (8) | "may" e custos opcionais, auto effect por ocorrência, custo tudo-ou-nada, [Once Per Turn] por carta, substituição opcional e não reaplicada, "up to" 0, busca pode não achar, [On K.O.] só por K.O., "cannot be K.O.'d" só contra K.O., auto effects não ativam em área secreta, [Trigger] de Evento não é "activate an Event" | DV-02, DV-03, DV-04, DV-07, DV-08, DV-10, DV-11, DV-12, DV-13, DV-14, DV-19, DV-20 |
| Áreas e outros (3, 10, 11) | Limite de 5 como regra, Stage único, carta nova ao sair do campo, Líder não se move, Rush/Rush: Character, entrar rested, poder negativo, custo negativo = 0, Vida do topo, Vida virada para cima pública, revelar na busca, olhar e devolver, [Main]/[Activate: Main] fora de batalha, [Counter] só no Counter Step | DV-16, DV-18, DV-27, DV-33 |
| Informação oculta (`view.ts`) | Mão/deck/Vida escondidos, contagens abertas, trash aberto, "look at" só para quem olha, revelada volta a ficar oculta, decisões que leem a mão sempre abrem, log secreto | — |
