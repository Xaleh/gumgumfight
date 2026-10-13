# Áudio do GumGum Fight: origem e licenças

Todos os arquivos desta pasta são livres para uso pessoal e comercial, sem crédito obrigatório
(CC0 ou produzidos para o projeto). Nenhum som ou música oficial de One Piece é usado.

## Música (`music/`)

Duas composições originais para o GumGum Fight, escritas em MIDI por `scripts/audio/compose.py` e
renderizadas com FluidSynth e o soundfont FluidR3 GM (MIT). Licença: a mesma do projeto.

| Arquivo | Peça | Uso |
|---|---|---|
| `menu.mp3` | **"Brisa do Leste"**: 6/8 tranquilo em Sol maior, violão dedilhado, flauta, cordas e glockenspiel (84 bpm, 57,1 s em loop) | Menu e telas fora da mesa |
| `battle.mp3` | **"Valsa do Mar"**: valsa de taverna em 3/4, acordeão, rabeca, violão, baixo e percussão (138 bpm, 41,7 s em loop) | Partida, online e espectador |
| `win.mp3`, `lose.mp3`, `draw.mp3` | Vinhetas na paleta da valsa | Vitória, derrota e empate |

## Efeitos (`sfx/`)

Convertidos para MP3 mono por `scripts/audio/sfx.py` (aparados, normalizados, até 13 KB cada).

| Efeito | Arquivos de origem | Pack |
|---|---|---|
| `draw-*` | card-slide-1…4 | Kenney, Casino Audio |
| `shuffle` | card-shuffle | Kenney, Casino Audio |
| `play-*` | card-place-1…4 | Kenney, Casino Audio |
| `don-*` | chip-lay-1…3 | Kenney, Casino Audio |
| `don-pick-*` | chips-stack-1…4 | Kenney, Casino Audio |
| `attack-*` | card-shove-1…4 | Kenney, Casino Audio |
| `counter-*` | card-fan-1…2 | Kenney, Casino Audio |
| `dice-shake-*` | dice-shake-1…3 | Kenney, Casino Audio |
| `dice-throw-*` | dice-throw-1…3 | Kenney, Casino Audio |
| `block-*` | impactPlate_medium_000…002 | Kenney, Impact Sounds |
| `hit-*` | impactPunch_heavy_000…003 | Kenney, Impact Sounds |
| `ko-*` | impactMining_000…002 | Kenney, Impact Sounds |
| `ability-*` | glass_001…003 | Kenney, Interface Sounds |
| `trigger-*` | confirmation_001…002 | Kenney, Interface Sounds |
| `chat-*` | pluck_001…002 | Kenney, Interface Sounds |
| `turn` | Passturn.wav | "Card Game Sounds" (HaelDB / Cockatrice), OpenGameArt |

- Kenney (Kenney Vleugels, https://kenney.nl): Casino Audio 1.1, Impact Sounds, Interface Sounds.
  Licença Creative Commons Zero (CC0), https://creativecommons.org/publicdomain/zero/1.0/
- "Card Game Sounds", https://opengameart.org/content/card-game-sounds, CC0.
