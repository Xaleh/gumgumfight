# Amigos e convite para partidas

Material para divulgar o sistema de amigos: o código de amigo, quem está online e o convite direto para uma partida.

| Pasta | O que tem | Formato |
|---|---|---|
| [`posts/`](posts) | Carrossel de 7 imagens | 1080×1350 |
| [`reels/`](reels) | `reel-jogue-com-os-amigos.mp4` (29 s) e `reel-convite-chegou.mp4` (9 s), sem som | 1080×1920, 30 fps |
| [`stories/`](stories) | 3 imagens e 1 vídeo (`story-convite.mp4`, 7 s, com o botão do link) | 1080×1920 |

As telas são do app de verdade, no celular, com contas de teste locais (Nami, Usopp, Jinbe, Robin, Chopper, Franky
e Brook). O convite para o Yonko ficou de fora das telas, como no resto do kit.

## O carrossel

1. **Jogue com os amigos** (capa): a lista de amigos.
2. **Passo 1 · Mande o seu código:** o código de 8 letras e o amigo digitando em "Adicionar pelo código".
3. **Passo 2 · Aceite o pedido:** "Pedidos recebidos" e "agora são amigos".
4. **Veja quem está online:** Jogando, Online e Offline.
5. **Passo 3 · Escolha o formato:** Standard, Extra Grand Battle, All Blue ou Livre.
6. **O amigo entra com um toque:** a faixa do convite na tela inicial e a partida começando.
7. **Chama a galera!**

## Legendas

### Carrossel

```
Agora dá para jogar com os amigos sem ficar mandando código de sala. 👥 Arrasta.

1️⃣ Mande o seu código de amigo (ou o link)
2️⃣ O amigo adiciona e você aceita
3️⃣ Toque em Convidar e escolha o formato

O amigo recebe o aviso e entra direto na partida. E na lista você vê quem está jogando, quem está online e quem está offline.

Entre com o Google e abra Amigos no menu. Link na bio.

#onepiececardgame #optcg #onepiecetcg #optcgbrasil #onepiecebrasil #tcgbrasil #gumgumfight
```

### Reel: jogue com os amigos

```
Seu amigo some do grupo bem na hora da partida? Agora você chama ele pelo app. 👥

No GumGum Fight cada conta tem um código de amigo. Adicionou, aceitou, pronto: você vê quem está online e convida para uma partida escolhendo o formato. O amigo recebe o aviso e entra com um toque.

Marca aqui quem vai ser o seu primeiro amigo no app. 👇

#onepiececardgame #optcg #onepiecetcg #optcgbrasil #onepiecebrasil #tcgbrasil #gumgumfight
```

### Reel: o convite chegou

```
"Nami chamou você para uma partida." Entrar ou recusar? ⚔️

O convite chega como notificação e como faixa na tela inicial. Um toque em Entrar e a partida começa, com o seu deck equipado.

#onepiececardgame #optcg #onepiecetcg #optcgbrasil #gumgumfight
```

## Stories

| Ordem | Arquivo | Como usar |
|---|---|---|
| 1 | `stories/amigos-3-passos.jpg` | Explica em 3 passos. |
| 2 | `stories/story-convite.mp4` | O convite em ação. Ponha a figurinha de **Link** por cima do botão amarelo. |
| 3 | `stories/amigos-meu-codigo.jpg` | Escreva o **código de amigo do perfil** no painel claro, com o texto do Instagram. Bom para destacar. |
| 4 | `stories/amigos-revanche.jpg` | Ponha a figurinha de **Menção** ou **Caixa de perguntas** no espaço embaixo do título. |

O story 3 pode ficar fixo no destaque **Jogar**, para quem chega ao perfil adicionar a conta do GumGum Fight.

## Texto alternativo do carrossel

1. "Celular com a lista de amigos: alguns jogando, outros online e um offline."
2. "Dois celulares: o código de amigo de 8 letras e o código sendo digitado para adicionar."
3. "Dois celulares: um pedido de amizade recebido e a mensagem 'agora são amigos'."
4. "Celular com a lista de amigos e os status Jogando, Online e Offline."
5. "Celular com a escolha do formato do convite: Standard, Extra Grand Battle, All Blue e Livre."
6. "Dois celulares: a faixa 'Convite de amigo' com o botão Entrar e o sorteio do início da partida."
7. "Convite: 'Chama a galera!' e o endereço gumgumfight.app."

## Antes de publicar

- **Login:** amigos e convites exigem a conta Google. Os textos dizem isso no último slide e no story de 3 passos.
- **All Blue apagado:** na tela do convite, o All Blue aparece apagado porque o deck equipado nas gravações tem SR.
  É o comportamento certo do app (o formato em que o deck não vale fica apagado, com o motivo).
- **Som:** os vídeos saem sem som; escolha a música no próprio Instagram.

## Como refazer

As gravações (`src/clips/amigos-*.mp4`, fora do git) foram feitas com contas de teste criadas só no banco local de
desenvolvimento. A abertura das folhas tem animação, então a gravação usa a mesma câmera lenta do `record-modos.mjs`.

```bash
node marketing/instagram/src/build.mjs amigos
node marketing/instagram/src/reel.mjs amigos/
```
