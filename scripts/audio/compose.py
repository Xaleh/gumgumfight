"""
Música original do GumGum Fight: "Valsa do Mar", uma valsa de taverna em 3/4
(acordeão, rabeca, violão, baixo), composta para o projeto. Gera os MIDIs:

  menu.mid     versão calma (100 bpm), 32 compassos em loop
  battle.mid   versão animada (138 bpm) com percussão, 32 compassos em loop
  win.mid / lose.mid / draw.mid   vinhetas do fim da partida

Os loops são escritos duas vezes seguidas: o render corta a segunda passada,
que já começa com a cauda (reverb) da primeira, e por isso emenda sem corte.
"""
import random
import sys

from mido import Message, MetaMessage, MidiFile, MidiTrack

TPQ = 480  # ticks por semínima
BEAT = TPQ
BAR = 3 * BEAT

# Programas General MIDI
ACCORDION, FIDDLE, NYLON, ABASS, TUBA, FLUTE = 21, 110, 24, 32, 58, 73
CH_MEL, CH_HARM, CH_CHORD, CH_BASS, CH_EXTRA, CH_DRUM = 0, 1, 2, 3, 4, 9
KICK, TAMB, WOODBLOCK, RIDE_BELL = 36, 54, 76, 53

# Escala de Ré maior para as terças diatônicas da rabeca
SCALE = [62, 64, 66, 67, 69, 71, 73]  # D E F# G A B C#


def deg(p):
    """Índice (oitava, grau) de uma altura da escala de Ré maior."""
    pc = p % 12
    for i, s in enumerate(SCALE):
        if s % 12 == pc:
            return (p - s) // 12, i
    raise ValueError(p)


def third_below(p):
    o, i = deg(p)
    i -= 2
    if i < 0:
        i += 7
        o -= 1
    return SCALE[i] + 12 * o


# Acordes: (fundamental MIDI do baixo, [notas do violão])
CHORDS = {
    "D": (38, [57, 62, 66]),   # A3 D4 F#4
    "A7": (45, [57, 61, 67]),  # A3 C#4 G4
    "G": (43, [55, 59, 62]),   # G3 B3 D4
    "Bm": (47, [59, 62, 66]),  # B3 D4 F#4
    "Em": (40, [55, 59, 64]),  # G3 B3 E4
}

# Melodia por compasso: lista de (altura, duração em tempos). None = pausa.
A1 = [
    ([(62, 2), (64, 1)], "D"),
    ([(66, 2), (67, 1)], "D"),
    ([(69, 2), (71, 1)], "D"),
    ([(69, 3)], "A7"),
    ([(71, 2), (69, 1)], "G"),
    ([(67, 2), (66, 1)], "D"),
    ([(64, 2), (66, 1)], "A7"),
    ([(62, 3)], "D"),
]
A2 = [
    ([(62, 2), (64, 1)], "D"),
    ([(66, 2), (67, 1)], "D"),
    ([(69, 2), (71, 1)], "D"),
    ([(73, 2), (74, 1)], "A7"),
    ([(71, 2), (69, 1)], "G"),
    ([(67, 1), (69, 1), (67, 1)], "D"),
    ([(66, 1), (64, 1), (61, 1)], "A7"),
    ([(62, 3)], "D"),
]
B = [
    ([(71, 2), (73, 1)], "Bm"),
    ([(74, 2), (73, 1)], "Bm"),
    ([(71, 2), (69, 1)], "G"),
    ([(66, 3)], "D"),
    ([(67, 2), (69, 1)], "G"),
    ([(71, 2), (69, 1)], "D"),
    ([(67, 1), (66, 1), (64, 1)], "Em"),
    ([(69, 2), (None, 1)], "A7"),
]
FORM = [("A1", A1), ("A2", A2), ("B", B), ("A2", A2)]


