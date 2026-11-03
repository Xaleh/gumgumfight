# Layout da mesa configurável (proposta)

> Status: **implementado** (`WideBoard.tsx`, `BoardLayoutEditor.tsx`, `game/boardLayout.ts`; ver a seção "Layout da mesa (desktop)" em `documentacao-tecnica.md`). Este documento é a proposta que guiou a implementação; o protótipo da tela: https://claude.ai/artifact/JJvoLdEjZ7gNMZfAqB468j

Duas coisas, que andam juntas:

1. **Uma mesa larga para o PC.** A mesa de hoje é uma coluna estreita no meio de uma tela 16:9, com bordas escuras
   sem uso dos dois lados, porque o tamanho das cartas é limitado pela altura e a coluna empilha nove fileiras
   (mão do oponente, DON!!, base, campo, faixa do meio, campo, base, DON!!, mão). A proposta é uma mesa com **duas
   fileiras por metade**, como nos simuladores de referência: os personagens (com a Vida numa coluna ao lado) e a
   fileira do Líder, que reúne a área de custo dos DON!!, o Stage, o Deck e o Descarte. As mãos ficam nos cantos,
   fora da mesa. A mesa fica baixa e larga, e as cartas quase dobram de tamanho.
2. **A tela Configurações › Layout da mesa › Personalizar**, onde o jogador ajusta cada bloco dessa mesa: tamanho
   (pequeno, médio, grande), posição e, nos blocos de que o jogo não depende, se aparece ou não.

## Escopo

| Vale para | Fica como está |
|-----------|----------------|
| A mesa de quem joga no desktop (`wide`, ≥ 1000 px): treino contra o bot, online, torneio, replay próprio | Celular e tablet em pé (a mesa em coluna de hoje) |
| | Visão do Streamer em pé e lateral (`lifeAside`, `LateralBoard.tsx`), transmissão (`broadcast`) e replay embutido (`embed`) |
| | Tutorial (as lições apontam para as zonas; usa a mesa em coluna, que elas conhecem) |

O lado do oponente **espelha** o do jogador: a fileira do Líder invertida, a Vida na coluna oposta, a mão no canto
oposto. A pessoa configura só a própria metade.

## A mesa larga

```
┌──────────┬───────────────────────────── mesa ─────────────────────────────┬──────────────┐
│ (livre:  │ [Descarte][Deck][Stage][LÍDER][área de custo: DON!!][Deck DON] │ mão do       │
│  hover   │ [ Pers ][ Pers ][ Pers ][ Pers ][ Pers ]              [Vida]   │ oponente     │
│  grande) │ Bullnard ♥♥♥♥♥ ⏱        Turno 8 · Sua vez        Você ♥♥♥♥ ⏱ │              │
│          │ [Vida]  [ Pers ][ Pers ][ Pers ][ Pers ][ Pers ]               │ (livre:      │  painel
│ sua mão  │ [Deck DON][área de custo: DON!!][LÍDER][Stage][Deck][Descarte] │  histórico)  │  lateral
└──────────┴────────────────────────────────────────────────────────────────┴──────────────┘
```

- **A mesa é o jogo; a lateral é secundária.** As laterais têm largura fixa e pequena (uns 1,7 `--cw` para uma mão no
  canto, 2,3 para o hover, 2,6 para o histórico) e a mesa fica com **todo o resto da largura**: as zonas de cada
  fileira se espalham (`justify-content: space-evenly`), como no playmat, em vez de a mesa encolher para uma coluna
  no meio. A largura mínima da mesa é a do conteúdo (uns 7,4 `--cw`); altura: duas metades de 3,6 `--cw` mais a
  faixa do meio, uns 7,9 `--cw`.
  Numa tela 1920×1080 com o painel aberto isso dá cartas de uns 115 px (hoje: 95 px na coluna, e só porque o teto é
  112 px); em 1366×768, 80 px contra 64 px.
- **Faixa do meio:** etiqueta de cada jogador (nome, corações, relógio), a situação do turno no centro. Substitui os
  `PlayerBanner` das pontas de cima e de baixo.
