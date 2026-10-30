import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/card-import';
import { buildChain, type CardSource, chainNames, type Layer, resolveChain, saveDiffReport } from '../src/card-sources';
import { mapSweetAppCard, sweetAppConfig, sweetAppNext, sweetAppRows, sweetAppSource } from '../src/card-sources/sweetapp';
import { cardkaizokuManifestUrl, cardkaizokuSource, type KaizokuCard, mapKaizokuCard } from '../src/card-sources/cardkaizoku';
import { optcgleaksSource } from '../src/card-sources/optcgleaks';
import { apiEndpoints } from '../src/card-sources/optcgapi';
import { getCards, openDb, pendingSpoilers, upsertCards } from '../src/db';
import { optcgLeaksDataUrl } from '../src/spoiler-feed';
import { refreshSpoilerFeeds, syncSpoilers } from '../src/spoiler-sync';

const BASE = 'https://api.test/api';
const DATA_FILE = 'card_data_v20261019T121531.json';

/** Linha no formato do Cardkaizoku. */
const kz = (cardNumber: string, extra: Partial<KaizokuCard & { products: unknown[] }> = {}): KaizokuCard => ({
  cardNumber,
  cardName: 'Karoo',
  cardType: 'CHARACTER',
  cost: '1',
  power: '2000',
  counter: '1000',
  color: 'Red',
  attribute: 'Strike',
  feature: 'Animal/Alabasta',
  text: '[On Play] Draw 1 card.',
  trigger: '',
  rarity: 'C',
  products: [],
  ...extra,
});

/** Carta pronta (CardData) de uma fonte de teste. */
const card = (id: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name: 'Karoo',
  category: 'character',
  colors: ['red'],
  cost: 1,
  power: 2000,
  counter: 1000,
  attributes: ['Strike'],
  types: ['Alabasta'],
  text: '[On Play] Draw 1 card.',
  set: id.split('-')[0],
  ...extra,
});

const source = (id: string, extra: Partial<CardSource> = {}): CardSource => ({ id, host: `${id}.test`, fetch: async () => ({ cards: [] }), ...extra });
const kaizokuLike = (extra: Partial<CardSource> = {}) =>
  source('cardkaizoku', { weakFields: ['cost', 'power', 'counter', 'life', 'colors'], mixesSpoilers: true, ...extra });

/** Rede falsa: URL -> resposta; o resto responde 404. */
function fakeNet(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) throw new HttpError(url, 404, 'Not Found');
    if (body instanceof Error) throw body;
    return body;
  };
  return { fetchJson, calls };
}
const kaizokuRoutes = (rows: KaizokuCard[]) => ({
  [cardkaizokuManifestUrl]: { cardData: { current: DATA_FILE } },
  [`https://cdn.cardkaizoku.com/${DATA_FILE}`]: rows,
});

