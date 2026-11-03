# Layout da mesa configurável (proposta)

> Status: proposta, ainda não implementada. Protótipo interativo da tela: https://claude.ai/artifact/JJvoLdEjZ7gNMZfAqB468j

O jogador abre, nas Configurações, a tela **Layout da mesa › Personalizar** e ajusta cada bloco da mesa de quem joga:
tamanho (pequeno, médio = o atual, grande), posição e, para os blocos de que o jogo não depende, se aparece ou não.

## Escopo

| Vale para | Fica como está |
|-----------|----------------|
| A mesa de quem joga (`Board.tsx`) no desktop (`wide`, ≥ 1000 px): treino contra o bot, online, torneio, replay próprio | Celular e tablet (a mesa já usa cada pixel; o layout fixo continua) |
| | Visão do Streamer em pé e lateral (`lifeAside`, `LateralBoard.tsx`), transmissão (`broadcast`) e replay embutido (`embed`) |
| | Tutorial (as lições apontam para as zonas; o layout padrão garante que a dica aponte para o lugar certo) |

O lado do oponente **espelha** o do jogador, como hoje (`PlayerSide` com `position: 'top'`): a pessoa configura só a própria metade.

## Blocos

| Bloco | Ocultar | Tamanho | Posição |
|-------|---------|---------|---------|
| DON!! (fileira: ativos, descansados, contadores) | não | P · M · G | esquerda (atual) · centro · direita da fileira |
| Cartas na mão | não, mas **recolhe** (pilha com a contagem, abre ao clicar, reaproveita `MiniHand`/`HandFan`) | P · M · G | esquerda · centro (atual) · direita |
| Vida | **sim** (a faixa do jogador já mostra os corações, `PlayerBanner`) | P · M · G | lado esquerdo do Líder (atual) · lado direito · coluna de fora (reaproveita `life-col` do Streamer) |
| Líder | não | P · M · G | fixo no centro |
| Stage | não | P · M · G | lado esquerdo (atual) · lado direito |
| Descarte | não | P · M · G | lado esquerdo · lado direito (atual) |
| Deck de DON!! | não | P · M · G | início (atual) · fim da fileira de DON!! |
| Deck | não | P · M · G | lado esquerdo · lado direito (atual) · ponta de fora (reaproveita `side-aux`) |
| Histórico (`LogPanel`) | **sim** | P · M · G (largura do painel: 280 · 340 · 420 px) | painel lateral (atual) · flutuante sobre a mesa (caixa semitransparente no canto) |
| Hover de carta (`CardDetail`) | **sim** | P · M · G (carta: 150 · 190 · 240 px) | painel lateral, acima do histórico (atual) · junto da carta (reaproveita `CardHoverPreview`) |

Regras:

- **Médio é o tamanho de hoje.** Pequeno = 0,8×; Grande = 1,25×. Os blocos só multiplicam o `--cw` que já define tudo.
- **Posição por encaixe, não por pixel.** Cada bloco escolhe entre poucas posições válidas. É o que mantém a mesa
  responsiva (o `--cw` é calculado pelo tamanho do contêiner), as âncoras das animações (`data-anchor`) e a seta de
  ataque funcionando, e evita blocos sobrepostos. Arrastar livremente fica como ideia de v2 (ver o fim).
- **Histórico e Hover ocultos** fecham o painel lateral (`no-panel`, já existe): a mesa ocupa a tela toda.
- Ordem dos blocos ao redor do Líder, de dentro para fora: Stage, Deck, Descarte, Vida. Dois blocos do mesmo lado
  seguem essa ordem (é o que a mesa já faz: Vida fora e Stage dentro, à esquerda; Deck e Descarte à direita).

Predefinições na própria tela, para quem não quer mexer bloco a bloco: **Padrão**, **Compacta** (tudo pequeno),
**Cartas grandes** (Líder e mão grandes, histórico oculto, hover junto da carta) e **Playmat** (Vida e Deck nas
pontas, mão recolhida, histórico flutuante). Cada predefinição é só um `BoardLayout` pronto.

## A tela

- **Entrada:** em Configurações, uma linha "Layout da mesa" com o botão **Personalizar** (abaixo de "Painel lateral",
  que ela absorve). No menu da partida, o mesmo botão, para ajustar olhando a mesa de verdade.
- **Esquerda:** prévia viva. É o próprio `Board` renderizado com um estado de exemplo (o `game/setup.ts` monta um estado
  com um starter deck; handlers inertes) e o layout em edição. Passar o mouse num bloco da lista realça a zona na prévia;
  clicar numa zona da prévia rola até o bloco. Aberta dentro da partida, a prévia é a partida.
- **Direita:** um cartão por bloco: nome, interruptor (travado com "obrigatório" nos que não podem sumir),
  Tamanho (P · M · G) e Posição (segmentado com as opções do bloco). Mão tem ainda "Recolhida".
- **Rodapé:** Restaurar padrão · Cancelar · Salvar. As mudanças só valem ao salvar.

## Modelo e persistência

Entra em `Settings` (`settings.tsx`), salvo no `localStorage` com as demais (`gumgum.settings`):

