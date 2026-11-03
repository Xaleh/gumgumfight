// Configurações › Layout da mesa › Personalizar: a prévia da mesa larga (viva: muda a cada toque) e um
// cartão por bloco com o que aparece, o tamanho e a posição. Aberto nas Configurações (com uma partida de
// exemplo) ou no menu da partida (com a própria partida). As escolhas só valem ao salvar.

import { type CardData, cardDef, createScenario, type GameState, type PlayerId } from '@gumgum/engine';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import {
  BLOCK_IDS,
  BLOCK_SIZES,
  type BlockId,
  type BlockSize,
  type BoardLayout,
  blockedPositions,
  cloneLayout,
  DEFAULT_LAYOUT,
  effectiveLayout,
  LAYOUT_PRESETS,
  type LayoutPreset,
  matchingPreset,
  panelWidth,
  presetLayout,
  sameLayout,
} from '../game/boardLayout';
import { buildSetup } from '../game/setup';
import { useBoardSize } from '../hooks/useBoardSize';
import { type MessageKey, useT } from '../i18n';
import { Switch, useSettings } from '../settings';
import type { BoardHandlers } from './Board';
import { CardTextInfo } from './CardInfo';
import { CardView } from './CardView';
import { WideBoard } from './WideBoard';

/** Posições que cada bloco oferece (as chaves de texto ficam em `layout.pos.<bloco>.<posição>`). */
const POSITIONS: { [K in BlockId]?: readonly string[] } = {
  don: ['left', 'right', 'row'],
  hand: ['corner-left', 'corner-right', 'bottom'],
  life: ['col-left', 'col-right', 'base'],
  stage: ['left', 'right'],
  trash: ['left', 'right', 'don'],
  donDeck: ['outer', 'inner'],
  deck: ['left', 'right'],
  log: ['panel', 'side'],
  hover: ['panel', 'center', 'side', 'tooltip'],
};
/** Blocos de que o jogo não depende: podem sumir da tela. */
const HIDEABLE: readonly BlockId[] = ['log', 'hover'];

/** A mesa da prévia não responde a nada. */
const INERT: BoardHandlers = {
  highlight: () => null,
  onCard: () => undefined,
  onCardDouble: () => undefined,
  onHover: () => undefined,
  onDon: () => undefined,
  donPicked: () => [],
  donHighlight: () => false,
  donDrop: () => false,
  onTrash: () => undefined,
  canDragHand: () => false,
  canDragAttacker: () => false,
  canDragDon: () => false,
  canDragAttached: () => false,
  fieldDrop: () => false,
};

/**
 * Uma partida de exemplo para a prévia fora da partida: o primeiro deck da lista (ou o primeiro pronto),
 * no turno 8, com Personagens em campo, DON!! na área de custo e algumas cartas no descarte.
 */
async function sampleState(): Promise<GameState> {
  const decks = await api.decks();
  const deck = decks.find((d) => d.kind === 'builtin' && d.valid) ?? decks[0];
  if (!deck) throw new Error('no decks');
  const setup = await buildSetup('bot', [deck.id, deck.id], ['Luffy', 'Bullnard'], 8, 'standard', 0);
  const cards = new Map<string, CardData>(setup.config.cards.map((c) => [c.id, c]));
  /** Cada lado tira as cartas do próprio deck: as cópias que sobram de cada id, para não pedir mais do que há. */
  const pool = () => {
    const left = new Map(setup.config.players[0].deck.cards.map((c) => [c.id, c.count]));
    const take = (n: number, category?: CardData['category']): string[] => {
      const out: string[] = [];
      for (const id of left.keys()) {
        if (category && cards.get(id)?.category !== category) continue;
        while (out.length < n && (left.get(id) ?? 0) > 0) {
          out.push(id);
          left.set(id, (left.get(id) ?? 0) - 1);
        }
        if (out.length >= n) break;
      }
      return out;
    };
    return take;
  };
  const mine = pool();
  const theirs = pool();
  const myChars = mine(3, 'character');
  const myTrash = [...mine(1, 'character'), ...mine(2, 'event')];
  const myHand = mine(7);
  const theirChars = theirs(3, 'character');
  const theirHand = theirs(6);
  try {
    return createScenario(setup.config, {
      turn: 8,
      active: 0,
      sides: [
        { characters: myChars, hand: myHand, donActive: 6, donRested: 1, life: 4, trash: myTrash },
        { characters: theirChars.map((id, i) => ({ id, rested: i === 1 })), hand: theirHand, donRested: 7, leader: { don: 1 }, life: 5 },
      ],
    });
  } catch {
    // Um deck sem cópias suficientes para o cenário: a partida recém-começada já serve para ver a mesa.
    return createScenario(setup.config, { turn: 1, active: 0, sides: [{}, {}] });
  }
}

