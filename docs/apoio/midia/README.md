# Mídia da campanha (Apoia.se e redes sociais)

Peças prontas para a página da Apoia.se e para o post de inauguração. As imagens estão nesta pasta; os GIFs e os
vídeos são pesados demais para o git e saem do gerador (`bash scripts/divulgacao/gerar.sh`, detalhes abaixo).

Nada aqui usa arte oficial: as cartas aparecem sem as imagens da Bandai (o site gravado com `CARD_IMAGES=off`), e o
verso das cartas e a carta de DON!! (que no site são as artes oficiais) foram trocados por versões do GumGum só na
gravação. A música dos vídeos é a "Valsa do Mar", composição original do projeto (`scripts/audio/compose.py`).

## Imagens (nesta pasta)

| Arquivo | Tamanho | Onde usar |
|---|---|---|
| `banner-apoiase.jpg` | 3200 × 600 (o dobro de 1600 × 300, para telas nítidas) | Imagem de capa da campanha (Editar campanha → Identificação). A Apoia.se recomenda 1600 × 300 e até 5 MB |
| `perfil-512.png` | 512 × 512 | Foto de perfil da campanha |
| `planos.jpg` | 1600 × 900 | Dentro do texto "Sobre", na seção dos planos |
| `post-inauguracao-1080.jpg` | 1080 × 1080 | Post de inauguração (Apoia.se, Instagram, Discord) |
| `story-inauguracao-1080x1920.jpg` | 1080 × 1920 | Stories do Instagram e status do WhatsApp |

## GIFs e vídeos (gerados)

| Arquivo | Tamanho | Onde usar |
|---|---|---|
| `gif-partida.gif` | 680 px, ~16 s, ~4 MB | Topo do texto "Sobre": ataques, K.O. e a vitória |
| `gif-partida-celular.gif` | 360 × 640, ~11 s, ~3 MB | Seção "Por que esta página existe" (mostra que roda no celular) |
| `gif-tutorial.gif` | 800 px, ~12 s, ~3 MB | Seção do que dá para fazer: a lição 1 do tutorial até a vitória |
| `gif-deckbuilder.gif` | 800 px, ~13 s, ~1,5 MB | Seção do que dá para fazer: montando um deck |
| `gif-home.gif` | 800 px, ~9 s, ~2 MB | Opcional: os modos de jogo da página inicial |
| `trailer-16x9.mp4` | 1920 × 1080, ~42 s, com música | Vídeo da campanha (subir no YouTube e colar o link na Apoia.se) |
| `trailer-9x16.mp4` | 1080 × 1920, ~41 s, com música | Reels, Shorts e TikTok |

Os trailers abrem com o logo, mostram uma partida real (Luffy x Kid) com as legendas "Treine contra o bot",
"Jogue online", "Torneios da comunidade", "Reveja cada jogada" e "Grátis. Sem anúncios." e fecham com
"Jogue grátis: gumgumfight.app" e o convite para apoiar.

## Como gerar de novo

Quando o site mudar (tela nova, layout novo), é só rodar o gerador outra vez:

```bash
npm i --no-save playwright          # uma vez; precisa também de ffmpeg e Xvfb (xvfb-run)
CARD_IMAGES=off npm run dev         # em outro terminal: o site sem as imagens oficiais
bash scripts/divulgacao/gerar.sh    # ~15 minutos; tudo sai em scripts/divulgacao/saida/
```

Versão com as artes oficiais (cartas, verso e DON!!, como o jogador vê no site), para comparar: suba o site com
`CARD_IMAGES=on npm run dev` e rode `ARTE=oficial bash scripts/divulgacao/gerar.sh`. O resultado sai em
`scripts/divulgacao/saida-oficial/`. As imagens da optcgapi vêm com a marca d'água "SAMPLE" em cada carta.

O que cada parte faz:

- `gerar-replay.mts`: joga uma partida bot x bot (Luffy ST01 x Kid ST10, seed 2: Luffy vence com 1 de Vida) e salva
  o replay.
- `gravar.mjs`: abre o site num Chromium com janela de verdade (Xvfb) e grava com o ffmpeg em 1920 × 1080 e
  1080 × 1920 a 30 fps: o replay no "Assistir replay" e os fluxos da home, do tutorial e do construtor.
- `imagens.mjs`: desenha as peças em HTML (`modelos/`): verso e DON!! do GumGum, banner, post, story, planos,
  perfil, aberturas e legendas dos trailers.
- `montar.py`: corta os melhores momentos, junta com as aberturas e a música e gera os trailers e os GIFs. Os tempos
  dos cortes valem para o replay padrão; se o motor ou as animações mudarem, confira e ajuste a lista `CORTES`.

Textos, planos ou cores mudaram? Edite o HTML em `scripts/divulgacao/modelos/` e rode só `node
scripts/divulgacao/imagens.mjs base` (e `pecas`, com as gravações já feitas).
