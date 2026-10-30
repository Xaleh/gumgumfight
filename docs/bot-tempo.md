# Tempo no One Piece Card Game: o que o bot precisa saber

Este documento registra os conceitos de "tempo" (ritmo, iniciativa, uso dos recursos do turno) que um
jogador de TCG usa sem pensar e que o bot heurístico antigo (`packages/engine/src/bot/simple.ts`) não
tinha. Cada conceito aponta para o termo da função de avaliação (`packages/engine/src/bot/evaluate.ts`)
ou para a parte do planejador (`packages/engine/src/bot/planner.ts`) que o representa, e para o teste
de posição que o cobre (`packages/engine/test/bot-positions.test.ts`).

A arquitetura em uma frase: o bot **simula** as jogadas com o próprio motor (`applyAction`) e compara
os resultados por uma **função de avaliação**; os conceitos abaixo entram como termos dessa função ou
como regras de quais linhas a busca explora. Nada aqui é regra fixa do tipo "se X, faça Y".

## 1. Os recursos do turno: DON!!

No OPTCG o DON!! é o tempo em estado puro: a cada turno você ganha 2, e cada DON!! não usado no turno é
tempo perdido. Usos, em ordem do que um jogador bom considera:

1. **Jogar na curva.** Baixar um Personagem do custo que o DON!! permite, todo turno, é a base: o
   tabuleiro é o que converte DON!! em dano nos turnos seguintes.
2. **DON!! em quem ataca.** Sobrou DON!!: +1000 em cada ataque. Anexar em quem **não** vai atacar
   neste turno não vale nada (os DON!! voltam para a área de custo na Renovação).
3. **DON!! guardado para a defesa.** Eventos [Counter] custam DON!! no turno do oponente. Fechar o
   turno com 0 DON!! ativo e um Evento [Counter] na mão é jogar fora a carta.
4. **DON!! −X** (devolver ao deck de DON!!) é custo permanente: aquele DON!! não volta mais.

| Conceito | Onde está | Teste |
|---|---|---|
| Anexar só em quem ataca | `planner.ts`: `candidateMoves` gera "anexar k DON!! e atacar" como jogada composta; `attachDon` solto só no Líder | `anexa DON!! e ataca no mesmo turno` |
| DON!! anexado sem ataque não vale | `evaluate.ts`: `donReady` só conta no meio do próprio turno e em carta que ainda pode atacar; no fim do turno vale zero | `não gasta DON!! em quem não pode atacar` |
| Guardar DON!! para Evento [Counter] | `evaluate.ts`: `handCounterEvent` só é somado se `playCost ≤ donActive` | `guarda DON!! para Evento [Counter]` |
| DON!! −X custa de verdade | `evaluate.ts`: `don` (2200 por DON!! em campo) | `simulation.test.ts` (sem travar) |

## 2. Vida como recurso, não como placar

Levar dano cedo não é ruim: cada carta de Vida que sai **vai para a mão** (e pode ter [Trigger]). O
jogador que gasta dois Counters para proteger a quinta Vida perde duas cartas para ganhar uma. O
cálculo muda conforme a Vida cai: com 1 ou 2 de Vida cada ponto é a partida.

Por isso a Vida entra na avaliação por **tabelas**, não por "1 Vida = N pontos" — uma para a própria Vida
(`life`) e outra para a do oponente (`lifeOpp`). A do oponente saiu da otimização em auto-jogo (seção 9); a
própria, do ajuste por imitação dos 4 primeiros dos torneios (seção 11), que a baixou de
11 450 / 19 300 / 25 450 / 29 150 / 33 800:

| Vida | própria: acumulado | o último ponto vale | do oponente: acumulado | o último ponto vale |
|---|---|---|---|---|
| 5 | 25 802 | 4 150 | 64 700 | 3 150 |
| 4 | 21 652 | 4 199 | 61 550 | 4 450 |
| 3 | 17 453 | 3 582 | 57 100 | 5 100 |
| 2 | 13 871 | 4 878 | 52 000 | 14 600 |
| 1 | 8 993 | 8 993 | 37 400 | 37 400 |
| 0 | 0 | — | 0 | — |

A assimetria é a principal lição da otimização: **as duas últimas Vidas do oponente valem quase três
vezes** o que as mesmas Vidas valem para o bot. Com o oponente em 2 ou 1, o bot joga para fechar a
partida (DON!! nos ataques ao Líder, ataques extras para drenar os Counters) em vez de trocar
Personagens; com o oponente em 5 ou 4, cada acerto vale pouco mais que a carta que ele ganha (~1 600),
e tirar um Personagem caro continua sendo melhor.

Na defesa, uma carta com Counter +1000 na mão vale ~2 600, e a carta que sai da Vida, 2 900: com 5 a 2 de
Vida, perder um ponto custa de 3 600 a 4 900 e devolve uma carta, então o bot só defende quando o resto do
turno do oponente (seção 3a) torna o acerto perigoso; com 1 de Vida, defende com o que precisar. Os 4 primeiros
dos torneios defendem o Líder com 2 de Vida em 42 a 50% das vezes em que a mão bastava, e com 3 em 17 a 50%; a
tabela anterior fazia o bot defender 67 a 72% e 54 a 61%.

