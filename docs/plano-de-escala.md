# GumGum Fight — Plano de escala

> Objetivo: atender **1.000 salas simultâneas** com folga e com o menor custo possível, deixando o caminho pronto para
> 5 mil, 10 mil e 20 mil salas sem reescrever o produto. Os números vêm de medições no código da `main` em
> 2026-10-12 (seção 1); os preços, de fontes públicas na mesma data (seção 8) e mudam com as promoções.
>
> Complementa a [documentação técnica](documentacao-tecnica.md), seções 14 e 15. Onde houver divergência, vale este
> documento: a medição de memória aqui é mais precisa e a compressão do canal muda o modelo de banda.

## Resumo

- **1.000 salas cabem na VPS atual** (KVM 1) depois de quatro mudanças de código, sem trocar de plano. O que impede
  hoje não é hardware: é o canal das partidas sem compressão, a lista "Assistir" que devolve todas as salas, as
  imagens vindas de um site de terceiros e o teto configurado de 400 salas.
- **A maior economia é comprimir o canal das partidas.** Cada estado é quase igual ao anterior, então um compressor
  por conexão, que guarda o contexto entre eventos, corta **95%** dos bytes. A banda deixa de ser problema em
  qualquer escala deste plano.
- **Kubernetes não deixa nada mais barato aqui.** As salas vivem na memória de um processo; o que falta é rotear cada
  sala para o processo que a guarda, e isso o Nginx faz de graça. Kubernetes só passa a valer a pena com muitas
  máquinas e mais de uma pessoa operando.
- **Imagens das cartas e música vão para a Cloudflare** (R2 + CDN): ~550 MB de imagens em WebP, dentro do plano
  gratuito, sem custo de saída e sem depender da optcgapi durante o jogo.
- **Banco**: SQLite continua até sair de um processo. Na fase 2 entram Postgres (contas, decks, estatísticas,
  torneios) e Valkey/Redis (fila, presença, registro de salas), os dois na própria VPS.

| Salas simultâneas | Infra | Custo/mês (promo → renovação) |
|---|---|---|
| até 1.500 | KVM 1 atual + Cloudflare grátis + R2 grátis | US$ 6,49 → 11,99 |
| até 5.000 | KVM 4 | US$ 12,99 → 28,99 |
| até 10.000 | KVM 8 | US$ 25,99 → 49,99 |
| até 20.000 | 2× KVM 8 + KVM 2 para o banco | US$ 60,97 → 114,97 |

---

## 1. Medições que sustentam o plano

Medido no servidor real (processo do app, sem o custo do cliente de teste), com salas no meio da partida.

| Medida | Valor | Como |
|---|---|---|
| CPU por ação, parte fixa | **1,1 ms** | 1.000 salas, 65 ações cada, 1 e 5 espectadores |
| — dessa parte, gravar a sala no SQLite | 0,49 ms | |
| CPU por ação, por conexão (visão + JSON) | **0,15 ms** | diferença entre 3 e 7 conexões por sala |
| Memória por sala | 0,15–0,22 MB de heap; **0,7–1,0 MB de RSS** | 1.000 salas, depois de GC |
| Estado enviado por ação, por conexão | 9,5 KB | |
| Fim de partida (refazer o replay e gravar) | ~55 ms | 1 por partida |
| **Canal comprimido, gzip nível 4, janela 16 KB** | **−95,2%** de bytes, **83 KB** de memória por conexão, ~0,13 ms por evento | 40 partidas inteiras, 120 conexões, 37.533 eventos |
| gzip nível 6, janela padrão | −97,3%, 236 KB por conexão | |
| brotli q4 | −98,6%, 560 KB por conexão | memória alta demais por conexão |
| gzip de cada evento isolado, sem contexto | −75% | por isso o contexto por conexão importa |
| Imagem de carta na optcgapi | JPEG 600×838, **~200 KB** | 6 amostras |
| Mesma imagem em WebP q80 | ~120 KB; **~33 KB** com 300 px de largura | |
| Música + efeitos | 1,5 MB + 0,2 MB, cache de 1 ano no navegador | |

