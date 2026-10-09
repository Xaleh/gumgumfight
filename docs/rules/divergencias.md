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
| DV-17 | Carta do [Trigger] vai para o trash **antes** de resolver (**corrigido**) | 10-1-5-3 | médio | C9 |
| DV-18 | `fieldToLife` ignora "face-up" (**corrigido**) | texto das cartas | médio | C10 |
| DV-19 | «Set Power to 0» lido como poder base 0 (**corrigido**) | 4-12 | baixo | C11 |
| DV-20 | Vários "base power becomes X": vale o último, não o maior (**corrigido**) | 4-9-2-1 | baixo | C11 |
| DV-21 | Counter da mão só pode ir para o alvo do ataque (**corrigido**) | 7-1-3-1-1, Q&A de regras | baixo | C12 |
| DV-22 | Evento [Counter] ignora redução de custo na mão (**corrigido**) | 2-7-6 | baixo | C12 |
| DV-23 | "During this battle" expira antes dos efeitos de fim de batalha (**corrigido**) | 7-1-5-2..4 | baixo | C12 |
| DV-24 | Ordem da Vida na preparação invertida (**corrigido**) | 5-2-1-7, 2-9-2-1 | baixo | C13 |
| DV-25 | "At the start of the game" roda antes da escolha de quem começa, sem escolha nem recusa (**corrigido**) | 5-2-1-5-1/2 | baixo | C13 |
| DV-26 | Derrota simultânea não empata (**corrigido**) | 9-2-1 | baixo | C13 |
| DV-27 | Laço infinito trava a partida em vez de empatar (**corrigido**) | 11-1 | baixo | C13 |
| DV-28 | "At the start of your turn" resolve depois do Draw e da DON!! Phase (**corrigido**) | 6-2-2 | baixo | C14 |
| DV-29 | "At the end of this turn" resolve antes dos [End of Your Turn] (**corrigido**) | 6-6-1-2 | baixo | C14 |
| DV-30 | Faltam momentos: "start of your opponent's turn", "start of the Main Phase", [End of Your Opponent's Turn] (**corrigido**) | 6-2-2, 6-5-1, 6-6-1-1 | baixo | C14 |
| DV-31 | "Draw up to X" vira compra obrigatória (**corrigido**) | 4-5-4 | baixo | C15 |
| DV-32 | Restrições ("you cannot ...") só valem para quem controla o efeito e só no turno (**corrigido**) | texto das cartas | baixo | C15 |
| DV-33 | Mão → Vida com filtro não revela a carta (**corrigido**) | 11-2-1 | baixo | C15 |
| DV-34 | Erratas oficiais não aplicadas ao texto das cartas (**corrigido**) | Errata oficial | médio | C16 |
| DV-35 | README "Regras implementadas" desatualizado (corrigido) | — | baixo | — |
| DV-36 | Nomes e tipos da optcgapi diferentes da lista oficial (**corrigido**) | Lista oficial de cartas | médio | — |
| DV-37 | Cartas promocionais (P-xxx) fora da importação e com número errado (**corrigido**) | Lista oficial de cartas | médio | — |
| DV-38 | Auras filtradas por custo olhavam o custo impresso (**corrigido**) | 1-3-6 | alto | — |
| DV-39 | Condições com dois tipos e "no other [X] with a base cost of N" lidas pela metade (**corrigido**) | texto das cartas | médio | — |
| DV-40 | Auditoria das cartas: 24 cartas com efeito lido ou executado errado (**corrigido**) | texto das cartas | alto | C17 |
| DV-41 | Auditoria das cartas: leituras que dependem de ruling ou de interface nova (parte **corrigida** na rodada 2) | texto das cartas | baixo | C17 |
| DV-42 | Auditoria das cartas, rodada 2 (OP01 a OP09): 24 cartas com efeito lido ou executado errado, mais as regras de DV-41 (**corrigido**) | texto das cartas | alto | C17 |
| DV-43 | Auditoria das cartas, rodada 3 (starter decks, promos e spoilers EB05/OP18): 19 cartas, as 20 com atributos juntos e 3 pendências de DV-41 (**corrigido**) | texto das cartas | alto | C17 |

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
| C17 | <https://trello.com/c/RR3kkVwy> | Auditoria das cartas automatizadas (DV-40 a DV-43); pendências: <https://trello.com/c/V3eu7Opx> |

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

**DV-17. A carta do [Trigger] vai para o trash antes de resolver** — médio — **corrigido**
- Regra: 10-1-5-3 (enquanto o Trigger resolve, a carta não está em área nenhuma; vai para o trash depois). Q&A OP14-082 Oinkchuck, OP09-100 Karasu, OP15-097, OP15-079 Absalom.
- Antes: `ps.trash.push(card)` antes de `pushEffect` (engine.ts:1208). Contagens de trash incluíam a carta (OP15-097 dava 10 em vez de 9); um [Trigger] "Play this card" saía como `from: 'trash'` (`playFree` :1915) e disparava "when a Character is played from your trash" (OP16-079); "play/add … from your trash" pelo [Trigger] alcançava a própria carta (OP14-082, OP15-079).
- Agora: ao ativar o [Trigger], a carta vai para `state.limbo` (fora de qualquer área: nem Vida nem descarte) e o frame do efeito leva `trigger: true`. Quando esse frame termina (depois dos efeitos que ele empilhou por cima, como "Activate this card's [Main]"), a carta vai para o descarte, a menos que o efeito a tenha movido: `playThis` a joga (sem `from: 'trash'`), `addThisToHand` a leva para a mão (ST09-002), e `detach` a tira do limbo. Sem passos, vai direto ao descarte.
- Efeitos disparados durante o [Trigger] (8-6) continuam esperando o dano terminar; quando resolvem, a carta já está no descarte (ou onde o efeito a pôs).
- Visão (`view.ts`): a carta foi revelada, então é pública enquanto resolve (`limbo` com apelidos); a interface mostra "[Trigger] Nome" na etapa da batalha no lugar da carta no topo do descarte. OP09-100 Karasu e OP03-100 Kingbaum já estavam certos (a carta sai da Vida ao ser revelada).
- Replays: sem decisão nova, a versão não muda; um replay antigo que contava a carta no descarte pode tomar outro rumo.
- Testes: `packages/engine/test/trigger-limbo.test.ts` (OP15-097 pelo [Trigger] com 9 no descarte não compra e pelo [Main] compra; "Play this card" não dispara "played from your trash"; "play … from your trash" e "add … from your trash" não alcançam a própria carta; a carta é pública e fica fora do descarte enquanto resolve; ST09-002 vai para a mão; [On K.O.] disparado pelo [Trigger] resolve depois do dano, com a carta no descarte). 4 de 7 falham no código antigo.

### C10 — Vida virada para cima

**DV-18. `fieldToLife` ignora "face-up"** — médio (**corrigido**)
- Antes: o passo `fieldToLife` não tinha o campo `faceUp` (o parser aceitava o "face-up" e o descartava); a carta ia virada para baixo, escondendo do oponente uma carta que deveria ser pública (3-10-2-1), e não contava para "face-up Life card".
- Cartas: ~16 na base completa (ex.: OP04-117, OP04-097, OP05-096, OP03-123, OP11-116, EB01-053, ST09-015, OP06-103). Na base deste repositório (`data/cards` + `data/spoilers`, 750 entradas) são 4 as que passam a ter `faceUp`: ST07-017 (topo), ST09-015, OP06-103 e P-085 (topo ou fundo). As outras citadas não estão na base local.
- Agora: `fieldToLife{faceUp}` no tipo e nas três regras do parser ("to the top [or bottom] of … Life cards face-up", "Place/Add … face-up|down"). O motor passa `faceUp` pela remoção (`removeFromField` → substituições → `performRemoval`, como no DV-12) e põe a carta em `lifeFaceUp`, no topo ou no fundo. A visão (`view.ts`) já mostrava as cartas de `lifeFaceUp` a todos; a interface agora desenha a frente da carta na pilha de Vida (com o nome no título e a prévia ao passar o mouse).
- Limpeza: `trashLife`, `lifeToTrash`, `lifeTrashUntil`, `opponentLifeToBottom`, o dano com [Banish] e `detach` tiram a carta de `lifeFaceUp` ao tirá-la da Vida (helper `takeLife`); `lifeToHandCard`, o [Trigger], `playRevealed`, `trashFaceUpLife` e "Life to top of deck" já tiravam.
- Replays: sem decisão nova, a versão não muda; um replay antigo com essas cartas pode tomar outro rumo (condições "face-up Life card", custos de virar Vida).
- Testes: `packages/engine/test/life-face-up.test.ts` (parser das 4 cartas e da frase sem "face-up"; ST07-017 põe o Personagem no topo em `lifeFaceUp` e o oponente e o espectador o veem, com o resto da Vida escondido; "top or bottom … face-up" no fundo; sem "face-up" fica escondida; substituição recusada mantém o "face-up"; `trashLife`/`lifeToTrash` limpam `lifeFaceUp`). 5 de 6 falham no código antigo.

### C11 — Poder base e «Set Power to 0»

**DV-19. «Set Power to 0» lido como poder base 0** — baixo (**corrigido**)
- Regra: 4-12 (reduz pelo valor do poder atual no momento da ativação; se já é 0 ou negativo, nada). Q&A OP07-002 Ain: com «Set Power to 0» e depois [Counter +1000], fica 1000; um Hack 5000 com +2000 "até o fim do próximo turno do oponente" fica 0 neste turno e volta a 7000 no seguinte.
- Antes: "Set the power of X to 0" virava `basePower: 0` (parser.ts:1646); DON!!, auras e bônus (anteriores ou posteriores) somavam por cima do 0, e poder negativo subia para 0 + modificadores (−1000 virava −2000 com um −2000 já aplicado).
- Agora: passo novo `setPowerZero` (parser: "Set the power of … to 0 …"). Na resolução lê o poder atual de cada alvo (`getPower`) e, se for positivo, aplica um modificador de poder −(poder atual) com a duração do texto; com 0 ou negativo não faz nada. Counters, DON!! e bônus posteriores somam normalmente, e o efeito some ao fim da duração. "Set the power … to N" com N ≠ 0 não existe nas cartas e deixa de ser lido.
- Cartas: OP07-002, EB04-010 (nenhuma na base local; os testes usam o texto do OP07-002 numa carta sintética).

**DV-20. Vários "base power becomes X": vale o último, não o maior** — baixo (**corrigido**)
- Regra: 4-9-2-1. Q&A ST34-004 Linlin (0 e 6000 → 6000), OP17-008 Jozu (7000 e 8000 → 8000).
- Antes: `getPower` (engine.ts:589) aplicava em sequência (aura → estático → modificador) e o último vencia; `swapBasePower` lia só o último modificador de poder base.
- Agora: `basePowerOf` reúne todos os efeitos que fixam o poder base (auras `basePower`/`basePowerCopyLeader`, `staticBasePower`, modificadores `basePower`, inclusive os da troca de poder base) e usa o maior; sem nenhum, o impresso. `getPower` parte dele, e `swapBasePower` troca os valores de `basePowerOf`. Um único efeito ainda pode baixar o poder base abaixo do impresso (Linlin sozinha → 0).
- Replays (DV-19 e DV-20): sem decisão nova, a versão não muda; um replay antigo com essas cartas pode tomar outro rumo.
- Testes: `packages/engine/test/set-power.test.ts` (parser do OP07-002 e do ST34-004; OP07-002 + [Counter +1000] fica 1000; Hack 5000 +2000 fica 0 e volta a 7000 no turno seguinte; poder já negativo não muda; 0 e 6000 nas duas ordens dá 6000, com bônus por cima; um só "base power becomes 0" dá 0). 5 de 8 falham no código antigo.

### C12 — Counter Step e fim de batalha

**DV-21. Counter da mão só pode ir para o alvo do ataque** — baixo (**corrigido**)
- Regra: 7-1-3-1-1 ("Leader or 1 Character card"). Q&A de regras: "Can I use a Counter to increase the power of a card not being attacked? Yes … the effect will end at the end of the current battle."
- Antes: engine.ts:1151 aplicava sempre no alvo do ataque.
- Agora: a ação `counter` tem `target` opcional (o Líder ou 1 Personagem do defensor, `counterTargets`); sem ele, o valor vai para o atacado, como antes. O bônus continua com duração `battle`. Alvo do atacante, ou `target` num Evento [Counter] (que escolhe os alvos no próprio efeito), é recusado. A visão traduz o `target` como o `uid` (`aliasRefs`/`actionFromView`), então o servidor das partidas online aceita a ação nova.
- Interface: o caso comum continua com um clique (tocar ou arrastar a carta até a mesa dá o Counter ao atacado). Ao abrir a carta (toque longo, ou o toque sem "Counter sem confirmação"), abaixo de "Usar como Counter" aparece "ou dar a" com o Líder e os Personagens do jogador. O bot continua dando o Counter ao atacado.
- Replays: a ação antiga (sem `target`) vale o mesmo; a versão não muda.

**DV-22. Evento [Counter] ignora redução de custo na mão** — baixo (**corrigido**)
- Regra: 2-7-6 (as reduções valem para jogar ou ativar a carta da mão).
- Antes: `counterOptions` (engine.ts:837) e o pagamento (:1155) usavam `def.cost`, não `playCost`.
- Agora: os dois usam `playCost` (o mesmo do Main: `handCost`, `costReductions`, `handCostAura`), lido antes de a carta sair da mão; uma redução "da próxima jogada" (`costReductions`) é consumida como no Main. `eventsThisTurn` continua com o custo impresso.
- Replays: sem decisão nova, a versão não muda; um replay antigo pode tomar outro rumo (um Evento [Counter] com redução passa a ser oferecido e custa menos).

**DV-23. "During this battle" expira antes dos efeitos de fim de batalha** — baixo (**corrigido**)
- Regra: 7-1-5-2 (ativam os "at the end of this battle"), depois 7-1-5-3/4 (expira "during this battle").
- Antes: engine.ts:1744 removia os modificadores `battle` antes de empilhar os efeitos de fim de batalha; `state.battle` já era `null` para eles.
- Agora: a etapa `end` de `stepBattle` primeiro dispara os `battlesCharacter` ("if this Character battles…", "at the end of a battle in which…") e os "at the end of this battle" (`battle.after`, inclusive os criados por esses mesmos efeitos), marca `battle.endFired` e volta. Os efeitos passam pela fila de disparados (8-6) e resolvem com a batalha ainda em curso (`state.battle`, Counters e outros "during this battle" valendo, pendências normais). Quando não há mais nada a disparar, expiram os modificadores `battle` e a batalha termina. Sem efeitos de fim de batalha, termina na hora, como antes.
- Replays: sem decisão nova, a versão não muda; um replay antigo com efeitos de fim de batalha que leem o poder ou a batalha pode tomar outro rumo.
- Testes (DV-21 a DV-23): `packages/engine/test/counter-step.test.ts` (Counter num Personagem que não é o atacado, que acaba no fim da batalha; sem alvo vai para o atacado e alvo inválido ou com Evento é recusado; tradução do alvo pela visão; Evento [Counter] de custo 3 com −2 na mão oferecido e pago com 1 DON!!; "at the end of a battle in which this Character battles…" e "[When Attacking] At the end of this battle" resolvem com o Counter ainda valendo e a batalha em curso, que termina depois). 6 de 6 falham no código antigo.

### C13 — Preparação e fim de partida

**DV-24. Ordem da Vida na preparação invertida** — baixo — **corrigido**
- Regra: 5-2-1-7, 2-9-2-1 (a carta do topo do deck fica **no fundo** da Vida). Q&A de regras.
- Antes: `pl.life.unshift(pl.deck.shift())` (engine.ts:1098) deixava a carta do topo do deck no topo da Vida (a Vida tem o topo no fim do array), ao contrário do que dizia o comentário.
- Agora: `pl.life.push(pl.deck.shift()!)` no fim do mulligan: a 1ª carta do deck fica em `life[0]` (o fundo) e a 5ª é a primeira a sair.
- Replays: a versão sobe para 9. Os até a 8 são refeitos com `GameConfig.legacySetup` (`replayConfig(config, versão)` em `replay.ts`), que mantém a ordem antiga; a interface aplica isso ao carregar o arquivo, e as salas online começadas antes (sem `RoomData.replayVersion`) também são refeitas assim depois de reiniciar o servidor (o replay delas sai como versão 8).

**DV-25. "At the start of the game" fora de hora e sem escolha** — baixo — **corrigido**
- Regra: 5-2-1-5-1/2 (depois da escolha de quem começa; "up to 1" permite recusar; o deck é reembaralhado). Q&A OP13-079 Imu: resolve depois de embaralhar, revelar o Líder e decidir quem começa, antes da mão inicial; busca, joga e reembaralha; com dois Imus, quem vai primeiro resolve primeiro.
- Antes: a regra `startStage` rodava em `createGame` (engine.ts:133), antes da escolha de primeiro/segundo e depois de embaralhar, com o primeiro Stage elegível do deck, sem perguntar e sem reembaralhar.
- Agora: `startOfGame` roda depois da escolha (ou na criação, quando quem começa já está definido). Para cada Líder com `startStage`, a partir de quem joga primeiro, um efeito do Líder com `playFrom` (deck, até 1 Stage do tipo) e `shuffleDeck`: a escolha é a busca de sempre (pendência `selectTargets` com `hidden`; o oponente não vê as opções; o bot joga o mais valioso). Esse jogador só compra a mão inicial depois (frame `startGame`, 5-2-1-6); o mulligan começa em seguida. Partidas sem esse Líder não mudam (as mãos continuam sendo compradas na criação).
- Replays até a versão 8 (`legacySetup`): resolve na criação, como antes.

**DV-26. Derrota simultânea não empata** — baixo — **corrigido**
- Regra: 9-2-1 (todos que cumprem a condição perdem → empate). Em torneio de eliminação simples, perde o jogador do turno (TRM 5.2).
- Antes: `checkDefeat` (engine.ts:4449) encerrava no primeiro jogador; não havia empate em `winner`.
- Agora: `checkDefeat` junta os jogadores com deck 0 (e a regra "perde no fim do turno com o deck vazio" junta os dois no fim do turno); os dois juntos → empate: `phase` 'gameover' com `winner` null (`gameOver` aceita null e registra "Fim de jogo: empate!"). Dois Líderes "vence com o deck 0" ao mesmo tempo também empatam. A derrota por dano sem Vida continua imediata (um dano é de um jogador só).
- Servidor: as estatísticas aceitam partida sem vencedor (`MatchFacts.winner` null, ninguém com `won`); na ranqueada o empate vale meio ponto na recompensa (`bountyDelta(…, 'draw')`). Torneio: o jogo sem vencedor não conta e a série segue com um jogo novo (como já acontecia); a regra do TRM 5.2 (perde o jogador do turno na eliminação simples) **não** foi implementada — o jogo novo resolve o empate sem precisar dela. Interface: a tela de fim de jogo mostra "Empate".

**DV-27. Laço infinito trava a partida** — baixo — **corrigido**
- Regra: 11-1 (empate, ou o jogador que pode parar diz quantas vezes repete).
- Antes: `run` (engine.ts:1449) lançava `Error` depois de 5000 passos e a partida travava.
- Agora: no passo 5000 a pilha e os efeitos disparados são descartados e a partida termina empatada ("Laço infinito na resolução de efeitos."). O motor não sabe quem poderia parar o laço, então não oferece a escolha do número de repetições. O `simulate:all` continua apontando esse empate como problema.
- Testes (DV-24 a DV-27): `packages/engine/test/game-setup.test.ts` (Vida com o topo do deck no fundo; ordem antiga com `legacySetup`/`replayConfig`; replay antigo refeito igual; Imu sintético (também numa partida bot x bot até o fim) depois da escolha, só Stages do tipo, opções escondidas do oponente, deck reembaralhado e mão comprada depois; recusar; dois Imus na ordem de quem começa; bot; deck 0 dos dois e "perde no fim do turno" dos dois → empate; laço → empate), `apps/server/test/stats.test.ts` (empate na recompensa e nas estatísticas, replay com `legacySetup`) e `apps/server/test/online.test.ts` (sala antiga refeita com a preparação antiga). 8 de 12 falham no código antigo (os outros conferem a compatibilidade e uma partida inteira).

### C14 — Momentos do turno

**DV-28. "At the start of your turn" resolve depois do Draw e da DON!! Phase** — baixo — **corrigido**
- Regra: 6-2-2 (no Refresh, antes de devolver DON!! e desvirar). Q&A OP11-040 Luffy ("efeitos de início de turno → os DON!! dados voltam → tudo fica ativo → Draw Phase").
- Antes: `startTurn` (engine.ts:1357) só empilhava o efeito; ele resolvia depois de devolver DON!!, desvirar, comprar e da DON!! Phase (a condição do 1º passo era vista antes, para compensar).
- Agora: `startTurn` põe os "at the start of your turn" na fila de efeitos disparados (`pushAbilities`: [DON!! xX], condição e [Once Per Turn] como nos outros momentos; o dono escolhe a ordem entre cartas diferentes) e empilha o frame `refresh`; só quando eles terminam (com as escolhas) `refreshDrawDon` devolve os DON!!, desvira, compra e faz a DON!! Phase. Sem efeito de início de turno, o turno segue direto, como antes. Nenhuma carta da base usa esse momento hoje (OP11-040 testado com o texto oficial).

**DV-29. "At the end of this turn" resolve antes dos [End of Your Turn]** — baixo — **corrigido**
- Regra: 6-6-1-2 (primeiro todos os [End of …]; depois os "at the end of this turn"). Q&A ST24-005 X.Drake.
- A fila de efeitos disparados já punha os efeitos adiados num lote depois dos [End of Your Turn], mas na hora da ação `endTurn`: os criados **durante** a End Phase (por um [End of Your Turn]) ficavam para o fim do turno seguinte, e os efeitos disparados por um [End of Your Turn] resolviam depois dos adiados.
- Agora: os `delayed` entram na fila quando o frame `endTurn` chega ao topo (fila vazia: todos os [End of …] e o que eles dispararam já resolveram); se novos forem criados (por um [End of Your Turn] ou por outro adiado), entram também, e o turno só passa sem nenhum pendente.

**DV-30. Momentos que faltam** — baixo — **corrigido**
- "At the start of your opponent's turn" (6-2-2), "at the start of the Main Phase" (6-5-1), [End of Your Opponent's Turn] (6-6-1-1-2/4). Nenhuma carta da base usa (0 cartas); o parser recusava [End of Your Opponent's Turn] (parser.ts:2210) e a carta caía no modo manual.
- Agora: timings `startOfOpponentTurn` ("This effect can be activated at the start of your opponent's turn." ou "At the start of your opponent's turn, …"), `startOfMainPhase` ("… at the start of your Main Phase" / "the Main Phase") e `endOfOpponentTurn` ([End of Your Opponent's Turn], também no modo manual e na tradução). Os do oponente ativam no mesmo lote dos do jogador do turno (que resolvem primeiro, 8-6-1): no início do turno, junto com os "at the start of your turn"; na End Phase, junto com os [End of Your Turn]. O "at the start of your Main Phase" ativa depois da DON!! Phase, antes de qualquer ação.
- Replays: sem decisão nova, a versão não mudou (nota em `replay.ts`). Nenhuma carta da base tem efeito de início de turno, [End of Your Opponent's Turn] ou cria efeito adiado na End Phase; só um replay com um [End of Your Turn] que dispara outro efeito junto com um "at the end of this turn" pode tomar outro rumo.
- Testes (DV-28 a DV-30): `packages/engine/test/turn-timing.test.ts` (OP11-040 sintético com 8 DON!!: olha as 5 do topo antes de comprar, com os DON!! ainda dados e o Personagem virado; com 7 DON!!, nada; bot x bot; X.Drake ST24-005 + Kid ST02-013; adiado criado por [End of Your Turn] resolve na mesma End Phase; parser dos três momentos; [End of Your Opponent's Turn], início do turno do oponente e início do Main Phase com cartas sintéticas). 6 de 9 falham no código antigo (os outros conferem o que já funcionava: 7 DON!!, o bot e a ordem X.Drake/Kid, que a fila de efeitos já tinha corrigido).

### C15 — Pequenas formas de efeito

**DV-31. "Draw up to X" vira compra obrigatória** — baixo — **corrigido**
- Regra: 4-5-4 ("draw up to X": antes de cada compra o jogador pode encerrar). O passo `draw` não tinha `upTo` (engine.ts:2246): OP02-066 comprava 2 à força.
- Agora: o leitor marca "Draw up to N cards" com `upTo` ("Draw N cards" segue obrigatório). O motor compra uma por vez: antes de cada carta pergunta "comprar 1 carta?" (`confirm` com `drawUpTo`, botões "Comprar 1 carta" / "Parar"); o "não" encerra, inclusive antes da primeira. Com o deck vazio, para de perguntar. O oponente vê só que há uma pergunta (sem o texto nem `drawUpTo`); quantas foram compradas ele vê pelo tamanho da mão. O bot compra enquanto o deck tiver mais de 5 cartas.
- Replays passam para a versão 10; nos antigos, cada pergunta é respondida com sim (as N compras, como antes).
- Na base local, 1 carta usa (OP02-066).

**DV-32. Restrições só valem para quem controla o efeito e só no turno** — baixo — **corrigido**
- `Restriction.player` era sempre o controlador e a restrição durava até o fim do turno (engine.ts:3412).
- Agora: o passo `restrict` tem `opponent` (quem fica restrito é o oponente: "your opponent cannot …") e `duration: 'nextOpponentTurn'` ("until the end of your opponent's next turn"), que vira `Restriction.untilTurn` com a mesma conta dos modificadores (no seu turno, até o fim do turno seguinte; no do oponente, até o fim do próximo dele). O fim do turno remove só as vencidas. Tipo novo `noBlocker` ("cannot activate [Blocker]"): `blockerOptions` fica vazio para o jogador restrito.
- Leitor: as frases de restrição aceitam "you" ou "your opponent", "your/their" ("their own effects", "their hand") e as duas durações, para jogar Personagens (com ou sem custo base mínimo), jogar cartas da mão, pôr Vida na mão com os próprios efeitos, comprar com os próprios efeitos, atacar Líder, deixar DON!! ativos com efeito de Personagem e ativar [Blocker]. Assim P-097 Shanks ("Your opponent cannot activate [Blocker] during this turn.") fica automático.
- Varredura da base local: nenhuma outra carta tem restrição a um jogador com "your opponent cannot" ou "until the end of your opponent's next turn". As outras "your opponent cannot activate [Blocker]" já tinham primitivo próprio (`noBlockerThisBattle`, `noBlockerWhenAttacking`, `cannotBlock`); as "until the end of your opponent's next turn" da base são sobre uma carta (poder, custo, não atacar, não virar: modificadores com `nextOpponentTurn`) ou negam [On Play] (`negateOnPlay`, OP09-081). As 2 cartas "cannot attack any card other than …" seguem com `staticTaunt` (efeito permanente, não restrição por turno).

**DV-33. Mão → Vida com filtro não revela a carta** — baixo — **corrigido**
- Regra confirmada no CR v1.2.1, 11-2-1: "When a card is required to be moved from one secret area to another secret area, such as 'Add Monkey.D.Luffy from your deck to your hand', the card being moved must always be revealed". `handToLife` (engine.ts:3701) só registrava a quantidade.
- Agora: com exigência (filtro: "Character card with a cost of 5", "{Supernovas} type Character card"), o log público traz o nome ("revela e coloca 1 carta(s) da mão (Bon Clay) no topo da Vida."), como na busca do deck para a mão (`search`/`tutor`), que é como o motor revela; na Vida a carta volta a ser oculta (11-2-2). Sem exigência ("add up to 1 card from your hand to the top of your Life cards", ST07-001, ST29-007), a carta vai escondida: não há exigência a conferir, e o Q&A de regras trata do mesmo jeito a carta que vai do deck para a Vida (ninguém pode olhar). Do descarte ou virada para cima, o nome também aparece (a carta já é pública).
- Na base local: ST13-005 Ivankov e OP10-103 Kid (este também "face-up").

Testes (DV-31 a DV-33): `packages/engine/test/draw-restrict-reveal.test.ts` (leitor de OP02-066; compra 1 e para; nenhuma compra e visão do oponente; bot; replay antigo; leitor de "your opponent cannot …"; P-097 sintético sem etapa de bloqueio e com o [Blocker] de volta no turno seguinte; "until the end of your opponent's next turn" com jogar Personagens; Ivankov ST13-005 revela; sem exigência não revela). 9 de 10 falham no código antigo (o último confere o que já era assim).

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
- Leitor de efeitos, na importação: 87 das 117 promos automáticas, 5 parciais, 9 manuais. Algumas manuais e parciais tinham texto corrompido na fonte (P-091 "Play-up to", P-115 "1-rested", P-147 "Character-gains", P-142 frase repetida).
- Testes: bloco "promocionais (allPromos)" e nomes de promo em `apps/server/test/optcgapi-cleanup.test.ts`.
- **Textos estragados e efeitos manuais/parciais (corrigido):**
  - Texto: tabela `SOURCE_TEXT_FIXES` em `packages/engine/src/source-fixes.ts`, aplicada por `applySourceFixes` (e portanto por `fixCard`, no motor e no servidor): P-091 "Play up to 1", P-115 "Give up to 1 rested DON!! card", P-147 "this Character gains +2000 power" (mesmo texto da OP14-090) e P-142 sem a frase repetida ("If your {Straw Hat Crew} type Character with 8000 base power or less would be K.O.'d, you may trash this Stage instead."). Varredura nas 2796 cartas da optcgapi (coleções, starter decks e promos) e na base local: o hífen colado só aparece nessas três promos, por isso a correção é por carta e não uma regra genérica na limpeza do importador. P-142 e P-147 não estão na lista oficial em inglês nem no Q&A de promos; o texto segue o das outras versões.
  - Leitor (construções novas): "cannot be K.O.'d in battle by "Strike" attribute Leaders or Characters" (P-007, `noBattleKOVsAttribute`); "… by Characters without the "Special" attribute" (P-025, `noBattleKOUnlessAttribute`: o Líder, de qualquer atributo, ainda nocauteia; Q&A P-007 confirma a leitura do filtro); "your opponent adds 1 card from their Life area to their hand" (P-009, `opponentLifeToHand`, do topo; obrigatório pelo Q&A); "This Character and up to 1 of your Leader gain +1000 power" (P-036: esta carta sempre, o Líder por escolha; Q&A P-036); "place all cards in your hand at the bottom of your deck in any order. If you do, draw cards equal to the number you placed …" (P-046, `handAllToDeck{bottom}` + `drawEventCount`; as cartas vão na ordem da mão, como o "place the rest at the bottom … in any order" das buscas); "add this Character card to your hand" no [On K.O.] (P-071, `addThisToHand` do trash); condição "If you have any active DON!! cards" (P-114, `minActiveDon: 1`); "Your Leader gains +1000 power for each of your Characters during this turn" (P-024, passo `powerPerMatching`, contado ao resolver); regra de Líder "you can only include {East Blue} type cards in your deck and when your deck is reduced to 0, you win the game instead of losing" (P-117, `deckOnlyType` + `deckOutWin`, como a OP03-040; `leaderAllows`/`validateDeck` recusam a carta sem o tipo, e o construtor de deck e o `simulate:all` deixam de oferecê-la). P-097 já era automática desde a DV-32; P-142 usa a substituição de K.O. pelo Stage (DV-11/12).
  - Resultado (07/10/2026, promos da optcgapi mapeadas como na importação): antes 88 automáticas, 5 parciais, 8 manuais e 16 sem efeito; depois 101 automáticas, 0 parciais, 0 manuais e 16 sem efeito. Nas 2796 cartas da optcgapi não sobra nenhuma parcial ou manual.
  - `simulate:all` com as promos incluídas: partidas não terminavam porque o bot ativava sem parar P-136 Usopp ("[Activate: Main] Give up to 1 rested DON!! card to 1 of your {Land of Wano} type Leader or Character cards", sem custo nem [Once Per Turn]) sem ter alvo {Land of Wano}. O bot (`bot/simple.ts`) só ativa "give rested DON!!" quando há alvo.
  - Testes: `packages/engine/test/promos.test.ts`, com as promos de `test/fixtures/promos.json` (como a API as traz).

**DV-38. Auras filtradas por custo olhavam o custo impresso** — alto — **corrigido**
- Relato do grupo de testes (07/10/2026): com o Líder OP17-079 Luffy ("All of your Characters with a cost of 12 or more gain [Blocker]"), nenhum Elbaph com "+12 cost" (Rodo OP17-094, Gerd OP17-081, Saul OP17-089, Dorry OP17-085, Loki OP17-119) bloqueava, mesmo com custo 13 a 18.
- Causa: `collectAuras` comparava `aura.minCost`/`maxCost` com o custo impresso da carta (`target.cost`), não com o custo atual (`getCost`, que soma `staticCost`, modificadores e auras de custo). O custo da carta em campo é o atual (CR 1-3-6; o Q&A OP17-079 confirma que os "+12 cost" valem para o Líder).
- Correção (engine.ts): a aura compara com `getCost`; "with a base cost of N" (`aura.baseCost`, vindo de `TargetSpec.base`) continua no impresso; uma aura de custo que filtra por custo ("your {X} type Characters with a cost of 2 or more gain +1 cost") olha o custo sem as auras (`ownCost`), para não depender de si mesma. `getCost` passou a ser `ownCost` + auras de custo.
- Mesa: `CardView` passa a mostrar o custo atual da carta em campo (verde/vermelho quando difere do impresso), e o zoom/painel mostram "Custo 13 (impresso 1)".
- Testes: `packages/engine/test/op17-elbaph.test.ts` (cartas reais em `test/fixtures/op17-elbaph.json`), que também cobre os outros dois relatos do grupo, não reproduzidos no motor: Thousand Sunny ST14-017 com o Líder OP17-079 compra 1 carta, e Pirates Docking Six OP15-088 oferece as cartas {Straw Hat Crew} de custo 1 e 2 do descarte e espera a escolha.

**DV-39. Condições com dois tipos e "no other [X] with a base cost of N" lidas pela metade** — médio — **corrigido**
- Achado na revisão das traduções (08/10/2026): o texto em português das Boa OP07-050/OP07-052 só citava {Amazon Lily}, e a tradução expôs que o leitor guardava só o primeiro tipo de "If you have 2 or more {Amazon Lily} or {Kuja Pirates} type Characters" (`minTypedCharacters.type`): um campo com 2 {Kuja Pirates} não ativava o efeito. "If you have no other [Shirahoshi] with a base cost of 2" (OP12-102) descartava o custo: qualquer outra [Shirahoshi] bloqueava a aura.
- Correção: `minTypedCharacters.types` (todos os tipos; `type` continua sendo o primeiro) e `noOtherNamedBaseCost` (parser.ts, engine.ts, render.ts). "Up to 1 of your [Kouzuki Momonosuke] gains +20 cost" (OP16-087 Shinobu) caía no modo manual porque o alvo só com nome valia para Líder ou Personagem e custo é só de Personagem: `withTarget` restringe a Personagens.
- Tradução (render.ts), achados da mesma revisão: `upTo: 99` sem `all` ("your opponent's Characters with a total cost of 4 or less", OP17-119 Loki) saía "até 99 Personagens"; "Set all of your DON!! cards as active" (OP13-028) saía "até 99 dos seus DON!!"; "Set the cost of … to 0" (OP03-091) saía "Dê −99 de custo"; a segunda frase estática de "…, and if it is your opponent's turn, this Character gains +3000 power" perdia o [Turno do Oponente]; frases estáticas com a mesma condição eram repetidas ("Se X, ganha [Blocker]. Se X, recebe +1000") e agora viram uma; "with a base cost of 5" em aura saía "com custo 5 ou menos com custo 5 ou mais"; "if your opponent has 2 or less Characters" saía "se não o oponente tiver 3 ou mais"; "you may return 1 DON!! … instead" saía "você pode DON!! −1 em vez disso"; "for every 5 cards" saía "5 × carta"; "to your Leader" saía "a o seu Líder"; "Rest up to a total of 2 of your opponent's Characters or DON!! cards" repetia a frase; "up to 1 each of [A], [B], and [C]" saía "até 3 [A], [B] ou [C] Personagens com nomes diferentes".
- Testes: `packages/engine/test/i18n-review.test.ts` (cartas reais). Conferência de toda a base: `npm run translations:check -w @gumgum/server` (ver [manutencao.md](manutencao.md)).

### C17 — Auditoria das cartas automatizadas

Card do Trello "Testar as funcionalidades das cartas em busca de bugs" (09/10/2026). Base importada da optcgapi (2796 cartas) e, para cada carta, o texto oficial comparado com as habilidades que `buildCardDef` gera, conferindo no `engine.ts` como cada campo é executado. Revisadas 1171 cartas, na ordem de prioridade do card: os 143 Líderes de todas as coleções, OP10 a OP17 e EB01 a EB04. Cada correção foi conferida com um diff das habilidades de toda a base antes e depois (só as cartas listadas mudaram).

**DV-40. Efeitos lidos ou executados errado** — alto — **corrigido**
- Alto:
  - **Law OP01-002 (Líder):** "If you have 5 Characters, return 1 …. Then, play … different color than the returned Character": a jogada não dependia da devolução, e com 0 a 4 Personagens o Líder jogava de graça qualquer Personagem de custo 5 ou menos. Agora o "Then" que cita "the returned Character" só acontece se algo foi devolvido (`lastDone`).
  - **Mr.2.Bon.Kurei(Bentham) OP14-091:** o texto escreve "other than [Mr.2.Bon.Kurei.(Bentham)]" (um ponto a mais), e o nome não batia: o [On K.O.] jogava a si mesma de volta do descarte. `hasName` ignora pontos e espaços (também junta "Mr. 9"/"Mr.9" e "Zephyr (Navy)"/"Zephyr(Navy)", que são as mesmas cartas na fonte).
  - **Octoballoon OP15-106:** "play up to 1 yellow Character or Stage card with a cost of 2 or less": cor e custo só valiam para um dos lados (jogava qualquer Personagem amarelo, de qualquer custo). `parseCardFilter` aplica cor e custo às duas categorias.
  - **Klabautermann EB02-033:** "If you have [Merry Go] on your field": [Merry Go] é um Stage e `haveCharacterNamed` só olhava os Personagens; a carta nunca ganhava [Blocker]. A condição olha também o Stage.
- Médio:
  - **"you may trash 1 card from your hand. If you do, …"** (Newgate OP17-040, Zoro OP16-035, OP05-038, OP15-020): com menos cartas na mão do que o descarte pede, o jogador aceitava, não descartava nada e recebia o efeito. Agora o efeito opcional nem é oferecido (o tamanho da mão é público).
  - **"If you have N or more rested cards"** (Bonney OP12-118, Trichiliocosm OP06-038, Katakuri ST16-003, Bege ST24-001): não contava os DON!! virados, como já fazia a versão do oponente. Nova condição `ownRestedCardsMin`.
  - **"return N of your active DON!! cards"** (Luffy EB02-061, Sengoku OP16-060): o custo aceitava DON!! virados e dados. Novo `AbilityCost.donMinusActive` (só os ativos da área de custo, sem escolha).
  - **"This effect can be activated when …" no começo do efeito** (Shu OP11-088, Vinsmoke Ichiji OP11-043): a condição de ativação ficava nos passos, então o efeito disparava, não fazia nada e gastava o [Once Per Turn]. O Shu gastava o uso do turno num ataque do Líder e não ganhava +5000 no ataque seguinte de um Personagem (Slash). A condição vai para a habilidade; o "If that Character has the (Slash) attribute" do Shu continua no efeito.
  - **Foxy OP07-059 (Líder):** a condição "3 or more {Foxy Pirates}" só valia para o Líder do oponente, não para o Personagem escolhido.
  - **"returned to your DON!! deck by your effect"** (Crocodile OP04-058, Charlotte Brulee EB03-033): disparava também quando um efeito do oponente fazia você devolver DON!!. O evento `donReturned` guarda quem causou a devolução (`byYourEffect`).
- Baixo:
  - **Portgas.D.Ace OP13-119:** "you may return up to 1 …. If you do, your opponent plays …": aceitar e não devolver nada ainda deixava o oponente jogar. O "If you do" depois de um "up to" exige que algo tenha sido feito (`lastDone`).
  - **Nico Robin EB03-055:** "You may deal 1 damage" era obrigatório; agora pergunta.
  - **Portgas.D.Ace OP03-001 (Líder):** "When this Leader attacks or is attacked" disparava em qualquer ataque do oponente, também contra Personagens. Agora é o evento `leaderBattle`.
  - **Koala OP12-081 (Líder):** "plays a Character using a Character's effect" valia para qualquer efeito (Evento, Stage, Líder). **Sanji OP02-026 (Líder):** "When you play a Character … from your hand" valia também para Personagens jogados do deck ou do descarte. O evento `characterPlayed` guarda `fromHand` e `byCharacterEffect`.
- Testes: `packages/engine/test/card-audit.test.ts`, com as cartas reais em `test/fixtures/bugs-auditoria-cartas.json` (20 dos 22 testes falham sem a correção; os outros 2 são os casos negativos).

**DV-41. Leituras que dependem de ruling ou de interface nova** — baixo — parte corrigida
- Regras confirmadas pelo dono do projeto (09/10/2026): **"your cards" é qualquer carta no campo** (Líder, Personagens, Stage e DON!!) e **"up to N" sempre aceita 0**. Com isso, na rodada 2 (DV-42):
  - "rest N of your cards" (custo; OP14-020, OP14-029, OP14-033, OP14-036 a OP14-038, OP15-035, OP16-033, OP17-021, OP17-037, OP17-038, EB04-015, EB04-019): o jogador escolhe quantos DON!! ativos virar e depois as cartas (`AbilityCost.restOwn.withDon`; só pergunta quando há escolha). A própria carta pode pagar (o Líder OP14-020 se vira).
  - "rest up to N of your opponent's cards" (OP13-033, OP14-024, OP15-032, OP16-035) e "up to N of your opponent's rested cards will not become active" (OP15-023): a cada carta, um DON!! do oponente, uma carta do campo dele ou nada (passo `restDonOrCharacter`, com `skipRefresh` para o segundo).
  - "up to" nos passos de Vida (OP10-109, OP14-072, OP14-112, OP14-115, Kaido ST04-001 e toda carta com "add up to N card(s) from the top of your deck to the top of your Life cards"): pergunta a quantidade, do máximo para 0 (`upTo` em `trashLife`, `addLifeFromDeck` e `opponentLifeToHand`).
- Pendente:
- Ms. All Sunday OP12-075: "your opponent may add 1 DON!! card" adiciona sem perguntar ao oponente (falta a escolha do oponente nesse passo).
- ~~Usopp OP15-024: "cannot be rested by your opponent's Leader and Character effects" também bloqueia Eventos e Stages do oponente.~~ Corrigido na rodada 3 (DV-43).
- ~~"If X, A. Then, B." aplica a condição só a A.~~ **Conforme** (regra confirmada pelo dono do projeto em 09/10/2026): o B só depende do A quando o A é custo do efeito ("You may X: …", "you may X. If you do, …"); fora isso, o B acontece mesmo que o A não aconteça. Ex.: Hody Jones OP06-035 ("Rest up to a total of 2 … Then, add 1 card from the top of your Life cards to your hand") vira as cartas com 0 de Vida; Leo OP10-057 descarta 1 carta mesmo com outro Líder (o "If your Leader is [Usopp]" é condição, não custo). O motor já fazia assim.
- ~~`haveCharacterNamed` não conta o Líder.~~ Corrigido (regra confirmada em 09/10/2026: "If you have [X]" é qualquer carta sua com o nome, Líder incluído, como o +4000 do evento do OP17 para [Shanks]): "If you have [Jewelry Bonney]" (EB04-056), "[A] and [B]" (OP16-040, OP15-064, OP15-072, ST30-016) e "[Gecko Moria] with 10000 power or more on your field" (OP15-080) contam o Líder e o Stage; "If you have a [X] Character" (OP02-031, OP07-030, OP08-109) continua só com Personagens (`Condition.haveCharacterOnly`). Testes em `card-audit.test.ts`.
- `onlyTypeIncludes` falha quando você não tem nenhum Personagem (EB03-038).
- ~~Gecko Moria OP06-086 ("Play 1 card and play the other card rested") e Thatch OP03-005 ("trash this Character at the end of this turn" para a carta que voltou ao campo).~~ Corrigidos na rodada 3 (DV-43).
- Mr.2.Bon.Kurei(Bentham) ST08-013: "you may K.O. the opponent's Character you battled with. If you do, K.O. this Character" nocauteia o Mr.2 mesmo quando o Personagem do oponente não sai (já foi nocauteado na batalha, está protegido ou foi salvo por substituição). Corrigir exige que o passo de K.O. registre o que de fato saiu do campo.
- Texto dos spoilers (fonte não oficial; some quando a carta sair na API): EB05-039 Pink Hornet com os tipos "Vinsmoke Family"/"Germa 66" em vez de {The Vinsmoke Family}/{GERMA 66}; OP18-065 Saint Gunko com o atributo "?"; erros de digitação já tolerados pelo leitor (EB05-048 "cost of O", EB05-019 "{Land of Wano]").
- Texto da fonte sem o sinal de menos (ST31-004, ST33-004, ST34-004, ST34-005, ST35-002: "1000 power", "3 cost", "DON!! 4"): o leitor já lê os valores negativos; só a exibição em inglês fica errada.

**DV-42. Rodada 2 (OP01 a OP09): efeitos lidos ou executados errado** — alto — **corrigido**
- Revisadas 920 cartas (OP01 a OP09, fora os Líderes, já vistos na rodada 1), com as correções da rodada 1 já aplicadas. Diff das habilidades e da tradução de toda a base antes e depois: só as cartas listadas (e as das regras de DV-41) mudaram.
- Alto:
  - **Crocodile OP09-046:** "{Cross Guild} type Character card or Character card with a type including "Baroque Works" with a cost of 5 or less": o custo só valia para o lado "Baroque Works", e qualquer {Cross Guild} da mão (Buggy de custo 10) entrava de graça. Em "A or B …", o custo, o poder e o "other than" do fim valem para os dois lados (também Mr.3 OP09-056: "other than [Mr.3(Galdino)]").
  - **Plague Rounds OP04-055, Aramaki OP06-043 e os Shandian OP06-102/111/114:** o custo "place 1 Character/Stage … at the bottom of the owner's deck" só aceitava carta própria; sem "of your", vale qualquer uma, e é assim que o Evento remove um Personagem do oponente (a remoção passa pelas proteções). "… at the bottom of your deck" (P-086) continua só com as suas.
  - **Marco OP03-013:** a API corta o [On K.O.] depois do custo ("You may trash 1 Event from your hand"): descartar o Evento não fazia nada. Texto da lista oficial em `SOURCE_TEXT_FIXES` (com `$`: só troca se o texto terminar cortado).
- Médio:
  - **Charlotte Pudding OP03-112:** a API traz "{Sanji}" (tipo) no lugar de "[Sanji]" (nome); a busca nunca achava os [Sanji]. Corrigido pela lista oficial.
  - **"Then, if that Character has 5000 power or less, K.O. it"** (Zephyr OP06-074, Black Hole OP09-098, Ice Oni OP04-047): comparava o poder ou o custo impresso. Em campo vale o atual; revelada do deck ou da Vida, o impresso.
  - **I Bid 500 Million!! OP05-096:** o "Then, if you have a {Celestial Dragons} type Character, draw 1 card" depois da última opção do "Choose one" ficava só dentro da 3ª opção.
  - **Rosinante OP04-119:** "your active Characters with a base cost of 5" protegia também os virados (`Aura.rested`).
  - **Rayleigh OP08-118:** "give 1 Character −3000 power and the other −2000": dava para escolher o mesmo Personagem duas vezes (`TargetSpec.notLast`).
  - **Basil Hawkins OP07-029:** a substituição com o custo "rest 1 of your opponent's Characters" podia ser paga escolhendo 0 alvos.
  - **Luffy OP01-024:** "cannot be K.O.'d in battle by "Strike" attribute Characters" protegia também contra Líderes Strike.
  - **Helmeppo OP03-091** (e todo "with no base effect" em campo): um Personagem só com [Blocker] contava como sem efeito. Agora vale a regra do Q&A (P-011/OP06-074): sem efeito base é a carta sem texto; [Trigger] também é efeito.
- Baixo:
  - **"reveal 1 card from the top of your deck and play up to 1 …"** (OP06-057, OP08-052, OP08-054): jogava a carta revelada sem perguntar.
  - **Hotori OP05-111:** depois de aceitar o custo "You may play 1 [Kotori] from your hand", dava para escolher nenhuma carta e o efeito acontecia.
  - **Law OP01-047:** "You may return 1 Character to your hand" não deixava devolver o próprio Law. Os custos com cartas suas ("return/rest/K.O./trash 1 of your Characters") aceitam a própria carta, a menos que o texto diga "other than this Character" (`excludeSelf`).
  - **"Give up to 2 rested DON!! cards to …"** (Chaka OP05-008, Brook ST01-011 e as outras com "up to N"): dava sempre o máximo; com um alvo só, pergunta quantos.
- Replays: a versão sobe para 11 (`REPLAY_VERSION`). `upgradeReplayActions` responde às perguntas novas como o motor fazia (a quantidade máxima, nenhum DON!!, sim) e descarta a resposta gravada para uma pergunta que deixou de existir. As salas online começadas antes do deploy passam pelo mesmo upgrade ao serem refeitas (`rebuild` em `apps/server/src/online/room.ts`).
- Testes: `packages/engine/test/card-audit.test.ts` (rodada 2 e regras de DV-41; 19 testes novos, que falham sem a correção), com as cartas reais em `test/fixtures/bugs-auditoria-cartas.json`. Testes antigos que fixavam o comportamento errado foram atualizados: `parsed-engine.test.ts` (Strike por Personagem), `protections.test.ts` (a própria carta paga o custo de K.O.), `i18n-review.test.ts` (Rosinante "ativos") e os que passam pelas perguntas novas.

**DV-43. Rodada 3 (starter decks, promos e spoilers de EB05/OP18): efeitos lidos ou executados errado** — alto — **corrigido**
- Revisadas 522 cartas: 304 dos starter decks (fora os Líderes, vistos na rodada 1), 118 promos (P-xxx e PRB) e as 90 cartas com efeito dos spoilers de EB05 e OP18 (Líderes incluídos; baixados do feed com `cards:import --spoilers`). Diff das habilidades e da tradução de toda a base antes e depois: só as cartas listadas mudaram.
- Alto:
  - **Sabo ST13-007, Ace ST13-010, Luffy ST13-014:** "If that card is a [Sabo] with a cost of 5, you may play that card. If you do, up to 1 of your Leader gains +2000": com a condição falsa, o "you may" era pulado mas o "If you do" não, e o Líder ganhava +2000 sem jogar nada. No motor: um "you may" (`payCost` com `scope`) pulado pela condição pula também o trecho dele.
  - **Avalo Pizarro ST27-001:** "rest 1 of your [Fullalead] cards" não aceitava o Stage [Fullalead]; o custo nunca podia ser pago.
  - **Zoro OP18-017** (e OP14-016, OP15-009): "you may give your Leader −2000 power during this turn instead" exigia o Líder ativo, o que só vale para "your 1 active Leader" (`AbilityCost.leaderPowerMinusActive`); com o Líder virado (já atacou), a substituição nunca era oferecida.
  - **Zambai OP18-066:** "You may K.O. 1 of your Stages" não tirava o Stage do campo (o passo só sabia nocautear Personagem) e o [Rush] saía de graça.
- Médio:
  - **Hody & Hyouzou P-062** e mais 19 cartas: a API junta os dois atributos ("Slash Strike"); a carta não contava como nenhum dos dois. `applySourceFixes` separa os atributos conhecidos; `data/cards` (ST12, ST24, ST25, ST30) atualizado.
  - **Buggy P-084:** "all Characters with a cost of 3 or 4 cannot attack" olhava o custo impresso (`Aura.exactCosts` agora usa o atual, como `minCost`/`maxCost`).
  - **Borsalino ST33-004:** "During the turn in which a card in your hand is trashed by an effect" só contava o descarte pelo próprio efeito; agora conta também o descarte forçado pelo oponente, ao acaso, de toda a mão e o de "até ficar com N".
  - **OP18-069, EB05-033 e EB05-059** (spoilers) caíam no modo manual; o leitor ganhou as redações ("you may DON!! −1 and rest this Character instead", "If your Leader has the {X} type, and the number of DON!! …", "all of your Characters with 4000 base power and the {X} type cannot be K.O.'d in battle until the end of your opponent's next End Phase").
- Baixo:
  - **Kid P-067:** "cannot attack any card other than the Character [Eustass"Captain"Kid]" só deixava atacar a primeira cópia.
  - **Luffy PRB02-005:** "your opponent rests 1 of their active DON!! cards at the start of their next Main Phase" era lido como "não desvira 1 DON!!" e sumia quando o oponente não tinha DON!! virado; agora vira 1 DON!! ativo no início da Fase Principal dele (`skipRefreshDon.atMainPhase`).
  - **Zephyr ST05-010:** o +3000 contra Personagem "Strike" sumia no fim da batalha; dura o turno.
  - **Kid ST36-005, Nami ST29-008:** "turn 1 card from the top or bottom of your Life cards" sempre virava a de cima; o jogador escolhe topo ou fundo.
  - Pendências de DV-41 resolvidas: **Usopp OP15-024** ("… by your opponent's Leader and Character effects": Eventos e Stages do oponente viram), **Gecko Moria OP06-086** (o jogador escolhe qual das duas entra virada) e **Thatch OP03-005** (o efeito adiado sobre "this Character" não vale para a carta que saiu e voltou ao campo).
- Custos com a própria carta (DV-42): a carta que já paga outra parte do custo ("rest this card and 1 of your [Enel] cards") não conta duas vezes.
- Replays: as perguntas novas (topo ou fundo da Vida) entram nas respostas implícitas da versão 11.
- Testes: `packages/engine/test/card-audit.test.ts` (rodada 3; 15 testes novos, que falham sem a correção).

---

## Itens a confirmar (sem ruling oficial claro)

- Dano de efeito de 2 ou mais com 1 de Vida: o motor segue a leitura literal de 1-2-1-1-1 (perde no 2º ponto). O Q&A EB03-055 Robin diz que dano de efeito com 0 de Vida vence; não há ruling para "2 de dano de efeito com 1 de Vida". Rever se a Bandai publicar um.
- Substituição de dano ("If you would take damage, … instead") oferecida mesmo com 0 de Vida.
- `handCounter.set` sobrescrevendo um Counter maior (CR 2-10-4: vale o maior).
- Cadeia "If … Then …" (4-10): a condição vale só para o trecho dela; o "Then" depende só de custo ("You may X:", "If you do") — regra confirmada pelo dono do projeto (DV-41).
- `cancel` e `detachDon` (desfazer) estão fora das regras oficiais — o Q&A proíbe mover DON!! já dado. São conveniências de interface protegidas contra vazamento; manter documentado.

## Conferência completa por regra

| Área | Conforme | Divergente |
|---|---|---|
| Preparação e derrota (1-2, 5-2, 9) | Escolha de primeiro/segundo, "at the start of the game" depois dela e com escolha, mulligan, Vida com o topo do deck no fundo, derrota por dano sem Vida e por deck 0 (checada a cada passo), derrota simultânea empata, desistência, vitória por efeito | — |
| Fases (6) | Expiração "until the start of your next turn", "at the start of your/your opponent's turn" antes de devolver DON!! e desvirar, devolver DON!! e desvirar, Draw, DON!! Phase, "at the start of your Main Phase", sem ataque no 1º turno, [End of Your Turn]/[End of Your Opponent's Turn] uma vez, "at the end of this turn" depois deles (também os criados na End Phase), expiração de "this turn" | — |
| DON!! (6-5-5, 8-3) | Dar DON!!, +1000 só no próprio turno, DON!! voltam rested, [DON!! xX], DON!! −X com escolha | — |
| Batalha (7) | Alvos, [When Attacking] antes de [On Your Opponent's Attack], saída de cena ao fim de cada etapa, [Blocker], [On Block], vários Counters, ≥ vence, Double Attack fixo em 2, [Banish], K.O. do perdedor, efeitos de fim de batalha, [Double Attack] contra 1 de Vida | DV-21, DV-22, DV-23 |
| Dano e [Trigger] (4-6, 10-1-5) | Dano um a um, [Trigger] no lugar de ir para a mão, recusar sem revelar, Trigger antes do 2º dano, `damageTaken`/`lifeRemoved` depois do dano, efeitos disparados esperam o dano, carta do [Trigger] fora das áreas enquanto resolve | — |
| Efeitos (8) | "may" e custos opcionais, auto effect por ocorrência, custo tudo-ou-nada, [Once Per Turn] por carta, substituição opcional e não reaplicada, "up to" 0, busca pode não achar, [On K.O.] só por K.O. e com as condições vistas no campo, "cannot be K.O.'d" só contra K.O., auto effects não ativam em área secreta, [Trigger] de Evento não é "activate an Event", fila de efeitos disparados (8-6), sem "up to" escolhe o máximo possível, [Once Per Turn] reinicia na carta que volta ao campo, todas as substituições oferecidas em ordem e em toda remoção por efeito (um pagamento para as simultâneas), "cannot be K.O.'d by your opponent's effects" só contra o oponente, protegido não paga custo de K.O., «Set Power to 0» como −(poder atual), vários poderes base: vale o maior, "draw up to" uma por vez podendo parar | DV-12 (custos) |
| Áreas e outros (3, 10, 11) | Limite de 5 como regra, Stage único, K.O. de Stage com as proteções, carta nova ao sair do campo, Líder não se move, Rush/Rush: Character, entrar rested, poder negativo, custo negativo = 0, Vida do topo, Vida virada para cima pública (também a que vem do campo), revelar na busca, olhar e devolver, [Main]/[Activate: Main] fora de batalha, [Counter] só no Counter Step, laço infinito empata, mão → Vida com exigência revelada | — |
| Informação oculta (`view.ts`) | Mão/deck/Vida escondidos, contagens abertas, trash aberto, "look at" só para quem olha, revelada volta a ficar oculta, decisões que leem a mão sempre abrem, log secreto | — |
