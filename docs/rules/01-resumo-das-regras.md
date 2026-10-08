# Resumo das regras oficiais

Resumo em português das **Comprehensive Rules v1.2.1** (atualizadas em 28/08/2026) da Bandai, com o número de cada seção entre parênteses para conferir no original:
<https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf>.

As palavras-chave das cartas ficam em inglês, como impressas (`[On Play]`, `[Blocker]`, `DON!! −X`...), porque é assim que o texto oficial e o leitor do motor (`parser.ts`) as reconhecem.

> Princípio número 1 (1-3-1): **o texto da carta vence a regra**. Tudo abaixo vale "a menos que a carta diga outra coisa".

---

## 1. Princípios fundamentais (1-3)

| Regra | Resumo |
|---|---|
| 1-3-2 | Ação impossível não é feita. Se o efeito pede várias ações e só algumas são possíveis, faz-se **o máximo possível**. |
| 1-3-2-1 | Mudar uma carta para o estado em que ela já está (ex.: "rest" numa carta já rested) não é "fazer a ação". |
| 1-3-2-2 | Ação feita 0 ou um número negativo de vezes não acontece (e "−1 vez" não vira a ação oposta). |
| 1-3-3 | Se um efeito **obriga** e outro **proíbe**, a proibição vence. |
| 1-3-4 / 1-3-10 | Escolhas ou ações simultâneas dos dois jogadores: o **jogador do turno** primeiro, depois o outro. |
| 1-3-5 | Números escolhidos são inteiros ≥ 0. "Up to X" sem mínimo permite escolher 0. |
| 1-3-6-1 | **Poder pode ficar negativo**, e a carta não é trashada por isso. |
| 1-3-6-2 | **Custo** pode ficar negativo só durante o cálculo; fora dele, custo negativo vale 0 (mas o valor negativo entra nas contas seguintes, 1-3-6-2-1). |
| 1-3-7 / 2-8-3 | O efeito é resolvido na ordem em que está escrito, de cima para baixo. |
| 1-3-8 | Se um efeito manda dar rest e outro manda deixar active ao mesmo tempo, **rest vence**. |
| 1-3-9 | *Cost* = o que se paga para jogar a carta. *Activation cost* = o que vem antes dos dois-pontos de um efeito. |

## 2. Informações da carta (2)

- **Nome** (2-1): `[Nome]` entre colchetes se refere ao nome exato; `"parte"` entre aspas se refere a nomes que contêm o trecho. Algumas cartas ganham nomes extras pelo texto ("also treat this card's name as..."), inclusive no deck e nas áreas secretas (2-1-3).
- **Categoria** (2-2): Leader, Character, Event, Stage, DON!!. Atenção ao vocabulário:
  - "Character" = Personagem **no campo**; "Character card" = carta de Personagem **fora** do campo (mão, deck, trash) (2-2-4-1/2).
  - "Stage" = qualquer carta de Stage; "Stage card" = fora da área de Stage (2-2-6).
- **Tipo** `{Tipo}` e `"parte do tipo"` (2-4-3); "type including XX" inclui "Former XX" e "XX Allies" (Q&A de regras).
- **Atributo** `<Slash>` etc. (2-5); só Líder e Personagem têm atributo e poder (2-5-5, 2-6-2).
- **Custo** (2-7): para jogar, revela-se a carta, dá-se rest em DON!! ativos no valor do custo e então a carta entra (Personagem/Stage) ou vai para o trash e resolve (Evento). Custo 0 pode ser jogado sem DON!!.
- **Counter** (2-10): só cartas de Personagem têm o símbolo; se houver vários, vale **o maior** (2-10-4).
- **[Trigger]** (2-11): efeito que pode ser ativado **no lugar** de pôr na mão a carta de Vida perdida por dano.
- Texto de Líder, Personagem e Stage só vale na respectiva área (2-8-2). Texto entre parênteses é explicativo e não muda o jogo (2-8-4).

## 3. Áreas (3)

