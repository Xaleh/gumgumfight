# Informação oculta (áreas secretas, revelar, olhar)

No jogo de mesa, a mão, o deck e a Vida são secretos, mas o **número** de cartas de cada área é público. Num simulador, cada etapa que o motor pula sozinho também pode revelar informação. Por isso, aqui a regra oficial e a regra de interface andam juntas.

## Regras oficiais

| Regra | O que diz | Fonte |
|---|---|---|
| CR 3-1-4 | O número de cartas em cada área é aberto aos dois jogadores a qualquer momento. | CR |
| CR 3-1-5 | Áreas abertas (trash, Líder, Personagens, Stage, custo, deck de DON!!) e secretas (deck, mão, Vida). | CR |
| CR 3-1-8 | Várias cartas indo de uma área aberta para uma secreta ao mesmo tempo: o oponente não fica sabendo a ordem que o dono escolheu. | CR |
| CR 3-2-2 / 3-10-2 | Ninguém vê nem reordena o deck e a Vida, salvo por efeito. A carta sai do topo da Vida. | CR |
| CR 3-10-2-1 | Carta de Vida virada para cima é tratada como área aberta. | CR |
| CR 3-10-3 | Olhar a Vida não muda se ela está para cima ou para baixo. | CR; Q&A EB01-052 Viola, ST13-012 Makino, OP03-099 Katakuri |
| CR 4-5-1 | Comprar = pôr na mão **sem revelar**. | CR |
| CR 8-4-4-2 | Escolha em área secreta com condição: o jogador pode "não achar" mesmo que exista. | CR |
| CR 10-1-5-2 | Recusar o [Trigger]: a carta vai para a mão **sem ser revelada**. | CR |
| CR 11-2-1 | Mover de uma área secreta para outra secreta ("add X from your deck to your hand") obriga a revelar a carta. | CR; Q&A OP07-111 Lilith (exceção: OP12-079) |
| CR 11-2-2 | Carta revelada volta a ser oculta depois do efeito. | CR; Q&A OP01-060 Doflamingo |
| CR 11-3-1 | "Look at" vale só para quem usou o efeito. | CR |
| CR 11-3-2 / 11-3-3 | As cartas olhadas não saem da área; sem instrução, voltam como estavam. | CR |
| Q&A de regras | Carta adicionada do deck à Vida: ninguém pode olhar. | [qa_rules.pdf](https://en.onepiece-cardgame.com/pdf/qa_rules.pdf) |
| Q&A de regras | "Look at up to 1 card from the top of your or your opponent's Life": a carta volta para a Vida do **dono**. | [qa_rules.pdf](https://en.onepiece-cardgame.com/pdf/qa_rules.pdf) |
| Q&A OP01-016 Nami | Busca "olhe 5" com o deck menor que 5: olha-se o que houver; o deck não conta como 0 durante a busca. | [qa_op01.pdf](https://en.onepiece-cardgame.com/pdf/qa_op01.pdf) |
| TRM 7.4.1-3 | Olhar cartas que não devia (ou revelar a própria mão de propósito) é infração. | [Tournament Rules Manual](https://en.onepiece-cardgame.com/pdf/tournament_rules_manual.pdf) |

## Regra de simulador: o motor não pode "pular" decisões que dependem de informação secreta

No jogo de mesa, o defensor sempre tem o momento de olhar a mão e passar, e sempre olha a carta de Vida antes de pô-la na mão. Se o simulador pula essas etapas quando não há nada a fazer, o oponente descobre o conteúdo da mão ou da Vida pela diferença de comportamento ou de tempo.

Princípio: **toda decisão cuja existência depende de uma área secreta abre sempre**, mesmo vazia, e o bot responde com um atraso aleatório. Já está no motor (card "Vazamento de informação", concluído; testes em `packages/engine/test/hidden-info.test.ts` e `hidden-info-2.test.ts`):

- Etapa de **Counter** sempre abre, mesmo sem Counter na mão ou com o ataque já falhando.
- **Carta de Vida** sempre passa pelo dono (`pending: lifeCard`), com ou sem [Trigger].
- "**Você pode pagar X?**" com custo que lê a mão abre mesmo sem carta que sirva (só "não").
- **Substituição** com custo que lê a mão ("pagar para evitar o K.O.?") abre sempre.
- **Escolhas na mão ou no deck** e **buscas no deck** abrem mesmo vazias.
- O que é público (alvos no campo, [Blocker] na mesa, mão vazia) pode continuar sendo pulado.

## Casos para conferir

- Log: as mensagens não podem diferir entre "tinha e recusou" e "não tinha" (campo `secret` do log em `engine.ts`).
- Revelação obrigatória (CR 11-2-1): a carta buscada do deck para a mão precisa aparecer para o oponente (no log e/ou animação), e a mão comprada não. O mesmo vale para a carta da mão posta na Vida por um efeito com exigência ("Reveal up to 1 Character card with a cost of 5 from your hand and add it to the top of your Life cards"): o nome sai no log público (DV-33). Sem exigência ("add up to 1 card from your hand …") ela vai escondida, como a carta que vai do deck para a Vida.
- Ordem das cartas devolvidas ao fundo do deck (CR 3-1-8): o oponente não deve ver a ordem.
- Cartas "olhadas" (CR 11-3-1) só aparecem para quem usou o efeito; espectador comum segue a visão pública; o perfil Streamer vê tudo.

## No motor

Ver a seção "Regra de simulador" acima.

Divergências deste tema: nenhuma aberta (corrigida: DV-33) (detalhes em [../divergencias.md](../divergencias.md)).
