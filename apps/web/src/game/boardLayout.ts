// Layout da mesa larga (desktop): o que o jogador escolhe em Configurações › Layout da mesa, as regras
// de conflito entre os blocos e as medidas que dimensionam as cartas para a mesa nunca sair da tela.
// Funções puras, sem React: a mesa (`WideBoard`) e o editor (`BoardLayoutEditor`) só leem daqui.

export type BlockSize = 'small' | 'medium' | 'large';
export const BLOCK_SIZES: readonly BlockSize[] = ['small', 'medium', 'large'];
/** Multiplicador de cada tamanho sobre a largura de carta de referência (médio = 1). */
export const SIZE_K: Record<BlockSize, number> = { small: 0.8, medium: 1, large: 1.25 };

export type DonPosition = 'left' | 'right' | 'row';
export type HandPosition = 'corner-left' | 'corner-right' | 'bottom';
export type LifePosition = 'col-left' | 'col-right' | 'base';
export type SidePosition = 'left' | 'right';
export type DonDeckPosition = 'outer' | 'inner';
export type LogPosition = 'panel' | 'side';
export type HoverPosition = 'panel' | 'center' | 'side' | 'tooltip';

export interface BoardLayout {
  /** Área de custo (DON!! ativos e descansados): num lado da fileira do Líder, ou numa fileira própria abaixo dele. */
  don: { size: BlockSize; position: DonPosition };
  /** Leque da mão: num canto, fora da mesa, ou embaixo dela. `collapsed`: pilha com a contagem, abre ao clicar. */
  hand: { size: BlockSize; position: HandPosition; collapsed: boolean };
  /** Vida: coluna ao lado dos Personagens, ou a pilha pequena junto do Líder. Faz parte do campo: nunca some. */
  life: { size: BlockSize; position: LifePosition };
  leader: { size: BlockSize };
  stage: { size: BlockSize; position: SidePosition };
  trash: { size: BlockSize; position: SidePosition };
  /** De onde os DON!! entram na área de custo: na ponta de fora dela ou na de dentro (junto do Líder). */
  donDeck: { size: BlockSize; position: DonDeckPosition };
  deck: { size: BlockSize; position: SidePosition };
  /** Histórico: no painel lateral ou ao lado da mesa (no espaço livre à direita). */
  log: { show: boolean; size: BlockSize; position: LogPosition };
  /** Carta ampliada ao passar o mouse: painel, centro da mesa, ao lado da mesa (à esquerda) ou junto da carta. */
  hover: { show: boolean; size: BlockSize; position: HoverPosition };
}

export type BlockId = keyof BoardLayout;
export const BLOCK_IDS: readonly BlockId[] = ['don', 'hand', 'life', 'leader', 'stage', 'trash', 'donDeck', 'deck', 'log', 'hover'];

export const DEFAULT_LAYOUT: BoardLayout = {
  don: { size: 'medium', position: 'left' },
  hand: { size: 'medium', position: 'corner-left', collapsed: false },
  life: { size: 'medium', position: 'col-left' },
  leader: { size: 'medium' },
  stage: { size: 'medium', position: 'right' },
  trash: { size: 'medium', position: 'right' },
  donDeck: { size: 'medium', position: 'outer' },
  deck: { size: 'medium', position: 'right' },
  log: { show: true, size: 'medium', position: 'panel' },
  hover: { show: true, size: 'medium', position: 'panel' },
};

export type LayoutPreset = 'default' | 'compact' | 'bigcards' | 'open';
export const LAYOUT_PRESETS: readonly LayoutPreset[] = ['default', 'compact', 'bigcards', 'open'];

type Patch = { [K in BlockId]?: Partial<BoardLayout[K]> };
function withPatch(base: BoardLayout, patch: Patch): BoardLayout {
  const out = cloneLayout(base);
  for (const id of BLOCK_IDS) {
    const p = patch[id];
    if (p) Object.assign(out[id], p);
  }
  return out;
}

