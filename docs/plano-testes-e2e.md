# Plano: testes de ponta a ponta no navegador (roadmap A1)

Os fluxos principais rodando num navegador de verdade (Playwright), contra o servidor de verdade, para pegar o que os
testes de unidade do motor e da API não veem: a interface, o caminho do jogador entre as telas, o canal SSE, o Web Worker
do bot e o Safari do iPhone.

**Regras que não mudam em nenhuma fase:**

- Os testes passam pelo caminho do jogador (botões e textos da tela), sem rota nem atalho de teste no código de produção.
  O que precisa existir antes do teste (uma conta, um torneio de outra pessoa) é criado direto no banco temporário pelo
  processo dos testes, com as mesmas funções do servidor.
- Os textos vêm do dicionário pt-BR pela chave (`e2e/support/i18n.ts`): mudar um texto não quebra o teste; apagar uma
  chave quebra o typecheck.
- Cada execução sobe o servidor com um banco SQLite novo (`e2e/.tmp/<porta>/e2e.db`) e sem nada de fora (sem imagens das
  cartas, spoilers, meta global ou notificações). Um navegador limpo por teste.
- Um erro não tratado na página reprova o teste (`e2e/support/fixtures.ts`), mesmo que a tela continue de pé.
- O CI (**CI e deploy**) roda tudo em Chromium e WebKit; o deploy só sai com os testes de ponta a ponta passando.

## Como funciona

- `npm run e2e` compila o web (`npm run build`) e chama `playwright test -c e2e`. Argumentos vão para o Playwright
  (`npm run e2e -- --project=iphone`, `-g "boosters"`, `--headed`, `--trace on`).
- `e2e/playwright.config.ts`: o `webServer` roda `e2e/serve.ts`, que apaga e recria a pasta do banco e importa o
  `apps/server/src/index.ts` (o mesmo servidor da produção) servindo `apps/web/dist`, na porta `E2E_PORT` (padrão 3410).
  Um worker só (os testes dividem o servidor), idioma pt-BR, fuso de São Paulo, service worker bloqueado, trace e
  screenshot só quando falha; no CI, uma nova tentativa e o relatório HTML em `playwright-report/`.
- Projetos: `desktop` (Chromium, 1280 × 800, todos os testes) e `iphone` (iPhone 13 no WebKit, só os testes marcados com
  `@iphone` no nome). Sem o WebKit instalado (`npx playwright install webkit`), o `iphone` roda no Chromium com a tela, o
  toque e o user agent do iPhone e avisa; no CI o WebKit é obrigatório.

## Fases

### Fase 1 — Base, partida contra o bot e boosters ✅

- `@playwright/test` (versão fixa), `e2e/` (config, servidor, textos, fixture de erros, passos comuns), `npm run e2e`,
  `tsc -p e2e` no `npm run typecheck` e o job **Testes de ponta a ponta (Playwright)** no workflow, com o relatório e os
  traces como artefato quando falha.
- `bot-match.spec.ts`: menu → partida contra o bot (fácil, jogador começa) → mulligan → **Auto** (o bot joga pelos dois
  lados) até o fim de jogo; o replay baixado tem a partida inteira; volta ao menu. E desistir pelo menu da mesa (`@iphone`).
- `boosters.spec.ts` (`@iphone`): abrir os 6 boosters de uma coleção — um com dois toques (seleciona e abre), os outros
  de uma vez, pulando a animação —, 72 cartas reveladas, e os boosters abertos continuam desenhados, dentro da fileira e
  na ordem (no celular, numa linha só): o bug do Safari de novembro (`.sealed-pack` em `styles.css`).

### Fase 2 — Fila online: fila → partida → fim

- Dois navegadores (dois contextos, dois donos de navegador) entram na fila casual com os decks prontos; a sala abre nos
  dois pelo SSE, cada um vê só a própria mão (conferir na tela que a mão do outro aparece virada), jogam turnos de
  verdade e um desiste; os dois veem o fim de jogo e a partida aparece nas estatísticas.
- Login de teste para a ranqueada: `e2e/support/accounts.ts` abre o banco temporário (`node:sqlite`), cria a conta com
  `upsertGoogleUser`, a sessão com `createSession` e põe o cookie no contexto. Fila ranqueada com duas contas.
- Queda e volta: um dos navegadores recarrega a página no meio da partida e volta para a mesma sala.

### Fase 3 — Torneio: criar e jogar

- Organizador (conta com o perfil de Organizador, criada como na fase 2) cria um torneio suíço pela tela; dois ou quatro
  jogadores se inscrevem com as próprias contas; o organizador inicia; cada mesa abre como sala online, os jogos terminam
  (desistência ou partida jogada) e o resultado entra sozinho; a rodada fecha, o torneio termina e a classificação final
  aparece para todos.
- Fluxo também no `iphone` para o jogador (inscrição, lobby e a mesa da rodada).
- Com as três fases, o A1 fica `[x]`.
