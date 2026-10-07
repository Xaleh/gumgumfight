# K.O. vs. voltar para a mão / deck / trash

## Rulings oficiais

Cada item: carta (ou regra geral), pergunta (P), resposta oficial (R), fonte e seção das Comprehensive Rules (CR). Os rulings servem de caso de teste.

- **Q&A de regras (limite de 5 Personagens)**: P: com 5 Personagens jogo um 6º e mando um para o trash; o [On K.O.] dele ativa? R: Não. Ele não foi K.O.'d, foi movido direto para o trash pela regra. Fonte: https://en.onepiece-cardgame.com/pdf/qa_rules.pdf. CR: 3-7-6-1-1, 10-2-1-3
- **Q&A de regras ([On K.O.])**: P: [On K.O.] ativa quando este Personagem é K.O.'d ou quando ele derruba (K.O.) um Personagem do oponente? R: Só quando o próprio Personagem com o efeito é K.O.'d. Fonte: https://en.onepiece-cardgame.com/pdf/qa_rules.pdf. CR: 10-2-17-1
- **OP03-012 (Marshall.D.Teach)**: P: um Personagem mandado para o trash por este [When Attacking] ativa seu [On K.O.]? R: Não. (Mesmo ruling: OP06-092 Brook, OP09-009 Benn.Beckman, ST19-003 Tashigi.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op03.pdf. CR: 10-2-1-3
- **ST27-002 (Catarina Devon)**: P: depois de mandar este Personagem para o trash com o próprio [Activate: Main], posso usar o [On K.O.] dele para comprar 1? R: Não. Ir para o trash por este efeito não conta como K.O. Fonte: https://en.onepiece-cardgame.com/pdf/qa_st-23-28.pdf. CR: 10-2-1-3
- **OP13-008 (Emporio.Ivankov)**: P: se este Personagem seria K.O.'d por efeito do oponente, posso usar o efeito dele para mandá-lo ao trash? R: Sim. Ele vai para o trash sem ser K.O.'d, e nenhum efeito do tipo "quando um Personagem é K.O.'d" ativa. (Mesmo ruling: OP13-047 Fossa, OP13-060 Amatsuki Toki.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op13.pdf. CR: 8-1-3-4, 10-2-1-3
- **OP08-045 (Thatch)**: P: se ele seria K.O.'d e eu o mando ao trash para comprar 1 no lugar (instead), isso ativa o "When a Character is K.O.'d" de outra carta? R: Não. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op08.pdf. CR: 8-1-3-4
- **OP05-030 (Donquixote Rosinante)**: P: usei o [Opponent's Turn] para mandar este Personagem ao trash em vez de ser K.O.'d. O oponente pode ativar o "quando um Personagem do oponente é K.O.'d" de OP03-076 Rob Lucci? R: Não. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op05.pdf. CR: 8-1-3-4
- **OP02-027 (Inuarashi)**: P: "cannot be removed from the field by your opponent's effects" também impede ir para a mão ou o deck? R: Sim. Protege contra K.O. por efeito e contra ir para mão, deck ou trash. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op02.pdf. CR: 4-11-2
- **OP01-024 (Monkey.D.Luffy)**: P: "[DON!! x2] não pode ser K.O.'d por <Strike>" vale contra efeitos de Personagens <Strike>? R: Não. Vale só para o resultado de batalha. Ele pode ser K.O.'d por efeitos. (Na mesma linha: P-007 Luffy. Já "cannot be K.O.'d" sem qualificação cobre efeito e batalha: P-040 Kaido, ST05-017 Union Armada.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op01.pdf. CR: 10-2-1-3
- **OP04-079 (Orlumbus)**: P: posso escolher para "K.O. 1 dos seus {Dressrosa}" um Personagem meu com "cannot be K.O.'d by effects"? R: Sim. O resto do efeito resolve (−4 de custo, trash 2 do deck), mas o Personagem escolhido não é K.O.'d. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op04.pdf. CR: 1-3-2, 1-3-3
- **OP06-074 (Zephyr (Navy))**: P: se eu negar o efeito de um Personagem com [On K.O.] e depois dar K.O. nele, o [On K.O.] ativa? R: Não. (Mesmo ruling: OP09-093 Marshall.D.Teach, OP09-097 Black Vortex, OP09-098 Black Hole, OP10-098 Liberation.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op06.pdf. CR: 8-2-1-1
- **OP04-047 (Ice Oni)**: P: venci a batalha contra um Personagem do oponente. O Personagem K.O.'d vai para o fundo do deck no fim da batalha? R: Não. Ele vai para o trash. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op04.pdf. CR: 3-1-6, 7-1-4-1-2
- **OP14-079 (Crocodile)**: P: se este [Activate: Main] dá K.O. em um Personagem meu com [On K.O.], ele ativa? R: Sim. Primeiro termina o resto do efeito do Crocodile ("−10 de custo… então trash 2"), depois ativa o [On K.O.]. (Igual: OP14-080 Gecko Moria.) Fonte: https://en.onepiece-cardgame.com/pdf/qa_op14_eb04.pdf. CR: 8-6-3, 10-2-17
- **OP03-090 (Blueno)**: P: se ele e outro Personagem "CP" de custo ≤4 são K.O.'d ao mesmo tempo, o [On K.O.] dele pode jogar o outro do trash? R: Sim. Fonte: https://en.onepiece-cardgame.com/pdf/qa_op03.pdf. CR: 10-2-17-1, 8-4-5
- **ST08-013 (Mr.2.Bon.Kurei(Bentham))**: P: ele perde a batalha, é K.O.'d e está no trash no fim da batalha. O efeito [DON!! x1] "no fim da batalha" ainda ativa? R: Não. Fonte: https://en.onepiece-cardgame.com/pdf/qa_st-08.pdf. CR: 8-1-3-1-3, 7-1-5-2

## No motor

O K.O. passa por `koCharacter` (engine.ts:4359): proteções, substituição, eventos `characterKO`/`characterRemoved` e [On K.O.]. As condições do [On K.O.] ([DON!! xX], [Your Turn]/[Opponent's Turn], condição, negação, [Once Per Turn]) são vistas com a carta ainda no campo; o efeito resolve depois, com ela no trash (10-2-17-1, Zephyr OP06-074: negado não ativa). Trash pelo limite de 5, por custo ou por efeito "trash" **não** é K.O. e não dispara [On K.O.] (conforme).

Divergências deste tema: DV-07, DV-12, DV-13, DV-14, DV-16 (detalhes em [../divergencias.md](../divergencias.md)).
