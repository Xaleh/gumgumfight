#!/usr/bin/env bash
# Gera o material de divulgação (Apoia.se e redes sociais) a partir do site rodando localmente.
# Pré-requisitos: ffmpeg, Xvfb (xvfb-run) e o Playwright com o Chromium (npm i --no-save playwright).
# O site precisa estar no ar SEM as imagens oficiais das cartas:
#   CARD_IMAGES=off npm run dev
# Resultado em scripts/divulgacao/saida/ (fora do git). Uso: bash scripts/divulgacao/gerar.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
export SAIDA="${SAIDA:-$AQUI/saida}"
mkdir -p "$SAIDA"
cd "$AQUI"
XVFB=(xvfb-run -a -s "-screen 0 2000x2200x24")

echo "1/6 Verso e DON!! do GumGum, aberturas, legendas, planos e perfil"
node imagens.mjs base

echo "2/6 Replay da partida (Luffy ST01 x Kid ST10)"
# Os cortes de montar.py valem para o replay-padrao.json. Para outra partida: REPLAY=arquivo.json (veja gerar-replay.mts).
cp "${REPLAY:-$AQUI/replay-padrao.json}" "$SAIDA/replay.json"

echo "3/6 Gravando a partida em 16:9 e em 9:16 (cerca de 7 minutos)"
"${XVFB[@]}" node gravar.mjs replay "$SAIDA/replay.json" "$SAIDA/partida-16x9.mp4" 1920 1080 1.5 1 212
"${XVFB[@]}" node gravar.mjs replay "$SAIDA/replay.json" "$SAIDA/partida-9x16.mp4" 1080 1920 2 1 212

echo "4/6 Gravando a home, o tutorial e o construtor de decks"
for f in home tutorial builder; do "${XVFB[@]}" node gravar.mjs fluxo "$f" "$SAIDA/fluxo-$f.mp4"; done

echo "5/6 Banner, post e story"
ffmpeg -loglevel error -y -ss 44.5 -i "$SAIDA/partida-16x9.mp4" -frames:v 1 -vf "crop=1410:905:0:0" "$SAIDA/mesa.png"
ffmpeg -loglevel error -y -ss 34 -i "$SAIDA/partida-9x16.mp4" -frames:v 1 "$SAIDA/mesa-vertical.png"
ffmpeg -loglevel error -y -ss 0.5 -i "$SAIDA/fluxo-home.mp4" -frames:v 1 "$SAIDA/home.png"
node imagens.mjs pecas

echo "6/6 Trailers e GIFs"
python3 montar.py
echo "Pronto: $SAIDA"