```ts
export type BlockSize = 'small' | 'medium' | 'large';
export interface BoardLayout {
  don: { size: BlockSize; align: 'left' | 'center' | 'right' };
  hand: { size: BlockSize; align: 'left' | 'center' | 'right'; collapsed: boolean };
  life: { show: boolean; size: BlockSize; position: 'left' | 'right' | 'aside' };
  leader: { size: BlockSize };
  stage: { size: BlockSize; position: 'left' | 'right' };
  trash: { size: BlockSize; position: 'left' | 'right' };
  donDeck: { size: BlockSize; position: 'start' | 'end' };
  deck: { size: BlockSize; position: 'left' | 'right' | 'aside' };
  log: { show: boolean; size: BlockSize; position: 'panel' | 'overlay' };
  hover: { show: boolean; size: BlockSize; position: 'panel' | 'tooltip' };
}
```

- `DEFAULT_LAYOUT` = a mesa de hoje. `load()` valida campo a campo (como faz com `streamerPlaymat`): valor
  desconhecido volta ao padrão, então um JSON antigo ou editado à mão nunca quebra a mesa.
- `sidePanel` (painel aberto/fechado) passa a derivar de `log.show || hover.show`; o botão de histórico ao lado do
  deck continua abrindo e fechando o painel, só que agora grava nesses dois campos.
- Por navegador, como as outras configurações. Sincronizar com a conta fica para depois, se fizer sentido.

## Como entra no código

1. **`settings.tsx`**: tipo, padrão, validação em `load()`, `update({ boardLayout })`.
2. **`Board.tsx`**: prop `layout?: BoardLayout` (ausente = padrão, o que mantém Streamer, broadcast e tutorial iguais).
   - `PlayerSide` monta `base-row` a partir da ordem calculada (lado + ordem de dentro para fora) em vez do JSX fixo;
     `life.position === 'aside'` e `deck.position === 'aside'` reaproveitam `life-col`/`side-aux` do `lifeAside`.
   - `don-row` recebe a classe de alinhamento e a ordem deck/cartas/contadores.
   - `Hand` recebe o alinhamento; `hand.collapsed` troca por `MiniHand` + `HandFan` (já existem).
   - A `section.mat` recebe `data-*` e variáveis CSS: `--k-don`, `--k-hand`, `--k-life`, `--k-leader`, `--k-stage`,
     `--k-trash`, `--k-dondeck`, `--k-deck`.
3. **`styles.css`**: cada bloco multiplica pelo seu `--k-*` (padrão 1) nos `calc()` que já existem
   (`.leader-zone --cw-leader`, `.stage-zone`, `.pile --cw-pile`, `.life-zone`, `.don-row --dw`, `.board-col --hcw`).
   Painel: `--panel-w` em `.game.wide` (hoje fixo em 340 px) e `--detail-w` em `.side-panel .detail-card`.
   Novo: `.log-overlay` (histórico flutuante sobre a arena).
4. **`GameScreen.tsx`**: lê `boardLayout` das configurações; passa `layout` ao `Board` só quando
   `wide && !streamer && !broadcast && !tutorial && !embed`; monta o painel com histórico e/ou detalhe conforme
   `log`/`hover`; em `hover.position === 'tooltip'`, mostra `CardHoverPreview` num portal (como já faz nas folhas);
   em `log.position === 'overlay'`, o `LogPanel` dentro de `.log-overlay` na `board-col`.
5. **`components/BoardLayoutEditor.tsx`** (novo): a tela, com a prévia (estado de exemplo de `game/setup.ts`) e os
   cartões. Aberta pelo `SettingsModal` e pelo menu da partida.
6. **i18n**: chaves `settings.boardLayout*` e `layout.*` (nomes dos blocos, posições, predefinições) nos seis idiomas.
7. **Docs**: seção em `documentacao-tecnica.md` (configurações) e nota no tutorial de que a lição usa o layout padrão.

Riscos e cuidados:

- Os `data-anchor` das animações e as consultas `.mat .card[data-uid]` da seta de ataque usam o DOM, então seguem
  funcionando em qualquer encaixe; vale conferir as animações de Vida e de DON!! com os blocos "de fora".
- Tamanho "grande" em tudo ao mesmo tempo não cabe em telas de 1000–1200 px. O `--cw` já é limitado pela altura e
  largura do contêiner, então a mesa encolhe inteira para caber. A prévia deixa isso visível antes de salvar.
- O histórico flutuante cobre parte da mesa do oponente: fica com no máximo 1/3 da altura e some ao arrastar uma carta.

Esforço estimado: modelo + Board + CSS (2 dias), painel/hover/overlay no GameScreen (1 dia), editor com prévia
(1,5 dia), i18n + docs + testes do `load()` (0,5 dia).

## Depois (v2, se valer a pena)

- Arrastar blocos livremente na prévia (posição em % da mesa, com grade de encaixe e colisão). Exige trocar o flex da
  mesa por posicionamento absoluto por bloco e tratar cada tamanho de tela; a v1 por encaixes cobre o que os
  jogadores pedem (Vida do outro lado, mão menor, histórico fora) sem esse custo.
- Guardar o layout na conta, para valer em qualquer navegador.
- Layout do celular (só tamanho da mão e do histórico).