export function presetLayout(preset: LayoutPreset): BoardLayout {
  switch (preset) {
    case 'compact': {
      const small: Patch = {};
      for (const id of BLOCK_IDS) small[id] = { size: 'small' };
      return withPatch(withPatch(DEFAULT_LAYOUT, small), { leader: { size: 'medium' }, hover: { position: 'tooltip' } });
    }
    case 'bigcards':
      return withPatch(DEFAULT_LAYOUT, { leader: { size: 'large' }, hand: { size: 'large' }, log: { show: false }, hover: { position: 'center', size: 'large' } });
    case 'open':
      return withPatch(DEFAULT_LAYOUT, { life: { size: 'large' }, hand: { position: 'bottom' }, log: { position: 'side', size: 'small' }, hover: { position: 'side' } });
    default:
      return cloneLayout(DEFAULT_LAYOUT);
  }
}

/** A predefinição igual a este layout, se houver. */
export function matchingPreset(layout: BoardLayout): LayoutPreset | null {
  return LAYOUT_PRESETS.find((p) => sameLayout(presetLayout(p), layout)) ?? null;
}

export function cloneLayout(l: BoardLayout): BoardLayout {
  return JSON.parse(JSON.stringify(l)) as BoardLayout;
}

export function sameLayout(a: BoardLayout, b: BoardLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ------------------------------------------------------------------ validação

const POSITIONS: { [K in BlockId]: readonly string[] | null } = {
  don: ['left', 'right', 'row'],
  hand: ['corner-left', 'corner-right', 'bottom'],
  life: ['col-left', 'col-right', 'base'],
  leader: null,
  stage: ['left', 'right'],
  trash: ['left', 'right'],
  donDeck: ['outer', 'inner'],
  deck: ['left', 'right'],
  log: ['panel', 'side'],
  hover: ['panel', 'center', 'side', 'tooltip'],
};

/**
 * Layout salvo (ou qualquer JSON): campo a campo, o que não for reconhecido volta ao padrão, então um
 * valor antigo ou editado à mão nunca quebra a mesa.
 */
export function parseLayout(raw: unknown): BoardLayout {
  const out = cloneLayout(DEFAULT_LAYOUT);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const id of BLOCK_IDS) {
    const b = r[id];
    if (!b || typeof b !== 'object') continue;
    const v = b as Record<string, unknown>;
    const block = out[id] as { size: BlockSize; position?: string; show?: boolean; collapsed?: boolean };
    if (BLOCK_SIZES.includes(v.size as BlockSize)) block.size = v.size as BlockSize;
    const allowed = POSITIONS[id];
    if (allowed && typeof v.position === 'string' && allowed.includes(v.position)) block.position = v.position;
    if ('show' in block && typeof v.show === 'boolean') block.show = v.show;
    if ('collapsed' in block && typeof v.collapsed === 'boolean') block.collapsed = v.collapsed;
  }
  return out;
}

// ------------------------------------------------------------------ regras de conflito

export interface EffectiveLayout extends BoardLayout {
  /** O painel lateral está aberto: o histórico ou o hover moram nele (e então os dois). */
  panelOn: boolean;
  /** Hover grande ao lado da mesa, à esquerda. */
  sideHover: boolean;
  /** Histórico ao lado da mesa, à direita. */
  sideLog: boolean;
}

/**
 * O layout que vale de fato, depois das regras:
 * - painel lateral: se o histórico ou o hover está nele, o outro "ao lado da mesa" entra nele também;
 * - mão e DON!!: com a fileira de DON!! abaixo do Líder a mão não fica embaixo da mesa (vai para o canto esquerdo).
 */
