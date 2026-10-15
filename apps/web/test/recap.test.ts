import { type CardData, createAliases, createGame, type DeckList, type GameState, parseDeckList, viewFor } from '@gumgum/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LeaderCount, RecapCard } from '../src/api';
import { matchDeck } from '../src/recap/matchDeck';
import { crc32, makePdf, makeZip } from '../src/recap/export';
import { CARD_RATIO, gridLayout, leaderLabel, legendRows, pieSlices, slug } from '../src/recap/layout';

const card = (id: string, name = id): RecapCard => ({ id, name, set: id.split('-')[0], cost: 1, category: 'leader', colors: ['red'], image: null });
const leaders = (...counts: number[]): LeaderCount[] => counts.map((count, i) => ({ leader: card(`OP0${i}-001`, `L${i}`), count }));

describe('kit de divulgação: layout', () => {
  it('grade das decklists: menos colunas possível, cabendo na área', () => {
    // 16 cartas diferentes + o líder num espaço de feed: 5 colunas já cabem.
    const g = gridLayout(17, 968, 820, { gap: 14, labelH: 32 });
    expect(g.cols).toBeGreaterThanOrEqual(4);
    expect(g.gridH).toBeLessThanOrEqual(820);
    expect(g.gridW).toBeLessThanOrEqual(968 + 1e-6);
    expect(g.cardH).toBeCloseTo(g.tileW * CARD_RATIO);
    // Poucas cartas: 4 colunas.
    expect(gridLayout(8, 968, 1200).cols).toBe(4);
    // Muitas cartas num espaço baixo: 8 colunas e as cartas encolhem para caber.
    const tight = gridLayout(40, 968, 600);
    expect(tight.cols).toBe(8);
    expect(tight.gridH).toBeLessThanOrEqual(600 + 1e-6);
  });

  it('pizza: fatias proporcionais; as pequenas viram "Outros" no desenho', () => {
    const few = pieSlices(leaders(3, 1));
    expect(few).toHaveLength(2);
    expect(few[0].start).toBeCloseTo(-Math.PI / 2);
    expect(few[0].end - few[0].start).toBeCloseTo((3 / 4) * Math.PI * 2);
    expect(few[1].end).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
    // 100 jogadores: líderes com 1 jogador (1%) se juntam.
    const many = pieSlices(leaders(40, 30, 20, 4, 3, 1, 1, 1));
    const others = many[many.length - 1];
    expect(others).toMatchObject({ leader: null, grouped: 3, count: 3 });
    expect(many.reduce((n, s) => n + s.count, 0)).toBe(100);
    // Só um pequeno sobrando: aparece sozinho, sem "Outros".
    expect(pieSlices(leaders(50, 49, 1)).every((s) => s.leader)).toBe(true);
    // No máximo 12 fatias.
    expect(pieSlices(leaders(...Array.from({ length: 20 }, () => 5)))).toHaveLength(12);
    expect(pieSlices([])).toEqual([]);
  });

  it('legenda: até 15 linhas; o resto vira "+N outros" com a soma', () => {
    expect(legendRows(leaders(3, 2)).rest).toBeNull();
    const l = legendRows(leaders(...Array.from({ length: 20 }, (_, i) => 20 - i)), 15);
    expect(l.shown).toHaveLength(14);
    expect(l.rest).toEqual({ leaders: 6, count: 6 + 5 + 4 + 3 + 2 + 1 });
    expect(leaderLabel(card('OP17-001', 'Rocks.D.Xebec'))).toBe('Rocks.D.Xebec (OP17)');
    expect(slug('Copa Grand Line #3 — São Paulo')).toBe('copa-grand-line-3-sao-paulo');
  });
});

describe('kit de divulgação: arquivos', () => {
  it('CRC-32 conhecido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ZIP: cabeçalhos, nomes e o diretório central', () => {
    const files = [
      { name: '01-campeão.png', data: new Uint8Array([1, 2, 3]) },
      { name: '02-campanha.png', data: new Uint8Array([4, 5]) },
    ];
    const zip = makeZip(files, new Date(2026, 9, 14, 12, 0, 0));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const dirStart = view.getUint32(end + 16, true);
    expect(view.getUint32(dirStart, true)).toBe(0x02014b50);
    // CRC e tamanho do primeiro arquivo, e o nome em UTF-8.
    expect(view.getUint32(14, true)).toBe(crc32(files[0].data));
    expect(view.getUint32(18, true)).toBe(3);
    const nameLen = view.getUint16(26, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe('01-campeão.png');
    expect(Array.from(zip.slice(30 + nameLen, 33 + nameLen))).toEqual([1, 2, 3]);
  });

  it('PDF: uma página A4 por imagem, com a tabela de referências certa', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = makePdf(
      [
        { jpeg, width: 1080, height: 1350 },
        { jpeg, width: 1080, height: 1920 },
      ],
      { title: 'Copa São Paulo' },
    );
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Type /Pages /Kids [4 0 R 7 0 R] /Count 2');
    expect(s.match(/\/Subtype \/Image/g)).toHaveLength(2);
    // Título em UTF-16 (acentos).
    expect(s).toContain('<FEFF0043006F007000610020005300E3006F0020005000610075006C006F>');
    // Cada entrada do xref aponta para o início do objeto.
    const startxref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(9);
    offsets.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe('decklist de um jogador no fim da partida', () => {
  const engineCards = () =>
    ['st01', 'st02'].flatMap((set) => (JSON.parse(readFileSync(join(__dirname, '../../../data/cards', `${set}.json`), 'utf8')) as { cards: CardData[] }).cards);
  const deckFile = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../../data/decks', `${name}.json`), 'utf8')) as DeckList;

  it('monta a lista por custo e número, com as imagens pelo mesmo domínio e o texto do construtor', () => {
    const luffy = deckFile('st01-luffy');
    const kid = deckFile('st02-kid');
    const state = createGame({ seed: 3, players: [{ name: 'Alex', deck: luffy }, { name: 'Bot', deck: kid, isBot: true }], cards: engineCards() });
    const aliases = createAliases(state, () => Math.random().toString(36).slice(2));
    expect(matchDeck(viewFor(state, 0, aliases), 1)).toBeNull(); // em andamento: a visão esconde o deck
    const over: GameState = { ...state, phase: 'gameover', winner: 0 };
    const deck = matchDeck(viewFor(over, 0, aliases), 1)!;
    expect(deck).toMatchObject({ player: 1, name: 'Bot', opponent: 'Alex', total: 50 });
    expect(deck.leader.id).toBe(kid.leader);
    expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(50);
    // Por custo e, no empate, por número.
    const costs = deck.cards.map((c) => c.cost ?? 99);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // Imagens oficiais reescritas para /card-img/ (as de origem desconhecida saem sem arte).
    for (const c of [deck.leader, ...deck.cards]) expect(c.image === null || c.image.startsWith('/card-img/')).toBe(true);
    expect(matchDeck(over, 1, { images: false }).leader.image).toBeNull();
    // Texto no formato do construtor, que o próprio motor lê de volta.
    expect(deck.text.split('\n')[0]).toBe(`1x${kid.leader}`);
    const parsed = parseDeckList(deck.text, new Map(engineCards().map((c) => [c.id, c])));
    expect(parsed.errors).toEqual([]);
    expect(parsed.leader).toBe(kid.leader);
    expect(parsed.cards.reduce((n, c) => n + c.count, 0)).toBe(50);
  });
});
