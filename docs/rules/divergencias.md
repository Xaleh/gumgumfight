# Divergências do motor em relação às regras

O que o motor (`packages/engine`) faz hoje diferente das regras oficiais. Levantamento de 07/10/2026 sobre o commit `a296a24`: leitura do código e cenários executados contra o motor (marcados **[testado]**). As linhas citadas são desse commit.

Cada divergência tem um código (**DV-xx**). As que têm a mesma causa e se corrigem juntas formam um **card de correção** no Trello (coluna "Card"), para não dividir uma mudança em vários PRs.

Impacto: **alto** = muda o resultado de partidas comuns; **médio** = cartas específicas jogam errado; **baixo** = caso raro ou só cosmético.

## Resumo

| Código | Divergência | Regra | Impacto | Card |
|---|---|---|---|---|
| DV-01 | [Double Attack] com 1 de Vida vence a partida (**corrigido**) | 7-1-4-1-1-1, Q&A de regras | alto | C1 |
| DV-02 | Efeitos disparados resolvem antes (ou no meio) do efeito que os disparou (**corrigido**) | 8-6-3, 8-6-1-1 | alto | C2 |
| DV-03 | Jogador do turno não resolve os seus efeitos primeiro (**corrigido**) | 8-6-1 | alto | C2 |
| DV-04 | Auto effect de carta que já saiu do campo ainda resolve (**corrigido**) | 8-1-3-1-3 | médio | C2 |
| DV-05 | Efeitos disparados durante o dano resolvem no meio do dano (**corrigido**) | 8-6-2 | médio | C2 |
| DV-06 | Ordem dos efeitos simultâneos do mesmo jogador é fixa (sem escolha) (**corrigido**) | 6-6-1-1-3, 8-6-1 | baixo | C2 |
| DV-07 | [On K.O.] ignora [DON!! xX], condição, [Once Per Turn] e negação (**corrigido**) | 10-2-17-1, 8-2-1-1 | médio | C3 |
| DV-08 | Escolha sem "up to" aceita 0 alvos (**corrigido**) | 8-4-4-1 | médio | C4 |
| DV-09 | DON!! −X sem escolha de quais DON!! devolver (**corrigido**) | 8-3-1-6, Q&A de regras | médio | C5 |
| DV-10 | [Once Per Turn] não reinicia quando a carta sai e volta ao campo (**corrigido**) | 10-2-13-4 | médio | C6 |
| DV-11 | Só a primeira substituição aplicável é oferecida; recusar descarta as outras (**corrigido**) | 8-1-3-4-2 | médio | C7 |
| DV-12 | Remoção por efeito próprio não oferece substituição; `fieldToLife`/`opponentChoosesOwn` nunca oferecem (**corrigido** em efeitos; custos ficam de fora) | 8-1-3-4 | médio | C7 |
| DV-13 | "Cannot be K.O.'d by your opponent's effects" também bloqueia K.O. por efeito próprio (**corrigido**) | 1-3-1 (texto) | médio | C8 |
| DV-14 | "Cannot be K.O.'d" ignorado em custos "K.O. 1 of your Characters" (**corrigido**) | 1-3-3 | baixo | C8 |
| DV-15 | `restDonOrCharacter` vira Personagem sem passar pelas proteções (**corrigido**) | 1-3-3 | baixo | C8 |
| DV-16 | `ko` em Stage ignora proteções, substituição e eventos (**corrigido**) | 10-2-1 | baixo | C8 |
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
| DV-29 | "At the end of this turn" resolve antes dos [End of Your Turn] (**corrigido em parte**) | 6-6-1-2 | baixo | C14 |
| DV-30 | Faltam momentos: "start of your opponent's turn", "start of the Main Phase", [End of Your Opponent's Turn] | 6-2-2, 6-5-1, 6-6-1-1 | baixo | C14 |
| DV-31 | "Draw up to X" vira compra obrigatória | 4-5-4 | baixo | C15 |
| DV-32 | Restrições ("you cannot ...") só valem para quem controla o efeito e só no turno | texto das cartas | baixo | C15 |
| DV-33 | Mão → Vida com filtro não revela a carta | 11-2-1 | baixo | C15 |
| DV-34 | Erratas oficiais não aplicadas ao texto das cartas (**corrigido**) | Errata oficial | médio | C16 |
| DV-35 | README "Regras implementadas" desatualizado (corrigido) | — | baixo | — |
| DV-36 | Nomes e tipos da optcgapi diferentes da lista oficial (**corrigido**) | Lista oficial de cartas | médio | — |
| DV-37 | Cartas promocionais (P-xxx) fora da importação e com número errado (**corrigido**) | Lista oficial de cartas | médio | — |

## Cards de correção no Trello

Todos na lista "Planejamento" do quadro GumGum Fight, com etiqueta vermelha (bug).

| Card | Trello | Assunto |
|---|---|---|
| C1 | <https://trello.com/c/0La1Qxs2> | [Double Attack] contra 1 de Vida (DV-01) |
| C2 | <https://trello.com/c/hhReaY8H> | Fila de efeitos disparados (DV-02 a DV-06) |
| C3 | <https://trello.com/c/zM6n04ML> | [On K.O.] no campo (DV-07) |
| C4 | <https://trello.com/c/4MAOfZqn> | Escolha sem "up to" (DV-08) |
| C5 | <https://trello.com/c/WZssyGGP> | DON!! −X com escolha (DV-09) |
| C6 | <https://trello.com/c/T9waeyO3> | [Once Per Turn] ao voltar ao campo (DV-10) |
| C7 | <https://trello.com/c/p5CPd7X6> | Substituições (DV-11, DV-12) |
| C8 | <https://trello.com/c/sfJffgZI> | Proteções e proibições (DV-13 a DV-16) |
| C9 | <https://trello.com/c/VknBMmyg> | Carta do [Trigger] sem área (DV-17) |
| C10 | <https://trello.com/c/ZCOe5kVk> | Vida virada para cima a partir do campo (DV-18) |
| C11 | <https://trello.com/c/HWy6Ks09> | «Set Power to 0» e poder base (DV-19, DV-20) |
| C12 | <https://trello.com/c/x7dM5bMu> | Counter Step e fim de batalha (DV-21 a DV-23) |
| C13 | <https://trello.com/c/RE2Z2216> | Preparação e fim de partida (DV-24 a DV-27) |
| C14 | <https://trello.com/c/6egd4DaI> | Momentos do turno (DV-28 a DV-30) |
| C15 | <https://trello.com/c/OfoyXyOm> | "Draw up to", restrições, revelar (DV-31 a DV-33) |
| C16 | <https://trello.com/c/SG4w3tB2> | Erratas nos dados (DV-34) |

Pontos **conformes** conferidos (não precisam de card): mulligan; Refresh, Draw e DON!! Phase; ninguém ataca no primeiro turno; +1000 por DON!! só no próprio turno; DON!! voltam rested quando a carta sai; alvos de ataque; checagem de saída de cena ao fim de cada etapa da batalha; [Blocker] (uma vez, não rested, não o próprio alvo) e [Unblockable]; [Banish]; dano um a um e [Trigger] antes do 2º dano; limite de 5 Personagens como regra (sem [On K.O.]); K.O. vs. trash; [Counter] e [Main] só nos momentos certos; custo negativo vale 0 (somando o negativo); poder negativo não trasha; informação oculta (`view.ts` e decisões que sempre abrem). A lista completa por regra está no fim deste arquivo.

---

## Detalhes

### C1 — Vitória por dano

**DV-01. [Double Attack] com 1 de Vida vence a partida** — alto — **corrigido**
- Regra: 7-1-4-1-1-1 — o atacante vence se o oponente tem 0 de Vida **no momento em que se determina que haverá dano**. Q&A de regras: "If my opponent has 1 Life card, can I win the game by using a [Double Attack] to deal 2 damage? — No, you cannot."
- Antes: `stepDamage` repetia o ponto de dano e, no 2º ponto, com 0 de Vida, chamava `gameOver`.
- Agora: o frame de dano de ataque tem `attack: true`; a vitória por 0 de Vida só é decidida antes do 1º ponto. Os pontos seguintes sem Vida não fazem nada e ficam no log. Se a Vida voltar entre os danos (ex.: [Trigger] que adiciona Vida, Q&A OP03-118), o 2º dano a tira normalmente. Vale também com [Banish].
- Dano de **efeito** (passo `takeDamage`) continua ponto a ponto, pela leitura literal de 1-2-1-1-1 / 9-2-1-1 ("Leader takes damage when that player has 0 Life cards"): 2 de dano de efeito contra 1 de Vida vencem. Não há Q&A sobre esse caso; o Q&A EB03-055 Robin confirma só que dano de efeito com 0 de Vida vence.
- Testes: `packages/engine/test/engine.test.ts`, bloco "Double Attack contra 1 de Vida".

### C2 — Fila de efeitos disparados (ordem de resolução) — **corrigido**

Antes: `state.stack` era uma pilha LIFO e os auto effects eram empilhados (`pushEffect`) **no momento do acontecimento**, por cima do efeito que ainda estava resolvendo.

Agora (`engine.ts`, seção "Efeitos disparados (CR 8-6)"): os auto effects ([On Play], [When Attacking], [On Your Opponent's Attack], [On Block], [On K.O.], [End of Your Turn], "When …", fim de batalha) vão para a fila `state.triggered` e só entram na pilha quando **não há nenhum efeito nem dano em resolução**, um de cada vez:
- em ordem de disparo; os disparados juntos (mesmo lote) resolvem primeiro os do **jogador do turno**, depois os do outro;
- se o jogador da vez tem 2 ou mais efeitos de **cartas diferentes** no mesmo lote, ele escolhe a ordem (pendência `option` com `order`; o bot pega a primeira; o oponente vê só que há uma escolha);
- na hora de ativar, a carta precisa continuar no campo e as condições da habilidade ([DON!! xX], [Your Turn], "if you have…") precisam valer (8-1-3-1-3, 8-4-1-1); senão o efeito não ativa (fica no log) e o [Once Per Turn] é devolvido. [On K.O.] e efeitos adiados ("at the end of this turn/battle") resolvem mesmo com a carta fora do campo.
- Efeitos que fazem parte do processamento continuam imediatos: o [Trigger] (interrompe o dano), as perguntas de substituição, o custo de ataque, "Activate this card's [Main]".

Testes: `packages/engine/test/trigger-order.test.ts` (os 5 cenários abaixo e a escolha de ordem). Replays passam para a versão 4 (`replay.ts`): replays antigos ganham a resposta implícita da escolha de ordem, mas, com a nova ordem de resolução, um replay antigo com efeitos encadeados pode tomar outro rumo.

**DV-02. Efeitos disparados resolvem antes (ou no meio) do efeito que os disparou** — alto — **corrigido**
- Regra: 8-6-3 (o efeito disparado por usar uma carta espera ela resolver); 8-6-1-1 (C, disparado por A, resolve depois de B). Q&A OP03-094 Air Door, OP11-012 Franky, OP12-056 Garp.
- Cenários testados: (a) Líder Crocodile OP01-062 com 5 cartas joga Great Eruption ST06-015 → o Evento resolve primeiro (mão volta a 5) e o Crocodile não compra (antes: mão 6). (b) Brachio Bomber ST04-015 nocauteia Caribou OP01-007 → o "then add 1 DON!!" acontece antes do [On K.O.] do Caribou.

**DV-03. Jogador do turno não resolve os seus efeitos primeiro** — alto — **corrigido**
- Regra: 8-6-1, 1-3-10.
- Cenário testado nos dois assentos: Líder Kaido OP01-061 do jogador do turno resolve antes do [On K.O.] de Caribou do oponente.

**DV-04. Auto effect de carta que já saiu do campo ainda resolve** — médio — **corrigido**
- Regra: 8-1-3-1-3, 10-2-16. Q&A OP11-049 Carrot, OP04-024 Sugar, OP05-075 Mr.1, OP06-086 Moria.
- Cenário testado: Nico Robin OP01-017 nocauteia Gordon ST16-002 no [When Attacking]; o [On Your Opponent's Attack] do Gordon não ativa.

**DV-05. Efeitos disparados durante o dano resolvem no meio do dano** — médio — **corrigido**
- Regra: 8-6-2. Q&A OP05-098 Enel, OP13-002 Ace, OP08-105 Bonney.
- Cenário testado: Double Attack; o [Trigger] da 1ª Vida (ST01-015) nocauteia Caribou; o [On K.O.] do Caribou vem depois do 2º dano.
- Observação: "When this Character's attack deals damage" (`attackDamage`) também resolve depois do dano. O Q&A OP03-043 Gaimon diz que ele vem antes da decisão do [Trigger]; caso raro, fica como está.

**DV-06. Ordem fixa entre efeitos simultâneos do mesmo jogador** — baixo — **corrigido**
- Regra: 6-6-1-1-3; 8-6-1-1 e Q&A OP10-042 Usopp, OP04-058 Crocodile, OP06-086 Moria (o dono escolhe a ordem).
- Cenário testado: dois Eustass"Captain"Kid ST02-013 com [End of Your Turn] → o dono escolhe qual resolve primeiro. Habilidades da mesma carta seguem a ordem do texto (sem pergunta).

### C3 — [On K.O.]

**DV-07. [On K.O.] ignora [DON!! xX], condição, [Once Per Turn] e negação** — médio — **corrigido**
- Regra: 10-2-17-1 (as condições são checadas **no campo**, antes de a carta ir para o trash); 8-2-1-1 (efeito negado não ativa). Q&A OP01-061 Kaido, OP06-074 Zephyr, OP09-093 Teach.
- Antes: `koCharacter` só conferia [Your Turn]/[Opponent's Turn], depois de `removeCharacter` já ter apagado os modificadores (`negated` incluso). Jewelry Bonney ST21-004 "[DON!! x2] [On K.O.] Draw 1 card" nocauteada sem DON!! comprava 1; Personagem com efeitos negados também ativava o [On K.O.].
- Agora: `koCharacter` avalia cada [On K.O.] **antes** de mover a carta (com os DON!! ainda dados e os modificadores ainda valendo): `conditionsMet` (negação, [DON!! xX], [Your Turn]/[Opponent's Turn], condição da habilidade), [Once Per Turn] e a causa (`koBy`). Guarda o resultado, move a carta para o trash (DON!! voltam virados) e só então põe na fila os que valeram, marcando o [Once Per Turn] (o custo opcional recusado devolve o uso, como nos outros efeitos). O que não vale fica no log ("a condição não vale, o efeito não é ativado"). As condições escritas dentro do efeito ("If …") continuam sendo vistas na resolução.
- Testes: `packages/engine/test/on-ko.test.ts` (Bonney com 0, 1 e 2 DON!!, Personagem negado, [Once Per Turn] marcado e já usado).

### C4 — Escolha obrigatória

**DV-08. Escolha sem "up to" aceita 0 alvos** — médio — **corrigido**
- Regra: 8-4-4-1 (sem "up to", escolhe-se o máximo possível até o número pedido; só com "up to" pode ser 0). "You may <ação> 1 …" deixa a ação inteira opcional (aceitar ou recusar), mas quem aceita escolhe o alvo.
- Antes: `resolveTargets` sempre abria `selectTargets` com `min: 0`; `TargetSpec` não dizia se a escolha era obrigatória. Líder Trafalgar Law OP01-002 com 5 Personagens ("return 1 of your Characters to the owner's hand. Then, play up to 1…") devolvia 0 e mesmo assim jogava; OP07-036 confirmava "you may rest 1 of your Characters", escolhia 0 e o "If you do" ainda virava o Personagem do oponente.
- Agora: `TargetSpec.required` marca a quantidade sem "up to". O parser (`parseTargetBase`) marca "N of your …"/"N of your opponent's …" e "your Leader or 1 of your Characters"; `resolveTargets` abre a escolha com `min` = o máximo possível (`requiredTargets`: `min(N, opções)`; com "with a total power/cost of N or less", quantas das menores cabem no total). Exceção: "Give up to N rested DON!! cards to your Leader or 1 of your Characters" — dar 0 DON!! é permitido, e o motor dá os DON!! a quem foi escolhido, então o alvo continua opcional (`donTarget`). Nos scripts à mão (`scripts.ts`), os únicos alvos sem "up to" são desse tipo (ST01-001, ST01-007, ST01-011) e ficaram como estavam. No "you may" sem custo seguido de alvo obrigatório sem nenhuma carta que possa ser escolhida (OP07-036 sem Personagem de custo 3 ou mais), a ação não pode ser feita: o motor não pergunta e pula o trecho com o "If you do". O bot completa o mínimo com as próprias cartas de menor valor (em escolhas "harm", as do oponente primeiro). Replays passam para a versão 6; nos antigos, a escolha gravada com menos alvos do que o mínimo é completada com as primeiras opções.
- Varredura (data/cards + data/spoilers + as fixtures de teste, 826 cartas): 2 cartas com alvo obrigatório depois da correção, OP01-002 (`returnToHand`) e OP07-036 (`rest`); as outras 16 frases "… to your Leader or 1 of your Characters" / "to 1 of your …" são de dar "up to N" DON!! (ficam opcionais). Os demais textos sem "up to" da base ("You may rest 1 of your Characters: …", "K.O. 1 of your …:") são custos (`AbilityCost`), que já eram tudo-ou-nada.
- Testes: `packages/engine/test/required-targets.test.ts` (Law: 0 alvos recusado, outra cor, "up to" ainda aceita 0, bot; OP07-036: aceitar exige o alvo, recusar, sem alvo possível; replay antigo; parser e varredura).

### C5 — DON!! −X

**DV-09. DON!! −X sem escolha de quais DON!! devolver** — médio — **corrigido**
- Regra: 8-3-1-6, 10-2-10-1, 3-9-2. Q&A de regras: "You can choose to return any DON!! cards from your Leader area, Stage area, Character area, or cost area." Q&A OP02-085 Magellan: quem escolhe é o dono.
- Antes: `returnDon` (engine.ts:4411) devolvia primeiro os rested, depois os **active** e só então os dados, sem perguntar. Shanks ST05-001 com 3 DON!! active e 3 dados ao Líder pagava "DON!! −3" com os 3 active (sobrava 0 para jogar cartas).
- Agora: o passo `returnDon` pergunta ao dono, um DON!! por vez, de onde ele sai (pendência `option` com `don`: área de custo active ou rested, Líder, cada Personagem, Stage). Não pergunta quando só há uma origem ou quando todos os DON!! do campo vão. Vale para o custo DON!! −X (`payImmediateCost`), "DON!! −N ou mais" (`returnDonChoice`), `donMatchOpponent` e `opponentReturnsDon` (o oponente escolhe os dele, como no Magellan). O bot devolve os rested primeiro; no próprio turno, depois os dados (antes os de cartas que já atacaram) e por último os active.
- Cenários testados em `don-return.test.ts`: o Shanks acima devolve os 3 do Líder e fica com os 3 active; Magellan OP02-085 com o oponente escolhendo; escolha do bot; replays antigos.

### C6 — [Once Per Turn]

**DV-10. [Once Per Turn] não reinicia quando a carta sai e volta ao campo** — médio — **corrigido**
- Regra: 10-2-13-4, 3-1-6 (a carta que muda de área é uma carta nova).
- Antes: `usedThisTurn` guardava `uid:índice` e só era zerado no fim do turno; `removeCharacter`/`detach` não limpavam. Jinbe ST14-004 usava o [Activate: Main], voltava para a mão, era jogado de novo → "Já usada neste turno."
- Agora: `forgetCard` esquece as chaves `uid:*` de `usedThisTurn` quando a carta sai do campo (`removeCharacter`, que cobre K.O., devolver à mão/deck, Vida, descarte por campo cheio etc.; o Stage em `detach`; a troca de Stage ao jogar outro da mão passa a usar `detach`) e de novo quando entra (`resolvePlay`, Stage jogado da mão ou por efeito, modo manual). Saindo, também tira a marca (`opt`) dos efeitos da carta que ainda esperam na fila, para que, descartados depois (DV-04), não devolvam o uso de uma carta nova. O Líder não sai do campo. O [Once Per Turn] do [On K.O.] continua marcado depois do K.O. (é o uso da carta no trash, que resolve o efeito, DV-07); se ela voltar ao campo no mesmo turno, a entrada esquece a marca. Pelo mesmo motivo, a carta sai de `battledCharacter` ("if this Character battled … during this turn").
- Fica de fora: os outros registros por carta (`delayed`, `tempReplacements`) são efeitos já criados, que seguem as próprias regras (8-2-3; OP03-005 Thatch, tema 08).
- Testes: `packages/engine/test/once-per-turn.test.ts` (Jinbe devolvido à mão por efeito e jogado de novo; a mesma carta que não saiu continua bloqueada; [Once Per Turn] [On K.O.] de carta nocauteada, devolvida e jogada de novo ativa outra vez; Stage trocado, devolvido e jogado de novo; `battledCharacter`).

### C7 — Substituição ("instead")

**DV-11. Só a primeira substituição aplicável é oferecida; recusar descarta as outras** — médio — **corrigido**
- Regra: 8-1-3-4-2 (primeiro a da carta afetada, depois as do jogador do turno na ordem que ele escolher, depois as do outro). Q&A OP05-001 Sabo (recusar não gasta o [Once Per Turn]).
- Antes: `offerReplacement` devolvia a primeira habilidade elegível (Líder → Personagens → Stage → `tempReplacements`); se recusada, `performRemoval(..., noReplace)` removia sem oferecer as outras, e a da própria carta não tinha precedência. Líder com "If your Character would be K.O.'d, you may … instead" + Personagem com a própria substituição: recusar a do Líder levava direto ao K.O. A remoção depois da recusa também perdia quem removia (`byPlayer`): um K.O. por efeito do oponente com a substituição recusada não emitia `characterRemoved` nem ativava [On K.O.] "by your opponent's effect".
- Agora: `nextReplacement` monta a ordem: primeiro as do jogador do turno, depois as do outro (cada um só substitui a saída dos próprios Personagens); de cada jogador, primeiro as das cartas afetadas, depois Líder → Personagens → Stage → as criadas por efeito (`tempReplacements`). O passo `replaceRemoval` guarda as já oferecidas (`skip`); recusada uma (ou sem como pagar), `continueRemoval` oferece a próxima e, sem nenhuma, remove. Recusar continua sem gastar o [Once Per Turn]; a aplicada não volta a ser oferecida para a mesma remoção. A remoção leva a causa (`byPlayer`, `by`, batalha) até o fim.
- "Na ordem que ele escolher": oferecer em sequência já deixa o dono usar qualquer uma (recusa as anteriores), e só uma é aplicada por remoção (depois dela o Personagem não sai mais). Por isso não há uma escolha de ordem à parte; a ordem fixa só decide qual é perguntada primeiro.
- Testes: `packages/engine/test/replacement.test.ts` (Líder + Personagem: a do Personagem vem primeiro, recusada a do Líder salva e o [Once Per Turn] recusado não é gasto; recusando todas, K.O.).
- Outros simuladores tiveram o mesmo bug (OPTCGSim 1.43a; OPlayTCG oferece em cadeia — ver [interacoes/14](interacoes/14-comunidade-e-simuladores.md)).

**DV-12. Remoções que não oferecem substituição** — médio — **corrigido** (efeitos; custos ficam de fora)
- Antes: (a) remoção que não é K.O. só era substituída quando o efeito era do oponente (`eventOk`), então "would be removed from the field" sem "by your opponent" não valia contra efeito próprio (OP17-043, EB04-044, OP05-100); (b) `fieldToLife` e `opponentChoosesOwn` respeitavam `removalBlocked`, mas não chamavam `offerReplacement`, e `fieldToLife` não emitia `characterRemoved`; (c) cada Personagem removido junto com outros recebia a própria pergunta, e cada um era removido logo depois da sua: o Líder OP11-001 Koby pagava 3 cartas por {Navy} do Kaido OP01-094 e, com 2 no descarte, o 1º nocauteado ia para o descarte e liberava a substituição do 2º.
- Agora: `replacementMatches` usa a causa do texto também na remoção: "by your opponent('s effect)" exige efeito do oponente; sem isso, vale qualquer saída do campo (efeito próprio e K.O. em batalha incluídos, como "would leave the field"). "Removed … by your opponent's effect or K.O.'d" (forma obrigatória) ganhou `removalBy` para a remoção continuar só contra o oponente. `ko`, `returnToHand`, `trashTarget`, `toDeckBottom`, `opponentChoosesOwn` e `fieldToLife` passam todos por `removeFromField`: proteções (`koProtected`/`removalBlocked`), depois as substituições e por fim `performRemoval`, que move a carta e emite `characterRemoved` (e `returnedToHand`) — `fieldToLife` passou a emitir, inclusive no fundo da Vida. Os Personagens removidos juntos ("K.O. all", "return up to 2") recebem cada substituição uma vez, cobrindo todos a que ela se aplica: um pagamento salva todos ou nenhum (Q&A OP15-009, OP11-001, OP05-001; `victimPowerMinus` e `victimToLife` valem para cada um), e os não cobertos saem juntos depois das respostas. Quem a substituição não cobre (Tashigi OP10-032 não protege a si mesma) continua saindo.
- Bot: paga como antes, exceto contra remoção sem K.O. feita pelo próprio efeito (ele escolheu remover).
- Replays passam para a versão 7; nos antigos, a pergunta de substituição que o roteiro não tem é recusada (o que acontecia antes). Um replay antigo que pagou por cada Personagem removido junto pode tomar outro rumo.
- Fica de fora: (1) custos que tiram Personagem próprio do campo ("You may return 1 of your Characters to your hand:", `returnOwn`/`koOwn`/`trashOwn`/`anyNumberForPower`) continuam sem substituição — com ela o custo não conta como pago (Q&A OP05-100 + OP01-047, CR 8-3-1-7) e isso pede outro tratamento; (2) substituição para Líder/Stage (nenhuma carta precisa); (3) K.O. de Stage (DV-16, corrigido sem substituição).
- Testes: `packages/engine/test/replacement.test.ts` (Kaido OP01-094 + Líder tipo Koby OP11-001: um pagamento salva os dois {Navy} e o outro Personagem é nocauteado; com 2 cartas no descarte não dá nem em parte; recusando, todos saem; `fieldToLife` pagando e recusando, com `characterRemoved`; `opponentChoosesOwn`; "removed from the field" sem "by your opponent" contra efeito próprio e "by your opponent's effect" que continua não valendo; bot). 9 de 10 falham no código antigo.

### C8 — Proteções e proibições

**DV-13. "Cannot be K.O.'d by your opponent's effects" também bloqueia K.O. por efeito próprio** — médio — **corrigido**
- Regra: 1-3-1 (o texto vale como escrito). ~17 cartas usam o texto (ST14-009, OP07-033, OP09-086…).
- Antes: virava `staticNoEffectKO` (parser.ts:2898), igual a "cannot be K.O.'d by effects", e `koProtected` (engine.ts:4328) bloqueava qualquer K.O. por efeito, inclusive o do próprio dono. O mesmo na aura ("your Characters … cannot be K.O.'d by your opponent's effects", `noEffectKO`) e no efeito temporário ("none of your Characters can be K.O.'d by your opponent's effects during this turn", modificador `cannotBeKOByEffect`).
- Agora: as três formas guardam o lado: `staticNoEffectKO` e `aura.noEffectKO` valem `true` ("by effects") ou `'opponent'` ("by your opponent's effects", também "cannot be K.O.'d or rested by your opponent's effects"); o efeito temporário com "your opponent's" cria o modificador `cannotBeKOByOpponentEffect`. `koProtected` recebe quem nocauteia (`byPlayer`, vindo de `removeFromField`/`koCharacter`) e a versão `'opponent'` só protege quando é o oponente. Os textos em português (habilidade, aura, status) dizem "por efeitos do oponente".
- Testes: `packages/engine/test/protections.test.ts` (o próprio efeito nocauteia e o do oponente não; "by effects" continua protegendo do próprio efeito; aura e efeito "during this turn"); `parsed-engine*.test.ts` passaram a informar quem nocauteia.

**DV-14. "Cannot be K.O.'d" ignorado em custos de K.O.** — baixo — **corrigido**
- Regra: 1-3-3 (proibição vence exigência); um custo que não pode ser pago não é pago (8-3-1-3).
- Antes: `koOwn` (engine.ts:2592) e `koSelf` (:3400) usavam `force: true` e as opções do custo eram todos os Personagens do filtro.
- Agora: `koCostOptions` tira das opções de "K.O. N of your …" os Personagens que `koProtected` protege do K.O. pelo efeito do próprio dono ("cannot be K.O.'d", "by effects"; "by your opponent's effects" não protege, DV-13). `canPayCost` usa essas opções, então sem Personagens suficientes o custo não pode ser pago; "K.O. this Character" (`koSelf`) também não pode ser pago se a carta estiver protegida. O mesmo filtro vale para "You may K.O. any number of your Characters … for every Character K.O.'d" (`anyNumberForPower`): o protegido não seria nocauteado nem contaria. O K.O. em si continua com `force` (já escolhido entre os que podem), sem substituição: custos que tiram Personagem do campo seguem fora da substituição (DV-12).
- Testes: `packages/engine/test/protections.test.ts` (com só o protegido, `canPayCost` falso; com outro Personagem, só ele aparece entre as opções).

**DV-15. `restDonOrCharacter` vira Personagem sem passar pelas proteções** — baixo — **corrigido**
- Antes: chamava `restCard(state, uid)` sem `byEffectOf` (engine.ts:2798): ignorava "cannot be rested by your opponent's effects" (`staticNoRest`), a substituição de rest e não emitia `restedByEffect`.
- Agora: `restCard(state, uid, controller, source)`, como o passo `rest`. Também a recusa da substituição de rest (`replaceRest`) passou a emitir `restedByEffect` (o Personagem é virado pelo efeito do mesmo jeito).
- Replays passam para a versão 8: nos antigos, a pergunta da substituição de rest que o roteiro não tem é recusada (o que acontecia antes).
- Testes: `packages/engine/test/protections.test.ts` (o protegido continua ativo; o outro é virado e ativa "If a Character is rested by your effect").

**DV-16. `ko` em Stage ignora proteções, substituição e eventos** — baixo — **corrigido**
- Regra: 10-2-1. Só cartas que dizem "K.O. … Stage" podem fazer isso (Q&A OP13-098: um efeito que mira Personagens não alcança Stage).
- Antes: K.O. em Stage ia direto ao trash (engine.ts:2193).
- Agora: `koStage` passa pelas mesmas proteções do Personagem: `koProtected` (com quem nocauteia) e `removalBlocked`; o parser lê "This Stage cannot be K.O.'d by (your opponent's) effects". Substituição e eventos: nenhuma carta tem "If your Stage would be K.O.'d … instead" nem "When your Stage is K.O.'d", e os eventos de Personagem (`characterKO`, `characterRemoved`, [On K.O.], "if your Character was K.O.'d this turn") não valem para Stage; por isso não há substituição nem evento novo (a substituição para Stage segue fora, DV-12).
- Testes: `packages/engine/test/protections.test.ts` (Stage com "cannot be K.O.'d by your opponent's effects" fica no campo; o sem proteção vai para o descarte).

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

**DV-29. "At the end of this turn" resolve antes dos [End of Your Turn]** — baixo — **corrigido em parte**
- Regra: 6-6-1-2 (primeiro todos os [End of …]; depois os "at the end of this turn"). Q&A ST24-005 X.Drake.
- Corrigido junto com a fila de efeitos disparados: os efeitos adiados entram num lote depois dos [End of Your Turn].
- Falta: atrasados criados **durante** a End Phase (por um [End of Your Turn]) ainda ficam para o fim do turno seguinte.

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

**DV-34. Erratas oficiais não aplicadas ao texto das cartas** — médio — **corrigido**
- Regra: a errata vale para todos os formatos e vence o texto impresso.
- Agora: tabela `packages/engine/src/errata.ts` (`ERRATA`, `applyErrata`), com a troca exata de trecho (ou de tipo), a data e o link de cada aviso. É aplicada:
  - no motor, em `buildCardDef` (o leitor lê o texto corrigido em qualquer origem);
  - no servidor, em `upsertCards` (gravação) e na leitura das cartas do banco (`toCard` em `apps/server/src/db.ts`), o que corrige também as cartas já importadas em produção sem precisar reimportar;
  - nos JSON de `data/cards`.
- Cartas corrigidas (13): OP01-002, OP01-003, OP01-016, OP02-002, OP02-071, OP05-032, OP06-034 (tipo), OP13-077, OP14-009 (tipo), OP16-081, ST02-013, ST04-001, ST14-014. Mudam o jogo: Nami OP01-016 (busca qualquer carta {Straw Hat Crew}), Go All the Way to the Top!! OP13-077 ([Counter] dura a batalha), Otama OP16-081 e Gum-Gum Giant Rifle ST14-014 ("If there is…" olha os dois lados), Hyouzou OP06-034 ({Merfolk}), Law OP14-009 (deixa de ser {The Seven Warlords of the Sea}). Na Otama, a fonte também tinha perdido o sinal de "−2000".
- Já vinham corrigidas da fonte (conferido em 07/10/2026): OP01-051, OP01-112, OP03-047, OP03-054, OP07-097, OP09-058, OP15-023 e o "up to" em massa de OP-01 e ST-01 a ST-04. OP13-119: a errata só vale para a impressão "Wanted Poster", e o texto da base já é o certo.
- O leitor (`parser.ts`) e a tradução (`i18n/pt.ts`) ganharam as redações novas de Garp OP02-002 ("any of your Characters"), Magellan OP02-071 ("on the field") e Kaido ST04-001 ("from the top of their Life cards").
- Testes: `packages/engine/test/errata.test.ts` e o teste "aplica a errata oficial…" em `apps/server/test/server.test.ts`.
- Nomes e tipos que a fonte traz diferentes da lista oficial (ST14-014 "Gum-Gum Giant Rifl"/"Straw Hat Cre" e mais 103 cartas) são corrigidos à parte, pela tabela `packages/engine/src/source-fixes.ts` (DV-36).

**DV-35. README "Regras implementadas" desatualizado** — baixo — **corrigido junto com esta base**
- Diz que substituição, [End of Your Turn] e DON!! −X não existem; os três existem (timing `replace`, `endOfTurn`, `AbilityCost.donMinus`). Não menciona as limitações reais (C2). Atualizar e apontar para `docs/rules/`.

**DV-36. Nomes e tipos da optcgapi diferentes da lista oficial** — médio — **corrigido**
- Comparação de 07/10/2026 com a lista oficial (<https://en.onepiece-cardgame.com/cardlist/>), 2.703 cartas: 104 cartas com diferença (37 nomes e 68 listas de tipos; ST14-014 tem os dois). Há cortes ("Gum-Gum Giant Rifl", "Sakazuk", "Straw Hat Cre"), formatação ("Mr.3 (Galdino)"; os textos citam [Mr.3(Galdino)]), sufixos ("Jewelry Bonney -PRB02-004"), tipos ausentes, a mais ou trocados (Franky OP11-012 vinha como {Navy}/{SWORD}).
- Impacto: o motor compara nomes exatamente; efeitos como OP16-040 ("If you have [Monkey.D.Luffy] and [Mr.3(Galdino)]"), EB04-056 ("If you have [Jewelry Bonney]") e as buscas "other than [Mr.3(Galdino)]"/"[Who's.Who]" não achavam as cartas; condições e buscas por tipo também falhavam.
- Correção: tabela `packages/engine/src/source-fixes.ts` (104 cartas), aplicada junto com a errata por `fixCard` (motor, gravação e leitura do banco, `data/cards`). O comando `npm run cards:check-official -w @gumgum/server` refaz a comparação e gera as entradas (ver [manutencao.md](manutencao.md)). A própria lista oficial traz o tipo da ST11-005 em japonês ("音楽"); o comando o trata como {Music}.
- Testes: `packages/engine/test/source-fixes.test.ts`, `apps/server/test/official-cards.test.ts` e o teste de carta já gravada em `apps/server/test/server.test.ts`.

**DV-37. Cartas promocionais (P-xxx) fora da importação e com número errado** — médio — **corrigido**
- A importação completa só lia `/api/allSetCards/` e `/api/allSTCards/`. Das 106 promos da lista oficial, só chegavam as reimpressas em starter deck, e 8 delas com o número da imagem no lugar do número da carta (P-029_r1, P-030_r1, P-041_r1, P-057_p1, P-058_p1, P-059_p1, P-060_p1, P-061_r1): o deck montado com o número oficial não achava a carta. 82 promos oficiais não existiam no jogo.
- Correção (`apps/server/src/optcgapi.ts`):
  - a importação lê também `/api/allPromos/` (`allEndpoints`);
  - o sufixo de versão sai do número (`baseCardId`: "P-029_r1" → "P-029"), e as linhas se juntam à promo;
  - a lista de promos também traz reimpressões de cartas de coleção ("Gum-Gum Lightning (Premium Card Collection -Best Selection Vol. 4-)", mesmo número e imagem da original): são ignoradas, para não pesar na escolha por maioria (`mergeEntries`);
  - os líderes só de evento P-700, P-800 e P-900 (Luffy das seis cores, "This Leader can only be used in designated events") são ignorados: não estão na lista oficial e não valem em partida normal;
  - o nome perde o evento ou produto da promo ("(One Piece Film Red)", "(Offline Regional 2024 Vol. 2) [Winner]");
  - se a linha principal vem sem imagem (P-014), fica a imagem de outra impressão.
- Banco: na abertura, as cartas antigas com sufixo são apagadas (a importação e o seed gravam as certas) e os decks salvos e as inscrições de torneio passam a usar o número da carta, juntando as cópias (`migrateCardIds` em `apps/server/src/db.ts`). `data/cards` e `data/decks` (ST16, ST18) foram atualizados.
- Resultado (07/10/2026): 117 promos importadas; das 106 oficiais, faltam na API P-110, P-135 e P-155. 14 promos da API ainda não estão na lista oficial em inglês (P-038, P-064, P-066, P-067, P-080, P-086, P-114, P-136, P-138 a P-140, P-142, P-147, P-148) e entram como vêm da API. `source-fixes.ts` ganhou 15 correções de promo (tipo {FILM} das cartas do filme Red, P-002 "I Smell Adventure!!!", P-072 {MONSTERS}, nomes de P-147/P-148 no formato "Mr.3(Galdino)") e perdeu as de P-029 e P-084, que a lista de promos já traz certas. `cards:check-official`: 0 diferenças.
- Sem imagem na API: P-004, P-035, P-052, P-080, P-114, P-138 e P-142 (a carta aparece com o texto).
- Leitor de efeitos: 87 das 117 promos automáticas, 5 parciais, 9 manuais. Algumas manuais e parciais têm texto corrompido na fonte (P-091 "Play-up to", P-115 "1-rested", P-147 "Character-gains", P-142 frase repetida).
- Testes: bloco "promocionais (allPromos)" e nomes de promo em `apps/server/test/optcgapi-cleanup.test.ts`.

---

## Itens a confirmar (sem ruling oficial claro)

- Dano de efeito de 2 ou mais com 1 de Vida: o motor segue a leitura literal de 1-2-1-1-1 (perde no 2º ponto). O Q&A EB03-055 Robin diz que dano de efeito com 0 de Vida vence; não há ruling para "2 de dano de efeito com 1 de Vida". Rever se a Bandai publicar um.
- Substituição de dano ("If you would take damage, … instead") oferecida mesmo com 0 de Vida.
- `handCounter.set` sobrescrevendo um Counter maior (CR 2-10-4: vale o maior).
- Cadeia "If … Then …" (4-10): depende de o parser marcar o `if` em todos os passos seguintes; vale um teste por carta com "If … Then".
- `cancel` e `detachDon` (desfazer) estão fora das regras oficiais — o Q&A proíbe mover DON!! já dado. São conveniências de interface protegidas contra vazamento; manter documentado.

## Conferência completa por regra

| Área | Conforme | Divergente |
|---|---|---|
| Preparação e derrota (1-2, 5-2, 9) | Escolha de primeiro/segundo, mulligan, derrota por dano sem Vida e por deck 0 (checada a cada passo), desistência, vitória por efeito | DV-24, DV-25, DV-26 |
| Fases (6) | Expiração "until the start of your next turn", devolver DON!! e desvirar, Draw, DON!! Phase, sem ataque no 1º turno, [End of Your Turn] uma vez, expiração de "this turn" | DV-28, DV-29 (em parte), DV-30 |
| DON!! (6-5-5, 8-3) | Dar DON!!, +1000 só no próprio turno, DON!! voltam rested, [DON!! xX], DON!! −X com escolha | — |
| Batalha (7) | Alvos, [When Attacking] antes de [On Your Opponent's Attack], saída de cena ao fim de cada etapa, [Blocker], [On Block], vários Counters, ≥ vence, Double Attack fixo em 2, [Banish], K.O. do perdedor, efeitos de fim de batalha, [Double Attack] contra 1 de Vida | DV-21, DV-22, DV-23 |
| Dano e [Trigger] (4-6, 10-1-5) | Dano um a um, [Trigger] no lugar de ir para a mão, recusar sem revelar, Trigger antes do 2º dano, `damageTaken`/`lifeRemoved` depois do dano, efeitos disparados esperam o dano | DV-17 |
| Efeitos (8) | "may" e custos opcionais, auto effect por ocorrência, custo tudo-ou-nada, [Once Per Turn] por carta, substituição opcional e não reaplicada, "up to" 0, busca pode não achar, [On K.O.] só por K.O. e com as condições vistas no campo, "cannot be K.O.'d" só contra K.O., auto effects não ativam em área secreta, [Trigger] de Evento não é "activate an Event", fila de efeitos disparados (8-6), sem "up to" escolhe o máximo possível, [Once Per Turn] reinicia na carta que volta ao campo, todas as substituições oferecidas em ordem e em toda remoção por efeito (um pagamento para as simultâneas), "cannot be K.O.'d by your opponent's effects" só contra o oponente, protegido não paga custo de K.O. | DV-12 (custos), DV-19, DV-20 |
| Áreas e outros (3, 10, 11) | Limite de 5 como regra, Stage único, K.O. de Stage com as proteções, carta nova ao sair do campo, Líder não se move, Rush/Rush: Character, entrar rested, poder negativo, custo negativo = 0, Vida do topo, Vida virada para cima pública, revelar na busca, olhar e devolver, [Main]/[Activate: Main] fora de batalha, [Counter] só no Counter Step | DV-18, DV-27, DV-33 |
| Informação oculta (`view.ts`) | Mão/deck/Vida escondidos, contagens abertas, trash aberto, "look at" só para quem olha, revelada volta a ficar oculta, decisões que leem a mão sempre abrem, log secreto | — |
