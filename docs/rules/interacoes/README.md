# Catálogo de interações

Um arquivo por tema. Cada um traz os **rulings oficiais** da Bandai (Q&A por coleção e Q&A geral de regras) com a carta, a pergunta, a resposta, o link do PDF e a seção das Comprehensive Rules (CR). No fim de cada arquivo, **No motor** diz como o GumGum Fight trata o tema hoje e aponta para [../divergencias.md](../divergencias.md).

| # | Tema | Arquivo |
|---|---|---|
| 1 | K.O. vs. voltar para a mão / deck / trash | [01-ko-vs-remocao.md](01-ko-vs-remocao.md) |
| 2 | [Banish], [Double Attack], dano por efeito e Vida | [02-banish-dano-e-vida.md](02-banish-dano-e-vida.md) |
| 3 | [Trigger] | [03-trigger.md](03-trigger.md) |
| 4 | Efeitos de substituição ("instead") | [04-substituicao.md](04-substituicao.md) |
| 5 | [Blocker], [Rush], [Rush: Character], [Unblockable], alvos de ataque | [05-blocker-rush-ataque.md](05-blocker-rush-ataque.md) |
| 6 | Counter Step, poder na batalha, "during this battle" | [06-counter-e-batalha.md](06-counter-e-batalha.md) |
| 7 | Stage e DON!! | [07-stage-e-don.md](07-stage-e-don.md) |
| 8 | Carta que sai de cena no meio do efeito; "if you do" / "then" | [08-saida-de-cena-e-if-then.md](08-saida-de-cena-e-if-then.md) |
| 9 | Ordem de resolução | [09-ordem-de-resolucao.md](09-ordem-de-resolucao.md) |
| 10 | [Once Per Turn], custos, redução de custo, "up to", busca e revelar | [10-once-per-turn-custos-busca.md](10-once-per-turn-custos-busca.md) |
| 11 | Limite de 5 Personagens; jogar por efeito; [On Play] | [11-limite-de-personagens-e-jogar-por-efeito.md](11-limite-de-personagens-e-jogar-por-efeito.md) |
| 12 | Líderes com regras especiais, construção de deck, "At the start of the game" | [12-lideres-e-regras-especiais.md](12-lideres-e-regras-especiais.md) |
| 13 | Informação oculta (áreas secretas, revelar, olhar) | [13-informacao-oculta.md](13-informacao-oculta.md) |
| 14 | Rulings da comunidade e de outros simuladores | [14-comunidade-e-simuladores.md](14-comunidade-e-simuladores.md) |

## As 15 interações mais contra-intuitivas

Os casos que um motor "ingênuo" mais erra. Cada um vira pelo menos um teste.