describe('Cardkaizoku: mapeamento', () => {
  it('Líder com a Vida no campo do custo, cores e atributos separados por "/"', () => {
    expect(
      mapKaizokuCard(kz('OP01-001', { cardName: 'Roronoa Zoro', cardType: 'LEADER', cost: '5', power: '5000', counter: '', color: 'Red/Green', attribute: 'Slash/?' })),
    ).toMatchObject({ id: 'OP01-001', category: 'leader', life: 5, cost: undefined, counter: undefined, power: 5000, colors: ['red', 'green'], attributes: ['Slash'] });
    // Líder novo sem Vida: fica vazio (a fonte seguinte completa).
    expect(mapKaizokuCard(kz('ST37-001', { cardType: 'LEADER', cost: '' }))!.life).toBeUndefined();
  });

  it('texto no padrão das cartas impressas: <br/>, custo ➀, DON!! −1, <Atributo>, [Trigger] separado', () => {
    const c = mapKaizokuCard(
      kz('OP05-119', {
        text: "[On Play] DON!! −10: Place all of your Characters at the bottom of your deck. <br/> [Activate: Main] ➀: K.O. up to 1 of your opponent’s Characters with the <Wisdom> attribute and <Blocker>.",
        trigger: '[Trigger] Activate this card’s [On Play] effect.',
      }),
    )!;
    expect(c.text).toBe(
      "[On Play] DON!! -10: Place all of your Characters at the bottom of your deck.\n[Activate: Main] ①: K.O. up to 1 of your opponent's Characters with the \"Wisdom\" attribute and [Blocker].",
    );
    expect(c.trigger).toBe("Activate this card's [On Play] effect.");
    // [Trigger] no fim do texto, sem o campo próprio.
    expect(mapKaizokuCard(kz('P-130', { text: '[On Play] Draw 1 card.<br/>[Trigger] Draw 1 card.' }))).toMatchObject({
      text: '[On Play] Draw 1 card.',
      trigger: 'Draw 1 card.',
    });
    // Quebras de linha estragadas: "</br>" (P-098) e "<\br>", que o JSON lê como "<", backspace, "r>" (P-096).
    expect(mapKaizokuCard(kz('P-098', { text: '[Blocker]</br>[On Play] Draw 1 card.' }))!.text).toBe('[Blocker]\n[On Play] Draw 1 card.');
    expect(mapKaizokuCard(kz('P-096', { text: JSON.parse('"[On Play] Draw 1 card.<\\br>[Activate: Main] Draw 1 card."') }))!.text).toBe(
      '[On Play] Draw 1 card.\n[Activate: Main] Draw 1 card.',
    );
  });

  it('texto ainda não revelado, "-" de carta sem efeito e Líder de evento', () => {
    expect(mapKaizokuCard(kz('P-108', { text: null }))!.text).toBeUndefined();
    expect(mapKaizokuCard(kz('P-087', { text: '-' }))!.text).toBe('');
    expect(mapKaizokuCard(kz('P-000', { cardType: 'LEADER', text: 'This Leader can only be used in designated events according to the rules.' }))).toBeNull();
    expect(mapKaizokuCard(kz('', {}))).toBeNull();
    expect(mapKaizokuCard(kz('P-110', { cardName: '' }))).toBeNull();
  });

  it('baixa o arquivo do manifesto uma vez e marca as promos à venda', async () => {
    const net = fakeNet(kaizokuRoutes([kz('OP18-001'), kz('P-130'), kz('P-040', { products: [{ productID: 1 }] }), kz('OP18-001', { cardName: 'Repetida' })]));
    const src = cardkaizokuSource(net.fetchJson);
    const op18 = await src.fetch({ sets: ['OP-18'] });
    expect(op18.cards.map((c) => [c.id, c.name])).toEqual([['OP18-001', 'Karoo']]);
    expect([...(op18.released ?? [])]).toEqual(['P-040']);
    expect((await src.fetch({})).cards).toHaveLength(3);
    expect(net.calls).toHaveLength(2);
    expect(op18.cards[0].imageUrl).toBeUndefined();
  });
});