| Área | Aberta/secreta | Observações |
|---|---|---|
| Deck (3-2) | Secreta | Ninguém vê nem muda a ordem. Cartas movidas do deck saem uma a uma. |
| Deck de DON!! (3-3) | Aberta | 10 DON!!. |
| Mão (3-4) | Secreta | O dono vê e reordena; o oponente não vê. Sem limite de cartas. |
| Trash (3-5) | Aberta | Virado para cima; cartas novas vão por cima. |
| Líder (3-6) | Aberta | O Líder **nunca** sai da área do Líder (3-6-3). |
| Personagens (3-7) | Aberta | Até **5**. Para jogar o 6º, revela-se o novo, **trasha-se** 1 dos 5 e joga-se o novo; esse trash é processamento de regra, não K.O. e não aceita efeitos (3-7-6-1). Personagem jogado não ataca no turno (3-7-4). Entra active, salvo indicação (3-7-5). |
| Stage (3-8) | Aberta | Até **1**; o Stage novo substitui o antigo, que vai para o trash (3-8-5-1). |
| Custo (3-9) | Aberta | DON!! entram active, salvo indicação. Quem paga escolhe quais DON!! usa. |
| Vida (3-10) | Secreta | Virada para baixo; sai sempre **do topo**, salvo indicação. Carta de Vida virada para cima é tratada como área aberta (3-10-2-1). Olhar a Vida não muda se ela está para cima ou para baixo (3-10-3). |

- **Campo** = Líder + Personagens + Stage + área de custo (3-1-2). "If you have..." olha o campo (3-1-2-1).
- O **número** de cartas de cada área é sempre público (3-1-4).
- **Carta que sai do campo vira uma carta nova** (3-1-6): os efeitos aplicados a ela (poder, custo, [Once Per Turn] usado, "não pode atacar"...) não a acompanham. DON!! que muda de área perde os efeitos (3-1-6-1).
- Várias cartas movidas juntas: o dono escolhe a ordem (3-1-7); se forem de uma área aberta para uma secreta, o oponente não vê essa ordem (3-1-8).

## 4. Termos básicos (4)

- **Dono vs. jogador** (4-2): "owner" é o dono original da carta (importa em "return to the owner's hand").
- **Active / Rested** (4-4). DON!! dados (attached) não são nem active nem rested (4-4-2); DON!! dados ou no deck de DON!! **não podem** ser postos active/rested por efeitos (Q&A de regras).
- **Comprar** (4-5): "draw X" repete X vezes; "draw up to X" deixa parar a qualquer momento.
- **Dano** (4-6): dano X = repetir X vezes "pôr a carta do topo da Vida na mão". Se a carta tem [Trigger], o jogador pode ativá-lo (4-6-3). Se a carta de Vida não puder ir para a mão por um efeito de substituição, o [Trigger] não pode ser ativado (4-6-3-1).
- **"Up to X"** (4-8): escolhe-se de 0 a X imediatamente antes de resolver.
- **"Base"** (4-9): o valor impresso. Vários efeitos que fixam o poder/custo base: vale **o maior**.
- **"If" e "Then"** (4-10): se a cláusula "if" não se cumpre, o que vem depois **não** acontece. Se uma parte anterior a um "Then" não pôde ser feita, o que vem depois do "Then" **ainda acontece** (desde que nenhum "if" anterior tenha falhado).
- **"Remove"** (4-11): mover a carta da área em que está para outra.
- **«Set Power to 0»** (4-12): reduz o poder pelo valor atual no momento da ativação; se o poder já é negativo, não faz nada.

## 5. Preparação da partida (5)

1. Deck de **50 cartas** + **1 Líder** + **10 DON!!** (5-1-2). Só cores do Líder; no máximo **4 cópias** do mesmo número. Efeitos de construção de deck (ex.: "seu deck pode ter qualquer número de...") são efeitos permanentes que substituem essas regras (5-1-2-4).
2. Embaralhar e pôr o deck; revelar os Líderes (5-2-1-2/3).
3. Pedra-papel-tesoura (ou outro meio) decide quem **escolhe** ir primeiro ou segundo (5-2-1-4/5). Ninguém pode interferir nessa escolha.
4. Efeitos de Líder "At the start of the game": primeiro os de quem escolheu, em qualquer ordem, depois os do outro. Se mudarem o deck, o dono embaralha (5-2-1-5-1/2).
5. Cada um compra 5. A partir de quem joga primeiro, cada um pode trocar a mão **uma vez** (devolve tudo, embaralha, compra 5) (5-2-1-6).
6. Cada um põe na Vida, virado para baixo, cartas do topo do deck em número igual à Vida do Líder, **de modo que o topo do deck fique por baixo da Vida** (5-2-1-7, 2-9-2-1).
7. O primeiro jogador começa (5-2-1-8).

