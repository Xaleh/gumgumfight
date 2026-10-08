# Comunidade, histórico das regras e outros simuladores

Pesquisa de 07/10/2026. Complementa os rulings oficiais dos outros temas com o que a comunidade e outros simuladores dizem. **Regra oficial sempre vence**: o que está aqui serve para entender a origem das mudanças, os pontos polêmicos e as escolhas de interface de outros simuladores.

Marcação de cada informação: **[OFICIAL]** = Bandai (en.onepiece-cardgame.com); **[COMUNIDADE]** = site ou repositório de terceiros; **[SNIPPET]** = só o trecho mostrado pelo buscador, **não verificado**; **[INFERÊNCIA]** = conclusão da pesquisa, não dita pela fonte.

> Limitação: reddit.com, egmanevents.com, onepiece.limitlesstcg.com, onepiecetopdecks.com, optcgsim.com e web.archive.org estavam bloqueados na rede usada na pesquisa. Threads do Reddit e do Discord não puderam ser conferidas; a seção de interações polêmicas se apoia nas respostas oficiais, que é onde essas discussões terminam. Vale repetir a consulta a esses sites quando houver acesso.

A lista de banidas e as erratas estão em [../fontes.md](../fontes.md).

## Histórico de versões das Comprehensive Rules (changelog)