describe('cadeia de fontes', () => {
  it('vence a primeira fonte; campos fracos e vazios vêm da seguinte; imagem de quem tem', () => {
    const layers: Layer[] = [
      { source: kaizokuLike(), cards: [card('EB05-027', { name: 'Hina', power: 0, counter: 2000, text: '[On Play] Draw 2 cards.', attributes: [] })] },
      {
        source: source('optcgleaks'),
        cards: [card('EB05-027', { name: 'Hina?', power: 6000, counter: 1000, text: '[On Play] Draw 2 card.', attributes: ['Ranged'], imageUrl: 'https://leaks.test/eb05-027.webp' })],
      },
    ];
    const { cards, report } = resolveChain(layers, { kind: 'spoiler' });
    expect(cards).toHaveLength(1);
    expect(cards[0].source.id).toBe('cardkaizoku');
    expect(cards[0].card).toMatchObject({
      name: 'Hina',
      power: 6000,
      counter: 1000,
      attributes: ['Ranged'],
      text: '[On Play] Draw 2 cards.',
      imageUrl: 'https://leaks.test/eb05-027.webp',
    });
    expect(report.filled).toBe(1);
    expect(report.diffs.map((d) => [d.field, d.used])).toEqual(
      expect.arrayContaining([
        ['power', 'optcgleaks'],
        ['counter', 'optcgleaks'],
        ['name', 'cardkaizoku'],
        ['text', 'cardkaizoku'],
      ]),
    );
    expect(report.bySet).toEqual({ EB05: { cardkaizoku: 1 } });
  });

  it('Líder sem Vida na fonte principal recebe a da seguinte', () => {
    const leader = (life?: number) => card('OP18-001', { category: 'leader', cost: undefined, counter: undefined, life });
    const { cards } = resolveChain(
      [
        { source: kaizokuLike(), cards: [leader(undefined)] },
        { source: source('optcgleaks'), cards: [leader(4)] },
      ],
      { kind: 'spoiler' },
    );
    expect(cards[0].card.life).toBe(4);
  });

  it('ordem dos tipos e aspas tipográficas não contam como divergência', () => {
    const { report } = resolveChain(
      [
        { source: kaizokuLike(), cards: [card('OP01-001', { types: ['A', 'B'], text: 'Your opponent’s turn.' })] },
        { source: source('optcgapi'), cards: [card('OP01-001', { types: ['B', 'A'], text: "Your opponent's turn." })] },
      ],
      { kind: 'official' },
    );
    expect(report.diffs).toEqual([]);
  });

  it('texto que o leitor entende menos não substitui o da fonte seguinte', () => {
    const { cards, report } = resolveChain(
      [
        { source: kaizokuLike(), cards: [card('OP01-002', { text: 'Gibberish the reader cannot parse at all.' })] },
        { source: source('optcgapi'), cards: [card('OP01-002', { text: '[On Play] Draw 1 card.', trigger: 'Draw 1 card.' })] },
      ],
      { kind: 'official' },
    );
    expect(cards[0].card).toMatchObject({ text: '[On Play] Draw 1 card.', trigger: 'Draw 1 card.' });
    expect(cards[0].source.id).toBe('cardkaizoku');
    expect(report.diffs.find((d) => d.field === 'text')?.used).toBe('optcgapi');
  });

  it('como fonte oficial, quem mistura spoilers só traz coleções confirmadas e promos à venda', () => {
    const layers: Layer[] = [
      {
        source: kaizokuLike(),
        cards: [card('OP17-001'), card('OP18-001'), card('P-040'), card('P-130'), card('P-100'), card('ST37-001')],
        released: new Set(['P-040']),
      },
      { source: source('optcgapi'), cards: [card('OP17-002'), card('P-100')] },
    ];
    const { cards, report } = resolveChain(layers, { kind: 'official', officialSet: (s) => s === 'ST37' });
    expect(cards.map((c) => c.card.id)).toEqual(['OP17-001', 'OP17-002', 'P-040', 'P-100', 'ST37-001']);
    expect(report.skipped).toEqual([
      { id: 'OP18-001', source: 'cardkaizoku', reason: 'coleção sem fonte oficial (vai como spoiler)' },
      { id: 'P-130', source: 'cardkaizoku', reason: 'promo ainda não lançada (vai como spoiler)' },
    ]);
  });

  it('carta sem texto em nenhuma fonte (ainda não revelada inteira) fica de fora', () => {
    const { cards, report } = resolveChain([{ source: kaizokuLike(), cards: [card('P-108', { text: undefined as unknown as string })] }], {
      kind: 'spoiler',
    });
    expect(cards).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ id: 'P-108' });
  });

  it('uma fonte só: a carta sai como veio', () => {
    const c = card('OP01-003', { arts: [{ id: 'OP01-003_p1', imageUrl: 'https://x.test/p1.jpg' }], imageUrl: 'https://x.test/n.jpg', notes: ['nota'] });
    const { cards, report } = resolveChain([{ source: source('optcgapi'), cards: [c], raw: new Map([['OP01-003', { bruto: 1 }]]) }], {
      kind: 'official',
    });
    expect(cards[0].card).toEqual(c);
    expect(cards[0].raw).toEqual({ bruto: 1 });
    expect(report).toMatchObject({ filled: 0, diffs: [], skipped: [] });
  });

  it('relatório de divergências: uma seção por importação no mesmo arquivo', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'diff-')), 'card-source-diff.json');
    const report = { bySet: {}, filled: 0, diffs: [], skipped: [] };
    saveDiffReport('official', [source('a'), source('b')], report, path);
    saveDiffReport('spoiler:OP18', [source('a')], report, path);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(saved)).toEqual(['official', 'spoiler:OP18']);
    expect(saved.official.chain).toEqual(['a', 'b']);
  });
});

