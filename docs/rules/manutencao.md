# Como manter a base atualizada

A Bandai publica regras novas em quatro lugares (mais a conferência dos dados da fonte de cartas). Cada um tem um gatilho, um responsável e um destino nesta pasta.

| O que muda | Onde sai | Quando olhar | O que atualizar |
|---|---|---|---|
| **Comprehensive Rules** (nova versão) | <https://en.onepiece-cardgame.com/rules/> → "Comprehensive Rules" (o link do PDF tem a data: `rule_comprehensive.pdf?AAAAMMDD`) | A cada coleção nova e quando sair aviso de "rule revision" em News | `01-resumo-das-regras.md` (versão e data no topo; seções que mudaram), `fontes.md`, e conferir `divergencias.md` |
| **Q&A da coleção** | <https://en.onepiece-cardgame.com/rules/faq/> (`qa_opXX.pdf`, `qa_ebXX.pdf`, `qa_st-XX.pdf`) | Na semana de lançamento da coleção e de novo ~1 mês depois (a Bandai acrescenta perguntas) | O tema certo em `interacoes/` (só as respostas que definem interação nova ou contra-intuitiva) e um teste em `packages/engine/test` |
| **Errata** | <https://en.onepiece-cardgame.com/rules/errata_card/> e avisos em News/Topics ("Apology for the errata…") | Quando sair aviso em News | Uma entrada em `packages/engine/src/errata.ts` (trecho antigo → novo, data e link), só se a optcgapi ainda trouxer o texto antigo; conferir que o leitor (`parser.ts`) e a tradução (`i18n/pt.ts`) entendem a redação nova; rodar `npm test` |
| **Nomes e tipos da fonte de cartas** (optcgapi) | Lista oficial: <https://en.onepiece-cardgame.com/cardlist/> | A cada coleção nova, depois de importar | Rodar `npm run cards:check-official -w @gumgum/server`: mostra as cartas em que a API difere da lista oficial e imprime as entradas para `packages/engine/src/source-fixes.ts` (conferir antes de colar) e as correções que já não são necessárias |
| **Banidas e restritas** | News → "Banned/Restricted Card" (ex.: `news/restriction-261001.html`) | Quando sair aviso (normalmente alguns por ano, com data de início) | `packages/engine/src/formats.ts` (`BANNED_CARDS`, `BANNED_PAIRS`, campo `since`) e `fontes.md` |
| **Rotação do Standard** | News → "Block Icon" | Uma vez por ano (abril) | `formats.ts` (`BLOCK_1_SET`, exceções) |

## Rotina por coleção nova

Responsável: quem abrir o card da coleção no Trello (ex.: "Automação das cartas da OP-19"). O card de coleção só fecha quando estes itens estiverem feitos.

1. Baixar o `qa_<coleção>.pdf` e ler todas as perguntas.
2. Para cada resposta que muda o jeito de automatizar (substituição, momento de ativação, alvo, custo, "if/then"), anotar em `interacoes/<tema>.md` com o número da carta e o link.
3. Conferir se o leitor (`parser.ts`) e os scripts (`scripts.ts`) fazem o que o Q&A diz; o que não fizer vira item em `divergencias.md` e card no Trello com o texto oficial, o comportamento atual e a resposta oficial.
4. Ver se a coleção trouxe **palavra-chave nova** ou **mecânica nova** (ex.: Vida virada para cima, DON!! −X, "set power to 0"); se sim, acrescentar no resumo e em `mapeamento-dsl.md` (com "falta" se o motor não tiver).
5. Conferir se saiu nova versão das Comprehensive Rules junto com a coleção (comparar a data do link).

## Rotina mensal (curta)

- Abrir a página de regras e comparar as datas dos links de `rule_comprehensive.pdf`, `tournament_rules_manual.pdf` e dos `qa_*.pdf` com as de [fontes.md](fontes.md). Data diferente = arquivo novo para ler.
- Olhar News por banidas/errata.

Para comparar rápido as datas dos PDFs:

```sh
curl -sSL https://en.onepiece-cardgame.com/rules/ | grep -oE '/pdf/rule_[a-z_]+\.pdf\?[0-9]+'
curl -sSL https://en.onepiece-cardgame.com/rules/faq/ | grep -oE '/pdf/(qa|faq)_[^"]+\.pdf\?[0-9]+'
```

## Regras de escrita

- Português, com as palavras-chave das cartas em inglês como impressas.
- Toda regra com **fonte**: número da seção das Comprehensive Rules, ou link do PDF de Q&A com o número da carta.
- Ruling da comunidade sempre marcado como **(comunidade)**, com link, e só quando não houver resposta oficial.
- Divergência do motor sempre com: regra, comportamento atual (com `arquivo:linha`), comportamento correto, cenário que mostra a diferença.
