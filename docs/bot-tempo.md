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
| DON!! −X custa de verdade | `evaluate.ts`: `don` (1200 por DON!! em campo) | `simulation.test.ts` (sem travar) |

## 2. Vida como recurso, não como placar

Levar dano cedo não é ruim: cada carta de Vida que sai **vai para a mão** (e pode ter [Trigger]). O
jogador que gasta dois Counters para proteger a quinta Vida perde duas cartas para ganhar uma. O
cálculo muda conforme a Vida cai: com 1 ou 2 de Vida cada ponto é a partida.

Por isso a Vida entra na avaliação por uma **tabela côncava**, não por "1 Vida = N pontos":

| Vida | valor acumulado | o último ponto vale |
|---|---|---|
| 5 | 34 700 | 3 200 |
| 4 | 31 500 | 4 000 |
| 3 | 27 500 | 5 500 |
| 2 | 22 000 | 8 000 |
| 1 | 14 000 | 14 000 |
| 0 | 0 | — |

Como uma carta na mão vale ~2 500, o bot deixa passar o ataque com 5 ou 4 de Vida (perde 3 200 ou
4 000, ganha 2 500: fica quase igual, sem gastar carta), começa a usar Counter com 3 de Vida quando uma
carta basta, e defende com tudo em 2 ou 1.

| Conceito | Onde está | Teste |
|---|---|---|
| Não contar com Vida alta | `evaluate.ts`: `life[]` + `handCard` | `com 5 de Vida deixa o ataque passar` |
| Defender com Vida baixa | idem | `com 2 de Vida usa Counter` |
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

- `P(consegue)` cresce com o tamanho da mão e cai com a margem de poder que ele precisaria cobrir
  (`counterAbility`): margem de +1000 com 5 cartas é quase certa; +4000 com 1 carta é rara.
- `P(quer)` cresce quando o alvo é o Líder com pouca Vida ou um Personagem caro (`counterWill`).
- "Falhar" ainda tira uma carta da mão dele, então o risco raramente anula um ataque com margem.

| Conceito | Onde está | Teste |
|---|---|---|
| Atacar com margem quando a mão dele é grande | `planner.ts`: `counterRisk`; `candidateMoves` oferece k, k+1 e k+2 DON!! | `prefere margem contra mão cheia` |
| Mão do oponente é custo, a própria é valor | `evaluate.ts`: `handCardOpp`, `handCardBase` + `handCounter` | `avaliação: carta na mão` |

## 4. Personagem virado é uma janela

Só se ataca Personagem **virado** (ou o Líder). Um Personagem que atacou fica virado até a Renovação
do dono: ele é a janela para removê-lo. Efeitos de "virar 1 Personagem do oponente" só valem se o
ataque vem **no mesmo turno**; virar e não atacar é o erro clássico do bot antigo.

No bot novo isso sai da simulação: a linha "ativar efeito de virar → atacar o virado → K.O." pontua o
Personagem removido; a linha "só virar" pontua zero (e paga o custo por ação). Do lado defensivo, o
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

| Conceito | Onde está | Teste |
|---|---|---|
| Carta na mão vale | `evaluate.ts`: `handCardBase`, `handCounter`, `handSoftCap` | `avaliação: carta na mão` |
| Não jogar [On Play] sem alvo quando há alternativa | busca compara as linhas | `prefere a carta com efeito útil` |

## 8. O que o bot ainda não sabe

- **Mão do oponente**: só o tamanho. Cartas reveladas por efeito não são lembradas de um turno para o outro.
- **Contagem de cartas no deck** (quantos Counters ainda há) e **[Trigger]s** prováveis: nada.
- **Sinergias de deck** além do que o texto das cartas faz quando simulado: nada. Um deck de combo
  precisa de leitura de várias jogadas à frente que a busca de um turno não alcança.
- **Efeitos manuais (⚙)**: o bot só confirma; a simulação não aplica nada.
- **Pesos**: fixos (`DEFAULT_WEIGHTS`). A Fase 6 do card prevê ajuste por auto-jogo
  (`npm run compare-bots -w @gumgum/engine` mede dois níveis entre si).

## Como medir

```bash
npm run compare-bots -w @gumgum/engine -- 100 hard easy          # taxa de vitória e tempo por decisão
npm run compare-bots -w @gumgum/engine -- 100 hard normal st03-crocodile st04-kaido
npx vitest run test/bot-positions.test.ts -w @gumgum/engine        # testes de posição deste documento
```

Medições de referência (ST01 x ST02, assento e quem começa alternados):

| Confronto (50 partidas) | Vitórias do primeiro | Tempo por decisão do primeiro (p50 / p95) |
|---|---|---|
| hard x easy | 88% | 0,6 ms / 255 ms |
| normal x easy | 80% | 2,1 ms / 61 ms |
| hard x normal | 70% | 0,6 ms / 255 ms |

Com outros decks prontos (16 partidas cada, hard x easy): Crocodile x Kaido 81%, Shanks x Sakazuki 94%,
Big Mom x Yamato 94%, Law x Zoro/Sanji 88%.

O p50 baixo do `hard` vem do plano guardado: a busca roda uma vez por turno e as decisões seguintes
saem do plano enquanto a partida segue o previsto.