describe('CARD_SOURCES e SPOILER_SOURCES', () => {
  it('padrão: optcgapi e optcgleaks', () => {
    expect(chainNames('official', {})).toEqual({ names: ['optcgapi'], warnings: [] });
    expect(chainNames('spoiler', {})).toEqual({ names: ['optcgleaks'], warnings: [] });
  });

  it('lê a ordem, ignora repetidas e avisa as desconhecidas, as previstas e as do tipo errado', () => {
    expect(chainNames('official', { CARD_SOURCES: 'Cardkaizoku, optcgapi,cardkaizoku' }).names).toEqual(['cardkaizoku', 'optcgapi']);
    const r = chainNames('official', { CARD_SOURCES: 'sweetapp,cardkaizoku,optcgleaks,xyz' });
    expect(r.names).toEqual(['cardkaizoku']);
    expect(r.warnings).toEqual([
      'CARD_SOURCES=sweetapp,cardkaizoku,optcgleaks,xyz',
      'sweetapp: SWEETAPP_CARDS_URL não configurada',
      'optcgleaks: não serve para CARD_SOURCES',
      'xyz: fonte desconhecida',
    ]);
    // Nenhuma válida: vale o padrão.
    expect(chainNames('spoiler', { SPOILER_SOURCES: 'optcgapi' }).names).toEqual(['optcgleaks']);
    // O SweetApp entra (nas duas cadeias) quando o endereço está configurado.
    const env = { CARD_SOURCES: 'sweetapp,optcgapi', SPOILER_SOURCES: 'sweetapp,optcgleaks', SWEETAPP_CARDS_URL: 'https://api.sweet.test/cards' };
    expect(chainNames('official', env)).toEqual({ names: ['sweetapp', 'optcgapi'], warnings: [] });
    expect(chainNames('spoiler', env)).toEqual({ names: ['sweetapp', 'optcgleaks'], warnings: [] });
    expect(buildChain(['sweetapp', 'optcgapi'], { base: BASE, fetchJson: async () => null, env }).map((s) => s.id)).toEqual(['sweetapp', 'optcgapi']);
  });

  it('promocionais da optcgapi ficam em /allPromos/', () => {
    expect(apiEndpoints(BASE, ['P', 'OP-01', 'ST01'])).toEqual([`${BASE}/allPromos/`, `${BASE}/sets/OP-01/`, `${BASE}/decks/ST-01/`]);
  });
});

// Amostra real de https://images.optcgleaks.com/<set>/<set>.json
const leaks = JSON.parse(readFileSync(join(__dirname, 'fixtures/optcgleaks-sample.json'), 'utf8'));