Premissas do modelo: partida de 20 min com 130 ações, **1 espectador por sala em média**, 25% de pessoas a mais no
menu e nas filas, 1 mensagem de chat por minuto por jogador, pico mantido ~35% do dia (média diária ÷ pico).

---

## 2. As 1.000 salas, depois das mudanças da fase 1

| Recurso | Hoje (sem mudanças) | Depois da fase 1 | KVM 1 tem |
|---|---|---|---|
| CPU | ~0,3 núcleo | ~0,4 núcleo (a compressão custa um pouco de CPU) | 1 vCPU |
| Memória | ~1,2 GB | ~1,5 GB (salas + compressores + Nginx) | 4 GB |
| Banda de saída no pico | ~27 Mbit/s no canal + ~25 Mbit/s da lista "Assistir" | **~3 Mbit/s** | — |
| Tráfego mensal | ~6 TB (passa dos 4 TB) | **~0,4 TB** | 4 TB |
| Imagens | da optcgapi, 200 KB cada, a cada visita sem cache | do nosso CDN, 33–120 KB, cache de 1 ano | — |
| Teto configurado | 400 salas | 1.500 | — |

Sem a fase 1, o KVM 1 não chega a 1.000 salas: o tráfego passa dos 4 TB/mês e a lista "Assistir" sozinha, com
1.000 salas, devolve ~600 KB por consulta (~90 KB comprimidos) a cada 5–15 s para cada pessoa no menu.

**Recomendação**: ficar no KVM 1 e subir para o KVM 2 (US$ 8,99 → 14,99) só quando a CPU do processo passar de 50%
sustentada ou o atraso do event loop passar de 50 ms no p99 (seção 7). É a opção mais barata e o código continua
um processo só.

---

## 3. Fase 1 — até 1.500 salas, mesma VPS (1–2 semanas de desenvolvimento)

Em ordem de retorno:

1. **Compressão do canal das partidas** (`apps/server/src/online/routes.ts`, função `stream`).
   - Se o navegador aceita `gzip` (`Accept-Encoding`), a resposta SSE sai com `Content-Encoding: gzip` e cada conexão
     tem um `zlib.createGzip({ level: 4, windowBits: 14, memLevel: 5 })`; cada `send` escreve o evento e chama
     `flush(Z_SYNC_FLUSH)`. Sem suporte, segue sem compressão.
   - `EventSource` descomprime sozinho; o Nginx já está com `proxy_buffering off` e não mexe no corpo.
   - Ganho: −95% de banda no canal. Custo: 83 KB de memória e ~0,13 ms de CPU por conexão e evento.
2. **Lista "Assistir" paginada** (`GET /api/online/live`, `lobby.live`): devolver no máximo 30 salas, com filtro
   por fila e um total, calculado uma vez por segundo e reaproveitado. Ajustar `Watch.tsx` e `HomeBlocks.tsx`.
3. **Contadores do menu calculados uma vez por segundo** (`lobby.stats`). Hoje percorrem todas as salas em cada
   consulta, e cada pessoa no menu consulta a cada 10 s.
4. **Imagens e estáticos na Cloudflare** (seção 5).
5. **Cache das estatísticas por tempo, não por gravação** (`apps/server/src/cache.ts`). Hoje qualquer partida gravada
   invalida tudo; com 1.000 salas termina quase uma partida por segundo, e o cache deixa de existir. Estatísticas:
   TTL de 60 s. Torneio: versão por torneio, não global.
6. **Tetos e pm2**: `ONLINE_MAX_ROOMS=1500` em `shared/deploy.env`; `PM2_MAX_MEMORY` continua 1500M.
7. **Métricas mínimas** (seção 7) e um monitor externo grátis de `/api/health`.
8. **Teste de carga no repositório**: transformar o script desta medição em `npm run loadtest` e rodar na homologação
   antes de cada mudança de fase.

Pode ficar para depois de 3 a 6 meses de uso:

- **Retenção dos replays**: com 1.000 salas no pico, entram ~25 mil partidas por dia (~250 MB). Guardar o replay
  completo por 180 dias, mover os antigos para o R2 e manter só as linhas de estatística.