- **Laterais:** o espaço que sobra da `board-col` dos dois lados da mesa. Embaixo, nos cantos, as mãos; em cima,
  opcionalmente, o hover grande (esquerda) e o histórico (direita).
- **Painel lateral** (direita, como hoje): turno e dica, hover de carta, histórico, botão Encerrar turno.

## Blocos

| Bloco | Ocultar | Tamanho | Posição |
|-------|---------|---------|---------|
| DON!! (área de custo: ativos, descansados, contadores) | não | P · M · G | à esquerda (padrão) · à direita do Líder, na fileira do Líder · fileira abaixo do Líder (terceira fileira **dentro do playmat**, como hoje; espelhada acima da metade do oponente; a mão então vai para um canto) |
| Cartas na mão | não, mas **recolhe** (pilha com a contagem, abre ao clicar; reaproveita `MiniHand`/`HandFan`) | P · M · G | canto esquerdo (padrão) · canto direito · embaixo da mesa (gasta altura: a mesa encolhe; só se os DON!! não estiverem lá) |
| Vida | **não** (faz parte do campo: há Vida virada para cima e efeitos que a olham) | P · M · G | coluna à esquerda do campo (padrão) · coluna à direita · junto do Líder (pilha pequena, como hoje) |
| Líder | não | P · M · G | fixo no centro da fileira |
| Stage | não | P · M · G | esquerda · direita (padrão) do Líder |
| Descarte | não | P · M · G | esquerda · direita (padrão) |
| Deck de DON!! | não | P · M · G | ponta de fora da área de custo (padrão) · ponta de dentro. Na fileira abaixo do Líder, a área de custo fica **centralizada** sob o Líder e o deck de DON!! na lateral do playmat (de fora ou de dentro, conforme a opção) |
| Deck | não | P · M · G | esquerda · direita (padrão) |
| Histórico (`LogPanel`) | **sim** | P · M · G (largura do painel: 0,8× · 1× · 1,2×) | painel lateral (padrão) · ao lado da mesa, à direita (só com o painel fechado) |
| Hover de carta (`CardDetail`) | **sim** | P · M · G | painel lateral (padrão) · centro da mesa (grande, por cima, só enquanto o mouse está na carta) · ao lado da mesa, à esquerda (só com o painel fechado) · junto da carta (`CardHoverPreview`) |

Regras:

- **Médio é o tamanho de referência.** Pequeno = 0,8×; Grande = 1,25×. Cada bloco multiplica o `--cw` por um `--k-*`.
- **Posição por encaixe, não por pixel.** Cada bloco escolhe entre poucas posições válidas. A mesa continua se
  ajustando ao tamanho da janela, as âncoras das animações (`data-anchor`) e a seta de ataque seguem funcionando, e
  dois blocos nunca se sobrepõem. Arrastar livremente fica como ideia de v2.
- Ordem na fileira do Líder, do Líder para fora: Stage, Deck, Descarte; a área de custo (com o deck de DON!!) ocupa
  o outro lado. Blocos do mesmo lado seguem essa ordem.
- **Nada extravasa a tela, em nenhuma configuração.** O `--cw` é calculado a partir do que está ligado e do tamanho
  de cada bloco: `rows` (altura da mesa mais a faixa da mão embaixo, ou a altura das laterais, a que for maior) e
  `cols` (largura da mesa mais as duas laterais), em larguras de carta;
  `--cw = min((100cqh - 24px) / rows, (100cqw - painel - 24px) / cols, 150px)`. Como rede de segurança, depois de
  renderizar a mesa mede a própria `board-col` (`scrollHeight`/`scrollWidth` contra `clientHeight`/`clientWidth`) e,
  se algo passou, aperta `rows`/`cols` na proporção e renderiza de novo (até três vezes; um `ResizeObserver` refaz a
  conta ao redimensionar a janela). Mais blocos grandes = cartas um pouco menores, nunca corte. A área de custo
  comprime os DON!! quando são muitos (como `.don-cards` já faz).
- **Mão e DON!! nunca se sobrepõem.** Com a fileira de DON!! na borda de baixo do playmat, a mão não pode ficar
  embaixo da mesa (e vice-versa): a opção do outro fica desabilitada no editor, com o motivo no `title`, e `load()`
  resolve um JSON conflitante mandando a mão para o canto esquerdo.