function Seg<T extends string>({
  options,
  value,
  label,
  onPick,
  disabled,
  blocked,
}: {
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  value: T;
  label: string;
  onPick: (v: T) => void;
  disabled?: boolean;
  /** Opções que outra escolha bloqueia, com o motivo (no `title`). */
  blocked?: Partial<Record<T, string>>;
}) {
  return (
    <div className="seg small" role="group" aria-label={label}>
      {options.map((o) => {
        const why = blocked?.[o.id];
        return (
          <button
            key={o.id}
            type="button"
            className={o.id === value ? 'on' : ''}
            aria-pressed={o.id === value}
            disabled={disabled || Boolean(why)}
            title={why ?? o.title}
            onClick={() => onPick(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Prévia do painel lateral (o de verdade mora no GameScreen): a carta em detalhe e o histórico. */
function PanelPreview({ state, layout }: { state: GameState; layout: ReturnType<typeof effectiveLayout> }) {
  const t = useT();
  return (
    <aside className="side-panel tabbed-panel player-panel wm-preview-panel" aria-hidden="true">
      <div className="panel-tabs">
        <div className="seg small">
          <button type="button" className="on">
            {t('game.log')}
          </button>
          <button type="button">{t('game.decklist')}</button>
        </div>
      </div>
      {layout.hover.show && layout.hover.position === 'panel' && <DetailPreview state={state} />}
      {layout.log.show && layout.log.position === 'panel' && <LogPreview state={state} />}
    </aside>
  );
}

function LogPreview({ state }: { state: GameState }) {
  const t = useT();
  return (
    <div className="log">
      {state.log.length ? (
        state.log.slice(-12).map((e, i) => (
          <div key={i} className={['log-line', e.player === null ? '' : `p${e.player}`].join(' ')}>
            {e.text}
          </div>
        ))
      ) : (
        <div className="log-line muted">{t('layout.logPlaceholder')}</div>
      )}
    </div>
  );
}

function DetailPreview({ state }: { state: GameState }) {
  const ps = state.players[0];
  const uid = ps.characters[0]?.uid ?? ps.leader.uid;
  return (
    <div className="detail">
      <div className="detail-card">
        <CardView state={state} uid={uid} />
      </div>
      <CardTextInfo def={cardDef(state, uid)} />
    </div>
  );
}

/**
 * A tela. `state`: a partida em andamento (no menu da partida); sem ela, uma partida de exemplo.
 */
export function BoardLayoutEditor({ state, onClose }: { state?: GameState; onClose: () => void }) {
  const t = useT();
  const settings = useSettings();
  const [draft, setDraft] = useState<BoardLayout>(() => cloneLayout(settings.boardLayout));
  const [sample, setSample] = useState<GameState | null>(state ?? null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<MessageKey | null>(null);
  useEffect(() => {
    if (state) return;
    let cancelled = false;
    sampleState().then(
      (s) => !cancelled && setSample(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const eff = useMemo(() => effectiveLayout(draft), [draft]);
  // A prévia mede a própria coluna (--bw/--bh), como a mesa de verdade faz no GameScreen.
  const previewCol = useRef<HTMLDivElement>(null);
  useBoardSize(previewCol);
  const preset = matchingPreset(draft);
  const dirty = !sameLayout(draft, settings.boardLayout);
  const key = (k: string) => k as MessageKey;
  const patch = <K extends BlockId>(id: K, p: Partial<BoardLayout[K]>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const save = () => {
    settings.update({ boardLayout: cloneLayout(draft) });
    setToast('layout.saved');
  };
  const bottom: PlayerId = 0;

  const blocks = BLOCK_IDS.map((id) => {
    const b = draft[id] as { size: BlockSize; position?: string; show?: boolean; collapsed?: boolean };
    const hideable = HIDEABLE.includes(id);
    const off = hideable && b.show === false;
    const positions = POSITIONS[id];
    const blocked = blockedPositions(draft, id);
    const blockedText: Record<string, string> = {};
    for (const [pos, why] of Object.entries(blocked)) blockedText[pos] = t(key(`layout.blocked.${why}`));
    const name = t(key(`layout.block.${id}`));
    return (
      <div key={id} className={['layout-block', off ? 'off' : ''].join(' ')}>
        <div className="layout-block-head">
          <div className="layout-block-name">
            {name}
            {!hideable && (
              <span className="layout-lock" title={t('layout.requiredTitle')}>
                {t('layout.required')}
              </span>
            )}
          </div>
          <Switch on={!off} disabled={!hideable} label={t('layout.show', { name })} onChange={(on) => patch(id, { show: on } as Partial<BoardLayout[typeof id]>)} />
        </div>
        <p className="layout-hint">{t(key(`layout.hint.${id}`))}</p>
        <div className="layout-row">
          <span className="layout-label">{t('layout.size')}</span>
          <Seg
            label={t('layout.size')}
            value={b.size}
            disabled={off}
            options={BLOCK_SIZES.map((sz) => ({ id: sz, label: t(key(`layout.size.${sz}`)), title: t(key(`layout.sizeTitle.${sz}`)) }))}
            onPick={(sz) => patch(id, { size: sz } as Partial<BoardLayout[typeof id]>)}
          />
        </div>
        {positions && (
          <div className="layout-row">
            <span className="layout-label">{t('layout.position')}</span>
            <Seg
              label={t('layout.position')}
              value={(eff[id] as { position?: string }).position ?? b.position ?? ''}
              disabled={off}
              blocked={blockedText}
              options={positions.map((pos) => ({ id: pos, label: t(key(`layout.pos.${id}.${pos}`)) }))}
              onPick={(pos) => patch(id, { position: pos } as Partial<BoardLayout[typeof id]>)}
            />
          </div>
        )}
        {id === 'hand' && (
          <div className="layout-row">
            <span className="layout-label" title={t('layout.collapsedHint')}>
              {t('layout.collapsed')}
            </span>
            <Switch on={Boolean(b.collapsed)} label={t('layout.collapsed')} onChange={(on) => patch('hand', { collapsed: on })} />
          </div>
        )}
      </div>
    );
  });

  // A coluna da prévia existe desde o primeiro render (mesmo sem a partida de exemplo ainda): o useBoardSize
  // mede a coluna ao montar e só avisa de novo quando o tamanho muda; se ela surgisse depois, ficaria sem medida.
  const preview: ReactNode = (
    <div className={['wm-preview', eff.panelOn && sample ? '' : 'no-panel'].join(' ')} style={{ ['--panel-w' as string]: `${panelWidth(eff)}px` }}>
      <div className="board-col wm-preview-col" ref={previewCol}>
        {sample ? (
          <WideBoard
            state={sample}
            bottom={bottom}
            revealBottom
            revealTop={false}
            layout={eff}
            center={<span className="hint-pill soft">{t('layout.previewTurn', { n: sample.turn })}</span>}
            sideLeft={eff.sideHover ? <DetailPreview state={sample} /> : undefined}
            sideRight={eff.sideLog ? <LogPreview state={sample} /> : undefined}
            overlay={eff.hover.show && eff.hover.position === 'center' ? <DetailPreview state={sample} /> : undefined}
            inert
            {...INERT}
          />
        ) : (
          <div className="wm-preview-wait">{failed ? t('layout.previewFailed') : t('common.loading')}</div>
        )}
      </div>
      {eff.panelOn && sample && <PanelPreview state={sample} layout={eff} />}
    </div>
  );

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet layout-sheet" role="dialog" aria-label={t('layout.title')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('layout.title')}</h3>
          <div className="layout-presets">
            <span className="muted small">{t('layout.presets')}</span>
            <Seg<LayoutPreset | ''>
              label={t('layout.presets')}
              value={preset ?? ''}
              options={LAYOUT_PRESETS.map((p) => ({ id: p, label: t(key(`layout.preset.${p}`)) }))}
              onPick={(p) => p && setDraft(presetLayout(p))}
            />
          </div>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body layout-body">
          <div className="layout-preview-note muted small">
            <span>{t('layout.previewHint')}</span>
            <span>
              {preset ? t(key(`layout.preset.${preset}`)) : t('layout.custom')}
              {dirty ? ` · ${t('layout.unsaved')}` : ''}
            </span>
          </div>
          {preview}
          <div className="layout-blocks">{blocks}</div>
        </div>
        <div className="sheet-foot layout-foot">
          <button className="btn" onClick={() => setDraft(cloneLayout(DEFAULT_LAYOUT))} disabled={sameLayout(draft, DEFAULT_LAYOUT)}>
            {t('layout.reset')}
          </button>
          <span className="layout-toast" role="status">
            {toast ? t(toast) : ''}
          </span>
          <div className="layout-actions">
            <button className="btn" onClick={() => setDraft(cloneLayout(settings.boardLayout))} disabled={!dirty}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" onClick={save} disabled={!dirty}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
