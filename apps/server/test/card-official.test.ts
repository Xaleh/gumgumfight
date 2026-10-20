import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardData } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { dirStore, syncCardCdn } from '../src/card-cdn';
import { BANDAI_REGIONS, fillOfficialImages, imageRegionsFromEnv, parseCardList, parseSeriesList } from '../src/card-cdn/official';
import { getCards, openDb, upsertCards } from '../src/db';

// Trecho real de https://en.onepiece-cardgame.com/cardlist/?series=569901 (promocionais).
const PROMO = readFileSync(join(__dirname, 'fixtures/bandai-en-promo.html'), 'utf8');
const [EN, ASIA, JP] = BANDAI_REGIONS;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('oficial')]);

const card = (id: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name: 'Monkey.D.Luffy',
  category: 'character',
  colors: ['green'],
  cost: 5,
  power: 5000,
  types: [],
  text: '',
  set: id.split('-')[0],
  ...extra,
});

/** Listas oficiais falsas: URL -> HTML; o resto responde erro. */
function site(pages: Record<string, string>) {
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    if (pages[url] === undefined) throw new Error(`${url} respondeu 404`);
    return pages[url];
  };
  return { fetchText, calls };
}

/** Lista de um site sem a carta pedida (só o <select>, com uma promo de outro número). */
const JP_PROMO = `<select name="series"><option value="550901">プロモーションカード</option></select>
<dl class="modalCol" id="P-152"><dt></dt><dd><img class="lazy" data-src="../images/cardlist/card/P-152.png?1"><div class="getInfo"><h3>入手方法</h3>プレミアムカードコレクション</div></dd></dl>`;