class Score:
    def __init__(self, bpm):
        self.bpm = bpm
        self.events = []  # (tick, ordem, Message)
        self.rng = random.Random(7)

    def note(self, ch, pitch, start, dur, vel, human=True):
        if pitch is None:
            return
        if human:
            start += self.rng.randint(-6, 6)
            vel = max(1, min(127, vel + self.rng.randint(-5, 5)))
        start = max(0, start)
        self.events.append((start, 1, Message("note_on", channel=ch, note=pitch, velocity=vel)))
        self.events.append((start + max(10, dur), 0, Message("note_off", channel=ch, note=pitch, velocity=0)))

    def program(self, ch, prog):
        self.events.append((0, -1, Message("program_change", channel=ch, program=prog)))

    def control(self, ch, cc, val):
        self.events.append((0, -1, Message("control_change", channel=ch, control=cc, value=val)))

    def save(self, path, end_tick):
        mid = MidiFile(ticks_per_beat=TPQ)
        track = MidiTrack()
        mid.tracks.append(track)
        track.append(MetaMessage("set_tempo", tempo=int(60_000_000 / self.bpm), time=0))
        track.append(MetaMessage("time_signature", numerator=3, denominator=4, time=0))
        last = 0
        for tick, _, msg in sorted(self.events, key=lambda e: (e[0], e[1])):
            msg.time = tick - last
            last = tick
            track.append(msg)
        track.append(MetaMessage("end_of_track", time=max(0, end_tick - last)))
        mid.save(path)


