import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CardData, proxiedImageUrl, registerCardCdn } from '@gumgum/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { cdnFromEnv, dirStore, mirrorCardImages, publishImageIndex, syncCardCdn } from '../src/card-cdn';
import { r2Client, r2Endpoint, signRequest } from '../src/card-cdn/r2';
import { getCards, openDb, upsertCards } from '../src/db';

const CDN = 'https://cards.ggf.test';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagem-falsa')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

const card = (id: string, extra: Partial<CardData> = {}): CardData => ({
  id,
  name: 'Nami',
  category: 'character',
  colors: ['blue'],
  cost: 1,
  power: 1000,
  types: [],
  text: '',
  set: id.split('-')[0],
  imageUrl: `https://optcgapi.com/media/static/Card_Images/${id}.jpg`,
  ...extra,
});

/** Rede falsa: conta os downloads; `bad` responde 404. */
function images(bad: string[] = []) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (bad.some((b) => String(url).includes(b))) return new Response('x', { status: 404 });
    // Como a optcgapi: PNG com content-type de JPEG.
    return new Response(String(url).endsWith('.webp') ? WEBP : PNG, { headers: { 'content-type': String(url).endsWith('.webp') ? 'image/webp' : 'image/jpeg' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'cdn-'));
  return { db, dir, store: dirStore(dir, `${CDN}/`) };
}

afterEach(() => registerCardCdn(null));

