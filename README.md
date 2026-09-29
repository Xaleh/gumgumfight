# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status: Fase 1, protótipo solo.** Dois decks iniciais (Luffy vermelho ST01 e Kid verde ST02), partidas
> contra um bot, modo demonstração bot x bot e replays. Os dados das cartas ainda são **provisórios**
> (veja [Dados das cartas](#dados-das-cartas)).

## Requisitos

- Node.js 22.13 ou mais recente (recomendado: a LTS atual)
- Nenhum serviço externo nem módulo nativo: o banco é um arquivo SQLite local, usando o SQLite embutido no Node (`node:sqlite`)

## Rodando em desenvolvimento

```bash
npm install
npm run dev
```

- Interface: http://localhost:5173 (Vite, com recarga automática)
- API: http://localhost:3001 (Fastify + SQLite)

Na primeira execução o servidor cria o banco `apps/server/var/gumgum.db` e carrega as cartas e os decks de `data/`.
O Vite só sobe depois que a API responde em `/api/health`.

### Problemas comuns

- **`http proxy error ... ECONNREFUSED`**: a API (porta 3001) não está no ar. Procure no terminal as linhas `[server]`,
  que mostram o motivo real.
- **`No such built-in module: node:sqlite`**: o Node é antigo demais. Atualize para 22.13+.
- **`ExperimentalWarning: SQLite is an experimental feature`**: aviso do Node 22, pode ser ignorado.
- **`A porta 3001 já está em uso`**: outro processo está usando a porta (por exemplo, um `npm run dev` antigo).

## Rodando no seu servidor (produção)

```bash
npm ci
npm run build          # compila a interface em apps/web/dist
PORT=3001 npm start    # o servidor entrega a API e a interface na mesma porta
```

Variáveis de ambiente:

| Variável  | Padrão                        | Descrição                    |
|-----------|-------------------------------|------------------------------|
| `PORT`    | `3001`                        | Porta HTTP                   |
| `HOST`    | `0.0.0.0`                     | Interface de rede            |
| `DB_PATH` | `apps/server/var/gumgum.db`   | Caminho do arquivo SQLite    |

Para manter o processo rodando, use o gerenciador que preferir, por exemplo o **pm2**
(`pm2 start npm --name gumgum -- start`) ou um serviço **systemd**. Com um domínio, coloque um Nginx/Caddy na
frente fazendo proxy para a porta 3001. O **backup** é só copiar o arquivo `.db`.

## Como jogar

- **Mulligan:** no início, mantenha ou troque a mão (uma vez).
- **Jogar carta:** clique duplo numa carta destacada em verde na mão, ou selecione e use o painel "Ações".
- **DON!!:** clique na área de DON!! e depois no líder/personagem para anexar (+1000 de poder no seu turno).
- **Atacar:** selecione o líder ou um personagem ativo, clique em "⚔ Atacar" e escolha o alvo (líder ou personagem virado).
- **Defesa:** quando for atacado, o jogo pede Blocker, Counter e [Trigger] quando aplicável.
- **Desfazer** volta para antes da sua última ação. **Replay** baixa um `.json` com todas as ações.
- A **seed** controla o embaralhamento: a mesma seed com as mesmas jogadas reproduz a mesma partida. Um replay
  carregado no menu funciona como um "roteiro" que se joga sozinho.

## Estrutura

```
packages/engine   Motor de regras em TypeScript puro (sem dependências), bot e testes
apps/server       API Fastify + SQLite (node:sqlite); serve a interface compilada em produção
apps/web          Interface React + Vite
data/cards        Cartas provisórias (JSON)
data/decks        Listas dos decks
```

### Motor de regras (`packages/engine`)

- `applyAction(estado, ação) → novo estado`: função pura. O estado é JSON serializável e o RNG tem seed,
  então partidas são determinísticas e reproduzíveis.
- Efeitos, batalhas e dano são *frames* numa pilha. Quando um jogador precisa decidir algo (alvo, bloqueio,
  counter, trigger), o motor para em `state.pending` até a próxima ação.
- `legalActions(estado, jogador)` lista as ações possíveis (usada pela interface e pelo bot).
- Os efeitos das cartas são **dados**, escritos com uma DSL em `src/cards/scripts.ts`:

```ts
'ST01-015': { // Gum-Gum Jet Pistol
  abilities: [
    { timing: 'main', steps: [{ do: 'ko', target: { side: 'opponent', kinds: ['character'], upTo: 1, maxPower: 6000 } }] },
    { timing: 'trigger', steps: [{ do: 'useMainEffect' }] },
  ],
},
```

Como o motor é independente da interface, o mesmo código vai rodar no servidor quando entrar o multiplayer
online, com o servidor como autoridade para esconder mão e deck.

### Regras implementadas

- Preparação: deck de 50, 10 DON!!, 5 cartas na mão, mulligan, Vida conforme o líder
- Fases: Refresh (DON!! anexados voltam e tudo desvira), Draw (o primeiro jogador não compra no turno 1),
  DON!! (+2, ou +1 no primeiro turno), Main, End
- Ninguém ataca no próprio primeiro turno; personagens só atacam no turno seguinte, exceto com [Rush]
- Batalha: When Attacking, Blocker, Counter (personagens e eventos [Counter]), dano, [Trigger], K.O.
- Palavras-chave: Rush, Blocker, Double Attack, Banish, [DON!! xN], [Once Per Turn], [Activate: Main], [On Play]
- Limite de 5 personagens (substituição), Stage único
- Derrota: dano sem Vida, ou deck vazio

Ainda **não** implementado: [On K.O.] com escolhas complexas, efeitos de substituição, [End of Your Turn],
custos DON!! −X em cartas reais, cartas com efeitos fora da DSL (aparecem com o aviso "efeito ainda não automatizado").

## Dados das cartas

Os arquivos em `data/cards` foram **reconstruídos de memória** só para testar a interface. Números e textos
(principalmente do ST02) podem estar errados. Quando a API de cartas for definida:

```bash
CARD_API_URL="https://sua-api/cards" npm run cards:import
# opcional: CARD_API_KEY="..." (enviado no cabeçalho x-api-key)
```

O importador (`apps/server/src/import-cards.ts`) grava as cartas no SQLite marcadas como não provisórias.
Dados provisórios nunca sobrescrevem dados vindos da API. A função `mapApiCard` tenta reconhecer os nomes
de campo mais comuns; ajuste-a ao formato real da API. Depois da importação, os scripts de efeito em
`packages/engine/src/cards/scripts.ts` precisam ser conferidos contra o texto oficial.

## Testes

```bash
npm test                                   # regras + 200 partidas bot x bot verificando invariantes
npm run simulate -w @gumgum/engine -- 500  # estatísticas de N partidas bot x bot
npm run typecheck
```

## API

| Método | Rota               | Descrição                                   |
|--------|--------------------|---------------------------------------------|
| GET    | `/api/health`      | Verificação de saúde                        |
| GET    | `/api/cards?set=`  | Lista cartas (opcionalmente por coleção)    |
| GET    | `/api/cards/:id`   | Uma carta                                   |
| GET    | `/api/decks`       | Lista decks                                 |
| GET    | `/api/decks/:id`   | Deck + definições das cartas usadas         |
| POST   | `/api/matches`     | Registra o resultado de uma partida         |
| GET    | `/api/matches`     | Últimas partidas                            |

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