- **O Líder fica sempre no centro da fileira**, mesmo quando os DON!! saem dela: a fileira é um grid `1fr auto 1fr`
  e cada lado espalha o que tem. A fileira de DON!! abaixo do Líder usa o mesmo grid: área de custo no meio, deck de
  DON!! encostado na lateral.
- **Mão do oponente** sempre na parte de cima: no canto superior oposto ao da sua; quando a sua fica embaixo da mesa,
  no canto superior direito (numa faixa acima da mesa só se não houver lateral nenhuma). Nunca rouba altura da mesa
  quando há um canto disponível. DON!! embaixo da mesa espelha numa faixa acima da metade do oponente.
- **Painel lateral.** Se o Hover ou o Histórico está no painel, os dois entram nele ("ao lado da mesa" do outro vira
  "painel"), as laterais de hover/histórico deixam de existir e a mesa ocupa todo o espaço ao lado do painel (sobram só
  os cantos das mãos). Com o painel fechado e a mão embaixo da mesa, hover e histórico "ao lado da mesa" ficam
  centralizados na vertical.
- A área de custo comprime os DON!! quando são muitos (como `.don-cards` já faz), então a fileira do Líder cabe
  sempre nas 8 larguras de carta.

Predefinições na própria tela: **Padrão** (a mesa larga como acima), **Compacta** (tudo pequeno, hover junto da
carta), **Cartas grandes** (Líder e mão grandes, histórico oculto, hover no centro da mesa) e **Mesa aberta** (sem
painel: hover e histórico ao lado da mesa). Cada predefinição é só um `BoardLayout` pronto.

## A tela

- **Entrada:** em Configurações, a linha "Layout da mesa" com o botão **Personalizar** (abaixo de "Painel lateral",
  que ela absorve). No menu da partida, o mesmo botão.
- **Em cima:** prévia 16:9 da tela do PC, viva: o próprio `Board` largo renderizado com um estado de exemplo
  (`game/setup.ts` monta um com um starter deck; handlers inertes) e o layout em edição. Passar o mouse num bloco
  realça a zona na prévia; clicar numa zona rola até o bloco. Aberta dentro da partida, a prévia é a partida.
- **Embaixo:** um cartão por bloco: nome, interruptor (travado com "obrigatório" nos que não podem sumir),
  Tamanho (P · M · G) e Posição. Mão tem ainda "Recolhida".
- **Rodapé:** Restaurar padrão · Cancelar · Salvar. As mudanças só valem ao salvar.

## Modelo e persistência

Entra em `Settings` (`settings.tsx`), salvo no `localStorage` com as demais (`gumgum.settings`):

```ts
export type BlockSize = 'small' | 'medium' | 'large';
export interface BoardLayout {
  don: { size: BlockSize; position: 'left' | 'right' | 'row' };
  hand: { size: BlockSize; position: 'corner-left' | 'corner-right' | 'bottom'; collapsed: boolean };
  life: { size: BlockSize; position: 'col-left' | 'col-right' | 'base' };
  leader: { size: BlockSize };
  stage: { size: BlockSize; position: 'left' | 'right' };
  trash: { size: BlockSize; position: 'left' | 'right' };
  donDeck: { size: BlockSize; position: 'outer' | 'inner' };
  deck: { size: BlockSize; position: 'left' | 'right' };
  log: { show: boolean; size: BlockSize; position: 'panel' | 'side' };
  hover: { show: boolean; size: BlockSize; position: 'panel' | 'center' | 'side' | 'tooltip' };
}
```

- `DEFAULT_LAYOUT` = a mesa larga padrão. `load()` valida campo a campo (como faz com `streamerPlaymat`): valor
  desconhecido volta ao padrão, então um JSON antigo ou editado à mão nunca quebra a mesa.
- `effectiveLayout(layout)` (função pura, testada) aplica as regras de conflito antes de renderizar: painel aberto
  puxa o outro bloco para o painel; DON!! embaixo manda a mão para o canto. O editor mostra o que vale de fato e
  desabilita a opção bloqueada.