describe('CDN própria das imagens', () => {
  it('copia as imagens (principal e artes), troca os endereços e não baixa de novo', async () => {
    const { db, dir, store } = setup();
    upsertCards(
      db,
      [
        card('OP01-016', { arts: [{ id: 'OP01-016_p1', imageUrl: 'https://optcgapi.com/media/static/Card_Images/OP01-016_p1.jpg', label: 'Parallel' }] }),
        card('EB05-010', { imageUrl: 'https://images.optcgleaks.com/eb05/images/eb05-010_v2.webp', spoiler: { source: 'optcgleaks.com' } }),
      ],
      { provisional: false, source: 'api:test' },
    );
    const net = images();
    const r = await mirrorCardImages(db, store, { fetchImpl: net.fetchImpl });
    expect(r).toMatchObject({ uploaded: 3, cards: 2, failed: [], skipped: 0 });
    const [eb, op] = getCards(db, ['EB05-010', 'OP01-016']);
    expect(op.imageUrl).toMatch(/^https:\/\/cards\.ggf\.test\/OP01\/en\/OP01-016\.png\?v=[0-9a-f]{12}$/);
    expect(op.arts).toEqual([{ id: 'OP01-016_p1', label: 'Parallel', imageUrl: expect.stringMatching(/^https:\/\/cards\.ggf\.test\/OP01\/en\/OP01-016_p1\.png\?v=/) }]);
    expect(eb.imageUrl).toMatch(/\/EB05\/en\/eb05-010_v2\.webp\?v=/);
    expect(readFileSync(join(dir, 'OP01/en/OP01-016.png'))).toEqual(PNG);

    // Reimportar volta os endereços de origem: a cópia já existe, só a carta muda (sem download).
    upsertCards(db, [card('OP01-016', { arts: [{ id: 'OP01-016_p1', imageUrl: 'https://optcgapi.com/media/static/Card_Images/OP01-016_p1.jpg' }] })], {
      provisional: false,
      source: 'api:test',
    });
    const again = images();
    expect(await mirrorCardImages(db, store, { fetchImpl: again.fetchImpl })).toMatchObject({ uploaded: 0, reused: 2, cards: 2 });
    expect(again.calls).toEqual([]);
    const [op2] = getCards(db, ['OP01-016']);
    expect(op2.imageUrl).toBe(op.imageUrl);
    // A arte da importação e a já copiada são a mesma (pelo id): nada de arte repetida.
    expect(op2.arts).toHaveLength(1);
  });

  it('arquivo que não é imagem não entra', async () => {
    const { db, store } = setup();
    upsertCards(db, [card('OP01-001')], { provisional: false, source: 'api:test' });
    const html = (async () => new Response('<html>bloqueado</html>', { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
    const r = await mirrorCardImages(db, store, { fetchImpl: html });
    expect(r.uploaded).toBe(0);
    expect(r.failed[0].error).toMatch(/não é PNG/);
  });

  it('origem desconhecida ou com erro fica com o endereço original; o limite deixa o resto para a próxima', async () => {
    const { db, store } = setup();
    upsertCards(
      db,
      [
        card('OP01-001'),
        card('OP01-002'),
        card('OP01-003'),
        card('P-130', { imageUrl: 'https://cdn.cardkaizoku.com/cards_en/P/P-130.png' }),
      ],
      { provisional: false, source: 'api:test' },
    );
    const r = await mirrorCardImages(db, store, { fetchImpl: images(['OP01-002']).fetchImpl, maxDownloads: 2 });
    expect(r).toMatchObject({ uploaded: 1, skipped: 1, cards: 1 });
    expect(r.failed).toEqual([{ url: 'https://optcgapi.com/media/static/Card_Images/OP01-002.jpg', error: '404' }]);
    const [a, b, c, p] = getCards(db, ['OP01-001', 'OP01-002', 'OP01-003', 'P-130']);
    expect(a.imageUrl).toContain(CDN);
    expect(b.imageUrl).toContain('optcgapi.com');
    expect(c.imageUrl).toContain('optcgapi.com');
    expect(p.imageUrl).toBe('https://cdn.cardkaizoku.com/cards_en/P/P-130.png');
    expect((await mirrorCardImages(db, store, { fetchImpl: images().fetchImpl })).uploaded).toBe(2);
  });

  it('índice público para parceiros só com as cartas que já estão na CDN', async () => {
    const { db, dir, store } = setup();
    upsertCards(db, [card('OP01-016'), card('OP18-001', { imageUrl: undefined, spoiler: { source: 'cardkaizoku.com' } })], {
      provisional: false,
      source: 'api:test',
    });
    const logs: string[] = [];
    await syncCardCdn(db, store, { fetchImpl: images().fetchImpl, log: (m) => logs.push(m), officialRegions: [] });
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    expect(index.schemaVersion).toBe(1);
    expect(Object.keys(index.cards)).toEqual(['OP01-016']);
    expect(index.cards['OP01-016']).toMatchObject({ name: 'Nami', set: 'OP01', image: expect.stringContaining(`${CDN}/OP01/en/`) });
    expect(await publishImageIndex(db, store)).toBe(1);
    expect(logs[0]).toMatch(/1 copiadas/);
  });

  it('o /card-img/ e o kit de divulgação aceitam a CDN como origem', async () => {
    expect(proxiedImageUrl(`${CDN}/OP01/en/OP01-016.jpg?v=abc`)).toBeNull();
    const db = openDb(':memory:');
    const fetchImpl = (async (url: string) =>
      String(url) === `${CDN}/OP01/en/OP01-016.jpg` ? new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 404 })) as typeof fetch;
    const app = buildApp(db, { server: { cardImages: true, cardCdn: CDN }, fetchImpl });
    expect(proxiedImageUrl(`${CDN}/OP01/en/OP01-016.jpg?v=abc`)).toBe('/card-img/cdn/OP01/en/OP01-016.jpg');
    expect((await app.inject('/card-img/cdn/OP01/en/OP01-016.jpg')).statusCode).toBe(200);
    expect((await app.inject('/api/config')).json().cardCdn).toBe(CDN);
  });

  it('configuração: precisa do endereço público e das quatro credenciais do R2', () => {
    const env = { CARD_CDN_URL: CDN, R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' };
    expect(cdnFromEnv(env)?.publicBase).toBe(CDN);
    expect(cdnFromEnv({ ...env, R2_SECRET_ACCESS_KEY: '' })).toBeNull();
    expect(cdnFromEnv({})).toBeNull();
  });
});

describe('R2 (API S3)', () => {
  it('aceita o Account ID sozinho ou o endpoint S3 que o painel mostra', () => {
    expect(r2Endpoint('abc123')).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(r2Endpoint('https://abc123.r2.cloudflarestorage.com/')).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(r2Endpoint('https://abc123.r2.cloudflarestorage.com/ggf-cards')).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(r2Endpoint('abc123.eu.r2.cloudflarestorage.com')).toBe('https://abc123.eu.r2.cloudflarestorage.com');
  });

  it('bucket inacessível: confere antes, não baixa nada e diz o motivo', async () => {
    const db = openDb(':memory:');
    upsertCards(db, [card('OP01-001'), card('OP01-002')], { provisional: false, source: 'api:test' });
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('r2.cloudflarestorage.com')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const env = { CARD_CDN_URL: CDN, R2_ACCOUNT_ID: 'errado', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' };
    const logs: string[] = [];
    const r = await syncCardCdn(db, cdnFromEnv(env, fetchImpl)!, { fetchImpl, log: (m) => logs.push(m), officialRegions: [] });
    expect(r).toMatchObject({ uploaded: 0, failed: [], unavailable: 'R2 inacessível em errado.r2.cloudflarestorage.com (ENOTFOUND)' });
    expect(calls).toEqual(['https://errado.r2.cloudflarestorage.com/b/index.json']);
    expect(logs[0]).toMatch(/bucket inacessível.*ENOTFOUND.*R2_ACCOUNT_ID/);
  });

  it('assinatura SigV4 igual ao exemplo da documentação da AWS (GET Object)', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('grava no bucket pelo endereço do R2, com tipo e cache', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method!, headers: init.headers as Record<string, string> });
      return new Response(null, { status: init.method === 'HEAD' ? 404 : 200 });
    }) as typeof fetch;
    const client = r2Client({ accountId: 'conta', bucket: 'ggf-cards', accessKeyId: 'k', secretAccessKey: 's' }, fetchImpl);
    expect(await client.has('OP01/en/OP01-016.jpg')).toBe(false);
    await client.put('OP01/en/OP01-016.jpg', PNG, 'image/jpeg', 'public, max-age=60');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'HEAD https://conta.r2.cloudflarestorage.com/ggf-cards/OP01/en/OP01-016.jpg',
      'PUT https://conta.r2.cloudflarestorage.com/ggf-cards/OP01/en/OP01-016.jpg',
    ]);
    expect(calls[1].headers).toMatchObject({ 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=60' });
    expect(calls[1].headers.authorization).toMatch(/\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date,/);
  });
});