describe('listas oficiais da Bandai', () => {
  it('lê as coleções do seletor (código entre colchetes; sem código = promocionais)', () => {
    expect(parseSeriesList(PROMO)).toEqual([
      { id: '569117', label: 'BOOSTER PACK -THE WORLD’S STRONGEST WARRIORS- [OP-17]', sets: ['OP17'] },
      { id: '569115', label: 'BOOSTER PACK -ADVENTURE ON KAMI’S ISLAND- [OP15-EB04]', sets: ['OP15', 'EB04'] },
      { id: '569001', label: 'STARTER DECK -Straw Hat Crew- [ST-01]', sets: ['ST01'] },
      { id: '569901', label: 'Promotion card', sets: ['P'] },
      { id: '569801', label: 'Other Product Card', sets: ['P'] },
    ]);
  });

  it('lê as impressões: número da carta, imagem absoluta sem query e produto', () => {
    expect(parseCardList(PROMO, EN.base)).toEqual([
      { variant: 'P-135', cardId: 'P-135', imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/P-135.png', label: 'OP-16 Release Event' },
      { variant: 'P-135_p1', cardId: 'P-135', imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/P-135_p1.png', label: expect.any(String) },
      { variant: 'EB01-003_p2', cardId: 'EB01-003', imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/EB01-003_p2.png', label: expect.any(String) },
    ]);
  });

  it('CARD_IMAGE_SOURCES: padrão todas, ordem escolhida ou off', () => {
    expect(imageRegionsFromEnv({}).map((r) => r.id)).toEqual(['bandai-en', 'bandai-asia', 'bandai-jp']);
    expect(imageRegionsFromEnv({ CARD_IMAGE_SOURCES: 'bandai-jp, bandai-en, xyz' }).map((r) => r.id)).toEqual(['bandai-jp', 'bandai-en']);
    expect(imageRegionsFromEnv({ CARD_IMAGE_SOURCES: 'off' })).toEqual([]);
  });
});

describe('cartas sem imagem ganham a oficial', () => {
  it('procura só nas coleções que faltam, região por região, e guarda para a próxima vez', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [card('P-135'), card('P-152', { name: 'Edward.Newgate' }), card('OP01-001', { imageUrl: 'https://optcgapi.com/media/x.jpg' })], {
      provisional: false,
      source: 'api:test',
    });
    const net = site({
      [`${EN.base}/cardlist/`]: PROMO,
      [`${EN.base}/cardlist/?series=569901`]: PROMO,
      [`${EN.base}/cardlist/?series=569801`]: '<html></html>',
      [`${ASIA.base}/cardlist/`]: '<select name="series"></select>',
      [`${JP.base}/cardlist/`]: JP_PROMO,
      [`${JP.base}/cardlist/?series=550901`]: JP_PROMO,
    });
    const r = await fillOfficialImages(db, BANDAI_REGIONS, { fetchText: net.fetchText, delayMs: 0 });
    expect(r).toMatchObject({ filled: 2, missing: [], errors: [] });
    // Nada de OP-17, ST-01...: só as séries de promocionais.
    expect(net.calls).toEqual([
      `${EN.base}/cardlist/`,
      `${EN.base}/cardlist/?series=569901`,
      `${EN.base}/cardlist/?series=569801`,
      `${ASIA.base}/cardlist/`,
      `${JP.base}/cardlist/`,
      `${JP.base}/cardlist/?series=550901`,
    ]);
    const [luffy, newgate] = getCards(db, ['P-135', 'P-152']);
    expect(luffy).toMatchObject({
      imageUrl: `${EN.base}/images/cardlist/card/P-135.png`,
      arts: [{ id: 'P-135_p1', imageUrl: `${EN.base}/images/cardlist/card/P-135_p1.png`, label: expect.any(String) }],
    });
    expect(luffy.imageLang).toBeUndefined();
    expect(newgate).toMatchObject({ imageUrl: `${JP.base}/images/cardlist/card/P-152.png`, imageLang: 'jp' });

    // Reimportar apaga a imagem: volta pela tabela, sem consultar a Bandai.
    upsertCards(db, [card('P-135')], { provisional: false, source: 'api:test' });
    const again = site({});
    expect(await fillOfficialImages(db, BANDAI_REGIONS, { fetchText: again.fetchText, delayMs: 0 })).toMatchObject({ filled: 1 });
    expect(again.calls).toEqual([]);
    expect(getCards(db, ['P-135'])[0].imageUrl).toBe(`${EN.base}/images/cardlist/card/P-135.png`);
  });

  it('carta que nenhuma região tem: cada coleção é consultada no máximo uma vez por dia', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [card('P-999')], { provisional: false, source: 'api:test' });
    const pages = { [`${EN.base}/cardlist/`]: PROMO, [`${EN.base}/cardlist/?series=569901`]: PROMO, [`${EN.base}/cardlist/?series=569801`]: '' };
    const first = site(pages);
    const now = new Date('2026-10-20T12:00:00Z');
    expect(await fillOfficialImages(db, [EN], { fetchText: first.fetchText, delayMs: 0, now })).toMatchObject({ filled: 0, missing: ['P-999'] });
    const later = site(pages);
    await fillOfficialImages(db, [EN], { fetchText: later.fetchText, delayMs: 0, now: new Date('2026-10-20T18:00:00Z') });
    expect(later.calls).toEqual([`${EN.base}/cardlist/`]);
    const nextDay = site(pages);
    await fillOfficialImages(db, [EN], { fetchText: nextDay.fetchText, delayMs: 0, now: new Date('2026-10-21T13:00:00Z') });
    expect(nextDay.calls).toHaveLength(3);
  });

  it('site fora do ar não impede as outras regiões', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [card('P-152')], { provisional: false, source: 'api:test' });
    const net = site({ [`${JP.base}/cardlist/`]: JP_PROMO, [`${JP.base}/cardlist/?series=550901`]: JP_PROMO });
    const r = await fillOfficialImages(db, [EN, JP], { fetchText: net.fetchText, delayMs: 0 });
    expect(r.filled).toBe(1);
    expect(r.errors).toEqual([`bandai-en: ${EN.base}/cardlist/ respondeu 404`]);
  });

  it('na rodada da CDN: desenho provisório da optcgapi é recusado e a oficial entra no lugar, com o idioma na chave', async () => {
    const db = openDb(':memory:');
    const svg = 'https://optcgapi.com/media/static/Card_Images/Luffy_CS_2023_img.jpg';
    upsertCards(db, [card('P-152', { imageUrl: svg })], { provisional: false, source: 'api:test' });
    const store = dirStore(mkdtempSync(join(tmpdir(), 'cdn-')), 'https://cards.ggf.test');
    const fetchImpl = (async (url: string) =>
      String(url) === svg
        ? new Response('<svg width="400"></svg>', { headers: { 'content-type': 'image/jpeg' } })
        : new Response(PNG, { headers: { 'content-type': 'image/png' } })) as typeof fetch;
    const net = site({ [`${JP.base}/cardlist/`]: JP_PROMO, [`${JP.base}/cardlist/?series=550901`]: JP_PROMO });
    const opts = { fetchImpl, fetchText: net.fetchText, officialRegions: [JP], log: () => undefined };
    // 1ª rodada: o SVG é recusado (e registrado). 2ª: a oficial japonesa entra e vai para a CDN.
    await syncCardCdn(db, store, opts);
    expect(getCards(db, ['P-152'])[0].imageUrl).toBe(svg);
    const r = await syncCardCdn(db, store, opts);
    expect(r.uploaded).toBe(1);
    expect(getCards(db, ['P-152'])[0]).toMatchObject({
      imageUrl: expect.stringMatching(/^https:\/\/cards\.ggf\.test\/P\/jp\/P-152\.png\?v=/),
      imageLang: 'jp',
    });
  });
});
