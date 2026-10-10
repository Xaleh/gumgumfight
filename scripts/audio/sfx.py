"""Converte os efeitos escolhidos (CC0) para MP3 mono, aparados e normalizados."""
import json, os, subprocess, sys

DL = sys.argv[1]
OUT = sys.argv[2]
K = lambda pack, name: f"{DL}/{pack}/Audio/{name}.ogg"
C = lambda name: f"{DL}/oga-cards/cockatrice/{name}.wav"

# nome do efeito -> (fontes, duração máxima em s)
PICKS = {
    "draw": ([K("casino-audio", f"card-slide-{i}") for i in (1, 2, 3, 4)], 0.7),
    "shuffle": ([K("casino-audio", "card-shuffle")], 1.6),
    "play": ([K("casino-audio", f"card-place-{i}") for i in (1, 2, 3, 4)], 0.7),
    "don": ([K("casino-audio", f"chip-lay-{i}") for i in (1, 2, 3)], 0.4),
    "attack": ([K("casino-audio", f"card-shove-{i}") for i in (1, 2, 3, 4)], 0.8),
    "block": ([K("impact-sounds", f"impactPlate_medium_00{i}") for i in (0, 1, 2)], 0.7),
    "counter": ([K("casino-audio", f"card-fan-{i}") for i in (1, 2)], 0.7),
    "hit": ([K("impact-sounds", f"impactPunch_heavy_00{i}") for i in (0, 1, 2, 3)], 0.7),
    "ko": ([K("impact-sounds", f"impactMining_00{i}") for i in (0, 1, 2)], 1.0),
    "ability": ([K("interface-sounds", f"glass_00{i}") for i in (1, 2, 3)], 0.5),
    "trigger": ([K("interface-sounds", f"confirmation_00{i}") for i in (1, 2)], 0.5),
    "turn": ([C("Passturn")], 0.7),
    "dice-shake": ([K("casino-audio", f"dice-shake-{i}") for i in (1, 2, 3)], 1.5),
    "dice-throw": ([K("casino-audio", f"dice-throw-{i}") for i in (1, 2, 3)], 0.7),
    "chat": ([K("interface-sounds", f"pluck_00{i}") for i in (1, 2)], 0.3),
    "don-pick": ([K("casino-audio", f"chips-stack-{i}") for i in (1, 2, 3, 4)], 0.35),
}

def peak_db(path):
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", path, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "max_volume" in line:
            return float(line.split("max_volume:")[1].split("dB")[0])
    raise RuntimeError(path)

manifest = {}
for name, (sources, maxdur) in PICKS.items():
    outs = []
    for i, src in enumerate(sources, 1):
        assert os.path.exists(src), src
        out = f"{OUT}/{name}-{i}.mp3" if len(sources) > 1 else f"{OUT}/{name}.mp3"
        # 1) apara o silêncio do início e do fim, limita a duração, com fade-out curto
        tmp = out + ".wav"
        fade = max(0.0, maxdur - 0.12)
        af = (
            "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.005,"
            "areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02,areverse,"
            f"atrim=0:{maxdur},afade=t=out:st={fade}:d=0.12"
        )
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ac", "1", "-ar", "44100", "-af", af, tmp], check=True)
        # 2) normaliza o pico em -1 dBFS
        gain = -1.0 - peak_db(tmp)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-af", f"volume={gain:.2f}dB", "-codec:a", "libmp3lame", "-b:a", "64k", out], check=True)
        os.remove(tmp)
        outs.append(os.path.basename(out))
        print(f"{os.path.basename(out):22s} {os.path.getsize(out)/1024:6.1f} KB  gain {gain:+.1f} dB")
    manifest[name] = outs
json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=2)
print("total", sum(os.path.getsize(f"{OUT}/{f}") for f in os.listdir(OUT) if f.endswith(".mp3")) // 1024, "KB")
