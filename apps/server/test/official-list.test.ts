// Lista oficial da Bandai como fonte de dados (card-sources/bandai.ts) e a coleção que vira
// oficial por ela no dia do lançamento, antes de a optcgapi publicar (spoiler-sync.ts).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automationStatus, brasiliaDate, type CardData, fixCard } from '@gumgum/engine';
import { describe, expect, it, vi } from 'vitest';

// A rodada completa grava o relatório das fontes ao lado do banco: aqui o banco é só em memória.
vi.hoisted(() => {
  process.env.DB_PATH = ':memory:';
});

import { HttpError } from '../src/card-import';
import { BANDAI_LIST, bandaiSource, officialReleaseDates, parseListRows, parseReleaseDates } from '../src/card-sources/bandai';
import { cardkaizokuManifestUrl, cardkaizokuSource } from '../src/card-sources/cardkaizoku';
import type { CardSource } from '../src/card-sources/chain';
import { releaseFromOfficialList } from '../src/config';
import { getCards, listReleases, openDb, pendingSpoilers, upsertCards } from '../src/db';
import { releaseDates, releaseRoundDelays, spoilerRound, syncSpoilers } from '../src/spoiler-sync';

const BASE = 'https://api.test/api';
const LIST = BANDAI_LIST.base;
const IMG = `${LIST}/images/cardlist/card`;
const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures/bandai-cardlist-sample.json'), 'utf8')) as {
  index: string;
  op18: string;
  op17: string;
  productsBoosters: string;
  productsDecks: string;
};
const IDS = ['OP18-001', 'OP18-004', 'OP18-005', 'OP18-021', 'OP18-059', 'OP18-065', 'OP18-099'];

/** A lista oficial falsa: o índice e as páginas das coleções; o resto dá erro. */
function fakeList(pages: Partial<Record<'op18' | 'op17', string | Error>> = { op18: sample.op18, op17: sample.op17 }) {
  const routes: Record<string, string | Error | undefined> = {
    [`${LIST}/cardlist/`]: sample.index,
    [`${LIST}/cardlist/?series=569118`]: pages.op18,
    [`${LIST}/cardlist/?series=569117`]: pages.op17,
  };
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url.replace(LIST, ''));
    const body = routes[url];
    if (body === undefined) throw new Error(`${url} respondeu 404`);
    if (body instanceof Error) throw body;
    return body;
  };
  return { fetchText, calls };
}

/** API falsa: rota -> resposta; o resto responde 404. */
function fakeApi(routes: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url.replace(BASE, ''));
    const body = routes[url.replace(BASE, '')] ?? routes[url];
    if (body === undefined) throw new HttpError(url, 404, 'Not Found');
    return body;
  };
  return { fetchJson, calls };
}

const LEAKS = 'https://images.optcgleaks.com/op18/images';
/** Carta como o feed de spoilers a grava (dados da tradução de fã, imagem do site). */
const spoiler = (id: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name: 'Do site de spoilers',
  category: 'character',
  colors: ['red'],
  cost: 1,
  power: 1000,
  types: [],
  text: 'Texto da tradução de fã.',
  set: 'OP18',
  imageUrl: `${LEAKS}/${id.toLowerCase()}.webp`,
  spoiler: { source: 'optcgleaks.com', url: 'https://optcgleaks.com/op18' },
  ...extra,
});
const leaksArt = { id: 'op18-021a', imageUrl: `${LEAKS}/op18-021a.webp`, label: 'Alternate Art', spoiler: 'OP18' };

/** Banco com as cartas do OP18 em spoiler (as 7 da lista de teste e uma que a lista não tem). */
function withSpoilers() {
  const db = openDb(':memory:');
  const cards = [...IDS, 'OP18-200'].map((id) => spoiler(id, id === 'OP18-021' ? { category: 'leader', cost: undefined, life: 4, arts: [leaksArt] } : {}));
  upsertCards(db, cards, { provisional: true, source: 'spoiler:feed:optcgleaks.com' });
  return db;
}

