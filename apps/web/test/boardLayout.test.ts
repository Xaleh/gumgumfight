import { describe, expect, it } from 'vitest';
import {
  baseOrder,
  blockedPositions,
  DEFAULT_LAYOUT,
  effectiveLayout,
  LAYOUT_PRESETS,
  matchingPreset,
  measureLayout,
  parseLayout,
  presetLayout,
} from '../src/game/boardLayout';

describe('layout da mesa: leitura do que foi salvo', () => {
  it('sem nada salvo (ou lixo), o padrão', () => {
    expect(parseLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('x')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ don: 'grande' })).toEqual(DEFAULT_LAYOUT);
  });

  it('campo a campo: o que é válido entra, o resto volta ao padrão', () => {
    const l = parseLayout({
      don: { size: 'large', position: 'row' },
      hand: { size: 'tiny', position: 'bottom', collapsed: 'yes' },
      life: { position: 'hidden' },
      log: { show: false, position: 'side' },
      hover: { position: 'center', size: 'small', show: 1 },
    });
    expect(l.don).toEqual({ size: 'large', position: 'row' });
    expect(l.hand).toEqual({ size: 'medium', position: 'bottom', collapsed: false });
    expect(l.life).toEqual(DEFAULT_LAYOUT.life);
    expect(l.log).toEqual({ show: false, size: 'medium', position: 'side' });
    expect(l.hover).toEqual({ show: true, size: 'small', position: 'center' });
  });

  it('o padrão não muda ao ser lido e devolvido', () => {
    expect(parseLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)))).toEqual(DEFAULT_LAYOUT);
  });
});

describe('layout da mesa: regras de conflito', () => {
  it('painel aberto puxa o outro bloco "ao lado da mesa" para o painel', () => {
    const e = effectiveLayout(parseLayout({ hover: { position: 'side' } }));
    expect(e.panelOn).toBe(true);
    expect(e.hover.position).toBe('panel');
    expect(e.sideHover).toBe(false);
    expect(blockedPositions(parseLayout({ hover: { position: 'side' } }), 'hover')).toEqual({ side: 'panelLog' });
  });

  it('centro da mesa e junto da carta convivem com o painel do histórico', () => {
    const e = effectiveLayout(parseLayout({ hover: { position: 'center' } }));
    expect(e.hover.position).toBe('center');
    expect(e.panelOn).toBe(true);
  });

  it('sem nada no painel, hover e histórico ficam ao lado da mesa e o painel fecha', () => {
    const e = effectiveLayout(parseLayout({ hover: { position: 'side' }, log: { position: 'side' } }));
    expect(e.panelOn).toBe(false);
    expect(e.sideHover).toBe(true);
    expect(e.sideLog).toBe(true);
  });

  it('fileira de DON!! abaixo do Líder manda a mão para o canto', () => {
    const l = parseLayout({ don: { position: 'row' }, hand: { position: 'bottom' } });
    expect(effectiveLayout(l).hand.position).toBe('corner-left');
    expect(blockedPositions(l, 'hand')).toEqual({ bottom: 'donRow' });
    expect(blockedPositions(parseLayout({ hand: { position: 'bottom' } }), 'don')).toEqual({ row: 'handBottom' });
  });
});

describe('layout da mesa: fileira do Líder', () => {
  it('padrão: DON!! à esquerda, Líder, Stage, Deck, Descarte', () => {
    expect(baseOrder(DEFAULT_LAYOUT)).toEqual(['DON', 'leader', 'stage', 'deck', 'trash']);
  });

  it('do Líder para fora: Stage, Deck, Descarte; a Vida junto do Líder do lado oposto aos DON!!', () => {
    const l = parseLayout({ stage: { position: 'left' }, deck: { position: 'left' }, life: { position: 'base' }, don: { position: 'right' } });
    expect(baseOrder(l)).toEqual(['life', 'deck', 'stage', 'leader', 'trash', 'DON']);
  });

  it('fileira de DON!! própria: a fileira do Líder fica sem os DON!!', () => {
    expect(baseOrder(parseLayout({ don: { position: 'row' } }))).toEqual(['leader', 'stage', 'deck', 'trash']);
  });
});

describe('layout da mesa: medidas e predefinições', () => {
  it('mais blocos grandes ocupam mais; mão embaixo da mesa gasta altura; laterais somem sem nada nelas', () => {
    const base = measureLayout(effectiveLayout(DEFAULT_LAYOUT));
    const big = measureLayout(effectiveLayout(presetLayout('bigcards')));
    expect(big.rows).toBeGreaterThan(base.rows);
    expect(big.cols).toBeGreaterThan(base.cols);
    const bottom = measureLayout(effectiveLayout(parseLayout({ hand: { position: 'bottom' } })));
    expect(bottom.rows).toBeGreaterThan(base.rows);
    expect(bottom.side).toBe(0);
    expect(base.side).toBeGreaterThan(0);
  });

  it('cada predefinição é reconhecida de volta; o padrão é a predefinição "default"', () => {
    for (const p of LAYOUT_PRESETS) expect(matchingPreset(presetLayout(p))).toBe(p);
    expect(matchingPreset(DEFAULT_LAYOUT)).toBe('default');
    expect(matchingPreset(parseLayout({ leader: { size: 'small' } }))).toBeNull();
  });
});