## 6. Fim da partida (1-2, 9)

- Perde quem: (a) tem **0 de Vida e o Líder leva dano**; ou (b) tem **0 cartas no deck** (1-2-1-1).
- A derrota é aplicada no **próximo processamento de regra** (1-2-2), que acontece imediatamente quando a condição surge, mesmo no meio de outra ação (9-1-2). Se os dois cumprem condições de derrota ao mesmo tempo, os dois perdem (9-2-1); em torneio de eliminação simples, nesse empate perde o jogador do turno (Tournament Rules Manual, 5.2).
- Desistir é imediato, não é afetado por cartas e não pode ser substituído (1-2-3/4).
- Efeitos de carta podem dar vitória/derrota durante o seu processamento (1-2-5).

## 7. O turno (6)

**Refresh → Draw → DON!! → Main → End.**

1. **Refresh Phase** (6-2), nesta ordem:
   1. Terminam os efeitos "until the start of your next turn".
   2. Ativam os efeitos "at the start of your/your opponent's turn".
   3. Todos os DON!! dados ao seu Líder e Personagens voltam para a área de custo, **rested** (obrigatório).
   4. Tudo o que é seu e está rested (Líder, Personagens, Stage, DON!!) fica active.
2. **Draw Phase** (6-3): compra 1. Quem joga primeiro **não compra** no primeiro turno.
3. **DON!! Phase** (6-4): põe **2** DON!! do deck de DON!! na área de custo (**1** no primeiro turno de quem joga primeiro; 1 se só restar 1; nenhum se o deck de DON!! acabou).
4. **Main Phase** (6-5): ativam os efeitos "at the start of the Main Phase"; depois, em qualquer ordem e quantas vezes quiser:
   - **Jogar** Personagem ou Stage, ou ativar Evento `[Main]` da mão (6-5-3).
   - **Ativar efeitos** `[Main]` / `[Activate: Main]` (6-5-4) — nunca durante uma batalha (10-2-2/10-2-3).
   - **Dar DON!!** (6-5-5): 1 DON!! active da área de custo vai para baixo do Líder ou de um Personagem. Cada DON!! dado dá **+1000 de poder durante o seu turno** (só no seu turno). DON!! dado não pode ser transferido para outra carta. Quando a carta sai da área, seus DON!! voltam para a área de custo **rested** (6-5-5-4).
   - **Atacar** (6-5-6): **nenhum** dos dois jogadores ataca no **seu primeiro turno** (6-5-6-1).
5. **End Phase** (6-6):
   1. Ativam os `[End of Your Turn]` do jogador do turno (na ordem que ele quiser), cada um **uma só vez**; depois os `[End of Your Opponent's Turn]` do outro jogador (na ordem que ele quiser) (6-6-1-1).
   2. Processam-se os efeitos "at the end of this turn"/"at the end of your turn" do jogador do turno e terminam os seus efeitos "until the end of the turn"/"until the end of the End Phase"; depois o mesmo para o outro jogador (6-6-1-2).
   3. Terminam os efeitos "during this turn" do jogador do turno, depois os do outro (6-6-1-3).
   4. O turno passa (6-6-1-4).

## 8. Batalha (7)

Só no Main Phase, fora de outra batalha. O atacante (Líder ou Personagem **active**) dá rest em si e escolhe o alvo: o **Líder** do oponente ou um **Personagem rested** do oponente.