const RELEASES = new Map([['OP18', '2026-11-20']]);
/** 20/11/2026, meio-dia em Brasília. */
const LAUNCH = new Date('2026-11-20T15:00:00Z');
const list = (net: ReturnType<typeof fakeList>, images: boolean, now = LAUNCH) => ({
  source: bandaiSource({ fetchText: net.fetchText, images, delayMs: 0 }),
  releases: RELEASES,
  images,
  now,
});

describe('lista oficial da Bandai: mapeamento', () => {
  it('cada impressão vira uma linha da optcgapi (Vida, poder 0, [Trigger], sinal de menos, versão no nome)', () => {
    const rows = parseListRows(sample.op18, { label: 'BOOSTER PACK -THE DOMINANCE OF GOD- [OP-18]' });
    expect(rows.map((r) => r.card_image_id)).toEqual(IDS);
    const by = (id: string) => rows.find((r) => r.card_image_id === id)!;
    expect(by('OP18-021')).toMatchObject({
      card_set_id: 'OP18-021',
      card_name: 'Franky',
      card_type: 'LEADER',
      rarity: 'L',
      card_color: 'Green/Purple',
      life: '4',
      card_cost: null,
      card_power: '5000',
      attribute: 'Strike',
      sub_types: 'Water Seven/The Franky Family/Straw Hat Crew',
      // "DON!! −1" da lista sai com hífen, como na API.
      card_text: 'All Stage cards in your hand have a +3000 Counter.\n[Activate: Main] [Once Per Turn] DON!! -1: Play up to 1 Stage card with a cost of 5 or less from your hand.',
      set_id: 'OP-18',
      card_image: `${IMG}/OP18-021.png`,
    });
    // Personagem com poder "-" tem 0 de poder; Evento não tem poder nem contador.
    expect(by('OP18-005')).toMatchObject({ card_power: '0', card_cost: '1', counter_amount: '1000' });
    expect(by('OP18-059')).toMatchObject({ card_type: 'EVENT', card_power: null, counter_amount: '' });
    // Atributo "?" (a lista ainda não tem) fica vazio.
    expect(by('OP18-065').attribute).toBe('');
    expect(String(by('OP18-099').card_text)).toMatch(/\n\[Trigger\] If your Leader's type includes "CP", draw 1 card/);

    const old = parseListRows(sample.op17, { label: "BOOSTER PACK -THE WORLD’S STRONGEST WARRIORS- [OP-17]" });
    expect(old.map((r) => [r.card_image_id, r.card_name])).toEqual([
      ['OP17-005', 'Edward.Newgate'],
      ['OP17-005_p1', 'Edward.Newgate (Alternate Art)'],
      ['OP17-040', 'Edward.Newgate'],
      ['OP17-040_p1', 'Edward.Newgate (TR)'],
      ['OP17-114', 'Sweet 3 Generals'],
      ['EB04-007_p2', 'Roronoa Zoro (SP)'],
      ['P-084_p1', 'Buggy (SP)'],
      ['ST27-005_p1', 'Marshall.D.Teach (SP)'],
    ]);
  });

  it('a fonte devolve as cartas da coleção pedida, prontas para o leitor de efeitos', async () => {
    const net = fakeList();
    const got = await bandaiSource({ fetchText: net.fetchText, images: true, delayMs: 0 }).fetch({ sets: ['OP-18'] });
    expect(net.calls).toEqual(['/cardlist/', '/cardlist/?series=569118']);
    expect(got.cards.map((c) => c.id)).toEqual(IDS);
    const by = (id: string) => got.cards.find((c) => c.id === id)!;
    expect(by('OP18-021')).toMatchObject({ category: 'leader', life: 4, cost: undefined, colors: ['green', 'purple'], types: ['Water Seven', 'The Franky Family', 'Straw Hat Crew'], imageUrl: `${IMG}/OP18-021.png` });
    expect(by('OP18-005')).toMatchObject({ name: 'Kung Fu Jugon', cost: 1, power: 0, counter: 1000, attributes: ['Strike'] });
    expect(by('OP18-099')).toMatchObject({ trigger: 'If your Leader\'s type includes "CP", draw 1 card and place up to 1 Character with a cost of 8 or less at the bottom of the owner\'s deck.' });
    expect(by('OP18-099').text).not.toMatch(/Trigger/);
    // O atributo que a lista não tem vem da correção de fonte (SOURCE_FIXES).
    expect(fixCard(by('OP18-065')).attributes).toEqual(['Special']);
    expect(got.cards.map((c) => automationStatus(fixCard(c)))).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto']);
  });

  it('paralelas viram artes e as cartas de outras coleções reimpressas na página só valem pelas artes', async () => {
    const got = await bandaiSource({ fetchText: fakeList().fetchText, images: true, delayMs: 0 }).fetch({ sets: ['OP17'] });
    expect(got.cards.map((c) => c.id).sort()).toEqual(['EB04-007', 'OP17-005', 'OP17-040', 'OP17-114', 'P-084', 'ST27-005']);
    expect([...got.artOnly!].sort()).toEqual(['EB04-007', 'P-084', 'ST27-005']);
    const by = (id: string) => got.cards.find((c) => c.id === id)!;
    expect(by('OP17-005')).toMatchObject({ imageUrl: `${IMG}/OP17-005.png`, arts: [{ id: 'OP17-005_p1', imageUrl: `${IMG}/OP17-005_p1.png`, label: 'Alternate Art' }] });
    expect(by('OP17-040').arts).toEqual([{ id: 'OP17-040_p1', imageUrl: `${IMG}/OP17-040_p1.png`, label: 'TR' }]);
    expect(by('EB04-007').arts).toEqual([{ id: 'EB04-007_p2', imageUrl: `${IMG}/EB04-007_p2.png`, label: 'SP' }]);
    // Dois atributos e o sinal de menos no meio do texto.
    expect(by('OP17-114')).toMatchObject({ attributes: ['Slash', 'Strike'] });
    expect(by('OP17-114').text).toContain("Characters -3000 power during this turn");
  });

  it('sem a CDN própria (as imagens da lista só abrem no site dela) vêm só os dados', async () => {
    const got = await bandaiSource({ fetchText: fakeList().fetchText, delayMs: 0 }).fetch({ sets: ['OP17'] });
    expect(got.cards.map((c) => c.id).sort()).toEqual(['OP17-005', 'OP17-040', 'OP17-114']);
    expect(got.cards.some((c) => c.imageUrl || c.arts)).toBe(false);
    expect(got.artOnly).toBeUndefined();
  });

  it('coleção que a lista não tem, promocionais e pedido sem coleção: nada (e nenhuma página a mais)', async () => {
    const net = fakeList();
    const src = bandaiSource({ fetchText: net.fetchText, delayMs: 0 });
    expect((await src.fetch({ sets: ['ST-37'] })).cards).toEqual([]);
    expect(net.calls).toEqual(['/cardlist/']);
    expect((await src.fetch({ sets: ['P'] })).cards).toEqual([]);
    expect((await src.fetch({})).cards).toEqual([]);
    expect(net.calls).toEqual(['/cardlist/']);
  });
});

describe('coleção oficial pela lista da Bandai no dia do lançamento', () => {
  it('antes da data de lançamento nada muda, e a lista nem é consultada', async () => {
    const db = withSpoilers();
    const net = fakeList();
    // 19/11 às 23:59 em Brasília (já é dia 20 em UTC).
    const r = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(net, false, new Date('2026-11-20T02:59:00Z')) });
    expect(r).toMatchObject({ official: [], fromList: [], errors: [] });
    expect(net.calls).toEqual([]);
    expect(pendingSpoilers(db)).toHaveLength(8);
    expect(brasiliaDate(new Date('2026-11-20T02:59:00Z'))).toBe('2026-11-19');
    expect(brasiliaDate(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20');
  });

  it('no dia do lançamento, sem a API: as cartas viram oficiais com os dados da lista', async () => {
    const db = withSpoilers();
    const net = fakeList();
    // Meia-noite de 20/11 em Brasília.
    const r = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(net, false, new Date('2026-11-20T03:00:00Z')) });
    expect(r).toMatchObject({ official: IDS, fromList: ['OP18'], imported: 7, errors: [] });
    // A carta que a lista não tem continua em spoiler.
    expect(pendingSpoilers(db)).toEqual(['OP18-200']);
    expect([...listReleases(db)]).toEqual([['OP18', 'en.onepiece-cardgame.com']]);
    const [jugon, franky] = getCards(db, ['OP18-005', 'OP18-021']);
    expect(jugon).toMatchObject({ provisional: false, name: 'Kung Fu Jugon', cost: 1, power: 0, counter: 1000, types: ['Animal', 'Alabasta'], text: '[Your Turn] This Character gains +1000 power for every [Kung Fu Jugon].' });
    expect(jugon.spoiler).toBeUndefined();
    expect(db.prepare('SELECT source FROM cards WHERE id = ?').get('OP18-005')).toEqual({ source: 'api:en.onepiece-cardgame.com' });
    // Sem a CDN própria a lista não traz imagem: ficam a imagem e as artes que a carta já tinha.
    expect(jugon.imageUrl).toBe(`${LEAKS}/op18-005.webp`);
    expect(franky).toMatchObject({ provisional: false, name: 'Franky', category: 'leader', life: 4, imageUrl: `${LEAKS}/op18-021.webp`, arts: [leaksArt] });
  });

  it('com a CDN própria, a imagem é a da lista; a paralela que a lista publica depois entra no lugar da do site', async () => {
    const db = withSpoilers();
    await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(fakeList(), true) });
    expect(getCards(db, ['OP18-021'])[0]).toMatchObject({ imageUrl: `${IMG}/OP18-021.png`, arts: [leaksArt] });

    // Rodada seguinte: a coleção já é oficial, a API continua sem ela e a lista ganhou a paralela do Franky.
    const parallel = sample.op18.match(/<dl class="modalCol" id="OP18-021">[\s\S]*?<\/dl>/)![0].replaceAll('OP18-021', 'OP18-021_p1');
    const net = fakeList({ op18: `${sample.op18}\n${parallel.replace('<span>OP18-021_p1</span>', '<span>OP18-021</span>')}` });
    const api = fakeApi();
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson, officialList: list(net, true) });
    expect(r).toMatchObject({ official: [], fromList: ['OP18'], errors: [] });
    // A API é procurada pela coleção e, sem ela na lista de coleções, por uma carta já oficial.
    expect(api.calls).toEqual(['/allSets/', '/allDecks/', '/sets/card/OP18-001/']);
    expect(getCards(db, ['OP18-021'])[0].arts).toEqual([{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.png`, label: 'Alternate Art' }]);
  });

  it('quando a API publica a coleção, vale a importação dela e a lista não é mais consultada', async () => {
    const db = withSpoilers();
    await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(fakeList(), true) });
    // A lista já tinha a paralela (com o nome de arquivo dela); a API traz a mesma impressão com sufixo.
    upsertCards(db, [{ ...getCards(db, ['OP18-021'])[0], arts: [{ id: 'OP18-021_p1', imageUrl: `${IMG}/OP18-021_p1.png`, label: 'Alternate Art' }] }], { provisional: false, source: 'api:en.onepiece-cardgame.com' });
    const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      card_set_id: id, card_image_id: id, card_name: name, set_id: 'OP-18', card_type: 'Character', card_color: 'Red', card_cost: '1', card_power: '2000',
      counter_amount: 1000, sub_types: 'Alabasta', card_text: 'Texto da API.', card_image: `https://optcgapi.test/${id}.jpg`, ...extra,
    });
    const api = fakeApi({
      '/allSets/': [{ set_id: 'OP-18' }],
      '/allDecks/': [],
      '/sets/OP-18/': [
        row('OP18-005', 'Kung Fu Jugon'),
        row('OP18-021', 'Franky', { card_type: 'Leader', life: '4', card_cost: null }),
        row('OP18-021', 'Franky (Alternate Art)', { card_type: 'Leader', life: '4', card_cost: null, card_image_id: 'OP18-021_p1', card_image: 'https://optcgapi.test/OP18-021_p1_AbCdEfG.jpg' }),
      ],
    });
    const net = fakeList();
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson, officialList: list(net, true) });
    expect(r).toMatchObject({ fromList: [], errors: [] });
    expect(net.calls).toEqual([]);
    expect(listReleases(db).size).toBe(0);
    const [jugon, franky] = getCards(db, ['OP18-005', 'OP18-021']);
    expect(jugon).toMatchObject({ text: 'Texto da API.', imageUrl: 'https://optcgapi.test/OP18-005.jpg' });
    expect(db.prepare('SELECT source FROM cards WHERE id = ?').get('OP18-005')).toEqual({ source: 'api:api.test' });
    // A mesma impressão não fica repetida (a da lista sai, a da API fica).
    expect(franky.arts).toEqual([{ id: 'OP18-021_p1_AbCdEfG', imageUrl: 'https://optcgapi.test/OP18-021_p1_AbCdEfG.jpg', label: 'Alternate Art' }]);
    // Nas rodadas seguintes só a carta que ficou em spoiler é procurada na API, e a lista não passa por cima dela.
    const later = fakeApi();
    const after = await syncSpoilers(db, { base: BASE, fetchJson: later.fetchJson, officialList: list(net, true) });
    expect(after.fromList).toEqual([]);
    expect(net.calls).toEqual([]);
    expect(later.calls).toEqual(['/allSets/', '/allDecks/', '/sets/card/OP18-200/']);
    expect(getCards(db, ['OP18-005'])[0].text).toBe('Texto da API.');
  });

  it('lista fora do ar ou sem a coleção: as cartas continuam em spoiler', async () => {
    const db = withSpoilers();
    const down = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(fakeList({ op18: new Error('ECONNRESET') }), false) });
    expect(down).toMatchObject({ official: [], fromList: [], errors: ['bandai: ECONNRESET'] });
    // Página sem nenhuma carta (a série existe, mas ainda vazia).
    const empty = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: list(fakeList({ op18: '<html></html>' }), false) });
    expect(empty).toMatchObject({ official: [], fromList: [], errors: [] });
    expect(pendingSpoilers(db)).toHaveLength(8);
    expect(listReleases(db).size).toBe(0);
    // Sem a opção (CARD_RELEASE_SOURCE=off), só a API torna oficial.
    const off = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson });
    expect(off).toMatchObject({ official: [], fromList: [] });
  });

  it('coleção sem data de lançamento (starter, promocionais) não vira oficial pela lista', async () => {
    const db = withSpoilers();
    const net = fakeList();
    const r = await syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: { ...list(net, false), releases: new Map() } });
    expect(r.fromList).toEqual([]);
    expect(net.calls).toEqual([]);
  });

  it('a lista entra no lugar da optcgapi na cadeia: o Cardkaizoku na frente continua valendo, com os números da lista', async () => {
    const db = withSpoilers();
    const kaizoku = {
      [cardkaizokuManifestUrl]: { cardData: { current: 'cards.json' } },
      'https://cdn.cardkaizoku.com/cards.json': [
        // O site já errou poder e contador: esses campos vêm da fonte seguinte (a lista).
        { cardNumber: 'OP18-005', cardName: 'Kung Fu Jugon', cardType: 'CHARACTER', cost: '1', power: '9000', counter: '2000', color: 'Red', attribute: 'Strike', feature: 'Animal/Alabasta', text: '[Your Turn] This Character gains +1000 power for every [Kung Fu Jugon].', products: [] },
      ],
    };
    const api = fakeApi(kaizoku);
    const chain: CardSource[] = [cardkaizokuSource(api.fetchJson), { id: 'optcgapi', host: 'api.test', fetch: async () => ({ cards: [] }) }];
    const r = await syncSpoilers(db, { base: BASE, fetchJson: api.fetchJson, chain, officialList: list(fakeList(), false) });
    expect(r).toMatchObject({ fromList: ['OP18'], errors: [] });
    expect(getCards(db, ['OP18-005'])[0]).toMatchObject({ provisional: false, power: 0, counter: 1000 });
    expect(db.prepare('SELECT source FROM cards WHERE id = ?').get('OP18-005')).toEqual({ source: 'api:cardkaizoku.com' });
    expect(db.prepare('SELECT source FROM cards WHERE id = ?').get('OP18-021')).toEqual({ source: 'api:en.onepiece-cardgame.com' });
  });

  it('a rodada completa lê as datas dos arquivos de spoilers e avisa no log', async () => {
    const db = withSpoilers();
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    writeFileSync(join(dir, 'op18.json'), JSON.stringify({ set: 'op18', release: '2026-11-20', cards: [] }));
    writeFileSync(join(dir, 'st37.json'), JSON.stringify({ set: 'ST37', feed: false, cards: [] }));
    expect([...releaseDates(dir)]).toEqual([['OP18', '2026-11-20']]);
    const log: string[] = [];
    const net = fakeList();
    const r = await spoilerRound(db, {
      base: BASE,
      dir,
      log: (m) => log.push(m),
      fetchJson: fakeApi().fetchJson,
      officialList: { source: bandaiSource({ fetchText: net.fetchText, delayMs: 0 }), now: LAUNCH },
    });
    expect(r.sync.fromList).toEqual(['OP18']);
    expect(log).toContain('Oficiais pela lista da Bandai (a optcgapi ainda não publicou): OP18');
    expect(pendingSpoilers(db)).toEqual(['OP18-200']);
  });

  it('há uma rodada marcada para o primeiro minuto do dia de lançamento (horário de Brasília)', () => {
    const dates = ['2026-11-20', '2026-11-20', '2027-02-20', '2026-10-30', '2026-11-21'];
    // 19/11 às 21:00 em Brasília: faltam 3 h e 1 min; a data que já passou e a distante demais ficam de fora.
    expect(releaseRoundDelays(dates, new Date('2026-11-20T00:00:00Z'))).toEqual([
      ['2026-11-20', 3 * 3600_000 + 60_000],
      ['2026-11-21', 27 * 3600_000 + 60_000],
    ]);
    expect(releaseRoundDelays(['2026-11-20'], new Date('2026-11-20T03:01:00Z'))).toEqual([]);
  });
});

