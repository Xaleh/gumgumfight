# Sala do Tempo: presets dos eventos

Cada arquivo `<id>.json` desta pasta é um **evento simulável** na Sala do Tempo (`docs/plano-sala-do-tempo.md`): um
torneio do Time em que as vagas que os humanos não ocupam são preenchidas por jogadores virtuais, sorteados pela
distribuição de Líderes do evento real. A lista aparece para quem é do Time em Torneios → Sala do Tempo; os arquivos são
relidos a cada consulta (editar e salvar basta, sem reiniciar).

| Campo | O que é |
|---|---|
| `name`, `description` | Nome e descrição do evento (a descrição aparece na página do torneio) |
| `format`, `spoilers` | Formato das listas (`standard`, `egb`, `free`) e se aceita cartas de spoiler da próxima coleção |
| `players` | Jogadores do evento (humanos + virtuais); quem abre a sala pode mudar |
| `rounds`, `topCut`, `bo3From`, `bo5From` | Rodadas do suíço (vazio = pelo número de jogadores), top cut e a partir de que fase a eliminatória é melhor de 3/5; sugestões, quem abre a sala pode mudar |
| `leaders[]` | `leader` (id da carta), `share` (fração dos jogadores, 0..1) e, opcional, `deck` (id de um deck pronto que o bot joga por ele) |
| `matchups` | Opcional: `{ "OP17-039": { "OP17-020": 0.52 } }` = o Xebec vence 52% contra o Shanks Verde (o inverso vale ao contrário; sem o par, 50%) |

**Qual deck o bot joga por cada Líder:** o `deck` do preset, senão o primeiro deck de `data/decks/meta/` com o Líder (o
que tem guia e perfil do Bot do Time), senão qualquer deck pronto com o Líder. Líder sem nenhum deck pronto válido no
formato vira "outros". A soma dos `share` pode ficar abaixo de 1: o resto (e os Líderes sem deck) sorteia entre todos
os decks prontos válidos no formato. A página do torneio mostra, por Líder, que deck o bot usa e se ele é do meta.

**Como as mesas virtuais são decididas:** chance de vitória = sigmoide(logit(matchup) + 0,6 × (força A − força B)), com a
força de cada virtual sorteada numa normal padrão no início. Humano x virtual é jogo de verdade contra o Bot do Time.

O preset `regional-op17-eb05.json` traz uma distribuição **provisória**: troque as fatias pelos números do evento real.