- **Tabelas de resumo diário** para as estatísticas, quando `match_seats` passar de alguns milhões de linhas.

---

## 4. Arquitetura alvo e o que cada fase acrescenta

```
                    Cloudflare (DNS, CDN, proteção DDoS) ─── R2: imagens das cartas, replays antigos
                       │  gumgumfight.app  (site, API, estáticos, música: em cache na borda)
                       │  img.gumgumfight.app  (R2)
                       │  play.gumgumfight.app / g1., g2. (canal das partidas: DNS direto, sem proxy)
                       ▼
                ┌───────────── VPS ─────────────────────────────────────────────┐
                │ Nginx (TLS, limites por IP, roteamento por sala)               │
                │   /api/online/rooms/<w>-<id>/*  → worker <w>  (map no Nginx)   │
                │   resto de /api/                → API/lobby                     │
                │                                                                 │
                │ API/lobby (Node): contas, decks, estatísticas, torneios, fila   │
                │ workers de jogo (Node, 1 por núcleo): salas, relógios, SSE      │
                │ Valkey: fila, presença, registro sala→worker, contadores        │
                │ Postgres: contas, decks, partidas, estatísticas, torneios       │
                │ SQLite por worker: salas em andamento (sobrevivem a reinício)   │
                └─────────────────────────────────────────────────────────────────┘
```

### Fase 2 — 1.500 a 10.000 salas, uma VPS maior (3–5 semanas)

O processo único passa a ser vários. É a única mudança estrutural grande do plano.

1. **Separar API/lobby dos workers de jogo.** O id da sala carrega o worker dono (`w3-AbC…`). O lobby escolhe o worker
   com menos salas no registro do Valkey e cria a sala nele por uma chamada interna. O Nginx roteia
   `/api/online/rooms/w3-…` para o worker 3 com um `map` sobre a URL, sem balanceador pago.
2. **Valkey** (Redis de código aberto, ~100 MB de memória): fila casual e ranqueada, presença do menu, registro
   sala→worker, contadores. Substitui os `Map` de `lobby.ts` que hoje só existem num processo.
3. **Postgres** na mesma VPS: migrar as quatro camadas de SQL (`db.ts`, `stats/store.ts`, `auth/store.ts`,
   `tournaments/store.ts`, mais `push/`, `reports/`, `tutorial/`). Backup diário com `pg_dump` para o R2.
4. **Salas em andamento num SQLite por worker**, gravando só a ação nova em vez da sala inteira a cada ação. A gravação
   cai de 0,49 ms para ~0,05 ms por ação e some a disputa de escrita entre processos.
5. **Fim de partida sem refazer o replay**: o worker já tem o estado; os fatos das estatísticas podem ser acumulados
   durante a partida. Corta os ~55 ms por partida.
6. **Deploy**: o pm2 sobe a API e N workers; reinício um worker por vez (as salas dele voltam do SQLite dele).

Capacidade por worker, com 1 espectador por sala e a CPU a 60%: **~1.900 salas por núcleo**. É uma conta
conservadora: com os itens 4 e 5 acima, a parte fixa de cada ação cai de 1,1 para ~0,6 ms e o número passa de 2.500.

| VPS | Workers | Salas | Memória usada |
|---|---|---|---|
| KVM 2 (2 vCPU, 8 GB) | 1 + API | ~2.000 | ~3 GB |
| KVM 4 (4 vCPU, 16 GB) | 3 + API | ~5.000 | ~7 GB |
| KVM 8 (8 vCPU, 32 GB) | 6 + API | ~10.000 | ~14 GB |

### Fase 3 — 10.000 a 20.000+ salas, várias VPS (1–2 semanas sobre a fase 2)

1. **Mais de uma VPS de jogo.** O lobby devolve a sala junto com o servidor (`g1.gumgumfight.app`, `g2.…`) e o navegador
   abre o canal direto nele. O jogo não passa por nenhum balanceador; só a API, se for preciso.
