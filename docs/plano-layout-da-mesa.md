# Layout da mesa configurável (proposta)

> Status: proposta, ainda não implementada. Protótipo interativo da tela: https://claude.ai/artifact/JJvoLdEjZ7gNMZfAqB468j

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

- **Largura:** 8 larguras de carta (`--cw`); altura: duas metades de 3,6 `--cw` mais a faixa do meio, uns 7,9 `--cw`.
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
| DON!! (área de custo: ativos, descansados, contadores) | não | P · M · G | à esquerda (padrão) · à direita do Líder, na fileira do Líder |
| Cartas na mão | não, mas **recolhe** (pilha com a contagem, abre ao clicar; reaproveita `MiniHand`/`HandFan`) | P · M · G | canto esquerdo (padrão) · canto direito · embaixo da mesa (gasta altura: a mesa encolhe) |
| Vida | **sim** (a etiqueta do jogador já mostra os corações) | P · M · G | coluna à esquerda do campo (padrão) · coluna à direita · junto do Líder (pilha pequena, como hoje) |
| Líder | não | P · M · G | fixo no centro da fileira |
| Stage | não | P · M · G | esquerda · direita (padrão) do Líder |
| Descarte | não | P · M · G | esquerda · direita (padrão) |
| Deck de DON!! | não | P · M · G | ponta de fora da área de custo (padrão) · junto do Líder |
| Deck | não | P · M · G | esquerda · direita (padrão) |
| Histórico (`LogPanel`) | **sim** | P · M · G (largura do painel: 0,8× · 1× · 1,2×) | painel lateral (padrão) · ao lado da mesa, à direita |
| Hover de carta (`CardDetail`) | **sim** | P · M · G | painel lateral (padrão) · centro da mesa (grande, por cima, só enquanto o mouse está na carta) · ao lado da mesa, à esquerda · junto da carta (`CardHoverPreview`) |

Regras:

- **Médio é o tamanho de referência.** Pequeno = 0,8×; Grande = 1,25×. Cada bloco multiplica o `--cw` por um `--k-*`.
- **Posição por encaixe, não por pixel.** Cada bloco escolhe entre poucas posições válidas. A mesa continua se
  ajustando ao tamanho da janela, as âncoras das animações (`data-anchor`) e a seta de ataque seguem funcionando, e
  dois blocos nunca se sobrepõem. Arrastar livremente fica como ideia de v2.
- Ordem na fileira do Líder, do Líder para fora: Stage, Deck, Descarte; a área de custo (com o deck de DON!!) ocupa
  o outro lado. Blocos do mesmo lado seguem essa ordem.
- **Histórico e Hover fora do painel ou ocultos** fecham o painel lateral (`no-panel`, já existe) e a mesa cresce.
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
  don: { size: BlockSize; position: 'left' | 'right' };
  hand: { size: BlockSize; position: 'corner-left' | 'corner-right' | 'bottom'; collapsed: boolean };
  life: { show: boolean; size: BlockSize; position: 'col-left' | 'col-right' | 'base' };
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
   `min((100cqh - 24px) / 7.9, (100cqw - 24px) / 12, 150px)` (12 = 8 da mesa + 2 por lado para as mãos). Cada bloco
   multiplica pelo seu `--k-*`. Painel: `--panel-w` em `.game.wide` (hoje fixo em 340 px) × 0,8/1/1,2.
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
- Tamanho "grande" em tudo ao mesmo tempo estoura as 8 larguras da fileira do Líder: o editor avisa e a fileira
  comprime a área de custo primeiro.

Esforço estimado: modelo + `WideBoard` + CSS (3 dias), painel/laterais/hover no GameScreen (1 dia), editor com
prévia (1,5 dia), i18n + docs + testes do `load()` (0,5 dia).

## Depois (v2, se valer a pena)

- Arrastar blocos livremente na prévia (posição em % da mesa, com grade de encaixe e colisão).
- Guardar o layout na conta, para valer em qualquer navegador.
- Layout do celular (só tamanho da mão e do histórico).
