# Limite de 5 Personagens; jogar Personagem por efeito; [On Play] quando jogado por efeito

## Rulings oficiais

Cada item: carta (ou regra geral), pergunta (P), resposta oficial (R), fonte e seção das Comprehensive Rules (CR). Os rulings servem de caso de teste.

- **OP01-014 (Jinbe)**: P: com 5 Personagens, posso jogar um pelo [On Block]? R: Sim. Revelo, mando 1 ao trash (regra) e jogo. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op01.pdf. CR: 3-7-6-1
- **OP01-049 (Bepo)**: P: com 5 Personagens, jogo um pelo [When Attacking]. Posso mandar o próprio Bepo (atacante) ao trash? R: Sim, e a batalha termina sem nada acontecer. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op01.pdf. CR: 3-7-6-1, 7-1-1-4
- **OP06-086 (Gecko Moria) / OP10-058 (Rebecca)**: P: jogo A e B pelo mesmo efeito, e para abrir espaço para B mando A ao trash. O [On Play] de A ainda ativa? R: Não. A saiu de campo antes de o efeito ser ativado. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op06.pdf. CR: 8-1-3-1-3, 3-7-6-1-1
- **OP10-008 (Scotch) / OP10-017 (Rock)**: P: mando o Rock ao trash para jogar o Scotch (limite de 5). O [On Play] do Scotch pode jogar outro Rock? R: Sim. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op10.pdf. CR: 3-7-6-1
- **OP16-041 (Buggy, Líder)**: P: mandar um {Impel Down} ao trash pela regra dos 5 conta como "removido do campo pelo seu efeito"? E devolvê-lo à mão com meu efeito? R: Pela regra, não. Pelo meu efeito, sim. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op16.pdf. CR: 3-7-6-1-1
- **OP06-086 (Gecko Moria)**: P: se jogo só 1 Personagem pelo efeito "1 ativo e 1 descansado", ele entra descansado? R: Não, entra ativo. (Igual: OP10-058 Rebecca.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op06.pdf. CR: 3-7-5
- **OP09-022 (Lim)**: P: Personagens que entram descansados por "your Character cards are played rested" ativam "quando um Personagem é descansado pelo seu efeito"? R: Não. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op09.pdf. CR: 3-7-5
- **OP12-036 (Roronoa Zoro)**: P: o que significa "This card in your hand cannot be played by effects"? R: Não pode ser jogado da mão por efeitos (ex.: ST12-003). Pode ser jogado pagando o custo, ou por efeito a partir de outra área (trash). Fonte: https://en.onepiece-cardgame.com/pdf/qa_op12.pdf. CR: 4-7-1
- **OP13-028 (Shanks)**: P: depois de "não pode jogar cartas da mão neste turno", posso jogar por efeito "play from your hand"? R: Sim. A proibição cobre jogar pagando o custo normal (Personagens, Stages, Eventos). Ruling especial. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op13.pdf. CR: 4-7-1, 4-7-2
- **OP05-075 (Mr.1(Daz.Bonez))**: P: jogo outro Mr.1 pelo [On Your Opponent's Attack]. O novo pode usar o próprio [On Your Opponent's Attack] neste ataque? R: Não. O timing já passou. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op05.pdf. CR: 8-1-3-1-3, 10-2-16-1
- **OP02-026 (Sanji) / OP14-041 (Boa Hancock)**: P: um Personagem jogado no turno do oponente ativa efeitos de "quando você joga"? R: Sim (Sanji sem [Your Turn]; Hancock com [Opponent's Turn] é obrigatório comprar). Fonte: https://en.onepiece-cardgame.com/pdf/qa_op02.pdf. CR: 8-1-3-1
- **PRB01-001 (Sanji, Líder)**: P: dou [Rush] a Personagem sem [On Play]. Um com [On Play] cujo custo não paguei ou cuja condição não cumpro conta como "sem [On Play]"? E no 1º turno? R: Não conta. No 1º turno, não pode atacar mesmo com [Rush]. Fonte: https://en.onepiece-cardgame.com/pdf/qa_prb01.pdf. CR: 6-5-6-1, 2-8-5
- **P-011 (Uta) / OP06-074 (Zephyr (Navy)) / OP09-081**: P: o que é "no base effect"? R: Carta sem texto: só [Counter +1000] conta como sem efeito base; só [Trigger], não; buffs externos não mudam; efeito negado não vira "sem efeito base"; [On Play] negado pelo Teach também não. Fonte: https://en.onepiece-cardgame.com/pdf/qa_promotion-cards.pdf. CR: 2-8-5, 8-2-2
- **ST03-005 (Dracule Mihawk) / OP15-022 (Brook, Líder)**: P: o [When Attacking] obrigatório "compre 2" com ≤1 carta no deck? Com o Líder Brook, se o deck chega a 0 e depois recebe cartas? R: Mihawk: pode atacar, mas compra o que puder e com 0 no deck perde. Brook: ainda perde no fim do turno. Fonte: https://en.onepiece-cardgame.com/pdf/qa_st-01-st-04.pdf. CR: 1-2-1-1-2, 9-2-1-2

## No motor

Limite de 5 em `stepPlay` (o jogador escolhe quem trashar, sem [On K.O.]); jogar por efeito dispara [On Play]; entrar rested quando indicado (conforme). Os [On Play] disparados por um efeito esperam esse efeito terminar e, se forem de cartas diferentes, o dono escolhe a ordem (ver tema 9).

Divergências deste tema: nenhuma (corrigidas: DV-02, DV-04) (detalhes em [../divergencias.md](../divergencias.md)).