| Etapa | O que acontece |
|---|---|
| **Attack Step** (7-1-1) | Declara o ataque (rest) e o alvo. Ativam `[When Attacking]`/"when you attack" do atacante e, **depois** deles, `[On Your Opponent's Attack]` e "when attacked" do defensor (10-2-16; Q&A de regras). `[On Your Opponent's Attack]` ativa mesmo que o alvo seja outra carta. |
| **Block Step** (7-1-2) | O defensor pode ativar **um** `[Blocker]` por batalha: dá rest num Personagem active com [Blocker] (que não seja o próprio alvo) e ele vira o novo alvo. Ativam `[On Block]`. Atacante com `[Unblockable]` não pode ser bloqueado. |
| **Counter Step** (7-1-3) | O defensor, em qualquer ordem e quantas vezes quiser: trasha da mão cartas de Personagem com **Counter** (sem custo; +poder no Líder ou num Personagem **durante esta batalha**, pode ser em carta que não é o alvo) e/ou paga o custo e ativa Eventos `[Counter]`. Counters só da mão, nunca do campo. |
| **Damage Step** (7-1-4) | Compara o poder: **atacante ≥ alvo** vence (empate é do atacante, inclusive com poder 0 ou negativo). Alvo Líder: 1 dano (2 com `[Double Attack]`); se o defensor tem **0 de Vida no momento em que o dano é determinado, o atacante vence a partida**. Alvo Personagem: ele é **K.O.**. Atacante menor: nada acontece. |
| **End of the Battle** (7-1-5) | Ativam "at the end of this battle"/"if this ... battles"; terminam os efeitos "during this battle" do jogador do turno, depois os do outro. |

**Saída de cena no meio da batalha** (7-1-1-4, 7-1-2-3, 7-1-3-1-3): ao fim do Attack Step, do Block Step e do Counter Step, se o atacante ou o alvo **mudou de área**, a batalha pula direto para o End of the Battle.

**Dano na Vida** (7-1-4-1-1-2/3, 8-6-2): cada ponto de dano é processado um de cada vez — a carta do topo da Vida vai para a mão ou, se tiver `[Trigger]`, o defensor pode revelá-la e ativar o Trigger **no lugar** de pô-la na mão. Com [Double Attack], o Trigger do 1º dano é resolvido **antes** de checar o 2º dano; o 2º dano acontece mesmo que o atacante tenha saído de cena ou perdido o [Double Attack]. Efeitos que ativam durante o dano (ex.: "when you take damage") só são ativados **depois** de todo o dano.

**[Double Attack] com 1 de Vida** não vence a partida: o 1º dano tira a última Vida e o 2º encontra 0 de Vida, mas a vitória só acontece quando o oponente já tem 0 de Vida **no momento em que o dano do ataque é determinado** (Q&A de regras).

## 9. Efeitos (8)

### Tipos (8-1-3)

| Tipo | Como funciona | Exemplos |
|---|---|---|
| **Auto** | Ativa sozinho, uma vez por ocorrência do evento. | `[On Play]`, `[When Attacking]`, `[On Block]`, `[On K.O.]`, `[End of Your Turn]`, "when ..." |
| **Activate** | O jogador do turno declara no Main Phase. | `[Activate: Main]`, `[Main]` |
| **Permanent** | Vale enquanto as condições valem. | "This Character gains +1000 power", "your opponent cannot..." |
| **Replacement** | Troca um acontecimento por outro; marcado por **"instead"**. | "If this Character would be K.O.'d, you may ... instead" |

- "Can"/"may" tornam o efeito opcional; sem essas palavras ele é **obrigatório até onde der** (8-1-2). `[On Play]` sem custo é obrigatório; com custo, o jogador pode não pagar (Q&A de regras).
- **Auto effect perde a ativação** se a carta que cumpriu o momento de ativação sai da área antes de o efeito ser ativado (8-1-3-1-3).
- Auto effects ligados a mover uma carta só ativam se o destino for **área aberta** (8-4-5) — ex.: [On K.O.] ativa porque o trash é aberto.
- **Permanentes** "according to the rules" valem até em áreas secretas (8-1-3-3-3). Quando permanentes se influenciam, o jogador do turno aplica os seus primeiro, depois o outro, repetindo até estabilizar (8-1-3-3-5).
- **Substituição** (8-1-3-4): é opcional se a carta diz "may"; se várias se aplicam, primeiro a da própria carta afetada, depois as do jogador do turno (na ordem dele), depois as do outro; o mesmo acontecimento não é substituído duas vezes pela mesma substituição; se a substituição não pode ser feita, não se aplica; a parte substituída conta como efeito do dono da substituição.
- **One-shot** (resolve e acaba) vs. **contínuo** (dura um período) (8-1-4).
- **Efeitos inválidos** (8-2): efeito negado não acontece, não pede escolha e não deixa pagar custo; um efeito já ativado/resolvido não é desfeito; carta com efeito negado não conta como "sem efeito base"; efeito ganho depois da negação vale.

