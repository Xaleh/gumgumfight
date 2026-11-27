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
- O CI (**CI e deploy**) roda tudo em Chromium e WebKit no pull request, uma vez por mudança (desde 2026-11-26 não
  roda mais no push do branch nem de novo na `main`). O deploy da `main` espera só os testes de unidade e o smoke test
  do pacote: os de ponta a ponta valem antes do merge, no PR.

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
  lados) até o fim de jogo; o replay baixado tem a partida inteira; volta ao menu. E desistir pelo menu da mesa. Os dois
  são `@iphone` (a partida inteira, desde 2026-11-27: são dezenas de faixas de troca de turno com as animações completas).
- `boosters.spec.ts` (`@iphone`): abrir os 6 boosters de uma coleção — um com dois toques (seleciona e abre), os outros
  de uma vez, pulando a animação —, 72 cartas reveladas, e os boosters abertos continuam desenhados, dentro da fileira e
  na ordem (no celular, numa linha só): o bug do Safari de novembro (`.sealed-pack` em `styles.css`).

**Queda da mesa no WebKit de Linux (conhecida na fase 1, resolvida em 2026-11-26).** No projeto `iphone` do CI, a
página da mesa caía (`Target crashed`) no teste de desistir: 1 em cada 3 execuções do job no começo, depois na primeira
tentativa de 4 jobs seguidos (e nas duas num deles, que ficou vermelho).

- **Causa:** a animação da faixa de troca de turno (`tb-sweep` em `styles.css`, a faixa das animações "Completas") ia
  de `filter: blur(10px)` a `blur(0)`, a `none` (20%), a `none` (78%) e de volta a `blur(10px)`. No WebKit de Linux (WPE,
  o que o Playwright instala), uma animação de `filter` ou `backdrop-filter` com **dois quadros seguidos em `none`** e
  uma função de filtro em outro quadro derruba o processo da página. O kernel registra (`dmesg`) `segfault at 0` na
  thread `ThreadedCompositor` de `libWPEWebKit-2.0.so`, sempre no mesmo endereço (`+0x60a0f8a`): ponteiro nulo no
  compositor, não falta de memória nem peso das camadas da mesa.
- **Sem o app:** uma página com um `div` e essa animação cai 4 de 4 vezes no iPhone 13 emulado e 2 de 2 na janela de
  desktop; com `blur(0)` no lugar de `none`, 0 de 4. Um `none` só entre dois quadros com filtro, ou só dois quadros, não
  cai.
- **Por que parecia sorte:** a faixa entra cerca de 0,7 s depois do mulligan e a queda vem cerca de 0,25 s depois, quando
  a animação chega ao trecho `none → none`. O teste passava quando desistia antes disso. Com 6 s de espera na mesa antes
  de abrir o menu, caía sempre.
- **Medido** (WebKit 26.6, build 2359 do Playwright 1.63.0, Ubuntu 24.04, 4 núcleos, sem GPU):

  | Variação                                                       | Quedas          |
  | -------------------------------------------------------------- | --------------- |
  | O teste como estava (`--project=iphone -g desistir`)           | 3 de 10, 5 de 6 |
  | O mesmo fluxo com 6 s de espera na mesa                        | 20 de 20        |
  | Animações desligadas (`animations: 'off'`)                     | 0 de 20         |
  | Animações suaves (sem a faixa atravessando a mesa), com espera | 0 de 8          |
  | Sem a faixa (`.turn-banner { display: none }`), com espera     | 0 de 8          |
  | Sem `filter` em nenhum elemento, com espera                    | 0 de 8          |
  | Sem `backdrop-filter` em nenhum elemento                       | 20 de 20        |
  | `deviceScaleFactor` 1 no lugar de 3, com espera                | 8 de 8          |
  | Chromium com a emulação do iPhone, com espera                  | 0 de 8          |
  | **Com a correção:** o teste, 20 vezes seguidas sem nova tentativa | 0 de 20      |
  | **Com a correção:** o fluxo com e sem a espera                 | 0 de 20, 0 de 20 |
  | **Com a correção:** partida inteira no Auto, no iPhone 13 emulado | 0 de 2       |

- **Correção:** `filter: blur(0)` no lugar de `none` nos quadros de 20% e 78% do `tb-sweep` (o visual é o mesmo, em
  qualquer tela). Era a única animação do app com esse formato; `apps/web/test/keyframes.test.ts` reprova o CSS se outra
  aparecer.
- **iPhone de verdade:** não foi conferido num aparelho. A thread que cai é do compositor das versões de Linux do WebKit
  (WPE e GTK); o Safari do iOS usa outro compositor, então esta queda não é esperada lá. Navegadores de Linux com o
  WebKitGTK (GNOME Web) usam o mesmo compositor e podiam cair no mesmo ponto (não testado).
- O CI continua com uma nova tentativa (`retries: 1`), mas não por causa disto. `fixtures.ts` segue avisando no log
  quando uma página cai; numa queda nova, `dmesg | grep segfault` no runner diz a thread e o endereço.

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
- `online.spec.ts`, espera pela fila (27/11/2026, junto com a busca minimizada): o cartão de dicas troca pelo botão, a
  mão de teste do deck da fila sorteia 5 e compra a sexta, a busca minimizada continua nas estatísticas, o construtor
  pergunta "Sair da fila?" (ficar mantém a busca; sair esvazia a fila no servidor) e a partida que chega leva quem
  estava nas estatísticas para a mesa.