| Conceito | Onde está | Teste |
|---|---|---|
| Não contar com Vida alta | `evaluate.ts`: `life[]` + `handCard` | `com 5 de Vida deixa o ataque passar` |
| Fechar a partida | `evaluate.ts`: `lifeOpp[]` | `conta com o Blocker do oponente` |
| Defender com Vida baixa | idem | `com 1 de Vida usa Counter`, `com 2 de Vida e nenhum outro atacante do oponente deixa passar` |
| Bloquear para salvar o Líder no fim | `planner.ts`: `decidePending` simula cada bloqueio | `bloqueia com Vida baixa` |

## 3. Vantagem de cartas e pressão

Cada ataque ao Líder força o oponente a escolher: perder Vida (ganhando a carta) ou gastar Counter
(perdendo cartas). Atacar quando a **mão dele está pequena** é quando o ataque tem mais chance de
passar; atacar quando a mão dele está cheia pode ser bom mesmo assim, se o objetivo é **drenar** os
Counters antes do turno decisivo.

A mão do oponente é escondida, então o bot não simula o Counter dele; ele desconta um **risco**:

```
risco = P(ele consegue o Counter) × P(ele quer gastar) × (valor do acerto − valor do ataque falhar)
```

- `P(consegue)` (`counterAbility`): cada carta escondida tem Counter com chance `counterCard` (0,72; é
  +2000 com `counterBig`, 0,2) e **as cartas somam**: margem de +1000 contra 5 cartas é quase certa de ser
  coberta; +4000 contra 1 carta, impossível. Os valores vêm da composição dos decks prontos (49% das cartas
  têm +1000, 15% +2000), puxados para cima porque quem joga guarda os Counters na mão.
- `P(quer)` (`counterWill`) cresce quando o alvo é o Líder com pouca Vida (0,38 com 4 ou mais, 0,55 com 3,
  0,75 com 2, 0,85 com 1) ou um Personagem caro, e cai a cada 1000 a mais que ele teria de cobrir
  (`counterStack`: gastar duas cartas por uma Vida é raro com Vida alta, normal com Vida baixa). A tabela do
  Líder veio dos replays (seção 11): quando a mão bastava, as pessoas defenderam 78% com 1 de Vida, 68% com 2,
  48% com 3 e 33 a 36% com 4 ou mais; a tabela anterior (1, 0,9, 0,5, 0,25) era otimista com Vida baixa e
  pessimista com Vida alta.
- **Ataque fatal**: ele defende sempre que pode, e para sobreviver basta parar **um** dos acertos da linha.
  O risco do ataque que venceria é a chance de ele cobrir o acerto **mais barato** da linha, com a mão que
  tinha naquele momento (cada acerto anterior lhe deu uma carta da Vida). Antes, cada ataque era avaliado
  sozinho e o bot apostava a partida num terceiro ataque "70% de chance de passar" contra 5 cartas na mão.
- "Falhar" ainda tira uma carta da mão dele, então o risco raramente anula um ataque com margem.
- Uma vitória **provável** vale `winCap` (120 000, mais ou menos uma partida inteira de material) vezes a
  chance de passar, e não `win` (10 milhões): com `win`, 5% de chance de vencer agora valia mais que
  qualquer posição, e o bot jogava o turno inteiro fora em ataques que o oponente parava com uma carta.
  A posição que sobra quando o ataque fatal é parado é avaliada no fim do turno, como as outras linhas.

| Conceito | Onde está | Teste |
|---|---|---|
| Atacar com margem quando a mão dele é grande | `planner.ts`: `counterAdjust`; `candidateMoves` oferece k, k+1 e k+2 DON!! | `prefere margem contra mão cheia` |
| Mão do oponente é custo, a própria é valor | `evaluate.ts`: `handCardOpp`, `handCardBase` + `handCounter` | `avaliação: carta na mão` |

## 3a. Defesa: quantos ataques ainda vêm

Decidir um Counter olhando só o ataque da vez é o erro que um humano explora: gastar as duas cartas no
primeiro ataque e morrer no terceiro, ou guardar tudo e levar o ataque fatal. No turno do oponente, a
avaliação soma a **ameaça** do que ainda falta (`incomingHits` / `incomingThreat` em `evaluate.ts`):

1. Atacantes do oponente que ainda podem atacar (em pé, sem enjoo de invocação) e o DON!! ativo dele,
   distribuído para alcançar o Líder do bot com o máximo de ataques.
2. A melhor defesa do bot: cada [Blocker] em pé para o ataque mais caro de cobrir; os Counters da mão
   (impressos e Eventos [Counter] que o DON!! ativo paga) param os mais baratos.
3. `threatHit` por ataque que passa mesmo assim, e `lethal` se nem a defesa completa salva o Líder.

Assim a escolha "Counter agora ou guardar" compara as duas linhas já contando o resto do turno.