### Custos e condições (8-3)

- **Activation cost** = o que vem antes do ":" (8-3-1). Paga-se tudo, na ordem escrita; se não dá para pagar **tudo**, não se paga nada (8-3-1-3). Se ficar impossível no meio do pagamento, paga-se o que der e o efeito não resolve (8-3-1-3-1).
- **①, ②...** = dar rest nesse número de DON!! active da área de custo (8-3-1-5). "You may rest 1 of your DON!! cards:" é o mesmo que ①.
- **DON!! −X** = devolver X DON!! do campo (Líder, Personagens, Stage, área de custo — inclusive DON!! dados, active ou rested) ao deck de DON!! (8-3-1-6, 10-2-10).
- Custos opcionais ("you may ...:") podem não ser pagos; aí o efeito não acontece (8-3-1-4).
- **Condições** (8-3-2): `[DON!! xX]` (a carta tem X ou mais DON!! dados, checado no momento da ativação), `[Your Turn]`, `[Opponent's Turn]`, "if ...". Todas precisam valer.
- Um [Trigger] que manda "activate this card's [Main] effect" **não** dispensa o custo do [Main] (Q&A de regras, OP03-074).

### Ativação e resolução (8-4)

1. Checar condições → 2. Indicar o efeito (revelar se vier da mão) → 3. Pagar o custo → 4. Ativar → 5. Resolver.
- Evento: vai para o trash e então resolve (8-4-2). "When you activate an Event" se refere a **usar** um Evento da mão (8-5); ativar o [Trigger] de um Evento **não** conta.
- Escolhas ("choose", "select", "up to") são feitas **durante a resolução** (8-4-4). Sem "up to", é preciso escolher **o máximo possível** até o número pedido; com "up to", pode ser 0.
- Escolha em área secreta com condição (ex.: "reveal 1 {Straw Hat Crew} card"): o jogador **pode não achar** mesmo que exista (8-4-4-2).
- Efeito sem alvo indicado se refere à própria carta (ou ao próprio jogador) (8-4-4-3).
- Pode-se ativar um efeito cujo alvo não existe; ele só não faz nada (Q&A de regras).

### Ordem de resolução (8-6)

- Efeitos dos dois jogadores ativados ao mesmo tempo: o **jogador do turno resolve os dele primeiro**. Se isso ativar outro efeito do jogador do turno, os efeitos pendentes do outro jogador resolvem antes desse novo (8-6-1).
- Se A e B do mesmo jogador ativam juntos e A ativa C, C resolve depois de B (8-6-1-1) — fila, não pilha.
- Efeitos ativados durante o dano esperam todo o dano (8-6-2). Efeitos ativados por usar uma carta/efeito esperam esse efeito terminar (8-6-3).

## 10. Processamento de regra (9)

É automático e imediato. Hoje cobre só a **derrota** (0 Vida + dano no Líder; 0 cartas no deck).

## 11. Palavras-chave (10)

### Efeitos de palavra-chave (10-1)

| Palavra | Regra |
|---|---|
| `[Rush]` | Pode atacar no turno em que entrou. |
| `[Rush: Character]` | Pode atacar **só Personagens** do oponente no turno em que entrou. |
| `[Double Attack]` | Dano na Vida pelo ataque vira 2 (obrigatório; não dá para escolher 1). |
| `[Banish]` | O dano na Vida pelo ataque **trasha** a carta de Vida em vez de pô-la na mão, e **o [Trigger] não ativa** (obrigatório). |
| `[Blocker]` | Quando outra carta sua é atacada, no Block Step, dê rest nesta carta (active) e ela vira o alvo. Um por batalha; opcional. |
| `[Trigger]` | Ao levar dano, revele a carta de Vida e ative o Trigger em vez de pô-la na mão. Pode recusar (a carta vai para a mão sem ser revelada). Durante o Trigger a carta **não está em área nenhuma**; depois vai para o trash, salvo indicação. Só ativa por **dano** — tirar Vida por efeito ("add 1 card from the top of your Life to your hand", "trash 1 Life") não ativa Trigger. Carta de Vida virada para cima também pode ativar Trigger. |
| `[Unblockable]` | O oponente não pode ativar [Blocker] contra esta carta. |