function feedDir(files: Record<string, object>) {
  const dir = mkdtempSync(join(tmpdir(), 'feed-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(body));
  return dir;
}

describe('spoilers pela cadeia Cardkaizoku > optcgleaks', () => {
  const rows = [
    kz('EB05-010', { cardName: 'Nico Robin', cardType: 'LEADER', cost: '', power: '5000', counter: '', color: 'Green/Yellow', feature: 'Straw Hat Crew', text: '[Activate: Main] [Once Per Turn] Draw 1 card.' }),
    kz('EB05-099', { cardName: 'Só no Cardkaizoku' }),
    kz('P-130', { cardName: 'Monkey.D.Garp' }),
    kz('P-100', { cardName: 'Marshall.D.Teach', products: [{ productID: 1 }] }),
  ];
  const chain = (net: ReturnType<typeof fakeNet>) => [cardkaizokuSource(net.fetchJson), optcgleaksSource(net.fetchJson)];

  it('junta as fontes, marca de onde veio cada carta e completa a Vida e a imagem', async () => {
    const db = openDb(':memory:');
    const net = fakeNet({ ...kaizokuRoutes(rows), [optcgLeaksDataUrl('EB05')]: leaks.eb05 });
    const dir = feedDir({ 'eb05.json': { set: 'EB05', feed: true } });
    const r = await refreshSpoilerFeeds(db, dir, { chain: chain(net) });
    expect(r.errors).toEqual([]);
    expect(pendingSpoilers(db)).toEqual(['EB05-010', 'EB05-016', 'EB05-056', 'EB05-099']);
    const [robin, only] = getCards(db, ['EB05-010', 'EB05-099']);
    expect(robin).toMatchObject({
      name: 'Nico Robin',
      text: '[Activate: Main] [Once Per Turn] Draw 1 card.',
      life: 4,
      imageUrl: 'https://images.optcgleaks.com/eb05/images/eb05-010_v2.webp',
      spoiler: { source: 'cardkaizoku.com', url: 'https://www.cardkaizoku.com/spoilers' },
    });
    expect(only.spoiler?.source).toBe('cardkaizoku.com');
    expect(only.imageUrl).toBeUndefined();
    expect(getCards(db, ['EB05-016'])[0].spoiler?.source).toBe('optcgleaks.com');
  });

  it('com uma fonte fora do ar, grava o que veio e não apaga nada', async () => {
    const db = openDb(':memory:');
    const dir = feedDir({ 'eb05.json': { set: 'EB05', feed: true } });
    await refreshSpoilerFeeds(db, dir, { chain: chain(fakeNet({ ...kaizokuRoutes(rows), [optcgLeaksDataUrl('EB05')]: leaks.eb05 })) });
    const down = fakeNet({ ...kaizokuRoutes(rows), [optcgLeaksDataUrl('EB05')]: new Error('ECONNRESET') });
    const r = await refreshSpoilerFeeds(db, dir, { chain: chain(down) });
    expect(r.errors).toEqual(['optcgleaks: ECONNRESET']);
    expect(r.sets).toEqual([{ set: 'EB05', written: 2, removed: 0 }]);
    expect(pendingSpoilers(db)).toHaveLength(4);
  });

  it('promocionais anunciadas: as oficiais do banco não viram spoiler; coleção que a fonte não tem não é erro', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [card('P-100', { name: 'Marshall.D.Teach' })], { provisional: false, source: 'api:test' });
    const net = fakeNet(kaizokuRoutes(rows));
    const dir = feedDir({ 'p.json': { set: 'P', feed: true }, 'st37.json': { set: 'ST37', feed: true } });
    const r = await refreshSpoilerFeeds(db, dir, { chain: chain(net) });
    expect(r).toEqual({ sets: [{ set: 'P', written: 1, removed: 0 }], errors: [] });
    expect(pendingSpoilers(db)).toEqual(['P-130']);
    expect(getCards(db, ['P-100'])[0].provisional).toBe(false);
    expect(net.calls).not.toContain(optcgLeaksDataUrl('P'));
  });

  it('promo anunciada vira oficial quando aparece em /allPromos/ (ou fica à venda), com os dados da cadeia', async () => {
    const db = openDb(':memory:');
    const net = fakeNet({
      ...kaizokuRoutes(rows),
      [`${BASE}/allSets/`]: [],
      [`${BASE}/allDecks/`]: [],
      [`${BASE}/allPromos/`]: [
        {
          card_set_id: 'P-130',
          card_image_id: 'P-130',
          card_name: 'Monkey.D.Garp',
          set_id: 'P',
          card_type: 'Character',
          card_color: 'Red',
          card_cost: '1',
          card_power: '3000',
          counter_amount: '1000',
          sub_types: 'Navy',
          card_text: '[On Play] Draw 1 crad.',
          card_image: 'https://optcgapi.test/P-130.jpg',
        },
      ],
    });
    const dir = feedDir({ 'p.json': { set: 'P', feed: true } });
    await refreshSpoilerFeeds(db, dir, { chain: chain(net) });
    // P-100 já está à venda, mas a busca de spoilers não confirma lançamento: fica para a troca pelas oficiais.
    expect(pendingSpoilers(db)).toEqual(['P-100', 'P-130']);
    const r = await syncSpoilers(db, { base: BASE, fetchJson: net.fetchJson, chain: [cardkaizokuSource(net.fetchJson)] });
    // P-130 apareceu na API; P-100 o Cardkaizoku dá como à venda.
    expect(r).toMatchObject({ official: ['P-100', 'P-130'], imported: 2, errors: [] });
    const [garp] = getCards(db, ['P-130']);
    expect(garp).toMatchObject({
      provisional: false,
      text: '[On Play] Draw 1 card.',
      power: 3000,
      imageUrl: 'https://optcgapi.test/P-130.jpg',
    });
    expect(garp.spoiler).toBeUndefined();
  });
});