### 1.1 O que existe oficialmente
- A Bandai **não publica changelog**. O PDF atual não tem tabela de revisões: só "Version 1.2.1 / Last updated: 8/28/2026". [OFICIAL] https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828
- O query string (`?20260828`, `?20260116`, `?20251017`…) é só cache-bust: as 4 variantes baixadas e todas têm o mesmo MD5. Ou seja, **versões antigas não ficam disponíveis no site**. A página de regras lista: CR 28/08/2026, Tournament Rules Manual 16/01/2026, Rule Manual 23/06/2023. [OFICIAL] https://en.onepiece-cardgame.com/rules/
- O onepiece.gg (agregador) só repete a manchete "Comprehensive Rules has been updated" (28/08/2026), sem detalhes. [COMUNIDADE] https://onepiece.gg/comprehensive-rules-has-been-updated
- Não foi encontrado nenhum resumo da comunidade (Reddit/egman) com o changelog 1.1.x→1.2.x. Então **o diff foi montado regra por regra**, comparando regra por regra:
  - **v1.2.1** (8/28/2026): PDF oficial atual.
  - **v1.2.0** (1/16/2026): cópia em Markdown em [nobelsmith/one-piece-tcg `rules/parsed/rule_comprehensive.md`](https://github.com/nobelsmith/one-piece-tcg/blob/HEAD/rules/parsed/rule_comprehensive.md). O cabeçalho diz "Version 1.2.0 / Last updated: 1/16/2026". O mesmo texto aparece em [TheCardGoat/tcg-engines](https://github.com/TheCardGoat/tcg-engines/blob/HEAD/submodules/one-piece/.agents/skills/op-rules/references/rule_comprehensive.md) e em [Palhuca/OnePieceTCG_DiscordBot](https://github.com/Palhuca/OnePieceTCG_DiscordBot/blob/HEAD/docling/md/rule_comprehensive.md).
  - **Versão anterior não identificada (pré-1.2.0, provavelmente 1.1.x)**: [syllith/opsim `OPTCG Comprehensive Rules.txt`](https://github.com/syllith/opsim/blob/HEAD/OPTCG%20Comprehensive%20Rules.txt). Não tem cabeçalho de versão, então o número exato é **incerto**.
  - Resultados de busca também indexaram "Version 1.2.0, last update 9 Jan 2026" (`rule_comprehensive.pdf?20260109`). É possível que tenha existido uma 1.2.0 de 09/01 antes da de 16/01. **Incerto.**

### 1.2 Mudanças substantivas v1.2.0 → v1.2.1 (diff real; ignorei mudanças só de paginação)
| Regra | Mudança |
|---|---|
| **2-7-3** (ativar Evento) | Antes: "…rest those DON!! cards, and then trash the revealed card to activate it". Agora: "…rest those DON!! cards, **trash the revealed card, then activate and resolve the effect**". A ordem ficou explícita: o Evento vai ao trash antes de resolver. |
| **2-10-3 / 2-10-4** (novas) | "Depending on the effect, the value of the (Symbol) Counter may differ from the value indicated on the card." e "If a card has **multiple (Symbol) Counters, only the Counter with the highest value is applied**." |
| **3-1-2-1** (nova) | Condições como "If you have", "if your opponent has", "If you have no", "if you do not have" se referem **ao field**, salvo indicação contrária. Combina com as erratas "you have" → "there is" (ST14-014 em 16/08/2024; OP16-081 em 29/05/2026; ver [../fontes.md](../fontes.md)). |
| **4-10-2** | Acrescentado: "However, if a preceding 'if' clause has not been resolved as outlined in 4-10-1., the following clause in that text cannot be resolved." Ou seja, "then" não "salva" uma cadeia que começou com um "if" falho. |
| **7-1-3** (Counter Step) | **Removido** o passo "7-1-3-1. Effects of the player being attacked that read 'when attacked' activate." O 「When Attacked」 já ativa no Attack Step (7-1-1-3, desde a 1.2.0). Também foram renumerados: ações de Counter = 7-1-3-1-1/-2. A regra "fim do Counter Step: se o atacante ou o alvo mudou de área → End of Battle" virou **7-1-3-1-3** (na 1.2.0 estava numerada errado como 7-1-2-3). |
| **8-3-1-4** | "…this will mean **the effect as written after the : colon mark** cannot be activated" (antes: "the effect cannot be activated"). |
| Inalterados (conferidos) | 6-6-1-2/6-6-1-3 (ordem do End Phase), 4-12 «Set Power to 0», 10-2-13-2 (Once Per Turn por cópia), 8-6-1 (turn player resolve primeiro). |

### 1.3 Mudanças substantivas da versão antiga (syllith, pré-1.2.0) → v1.2.0
| Regra | Mudança |
|---|---|
| **4-12 «Set Power to 0»** (nova seção) | "is an effect that reduces the power of the target for a specified duration, by the same amount as the target's current power at the time the effect was activated." / "If the target card's power is already in the negatives, nothing will happen". Importante: é um **−X congelado**, não um "set". Buffs posteriores somam por cima. |
| **7-1-1-3** | Antes: [When Attacking], "when you attack", [On Your Opponent's Attack]. Agora inclui também **「When Attacked」** no Attack Step. |
| **8-3-2-3** [DON!! xX] | Acrescentado: se o efeito [DON!! xX] tem um timing de ativação, "even if the activation timing is met, the effect cannot be activated unless the other conditions for [DON!! xX] are also met at that time". |
| **10-1-6 [Rush: Character]** (nova) | Pode atacar **Characters** do oponente no turno em que entrou. |
| **10-1-7 [Unblockable]** (nova) | O oponente não pode ativar [Blocker]. |
| 10-2-10-1 "DON!! −X" | Só tipografia ("－X" → "-X"). Mantém: devolve DON!! "from your Leader area, Character area, and cost area" (ou seja, DON!! dados também contam). |

### 1.4 Tópicos pedidos e onde estão hoje (v1.2.1)
- **[Trigger]**: 2-11, 10-1-5. O card fica "fora de qualquer área" enquanto o Trigger resolve (10-1-5-3). Não houve mudança recente de texto.
- **Set Power to 0**: 4-12 (adicionado em 1.2.0).
- **DON!! −X**: 10-2-10 (sem mudança de mérito).
- **[On Your Opponent's Attack]**: 10-2-16-1 (ativa depois de [When Attacking] e de outros efeitos do Attack Step). Sem mudança de mérito.
- **Deck-out**: 1-2-1-1-2 / 1-2-2-2 (derrota checada no rule processing, 9-1-2). Sem mudança.
- **Counter**: 2-10-3/2-10-4 (novos em 1.2.1); Counter Step reestruturado (7-1-3).
- **Once Per Turn**: 10-2-13 (sem mudança).
- **End Phase**: 6-6-1-2/-3 (sem mudança entre 1.2.0 e 1.2.1).

---


## Interações polêmicas e a resposta oficial/consenso

Fontes principais: **Q&A geral** [OFICIAL] https://en.onepiece-cardgame.com/pdf/qa_rules.pdf?20250228 (abreviado "QA-geral") e os Q&A por set listados em https://en.onepiece-cardgame.com/rules/faq/ . O repo [TheCardGoat/tcg-engines `docs/hard-interaction-research.md`](https://github.com/TheCardGoat/tcg-engines/blob/HEAD/submodules/one-piece/docs/hard-interaction-research.md) traz uma lista de "hard interactions" usada para testar uma engine aberta. Não foi possível abrir threads do Reddit nem artigos do egman (bloqueados).

1. **Double Attack contra 1 Life não vence.** QA-geral: "If my opponent has 1 Life card, can I win the game by using a [Double Attack] to deal 2 damage? — No, you cannot." Base: CR 7-1-4-1-1-1, a vitória só acontece se o oponente tem 0 Life "at the point when it is determined that damage will be dealt". O OPlayTCG até exibe uma dica sobre isso (changelog v1.8.0: https://oplaytcg.com/en/changelog).
2. **Trigger no meio do Double Attack.** QA-geral: o [Trigger] do 1º dano é resolvido **antes** do 2º dano. E "the damage to be dealt is fixed at 2": o 2º dano acontece mesmo se o atacante sair do campo ou perder [Double Attack] por causa do Trigger.
3. **Enel (OP05-098) e Life gain.** Q&A OP-05 (https://en.onepiece-cardgame.com/pdf/qa_op05.pdf):
   - (a) Tomando Double Attack com 1 Life, o efeito do Enel só entra **depois que os 2 danos acabam e o Damage Step termina**.
   - (b) Se um Trigger (ex.: OP03-118) levou a Life de 0 para 1, o Enel **ainda pode** ativar.
   - (c) Contra o [On Play] de um Trigger (OP05-106 Shura), o jogador escolhe a ordem.
   - Q&A OP13-002 Ace: o [Trigger] é sempre processado **antes** dos efeitos "when you take damage" (https://en.onepiece-cardgame.com/pdf/qa_op13.pdf).
4. **Replacement "would be K.O.'d … instead".**
   - Recusar um replacement opcional **não gasta** o [Once Per Turn] (Q&A OP05-001 Sabo: "Because '…instead' has not been resolved, the [Once Per Turn] restriction does not apply").
   - Trash-se "instead" de ser K.O.'d **não é K.O.**: não dispara efeitos de "when a Character is K.O.'d" (Q&A OP08 Thatch; Q&A OP13 Emporio.Ivankov/Fossa/Amatsuki Toki).
   - O replacement é avaliado com o poder **após o Counter Step** (Q&A OP05-001 Sabo).
5. **Um replacement protegendo vários Characters removidos ao mesmo tempo.** FAQ OP15-EB04 (Koby OP15-009, Laboon, Leo, Nola, Perona): se 2 Characters seriam removidos simultaneamente, **um único pagamento** do "instead" mantém os dois. Não dá para pagar 2×, e a escolha é "pagar uma vez ou deixar ambos saírem" (https://en.onepiece-cardgame.com/pdf/faq_op15-eb04.pdf). Já cópias diferentes do mesmo card podem cada uma substituir a própria remoção (Q&A OP12-027 Koushirou). Rosinante OP04-119 protege as outras mesmo sendo K.O.'d junto (Q&A OP-04).
6. **Banish × Trigger/replacement.** QA-geral: com [Banish] não é possível escolher não trashar a Life. CR 10-1-3: sem Trigger. Q&A EB03: [Banish] só afeta cards de Life "added to the hand … by damage dealt from an attack", não Life movida por efeito [On K.O.].
7. **Poder negativo / 0.** QA-geral: o Character "remains on the field with a power of 0 or less". −10000 em 6000 = **−4000**. Dar 1 DON!! a −4000 → −3000. Ataque −2000 vs −2000: **o atacante vence** (empate favorece o atacante, CR 7-1-4-1). 0 vs 0: o defensor é K.O.'d. **Custo** nunca fica abaixo de 0. «Set Power to 0» não faz nada se o poder já é negativo (CR 4-12-2).
8. **DON!! −X com DON!! dados.** QA-geral: "Yes… You can choose to return any DON!! cards from your Leader area, Stage area, Character area, or cost area." Um Trigger que diz "Activate this card's [Main] effect" **não** dispensa o custo DON!! −2 (QA-geral, OP03-074 Top Knot).
9. **On Play com o campo cheio (5 Characters).** QA-geral: o Character trashado para abrir espaço **não é K.O.'d**, então não dispara [On K.O.]. Casos-limite:
   - Q&A OP01-049 Bepo: pode trashar o próprio atacante → a batalha termina "without anything happening".
   - Q&A ST02-010 Basil Hawkins: o Blocker Jinbe é trashado pelo próprio [On Block] → Counter e Damage Step são pulados.
   - [On Play] é obrigatório, salvo se tiver custo opcional (QA-geral).
10. **"Cannot be removed from the field by your opponent's effects".** Q&A OP-02 (entrada OP02-027 Inuarashi, pelo layout do PDF): impede K.O. **por efeito**, bounce para a mão, ida para o deck e para o trash. https://en.onepiece-cardgame.com/pdf/qa_op02.pdf . [INFERÊNCIA] K.O. em batalha não é "effect", então continua possível. Note que é "opponent's effects": o efeito do próprio dono (ex.: trashar para abrir espaço) não é bloqueado.
11. **Trigger só ao tomar dano.** QA-geral: mover Life por efeito ("add/trash from Life") **não** permite ativar o Trigger. Life face-up **pode** ativar o Trigger. Ativar o [Trigger] de um Evento **não** conta como "when you activate an Event". Pode-se adicionar à mão sem ativar.
12. **Once Per Turn com várias cópias.** QA-geral e CR 10-2-13-2: cada carta tem seu próprio uso. Recusar não gasta o uso (item 4). [On Play] com OPT e condição satisfeita é obrigatório (Q&A OP02 Sanji, linha anterior).
13. **[On Your Opponent's Attack] e mudança de alvo.** QA-geral: [When Attacking] do atacante ativa **antes**. Pode ativar mesmo se outro card foi o alvo. Q&A ST-29: mudar o alvo por efeito "is different from using [Blocker]", então funciona contra [Unblockable] e contra [Rush: Character] (https://en.onepiece-cardgame.com/pdf/qa_st-29.pdf).
14. **Blocker.** QA-geral:
    - no máximo 1 [Blocker] por batalha;
    - o Character atacado não pode bloquear a si mesmo;
    - Character rested não bloqueia;
    - "cannot be rested" ⇒ não ataca, não usa [Blocker] nem "[Activate: Main] You may rest this Character".
15. **Atacante/alvo sai do campo no meio da batalha.** QA-geral e CR 7-1-1-4 / 7-1-2-3 / 7-1-3-1-3: checagem **no fim de cada step** → End of Battle, sem dano.
16. **Counter +X.**
    - Pode dar +X a um card que não está sendo atacado (dura até o fim da batalha).
    - Counter de Character só sai **da mão**.
    - Evento [Counter] só no Counter Step de um ataque do oponente.
    - Múltiplos símbolos de Counter: aplica-se só o maior (CR 2-10-4, novo em 1.2.1).
    - "This turn" × "this battle": a errata OP13-077 trocou turn→battle (ver [../fontes.md](../fontes.md)).
17. **Nami (deck-out win).** OP03-040 está **banida** desde 30/08/2025 (substituta P-117).
    - Regra: deck 0 é condição de derrota checada no próximo rule processing (CR 1-2-2, 9-1-2).
    - Efeitos de vitória resolvem durante o processamento do efeito (CR 1-2-5).
    - Ordem: Life checada → efeito "when … deals damage" da Nami → depois o Trigger (Q&A OP03, https://en.onepiece-cardgame.com/pdf/qa_op03.pdf).
18. **Reveal obrigatório.** CR 11-2-1: mover um card de área secreta para área secreta (ex.: "add X from deck to hand") exige revelar, mesmo sem instrução. Life adicionada do deck não pode ser olhada (QA-geral). Para eventos online por webcam, olhar a Life do oponente vira "o oponente revela" (QA-geral). Isso é relevante para o tratamento de informação oculta no simulador.
19. **"If you have" = field.** CR 3-1-2-1 (1.2.1) mais as erratas ST14-014 e OP16-081 ("If there is…"): as condições olham o field, e "there is" inclui o lado do oponente.

---


## Outros simuladores e como automatizam regras

| Simulador | Automação | O que se sabe / comportamentos | Fontes |
|---|---|---|---|
| **OPTCGSim** (Batsu, optcgsim.com; desktop Win/Mac/Linux + Android) | Automatizado, com efeitos scriptados por card. Puxa draw, dano e Life sozinho. | Patch notes com correções por card, por exemplo:<br>• 1.43a (02/09/2026): "Cards that can save themselves from a KO should not go to trash after cancelling that effect until all replacement effects are resolved"; OP11-012 Franky "can break the combat state when procing during Counter events".<br>• 1.40a (02/06/2026): targets com "two different target types" só aceitavam o 1º tipo (EB02-059, OP13-079, OP16-001, P-118…); fixes de Double Attack.<br>• 1.36a (OP15): stages jogados do deck ativavam [On Play] 2×; P-118 Lilith jogava Trigger de qualquer custo; OP13-119 deixava passar de 5 Characters.<br>• 1.37b "QuaBorsa Ban" aplica o banned pair.<br>Não foi confirmado se existe modo manual ou override. | [SNIPPET] https://optcgsim.com/patch-notes/ , …/1-43a-release-op18-first-look/ , …/1-40a-release-target-fixes/ , …/1-36a-release-op15/ ; [COMUNIDADE] https://onepiece.gg/how-to-play-one-piece-card-game-online/ (19/01/2025: "Batsu Apps", decks com todos os cards, ranked via Discord "TCG Matchmaking") |
| **OPlayTCG** (oplaytcg.com, browser/PWA, v1.8.1) | "A deterministic engine models every effect, trigger and keyword" ("rules-accurate"). | Pelo changelog (https://oplaytcg.com/en/changelog):<br>• oferece **replacements de K.O. em cadeia** ("If you decline a K.O. replacement, you are offered the next one you have", ex.: Nami OP17-023 depois de Alvida OP15-003);<br>• efeitos que olham o deck antes de escolher o alvo deixam escolher **depois**;<br>• durações "until opponent's next End Phase" corretas com turnos extras;<br>• alvos "Leader or Character" não pegam Stage;<br>• custo "with a cost of N or more" lê o custo **atual**;<br>• o Trigger é mostrado aos dois jogadores;<br>• dica de Double Attack vs 1 Life;<br>• botão "Replace" quando a área está cheia;<br>• relógio de slow play (4 min/turno, 3 min para responder);<br>• "looking at your deck no longer counts as an empty deck";<br>• legalidade Standard/Extra derivada do Block automaticamente;<br>• Gloriosa EB05-052 ("trash her instead of taking damage") como mecânica nova. | [COMUNIDADE] https://oplaytcg.com/ ; https://oplaytcg.com/en/changelog |
| **Untap.in** | Manual: o jogador move os cards e monta os DON!! | Browser, exige conta | [COMUNIDADE] https://onepiece.gg/how-to-play-one-piece-card-game-online/ |
| **Tabletop Simulator** (mod OPTCG) | Manual ("freely move cards") | Pago na Steam; mod da comunidade | idem |
| **DuelVoyager** (duelvoyager.com) | README não diz se é automatizado | Browser, ranked, torneios, replays | [COMUNIDADE] https://github.com/NoahSullivan25/duelvoyager-one-piece-tcg-simulator |
| **OneSimulator** | não verificado | Citado só em snippet (skillshotzgaming) | [SNIPPET] |
| **TCG Arena** | **Não encontrei fonte** para OPTCG | — | — |
| Engines open-source | — | • **TheCardGoat/tcg-engines** (submódulo one-piece: "deep rules engine", ainda sem simulador público; inclui testes de interações difíceis).<br>• **corycunanan/optcg-sim** ("rules-compliant game simulator with automated effects", dados via vegapull).<br>• **BAA-Studios/MOOgiwara** (MVP ~30%). | https://github.com/TheCardGoat/tcg-engines ; https://github.com/corycunanan/optcg-sim ; https://github.com/BAA-Studios/MOOgiwara |

Lições de design que dá para tirar das fontes [INFERÊNCIA]:
- Replacements opcionais e múltiplos precisam de **prompt sequencial**. Recusar não pode consumir OPT, e o card não deve ir ao trash antes de todos os replacements resolverem (os dois sims tiveram bugs nisso).
- O Trigger deve ser público e resolver antes de "when you take damage".
- A checagem de fim de step (atacante ou alvo saiu do campo) é fonte recorrente de bugs ("combat state").
- Alvos com tipos mistos ("Leader or Character", "Character or Stage") e cópias da mesma carta com OPT também geram bugs recorrentes.

---


## Bases de rulings / dados estruturados

| Recurso | O que oferece | API / formato | Rulings? |
|---|---|---|---|
| **Q&A oficiais** (https://en.onepiece-cardgame.com/rules/faq/) | Q&A geral (`/pdf/qa_rules.pdf`) + um PDF por set (`qa_op01…qa_op17`, `faq_op15-eb04`, `qa_op14_eb04`, `qa_eb01…03`, `qa_prb01/02`, `qa_st-*`, `qa_promotion-cards`) | PDF em tabela (Card No. / Name / Question / Answer). Extrai bem com `pdftotext -layout`; a coluna "Card No." aparece **embaixo** da pergunta. | Sim (fonte canônica) |
| **optcgapi.com** | Card data EN (o site diz OP-01..OP-15 + ST + promos + DON!!) e preços (TCGplayer, histórico de 2 semanas) | REST GET-only, **sem autenticação**, pede uso moderado. Endpoints: `/api/allSets/`, `/api/allSetCards/`, `/api/sets/{set_id}/`, `/api/sets/card/{card_id}/`, `/api/sets/filtered/`, `/api/decks/*`, `/api/promos/*`, `/api/allDonCards/`. Campos: `card_text`, `card_cost`, `card_power`, `counter_amount`, `attribute`, `sub_types`, `life`… Docs: https://optcgapi.com/documentation | **Não** (nem errata nem banlist) |
| **punk-records** (buhbbl) | JSON estático e versionado em 7 idiomas (en, en-asia, jp, zh_hk, zh_tw, th, fr), gerado com vegapull | `<lang>/cards/<pack>.json`, `index/cards_by_id.json`; campos `effect`, `trigger`, `counter`, `types`… | Não | 
| **vegapull / vega** (coko7) | CLI Rust que faz scraping do site oficial (packs, cards, imagens) | `cargo install vegapull`; dataset em coko7/vegapull-records | Não |
| **one-piece-db** (Hermes-AtSeland) | Projeto que pretende importar rules, FAQ, errata e banlist | `data/processed/legality_rules.json` (banned_pairs, block_rules, com source_url/hash) | Parcial / em andamento |
| **Cópias da CR em texto** | 1.2.0 em MD (nobelsmith, TheCardGoat) e **CSV normalizado `id,rule`** (Palhuca: `data/Rules/normalized_rule_comprehensive.csv`) | Arquivos no GitHub | CR apenas |
| **onepiece.limitlesstcg.com** | Card pages (ex.: `/cards/en/OP17-015`, `/cards/P-117`), decks e torneios | **Não verificado** (bloqueado). Não foi confirmado API nem rulings. | não verificado |
| **egmanevents.com** | Conhecido por artigos e rulings da comunidade | **Não verificado** (bloqueado) | não verificado |
| **onepiece.gg** | Espelha notícias oficiais (ban, errata, CR updated); tem página de banlist (https://onepiece.gg/banned-and-restricted-cards/) | HTML | Não (só notícias) |

Recomendação prática [INFERÊNCIA]:
- Para rulings, a única fonte estruturável e confiável são os **PDFs oficiais de Q&A**. Faça parse com `pdftotext -layout` + split pela coluna de card number.
- Para card data multilíngue, use **punk-records/vegapull**. Ambos vêm do site oficial, mas nenhum inclui o português.
- Para banlist, faça scraping de `news/restriction.html` (estrutura `h4` Banned/Restricted/Banned Pair + `ul li a` com `freewords=<cardno>`).