def waltz(s: Score, bars, at, style):
    """Acompanhamento um-pá-pá: baixo no tempo 1, violão nos tempos 2 e 3."""
    base_vel = 64 if style == "menu" else 78
    for i, (_, chord) in enumerate(bars):
        t = at + i * BAR
        root, voicing = CHORDS[chord]
        s.note(CH_BASS, root, t, int(BEAT * 1.6), base_vel + 10)
        if style == "battle":
            s.note(CH_EXTRA, root + 12, t, int(BEAT * 0.9), base_vel - 6)
        for beat in (1, 2):
            for p in voicing:
                s.note(CH_CHORD, p, t + beat * BEAT, int(BEAT * 0.45), base_vel - 4)
        if style == "battle":
            s.note(CH_DRUM, KICK, t, BEAT // 2, 84, human=False)
            s.note(CH_DRUM, TAMB, t + BEAT, BEAT // 3, 62)
            s.note(CH_DRUM, TAMB, t + 2 * BEAT, BEAT // 3, 58)
            if i % 4 == 3:
                s.note(CH_DRUM, WOODBLOCK, t + 2 * BEAT + BEAT // 2, BEAT // 4, 66)
        elif i % 2 == 1:
            s.note(CH_DRUM, TAMB, t + 2 * BEAT, BEAT // 3, 34)


def melody(s: Score, bars, at, ch, vel, octave=0, legato=0.92):
    for i, (notes, _) in enumerate(bars):
        t = at + i * BAR
        for p, beats in notes:
            dur = int(BEAT * beats * legato)
            s.note(ch, None if p is None else p + 12 * octave, t, dur, vel)
            t += BEAT * beats


def harmony(s: Score, bars, at, vel):
    for i, (notes, _) in enumerate(bars):
        t = at + i * BAR
        for p, beats in notes:
            s.note(CH_HARM, None if p is None else third_below(p), t, int(BEAT * beats * 0.9), vel)
            t += BEAT * beats


def loop(style, path):
    s = Score(100 if style == "menu" else 138)
    s.program(CH_MEL, ACCORDION)
    s.program(CH_HARM, FIDDLE)
    s.program(CH_CHORD, NYLON)
    s.program(CH_BASS, ABASS)
    s.program(CH_EXTRA, TUBA if style == "battle" else FLUTE)
    for ch, vol in ((CH_MEL, 100), (CH_HARM, 72), (CH_CHORD, 78), (CH_BASS, 92), (CH_EXTRA, 70), (CH_DRUM, 80)):
        s.control(ch, 7, vol)
    s.control(CH_MEL, 10, 60)
    s.control(CH_HARM, 10, 76)
    s.control(CH_CHORD, 10, 48)
    mel_vel = 84 if style == "menu" else 96
    total = sum(len(b) for _, b in FORM) * BAR  # 32 compassos
    at = 0
    for rep in range(2):  # duas passadas: o render fica com a segunda
        for name, bars in FORM:
            waltz(s, bars, at, style)
            melody(s, bars, at, CH_MEL, mel_vel)
            if name in ("A2", "B"):
                harmony(s, bars, at, 66 if style == "menu" else 76)
            if style == "battle" and name == "A2" and at % (2 * total) >= total // 2:
                # última volta do tema: flauta/tuba não, rabeca uma oitava acima junto
                melody(s, bars, at, CH_HARM, 70, octave=1, legato=0.8)
            if style == "menu" and name == "B":
                melody(s, bars, at, CH_EXTRA, 48, octave=1, legato=0.7)
            at += len(bars) * BAR
    s.save(path, at + 2 * BAR)
    return 60.0 / s.bpm * 3 * 32  # duração de uma passada, em segundos


def jingle(kind, path):
    s = Score(112)
    s.program(CH_MEL, ACCORDION)
    s.program(CH_HARM, FIDDLE)
    s.program(CH_CHORD, NYLON)
    s.program(CH_BASS, ABASS)
    s.control(CH_MEL, 7, 100)
    s.control(CH_HARM, 7, 80)
    s.control(CH_CHORD, 7, 80)
    s.control(CH_BASS, 7, 92)
    q = BEAT // 2
    if kind == "win":
        for i, p in enumerate((62, 66, 69, 74)):
            s.note(CH_MEL, p, i * q, int(q * 0.9), 96, human=False)
            s.note(CH_HARM, p - 12, i * q, int(q * 0.9), 70, human=False)
        t = 4 * q
        for p in (62, 66, 69, 74, 78):
            s.note(CH_MEL, p, t, 4 * BEAT, 100, human=False)
        for p in (57, 62, 66):
            s.note(CH_CHORD, p, t, 4 * BEAT, 84, human=False)
        s.note(CH_BASS, 38, t, 4 * BEAT, 100, human=False)
        s.note(CH_DRUM, TAMB, t, q, 90, human=False)
        s.note(CH_DRUM, RIDE_BELL, t, q, 70, human=False)
        end = t + 4 * BEAT
    elif kind == "lose":
        for i, p in enumerate((71, 69, 66, 62)):
            s.note(CH_MEL, p, i * BEAT, int(BEAT * 0.95), 80, human=False)
            s.note(CH_HARM, p - 12, i * BEAT, int(BEAT * 0.95), 60, human=False)
        t = 4 * BEAT
        for p in (59, 62, 66):
            s.note(CH_MEL, p - 12, t, 4 * BEAT, 72, human=False)
            s.note(CH_CHORD, p, t, 4 * BEAT, 70, human=False)
        s.note(CH_BASS, 35, t, 4 * BEAT, 96, human=False)
        end = t + 4 * BEAT
    else:  # empate
        for t, (root, voicing) in enumerate((CHORDS["G"], CHORDS["D"])):
            for p in voicing:
                s.note(CH_MEL, p, t * 2 * BEAT, int(BEAT * 1.9), 78, human=False)
                s.note(CH_CHORD, p, t * 2 * BEAT, int(BEAT * 1.9), 72, human=False)
            s.note(CH_BASS, root, t * 2 * BEAT, int(BEAT * 1.9), 90, human=False)
        end = 4 * BEAT
    s.save(path, end + BEAT)


if __name__ == "__main__":
    out = sys.argv[1]
    print("menu", loop("menu", f"{out}/menu.mid"))
    print("battle", loop("battle", f"{out}/battle.mid"))
    for k in ("win", "lose", "draw"):
        jingle(k, f"{out}/{k}.mid")