### Palavras-chave (10-2)

| Palavra | Regra |
|---|---|
| **K.O.** | Personagem trashado por **perder batalha** ou por **efeito que diz K.O.**. Trashar por outro meio (custo, limite de 5, "trash") **não** é K.O.; [On K.O.] e "cannot be K.O.'d" só se aplicam a K.O. (10-2-1). |
| `[Activate: Main]` / `[Main]` | Só no Main Phase, fora de batalha. `[Main]` existe só em Eventos (exceto quando um Trigger ou efeito manda ativá-lo). |
| `[Counter]` | Só em Eventos, só no Counter Step quando o oponente ataca. Efeitos não ativam [Counter] a menos que digam "activate [Counter]". |
| `[When Attacking]` | Ativa quando **esta** carta declara ataque. |
| `[On Play]` | Ativa quando a carta é jogada (da mão ou por efeito). |
| `[End of Your Turn]` / `[End of Your Opponent's Turn]` | Ativam no End Phase (ver item 7). |
| `[DON!! xX]` | Condição: X ou mais DON!! dados a esta carta. Vale com mais que X. |
| `DON!! −X` | Custo: devolver X DON!! do campo ao deck de DON!!. |
| `[Your Turn]` / `[Opponent's Turn]` | Condição de turno. |
| `[Once Per Turn]` | Ativa e resolve **uma vez por turno, por carta** (cópias diferentes têm usos separados). A carta que sai e volta ao campo é nova e pode usar de novo. Se o pagamento do custo falhar no meio, o uso **conta** mesmo assim (10-2-13). |
| Trash | "Trash X" sem origem = trashar da **mão**. |
| `[On Block]` | Ativa quando o [Blocker] desta carta é ativado. |
| `[On Your Opponent's Attack]` | Ativa quando o oponente declara um ataque, **depois** dos [When Attacking] dele. |
| `[On K.O.]` | Quando esta carta é K.O.: o efeito é **ativado no campo** (condições checadas no campo), a carta vai para o trash e o efeito **resolve com a carta no trash** (10-2-17). |

### Restrições de estado (Q&A de regras)

- **"Cannot be rested"** impede tudo que exige dar rest: atacar, ativar [Blocker], pagar "rest this Character:" e ser posto rested por efeitos (seus ou do oponente).
- **Líder "tratado como todos os nomes, tipos e atributos"** cumpre condições de tipo/nome, mas também é afetado por "cannot be K.O.'d in battle by <Slash>" etc.

## 12. Outros (11)

- **Loop infinito** (11-1): se ninguém pode parar, empate; se só um pode, ele diz quantas vezes repete; se os dois podem, vale o menor número.
- **Revelar** (11-2): carta movida de uma área secreta para outra secreta ("add X from your deck to your hand") **sempre é revelada**; depois do efeito volta a ser oculta.
- **Olhar áreas secretas** (11-3): só quem usou o efeito olha; as cartas não saem da área; sem instrução, voltam como estavam.

## 13. Regras de torneio relevantes para o simulador

Do **Tournament Rules Manual** (<https://en.onepiece-cardgame.com/pdf/tournament_rules_manual.pdf>, atualizado em 17/10/2025):

- Partidas: melhor de 1 (30–35 min) nas rodadas classificatórias e melhor de 3 (60 min) no top cut; no melhor de 3, quem **perdeu** a partida anterior escolhe ir primeiro ou segundo.
- **Fim do tempo** (5.2): o jogador ativo termina o turno (turno 0) e jogam-se mais 3 turnos. Se ninguém vencer: mais Vida → mais cartas no deck → mais Personagens → quem tirou carta da Vida por último vence. Em eliminação simples não há empate; se os dois cumprem condição de derrota juntos, **perde o jogador do turno**.
- **Esquecer um efeito automático** (7.4.1-2): resolve-se a partir do ponto mais próximo; se o efeito era opcional ("you can"), conta como recusado. No simulador isso não acontece porque os efeitos automáticos são aplicados pelo motor.
- **Olhar cartas a mais** (7.4.1-3) e **cartas a mais em área secreta** (7.4.1-4): no simulador o motor impede.
