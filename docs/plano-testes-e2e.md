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

**Conhecido na fase 1:** no WebKit do CI (Linux), a página da mesa às vezes cai (`Target crashed`) logo depois do
mulligan, no teste de desistir (1 em cada 3 execuções do job, nas primeiras rodadas); a segunda tentativa passa. O
log agora diz quando a página caiu. Falta saber se é do WebKit de Linux do Playwright ou se acontece também no Safari
de um iPhone de verdade (a mesa tem muitas camadas com filtro e animação): conferir num aparelho e, se for do app,
reduzir as camadas da mesa no celular. Até lá, o CI tenta de novo uma vez.

### Fase 2 — Fila online: fila → partida → fim ✅

- `newPlayer()` (em `e2e/support/fixtures.ts`): mais um navegador no mesmo teste, outro contexto (outro dono de
  navegador e outros cookies) com as opções do projeto, também vigiado (erro não tratado reprova, queda da página avisa).
- Login de teste: `e2e/support/account-cli.ts` abre o banco temporário com o `openDb` do servidor, cria a conta com
  `upsertGoogleUser` (e o perfil com `setUserRole`, se pedido) e a sessão com `createSession`; `login()`
  (`e2e/support/accounts.ts`) roda o script com `tsx` e põe o cookie `gg_session` no contexto. Nenhuma rota de teste.
- `online.spec.ts`, casual: os dois entram na **Partida rápida**, a sala abre nos dois, pulam os dados, quem venceu o
  sorteio começa e os dois mantêm a mão. Cada um vê a própria mão e a do oponente chega ao navegador só com as
  referências escondidas do `view.ts` (`~…`) e o verso das cartas. O turno passa de um navegador para o outro; o segundo
  recarrega a página e volta para a mesma sala ainda com o turno; ele desiste e os dois veem o fim (vitória e derrota) e
  voltam ao menu.
- `online.spec.ts`, ranqueada: duas contas de teste, a ranqueada fica liberada, os dois entram na fila, um desiste e o
  bounty de quem venceu sobe (`/api/players/me`).
- Só no desktop por enquanto: no iPhone a mesa usa outro arranjo, e a queda do WebKit (acima) somaria instabilidade.

### Fase 3 — Torneio: criar e jogar ✅

- `e2e/support/tournament.ts`: criar o torneio pela tela (Menu → Torneios → Criar torneio: suíço, Standard, sem data),
  inscrever-se pelo **link de convite** (`/?torneio=<id>`, o mesmo do "Copiar convite") escolhendo um deck pronto no
  seletor, e marcar "Estou pronto" para a rodada.
- `tournament.spec.ts`: o organizador (conta com o perfil de Organizador, `login(page, nome, 'organizer')`) cria o
  torneio; duas jogadoras se inscrevem com decks diferentes; o organizador começa; as duas marcam "Estou pronto" e o
  organizador abre a rodada com a mesa pronta; cada uma clica em **Jogar partida**, a sala do torneio abre nas duas, a
  partida é jogada até uma desistir e o fim de jogo leva de volta ao torneio. O resultado entra sozinho ("Vitória!" e
  "Derrota." na página das duas, sem o organizador lançar o placar); o organizador encerra a última rodada e cada uma vê
  a classificação final (1º lugar com 1V 0D e 2º com 0V 1D).
- `@iphone`: a inscrição pelo convite no celular (o organizador cria, o jogador escolhe o deck e se inscreve, o
  organizador vê o inscrito). A partida do torneio no iPhone fica de fora enquanto a queda da mesa no WebKit (acima)
  não for resolvida.
- Com as três fases, o A1 fica `[x]`.