export function effectiveLayout(l: BoardLayout): EffectiveLayout {
  const e = cloneLayout(l) as EffectiveLayout;
  const panelOn = (l.log.show && l.log.position === 'panel') || (l.hover.show && l.hover.position === 'panel');
  if (panelOn && e.hover.position === 'side') e.hover.position = 'panel';
  if (panelOn && e.log.position === 'side') e.log.position = 'panel';
  if (l.don.position === 'row' && e.hand.position === 'bottom') e.hand.position = 'corner-left';
  e.panelOn = panelOn;
  e.sideHover = e.hover.show && e.hover.position === 'side';
  e.sideLog = e.log.show && e.log.position === 'side';
  return e;
}

export type BlockedReason = 'donRow' | 'handBottom' | 'panelHover' | 'panelLog';

/** Opções de posição de um bloco que outra escolha bloqueia, com o motivo (para desabilitar no editor). */
export function blockedPositions(l: BoardLayout, id: BlockId): Record<string, BlockedReason> {
  const e = effectiveLayout(l);
  if (id === 'hand' && l.don.position === 'row') return { bottom: 'donRow' };
  if (id === 'don' && l.hand.position === 'bottom') return { row: 'handBottom' };
  if (id === 'hover' && e.panelOn && l.hover.position !== 'panel') return { side: 'panelLog' };
  if (id === 'log' && e.panelOn && l.log.position !== 'panel') return { side: 'panelHover' };
  return {};
}

// ------------------------------------------------------------------ ordem na fileira do Líder

export type BaseItem = 'DON' | 'stage' | 'deck' | 'trash' | 'life' | 'leader';

/**
 * A fileira do Líder de quem joga, da esquerda para a direita (o oponente recebe a mesma lista invertida).
 * Do Líder para fora: Stage, Deck, Descarte; a Vida "junto do Líder" fica do lado oposto aos DON!!.
 */
export function baseOrder(l: BoardLayout): BaseItem[] {
  const left: BaseItem[] = [];
  const right: BaseItem[] = [];
  for (const id of ['stage', 'deck', 'trash'] as const) (l[id].position === 'left' ? left : right).push(id);
  if (l.life.position === 'base') (l.don.position === 'left' ? right : left).push('life');
  let row: BaseItem[] = left.slice().reverse();
  if (l.don.position === 'left') row = ['DON', ...row];
  row = [...row, 'leader', ...right];
  if (l.don.position === 'right') row = [...row, 'DON'];
  return row;
}

// ------------------------------------------------------------------ medidas

/** Proporções da mesa larga, em larguras de carta (`--cw`); o CSS usa os mesmos números. */
export const WIDE = {
  /** Largura dos blocos, em `--cw` (antes do multiplicador de tamanho). */
  leader: 1.3,
  stage: 0.9,
  pile: 0.72,
  /** Vida em coluna (ao lado dos Personagens) e junto do Líder. */
  lifeCol: 0.74,
  lifeBase: 0.56,
  /** Um DON!! na área de custo; a área comprime os DON!! para caber em `costW` DON!!. */
  don: 0.5,
  costW: 5.4,
  /** A área de custo na fileira própria (abaixo do Líder). */
  costRowW: 9,
  /** Carta da mão num canto e embaixo da mesa. */
  handCorner: 1.0,
  handBottom: 0.95,
  /** Carta da mão do oponente (sempre em cima). */
  oppHand: 0.62,
  /** Carta do hover ao lado da mesa e no painel. */
  hoverSide: 2.0,
  /** Largura das laterais, em `--cw`: mão no canto, hover, histórico. */
  sideHand: 1.7,
  sideHandCollapsed: 1.4,
  sideHover: 2.3,
  sideLog: 2.6,
  /** Largura mínima da mesa (os Personagens e as folgas), em `--cw`. */
  minBoard: 7.4,
  /** Proporção altura/largura de uma carta. */
  ratio: 1.396,
} as const;

