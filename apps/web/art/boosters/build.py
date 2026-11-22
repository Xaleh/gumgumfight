#!/usr/bin/env python3
"""Gera a arte dos boosters que não são de uma coleção: Pack Rush, Cubo e Draft.

Desenho próprio do GumGum Fight (nada da arte dos produtos da Bandai). Cada booster sai como um SVG
de 600x1000 nesta pasta; para virar a imagem que o app usa (`public/boosters/<NOME>.webp`), o SVG é
aberto num navegador com as fontes do app (Bangers e Nunito) e fotografado com fundo transparente:
veja o README desta pasta.
"""
import math

W, H = 600, 1000
FONT_TITLE = "Bangers, Impact, sans-serif"
FONT_TEXT = "Nunito, Arial, sans-serif"
# As seis cores do jogo.
RED, GREEN, BLUE, PURPLE, BLACK, YELLOW = "#e0463a", "#22a36c", "#3b82f6", "#9146c2", "#3a3a48", "#f2c230"


def outline():
    """O contorno do booster: laterais retas e as duas pontas serrilhadas da solda."""
    n, x0, x1 = 30, 6, 594
    step = (x1 - x0) / n
    pts = []
    for i in range(n):
        pts += [(x0 + i * step, 16), (x0 + (i + 0.5) * step, 6)]
    pts.append((x1, 16))
    for i in range(n):
        pts += [(x1 - i * step, 984), (x1 - (i + 0.5) * step, 994)]
    pts.append((x0, 984))
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"


def star(cx, cy, r, fill="#fff", opacity=1.0):
    """Brilho de quatro pontas."""
    q = r * 0.22
    d = f"M{cx},{cy - r} L{cx + q},{cy - q} L{cx + r},{cy} L{cx + q},{cy + q} L{cx},{cy + r} L{cx - q},{cy + q} L{cx - r},{cy} L{cx - q},{cy - q} Z"
    return f'<path d="{d}" fill="{fill}" opacity="{opacity}"/>'


def rays(cx, cy, n, r, color, opacity):
    out = []
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n * 0.42
        out.append(f'<path d="M{cx},{cy} L{cx + r * math.cos(a0):.1f},{cy + r * math.sin(a0):.1f} L{cx + r * math.cos(a1):.1f},{cy + r * math.sin(a1):.1f} Z" fill="{color}" opacity="{opacity}"/>')
    return "".join(out)


def title(small, big, y_small, y_big, size_big, stroke):
    """O nome do booster: uma linha pequena e uma grande, inclinadas, com contorno escuro."""
    style = f'font-family="{FONT_TITLE}" text-anchor="middle" paint-order="stroke" stroke="{stroke}" stroke-linejoin="round"'
    return f'''<g transform="translate(300 {y_big - 40}) skewX(-7) translate(-300 {-(y_big - 40)})">
  <text x="300" y="{y_small}" font-size="66" letter-spacing="5" fill="#fff6d8" stroke-width="12" {style}>{small}</text>
  <text x="306" y="{y_big + 8}" font-size="{size_big}" letter-spacing="6" fill="#000" opacity="0.35" stroke-width="18" {style}>{big}</text>
  <text x="300" y="{y_big}" font-size="{size_big}" letter-spacing="6" fill="url(#titleFill)" stroke-width="18" {style}>{big}</text>
</g>'''


