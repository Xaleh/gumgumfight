# GumGum Fight

Simulador de **One Piece Card Game** no navegador, inspirado no [Duels.ink](https://duels.ink/) (Lorcana).

> **Status: Fase 1, protótipo solo.** Dois decks iniciais (Luffy vermelho ST01 e Kid verde ST02), partidas
> contra um bot, modo demonstração bot x bot e replays. Cartas importadas da [optcgapi.com](https://optcgapi.com/documentation),
> com textos em português (tradução automática) ou inglês e imagens opcionais.

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
| `CARD_IMAGES` | `on`                      | `off` desliga as imagens oficiais das cartas (as URLs nem chegam ao navegador) |
| `CARD_API_BASE` | `https://optcgapi.com/api` | Endereço da API usada pelo importador |

Para manter o processo rodando, use o gerenciador que preferir, por exemplo o **pm2**
(`pm2 start npm --name gumgum -- start`) ou um serviço **systemd**. Com um domínio, coloque um Nginx/Caddy na
frente fazendo proxy para a porta 3001. O **backup** é só copiar o arquivo `.db`.

## Montando decks

No menu, **Montar / editar decks** abre o construtor:

1. **Novo deck** → escolha o Líder (o catálogo mostra só Líderes até você escolher um).
2. Clique nas cartas para adicionar e use o botão direito (ou os botões −/+ na lista) para remover. Por padrão
   aparecem só cartas com a cor do Líder. Dá para filtrar por nome/texto, cor, tipo, custo e coleção.
3. O painel à direita mostra o total, a curva de custo, os Counters e os problemas do deck. **Salvar** grava
   no banco. Decks incompletos ficam salvos como rascunho e aparecem desabilitados no menu.

Regras verificadas: 1 Líder, exatamente 50 cartas, no máximo 4 cópias por número e toda carta com ao menos uma
cor do Líder. Cartas cujo efeito ainda não é automatizado aparecem com ⚙: elas entram no jogo, mas sem o efeito.
Decks prontos (`data/decks`) não são alterados: ao mexer em um, o construtor cria uma cópia.
**Exportar/Importar lista** usa o formato de texto da comunidade (`4xOP01-016`, uma carta por linha).

## Como jogar

- **Mulligan:** no início, mantenha ou troque a mão (uma vez).
- **Jogar carta:** clique duplo numa carta destacada em verde na mão, ou selecione e use o painel "Ações".
- **DON!!:** clique na área de DON!! e depois no líder/personagem para anexar (+1000 de poder no seu turno).
- **Atacar:** selecione o líder ou um personagem ativo, clique em "⚔ Atacar" e escolha o alvo (líder ou personagem virado).
- **Defesa:** quando for atacado, o jogo pede Blocker, Counter e [Trigger] quando aplicável.
- **Desfazer** volta para antes da sua última ação. **Replay** baixa um `.json` com todas as ações.
- Em **Opções de teste** (no menu), a **seed** controla o embaralhamento: a mesma seed com as mesmas jogadas
  reproduz a mesma partida. Um replay carregado ali funciona como um "roteiro" que se joga sozinho.

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

As cartas vêm da [optcgapi.com](https://optcgapi.com/documentation) e ficam salvas no SQLite local. O jogo não
consulta a API durante as partidas.

```bash
npm run cards:import                      # ST-01 e ST-02 (os decks de teste)
npm run cards:import -- ST-03 OP-01       # coleções específicas (ST-xx = starter deck, OP/EB/PRB = boosters)
npm run cards:import -- --all             # tudo
npm run cards:import -- --dry-run ST-01   # mostra o resultado sem gravar
npm run cards:import -- --file resp.json  # importa uma resposta da API salva em arquivo (sem rede)
```

- Versões com arte alternativa (mesmo ID) são unificadas; cartas DON!! são ignoradas.
- A resposta original de cada carta fica guardada (coluna `raw`) para poder remapear sem baixar de novo.
- Antes da primeira importação, o jogo usa dados **provisórios** de `data/cards` (escritos de memória). Eles nunca
  sobrescrevem cartas vindas da API.
- Os scripts de efeito (`packages/engine/src/cards/scripts.ts`) precisam ser conferidos contra o texto oficial.

### Imagens

Com `CARD_IMAGES=on` (padrão), o navegador carrega as imagens direto das URLs informadas pela API, e cada jogador
pode desligá-las nas configurações. Com `CARD_IMAGES=off`, o servidor remove as URLs de todas as respostas e o
jogo usa só as cartas desenhadas em HTML (nome, custo, poder, texto). Se uma imagem falhar ao carregar, a carta
desenhada é usada automaticamente.

### Textos em português

Cada jogador escolhe "Português" ou "English" no menu ou durante a partida (a escolha fica salva no navegador).

- **Tradução automática:** feita por regras em `packages/engine/src/i18n/pt.ts`. Os textos do jogo seguem modelos
  fixos, então a maior parte é traduzida sem serviço externo. Trechos não reconhecidos ficam em inglês e a carta é
  marcada como "tradução parcial". O painel da carta sempre tem o link "ver original".
- **Traduções revisadas:** `data/translations/pt.json` (`{ "cards": { "OP01-001": { "text": "...", "trigger": "..." } } }`)
  tem prioridade sobre a automática. `GET /api/translations/pending` lista as cartas com tradução parcial, para revisão.
- Nomes de cartas, tipos ({Straw Hat Crew}) e palavras-chave (Rush, Blocker, Counter, Trigger...) ficam no original,
  como nas cartas físicas.

## Testes

```bash
npm test                                   # regras, tradução, importador, API e 200 partidas bot x bot
npm run simulate -w @gumgum/engine -- 500  # estatísticas de N partidas bot x bot
npm run typecheck
```

## API

| Método | Rota               | Descrição                                   |
|--------|--------------------|---------------------------------------------|
| GET    | `/api/health`      | Verificação de saúde                        |
| GET    | `/api/config`      | Configurações públicas (imagens ligadas?)   |
| GET    | `/api/cards?set=`  | Lista cartas (opcionalmente por coleção)    |
| GET    | `/api/cards/:id`   | Uma carta                                   |
| GET    | `/api/decks`       | Lista decks, com validação                  |
| GET    | `/api/decks/:id`   | Deck + definições das cartas usadas         |
| POST   | `/api/decks`       | Cria um deck (`{ name, leader, cards }`)    |
| PUT    | `/api/decks/:id`   | Atualiza um deck do jogador                 |
| DELETE | `/api/decks/:id`   | Apaga um deck do jogador                    |
| POST   | `/api/matches`     | Registra o resultado de uma partida         |
| GET    | `/api/matches`     | Últimas partidas                            |
| GET    | `/api/translations/pending` | Cartas com tradução automática parcial |

## Aviso

Projeto de fã, sem fins lucrativos e sem vínculo com Bandai, Toei Animation ou Shueisha. One Piece e
One Piece Card Game são marcas de seus respectivos donos.
