# Vídeos curtos do app (WhatsApp)

Vídeos verticais (1080×1920, H.264/AAC, menos de 16 MB cada) gravados do app rodando localmente, com moldura
de celular, título, legendas, toque visível, música e efeitos do próprio app e narração. Os prontos ficam em
[`docs/videos/`](../../docs/videos).

| # | Vídeo | O que mostra |
|---|---|---|
| 1 | `1-apelido.mp4` | Apelido ✎ na home → Configurações → digitar → Salvar → nome na home e na mesa |
| 2 | `2-animacoes.mp4` | Partida com animações (dados, cartas voando, faixa de turno) → desmarcar no menu da partida → mesma partida sem animações |
| 3 | `3-chat.mp4` | Sala privada com um segundo jogador: 💬, mensagens rápidas, texto, balões, Silenciar e "Chat do oponente" desligado |
| 4 | `4-sons.mp4` | Barras e mudo de Música e Efeitos no menu da partida (o som do vídeo segue os controles) |
| 5 | `5-notificacoes.mp4` | Ligar Notificações, pedido de permissão, escolhas, avisos simulados com o app fechado e o toque abrindo o torneio |
| 6 | `6-counter.mp4` | Counter padrão (marcar e confirmar) e "Counter sem confirmação" (um toque) |
| 7 | `7-trailer.mp4` | Partida, importação de lista, montagem de deck e lobby de torneio com as mesas enchendo |
| 8 | `8-inscricao.mp4` | Ver torneios → página do torneio → Escolher deck (Meus decks) → Usar este deck → Inscrever-se → Fazer check-in |

Todos têm narração (ElevenLabs, voz "Renan Matheus"); os áudios usados ficam em `raw/`. Sem narração em
`narr/<video>.json`, o vídeo sai com o texto inteiro da fala na legenda.

## Como gerar

Com o app no ar (`npm run dev` na raiz), de preferência com o banco recém-criado antes de cada vídeo: os vídeos
de torneio criam torneios de teste, que aparecem na home dos seguintes.

1. `node prompts.cjs` gera `prompts.json` com o texto de cada vídeo: os trechos (`SEGS` em `videos/*.cjs`)
   separados por `<break time="1.6s" />`.
2. Narração: gere o áudio do texto de `prompts.json` (ElevenLabs, modelo `eleven_multilingual_v2`, voz
   "Renan Matheus") e salve em `raw/<video>-1.mp3`. `python3 split_narr.py <video> raw/<video>-1.mp3` corta nas
   pausas longas e grava `narr/<video>.json` com a duração de cada trecho.
3. `node run.cjs <video>` grava: cada trecho dura o tempo da sua fala (sem narração, o tempo de leitura da legenda).
4. `python3 assemble.py <video>` monta `final/<video>.mp4` (frames do screencast, narração, música e efeitos
   registrados no app, volume normalizado em −16 LUFS).
5. `./sheet.sh <video> 3 10 20 …` tira quadros lado a lado para conferir.

## Como funciona

- `lib/frame.html`: a moldura (título, celular, legenda, selos "COM/SEM…", notificações e pedido de permissão
  simulados, tela de bloqueio, cartão de abertura).
- `lib/rec.cjs`: abre a moldura com o app num iframe (390×820), grava pelo screencast do Chromium e registra
  os sons que o app pediu (`audio.play`, `audio.music`, `audio.setVolumes`) para remixar depois.
- `lib/game.cjs`: ajudas da mesa (quem começa, dados, mão inicial, menu da partida, esperar o Counter).
- `lib/tour.cjs`: torneio de demonstração. Cria usuários e sessões direto no banco local (o login com Google
  fica desligado em desenvolvimento) e usa a API para criar, inscrever, marcar prontos e entrar nas salas.
- O vídeo de notificações simula o push (o Chromium de teste não tem serviço de push); os avisos usam os
  textos reais de `apps/server/src/push/messages.ts`.