export interface LayoutMeasure {
  /** Altura ocupada, em `--cw` (a mesa mais as faixas que dependem do tamanho das cartas). */
  rows: number;
  /** Altura fixa ocupada, em px (faixa do meio, barra da mão, folgas). */
  fixedPx: number;
  /** Largura mínima ocupada, em `--cw`: a mesa mais as duas laterais. */
  cols: number;
  /** Largura mínima da mesa, em `--cw`. */
  boardW: number;
  /** Largura de cada lateral, em `--cw` (0 = sem laterais). */
  side: number;
}

/**
 * Quanto a mesa ocupa com este layout, para o CSS calcular o `--cw`:
 * `--cw = min((altura - fixedPx) / rows, largura / cols, teto)`. Estimativa generosa; a mesa ainda mede o
 * resultado e aperta se algo passar (ver `WideBoard`).
 */
export function measureLayout(e: EffectiveLayout): LayoutMeasure {
  const k = (id: BlockId) => SIZE_K[e[id].size];
  const R = WIDE.ratio;
  const lifeColH = e.life.position !== 'base' ? WIDE.lifeCol * k('life') * (0.71 + 4 * 0.3) + 0.4 : 0;
  const fieldH = Math.max(R, lifeColH);
  const baseH = Math.max(WIDE.leader * k('leader') * R, WIDE.don * k('don') * R + 0.6, WIDE.pile * Math.max(k('deck'), k('trash')) * R + 0.35) + 0.1;
  let half = 0.3 + fieldH + 0.12 + baseH;
  if (e.don.position === 'row') half += WIDE.don * k('don') * R + 0.65;
  let rows = 2 * half + 0.2;
  let fixedPx = 78; // faixa do meio (turno, botões) e folgas
  const handH = e.hand.collapsed ? 1.0 : (e.hand.position === 'bottom' ? WIDE.handBottom : WIDE.handCorner) * k('hand') * R + 0.5;
  if (e.hand.position === 'bottom') {
    rows += handH;
    fixedPx += 30; // barra com a faixa do jogador e Ordenar / Ver mão
  }
  const donW = e.don.position === 'row' ? 0 : WIDE.don * k('don') * (1.15 * (k('donDeck') / k('don')) + WIDE.costW) + 0.4;
  const baseW =
    0.3 +
    WIDE.leader * k('leader') +
    WIDE.stage * k('stage') +
    WIDE.pile * k('deck') +
    WIDE.pile * k('trash') +
    (e.life.position === 'base' ? WIDE.lifeBase * k('life') + 0.12 : 0) +
    donW +
    5 * 0.12;
  const fieldW = 0.3 + 5 + 4 * 0.1 + (e.life.position !== 'base' ? WIDE.lifeCol * k('life') + 0.12 : 0);
  const boardW = Math.max(baseW, fieldW, WIDE.minBoard);
  let side = 0;
  if (e.hand.position !== 'bottom') side = Math.max(side, e.hand.collapsed ? WIDE.sideHandCollapsed : WIDE.sideHand * k('hand'));
  if (e.sideHover) side = Math.max(side, WIDE.sideHover * k('hover'));
  if (e.sideLog) side = Math.max(side, WIDE.sideLog);
  // Mão embaixo da mesa e nenhuma lateral: a mão do oponente numa faixa acima da mesa.
  if (e.hand.position === 'bottom' && side === 0) rows += WIDE.oppHand * R + 0.4;
  // As laterais também têm altura: a mão do oponente, o hover/histórico e a sua mão.
  let sideH = 0;
  if (side > 0) sideH += WIDE.oppHand * R + 0.5;
  if (e.sideHover) sideH += WIDE.hoverSide * k('hover') * R + 2;
  if (e.hand.position !== 'bottom') sideH += handH + 0.4;
  rows = Math.max(rows, sideH);
  return { rows, fixedPx, cols: boardW + 2 * side, boardW, side };
}

/** Largura do painel lateral (px) para o tamanho do bloco que mora nele. */
export function panelWidth(e: EffectiveLayout): number {
  const size = e.log.show && e.log.position === 'panel' ? e.log.size : e.hover.size;
  return { small: 280, medium: 340, large: 420 }[size];
}