2. **Postgres e Valkey numa VPS própria** (KVM 2), com acesso só pela rede privada ou por túnel WireGuard.
3. **Balanceador para a API** só quando uma VPS de API não der conta: Cloudflare Load Balancing ou Hetzner LB11
   (~€7,49/mês). Com o cache e a paginação da fase 1, uma VPS de API aguenta muito.

Para 20 mil salas: ~6,2 núcleos para as partidas, ~1 para Nginx e TLS, ~1 para API, banco e menu, o que dá ~14 vCPU
para trabalhar a 60%. Isso é **2× KVM 8** para jogo e API, mais **1× KVM 2** para Postgres e Valkey. A banda fica em
~40 Mbit/s no pico e ~5 TB/mês, longe dos 64 TB das duas máquinas.

---

## 5. Imagens, música e estáticos

**Hoje** o navegador busca as imagens direto em `optcgapi.com` (JPEG de ~200 KB) e em `images.optcgleaks.com`
(spoilers). Com milhares de jogadores, esses sites podem limitar ou bloquear o acesso, e o jogo depende deles para
desenhar as cartas.

**Proposta**:

1. Um script, rodado depois de cada importação e de cada sincronização de spoilers, baixa cada imagem uma vez, gera
   duas versões em WebP e envia para um bucket R2:
   - `cards/<id>.webp`, 600 px, ~120 KB, para a carta ampliada;
   - `cards/<id>-300.webp`, 300 px, ~33 KB, para a mesa e o catálogo.
2. O bucket fica público pelo domínio `img.gumgumfight.app`, com cache longo na borda da Cloudflare.
3. `present.ts` troca a `imageUrl` pela do nosso domínio quando a imagem já foi espelhada; se não, mantém a original.
   O `CardView` usa a versão de 300 px na mesa e no catálogo e a de 600 px ao ampliar.
4. JS, CSS, música e efeitos (`/assets/*`, já com hash no nome e cache de 1 ano) passam a ser servidos da borda da
   Cloudflare só por o domínio estar com o proxy ligado. A VPS entrega cada arquivo uma vez por região.

| Item | Valor |
|---|---|
| Base completa estimada | ~3.500 cartas |
| Armazenamento das duas versões | ~550 MB |
| Plano gratuito do R2 | 10 GB/mês de armazenamento, 1 milhão de escritas, 10 milhões de leituras, saída grátis |
| Custo esperado | US$ 0 até o fim da fase 2; acima de 10 GB, US$ 0,015 por GB/mês |

**Cuidado jurídico**: hoje o site só aponta para imagens de terceiros; espelhá-las significa hospedar cópias da arte
da Bandai. O projeto é de fã e sem fins lucrativos, mas vale manter o aviso de direitos e atender rápido a qualquer
pedido de remoção.

**Canal das partidas e Cloudflare**: o proxy da Cloudflare repassa SSE, mas pode interferir na compressão e tem
tempo limite para conexões ociosas. Por isso o canal vai por um subdomínio só com DNS (`play.`, depois `g1.`, `g2.`),
direto para a VPS, e o resto do site pelo proxy. Testar na homologação antes de virar.

---

## 6. Alternativas avaliadas

| Opção | Veredito | Por quê |
|---|---|---|
| **Kubernetes** (k3s ou gerenciado) | **Não agora**; reavaliar acima de ~5 máquinas | Não resolve o que limita o jogo (salas em memória num processo, roteamento por sala). O k3s consome ~0,5–1 GB por nó, e o gerenciado cobra nós maiores. O deploy atual já tem rollback e as salas sobrevivem a reinícios. |
| **Balanceador de carga** | Só o roteamento por sala no Nginx (grátis); balanceador pago só para a API na fase 3 | Um balanceador comum distribui por igual, mas cada sala precisa ir sempre ao processo que a guarda. |
| **Postgres** | **Sim, na fase 2**, na própria VPS | Vários processos escrevendo; consultas de estatísticas maiores; backup contínuo. Banco gerenciado custa mais do que a VPS inteira nessa escala. |
| **Valkey/Redis** | **Sim, na fase 2** | Fila, presença e registro de salas compartilhados entre processos. |
| **WebSocket no lugar de SSE + POST** | Não por enquanto | Economizaria o custo HTTP de cada ação (~0,4 ms estimado), mas é uma reescrita do transporte; com a compressão, o SSE fica barato. Reavaliar na fase 3. |
| **Cloudflare (DNS, CDN, R2)** | **Sim, já na fase 1** | Grátis, tira estáticos e imagens da VPS, protege contra DDoS. |
| **Hetzner** | Não vale a migração agora | Subiu os preços duas vezes em 2026, alguns planos ARM aparecem indisponíveis, e só a região da UE inclui 20 TB. Com a compressão, o tráfego deixou de ser o critério. |
| **Oracle Cloud Always Free** (4 núcleos ARM, 24 GB, ~10 TB de saída) | **Sim para homologação e testes de carga**; não para produção | Grátis e grande, mas a Oracle pode recolher instâncias ociosas e a capacidade gratuita nem sempre está disponível. O pacote do app já roda em ARM. |

