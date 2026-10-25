#!/usr/bin/env python3
"""Corta a narração (uma geração por vídeo, com pausas longas entre os trechos) em um arquivo por trecho."""
import json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
vid, src = sys.argv[1], sys.argv[2]
ids = json.load(open(f'{ROOT}/prompts.json'))[vid]['ids']
out = f'{ROOT}/narr/{vid}'
os.makedirs(out, exist_ok=True)
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout)
log = subprocess.run(['ffmpeg', '-i', src, '-af', 'silencedetect=noise=-42dB:d=0.25', '-f', 'null', '-'], capture_output=True, text=True).stderr
starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
sil = [(s, e) for s, e in zip(starts, ends) if s > 0.05 and e < dur - 0.05]
need = len(ids) - 1
longest = sorted(sorted(sil, key=lambda x: x[1] - x[0], reverse=True)[:need])
gaps = [round(e - s, 2) for s, e in longest]
print('pausas escolhidas:', gaps, '| próxima maior:', sorted([round(e - s, 2) for s, e in sil], reverse=True)[need:need + 2])
assert len(longest) == need, 'pausas insuficientes'
bounds = [0.0] + [x for s, e in longest for x in (s, e)] + [dur]
durations = {}
for i, id_ in enumerate(ids):
    a, b = bounds[2 * i], bounds[2 * i + 1]
    a = max(0, a - 0.05); b = min(dur, b + 0.12)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.05', '-ar', '48000', '-ac', '2', f'{out}/{id_}.wav'], check=True)
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{out}/{id_}.wav'], capture_output=True, text=True).stdout)
    durations[id_] = round(d, 3)
json.dump({'durations': durations}, open(f'{ROOT}/narr/{vid}.json', 'w'), indent=1)
print(vid, durations, 'total', round(sum(durations.values()), 1))