- `online.spec.ts`, ranqueada: duas contas de teste, a ranqueada fica liberada, os dois entram na fila, um desiste e o
  bounty de quem venceu sobe (`/api/players/me`).
- Os dois são `@iphone` desde 2026-11-27. Ficavam só no desktop por causa do arranjo da mesa no celular e da queda do
  WebKit (acima); os passos (`e2e/support/online.ts`) valem para os dois arranjos sem mudança.

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
  organizador vê o inscrito). E, desde 2026-11-27, o torneio inteiro, com a partida na sala online.
- Com as três fases, o A1 fica `[x]`.

### Depois do A1 — a mesa com o mouse e o teclado

- `table.spec.ts` (entrou com a fase 4 do A3, antes de dividir o componente `Table`): numa partida contra o bot, arrastar
  um DON!! até o Líder (anexa) e de volta para a fileira (devolve); segurar o clique numa carta (o toque longo abre a
  carta ampliada, o Esc fecha); arrastar uma carta dentro da mão (muda a ordem); jogar até ter uma carta que dá para
  jogar, arrastá-la para o campo e atacar arrastando o Líder até o Líder do oponente; e os atalhos de teclado, ligados
  nas configurações do menu da partida (1 marca um DON!!, L escolhe o Líder, X anexa, Shift+L o Líder do oponente, D
  abre o descarte, Esc fecha, Espaço encerra o turno).
- Antes de arrastar, o teste espera o elemento parar e não ter nada por cima (as cartas e os DON!! chegam voando no
  começo do turno). Só no desktop: o arrasto com o dedo (deslizar pela mão ergue a carta) continua sem teste.

### Depois do A1 — a mesa do Yonko

- `yonko.spec.ts` (`@iphone`): a mesa local do Yonko, da tela inicial ao primeiro turno de quem joga. A preparação
  (largada e mão inicial) e as perguntas dos bots são respondidas pelo botão em destaque da faixa de ação até
  "Encerrar turno" acender; o turno passa para um bot; e as opções da mesa abrem com a escolha das animações, que
  desligadas valem na hora (a mesa leva `anim-off`). Entrou com o redesenho da mesa (playmats, animações de voo).
- `yonko.spec.ts`, arrasto (só no `desktop`): joga até ter uma carta que dá para jogar, arrasta-a da mão até a mesa
  de quem joga (a mesa mostra que aceita a carta) e a carta sai da mão.
- No teste da mesa local, nos dois projetos a partida corre com as animações completas. Depois de encerrar o turno, o
  teste espera a faixa de troca de turno atravessar a mesa na vez do bot e sair, e só então o jogador desliga as
  animações. (Até 2026-11-27 o `iphone` as desligava ainda na preparação, por causa do diagnóstico descrito abaixo.)

**O diagnóstico do PR do Yonko (26/11/2026) mediu o CSS de antes da correção.** O PR do redesenho do Yonko
(Xaleh/gumgumfight#244) rodou variantes do teste no WebKit do CI e concluiu que a faixa de troca de turno ainda
derrubava a mesa com as animações completas, no Yonko e na mesa de dois. A conclusão valia para o branch, não para a
`main`:

- O branch do PR não tinha a correção do `tb-sweep` (ela entrou na `main` às 21:16 UTC; o branch tinha juntado a
  `main` às 21:14). Na época o job de ponta a ponta rodava duas vezes por commit: no *push* (só o branch, com
  `filter: none` nos quadros do meio) e no *pull_request* (o branch junto com a `main`, já com `blur(0)`).
- As quedas vieram das execuções de *push*. A execução de *pull_request* do mesmo commit de diagnóstico (`277e021`)
  passou em todas as variantes de primeira, com o Yonko nas completas e a mesa de dois em 40 s de Auto.
- Ou seja, a tabela daquele diagnóstico repete, pelo CI, o que a seção "Queda da mesa no WebKit de Linux" já dizia: sem
  a faixa não cai, sem animação de CSS não cai, e não é das cartas voando nem da mesa do Yonko.

**Conferido no WebKit do CI em 2026-11-27**, numa execução só, com a mesa de dois, as animações completas e o bot
jogando pelos dois lados por 25 s, e o `tb-sweep` trocado por CSS injetado (um teste temporário, que não ficou no
repositório):

| `tb-sweep` em uso                                                              | Resultado                              |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| O de hoje (`blur(0)` nos quadros de 20% e 78%)                                 | não cai                                |
| O antigo (`filter: none` nos quadros de 20% e 78%)                             | cai (a página trava na primeira faixa) |
| O antigo, sem o `backdrop-filter` da faixa                                     | cai (a página trava na primeira faixa) |
| Sem `filter` na animação (só `transform` e `opacity`), com o `backdrop-filter` | não cai                                |

Quem derruba é o `filter` animado com os dois quadros em `none`; o `backdrop-filter` da faixa não tem culpa. A faixa
ficou como estava: a correção (`blur(0)` no lugar de `none`) não muda o que se vê. Com isso foram para o `iphone` a
partida inteira no Auto, as duas filas online e a partida do torneio, e a mesma execução passou com tudo de primeira,
sem nova tentativa. Num iPhone de verdade continua não conferido (ver "iPhone de verdade", acima).
