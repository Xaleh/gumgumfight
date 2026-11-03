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

  it('quem ficou no padrão antigo (tudo no painel, DON!! à esquerda) passa ao novo; o resto continua como está', () => {
    const legacy = {
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
    expect(parseLayout(legacy)).toEqual(DEFAULT_LAYOUT);
    const custom = { ...legacy, leader: { size: 'large' } };
    expect(parseLayout(custom).don.position).toBe('left');
    expect(parseLayout(custom).leader.size).toBe('large');
  });
});

describe('layout da mesa: regras de conflito', () => {
  it('painel aberto puxa o outro bloco "ao lado da mesa" para o painel', () => {
    const e = effectiveLayout(parseLayout({ hover: { position: 'side' }, log: { position: 'panel' } }));
    expect(e.panelOn).toBe(true);
    expect(e.hover.position).toBe('panel');
    expect(e.sideHover).toBe(false);
    expect(blockedPositions(parseLayout({ hover: { position: 'side' }, log: { position: 'panel' } }), 'hover')).toEqual({ side: 'panelLog' });
  });

  it('centro da mesa e junto da carta convivem com o painel do histórico', () => {
    const e = effectiveLayout(parseLayout({ hover: { position: 'center' }, log: { position: 'panel' } }));
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

describe('layout da mesa: padrão', () => {
  it('hover e histórico nas laterais (painel fechado), DON!! numa fileira abaixo do Líder, Descarte junto dos DON!!', () => {
    const e = effectiveLayout(DEFAULT_LAYOUT);
    expect(e.panelOn).toBe(false);
    expect(e.sideHover).toBe(true);
    expect(e.sideLog).toBe(true);
    expect(e.hand.position).toBe('corner-left');
    expect(e.life.position).toBe('col-left');
    expect(e.don.position).toBe('row');
    expect(e.trash.position).toBe('don');
    expect(baseOrder(DEFAULT_LAYOUT)).toEqual(['leader', 'stage', 'deck']);
  });
});

describe('layout da mesa: fileira do Líder', () => {
  it('DON!! à esquerda: DON!!, Líder, Stage, Deck, Descarte', () => {
    expect(baseOrder(parseLayout({ don: { position: 'left' }, trash: { position: 'right' } }))).toEqual(['DON', 'leader', 'stage', 'deck', 'trash']);
  });

  it('Descarte junto dos DON!! sem a fileira de DON!!: do lado dos DON!!, colado neles', () => {
    const l = parseLayout({ don: { position: 'left' }, trash: { position: 'don' } });
    expect(baseOrder(l)).toEqual(['DON', 'trash', 'leader', 'stage', 'deck']);
    expect(effectiveLayout(l).trash.position).toBe('left');
    const r = parseLayout({ don: { position: 'right' }, trash: { position: 'don' } });
    expect(baseOrder(r)).toEqual(['leader', 'stage', 'deck', 'trash', 'DON']);
  });

  it('do Líder para fora: Stage, Deck, Descarte; a Vida junto do Líder do lado oposto aos DON!!', () => {
    const l = parseLayout({ stage: { position: 'left' }, deck: { position: 'left' }, life: { position: 'base' }, don: { position: 'right' } });
    expect(baseOrder(l)).toEqual(['life', 'deck', 'stage', 'leader', 'trash', 'DON']);
  });

  it('fileira de DON!! própria: a fileira do Líder fica sem os DON!!', () => {
    expect(baseOrder(parseLayout({ don: { position: 'row' }, trash: { position: 'right' } }))).toEqual(['leader', 'stage', 'deck', 'trash']);
  });
});

describe('layout da mesa: medidas e predefinições', () => {
  it('mais blocos grandes ocupam mais; mão embaixo da mesa gasta altura; laterais somem sem nada nelas', () => {
    const base = measureLayout(effectiveLayout(DEFAULT_LAYOUT));
    const big = measureLayout(effectiveLayout(presetLayout('bigcards')));
    expect(big.rows).toBeGreaterThan(base.rows);
    expect(big.cols).toBeGreaterThan(base.cols);
    // A mesma mesa (DON!! na fileira do Líder, tudo no painel), com a mão no canto e embaixo dela.
    const panelOnly = { don: { position: 'left' }, log: { position: 'panel' }, hover: { position: 'panel' } };
    const corner = measureLayout(effectiveLayout(parseLayout(panelOnly)));
    const bottom = measureLayout(effectiveLayout(parseLayout({ ...panelOnly, hand: { position: 'bottom' } })));
    expect(bottom.rows).toBeGreaterThan(corner.rows);
    expect(bottom.side).toBe(0);
    expect(base.side).toBeGreaterThan(0);
  });

  it('cada predefinição é reconhecida de volta; o padrão é a predefinição "default"', () => {
    for (const p of LAYOUT_PRESETS) expect(matchingPreset(presetLayout(p))).toBe(p);
    expect(matchingPreset(DEFAULT_LAYOUT)).toBe('default');
    expect(matchingPreset(parseLayout({ leader: { size: 'small' } }))).toBeNull();
  });
});