- `sidePanel` (painel aberto/fechado) passa a derivar de `log`/`hover` no painel; o botão de histórico ao lado do
  deck continua abrindo e fechando o painel, gravando nesses campos.
- Por navegador, como as outras configurações. Sincronizar com a conta fica para depois.

## Como entra no código

1. **`settings.tsx`**: tipo, padrão, validação em `load()`, `update({ boardLayout })`.
2. **`components/WideBoard.tsx`** (novo): a mesa larga. Recebe o mesmo `BoardHandlers` do `Board` e o `layout`.
   Reaproveita `FieldCard`, `CardView`, `CardBack`, `MiniHand`, `HandFan` e os mesmos `data-anchor`
   (`life-`, `deck-`, `trash-`, `don-`, `dondeck-`, `hand-`, `arena`), então as animações do `Motion.tsx` e a seta
   de ataque não mudam. Estrutura por metade: `grid` com áreas `lcol field rcol` / `base base base` (invertidas para
   o oponente); a fileira do Líder é montada a partir da ordem calculada (lado + ordem de dentro para fora); a área
   de custo é a `.don-row` de hoje com largura fixa e os DON!! comprimidos.
   A `Board.tsx` atual continua intacta para o celular, o Streamer e o tutorial.
3. **`styles.css`**: `.wide-board`, `.half`, `.base`, `.lcol/.rcol`, `.cost-area`, `.side-area`, `.hand.corner`,
   `.center-row` (etiquetas + situação do turno). `--cw` da `board-col` no modo largo:
   `min((100cqh - 24px) / rows, (100cqw - 24px) / cols, 150px)`, com `rows`/`cols` vindos de `measure(layout)`
   (altura e largura mínima em larguras de carta). A mesa mede `max(cw * bw, 100% - 2 * side * cw)`: cresce até
   encostar nas laterais fixas. Cada bloco multiplica pelo seu `--k-*`. Painel: `--panel-w` em `.game.wide` (hoje fixo em 340 px) × 0,8/1/1,2.
4. **`GameScreen.tsx`**: lê `boardLayout`; em `wide && !streamer && !broadcast && !tutorial && !embed` renderiza
   `WideBoard` no lugar de `Board` e monta as laterais (mãos nos cantos, hover/histórico "ao lado da mesa") e o
   painel (turno e dica, detalhe, histórico, Encerrar turno) conforme `log`/`hover`; `hover.position === 'center'` é
   um portal centrado na `board-col`, `'tooltip'` reaproveita `CardHoverPreview`.
5. **`components/BoardLayoutEditor.tsx`** (novo): a tela, com a prévia (estado de exemplo de `game/setup.ts`) e os
   cartões. Aberta pelo `SettingsModal` e pelo menu da partida.
6. **i18n**: chaves `settings.boardLayout*` e `layout.*` (nomes dos blocos, posições, predefinições) nos seis idiomas.
7. **Docs**: seção em `documentacao-tecnica.md` (mesa larga e configurações) e nota no tutorial.

Riscos e cuidados:

- As laterais só existem em telas largas de verdade. Entre 1000 e 1300 px a `side-area` fica estreita: abaixo de uma
  largura mínima (uns 2 `--cw`), a mão volta para baixo da mesa e os blocos "ao lado da mesa" voltam para o painel.
- As lições do tutorial e as dicas do treinador apontam para zonas da mesa em coluna; no modo largo as zonas têm os
  mesmos `data-anchor`, mas vale conferir os textos que dizem "à esquerda do Líder".
- Tamanho "grande" em tudo ao mesmo tempo não estoura nada: `cols`/`rows` crescem e o `--cw` diminui. O editor
  mostra o resultado na prévia, que é a única forma honesta de avisar que ficou pequeno.

Esforço estimado: modelo + `WideBoard` + CSS (3 dias), painel/laterais/hover no GameScreen (1 dia), editor com
prévia (1,5 dia), i18n + docs + testes do `load()` (0,5 dia).

## Depois (v2, se valer a pena)

- Arrastar blocos livremente na prévia (posição em % da mesa, com grade de encaixe e colisão).
- Guardar o layout na conta, para valer em qualquer navegador.
- Layout do celular (só tamanho da mão e do histórico).