1. **A carta do [Trigger] não está em nenhuma área enquanto resolve.** Ela não pode se jogar do trash (OP14-082), não conta na Vida para condições do próprio [Trigger] (OP09-100, ST29-013) e não conta no trash (OP15-097 dá 9 via [Trigger] e 10 via [Main]). Já o Evento ativado da mão vai ao trash antes de resolver e conta (OP04-093, OP15-095), mas não conta na mão (OP11-059, ST03-017). CR 10-1-5-3, 2-7-3.
2. **Trash pela regra dos 5, trash por efeito e "trash instead" não são K.O.** Nenhum [On K.O.] nem "quando um Personagem é K.O.'d" ativa (qa_rules, OP03-012, OP13-008, OP08-045, OP05-030 vs. OP03-076 Rob Lucci, ST27-002). CR 10-2-1-3, 3-7-6-1-1.
3. **Personagem jogado por efeito e logo mandado ao trash pelo limite de 5 perde o [On Play]** (OP06-086, OP10-058). Um bloqueador mandado ao trash assim encerra a batalha (ST02-010). CR 8-1-3-1-3.
4. **Substituição para remoções simultâneas: um único pagamento salva todos e não se pode pagar 2x** (OP15-009 e família, OP17-021, OP17-095, OP11-001 = 3 cartas para 2 Personagens). Recusar a substituição não gasta o [Once Per Turn] (OP05-001). Com Kaido, é tudo ou nada (OP05-001). CR 8-1-3-4.
5. **[Double Attack]: o dano fica "travado" em 2 depois que o 1º dano começa**, mesmo perdendo [Double Attack] ou saindo de campo (qa_rules, OP03-108). Se perder antes do Damage Step, é 1 (ST06-004). Com 1 Vida, o 2º dano não dá a vitória (qa_rules). CR 7-1-4-1-1-3.
6. **Dano por efeito ≠ dano de ataque.** Permite [Trigger], ignora [Banish] e [Double Attack], não abre Blocker/Counter e dá a vitória contra 0 Vida (EB03-055). "Trash Life"/"add Life to hand" com 0 Vida não dão vitória (P-009, ST04-001). Mover Vida por efeito não permite [Trigger] (qa_rules). CR 4-6, 1-2-1-1-1.
7. **Ordem diferente para efeitos de dano em Vida:** "when your attack deals damage" do atacante resolve ANTES do [Trigger] (OP03-040/043). "When a card is removed from opponent's Life" (OP08-105) e "when you take damage" do defensor (OP13-002) resolvem DEPOIS do [Trigger]. Efeitos "quando a Vida chega a 0" esperam o fim de todos os danos (OP05-098). CR 8-6-2.
8. **"Ativar Evento" é card activation, não effect activation.** [Trigger] de Evento não conta (OP01-062, OP15-002, OP15-119), "Activate this card's [Main]" por [Trigger] também não. Mas o [Main] ativado da mão pelo Sanji OP12-041 e o Evento do Sabo OP15-046 contam, enquanto o [Main] do trash via Reiju EB03-031 não conta. "Quando o oponente ativa Evento" só dispara depois de o Evento resolver (OP01-004, OP11-012). CR 8-5.
9. **Custo tem valor negativo oculto:** 6 −5 −2 mostra 0, mas internamente é −1, e removido o −5 fica 4 (OP02-121, P-032). Os permanentes do jogador do turno vêm antes dos do oponente, e efeitos permanentes condicionais são reavaliados depois de cada modificação (OP10-042 Usopp com Tsuru, Kaku e Issho dá 2/0/0). CR 1-3-6-2-1, 8-1-3-3-5.
10. **«Set Power to 0» é uma redução igual ao poder atual na ativação, não um "lock" em 0.** Counters posteriores somam (OP07-002 dá 1000), e o valor volta no turno seguinte. Já "set base power" usa o maior valor entre efeitos concorrentes (ST34-004, OP17-008), e a troca de base persiste se o par sai de campo (OP14-001). CR 4-12, 4-9-2-1.
11. **[Rush] ganho por um efeito resolvido ("gains [Rush] during this turn") persiste** mesmo se a condição deixa de valer (OP06-061, OP08-060, ST10-004, EB01-045). Já "pode atacar no turno em que entra se X" (permanente) é reavaliado e se perde (EB02-019, EB02-061, ST30-007, OP04-118). [Rush: Character] não ataca Personagens ativos (EB04-011). CR 8-2-3 vs 8-1-3-3-2.
12. **[Blocker]:** a condição é checada só na ativação (OP06-072, ST31-003). O alvo não volta se o bloqueador perde a condição (ST01-002, OP11-057). Bloqueio por Personagem ativado no [On Your Opponent's Attack] funciona (OP09-032), mas ativado no Counter Step não (OP01-057). Redirecionar por efeito não habilita [Blocker] (EB01-038), mas fura [Unblockable] (ST29-016). O "lock" do Limejuice fica fixo no alvo (OP09-014), enquanto o do Prince Grus é contínuo pela condição (OP11-013). CR 7-1-2, 10-1-4-1, 10-1-7-1.
13. **[On Your Opponent's Attack] / "when attacked":** ativam no Attack Step, depois dos [When Attacking] e antes de [Blocker]/Counter (OP13-001, OP17-040, OP03-001). Não ativam se a carta foi removida pelo [When Attacking] (OP11-049) nem se ela entrou durante o ataque (OP05-075). Quando é obrigatório, ativa no 1º ataque e gasta o Once Per Turn mesmo sem efeito útil (PRB02-004); quando é opcional, pode ser guardado para outro ataque (OP09-001, OP17-058). Um [On Play] disparado durante a resolução do [When Attacking] espera o [On Your Opponent's Attack] pendente (OP07-019). CR 10-2-16-1, 8-6-1.
14. **"If you do" / "If" bloqueiam o resto, "Then" não.** Pagar só parte de um "you may A e B. If you do" anula a sequência (OP11-024, OP15-020). "Then" após uma parte que falhou ainda resolve (OP03-122, OP10-016), exceto quando a falha veio de um "if" (OP06-116). Custo de ativação nunca é pago em parte (ST06-012), e um custo substituído não conta como pago para o "If you do" (OP05-100 + OP01-047). CR 4-10-1, 4-10-2, 8-3-1-3, 8-3-1-7.
15. **Negar/mover não desfaz o que já resolveu, e "this Character" é a carta física.** Buffs já aplicados continuam após a negação (OP06-074 Newgate +2000). Efeitos "no fim do turno" de uma carta que saiu de campo ainda resolvem, inclusive os negativos (OP06-006 Saga, OP08-074). Mas mudar de área cria uma carta nova: Thatch não vai ao trash (OP03-005), o −2000 não acompanha (OP02-018) e Mr.2 não vai ao deck (OP02-064). Efeitos "todos os seus Personagens" não pegam os jogados depois (OP04-083, OP13-064). Negar o Líder Nami (OP03-040) faz o deck 0 voltar a ser derrota (OP09-093). CR 8-2-3, 3-1-6, 8-4-6.
