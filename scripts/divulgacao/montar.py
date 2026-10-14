"""Monta os trailers (16:9 e 9:16) e os GIFs a partir das gravações em $SAIDA.

Os cortes (CORTES) valem para o replay padrão do gerar.sh (Luffy ST01 x Kid ST10, seed 2) gravado em 1x:
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

# (início, fim, legenda) em segundos da gravação da partida.
CORTES = [(3.0, 9.0, 1), (19.5, 24.0, None), (31.5, 37.5, 2), (95.0, 100.0, None), (150.5, 154.0, 3), (170.5, 175.0, 4), (186.5, 194.0, 5)]
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
    for i, (a, b, leg) in enumerate(CORTES, 1):
        d = b - a
        out = f'cortes-{fmt}/{i:02d}.mp4'
        if leg:
            ff('-ss', str(a), '-t', str(d), '-i', src, '-loop', '1', '-t', str(d), '-i', f'legenda-{leg}-{fmt}.png', '-filter_complex',
               f'[1]format=rgba,fade=in:st=0.25:d=0.35:alpha=1,fade=out:st={d - 0.6}:d=0.35:alpha=1[c];[0][c]overlay=(W-w)/2:{legY}', *ENC, out)
        else:
            ff('-ss', str(a), '-t', str(d), '-i', src, *ENC, out)
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

# GIFs (até ~5 MB cada, para caber no editor da Apoia.se).
ff('-ss', '19.5', '-t', '4.5', '-i', 'partida-16x9.mp4', '-ss', '31.5', '-t', '6', '-i', 'partida-16x9.mp4', '-ss', '186.5', '-t', '6', '-i', 'partida-16x9.mp4',
   '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', 'gif-partida.mp4')
gif('gif-partida.mp4', 'gif-partida.gif', 680, fps=10, colors=128)
ff('-ss', '31.5', '-t', '5.5', '-i', 'partida-9x16.mp4', '-ss', '186.5', '-t', '6', '-i', 'partida-9x16.mp4',
   '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', 'gif-partida-celular.mp4')
gif('gif-partida-celular.mp4', 'gif-partida-celular.gif', 360)
gif('fluxo-tutorial.mp4', 'gif-tutorial.gif', 800, vf='trim=2.2:18.8,setpts=(PTS-STARTPTS)/1.35,')
gif('fluxo-builder.mp4', 'gif-deckbuilder.gif', 800, vf='trim=0.5:19.2,setpts=(PTS-STARTPTS)/1.4,')
gif('fluxo-home.mp4', 'gif-home.gif', 800)