No planejamento do próprio turno (`defenseOrPlan` em `planner.ts`) só o **ataque fatal na mesa** pesa
(`lethalPlan`, 60 000): encerrar o turno com o oponente tendo mais acertos que a Vida do bot aguenta,
contando os Blockers em pé e os Counters da mão, é o erro que qualquer humano castiga. O resto da ameaça
(ataques que passam sem matar) fica de fora: ali ela deixava o bot passivo — guardando Blockers e cartas
na mão em vez de pressionar — e ele perdia mais do que ganhava (seção 9).

| Conceito | Onde está | Teste |
|---|---|---|
| Blocker em pé e Counter na mão seguram o ataque fatal | `evaluate.ts`: `incomingHits` | `ameaça: o Blocker em pé e o Counter na mão seguram o ataque fatal do oponente` |

## 4. Personagem virado é uma janela

Só se ataca Personagem **virado** (ou o Líder). Um Personagem que atacou fica virado até a Renovação
do dono: ele é a janela para removê-lo. Efeitos de "virar 1 Personagem do oponente" só valem se o
ataque vem **no mesmo turno**; virar e não atacar é o erro clássico do bot antigo.

No bot novo isso sai da simulação: a linha "ativar efeito de virar → atacar o virado → K.O." pontua o
Personagem removido; a linha "só virar" pontua zero (e paga o custo por ação).

A busca em feixe tem um ponto cego: cada passo guarda só as melhores linhas pela avaliação **daquele
momento**, e um acerto no Líder pontua na hora enquanto uma carta jogada só vale o que põe em campo. Dois
remendos em `planTurn`:

- **Linhas "tudo no Líder"** (`allOutLines`): antes do primeiro ataque, o bot também simula a linha inteira
  "cada atacante com o DON!! que precisa para alcançar o Líder, o que sobra por cima" (nas duas ordens, com e
  sem o DON!! extra). Sem isso, o feixe enchia de K.O.s e cartas jogadas e a linha de quatro acertos era cortada
  antes do fim (teste `acha o ataque fatal com vários atacantes pequenos`). Note que "quatro acertos contra 3 de
  Vida e a mão vazia" não é vitória garantida: cada acerto dá uma carta ao oponente, e o modelo de Counter
  (seção 3) conta com elas — a linha vale pelo que tem de chance de passar.
- **Reserva no feixe**: no máximo `SIBLINGS` (2) variantes da mesma jogada (o mesmo ataque com mais ou menos
  DON!!) por passo, e a melhor linha de cada número de cartas jogadas fica no feixe mesmo fora das primeiras.
  Sem a reserva, com 7 DON!! e duas cartas na mão o bot nunca via a linha que baixa as duas antes de atacar. Do lado defensivo, o
Personagem que atacou fica **exposto** ao contra-ataque, e a avaliação desconta parte do valor dele
quando o oponente consegue alcançá-lo.

| Conceito | Onde está | Teste |
|---|---|---|
| Virar e atacar | `planner.ts`: busca em feixe (a linha inteira é avaliada no fim) | `vira o Personagem e o ataca` |
| Atacar Personagem virado quando o K.O. compensa | `evaluate.ts`: `fieldCardValue` (custo, poder, palavras-chave) | `prefere K.O. de Personagem caro a dano no Líder com Vida alta` |
| Exposição do atacante | `evaluate.ts`: `exposed` | `avaliação: Personagem virado exposto` |

## 5. Blocker e Rush

- **[Blocker]** em pé protege o Líder e qualquer Personagem: o atacante tem que passar por ele (ou
  tirá-lo primeiro). Para o bot atacante, o modelo do oponente **bloqueia do jeito que mais prejudica**
  o bot (minimax de um nível em `opponentAnswer`), então a busca aprende a atacar o Blocker ou a
  atacar com margem para matá-lo.
- **[Rush]** ataca no turno em que entra: pressão imediata, e por isso vale um pouco mais no tabuleiro.

| Conceito | Onde está | Teste |
|---|---|---|
| Valor de Blocker em campo | `evaluate.ts`: `blocker` (+1500) | `avaliação: Blocker` |
| Oponente bloqueia na simulação | `planner.ts`: `opponentAnswer('block')` | `conta com o Blocker do oponente` |

## 6. Ritmo: quem está na frente simplifica

Quem está na frente (mais Vida, tabuleiro maior) quer trocar e atacar o Líder: cada troca encurta a
partida. Quem está atrás quer preservar Vida, tirar os atacantes do oponente e esperar o turno de virar
o jogo. A tabela de Vida côncava faz isso sozinha: com Vida alta o bot aceita trocas e ataques; com
Vida baixa, os mesmos pontos de Vida pesam mais que qualquer Personagem, e a avaliação passa a
preferir defesa.

Um caso especial é o **fim de jogo**: com o oponente em 0 de Vida qualquer acerto vence (a tabela dá
14 000 ao último ponto), então a busca encontra sozinha "tirar o Blocker e bater no Líder".

## 7. Carta na mão tem valor futuro

Uma carta não jogada não é zero: é a jogada do próximo turno e, se tem Counter, é defesa. Jogar um
[On Play] sem alvo só vale se o corpo em campo compensar a carta perdida; segurar a carta com [On Play]
para quando houver alvo é uma decisão que o bot novo toma pela comparação das linhas (jogar agora vs.
jogar outra coisa), não por regra.

