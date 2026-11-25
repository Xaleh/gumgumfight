# Plano: análise da partida (roadmap B1)

Revisão depois do jogo, como a do chess.com: o bot passa pelo replay terminado, compara cada decisão de cada jogador com a
melhor jogada que ele acha e marca as que perderam valor, com a jogada sugerida e um resumo por jogador.

**Regra que não muda em nenhuma fase:** a análise só usa o que o jogador sabia naquele momento. Cada decisão é avaliada
sobre `viewFor(estado, jogador)`, a mesma visão com que o bot joga, e a análise só roda em partida terminada.

## Como a análise funciona (motor)

- `packages/engine/src/bot/analysis.ts`: `analyzeReplay(initial, actions)` refaz o replay; em cada decisão com escolha de
  verdade (`isDecision`: mais de uma ação de jogo legal; ficam de fora mulligan, quem começa, modo manual, correções,
  desistência e relógio) chama `reviewDecision`, que monta a visão de quem decide e pede ao planejador a nota da melhor
  jogada e a da jogada feita (`scoreDecision`, em `planner.ts`).
- Na fase principal, a melhor jogada é a linha que a busca em feixe do bot acha para o turno (`searchTurn`, a mesma
  do `planTurn`); a jogada feita vale a melhor continuação do turno depois dela (outra busca, que já começa com a
  jogada). Numa escolha pendente (bloquear, Counter, carta da Vida, alvos, "pagar X?", opções), cada resposta é
  simulada como o bot faz, com a média de vários sorteios do próprio deck nas perguntas pagas e nas opções.
- A perda é `melhor − feita` (≥ 0) na escala da avaliação (1.000 ≈ +1000 de poder num ataque). Gravidade
  (`ANALYSIS_LIMITS`): imprecisão ≥ 1.500, erro ≥ 4.000, erro grave ≥ 10.000. Precisão da decisão:
  `100 × e^(−perda/6000)` (perda limitada a 30.000); a do jogador é a média.
- O tipo do marcador (`AnalysisTag`) diz o que a jogada sugerida fazia de diferente: `lethal`, `wastedCounter`,
  `missedCounter`, `badBlock`, `missedBlock`, `attackLeader`, `attackCharacter`, `endedEarly`, `trigger`, `better`.
- O sorteio do próprio deck e o desempate usam um gerador fixo por decisão: a mesma decisão dá a mesma análise na mesma
  máquina. A busca tem teto de tempo (150 ms por busca), então máquinas diferentes podem dar números um pouco diferentes.

## Fases

### Fase 1 — Análise no navegador e marcadores no replay ✅

- Motor: `bot/analysis.ts` e, no planejador, `searchTurn` (extraído do `planTurn`, sem mudar o bot), `scoreDecision` e
  `sameAction`.
- Web: botão **Analisar a partida** na barra do replay; a conta roda num Web Worker (`game/analysisWorker.ts`; sem worker,
  na página, uma decisão por tarefa: `runAnalysisInPage`) com o progresso e os marcadores chegando enquanto anda.
  Marcadores coloridos na barra de busca, ‹ › entre eles, o cartão do marcador (tipo, o que foi jogado, a jogada sugerida
  resumida em jogadas) e o resumo por jogador. Textos nos seis idiomas (`i18n/analysis/`). Funciona no celular (tudo
  fica na barra do replay, não no painel lateral do desktop).
- Sem banco e sem rota nova: o replay terminado já chega inteiro ao navegador de quem pode vê-lo (`replayDenied`).
- Testes: posições do motor (letal perdido, Counter desperdiçado e que faltou, alvo do ataque, jogada igual à do bot),
  a análise igual com a mão escondida do oponente trocada (nada vaza), replay inteiro com progresso, replay não terminado
  recusado; no web, as contas da barra, as chaves dos seis idiomas e a análise na página (recusa e cancelamento).

### Fase 2 — Análise guardada no servidor

- Tabela `match_analyses` (`match_id`, `version` = `ANALYSIS_VERSION`, `reviews` JSON, `players` JSON, `created_at`):
  a análise de uma partida gravada é feita uma vez e abre pronta.
- Fila no servidor com limite de CPU (uma análise por vez, prioridade para quem pediu), pedida por
  `POST /api/matches/:id/analysis` e lida por `GET /api/matches/:id/analysis`, com as mesmas regras de acesso do replay
  (`replayDenied`; em torneio, só depois do fim).
- O link do replay embutido e o replay aberto pela lista de partidas trazem a análise junto, quando existe.
- "Minhas partidas" e as estatísticas pessoais ganham a precisão média por partida e por Líder.

### Fase 3 — Aprender com a análise

- Prévia "e se" na mesa: mostrar a jogada sugerida animada a partir da posição marcada (sem sair do replay).
- Análise do mulligan (a mão mantida contra a média das mãos do deck, ligada à mão de teste do B2).
- Botão "Analisar" direto na tela de fim de partida (contra o bot e online), abrindo o replay já com os marcadores.
- Revisão da régua com partidas reais: os limites de gravidade e a escala da precisão calibrados pela distribuição das
  perdas nos replays dos melhores colocados dos torneios (como o ajuste de pesos da seção 11 de `bot-tempo.md`).