---

## 7. Gatilhos para mudar de fase

Registrar uma linha por minuto no log (ou em `GET /api/admin/metrics`, só para Admin) com: salas ativas por fila,
conexões SSE, ações por segundo, CPU e RSS do processo, atraso do event loop (`monitorEventLoopDelay`), bytes por
segundo do canal, e quantos 429 e 503 os tetos devolveram.

| Sinal sustentado por 15 min no pico | Ação |
|---|---|
| Salas ativas > 70% do `ONLINE_MAX_ROOMS` | subir o teto, se CPU e memória permitirem |
| CPU do processo > 50% | KVM 1 → KVM 2; já com mais de um núcleo, começar a fase 2 |
| Atraso do event loop p99 > 50 ms | procurar a consulta lenta; se for carga, fase 2 |
| RSS > 70% do `PM2_MAX_MEMORY` | subir o limite junto com a VPS |
| 503 de "servidor cheio" aparecendo | o teto está segurando a carga: mudar de fase |
| Tráfego do mês > 60% do plano | conferir se a compressão está ativa e se as imagens vêm do CDN |

---

## 8. Custos por fase

Preços da Hostinger em USD por mês, promoção no plano de vários anos → renovação, segundo sites de comparação em
outubro de 2026. Confira no painel antes de contratar.

| Fase | Salas | Hostinger | Cloudflare + R2 | Total/mês |
|---|---|---|---|---|
| 1 | até 1.500 | KVM 1 (já contratado) | US$ 0 | **US$ 6,49 → 11,99** |
| 2a | até 2.000 | KVM 2 | US$ 0 | US$ 8,99 → 14,99 |
| 2b | até 5.000 | KVM 4 | US$ 0 | US$ 12,99 → 28,99 |
| 2c | até 10.000 | KVM 8 | US$ 0 | US$ 25,99 → 49,99 |
| 3 | até 20.000 | 2× KVM 8 + KVM 2 | US$ 0–5 | **US$ 60,97 → 114,97** |

Homologação e testes de carga: Oracle Always Free (US$ 0) ou o servidor de homologação atual.

---

## 9. Ordem de execução sugerida

1. Fase 1, itens 1 a 3 (compressão, lista paginada, contadores em cache): maior ganho, menos risco.
2. Fase 1, itens 4 e 5 (Cloudflare + R2, cache por tempo).
3. Fase 1, itens 6 a 8 (tetos, métricas, teste de carga) e rodar o teste de 1.000 salas na homologação.
4. Acompanhar os gatilhos da seção 7. A fase 2 começa quando o primeiro gatilho de CPU aparecer, não antes.

## Limites deste plano

- A CPU foi medida num servidor de nuvem de 4 núcleos; a vCPU da Hostinger pode ser mais lenta. Os gatilhos da seção
  7 corrigem isso na prática.
- O custo HTTP de cada ação (~0,4 ms) e o do TLS no Nginx são estimativas, não medições.
- A média de 1 espectador por sala é uma suposição. Com 3, a CPU por sala sobe ~20% e a banda ~70%, ainda pequena
  com a compressão.
- Os números de tráfego mensal supõem que o pico dura ~35% do dia.
