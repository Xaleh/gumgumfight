# Ordem de resolução

## Rulings oficiais

Cada item: carta (ou regra geral), pergunta (P), resposta oficial (R), fonte e seção das Comprehensive Rules (CR). Os rulings servem de caso de teste.

- **Q&A de regras**: P: quem ativa primeiro, o [When Attacking] do oponente ou o meu [On Your Opponent's Attack]? R: O [When Attacking] (do jogador do turno). Fonte: https://en.onepiece-cardgame.com/pdf/qa_rules.pdf. CR: 10-2-16-1, 8-6-1
- **OP07-019 (Jewelry Bonney, Líder)**: P: o oponente ataca com OP01-060 Doflamingo, cujo [When Attacking] joga OP07-045 Jinbe, e o [On Play] do Jinbe joga outro Personagem. Posso descansar esse último com meu [On Your Opponent's Attack]? R: Não. A ordem é: o Doflamingo joga o Jinbe, depois resolve meu [On Your Opponent's Attack], e só então o [On Play] do Jinbe joga o outro Personagem. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op07.pdf. CR: 8-6-1, 8-6-3
- **OP11-102 (Camie) vs OP05-098 (Enel)**: P: dano com o oponente em 1 Vida, e ele usa o [Trigger] OP06-115. Qual resolve primeiro? R: O efeito do jogador do turno (Camie) resolve primeiro (nada acontece, porque a única Vida é a recém-adicionada), depois o Enel. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op11.pdf. CR: 8-6-1
- **OP10-042 (Usopp, Líder)**: P: meu {Dressrosa} com [On K.O.] cai no turno do oponente. Qual ordem? E se o [On K.O.] (OP10-090 Franky) jogar OP04-092 Rebecca? R: Eu escolho a ordem entre o [On K.O.] e o efeito do Líder (ambos meus). O efeito do Líder sempre resolve antes do [On Play] da Rebecca, que disparou depois. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op10.pdf. CR: 8-6-1-1
- **OP04-058 (Crocodile, Líder) / OP05-098 (Enel) + OP05-106 Shura**: P: um [Trigger] "jogue esta carta" ativa o [Opponent's Turn] do Líder e o [On Play] do Personagem. Qual primeiro? R: O dono escolhe a ordem. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op04.pdf. CR: 8-6-1-1
- **OP03-094 (Air Door)**: P: o [On Play] do Personagem jogado por este [Main] resolve antes do "Then, trash the rest"? R: Não. O efeito do Evento termina primeiro. (Igual: OP12-056 Monkey.D.Garp com o Líder Kuzan, que compra só depois do Garp resolver por inteiro.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op03.pdf. CR: 8-6-3
- **OP06-086 (Gecko Moria) / OP10-058 (Rebecca)**: P: joguei os Personagens A (ativo) e B (descansado) pelo mesmo efeito. Escolho a ordem dos [On Play]? R: Sim. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op06.pdf. CR: 8-6-1-1
- **OP14-041 (Boa Hancock)**: P: um efeito joga vários Personagens ao mesmo tempo. Quantas vezes ativa "quando você joga um Personagem"? R: Uma vez por Personagem (3 jogados, compra 3). Fonte: https://en.onepiece-cardgame.com/pdf/qa_op14_eb04.pdf. CR: 8-1-3-1
- **OP10-003 (Sugar, Líder)**: P: o [End of Your Turn] que checa "Personagem com 6000+" vê os buffs "during this turn"? R: Sim. Ele ativa antes de os buffs expirarem. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op10.pdf. CR: 6-6-1-1, 6-6-1-3
- **ST24-005 (X.Drake)**: P: o "ativar 1 DON no fim do turno" do [On Play] ocorre antes ou depois dos meus [End of Your Turn]? R: Depois de todos eles resolverem. Fonte: https://en.onepiece-cardgame.com/pdf/qa_st-23-28.pdf. CR: 6-6-1-2
- **OP11-040 (Monkey.D.Luffy, Líder)**: P: "no início do seu turno" é antes ou depois da compra? R: Antes, no início do Refresh Phase: efeitos de início de turno, depois os DON voltam, depois ativa tudo, depois Draw. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op11.pdf. CR: 6-2-2
- **ST21-015 (Roronoa Zoro) / OP01-085 (Mr.3(Galdino))**: P: jogado no turno do oponente, até quando dura "até o fim do próximo turno do oponente"? R: Até o fim do turno atual do oponente. Fonte: https://en.onepiece-cardgame.com/pdf/qa_st-21.pdf. CR: 6-6-1-2
- **OP05-058 (It's a Waste of Human Life!!)**: P: os dois jogadores descartam ou põem no fundo do deck. Em que ordem? R: Primeiro o jogador do turno, depois o oponente, cada um escolhendo os seus. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op05.pdf. CR: 1-3-10, 1-3-4
- **OP14-021 (Issho)**: P: "quando este Personagem fica descansado" ativa ao atacar? R: Sim, no mesmo timing que [When Attacking]. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op14_eb04.pdf. CR: 7-1-1-1, 7-1-1-3

## No motor

Hoje a resolução é uma pilha LIFO que empilha os efeitos disparados na hora. É a principal fonte de divergência de ordem.

Divergências deste tema: DV-02, DV-03, DV-06, DV-28, DV-29, DV-30 (detalhes em [../divergencias.md](../divergencias.md)).