A comparação das linhas não basta quando a alternativa é "não jogar nada": o corpo em campo vale mais que a
carta na mão (custo, poder), então o bot baixava um Vander Decken IX ("[On Play] descarte 1 {Fish-Man}: K.O. de
1 Personagem virado") como um 2000 vanilla, sem alvo, só para gastar o DON!! do turno, e perdia a remoção que
teria tirado um Personagem caro dois turnos depois. Por isso uma carta na mão cujo **efeito de entrada remove
algo do oponente** ([On Play] de Personagem ou Stage, [Main] de Evento: K.O., devolver à mão, pôr no fundo do
deck, descartar) vale o efeito guardado (`handEffect`, 3 000; metade para os efeitos que só preparam a remoção,
como virar ou −poder). Jogá-la com alvo troca esse valor pela remoção, que a simulação pontua; jogá-la sem alvo,
recusar o custo do efeito ou descartá-la como custo joga o valor fora, e a busca prefere baixar outra coisa. O
valor é fixo por enquanto (o efeito em si não é simulado fora do contexto); ajustá-lo é trabalho da próxima
rodada de pesos.

| Conceito | Onde está | Teste |
|---|---|---|
| Carta na mão vale | `evaluate.ts`: `handCardBase`, `handCounter`, `handSoftCap` | `avaliação: carta na mão` |
| Não jogar [On Play] sem alvo quando há alternativa | busca compara as linhas | `prefere a carta com efeito útil` |
| Remoção guardada na mão | `evaluate.ts`: `entryRemoval`, `handEffect`, `handEffectSoft` | `usa o efeito da carta de remoção quando há alvo, e a segura quando não há`, `avaliação: carta na mão com efeito de remoção` |

## 7a. O próprio deck: ordem desconhecida, composição conhecida

O bot decide pela visão do jogador, em que o próprio deck é uma fila de cartas escondidas. Simulando com ela,
um efeito que lê o topo do deck não vale nada: o Líder Rocks.D.Xebec ("[When Attacking] descarte 1 carta:
revele o topo do deck; se for {Rocks Pirates}, compre 2") custava uma carta e nunca comprava, e o bot recusava
sempre — abrindo mão da vantagem de cartas que é a razão de jogar o Líder. Um jogador de verdade não sabe a
ordem, mas sabe a lista: com 35 {Rocks Pirates} em 40 cartas, pagar 1 por 2 é lucro quase certo.

- A visão traz, só para o próprio jogador, a composição do que ele não vê (`PlayerState.unseen`: a lista do deck
  menos o que está à vista, com as definições dessas cartas). O oponente e os espectadores não recebem nada.
- Antes de simular, o planejador **sorteia um deck** com essa composição (`determinize`): cada carta escondida
  do deck recebe uma carta sorteada sem reposição. Todas as linhas da busca em feixe usam o mesmo sorteio.
- Uma pergunta paga ("pagar o custo?") ou uma escolha de opção decidida de verdade sai da **média de vários
  sorteios** (`decideSampled`, até 6): o valor esperado do efeito, e não o resultado de um deck só. Se os dois
  primeiros sorteios dão o mesmo resultado, o deck não pesa na decisão e os outros são pulados. O plano guardado
  do turno, que veio de um sorteio, não responde essas perguntas: elas são decididas de novo.

| Conceito | Onde está | Teste |
|---|---|---|
| Composição do próprio deck na visão | `view.ts`: `unseen` | `view.test.ts` (a do oponente nunca aparece) |
| Efeito que lê o topo vale o que o deck promete | `planner.ts`: `determinize`, `decideSampled` | `paga o custo do Líder quando o deck faz o efeito valer (Rocks.D.Xebec)` |

## 8. O que o bot ainda não sabe

- **Mão do oponente**: só o tamanho. Cartas reveladas por efeito não são lembradas de um turno para o outro.
- **O próprio deck** entra por sorteio (seção 7a), mas a composição não é usada para mais nada: quantos Counters
  ainda há e os **[Trigger]s** prováveis não pesam em decisão nenhuma.
- **Sinergias de deck** além do que o texto das cartas faz quando simulado: nada. Um deck de combo
  precisa de leitura de várias jogadas à frente que a busca de um turno não alcança.
- **Efeitos manuais (⚙)**: o bot só confirma; a simulação não aplica nada.
- **O turno seguinte**: o planejamento olha só o próprio turno. A ameaça do oponente entra apenas nas
  decisões de defesa (seção 3a); no planejamento ela deixou o bot pior (seção 9).
- **Pesos**: otimizados em auto-jogo contra versões do próprio bot (seção 9). Um estilo de jogo muito
  diferente (um humano que segura Counters até o fim, por exemplo) pode explorar o que o auto-jogo não
  mostra: relatos de partidas reais são o melhor guia para a próxima rodada. O "humano fraco" de
  `scripts/human.ts` (seção 10) é a primeira tentativa de medir isso sem gente.
- **Desenvolver ou pressionar**: com o oponente em 2 de Vida e a mão cheia, a avaliação ainda prefere três
  ataques com margem a baixar duas cartas e atacar com o resto. As tabelas de Vida (seção 2) vieram do
  auto-jogo, em que a pressão paga; contra quem usa Counter em todo ataque com Vida baixa, o que o bot ganha
  é só drenar a mão. Se os relatos apontarem isso, o próximo passo é reduzir os dois últimos degraus de
  `lifeOpp` ou condicioná-los ao tamanho da mão do oponente.

## 9. Como os pesos foram ajustados (e o que não funcionou)

**Busca mais rápida.** O motor copiava o estado com `structuredClone` a cada jogada, incluindo o
histórico da partida, que cresce o jogo todo. `cloneState` (`engine.ts`) faz a mesma cópia ~4× mais
rápido (preserva objetos compartilhados, como o `structuredClone`), e o planejador simula sem o
histórico e sem o checkpoint do "cancelar". Uma jogada simulada caiu de ~0,4 ms para ~0,1 ms — o
servidor também ganha, porque toda ação passa pelo `applyAction`.

**Pesos por auto-jogo (SPSA).** `scripts/tune-weights.ts` parte de `DEFAULT_WEIGHTS` e, a cada rodada,
perturba todos os pesos ao mesmo tempo (±20% em escala log), põe as duas versões para jogar entre si
(96 partidas no nível `normal`, decks prontos sorteados, assentos trocados) e move os pesos na direção
de quem venceu. Duas rodadas de 150 iterações (~29 mil partidas). O que mudou:

- **Fechar a partida**: as duas últimas Vidas do oponente passaram a valer ~3× (tabela da seção 2).
- **Mão do oponente vale menos** (2 500 → 1 600 por carta): forçar Counter cedo rende pouco.
- **A própria mão vale mais** (Counter impresso: 500 → 1 100 por 1000): o bot guarda mais Counters.
- **Modelo de Counter do oponente mais otimista para o atacante**: chance de uma carta cobrir +1000
  0,60 → 0,42, queda por +1000 0,12 → 0,34, vontade de defender pela metade. Na prática, o bot espalha
  mais ataques com margem pequena em vez de concentrar DON!! num só.
- **Exposição** (Personagem virado no fim do turno) pesa menos: atacar com tudo compensa.

Resultado contra o bot anterior (assentos e quem começa alternados, 10 decks prontos):

| Confronto | Partidas | Vitórias do bot novo |
|---|---|---|
| `normal` novo x `normal` anterior (rodada 1) | 400 | 55,8% |
| `hard` novo x `hard` anterior (rodada 1) | 400 | 53,8% |
| `hard` novo x `hard` anterior (rodada 2) | 400 | 57,8% |
| `hard` novo x `hard` anterior (rodada 2, sem o desconto de Counters gastos: o bot atual) | 400 | 60,0% |

**O que foi medido e não melhorou** (`hard` novo x anterior, 160–200 partidas cada; ±3,5% é ruído):

| Tentativa | Resultado | Leitura |
|---|---|---|
| Ameaça do oponente no planejamento do próprio turno (peso 0,25 / 0,5 / 1) | 47% / 49% / 37,5% | Deixa o bot passivo: guarda Blockers e cartas em vez de pressionar |
| Ameaça só na defesa | 52% | Neutra no auto-jogo; ficou por ser o raciocínio certo contra humanos |
| Só "o oponente tem ataque fatal no próximo turno" no planejamento | 50,5–51,8% (`normal`) | Neutra |
| Descontar, em cada ataque da linha, os Counters que o oponente já deve ter gastado nos anteriores | 44,7% (`hard` com x sem, 300) | Com o modelo de Counter otimizado, deixava as linhas de muitos ataques otimistas demais: o `hard` passou a perder do `normal` |
| Busca 2× mais rápida com o mesmo feixe | 48% | O feixe limita, não o tempo |
| Feixe 16 em vez de 6, 600 ms | 50,5% | Mais busca não ajuda: o gargalo é a avaliação |
| Pesos por regressão logística sobre 21 mil posições de 2000 partidas | 43–44% | Prevê melhor quem vence (AUC 0,83 contra 0,79) e joga pior: correlação não é decisão (ex.: "Personagem na mão" valia mais que em campo, e o bot parava de baixar os de custo 1) |
| Só as tabelas de Vida da regressão | 44% | Idem |

**Rodada 3 (decisões ruins contra humanos).** As mudanças desta rodada não saíram de otimização, e sim de
traços de partidas (`trace-game.ts`, `trace-human.ts`) em que o bot `hard` fazia o que um jogador fraco
castiga: apostar a partida num ataque fatal que o oponente parava com uma carta (seção 3), não achar o ataque
fatal com quatro atacantes pequenos (seção 4), encerrar o turno com o Líder ao alcance de um ataque fatal
(seção 3a) e nunca explorar a linha que baixa duas cartas antes de atacar (seção 4). Medidas, 200 partidas
cada, `hard` x `hard` anterior e contra o "humano fraco" (seção 10): o auto-jogo não distingue as versões
(50–54%, dentro do ruído), e o humano fraco perde para as duas (~83%). As correções ficam pelo raciocínio e
pelos testes de posição, não por uma medida: o que falta é o relato de quem joga contra o bot.

**Rodada 4 (efeitos desperdiçados).** Dois relatos de partidas contra o `hard`: o bot baixava cartas com
[On Play] de remoção sem usar o efeito (Vander Decken IX como corpo vanilla) e recusava habilidades do Líder que
só davam vantagem (Rocks.D.Xebec: pagar 1 carta para comprar 2). As causas e as correções estão nas seções 7 e
7a: o efeito guardado passou a valer na mão (`handEffect`), e o próprio deck passou a ser sorteado pela composição
conhecida, com as perguntas pagas decididas pela média dos sorteios. As duas situações são raras nos decks prontos
(as medições de auto-jogo e contra o humano fraco estão na seção abaixo, quando concluídas): o que muda é o que a
pessoa vê quando joga. Os testes de posição cobrem os dois casos.

## 10. Humano fraco

`scripts/human.ts` é um oponente para medição (não é um nível do jogo): desenvolve e ataca como o bot
heurístico (`simple.ts`), mas defende como gente — segura o ataque fatal sempre que pode, usa Counter com
Vida baixa (com `HUMAN=careful`, em todo ataque ao Líder com 2 de Vida ou menos), bloqueia para salvar o
Líder no fim e protege Personagens caros. Serve para pegar o que o auto-jogo não pega: o bot contra quem não
deixa passar o ataque decisivo. O `hard` vence ~83% contra ele; um humano de verdade joga a fase principal
bem melhor que o `simple.ts`, então a medida é um piso, não um retrato.

## 11. Decisões de gente: o extrator dos replays

Toda partida gravada (contra o bot, online, ranqueada, torneio) guarda o replay completo (`matches.replay`: seed,
decks e ações), e o motor é determinístico: o servidor refaz a partida e reconstrói, em cada decisão, exatamente a
visão que o jogador tinha (`viewFor`), a mesma com que o bot decide. `apps/server/src/decisions/extract.ts` percorre
os replays e emite um registro por decisão de um lado humano:

- quem (perfil, conta, tier e recompensa na hora), a fila e o formato, se venceu;
- a situação: turno, Vida e mão dos dois lados, DON!! ativo, a batalha em curso (atacante, alvo, poderes e a margem
  que o Counter teria de cobrir) nas decisões de defesa;
- o tipo da decisão (`main`, `counter`, `block`, `lifeCard`, `selectTargets`, `option`, `confirm`, `mulligan`,
  `chooseFirst`), quantas ações legais havia e a escolha, descrita por números de carta;
- no Counter, quanto a mão podia dar (Counters impressos e Eventos [Counter] pagáveis) e quanto a carta usada deu,
  para separar "não quis" de "não tinha como";
- a escolha do bot (`hard` por padrão) na mesma visão, e se bate com a do humano.

E, por turno do lado humano (`<saída>-turnos.jsonl`), o turno inteiro: cartas jogadas, ataques, DON!! anexados e
DON!! que sobrou, ao lado do turno que o bot jogaria a partir da mesma posição inicial (com o oponente respondendo
como na simulação do planejador). Comparar clique a clique na fase principal é barulhento (o bot anexa DON!! e
ataca; a pessoa ataca e anexa em outra hora); o turno inteiro é o que responde "desenvolver ou pressionar".

Com `--tournament <id|latest>` o extrator lê só os jogos de um torneio e grava em cada registro a colocação final do
jogador (`placement`); `--split N` repete o resumo para os N primeiros e para o resto. O resumo também mostra o
mulligan por mão inicial (quantos Personagens de custo ≤ 3, humano x bot), a escolha de quem começa e, nos Counters
usados no Líder, o tipo e o custo da carta e se ela caberia no DON!! do próximo turno (a hipótese das "cartas
mortas" para a defesa com Vida alta).

```bash
# Numa cópia do banco (o backup diário da VPS, ~/backups/gumgum-<dia>.db, copiado por scp): só lê, não grava nada.
DB_PATH=/caminho/gumgum.db npm run decisions -w @gumgum/server -- --limit 500 --out decisoes.jsonl
DB_PATH=/caminho/gumgum.db npm run decisions -w @gumgum/server -- --tournament-top 4 --queue tournament
DB_PATH=/caminho/gumgum.db npm run decisions -w @gumgum/server -- --top 20 --queue ranked --bot none
DB_PATH=/caminho/gumgum.db npm run decisions -w @gumgum/server -- --tournament latest --split 8
# Na própria VPS, com o pacote de produção (sem o repositório):
DB_PATH=~/apps/gumgumfight/shared/gumgum.db node --disable-warning=ExperimentalWarning \
  ~/apps/gumgumfight/current/server/decisions-cli.mjs --limit 500 --out ~/decisoes.jsonl
```

O resumo no terminal responde às perguntas desta rodada: em que tipo de decisão o bot mais discorda das pessoas;
com que frequência um humano usa Counter ou bloqueia um ataque ao Líder, por Vida e por margem, e só quando a mão
bastava (é o que os parâmetros `counterWill`, `counterStack`, `counterCard` da seção 3 chutam hoje); o ataque fatal
(quantos a mão parava, quantos o humano e o bot pararam, e as posições em que o humano segurou e o bot passaria, para
reproduzir); e, nos turnos inteiros, quem joga mais cartas e quem ataca mais, também com o oponente em 2 de Vida ou
menos (o "desenvolver ou pressionar" da seção 8).

**Primeira rodada em produção (421 partidas, 32 mil decisões, 2 078 turnos, outubro de 2026).** O bot concorda com
as pessoas em 47% dos cliques da fase principal e 72% dos Counters.

- **Ataque fatal**: quando a mão bastava (135 casos), as pessoas seguraram 94% e o bot seguraria 99%; a diferença
  bruta (73% contra 54%) eram 54 casos de gente gastando Counter sem ter como parar o ataque. Um único caso em que
  o humano segurou e o bot passaria (+8000 com quatro cartas e 2 DON!!).
- **Defesa do Líder quando a mão bastava**, humano x bot: 1 de Vida 78% x 82%, 2 de Vida 68% x 70%, 3 de Vida
  48% x 55%, 4 de Vida 36% x 5%, 5 de Vida 31% x 4%. Só com Vida alta o bot destoa; os quatro primeiros dos torneios
  também defendem ~30% com 4 de Vida. Hipótese: Counter com cartas mortas (as que não vão jogar), que o bot avalia
  como qualquer outra carta da mão. Falta medir o custo da carta usada contra o DON!! disponível antes de mexer.
- **Modelo do oponente**: a tabela de `counterWill` foi recalibrada com esses números (seção 3).
- **Turnos inteiros**: por turno, as pessoas jogam mais cartas (1,13 contra 0,97 do bot), atacam mais (2,39 contra
  2,24) e anexam menos DON!! (1,65 contra 2,04): mais ataques com menos margem, enquanto o bot concentra DON!! em
  poucos ataques. Com o oponente em 2 de Vida ou menos, atacaram mais que o bot em 46% dos turnos e menos em 15%.
- **Quem começa**: as pessoas escolhem jogar primeiro em 49% das vezes; os quatro primeiros dos torneios, em 15%.
  O bot com busca passou a jogar segundo. O JSONL serve para o
resto: calibrar esses parâmetros por regressão, ou ajustar os pesos da avaliação para concordar com os melhores
colocados em vez de só por auto-jogo (seção 9). Partidas cujo replay não refaz (versão antiga, texto de carta que
mudou) são contadas e puladas.

**Torneio de 25/10/2026 (16 inscritos, 20 partidas, 3 699 decisões; os 8 primeiros fizeram 2 831).**

- **Ataque fatal**: quando a mão bastava, os 8 primeiros seguraram 86% e o bot seguraria 100%. O bot já defende
  melhor que as pessoas aqui.
- **Defesa do Líder quando a mão bastava, 8 primeiros x bot**: 1 de Vida 71% x 64%, 2 de Vida 50% x 72%, 3 de Vida
  50% x 53%, 4 de Vida 30% x 5%, 5 de Vida 23% x 18%. As duas diferenças da rodada anterior se repetem: com 2 de Vida
  os bons jogadores deixam passar mais que o bot, e com 4 defendem muito mais.
- **"Cartas mortas" descartadas como explicação**: nos Counters usados no Líder com 4 ou 5 de Vida, só 11% (15% nos 8
  primeiros) eram Personagens acima do DON!! do próximo turno. O que muda é o custo: 2,6 em média com Vida alta, 3,2
  com Vida baixa. Com Vida alta as pessoas gastam os Personagens baratos; o bot vale toda carta da mão pelo Counter
  impresso, sem olhar o custo.
- **Mulligan**: o bot concorda 88%. Com um único Personagem de custo até 3, as pessoas mantêm a mão 30% das vezes; o
  bot troca sempre. Amostra pequena (10 mãos) para mudar a regra.
- **Quem começa**: os 8 primeiros escolheram jogar primeiro em 14% das vezes, o que confirma o bot jogar segundo.
- **Turnos inteiros**: as pessoas jogam mais cartas (1,18 contra 1,01), anexam menos DON!! (1,90 contra 2,29) e
  sobram mais DON!! ativos (0,38 contra 0,08), com quase o mesmo número de ataques.

**Ajuste por imitação nesse torneio (608 posições de defesa): não adotado.** A concordância nas posições fora do
ajuste subiu de 66,1% para 69,4%, dentro do ruído de 121 posições (±4 pontos). Os pesos sugeridos
(`life` 0/12 424/17 861/24 467/28 230/32 706, `threatHit` 3 725) aproximaram o bot das pessoas com 2 de Vida (Counter
47% para 20%, humanos 27%) e o afastaram com 4 (11% para 0%, humanos 22%). Na conferência, 200 partidas cada:
auto-jogo 50,0%, humano fraco 80,0% (o bot atual faz 82%), humano fraco cuidadoso 82,5% (82%). Neutro em tudo, então
os pesos atuais continuam. A defesa com Vida alta não sai só dos degraus da Vida: deixar passar um ataque dá ao bot
uma carta que ele não vê, que vale `handCard` (2 900), mais que uma carta conhecida média (~2 400 pelos Counters dos
decks prontos). `--with-hand` inclui esse peso no ajuste para a próxima rodada, com mais posições (todos os
torneios encerrados, `--tournament-top`).

**Ajuste por imitação dos 4 primeiros de todos os torneios (578 posições, 17 partidas): adotado.** A concordância
nas posições fora do ajuste subiu de 60,9% para 67,0% (115 posições, ±4,5 pontos). O ajuste baixou a própria Vida
inteira (tabela da seção 2), `lethal` de 2 700 para 1 512 e subiu `threatHit` de 2 250 para 2 890. Defesa do Líder
com Counter, humano / bot anterior / bot ajustado: 2 de Vida 42% / 67% / 42%, 3 de Vida 17% / 61% / 17%; com 1, 4
e 5 de Vida nada mudou. Na conferência, 200 partidas cada: auto-jogo 50,0%, humano fraco 81,0% (o bot anterior faz
82%), humano fraco cuidadoso 82,0% (82%). Foi adotado porque é a terceira amostra com a mesma direção (os bons
jogadores defendem menos que o bot com 2 e 3 de Vida: 34% e 21% contra 62% e 56% em 22/10, 50% e 50% contra 72% e
53% no torneio de 25/10) e não piorou em nenhuma conferência. A defesa com 4 de Vida (pessoas ~30%, bot 5%)
continua: essa rodada rodou sem `handCard`, porque a opção `--with-hand` ainda não estava na VPS.

### Ajuste dos pesos por imitação (Fase 6 com dados de gente)

`apps/server/src/decisions/tune.ts` (CLI `npm run decisions:tune -w @gumgum/server`) guarda as posições em que
jogadores decidiram uma defesa (Counter, bloqueio) e procura, por SPSA, os pesos que fazem o bot escolher o mesmo que
eles na mesma visão. A nota de cada variação é a concordância com as pessoas, não a vitória contra outra versão do bot
(o ajuste da seção 9). Só entram os pesos que pesam na defesa: os degraus da própria Vida (`life`) e a ameaça do
próximo ataque (`threatHit`, `lethal`). Eles quase não mudam o próprio turno (a ameaça é zerada no planejamento, e a
própria Vida só cai lá por efeito de carta); os pesos da mão também mudariam quais cartas o bot joga e ficam de fora.

```bash
# Os 8 primeiros do último torneio (só lê o banco; ~15 min de CPU no nível difícil)
DB_PATH=/caminho/gumgum.db npm run decisions:tune -w @gumgum/server -- --tournament latest --placement 8
# Os 4 primeiros de todos os torneios encerrados, também com o valor da carta que sai da Vida
DB_PATH=/caminho/gumgum.db npm run decisions:tune -w @gumgum/server -- --tournament-top 4 --limit 500 --with-hand
```

Um quinto das posições fica de fora do ajuste e mede a concordância antes e depois sem viés; a saída mostra também a
defesa do Líder por Vida (humano, bot atual, bot ajustado) e o json dos pesos. O resultado é um candidato: imitar a
defesa dos melhores também imita os erros deles, então ele só vira padrão se não piorar no auto-jogo (`duel.ts`) nem
contra o humano fraco (`vs-human.ts`).

## Como medir

```bash
npm run compare-bots -w @gumgum/engine -- 100 hard easy          # taxa de vitória e tempo por decisão
npm run compare-bots -w @gumgum/engine -- 100 hard normal st03-crocodile st04-kaido
npx vitest run test/bot-positions.test.ts -w @gumgum/engine        # testes de posição deste documento

# Comparar dois conjuntos de pesos (json parcial sobre DEFAULT_WEIGHTS), assentos trocados:
npx tsx packages/engine/scripts/duel.ts 1 200 hard '{"exposed":800}' '{}'
# Otimizar os pesos (retoma de onde parou; confira o resultado no hard com o duel antes de adotar):
npm run tune-weights -w @gumgum/engine -- tune.jsonl 150 96 normal
# Ver uma partida jogada a jogada (DBG=<turno> mostra a linha escolhida em cada decisão):
npx tsx packages/engine/scripts/trace-game.ts 3 hard hard st10-law st09-yamato
# Contra o "humano fraco" (seção 10): taxa de vitória do bot, e uma partida jogada a jogada
npx tsx packages/engine/scripts/vs-human.ts 200 hard
HUMAN=careful npx tsx packages/engine/scripts/vs-human.ts 200 hard
npx tsx packages/engine/scripts/trace-human.ts 5 hard st02-kid st01-luffy
```

Medições de referência (ST01 x ST02, 100 partidas, assento e quem começa alternados):

| Confronto | Vitórias do primeiro | Antes desta rodada | Tempo por decisão do primeiro (p50 / p95) |
|---|---|---|---|
| hard x easy | 96% | 88% | 0,3 ms / 126 ms |
| normal x easy | 94% | 80% | 1,2 ms / 31 ms |
| hard x normal | 58% | 70% | 0,3 ms / 108 ms |

O `normal` foi quem mais ganhou com os pesos novos (a otimização joga nesse nível); a busca do turno
inteiro ainda dá ao `hard` a vantagem sobre ele, menor que antes. Contra o `hard` anterior, em 10 decks
prontos: **60%** (400 partidas).

O p50 baixo do `hard` vem do plano guardado: a busca roda uma vez por turno e as decisões seguintes
saem do plano enquanto a partida segue o previsto.
