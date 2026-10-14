# Estudo: artes alternativas

Card do Trello: "Estudo de impacto e viabilidade de artes alternativas" (lista Planejamento).
Levantamento feito em 14/10/2026 com as respostas de `allSetCards`, `allSTCards` e
`allPromos` da optcgapi.com.

## Recomendação

**Fazer**, com prioridade média, em duas entregas:

1. **Artes alternativas** (dados, importador, deck, mesa e construtor): cerca de **4 a 5 dias**.
   Os dados já chegam no importador e hoje são descartados. O modelo proposto não muda o
   número da carta nem o hash de estatísticas, e não abre vazamento de informação na partida
   online.
2. **Imagens leves** (cópia própria em WebP reduzido): cerca de **1,5 a 2 dias**. Não é
   obrigatória para a entrega 1, mas resolve um problema que já existe com as artes normais
   (cerca de 1 em cada 10 imagens tem mais de 1 MB) e corta o tráfego no celular em 80 a 90%.

As artes não devem virar benefício pago de apoiador: são artes da Bandai, e cobrar por elas
num projeto de fã aumenta o risco legal.

## 1. Fonte: a optcgapi tem as artes?

Tem, e o importador já recebe todas. Cada impressão vem numa linha própria com o mesmo
`card_set_id` (ex.: `OP01-016`). O que muda entre as linhas é `card_image_id`, `card_image` e o
sufixo do nome. Hoje `mergeEntries` (`apps/server/src/optcgapi.ts`) junta as linhas numa carta só
e fica só com a imagem da impressão original.

| Sufixo do `card_image_id` | Linhas | O que é |
| --- | ---: | --- |
| (sem sufixo) | 3.213 | impressão original; nas promos, às vezes a reimpressão com imagem `*_img.jpg` |
| `_p1` … `_p9` | 1.173 | Parallel, Alternate Art, SP, Manga, Wanted Poster, Gold, assinatura |
| `_pr1` … `_pr12` | 596 | promocionais (Tournament Pack, Winner Pack, Gift Collection, aniversários…) |
| `_r1` … `_r3` | 380 | reimpressões (Premium Booster, starter decks); quase sempre a **mesma arte** |

Detalhes que o importador terá de tratar:

- `card_image_id` **não é único**: promos repetem o número sem sufixo (`OP01-016` "Alternate
  Art", em `allPromos`). A chave da arte tem de ser a URL da imagem, não o `card_image_id`.
- **138 linhas sem imagem** (`card_image` nulo): ignorar.
- Reimpressões `_r*`: comparando OP01-006 com OP01-006_r1 e OP02-004 com OP02-004_r1 reduzidas a
  60×84, a diferença média por pixel ficou em 7 e 12 (de 255). É a mesma ilustração com outro
  selo ou borda, então ficam fora da escolha.
- O rótulo da arte sai do sufixo do nome, que hoje `cleanName` só remove: "(Parallel)",
  "(Alternate Art)", "(SP)", "(Manga)", "(Wanted Poster)", ou o produto da promo
  ("(Winner Pack Vol. 5)").
- Cartas de spoiler (`spoiler-feed.ts`) não têm artes alternativas até a API publicar a carta.

## 2. Quantas cartas, quanto pesa

| | Quantidade |
| --- | ---: |
| Cartas distintas (número sem sufixo) | 2.799 |
| Cartas com mais de uma imagem | 1.134 (41%) |
| Imagens além da original | 2.434 |
| Imagens distintas no total | 5.224 |
| Líderes com arte alternativa | 130 de 146 |

Por tipo, entre as cartas com mais de uma imagem: 824 Personagens, 125 Líderes, 93 Eventos e
10 Stages.

Tamanho das imagens (cabeçalho `Content-Length`; amostras aleatórias de 300 alternativas e 100
originais):

| | Mediana | Média | p90 | Máximo | > 1 MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Originais | 199 KB | 361 KB | 1.448 KB | 1.979 KB | 11% |
| Alternativas | 197 KB | 299 KB | 269 KB | 2.197 KB | 8% |

- Por imagem, as artes alternativas **não pesam mais** que as originais. O problema de peso já
  existe hoje: as coleções mais novas vêm em resolução maior (ex.: OP07-040_p3 tem 868×1213 e
  1,9 MB).
- Os arquivos são **PNG servidos como `.jpg`** (`content-type: image/jpeg`), com 600×838 ou mais.
- A optcgapi não manda `Cache-Control`, só `ETag` e `Last-Modified`. O navegador guarda por
  heurística, e o service worker (`apps/web/src/service-worker.js`) não guarda imagens de outro
  domínio.
- Somando as 5.224 imagens com a média medida, um espelho completo ocuparia cerca de 1,7 GB no
  formato atual. Em WebP de 300 px de largura, ficaria em torno de 130 MB.

Teste de conversão para WebP (qualidade 80):

| Imagem | Original | WebP 600 px | WebP 300 px |
| --- | ---: | ---: | ---: |
| OP01-016 | 181 KB | 55 KB | 19 KB |
| OP01-016_p1 | 235 KB | 108 KB | 31 KB |
| OP07-040_p3 | 1.939 KB | 97 KB | 28 KB |

**Impacto no celular**: uma partida mostra em torno de 25 a 35 cartas diferentes (dois decks).
Com as imagens atuais, isso dá de 5 a 10 MB, e passa disso quando várias cartas são das
coleções em alta resolução. Escolher artes alternativas não muda essa conta de forma relevante.
O que muda é mostrar a arte do oponente: a mesa passa a baixar imagens que o jogador nunca viu
e que não estão no cache. A entrega 2 é o que tira esse peso.

## 3. Modelo de dados (sem mudar o número da carta)

```ts
// packages/engine/src/types.ts
interface CardArt {
  key: string;      // "p1", "pr3"… ou um hash curto da URL quando o card_image_id se repete
  imageUrl: string;
  label: string;    // "Parallel", "Manga", "Winner Pack Vol. 5"…
}
interface CardData {
  // …
  imageUrl?: string;      // continua sendo a arte padrão
  arts?: CardArt[];       // só as alternativas; ausente = só a padrão
}
interface DeckList {
  // …
  arts?: Record<string, string>;   // número da carta -> key da arte escolhida
}
interface CardInstance {
  uid: string;
  cardId: string;
  owner: PlayerId;
  art?: string;                    // key da arte; só apresentação, as regras ignoram
}
```

Decisões:

- **Uma arte por carta no deck**, não por cópia: as 4 cópias de OP01-016 usam a mesma arte. Cobre
  o uso real e mantém `cards: [{ id, count }]` como está.
- `arts` fica **fora de `cards`**. `deckHash` (`apps/server/src/stats/derive.ts`) usa só `leader`
  e `cards`, então trocar a arte não cria outro deck nas estatísticas. `normalizeDeckIds` e
  `migrateCardIds` (`db.ts`) continuam valendo.
- **Banco**: `cards.data` já é o JSON de `CardData`, então `arts` entra sem migração. A tabela
  `decks` ganha uma coluna `arts TEXT` (JSON), adicionada com `ALTER TABLE` como as outras.
  Inscrições de torneio (`tournament_players.deck`) e partidas (`matches.deck0/deck1`) já guardam o
  `DeckList` em JSON, então levam `arts` sem mudança de esquema, e os replays mostram as artes de
  graça.
- **Validação no servidor**: uma key que não existe (carta reimportada, arte removida) é
  descartada em silêncio e a carta volta para a arte padrão. Nunca deve impedir a partida.
- **Na partida**: `createGame` preenche `CardInstance.art` a partir de `setup.deck.arts`, e
  `viewFor` (`packages/engine/src/view.ts`) copia `art` só para as cartas visíveis. Cartas
  escondidas continuam sendo `HIDDEN_CARD` sem `art`, então a arte **não revela** o que está na
  mão ou no deck do oponente. Um mapa `arts` por jogador mandado no início da partida revelaria a
  lista do deck, por isso a arte vai na instância.
- `CARD_IMAGES=off`: `presentCards` (`present.ts`) tem de apagar `arts` junto com `imageUrl`.

## 4. Interface

**Construtor de decks** (`apps/web/src/components/DeckBuilder.tsx`):

- Na linha da carta no deck, um ícone de pincel aparece quando a carta tem `arts`. Ele abre um
  seletor com as miniaturas (padrão + alternativas), cada uma com o rótulo.
- No detalhe da carta (pré-visualização ao passar o mouse ou tocar), as setas ‹ › trocam a arte
  mostrada, e o botão "Usar esta arte" grava a escolha.
- A miniatura da lista e a do Líder no topo do construtor usam a arte escolhida.
- A lista em texto (importar/exportar) continua sem artes: é o formato de troca com outros sites.

```
┌──────────── Nami · OP01-016 ────────────┐
│  [padrão] [Parallel] [SP] [Manga] [Gift…]│
│     ▲ selecionada                        │
│                         [Usar esta arte] │
└──────────────────────────────────────────┘
```

**Mesa**: `CardView`, `Board` (`--face`), `CardInfo`, `GameResult` e `LeaderArt` (fila, lobby,
torneio) passam a resolver a imagem por uma função só, `cardImage(def, art)`, que devolve a URL
da arte escolhida ou a padrão.

**O oponente vê a arte?** Sim, por padrão (é o que dá sentido à escolha, como nos simuladores
conhecidos). Uma opção nas configurações, "Mostrar artes alternativas do oponente", desligada
mostra a arte padrão e economiza dados no celular. Espectadores e transmissões seguem a mesma
opção.

## 5. Esforço

| Parte | O que entra | Dias |
| --- | --- | ---: |
| Importador | coletar `arts` em `mergeEntries` (dedupe por URL, sem `_r*`, sem imagem nula, rótulo pelo sufixo do nome) + testes em `apps/server/test` | 1 |
| Dados e servidor | `DeckList.arts`, coluna `decks.arts`, validação, rotas de deck, fila online, torneio, `CARD_IMAGES` | 1 |
| Motor e mesa | `CardInstance.art`, `createGame`, `viewFor`, `cardImage()` em todos os pontos de imagem, opção de esconder a arte do oponente | 1 |
| Construtor | seletor de arte, miniaturas, persistência, textos nas 6 línguas | 1 a 1,5 |
| Revisão e ajustes | teste no celular, replay, transmissão | 0,5 |
| **Entrega 1** | | **4,5 a 5** |
| Entrega 2 (opcional) | rota no servidor que baixa da optcgapi, converte para WebP (300 e 600 px), guarda em disco com `Cache-Control: immutable`; `imageUrl` passa a apontar para ela | 1,5 a 2 |

Riscos:

- A optcgapi muda nomes e sufixos sem aviso. Com a chave pela URL e o fallback para a arte
  padrão, o pior caso é perder a escolha, não a partida.
- Algumas promos vêm sem imagem ou com imagem quebrada. O `onError` de `CardView` já cai para a
  carta desenhada, e o seletor deve esconder as artes que não carregam.
- Tráfego na optcgapi: mostrar a arte do oponente faz cada partida baixar imagens novas direto do
  servidor deles. A entrega 2 também reduz essa carga.