describe('data de lançamento pela página de produtos da Bandai', () => {
  /** A página de produtos falsa (boosters e decks). */
  function fakeProducts(pages: { boosters?: string | Error; decks?: string | Error } = { boosters: sample.productsBoosters, decks: sample.productsDecks }) {
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url.replace(LIST, ''));
      const body = url.includes('subcategory=decks') ? pages.decks : pages.boosters;
      if (body === undefined) throw new Error(`${url} respondeu 404`);
      if (body instanceof Error) throw body;
      return body;
    };
    return { calls, dates: officialReleaseDates({ fetchText, delayMs: 0 }) };
  }
  /** A mesma página com outra data para o OP-18. */
  const moved = (date: string) => sample.productsBoosters.replace('datetime="2026-11-20"', `datetime="${date}"`);
  const run = (db: ReturnType<typeof withSpoilers>, products: ReturnType<typeof fakeProducts>, now: Date, releases = RELEASES) =>
    syncSpoilers(db, { base: BASE, fetchJson: fakeApi().fetchJson, officialList: { ...list(fakeList(), false, now), releases, officialReleases: products.dates } });

  it('lê a "Release Date" de cada coleção (a coleção dupla vale para as duas)', () => {
    expect([...parseReleaseDates(sample.productsBoosters)].sort()).toEqual([
      ['EB04', '2026-04-03'],
      ['EB05', '2026-10-30'],
      ['EB06', '2027-01-29'],
      ['OP15', '2026-04-03'],
      ['OP18', '2026-11-20'],
    ]);
    // Produto sem código de coleção ("Learn Together Deck Set") fica de fora.
    expect([...parseReleaseDates(sample.productsDecks)].sort()).toEqual([
      ['ST37', '2026-12-18'],
      ['ST38', '2026-12-18'],
    ]);
  });

  it('busca só as páginas das coleções pedidas (starter decks ficam em outra)', async () => {
    const boosters = fakeProducts();
    expect([...(await boosters.dates(['OP18', 'OP99']))]).toEqual([['OP18', '2026-11-20']]);
    expect(boosters.calls).toEqual(['/products/?subcategory=boosters&page=1']);
    const both = fakeProducts();
    expect([...(await both.dates(['ST-37', 'OP18']))].sort()).toEqual([['OP18', '2026-11-20'], ['ST37', '2026-12-18']]);
    expect(both.calls).toEqual(['/products/?subcategory=boosters&page=1', '/products/?subcategory=decks&page=1']);
  });

  it('lançamento adiado: vale a data da página, não a do arquivo', async () => {
    const db = withSpoilers();
    const products = fakeProducts({ boosters: moved('2026-11-27') });
    // O arquivo diz 20/11; a Bandai adiou para 27/11.
    const r = await run(db, products, LAUNCH);
    expect(r).toMatchObject({ official: [], fromList: [], errors: [], releases: [{ set: 'OP18', date: '2026-11-27', official: '2026-11-27', file: '2026-11-20' }] });
    expect(pendingSpoilers(db)).toHaveLength(8);
    // No dia 27 a coleção vira oficial.
    expect((await run(db, products, new Date('2026-11-27T15:00:00Z'))).fromList).toEqual(['OP18']);
  });

  it('lançamento antecipado ou coleção sem data no arquivo: a página basta', async () => {
    const early = await run(withSpoilers(), fakeProducts({ boosters: moved('2026-11-13') }), new Date('2026-11-13T15:00:00Z'));
    expect(early.fromList).toEqual(['OP18']);
    const noFile = await run(withSpoilers(), fakeProducts(), LAUNCH, new Map());
    expect(noFile).toMatchObject({ fromList: ['OP18'], releases: [{ set: 'OP18', date: '2026-11-20', official: '2026-11-20' }] });
    expect(noFile.releases[0].file).toBeUndefined();
  });

  it('página fora do ar ou sem a coleção: vale a data do arquivo', async () => {
    const down = await run(withSpoilers(), fakeProducts({ boosters: new Error('ECONNRESET') }), LAUNCH);
    expect(down).toMatchObject({ fromList: ['OP18'], errors: ['bandai (datas de lançamento): ECONNRESET'], releases: [{ set: 'OP18', date: '2026-11-20', file: '2026-11-20' }] });
    const missing = await run(withSpoilers(), fakeProducts({ boosters: '<html></html>' }), LAUNCH);
    expect(missing).toMatchObject({ fromList: ['OP18'], errors: [] });
    // Sem data em lugar nenhum, a coleção continua em spoiler.
    const none = await run(withSpoilers(), fakeProducts({ boosters: '<html></html>' }), LAUNCH, new Map());
    expect(none).toMatchObject({ fromList: [], releases: [{ set: 'OP18' }] });
  });

  it('a página só é consultada enquanto há coleção esperando o lançamento', async () => {
    const db = withSpoilers();
    const products = fakeProducts();
    await run(db, products, LAUNCH);
    expect(products.calls).toHaveLength(1);
    // Depois de oficial pela lista (sobrou um spoiler que a lista não tem), a data não é mais procurada.
    const r = await run(db, products, LAUNCH);
    expect(r).toMatchObject({ fromList: ['OP18'], releases: [] });
    expect(products.calls).toHaveLength(1);
  });

  it('a rodada completa avisa no log quando a data do arquivo e a da página divergem', async () => {
    const db = withSpoilers();
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    writeFileSync(join(dir, 'op18.json'), JSON.stringify({ set: 'OP18', release: '2026-11-20', cards: [] }));
    const log: string[] = [];
    const r = await spoilerRound(db, {
      base: BASE,
      dir,
      log: (m) => log.push(m),
      fetchJson: fakeApi().fetchJson,
      officialList: { source: bandaiSource({ fetchText: fakeList().fetchText, delayMs: 0 }), now: LAUNCH, officialReleases: fakeProducts({ boosters: moved('2026-11-27') }).dates },
    });
    expect(r.sync.fromList).toEqual([]);
    expect(log).toContain('Lançamento do OP18: a página de produtos da Bandai diz 2026-11-27 e o arquivo de spoilers diz 2026-11-20; vale a da página.');
  });

  it('CARD_RELEASE_SOURCE: ligado por padrão, "off" desliga', () => {
    expect(releaseFromOfficialList({})).toBe(true);
    expect(releaseFromOfficialList({ CARD_RELEASE_SOURCE: 'bandai' })).toBe(true);
    expect(releaseFromOfficialList({ CARD_RELEASE_SOURCE: 'off' })).toBe(false);
  });
});
