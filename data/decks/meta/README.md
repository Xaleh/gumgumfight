# Decks do meta (Bot do Time)

Cada deck desta pasta é um deck pronto do grupo **"Decks do meta"** (coluna `deck_group = 'meta'` na tabela
`decks`), carregado a cada início do servidor como os Starter Decks de `data/decks/`. É com estes decks que o
**Bot do Time** (nível `team`, `docs/plano-bot-time.md`) joga por padrão.

Por deck, três arquivos com o mesmo nome:

| Arquivo | O que é | Quem escreve |
|---|---|---|
| `<id>.json` | A lista (`DeckList`: `id`, `name`, `leader`, `cards`), como os Starter Decks | o Time, a partir do guia |
| `<id>.md` | O **guia** do deck em prosa: plano de jogo, mulligan, cartas-chave, matchups | o Time |
| `<id>.profile.json` | O **perfil** do deck que o bot lê (`DeckProfile`, `packages/engine/src/bot/profile.ts`): arquétipo, curva, mulligan, papéis das cartas, pesos e matchups | gerado do guia pelo agente (`npm run bot:agent -w @gumgum/server -- profile <id>`) e revisado pelo Time |

Só o `.json` entra no banco; o guia e o perfil são lidos do disco pelo servidor (aba "Bot do Time" da
Administração e o planejador do bot). Deck sem perfil joga com os pesos padrão do `hard`.

As listas aqui são **pontos de partida**: substitua pela lista do guia quando ele chegar.
