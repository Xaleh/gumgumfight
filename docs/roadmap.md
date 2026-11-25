# Roadmap do GumGum Fight

Lista do que queremos construir, em ordem. Cada item tem um ID (fase + número, ex.: `B1`), uma caixa que é marcada
quando o item fica pronto e o campo **Feito em**, com a data e o link do PR.

- Para implementar, abra uma sessão do Claude Code e use o texto da seção [Como pedir um item](#como-pedir-um-item).
- Com `PRÓXIMO`, a sessão pega o **primeiro item ainda `[ ]`, na ordem das fases** (A antes de B, B1 antes de B2).
  Para fazer outro antes, troque `PRÓXIMO` pelo ID.
- Item grande (marcado com 🧱) vira um `docs/plano-<nome>.md` com fases próprias. Cada PR entrega uma fase, e o item
  só ganha `[x]` quando a última fase fica pronta. Até lá, as fases concluídas são anotadas numa linha **Progresso** do item (logo acima do **Feito em**).
- A ordem pode mudar a qualquer momento: é só mover o item (e trocar o ID, se mudar de fase) neste arquivo.
- Cada item também é um card no Trello (quadro **GumGum Fight**, lista **Planejamento**), com o ID no início do
  título. A sessão move o card para **Em execução** e **Em teste/Validação**; **Concluído** fica com o dono do
  projeto, depois do merge. Se um item mudar de ID aqui, renomeie o card também.

## Regras para todo item

1. **Regras de jogo no motor.** Tudo que decide jogo (validação, efeitos, cálculo de letal, avaliação de jogada) fica em
   `packages/engine`, em TypeScript puro, sem dependências. A interface e o servidor só chamam o motor.
2. **O servidor é a autoridade.** O cliente nunca decide resultado, sorteio, embaralhamento nem recompensa. Ações
   vindas do navegador são validadas no servidor.
3. **Nenhuma informação escondida vaza.** Mão, deck, Vida virada e cartas do oponente só chegam a quem pode vê-las
   (`view.ts`). Isso vale para o espectador, o replay de partida em andamento, as análises, as rotas novas e o bot,
   que só usa o que um jogador veria (ou deduz, como em D2, sem espiar).
4. **Seis idiomas.** Todo texto novo da interface entra em `apps/web/src/i18n/` em pt-BR, en, es, ja, fr e de, com as
   mesmas chaves do pt-BR. Nomes de cartas e termos do jogo (DON!!, Blocker, Rush, Counter, Trigger, K.O.) não se traduzem.
5. **Reaproveite antes de criar.** Confira se já existe algo parecido (motor, `bot/`, `stats/`, `recap/`, `push/`,
   `tournaments/`, `team/`) e estenda em vez de duplicar.
6. **Banco.** Tabela ou coluna nova entra pela migração do `apps/server/src/db.ts` e é descrita na seção 7 da
   [documentação técnica](documentacao-tecnica.md). Nada de apagar dados existentes sem migração.
7. **Testes.** Todo item traz testes (motor, servidor e, quando houver interface, os testes do web ou E2E depois de A1).
   `npm run typecheck` e `npm test` têm que passar.
8. **Documentação.** O README descreve o que passou a existir. A documentação técnica é atualizada quando mudam banco,
   rotas ou arquitetura.
9. **Celular primeiro.** Telas novas funcionam no celular (incluindo o Safari do iPhone) e no desktop.
10. **Arte e marca.** Nada de material da Bandai ou da Toei fora das imagens das cartas que o projeto já usa. Cosméticos
    e artes geradas são originais.
11. **Produção.** O PR vai para a `main`, mas o merge na `main` publica em produção e fica com o dono do projeto.
    Para testar antes, publique a branch na homologação pelo workflow **CI e deploy** (Run workflow).

## Fase A — Base para evoluir com segurança

Antes das funções novas: uma rede de testes, visibilidade do que quebra em produção e arquivos menores para trabalhar
em várias branches ao mesmo tempo.

- [ ] **A1. Testes de ponta a ponta no navegador (Playwright)** 🧱
  Fluxos principais rodando num navegador de verdade: fila → partida → fim; partida contra o bot; criar e jogar um
  torneio; abrir boosters (também com a emulação do Safari do iPhone, onde já houve bug).
  *Pronto quando:* existe `npm run e2e`, os fluxos acima passam e o workflow **CI e deploy** roda os testes.
  *Feito em:* —

- [ ] **A2. Monitoramento em produção**
  Captura de erros do navegador e do servidor (com página de consulta ou serviço externo gratuito), métricas das
  conexões SSE (abertas, quedas, reconexões) e alerta quando o site cai.
  *Pronto quando:* um erro forçado no navegador e no servidor aparece no painel, e uma queda simulada gera alerta.
  *Feito em:* —

- [ ] **A3. Dividir o `engine.ts` e o `GameScreen.tsx`** 🧱
  `packages/engine/src/engine.ts` (~7 mil linhas) em módulos por fase do turno; `apps/web/src/components/GameScreen.tsx`
  (~3,8 mil linhas) em componentes por zona da mesa. Sem mudar comportamento.
  *Pronto quando:* nenhum dos dois passa de ~1.500 linhas e todos os testes (inclusive os E2E de A1) passam sem alteração.
  *Feito em:* —

## Fase B — Treino e aprendizado

O objetivo do projeto: ajudar quem quer melhorar no jogo.

- [ ] **B1. Análise da partida** 🧱
  Revisão depois do jogo, como a do chess.com. O `bot/evaluate.ts` e o `bot/planner.ts` passam pelo replay e marcam as
  jogadas que perderam muito valor: "aqui o letal era X", "esse Counter foi desperdiçado", "atacar o Líder era melhor
  que o Personagem". O replay ganha os marcadores e um resumo (precisão por jogador, erros graves).
  *Pronto quando:* em qualquer replay terminado dá para pedir a análise, ver os marcadores na linha do tempo e a
  jogada sugerida em cada um. A análise só usa o que o jogador sabia naquele momento.
  *Plano:* [`plano-analise-partida.md`](plano-analise-partida.md) (3 fases).
  *Progresso:* fase 1 de 3 (análise no navegador, marcadores e resumo no replay) em 2026-11-25,
  [PR #224](https://github.com/Xaleh/gumgumfight/pull/224).
  *Feito em:* —

- [x] **B2. Mão de teste no construtor**
  Sorteia mãos iniciais do deck, simula o mulligan e mostra as chances: ter jogada de custo 2 no turno 2, ter X de
  Counter na mão, comprar a carta-chave até o turno N.
  *Pronto quando:* o construtor tem o botão de mão de teste e um painel de probabilidades calculadas no motor e testadas.
  *Feito em:* 2026-11-25, [PR #220](https://github.com/Xaleh/gumgumfight/pull/220)

- [ ] **B3. Treino de matchup para todos**
  Versão pública do Bot do Time: "treinar contra o Enel do meta", usando os perfis do meta que hoje só o Time usa
  (ver [`plano-bot-time.md`](plano-bot-time.md)).
  *Pronto quando:* qualquer jogador escolhe um Líder do meta e joga contra o deck médio dele com o perfil do bot. A
  versão do Time continua com o que tem de exclusivo.
  *Feito em:* —

- [x] **B4. Desafio do dia**
  Um cenário por dia montado com o `scenario.ts` ("ache o letal neste turno", "sobreviva a este turno"), com resultado
  para compartilhar e sequência de dias seguidos. Também serve de conteúdo para o Instagram.
  *Pronto quando:* existe uma fila de desafios publicados por data, o servidor confere a solução, o jogador vê a
  sequência dele e pode compartilhar o resultado sem entregar a resposta.
  *Feito em:* 25/11/2026, [PR #225](https://github.com/Xaleh/gumgumfight/pull/225)

- [x] **B5. Sandbox de regras**
  Mesa livre para montar uma situação (cartas em campo, na mão, DON!!, Vida) e testar a interação de duas cartas, sem
  partida inteira.
  *Pronto quando:* dá para montar a mesa, jogar os dois lados e compartilhar a situação por link.
  *Feito em:* 2026-11-25, [PR #222](https://github.com/Xaleh/gumgumfight/pull/222)

## Fase C — Construtor de decks

- [ ] **C1. Importar, exportar e link curto**
  Importar e exportar nos formatos de outras ferramentas (OPTCGSim e os construtores populares) e um link curto para
  compartilhar um deck.
  *Pronto quando:* cada formato tem teste de ida e volta, e o link curto abre o deck no construtor.
  *Feito em:* —

- [ ] **C2. Versões do deck**
  Histórico de mudanças do deck com a taxa de vitória de cada versão, usando o hash do `deck_lists`.
  *Pronto quando:* o deck mostra as versões (o que entrou e saiu) e as partidas e a taxa de vitória de cada uma.
  *Feito em:* —

- [ ] **C3. Sugestões de cartas pelas estatísticas**
  "Decks com este Líder usam X e você não usa", "esta carta tem lift negativo" e a comparação com o Deck médio do Líder.
  *Pronto quando:* o construtor mostra as sugestões com o número de partidas por trás de cada uma, e esconde as que têm
  amostra pequena demais.
  *Feito em:* —

- [ ] **C4. Minha coleção**
  Marcar as cartas que a pessoa tem na vida real, filtrar o construtor por elas e mostrar o que falta comprar.
  *Pronto quando:* a coleção fica salva na conta, o filtro funciona na busca e o deck mostra a lista do que falta.
  *Feito em:* —

## Fase D — Bot e cobertura de cartas

- [ ] **D1. Automatizar primeiro as cartas ⚙ mais jogadas**
  Hoje "Frases que faltam" (`apps/server/src/card-gaps.ts`) ordena pelo número de cartas resolvidas. Pesar também pela
  taxa de uso no meta global, para tirar mais decks da proibição na ranqueada.
  *Pronto quando:* a lista mostra o peso de uso de cada frase e vem ordenada pelo número de decks liberados.
  *Feito em:* —

- [ ] **D2. Bot que deduz a mão do oponente**
  O [`bot-tempo.md`](bot-tempo.md) registra que o bot só sabe o tamanho da mão. Com o perfil do deck do meta, estimar
  as cartas prováveis (o Counter que deve estar lá, a carta-chave do Líder) e usar isso no planejamento.
  *Pronto quando:* o bot usa a estimativa nas decisões de ataque e defesa, sem ler a mão real, e os testes mostram
  ganho contra a versão anterior.
  *Feito em:* —

- [ ] **D3. Bots com personalidade**
  Agressivo, controle e conservador com a Vida, além de fácil, normal e difícil.
  *Pronto quando:* a escolha aparece ao jogar contra o bot e cada personalidade tem teste que mostra o estilo dela.
  *Feito em:* —

- [ ] **D4. Yonko, fase 4** 🧱
  Espectador e replay da mesa de 4 e o bot com busca, que o [`plano-modos-de-jogo.md`](plano-modos-de-jogo.md) aponta
  como pendentes.
  *Pronto quando:* dá para assistir e rever uma mesa Yonko, e o bot com busca joga na mesa.
  *Feito em:* —

## Fase E — Social e comunidade

- [x] **E1. Perfil público do jogador**
  Página com o cartaz WANTED, bounty, Líderes mais jogados, partidas recentes com replay e decks públicos.
  *Pronto quando:* o perfil abre por link, mostra só o que é público e o jogador escolhe o que aparece.
  *Feito em:* 2026-11-25 — [PR #221](https://github.com/Xaleh/gumgumfight/pull/221)

- [x] **E2. Amigos e convite direto**
  Lista de amigos com quem está online e convite para partida por notificação push (a infraestrutura de push já existe
  em `apps/server/src/push/`).
  *Pronto quando:* dá para adicionar, aceitar e remover amigos, ver quem está online e convidar com um toque. O
  convite abre a sala direto.
  *Feito em:* 25/11/2026 · [PR #223](https://github.com/Xaleh/gumgumfight/pull/223)

- [ ] **E3. Temporadas da ranqueada**
  Ranking geral por temporada, reset parcial do bounty e recompensas cosméticas no fim.
  *Pronto quando:* a temporada tem início e fim, o ranking é por temporada, o reset roda sozinho e o histórico das
  temporadas passadas fica visível.
  *Feito em:* —

- [ ] **E4. Integração com Discord** 🧱
  Bot que avisa torneios, resultados, partidas ao vivo e o resumo do meta. Depois, login pelo Discord (hoje só existe
  o login com Google).
  *Pronto quando:* um servidor do Discord recebe os avisos configurados e dá para entrar no site com a conta do Discord.
  *Feito em:* —

- [ ] **E5. Clubes e lojas** 🧱
  Grupos locais com liga recorrente por pontos e torneios semanais que se repetem sozinhos, ligados ao perfil
  Organizador.
  *Pronto quando:* um organizador cria o clube, os jogadores entram, a liga soma pontos dos torneios e o torneio da
  semana é criado sozinho.
  *Feito em:* —

## Fase F — Conteúdo e divulgação

Ligado ao kit de Instagram (`marketing/instagram/`).

- [ ] **F1. Arte semanal do meta**
  O resumo do meta em frases vira imagens para post e stories, gerado sozinho, no mesmo esquema do `apps/web/src/recap/draw.ts`.
  *Pronto quando:* toda semana as imagens ficam prontas para baixar, nos formatos do feed e dos stories.
  *Feito em:* —

- [x] **F2. Trecho do replay em vídeo ou GIF**
  "Jogada da semana" pronta para Reels: escolher um trecho do replay e exportar, usando o destaque de carta do modo
  transmissão.
  *Pronto quando:* dá para marcar início e fim no replay e baixar o vídeo vertical (e o GIF) sem informação escondida
  da partida.
  *Feito em:* 2026-11-25, [PR #226](https://github.com/Xaleh/gumgumfight/pull/226)

## Fase G — Acessibilidade e apoio

- [ ] **G1. Acessibilidade**
  Modo para daltonismo (as cores das cartas são centrais no jogo), escala de fonte e navegação por teclado fora da partida.
  *Pronto quando:* a cor de cada carta tem também um símbolo ou padrão, a fonte escala sem quebrar as telas e os menus
  funcionam só com o teclado.
  *Feito em:* —

- [ ] **G2. Cosméticos para quem apoia**
  Capas de carta, tapetes e molduras do WANTED com arte própria, como benefício de apoio (ver [`apoio/`](apoio/README.md)).
  Só arte original, sem material da Bandai ou da Toei.
  *Pronto quando:* quem apoia escolhe os cosméticos no perfil, eles aparecem na mesa para os dois lados e o acesso
  segue o nível de apoio.
  *Feito em:* —

## Como pedir um item

Cole numa sessão nova do Claude Code, com este repositório:

```
Item a implementar: PRÓXIMO
(troque PRÓXIMO por um ID do roadmap, ex.: A2, para escolher um item específico)

Leia docs/roadmap.md. Se o item acima for "PRÓXIMO", pegue o primeiro item ainda não marcado ([ ]),
na ordem das fases. Implemente só esse item.

Como trabalhar:
1. Leia a seção "Regras para todo item" do roadmap, o README e a parte da docs/documentacao-tecnica.md
   que o item toca. Confira no código se algo parecido já existe antes de criar coisa nova.
2. Antes de codar, me mostre um plano curto: o que vai mudar, os arquivos principais, as tabelas
   novas (se houver) e como vai testar. Se o item for grande (🧱), proponha dividir em fases e escreva
   docs/plano-<nome>.md; implemente só a primeira fase agora.
3. Crie uma branch a partir da main com um nome que descreva o item.
4. Implemente seguindo o padrão do projeto: regras no packages/engine, servidor como autoridade,
   nenhuma informação escondida vazando, textos da interface nos seis idiomas (mesmas chaves do pt-BR).
5. Escreva os testes, rode `npm run typecheck` e `npm test` e corrija até tudo passar.
6. Atualize o README (e a documentação técnica, se mudou banco, rota ou arquitetura) descrevendo o
   que passou a existir.
7. No docs/roadmap.md, marque o item como [x] (ou, se foi dividido, anote a fase concluída na linha "Progresso"
   do item) e preencha "Feito em" com a data e o link do PR.
8. Faça commit, dê push e abra o PR para a main com um resumo do que mudou e de como testar.
   NÃO faça merge na main (ela publica em produção). Se der, publique a branch na homologação
   pelo workflow "CI e deploy" (Run workflow).
9. Trello (quadro "GumGum Fight", card cujo título começa pelo ID do item, ex.: "B1 · "):
   - ao começar a implementar (depois do plano), mova o card para "Em execução";
   - ao abrir o PR, mova o card para "Em teste/Validação" e comente nele o link do PR, o que ficou
     pronto e, se o item foi dividido, qual fase foi entregue.
   Não mova para "Concluído": isso eu faço depois do merge. Se o Trello não estiver disponível
   nesta sessão, pule este passo e me avise no fim.

No fim, me diga em poucas linhas o que ficou pronto, o que ficou de fora e qual é o próximo item.
```
