"""Monta os trailers (16:9 e 9:16) e os GIFs a partir das gravações em $SAIDA.

Os cortes (CORTES) valem para o replay padrão do gerar.sh (Luffy OP17 x Rocks.D.Xebec OP17, seed 4) gravado em 1x:
com outro replay, ou se o motor ou as animações mudarem, confira os tempos numa folha de quadros
(ffmpeg -i partida-16x9.mp4 -vf fps=1,scale=240:-2,tile=8x6 folha%02d.png) e ajuste aqui.
Uso: python3 montar.py
"""
import os
import subprocess

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.environ.get('SAIDA', os.path.join(AQUI, 'saida'))
MUSICA = os.path.join(AQUI, '../../apps/web/src/assets/audio/music/battle.mp3')  # "Valsa do Mar", composição original
os.chdir(SAIDA)

# (gravação, início, fim, legenda): 'partida' é partida-<formato>.mp4; 'spoilers' é o fluxo-spoilers.mp4 (só em 16:9:
# no trailer vertical entra a parte do catálogo com o detalhe da carta, ampliada, sobre o fundo do GumGum).
CORTES = [
    ('partida', 5.0, 10.5, 1),      # começo: as primeiras cartas na mesa
    ('partida', 17.0, 21.5, None),  # primeiro ataque no Líder
    ('partida', 51.5, 56.0, 2),     # Kaido entra atacando
    ('spoilers', 2.6, 9.2, 6),      # "Só spoilers" no construtor e o detalhe de uma carta não lançada
    ('partida', 120.5, 125.5, None),  # Loki com 8000 e K.O.
    ('partida', 151.5, 156.5, 3),   # Edward.Newgate com 10000
    ('partida', 165.5, 170.0, 4),   # Luffy com 10000 e K.O.
    ('partida', 223.5, 233.0, 5),   # o golpe final e a vitória
]
# Partes da partida usadas nos GIFs.
GIF_PARTIDA = [(17.0, 21.5), (51.5, 56.0), (224.0, 231.0)]
GIF_PARTIDA_CELULAR = [(51.5, 56.0), (224.0, 231.0)]
FUSAO = 0.35
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30']


def ff(*args):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def trailer(fmt):
    W, H = (1920, 1080) if fmt == '16x9' else (1080, 1920)
    legY = 40 if fmt == '16x9' else 120
    src = f'partida-{fmt}.mp4'
    os.makedirs(f'cortes-{fmt}', exist_ok=True)
    segs = []
    out = f'cortes-{fmt}/00.mp4'
    ff('-loop', '1', '-t', '3', '-i', f'abertura-{fmt}.png', '-vf', f'scale={W}:{H},fade=in:st=0:d=0.5', *ENC, out)
    segs.append((out, 3))
    for i, (rec, a, b, leg) in enumerate(CORTES, 1):
        d = b - a
        out = f'cortes-{fmt}/{i:02d}.mp4'
        video = src if rec == 'partida' else f'fluxo-{rec}.mp4'
        base = '[0:v]'
        pre = ''
        if rec != 'partida' and fmt == '9x16':
            # O catálogo com o detalhe da carta (a parte esquerda do construtor), ampliado no meio da tela vertical.
            pre = f'[0:v]crop=1250:1080:0:0,scale={W}:-2[fg];[2:v][fg]overlay=0:(H-h)/2+60[base];'
            base = '[base]'
        if leg:
            fundo = ['-loop', '1', '-t', str(d), '-i', 'fundo-9x16.png'] if pre else []
            ff('-ss', str(a), '-t', str(d), '-i', video, '-loop', '1', '-t', str(d), '-i', f'legenda-{leg}-{fmt}.png', *fundo, '-filter_complex',
               f'{pre}[1]format=rgba,fade=in:st=0.25:d=0.35:alpha=1,fade=out:st={d - 0.6}:d=0.35:alpha=1[c];{base}[c]overlay=(W-w)/2:{legY}', *ENC, out)
        else:
            ff('-ss', str(a), '-t', str(d), '-i', video, *ENC, out)
        segs.append((out, d))
    out = f'cortes-{fmt}/99.mp4'
    ff('-loop', '1', '-t', '4.5', '-i', f'fim-{fmt}.png', '-vf', f'scale={W}:{H},fade=out:st=4:d=0.5', *ENC, out)
    segs.append((out, 4.5))
    inputs = sum([['-i', s] for s, _ in segs], [])
    fc, last, off = [], '0:v', 0.0
    for i in range(1, len(segs)):
        off += segs[i - 1][1] - FUSAO
        fc.append(f'[{last}][{i}:v]xfade=transition=fade:duration={FUSAO}:offset={off:.3f}[v{i}]')
        last = f'v{i}'
    total = sum(d for _, d in segs) - FUSAO * (len(segs) - 1)
    fc.append(f'[{len(segs)}:a]atrim=0:{total:.3f},afade=in:st=0:d=1,afade=out:st={total - 2.5:.3f}:d=2.5,volume=0.9[a]')
    ff(*inputs, '-stream_loop', '-1', '-i', MUSICA, '-filter_complex', ';'.join(fc), '-map', f'[{last}]', '-map', '[a]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
       '-c:a', 'aac', '-b:a', '160k', f'trailer-{fmt}.mp4')


def gif(src, out, width, fps=12, colors=192, vf=''):
    ff('-i', src, '-filter_complex',
       f'[0:v]{vf}fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];'
       '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', out)


trailer('16x9')
trailer('9x16')

def junta(src, partes, out):
    args = sum([['-ss', str(a), '-t', str(b - a), '-i', src] for a, b in partes], [])
    entradas = ''.join(f'[{k}:v]' for k in range(len(partes)))
    ff(*args, '-filter_complex', f'{entradas}concat=n={len(partes)}:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', out)


# GIFs (até ~5 MB cada, para caber no editor da Apoia.se).
junta('partida-16x9.mp4', GIF_PARTIDA, 'gif-partida.mp4')
gif('gif-partida.mp4', 'gif-partida.gif', 680, fps=10, colors=128)
junta('partida-9x16.mp4', GIF_PARTIDA_CELULAR, 'gif-partida-celular.mp4')
gif('gif-partida-celular.mp4', 'gif-partida-celular.gif', 360)
gif('fluxo-tutorial.mp4', 'gif-tutorial.gif', 800, vf='trim=2.2:18.8,setpts=(PTS-STARTPTS)/1.35,')
gif('fluxo-builder.mp4', 'gif-deckbuilder.gif', 800, vf='trim=0.5:18.6,setpts=(PTS-STARTPTS)/1.4,')
gif('fluxo-spoilers.mp4', 'gif-spoilers.gif', 800, vf='trim=1.0:22.8,setpts=(PTS-STARTPTS)/1.4,')
gif('fluxo-home.mp4', 'gif-home.gif', 800)