describe('SweetApp: fonte da cadeia', () => {
  /** Rede falsa com headers: URL -> corpo; o resto responde 404. */
  function sweetNet(routes: Record<string, unknown>) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      const body = routes[String(url)];
      if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('mapeia os campos em inglês ou em português, cores e categorias traduzidas, [Trigger] e aliases', () => {
    expect(
      mapSweetAppCard({ numero: 'op01-001', nome: 'Roronoa Zoro', tipo: 'Líder', cores: 'Vermelho', vida: 5, poder: '5000', atributos: 'Slash', tracos: 'Supernovas/Straw Hat Crew', textEn: '[DON!! x1] [Your Turn] All of your Characters gain +1000 power.', raridade: 'L', colecao: 'OP-01', imagem: 'https://cdn.sweet.test/op01-001.png' }),
    ).toEqual({
      id: 'OP01-001',
      name: 'Roronoa Zoro',
      category: 'leader',
      colors: ['red'],
      life: 5,
      power: 5000,
      attributes: ['Slash'],
      types: ['Supernovas', 'Straw Hat Crew'],
      text: '[DON!! x1] [Your Turn] All of your Characters gain +1000 power.',
      set: 'OP01',
      rarity: 'L',
      imageUrl: 'https://cdn.sweet.test/op01-001.png',
    });
    expect(
      mapSweetAppCard({ id: 'OP01-016_p1', name: 'Nami', category: 'CHARACTER', colors: ['Blue', 'Yellow'], cost: 1, power: 1000, counter: '2000', attributes: ['Special'], types: ['Straw Hat Crew'], effect: '[On Play] Look at 5 cards.<br>[Trigger] Draw 1 card. Also treat this card\'s name as [Nami (Alt)].' }),
    ).toMatchObject({ id: 'OP01-016', category: 'character', colors: ['blue', 'yellow'], cost: 1, counter: 2000, text: '[On Play] Look at 5 cards.', trigger: 'Draw 1 card. Also treat this card\'s name as [Nami (Alt)].', set: 'OP01' });
    // Evento sem poder nem contador; counter 0 some; custo "–" vira vazio para a fonte seguinte completar.
    expect(mapSweetAppCard({ code: 'ST01-014', name: 'Guard Point', type: 'event', color: 'Red', cost: '-', counter: 0, text: '-' })).toMatchObject({ category: 'event', text: '' });
    expect(mapSweetAppCard({ code: 'ST01-014', name: 'Guard Point', type: 'event', color: 'Red', cost: '-' })).not.toHaveProperty('cost');
    // Sem número, nome ou categoria conhecida: fora.
    expect(mapSweetAppCard({ name: 'x', type: 'leader' })).toBeNull();
    expect(mapSweetAppCard({ id: 'OP01-001', name: 'x', type: 'don' })).toBeNull();
    expect(mapSweetAppCard({ id: 'OP01-001', type: 'leader' })).toBeNull();
  });

  it('aceita lista pura ou embrulhada e segue a paginação', () => {
    expect(sweetAppRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(sweetAppRows({ data: [{ id: 2 }], next: null })).toEqual([{ id: 2 }]);
    expect(sweetAppRows({ cards: 'x' })).toBeNull();
    expect(sweetAppNext({ next: '/cards?page=2' }, 'https://api.sweet.test/cards')).toBe('https://api.sweet.test/cards?page=2');
    expect(sweetAppNext({ links: { next: 'https://api.sweet.test/cards?page=3' } }, 'https://api.sweet.test/cards')).toBe('https://api.sweet.test/cards?page=3');
    expect(sweetAppNext({ next: 'https://api.sweet.test/cards' }, 'https://api.sweet.test/cards')).toBeNull();
    expect(sweetAppNext([], 'https://api.sweet.test/cards')).toBeNull();
    expect(sweetAppConfig({})).toBeNull();
    expect(sweetAppConfig({ SWEETAPP_CARDS_URL: 'ftp://x' })).toBeNull();
    expect(sweetAppConfig({ SWEETAPP_CARDS_URL: 'https://api.sweet.test/cards ', SWEETAPP_API_KEY: 'k' })).toEqual({ url: 'https://api.sweet.test/cards', apiKey: 'k', apiKeyHeader: 'x-api-key' });
  });

  it('um endereço só: baixa uma vez por rodada (com a chave no header), filtra por coleção e marca as lançadas', async () => {
    const net = sweetNet({
      'https://api.sweet.test/cards': { data: [{ id: 'OP01-001', name: 'Zoro', type: 'leader', color: 'Red', life: 5, power: 5000, text: '', released: true }], next: '/cards?page=2' },
      'https://api.sweet.test/cards?page=2': { data: [{ id: 'OP18-001', name: 'Nova', type: 'leader', color: 'Red', life: 5, power: 5000, text: '' }, { id: 'OP18-001', name: 'Repetida', type: 'leader', color: 'Red', text: '' }] },
    });
    const src = sweetAppSource({ url: 'https://api.sweet.test/cards', apiKey: 'segredo', apiKeyHeader: 'x-api-key' }, net.fetchImpl);
    expect(src).toMatchObject({ id: 'sweetapp', host: 'sweetapp.com.br', mixesSpoilers: true });
    const op01 = await src.fetch({ sets: ['OP-01'] });
    expect(op01.cards.map((c) => c.id)).toEqual(['OP01-001']);
    expect(op01.released).toEqual(new Set(['OP01-001']));
    const all = await src.fetch({});
    expect(all.cards.map((c) => c.id)).toEqual(['OP01-001', 'OP18-001']);
    expect(all.raw?.get('OP01-001')).toMatchObject({ name: 'Zoro' });
    // As duas páginas, uma vez só, com a chave.
    expect(net.calls.map((c) => c.url)).toEqual(['https://api.sweet.test/cards', 'https://api.sweet.test/cards?page=2']);
    expect(net.calls[0].headers['x-api-key']).toBe('segredo');
  });

  it('endereço por coleção ({set}): uma requisição por coleção; 404 = a fonte não tem; outro erro derruba a fonte', async () => {
    const net = sweetNet({
      'https://api.sweet.test/cards?set=OP01': [{ id: 'OP01-001', name: 'Zoro', type: 'leader', color: 'Red', life: 5, power: 5000, text: '' }],
    });
    const src = sweetAppSource({ url: 'https://api.sweet.test/cards?set={set}' }, net.fetchImpl);
    const got = await src.fetch({ sets: ['OP-01', 'OP18'] });
    expect(got.cards.map((c) => c.id)).toEqual(['OP01-001']);
    expect(net.calls.map((c) => c.url)).toEqual(['https://api.sweet.test/cards?set=OP01', 'https://api.sweet.test/cards?set=OP18']);
    expect(net.calls[0].headers['x-api-key']).toBeUndefined();
    await expect(src.fetch({})).rejects.toThrow(/exige as coleções/);
    const broken = sweetAppSource({ url: 'https://api.sweet.test/cards?set={set}' }, (async () => new Response('x', { status: 500, statusText: 'Erro' })) as typeof fetch);
    await expect(broken.fetch({ sets: ['OP01'] })).rejects.toThrow(/500/);
  });

  it('na cadeia: completa campos vazios da optcgapi e, como fonte oficial, só traz coleções confirmadas', () => {
    const sweet = source('sweetapp', { mixesSpoilers: true });
    const layers: Layer[] = [
      { source: sweet, cards: [card('OP01-001', { attributes: ['Slash'], rarity: 'L' }), card('OP18-001', { name: 'Nova' })], released: new Set() },
      { source: source('optcgapi'), cards: [card('OP01-001', { attributes: [], rarity: undefined })] },
    ];
    const { cards, report } = resolveChain(layers, { kind: 'official' });
    expect(cards.map((c) => c.card.id)).toEqual(['OP01-001']);
    expect(cards[0].source.id).toBe('sweetapp');
    expect(cards[0].card).toMatchObject({ attributes: ['Slash'], rarity: 'L' });
    expect(report.skipped).toEqual([{ id: 'OP18-001', source: 'sweetapp', reason: 'coleção sem fonte oficial (vai como spoiler)' }]);
  });
});
