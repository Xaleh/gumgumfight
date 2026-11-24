# Modo espectador

Um carrossel e dois Reels sobre assistir às partidas: o que quem assiste vê, quem decide se as mãos aparecem e como
deixar a tela do seu jeito.

| Pasta | O que tem | Formato |
|---|---|---|
| [`posts/`](posts) | Carrossel de 8 imagens | 1080×1350 |
| [`reels/`](reels) | `reel-maos.mp4` (29 s) e `reel-do-seu-jeito.mp4` (28 s), sem som | 1080×1920, 30 fps |

As telas são do app de verdade. A tela de quem assiste é a do computador (1920×1080), que aparece dentro de um
monitor desenhado; as telas do jogador são do celular.

## O carrossel

1. **Modo espectador** (capa): a mesa lateral de quem assiste.
2. **Assista a qualquer partida:** sem login; sala privada pelo código; toque na carta para ler.
3. **Quem cria a sala decide:** a opção "Liberar as mãos para transmissão" e o aviso "Mãos liberadas" na mesa dos jogadores.
4. **As duas mãos, com atraso:** a mesa com as duas mãos abertas e o selo de 1 min de atraso.
5. **Escolha o playmat:** azul, vermelho, verde e branco.
6. **Mesa lateral ou em pé.**
7. **Leve para a live:** a tela do modo transmissão, para o OBS.
8. **Bora assistir?**

## Legendas

### Carrossel

```
Agora dá para assistir às partidas do GumGum Fight do seu jeito. 👀 Arrasta.

👁 Qualquer pessoa assiste às partidas online, com ou sem login
🃏 As mãos só aparecem se quem criou a sala liberar, e os dois jogadores veem o aviso
⏱ Com as mãos, a mesa chega com pelo menos 1 minuto de atraso: ninguém espia o oponente pela live
🎨 Playmat azul, vermelho, verde ou branco
🖥 Mesa lateral ou em pé
📡 Modo transmissão com link para o OBS

No menu, toque em Assistir. Link na bio.

#onepiececardgame #optcg #onepiecetcg #optcgbrasil #onepiecebrasil #streamer #tcgbrasil #gumgumfight
```

### Reel: quem vê as mãos?

```
Quem vê as suas cartas quando a partida vai para a live? Você decide. 🃏

Na sala privada, quem cria escolhe se libera as mãos para transmissão. Sem liberar, quem assiste vê só a mesa. Liberou: quem transmite vê as duas mãos, sempre com pelo menos 1 minuto de atraso, e os dois jogadores veem o aviso "Mãos liberadas" na tela.

Bom para quem faz live de One Piece Card Game com os amigos. 📡

#onepiececardgame #optcg #onepiecetcg #streamer #live #optcgbrasil #gumgumfight
```

### Reel: assista do seu jeito

```
A mesa de quem assiste também é sua. 🎨

Escolha o playmat (azul, vermelho, verde ou branco), troque a mesa lateral pela mesa em pé, esconda o chat dos jogadores quando quiser e toque em qualquer carta para ler o efeito.

Tudo em Assistir, no menu do GumGum Fight. Qual cor você deixaria?

#onepiececardgame #optcg #onepiecetcg #playmat #optcgbrasil #gumgumfight
```

## Texto alternativo do carrossel

1. "Tela de computador com uma partida no modo espectador, na mesa lateral."
2. "Tela de computador com uma carta ampliada para leitura."
3. "Dois celulares: a opção 'Liberar as mãos para transmissão' marcada e a mesa do jogador com o aviso 'Mãos liberadas'."
4. "Tela de computador com as mãos dos dois jogadores abertas e o selo de 1 minuto de atraso."
5. "Quatro telas com o playmat azul, vermelho, verde e branco."
6. "Duas telas: a mesa lateral e a mesa em pé."
7. "Tela do modo transmissão, com as duas mãos, o histórico e a carta jogada em destaque."
8. "Convite: 'Bora assistir?' e o endereço gumgumfight.app."

## Antes de publicar

- **Perfil Streamer:** ver as mãos e usar o modo transmissão é só para os perfis Streamer e Admin. O último slide diz
  "para transmitir com as mãos, fale com a gente": confirme que vocês vão dar o perfil a quem pedir, ou troque o texto.
- **Atraso:** com as mãos, o atraso é de pelo menos 1 minuto. A exceção são os torneios em que o organizador marca
  "Mãos ao vivo na transmissão"; os textos não citam essa exceção.
- **Som:** os Reels saem sem som; escolha a música no próprio Instagram.

## Como refazer

As telas foram gravadas no app local com uma partida em sala privada entre duas contas de teste e uma terceira, com
perfil Streamer, assistindo no computador. As gravações ficam em `src/clips/espectador-*.mp4` (fora do git) e as
capturas em `src/shots/espectador-*.jpg`.

Para as duas contas jogarem sozinhas, o servidor local precisou de uma alteração temporária, que **não vai para o
repositório**: em `apps/server/src/online/room.ts`, na função `driveBot`, o servidor joga também pelos lugares de
pessoas quando `GGF_DEMO_AUTOPLAY=1`. Desfaça a alteração depois de gravar.

```bash
node marketing/instagram/src/build.mjs espectador
node marketing/instagram/src/reel.mjs espectador
```
