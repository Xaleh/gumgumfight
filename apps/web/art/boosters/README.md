# Arte dos boosters do GumGum Fight

Os boosters de **Pack Rush** (antes de aparecer a coleção sorteada), **Cubo** e **Draft** não são de um produto da
Bandai, então têm arte própria, desenhada aqui. Nada vem da arte dos produtos oficiais.

- `build.py` gera `rush.svg`, `cube.svg` e `draft.svg` (600x1000): a embalagem (folha metálica, soldas serrilhadas,
  etiquetas, nome) e o desenho de cada uma.
- `render.cjs` abre os SVGs num navegador com as fontes do app (Bangers e Nunito) e grava PNGs com fundo
  transparente. Precisa do Playwright com o Chromium.
- As imagens que o app usa ficam em `apps/web/public/boosters/RUSH.webp`, `CUBE.webp` e `DRAFT.webp` (520 px de
  altura, como as dos produtos).

Para mudar um desenho:

```bash
cd apps/web/art/boosters
python3 build.py                 # regrava os SVGs
node render.cjs /tmp/boosters    # PNGs em /tmp/boosters
# recorte a transparência em volta, reduza para 520 px de altura e salve como WebP em public/boosters
```
