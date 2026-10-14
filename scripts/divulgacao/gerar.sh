#!/usr/bin/env bash
# Gera o material de divulgação (Apoia.se e redes sociais) a partir do site rodando localmente.
# Pré-requisitos: ffmpeg, Xvfb (xvfb-run) e o Playwright com o Chromium (npm i --no-save playwright), e as
# coleções no banco (npm run cards:import -- --all): a partida padrão usa os decks de OP17 de decks/.
# O site precisa estar no ar SEM as imagens oficiais das cartas:
#   CARD_IMAGES=off npm run dev
# Resultado em scripts/divulgacao/saida/ (fora do git). Uso: bash scripts/divulgacao/gerar.sh
#
# Versão com as artes oficiais (cartas, verso e DON!!): site com CARD_IMAGES=on e
#   ARTE=oficial bash scripts/divulgacao/gerar.sh          (resultado em saida-oficial/)
# Só algumas etapas: ETAPAS="5 6" bash scripts/divulgacao/gerar.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
if [ "${ARTE:-}" = oficial ]; then export SAIDA="${SAIDA:-$AQUI/saida-oficial}"; else export SAIDA="${SAIDA:-$AQUI/saida}"; fi
export ARTE="${ARTE:-}"
ETAPAS=" ${ETAPAS:-1 2 3 4 5 6} "
mkdir -p "$SAIDA"
cd "$AQUI"
XVFB=(xvfb-run -a -s "-screen 0 2000x2200x24")
etapa() { [[ "$ETAPAS" == *" $1 "* ]]; }
# Duração da gravação da partida (s) e os quadros das peças: valem para o replay-padrao.json (veja montar.py).
SEGUNDOS="${SEGUNDOS:-268}"
QUADRO_MESA="${QUADRO_MESA:-223}"
QUADRO_VERTICAL="${QUADRO_VERTICAL:-226}"

if etapa 1; then
  echo "1/6 Verso e DON!! do GumGum, aberturas, legendas, planos e perfil"
  node imagens.mjs base
fi

if etapa 2; then
  echo "2/6 Replay da partida (Luffy OP17 x Rocks.D.Xebec OP17)"
  # Os cortes de montar.py valem para o replay-padrao.json. Para outra partida: REPLAY=arquivo.json (veja gerar-replay.mts).
  cp "${REPLAY:-$AQUI/replay-padrao.json}" "$SAIDA/replay.json"
fi

if etapa 3; then
  echo "3/6 Gravando a partida em 16:9 e em 9:16 (cerca de 10 minutos)"
  "${XVFB[@]}" node gravar.mjs replay "$SAIDA/replay.json" "$SAIDA/partida-16x9.mp4" 1920 1080 1.5 1 "$SEGUNDOS"
  "${XVFB[@]}" node gravar.mjs replay "$SAIDA/replay.json" "$SAIDA/partida-9x16.mp4" 1080 1920 2 1 "$SEGUNDOS"
fi

if etapa 4; then
  echo "4/6 Gravando a home, o tutorial, o construtor de decks e os spoilers"
  for f in home tutorial builder spoilers; do "${XVFB[@]}" node gravar.mjs fluxo "$f" "$SAIDA/fluxo-$f.mp4"; done
fi

if etapa 5; then
  echo "5/6 Banner, post e story"
  ffmpeg -loglevel error -y -ss "$QUADRO_MESA" -i "$SAIDA/partida-16x9.mp4" -frames:v 1 -vf "crop=1410:905:0:0" "$SAIDA/mesa.png"
  ffmpeg -loglevel error -y -ss "$QUADRO_VERTICAL" -i "$SAIDA/partida-9x16.mp4" -frames:v 1 "$SAIDA/mesa-vertical.png"
  ffmpeg -loglevel error -y -ss 0.5 -i "$SAIDA/fluxo-home.mp4" -frames:v 1 "$SAIDA/home.png"
  node imagens.mjs pecas
fi

if etapa 6; then
  echo "6/6 Trailers e GIFs"
  python3 montar.py
fi
echo "Pronto: $SAIDA"