def frame(name, top, mid, bottom, seal, accent, body, small, big, size_big, tagline, stroke, tag):
    """A embalagem em volta do desenho: folha metálica, soldas, etiquetas, nome e a faixa de baixo."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" data-name="{name}">
<defs>
  <clipPath id="pack"><path d="{outline()}"/></clipPath>
  <linearGradient id="foil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="0.5" stop-color="{mid}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>
  <linearGradient id="round" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity="0.42"/><stop offset="0.1" stop-color="#000" stop-opacity="0"/>
    <stop offset="0.24" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.36" stop-color="#fff" stop-opacity="0"/>
    <stop offset="0.9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.46"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="0.26"/>
    <stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="0.62" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.44" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="0.45" stop-color="{accent}" stop-opacity="0.35"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>
  <linearGradient id="titleFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#fff3c4"/><stop offset="1" stop-color="{accent}"/></linearGradient>
  <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.2"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
  <pattern id="ridges" width="9" height="60" patternUnits="userSpaceOnUse"><rect width="9" height="60" fill="{seal}"/><rect x="0" width="3" height="60" fill="#fff" opacity="0.28"/><rect x="5" width="2" height="60" fill="#000" opacity="0.18"/></pattern>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="5" cy="5" r="2.2" fill="#fff" opacity="0.1"/></pattern>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000" flood-opacity="0.5"/></filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<g clip-path="url(#pack)">
  <rect width="{W}" height="{H}" fill="url(#foil)"/>
  <rect width="{W}" height="{H}" fill="url(#dots)"/>
  <ellipse cx="300" cy="440" rx="330" ry="330" fill="url(#glow)"/>
  {body}
  <rect width="{W}" height="{H}" fill="url(#vignette)"/>
  {title(small, big, 742, 872, size_big, stroke)}
  <text x="300" y="922" font-family="{FONT_TEXT}" font-weight="900" font-size="21" letter-spacing="4.5" text-anchor="middle" fill="#fff" opacity="0.92">{tagline}</text>
  <g font-family="{FONT_TEXT}" font-weight="900">
    <rect x="30" y="80" width="196" height="40" rx="9" fill="#fff"/>
    <text x="128" y="108" font-size="21" letter-spacing="1.5" text-anchor="middle" fill="{stroke}">GUMGUM FIGHT</text>
    <rect x="30" y="126" width="{len(tag) * 15 + 30}" height="34" rx="8" fill="{stroke}"/>
    <text x="{30 + (len(tag) * 15 + 30) / 2}" y="150" font-size="19" letter-spacing="2" text-anchor="middle" fill="#fff">{tag}</text>
    <rect x="486" y="80" width="84" height="80" rx="12" fill="none" stroke="#fff" stroke-width="4" opacity="0.95"/>
    <text x="528" y="126" font-family="{FONT_TITLE}" font-weight="400" font-size="46" text-anchor="middle" fill="#fff">12</text>
    <text x="528" y="148" font-size="13" letter-spacing="2" text-anchor="middle" fill="#fff">CARDS</text>
  </g>
  <rect x="0" y="0" width="{W}" height="60" fill="url(#ridges)"/>
  <rect x="0" y="940" width="{W}" height="60" fill="url(#ridges)"/>
  <rect x="0" y="58" width="{W}" height="4" fill="#000" opacity="0.28"/><rect x="0" y="62" width="{W}" height="2" fill="#fff" opacity="0.3"/>
  <rect x="0" y="936" width="{W}" height="4" fill="#000" opacity="0.28"/><rect x="0" y="934" width="{W}" height="2" fill="#fff" opacity="0.3"/>
  <rect width="{W}" height="{H}" fill="url(#round)"/>
  <rect width="{W}" height="{H}" fill="url(#sheen)"/>
</g>
<path d="{outline()}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="3"/>
</svg>
'''


def mini_pack(angle, c0, c1, mark):
    """Um booster pequeno do leque do Pack Rush, girado em torno da base do leque."""
    return f'''<g transform="rotate({angle} 300 690)" filter="url(#shadow)">
  <rect x="212" y="312" width="176" height="282" rx="12" fill="{c1}"/>
  <rect x="212" y="312" width="176" height="282" rx="12" fill="{c0}" opacity="0.92"/>
  <path d="M212,470 L388,380 L388,594 L212,594 Z" fill="{c1}" opacity="0.55"/>
  <rect x="212" y="312" width="176" height="26" rx="6" fill="#fff" opacity="0.34"/>
  <rect x="212" y="568" width="176" height="26" rx="6" fill="#000" opacity="0.26"/>
  <path d="M232,340 L300,340 L246,566 L232,566 Z" fill="#fff" opacity="0.16"/>
  <rect x="212" y="312" width="176" height="282" rx="12" fill="none" stroke="#fff" stroke-width="7"/>
  {mark}
</g>'''


def rush():
    q = lambda size, y, sw: f'<text x="300" y="{y}" font-family="{FONT_TITLE}" font-size="{size}" text-anchor="middle" fill="#fff" stroke="#3a1c00" stroke-width="{sw}" paint-order="stroke" stroke-linejoin="round">?</text>'
    bolt = lambda x, y, s, rot: f'<path transform="translate({x} {y}) rotate({rot}) scale({s})" d="M22,-64 L-34,10 L-6,10 L-22,64 L36,-14 L8,-14 Z" fill="#ffffff" stroke="#3a1c00" stroke-width="5" stroke-linejoin="round"/>'
    lines = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="9" rx="4.5" fill="#fff" opacity="{o}"/>' for x, y, w, o in [(18, 300, 120, 0.7), (44, 334, 76, 0.5), (10, 520, 96, 0.6), (470, 286, 112, 0.7), (500, 322, 70, 0.5), (492, 536, 98, 0.6)])
    body = f'''{rays(300, 440, 22, 560, "#fff", 0.16)}
  {lines}
  {mini_pack(-24, "#f0554a", "#8d1a14", q(120, 500, 12))}
  {mini_pack(24, "#35c97c", "#0e6a3a", q(120, 500, 12))}
  {mini_pack(0, "#4a8cff", "#16399b", q(210, 532, 16))}
  {bolt(104, 236, 1.15, -12)}{bolt(500, 240, 1.0, 14)}
  {star(92, 430, 26)}{star(520, 420, 22)}{star(300, 236, 20)}{star(452, 640, 18, opacity=0.9)}{star(150, 636, 16, opacity=0.9)}'''
    return frame("RUSH", "#ffe07a", "#f5a623", "#a44a00", "#c9781a", "#ffb02e", body, "PACK", "RUSH", 164, "RANDOM SETS", "#3a1c00", "MIX")


def cube():
    # Cubo isométrico de 3x3x3: T é o vértice de cima; r, l e d são as arestas.
    T, r, l, d = (300, 236), (132, 76), (-132, 76), (0, 152)
    add = lambda p, v, k=1.0: (p[0] + v[0] * k, p[1] + v[1] * k)
    # Duas cartas de cada uma das seis cores do jogo, espalhadas pelas três faces (2x2 em cada).
    colors = [[RED, BLUE, YELLOW, GREEN], [PURPLE, RED, BLACK, YELLOW], [GREEN, BLACK, BLUE, PURPLE]]
    faces = [
        (T, r, l, "#fff", 0.2),
        (add(T, l), r, d, "#000", 0.0),
        (add(add(T, r), l), (132, -76), d, "#000", 0.3),
    ]
    out = []
    for f, (o, u, v, tint, amount) in enumerate(faces):
        for i in range(2):
            for j in range(2):
                corner = lambda a, b: add(add(o, u, (i + a) / 2), v, (j + b) / 2)
                quad = lambda pad: " ".join(f"{x:.1f},{y:.1f}" for x, y in [corner(pad, pad), corner(1 - pad, pad), corner(1 - pad, 1 - pad), corner(pad, 1 - pad)])
                out.append(f'<polygon points="{quad(0.06)}" fill="{colors[f][i * 2 + j]}" stroke="#0a1f22" stroke-width="6" stroke-linejoin="round"/>')
                if amount:
                    out.append(f'<polygon points="{quad(0.06)}" fill="{tint}" opacity="{amount}"/>')
                out.append(f'<polygon points="{quad(0.2)}" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" opacity="0.75"/>')
                cx, cy = corner(0.5, 0.5)
                out.append(star(round(cx, 1), round(cy, 1), 15, "#fff", 0.9))
    hull = [T, add(T, r), add(add(T, r), d), add(add(add(T, r), l), d), add(add(T, l), d), add(T, l)]
    hull_pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in hull)
    body = f'''{rays(300, 420, 20, 560, "#fff", 0.13)}
  <ellipse cx="300" cy="612" rx="170" ry="26" fill="#000" opacity="0.32" filter="url(#soft)"/>
  <ellipse cx="300" cy="402" rx="236" ry="74" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="4 16" stroke-linecap="round" opacity="0.7" transform="rotate(-18 300 402)"/>
  <g filter="url(#shadow)"><polygon points="{hull_pts}" fill="#0a1f22" stroke="#0a1f22" stroke-width="14" stroke-linejoin="round"/>{"".join(out)}</g>
  <polygon points="{hull_pts}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity="0.9"/>
  {star(96, 300, 28)}{star(512, 268, 24)}{star(528, 540, 20)}{star(84, 548, 18, opacity=0.9)}{star(300, 196, 16)}{star(462, 400, 12, opacity=0.9)}'''
    return frame("CUBE", "#5ff0d4", "#14a391", "#054441", "#0f7f73", "#39e6c6", body, "GUMGUM", "CUBE", 170, "420 CARDS · 1 OF EACH", "#06302f", "DRAFT")


def card_back(angle, x):
    """Um verso de carta inventado (não o do jogo): moldura, anel e um brilho no centro."""
    return f'''<g transform="rotate({angle} 300 720)" filter="url(#shadow)">
  <rect x="{x}" y="300" width="184" height="258" rx="14" fill="#2b1a5c" stroke="#fff" stroke-width="7"/>
  <rect x="{x + 16}" y="316" width="152" height="226" rx="9" fill="none" stroke="#c9a6ff" stroke-width="3" opacity="0.8"/>
  <circle cx="{x + 92}" cy="429" r="50" fill="none" stroke="#ffd66b" stroke-width="5"/>
  <circle cx="{x + 92}" cy="429" r="34" fill="none" stroke="#ffd66b" stroke-width="2" opacity="0.7"/>
  {star(x + 92, 429, 44, "#ffd66b")}
</g>'''


def draft():
    # A seta que dá a volta nas cartas: escolher uma e passar o resto.
    arc = '<path d="M112,470 A196,196 0 0 1 430,292" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" opacity="0.95"/><path d="M398,246 L470,286 L404,338 Z" fill="#fff"/>'
    arc2 = '<path d="M488,414 A196,196 0 0 1 176,590" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" opacity="0.95"/><path d="M208,634 L134,598 L198,544 Z" fill="#fff"/>'
    body = f'''{rays(300, 440, 22, 560, "#fff", 0.13)}
  {arc}{arc2}
  {card_back(-22, 208)}{card_back(22, 208)}{card_back(0, 208)}
  {star(92, 250, 26)}{star(520, 560, 24)}{star(506, 208, 18, opacity=0.9)}{star(88, 600, 16, opacity=0.9)}'''
    return frame("DRAFT", "#c79bff", "#7d3fd0", "#2a0f5c", "#6431ad", "#b98bff", body, "PICK &amp; PASS", "DRAFT", 160, "8 PLAYERS · 4 BOOSTERS", "#1f0a47", "POD")


if __name__ == "__main__":
    import re

    for name, svg in (("rush", rush()), ("cube", cube()), ("draft", draft())):
        svg = re.sub(r'id="(\w+)"', lambda m: f'id="{name}-{m.group(1)}"', svg)
        svg = re.sub(r"url\(#(\w+)\)", lambda m: f"url(#{name}-{m.group(1)})", svg)
        with open(f"{name}.svg", "w", encoding="utf-8") as f:
            f.write(svg)
        print(name, len(svg))
