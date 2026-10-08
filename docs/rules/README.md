# Base de conhecimento de regras

Regras oficiais do One Piece Card Game, interações entre cartas e como o motor do GumGum Fight (`packages/engine`) as implementa. É a referência para automatizar efeitos e para escrever testes.

## Conteúdo

| Arquivo | Para que serve |
|---|---|
| [01-resumo-das-regras.md](01-resumo-das-regras.md) | Resumo em português das Comprehensive Rules (turno, batalha, dano, Trigger, efeitos, custos, ordem de resolução, palavras-chave), com o número de cada seção. |
| [interacoes/](interacoes/README.md) | Catálogo de interações, um arquivo por tema, com a regra, a fonte oficial (link) e cartas de exemplo. |
| [divergencias.md](divergencias.md) | O que o motor faz hoje diferente da regra. Cada item vira um card de correção no Trello. |
| [mapeamento-dsl.md](mapeamento-dsl.md) | Quais primitivas do `parser.ts` / `scripts.ts` / `engine.ts` cobrem cada interação e quais faltam criar. |
| [fontes.md](fontes.md) | Todas as fontes (regras, Q&A por coleção, errata, banidas, comunidade, outros simuladores) e a versão lida. |
| [manutencao.md](manutencao.md) | Como manter esta base atualizada a cada coleção nova. |

## Como usar

- **Antes de automatizar uma carta**: procure o tema em `interacoes/` e o efeito em `mapeamento-dsl.md`. Se a primitiva não existe, ela está listada lá como "falta".
- **Antes de mexer no motor**: confira a regra em `01-resumo-das-regras.md` (com o número da seção) e se o caso já está em `divergencias.md`.
- **Ao escrever testes**: os exemplos de `interacoes/` (carta + pergunta + resposta oficial) são casos de teste prontos. Cite o número da regra ou a fonte no nome do teste.
- **Ao achar uma regra nova ou um ruling**: acrescente no tema certo com o link da fonte, e, se o motor divergir, em `divergencias.md`.

## Hierarquia das fontes

1. Texto da carta (com **errata** aplicada) — vence as regras gerais (CR 1-3-1).
2. Q&A oficial da carta (en.onepiece-cardgame.com, aba Rules → Q&A).
3. Comprehensive Rules (versão mais recente).
4. Q&A geral de regras (`qa_rules.pdf`).
5. Rulings de juízes e da comunidade — só quando não há resposta oficial; sempre marcados como "comunidade".
6. Comportamento de outros simuladores — só como referência de UX, nunca como regra.

Versão lida nesta base: **Comprehensive Rules v1.2.1 (28/08/2026)**, Tournament Rules Manual de 17/10/2025 e Q&A oficiais baixados em 07/10/2026 (ver [fontes.md](fontes.md)).
