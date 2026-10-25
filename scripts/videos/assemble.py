#!/usr/bin/env python3
"""Monta o MP4 final: frames do screencast + narração + música e efeitos que o app tocou."""
import glob, json, os, random, re, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.abspath(os.path.join(ROOT, '../../apps/web/src/assets/audio'))
SR = 48000
random.seed(7)

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()

_cache = {}
def load(path):
    if path not in _cache: _cache[path] = decode(path)
    return _cache[path]

# Níveis finais: narração a −16 LUFS; música (as faixas têm −15 LUFS) quase inaudível, a uns −40 LUFS
# sob a fala e −34 nos intervalos; efeitos (≈ −25 LUFS) um pouco abaixo da voz.
NARRATION_LUFS = -16.0
MUSIC_GAP, MUSIC_SPEECH = 10 ** (-19 / 20), 10 ** (-25 / 20)
SFX_GAIN = 0.6

def loudness(buf):
    raw = buf.astype(np.float32).tobytes()
    log = subprocess.run(['ffmpeg', '-v', 'info', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-af', 'ebur128', '-f', 'null', '-'], input=raw, capture_output=True).stderr.decode()
    vals = re.findall(r'I:\s+(-?[\d.]+) LUFS', log)
    return float(vals[-1]) if vals else None

curve = lambda v: max(0.0, min(1.0, v)) ** 2

def add(buf, clip, t, gain=1.0):
    i = int(round(t * SR))
    if i >= len(buf): return
    if i < 0: clip, i = clip[-i:], 0
    n = min(len(clip), len(buf) - i)
    buf[i:i + n] += clip[:n] * gain

def main(vid, out_name=None):
    d = json.load(open(f'{ROOT}/out/{vid}/timeline.json'))
    end = d['end']
    n = int(end * SR) + 1
    narr = np.zeros((n, 2), np.float32)
    sfx = np.zeros((n, 2), np.float32)
    speech_mask = np.zeros(n, np.float32)

    # Narração
    ndir = f'{ROOT}/narr/{vid}'
    for s in d['segs']:
        f = f'{ndir}/{s["id"]}.wav'
        if os.path.exists(f):
            clip = load(f)
            t = s['start'] + 0.2
            add(narr, clip, t, 1.0)
            a, b = int(t * SR), min(n, int((t + len(clip) / SR) * SR))
            speech_mask[a:b] = 1

    # Volumes ao longo do tempo
    vols = [(-1e9, 0.8, 0.5)]
    music_events = []
    for e in d['audio']:
        if e['k'] == 'vol': vols.append((e['t'], e['sfx'], e['music']))
        elif e['k'] == 'unlock' and e.get('wanted'): music_events.append((0.0 if not music_events else e['t'], e['wanted']))
        elif e['k'] == 'music': music_events.append((e['t'], e['name']))
    for k, ev in enumerate(d.get('marks', [])):
        if ev['name'].startswith('music:'): music_events.append((ev['t'], ev['name'][6:] or None))
    music_events.sort()
    def vol_at(t):
        cur = vols[0]
        for v in vols:
            if v[0] <= t: cur = v
        return cur

    # Efeitos (variação sorteada, como o app faz)
    for e in d['audio']:
        if e['k'] != 'sfx': continue
        name = e['name']
        files = sorted(glob.glob(f'{AUDIO}/sfx/{name}-*.mp3')) or glob.glob(f'{AUDIO}/sfx/{name}.mp3')
        if not files:
            files = {'win': ['music/win.mp3'], 'lose': ['music/lose.mp3'], 'tie': ['music/draw.mp3']}.get(name, [])
            files = [f'{AUDIO}/{f}' for f in files]
        if not files: continue
        _, vs, _ = vol_at(e['t'])
        add(sfx, load(random.choice(files)), e['t'] + e.get('delay', 0) / 1000, SFX_GAIN * curve(vs) / curve(0.8) * e.get('gain', 1))

    # Música: faixa pedida em loop, com volume do app e abaixando sob a narração
    music = np.zeros((n, 2), np.float32)
    if music_events:
        first = music_events[0][0]
        music_events[0] = (0.0 if first < 4.0 else first, music_events[0][1])
        bounds = music_events + [(end, None)]
        for (t1, name), (t2, _) in zip(bounds, bounds[1:]):
            if not name or t2 <= t1: continue
            track = load(f'{AUDIO}/music/{name}.mp3')
            a, b = int(t1 * SR), int(t2 * SR)
            reps = (b - a) // len(track) + 1
            seg = np.tile(track, (reps, 1))[: b - a].copy()
            fade = min(int(0.9 * SR), len(seg))
            seg[:fade] *= np.linspace(0, 1, fade)[:, None]
            music[a:b] += seg
        # ganho por amostra: volume do app (com suavização) e ducking
        times = np.arange(n) / SR
        g = np.zeros(n, np.float32)
        pts = sorted(vols)
        for i, (t, _, vm) in enumerate(pts):
            t_next = pts[i + 1][0] if i + 1 < len(pts) else end + 1
            a, b = max(0, int(t * SR)), min(n, int(t_next * SR))
            if b > a: g[a:b] = curve(vm) / curve(0.5)
        # suaviza 80 ms
        k = int(0.08 * SR)
        g = np.convolve(g, np.ones(k) / k, mode='same').astype(np.float32)
        duck = np.convolve(speech_mask, np.ones(int(0.4 * SR)) / int(0.4 * SR), mode='same').astype(np.float32)
        # quase inaudível: um fundo bem baixo, ainda menor sob a narração
        level = MUSIC_GAP - (MUSIC_GAP - MUSIC_SPEECH) * duck
        music *= (g * level)[:, None]

    lufs = loudness(narr) if speech_mask.any() else None
    if lufs is not None and lufs > -70: narr *= 10 ** ((NARRATION_LUFS - lufs) / 20)
    mix = narr + sfx + music
    # fade final
    f = int(0.6 * SR)
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    wav = f'{ROOT}/out/{vid}/mix.f32'
    mix.astype(np.float32).tofile(wav)

    # Vídeo: frames com as durações reais
    frames = d['frames']
    lst = f'{ROOT}/out/{vid}/frames.txt'
    with open(lst, 'w') as fh:
        for i, fr in enumerate(frames):
            t_next = frames[i + 1]['t'] if i + 1 < len(frames) else end
            dur = max(0.001, t_next - max(0, fr['t'])) if i else max(0.001, t_next)
            fh.write(f"file 'frames/{fr['file']}'\nduration {dur:.4f}\n")
        fh.write(f"file 'frames/{frames[-1]['file']}'\n")
    os.makedirs(f'{ROOT}/final', exist_ok=True)
    out = f'{ROOT}/final/{out_name or vid}.mp4'
    # Cabe no limite de 16 MB do WhatsApp
    kbps = int(min(3500, max(900, 15.0 * 8192 / end - 140)))
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y',
        '-f', 'concat', '-safe', '0', '-i', lst,
        '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', wav,
        '-vf', 'fps=30,scale=1080:1920:flags=lanczos,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '21',
        '-maxrate', f'{kbps}k', '-bufsize', f'{kbps * 2}k',
        '-af', 'alimiter=limit=0.89:level=false', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-t', f'{end:.3f}', out,
    ], check=True, cwd=f'{ROOT}/out/{vid}')
    size = os.path.getsize(out) / 1e6
    print(f'{out}: {end:.1f}s, {size:.1f} MB')

if __name__ == '__main__':
    main(*sys.argv[1:])
