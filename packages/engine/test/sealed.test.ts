import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actingPlayer } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef, needsManual } from '../src/cards';
import { validateDeck } from '../src/deck';
import { applyAction, createGame, hasName, hasType, LIMITED_DECK_SIZE, nameIncludes, typeIncludes } from '../src/engine';
import { cardLegality, formatIssues, formatLabel, playMode, playModeLabel, rarityCode, SEALED_LEADER_ID, spoilerRule } from '../src/formats';
import {
  anyLeaderAllowed,
  autoBuildLimited,
  BOOSTER_MODELS,
  boosterCards,
  boosterModelOf,
  boosterOdds,
  boosterReady,
  boosterSize,
  boosterStock,
  DEFAULT_BOOSTER,
  isBoosterSet,
  isRush,
  openBoosters,
  openMixedBoosters,
  poolCounts,
  rushKey,
  rushSets,
  SEALED_PACKS,
  sealedLeaders,
  validateLimitedDeck,
} from '../src/sealed';
import type { CardData, DeckList } from '../src/types';

const DATA = join(__dirname, '../../../data');
const all: CardData[] = readdirSync(join(DATA, 'cards')).flatMap((f) => JSON.parse(readFileSync(join(DATA, 'cards', f), 'utf8')).cards as CardData[]);
const byId = new Map(all.map((c) => [c.id, c]));
const op01 = boosterCards(all, 'OP01');
const rarity = (id: string) => rarityCode(byId.get(id)!.rarity);
const isLeader = (id: string) => byId.get(id)!.category === 'leader';

describe('Selado: boosters', () => {
  it('só coleções de booster, completas no banco', () => {
    expect([isBoosterSet('OP01'), isBoosterSet('eb05'), isBoosterSet('PRB01'), isBoosterSet('ST01'), isBoosterSet('P'), isBoosterSet('SEALED')]).toEqual([true, true, true, false, false, false]);
    expect(op01.length).toBeGreaterThan(100);
    expect(op01.every((c) => c.id.startsWith('OP01-'))).toBe(true);
    expect(boosterReady(op01)).toBe(true);
    // Coleção pela metade (spoilers ainda chegando): não entra.
    expect(boosterReady(op01.filter((c) => c.category === 'leader' || rarityCode(c.rarity) !== 'UC'))).toBe(false);
    // Muitas cartas sem raridade conhecida: também não.
    expect(boosterReady(op01.map((c, i) => (i % 3 ? c : { ...c, rarity: undefined })))).toBe(false);
    expect(boosterStock(op01)).toMatchObject({ unknown: 0 });
    expect(boosterStock(op01).leaders).toBeGreaterThan(0);
  });

  /** Quantas cartas de cada tipo um booster tem. */
  const mix = (pack: string[]) => ({
    C: pack.filter((id) => !isLeader(id) && rarity(id) === 'C').length,
    UC: pack.filter((id) => !isLeader(id) && rarity(id) === 'UC').length,
    R: pack.filter((id) => !isLeader(id) && rarity(id) === 'R').length,
    SR: pack.filter((id) => !isLeader(id) && rarity(id) === 'SR').length,
    SEC: pack.filter((id) => !isLeader(id) && rarity(id) === 'SEC').length,
    L: pack.filter(isLeader).length,
  });

  it('cada linha de produto tem o seu booster: as três primeiras coleções, o principal de hoje e o Extra Booster', () => {
    expect(boosterModelOf('OP01')).toBe(BOOSTER_MODELS.early);
    expect(boosterModelOf('op03')).toBe(BOOSTER_MODELS.early);
    expect(boosterModelOf('OP04')).toBe(BOOSTER_MODELS.main);
    expect(boosterModelOf('OP18')).toBe(BOOSTER_MODELS.main);
    expect(boosterModelOf('EB02')).toBe(BOOSTER_MODELS.extra);
    expect(DEFAULT_BOOSTER).toBe(BOOSTER_MODELS.main);
    // Todo booster tem 12 cartas de deck.
    expect([boosterSize(BOOSTER_MODELS.early), boosterSize(BOOSTER_MODELS.main), boosterSize(BOOSTER_MODELS.extra)]).toEqual([12, 12, 12]);
  });

  it('booster principal de hoje: 7 comuns, 3 incomuns e duas vagas de rara (uma pode ser SR ou SEC); o Líder entra no lugar de uma comum, sem SR', () => {
    const packs = openBoosters(op01, 42, 400, BOOSTER_MODELS.main);
    for (const pack of packs) {
      expect(pack).toHaveLength(12);
      expect(new Set(pack).size).toBe(pack.length);
      expect(pack.every((id) => id.startsWith('OP01-'))).toBe(true);
      const m = mix(pack);
      expect(m.L).toBeLessThanOrEqual(1);
      expect(m.C).toBe(m.L ? 6 : 7);
      expect(m.UC).toBe(3);
      expect(m.R + m.SR + m.SEC).toBe(2);
      expect(m.R).toBeGreaterThanOrEqual(1);
      // Líder e destaque não saem no mesmo booster.
      if (m.L) expect(m.R).toBe(2);
    }
  });

  it('booster das primeiras coleções: 8 comuns (a oitava no lugar do DON!!), 3 incomuns e uma vaga de destaque; o Líder pode vir com SR', () => {
    const packs = openBoosters(op01, 42, 600, boosterModelOf('OP01'));
    for (const pack of packs) {
      expect(pack).toHaveLength(12);
      expect(new Set(pack).size).toBe(pack.length);
      const m = mix(pack);
      expect(m.C).toBe(m.L ? 7 : 8);
      expect(m.UC).toBe(3);
      expect(m.R + m.SR + m.SEC).toBe(1);
    }
    expect(packs.some((p) => mix(p).L === 1 && mix(p).SR === 1)).toBe(true);
  });

  it('Extra Booster: sem incomuns (10 comuns e duas vagas de rara), e poucos Líderes quando a coleção só tem um', () => {
    // Um "EB" de teste: a OP01 sem incomuns e com um Líder só.
    const leader = op01.find((c) => c.category === 'leader')!;
    const eb = op01.filter((c) => (c.category === 'leader' ? c.id === leader.id : rarityCode(c.rarity) !== 'UC'));
    expect(boosterReady(eb)).toBe(false);
    expect(boosterReady(eb, BOOSTER_MODELS.extra)).toBe(true);
    const packs = openBoosters(eb, 9, 3000, BOOSTER_MODELS.extra);
    for (const pack of packs.slice(0, 300)) {
      const m = mix(pack);
      expect(pack).toHaveLength(12);
      expect(m.UC).toBe(0);
      expect(m.C).toBe(m.L ? 9 : 10);
      expect(m.R + m.SR + m.SEC).toBe(2);
    }
    // 2 Líderes por caixa de 24 para cada Líder da coleção: 1 em 12 boosters.
    const withLeader = packs.filter((p) => mix(p).L).length / packs.length;
    expect(withLeader).toBeGreaterThan(0.06);
    expect(withLeader).toBeLessThan(0.11);
    expect(boosterOdds(BOOSTER_MODELS.extra, 1).leader).toBeCloseTo(2 / 24);
    expect(boosterOdds(BOOSTER_MODELS.extra, 3).leader).toBeCloseTo(6 / 24);
    expect(boosterOdds(BOOSTER_MODELS.extra, 0).leader).toBe(0);
  });

  it('a mesma seed abre os mesmos boosters; outra seed, outros (também com a seed de 128 bits do servidor)', () => {
    expect(openBoosters(op01, 7)).toEqual(openBoosters(op01, 7));
    expect(openBoosters(op01, 7)).not.toEqual(openBoosters(op01, 8));
    const words = [1, 2, 3, 4];
    expect(openBoosters(op01, words)).toEqual(openBoosters(op01, [1, 2, 3, 4]));
    expect(openBoosters(op01, words)).not.toEqual(openBoosters(op01, [1, 2, 3, 5]));
  });

  it('as taxas por caixa de 24 boosters batem com as registradas: 7 a 8 SR, menos de 1 SEC e 8 Líderes', () => {
    const boxes = 250;
    const perBox = (packs: string[][], pick: (m: ReturnType<typeof mix>) => number) => packs.reduce((n, p) => n + pick(mix(p)), 0) / boxes;
    // Principal de hoje: 7 SR + as artes alternativas de SR (perto de 7,8), 0,8 SEC e 8,3 Líderes.
    const main = openBoosters(op01, 2026, boxes * 24, BOOSTER_MODELS.main);
    expect(perBox(main, (m) => m.SR)).toBeGreaterThan(7.3);
    expect(perBox(main, (m) => m.SR)).toBeLessThan(8.3);
    expect(perBox(main, (m) => m.SEC)).toBeGreaterThan(0.55);
    expect(perBox(main, (m) => m.SEC)).toBeLessThan(1.05);
    expect(perBox(main, (m) => m.L)).toBeGreaterThan(7.8);
    expect(perBox(main, (m) => m.L)).toBeLessThan(8.9);
    // As raras passam de 30 por caixa (uma fixa por booster, mais as da vaga de destaque).
    expect(perBox(main, (m) => m.R)).toBeGreaterThan(36);
    expect(perBox(main, (m) => m.R)).toBeLessThan(41);
    // Primeiras coleções: 7 SR e pouco, perto de meia SEC, 8 Líderes; uma rara só nos boosters sem destaque.
    const early = openBoosters(op01, 2026, boxes * 24, BOOSTER_MODELS.early);
    expect(perBox(early, (m) => m.SR)).toBeGreaterThan(6.8);
    expect(perBox(early, (m) => m.SR)).toBeLessThan(7.8);
    expect(perBox(early, (m) => m.SEC)).toBeGreaterThan(0.35);
    expect(perBox(early, (m) => m.SEC)).toBeLessThan(0.8);
    expect(perBox(early, (m) => m.L)).toBeGreaterThan(7.5);
    expect(perBox(early, (m) => m.L)).toBeLessThan(8.5);
    expect(perBox(early, (m) => m.R)).toBeLessThan(17);
  });

  it('as chances mostradas ao jogador saem do mesmo modelo', () => {
    const main = boosterOdds(BOOSTER_MODELS.main, 6);
    expect(main.leader).toBeCloseTo(8.33 / 24);
    expect(main.SR).toBeCloseTo(7.8 / 24, 2);
    expect(main.SEC).toBeCloseTo(0.8 / 24, 2);
    const early = boosterOdds(BOOSTER_MODELS.early, 8);
    expect(early.SR).toBeCloseTo(7.3 / 24);
    expect(early.leader).toBeCloseTo(1 / 3);
  });
});

describe('Selado: o Líder de 6 cores', () => {
  const luffy = byId.get(SEALED_LEADER_ID)!;

  it('é a carta do evento: 6 cores, Vida 5, 5000, sem efeito de jogo e sem nada manual', () => {
    expect(luffy).toMatchObject({ name: 'Monkey.D.Luffy', category: 'leader', life: 5, power: 5000, attributes: ['Strike'], types: ['Straw Hat Crew'] });
    expect(luffy.colors).toEqual(['red', 'green', 'blue', 'purple', 'black', 'yellow']);
    const def = buildCardDef(luffy);
    expect(def.abilities).toEqual([]);
    expect(needsManual(luffy)).toBe(false);
  });

  it('vale por qualquer nome, tipo e atributo', () => {
    const def = buildCardDef(luffy);
    expect(def.wild).toBe(true);
    expect([hasType(def, 'Straw Hat Crew'), hasType(def, 'Animal Kingdom Pirates'), hasType(def, 'Navy')]).toEqual([true, true, true]);
    expect([hasName(def, 'Monkey.D.Luffy'), hasName(def, 'Kaido'), hasName(def, 'Charlotte Linlin')]).toEqual([true, true, true]);
    // "O tipo do seu Líder inclui "CP"" e "o nome inclui…" também valem: ele tem todos os tipos e nomes.
    expect([typeIncludes(def, 'CP'), typeIncludes(def, 'Pirates'), nameIncludes(def, 'Charlotte')]).toEqual([true, true, true]);
    // As outras cartas continuam com o que têm impresso.
    const zoro = buildCardDef(byId.get('OP01-001')!);
    expect(zoro.wild).toBeUndefined();
    expect([hasType(zoro, 'Straw Hat Crew'), hasType(zoro, 'Navy'), hasName(zoro, 'Kaido')]).toEqual([true, false, false]);
    expect([typeIncludes(zoro, 'CP'), typeIncludes(zoro, 'straw'), nameIncludes(zoro, 'zoro'), nameIncludes(zoro, 'Charlotte')]).toEqual([false, true, true, false]);
  });

  it('só vale no Selado (e no Livre): fica fora de todo formato de deck construído', () => {
    expect(['standard', 'egb', 'allblue'].map((f) => cardLegality(SEALED_LEADER_ID, f as 'egb', undefined, luffy))).toEqual(['eventOnly', 'eventOnly', 'eventOnly']);
    expect([cardLegality(SEALED_LEADER_ID, 'sealed'), cardLegality(SEALED_LEADER_ID, 'free')]).toEqual(['legal', 'legal']);
    const deck = { leader: SEALED_LEADER_ID, cards: [] };
    expect(formatIssues(deck, 'allblue', undefined, byId).map((i) => i.code)).toEqual(['rules.eventOnly']);
    expect(formatIssues(deck, 'egb').map((i) => i.message)).toEqual(['SEALED-001 só pode ser usada no Selado.']);
    expect(formatIssues(deck, 'sealed')).toEqual([]);
  });
});

describe('Selado: o deck de 40', () => {
  const packs = openBoosters(op01, 11);
  const pool = poolCounts(packs);
  const auto = (leader?: string): DeckList => ({ id: 'sealed:test', name: 'Selado', ...autoBuildLimited(pool, byId, leader) });

  it('o que o jogador abriu: 72 cartas, com as cópias repetidas somadas', () => {
    expect([...pool.values()].reduce((n, c) => n + c, 0)).toBe(72);
    expect(Math.max(...pool.values())).toBeGreaterThan(1);
  });

  it('Líderes disponíveis: os que saíram e o de 6 cores, sempre', () => {
    const leaders = sealedLeaders(pool, byId);
    expect(leaders.at(-1)).toBe(SEALED_LEADER_ID);
    expect(leaders.slice(0, -1).every((id) => isLeader(id) && pool.has(id))).toBe(true);
    expect(sealedLeaders(new Map(), byId)).toEqual([SEALED_LEADER_ID]);
  });

  it('"Montar sozinho" entrega um deck válido de 40, só com o que saiu, de várias cores', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = poolCounts(openBoosters(op01, seed));
      const deck: DeckList = { id: 'x', name: 'x', ...autoBuildLimited(p, byId) };
      const report = validateLimitedDeck(deck, byId, p);
      expect(report.issues.filter((i) => i.level === 'error'), `seed ${seed}`).toEqual([]);
      expect(report.total).toBe(LIMITED_DECK_SIZE);
      for (const e of deck.cards) expect(e.count).toBeLessThanOrEqual(p.get(e.id)!);
    }
    const colors = new Set(auto().cards.flatMap((e) => byId.get(e.id)!.colors));
    expect(colors.size).toBeGreaterThan(1);
    // Mesmo resultado para as mesmas cartas (a tela e o servidor concordam).
    expect(auto()).toEqual(auto());
  });

  it('com o Líder de 6 cores também fecha 40; o construído recusaria esse deck', () => {
    const deck = auto(SEALED_LEADER_ID);
    expect(deck.leader).toBe(SEALED_LEADER_ID);
    expect(validateLimitedDeck(deck, byId, pool).valid).toBe(true);
    expect(validateDeck(deck, byId).valid).toBe(false);
  });

  it('recusa carta que não saiu, cópias a mais, Líder que não saiu e deck fora de 40', () => {
    const deck = auto();
    const outside = all.find((c) => c.id.startsWith('OP02-') && c.category === 'character')!;
    const codes = (d: DeckList) => validateLimitedDeck(d, byId, pool).issues.filter((i) => i.level === 'error').map((i) => i.code);
    const [first, ...rest] = deck.cards;
    expect(codes({ ...deck, cards: [{ id: outside.id, count: first.count }, ...rest] })).toEqual(['rules.notInPool']);
    const over = { id: first.id, count: pool.get(first.id)! + 1 };
    expect(codes({ ...deck, cards: [over, ...rest] })).toEqual(expect.arrayContaining(['rules.poolCopies']));
    expect(codes({ ...deck, cards: rest })).toEqual(['rules.tooFewCards']);
    const otherLeader = all.find((c) => c.category === 'leader' && c.id.startsWith('OP02-') && !pool.has(c.id))!;
    expect(codes({ ...deck, leader: otherLeader.id })).toEqual(['rules.leaderNotInPool']);
    expect(codes({ ...deck, leader: '' })).toEqual(['rules.pickLeader']);
    expect(codes({ ...deck, cards: [{ id: SEALED_LEADER_ID, count: 1 }, ...rest] })).toEqual(expect.arrayContaining(['rules.leaderInDeck']));
  });

  it('o formato: sem banidas, sem rotação, spoilers da coleção valem, fora das estatísticas', () => {
    expect(formatLabel('sealed')).toBe('Selado');
    expect(playMode('sealed', false)).toEqual({ format: 'sealed', spoilers: true });
    expect(playModeLabel({ format: 'sealed', sealedSet: 'OP01' })).toBe('Selado OP01');
    expect(spoilerRule({ format: 'sealed' })).toBe('all');
    // Uma carta banida e uma do bloco ① valem se saírem no booster.
    expect([cardLegality('OP06-086', 'sealed'), cardLegality('OP01-001', 'sealed')]).toEqual(['legal', 'legal']);
  });

  it('dois decks de 40 jogam uma partida inteira (bot x bot) com o motor de sempre', () => {
    const a = auto();
    const other = poolCounts(openBoosters(op01, 12));
    const b: DeckList = { id: 'sealed:bot', name: 'Bot', ...autoBuildLimited(other, byId, SEALED_LEADER_ID) };
    for (let seed = 1; seed <= 10; seed++) {
      let s = createGame({ seed, firstPlayer: (seed % 2) as 0 | 1, cards: all, players: [{ name: 'A', deck: a }, { name: 'B', deck: b }] });
      expect(s.players.map((p) => p.deck.length + p.hand.length + p.life.length)).toEqual([40, 40]);
      for (let i = 0; i < 4000 && s.phase !== 'gameover'; i++) s = applyAction(s, chooseBotAction(s, actingPlayer(s)!));
      expect(s.phase, `seed ${seed}`).toBe('gameover');
      expect(s.winner === 0 || s.winner === 1).toBe(true);
    }
  });

  it('o motor continua recusando deck que não é de 50 nem de 40', () => {
    const deck = auto();
    const short: DeckList = { ...deck, cards: deck.cards.slice(1) };
    expect(() => createGame({ seed: 1, cards: all, players: [{ name: 'A', deck: short }, { name: 'B', deck }] })).toThrow(/precisa de 50, ou de 40 no Selado/);
  });
});

describe('Pack Rush: Selado com várias coleções', () => {
  const op02 = boosterCards(all, 'OP02');
  const sources = [
    { set: 'OP01', cards: op01 },
    { set: 'op02', cards: op02 },
  ];
  const opened = openMixedBoosters(sources, 5);
  const pool = poolCounts(opened.packs);
  const rules = { leaders: 'any' as const, sets: ['OP01', 'OP02'] };
  const deck = (leader?: string): DeckList => ({ id: 'sealed:rush', name: 'Pack Rush', ...autoBuildLimited(pool, byId, leader) });

  it('cada booster é de uma das coleções escolhidas, sorteada na hora', () => {
    expect(opened.packs).toHaveLength(SEALED_PACKS);
    expect(opened.sets).toHaveLength(SEALED_PACKS);
    opened.packs.forEach((pack, i) => {
      expect(['OP01', 'OP02']).toContain(opened.sets[i]);
      expect(pack).toHaveLength(boosterSize());
      // O booster inteiro é da coleção sorteada: as coleções não se misturam dentro dele.
      expect(pack.every((id) => id.startsWith(`${opened.sets[i]}-`))).toBe(true);
    });
    expect(openMixedBoosters(sources, 5)).toEqual(opened);
    expect(openMixedBoosters(sources, 6)).not.toEqual(opened);
  });

  it('as coleções saem em proporções parecidas, e um jogador pode abrir a mesma mais de uma vez', () => {
    const many = openMixedBoosters(sources, 99, 2000).sets;
    const share = many.filter((s) => s === 'OP01').length / many.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
    // Em 6 boosters de 2 coleções, alguma se repete; e há seeds em que uma coleção nem aparece.
    expect(new Set(opened.sets).size).toBeLessThanOrEqual(2);
    const sixes = Array.from({ length: 300 }, (_, seed) => new Set(openMixedBoosters(sources, seed).sets).size);
    expect(sixes).toContain(1);
    expect(sixes).toContain(2);
  });

  it('a chave das coleções não depende da ordem nem de maiúsculas', () => {
    expect(rushKey(['op02', 'OP01'])).toBe('OP01+OP02');
    expect(rushKey(['OP10', 'OP02', 'EB01', 'OP02'])).toBe('EB01+OP02+OP10');
    expect(rushSets('EB01+OP02+OP10')).toEqual(['EB01', 'OP02', 'OP10']);
    expect([isRush('OP01+OP02'), isRush('OP01')]).toEqual([true, false]);
    expect(rushSets('OP01')).toEqual(['OP01']);
  });

  it('vale qualquer Líder do jogo, inclusive um banido e o de 6 cores', () => {
    const errors = (leader: string) => validateLimitedDeck(deck(leader), byId, pool, rules).issues.filter((i) => i.level === 'error').map((i) => i.code);
    const outside = all.find((c) => c.category === 'leader' && c.id.startsWith('ST') && !pool.has(c.id))!;
    expect(errors(outside.id)).toEqual([]);
    expect(errors('ST10-001')).toEqual([]); // Law, banido nos formatos oficiais
    expect(errors(SEALED_LEADER_ID)).toEqual([]);
    // No Selado de uma coleção, o mesmo Líder de fora é recusado.
    expect(validateLimitedDeck(deck(outside.id), byId, pool).issues.map((i) => i.code)).toContain('rules.leaderNotInPool');
    // Continua precisando ser um Líder, e as cartas continuam saindo só dos boosters.
    const notLeader = all.find((c) => c.category === 'character')!;
    expect(errors(notLeader.id)).toEqual(['rules.notLeader']);
    const stray = all.find((c) => c.id.startsWith('ST01-') && c.category === 'character')!;
    const d = deck();
    expect(validateLimitedDeck({ ...d, cards: [{ id: stray.id, count: d.cards[0].count }, ...d.cards.slice(1)] }, byId, pool, rules).issues.map((i) => i.code)).toContain('rules.notInPool');
  });

  it('Líder de spoiler só vale se a coleção dele estiver entre as escolhidas', () => {
    const spoiler = { id: 'OP99-001', category: 'leader' as const, spoiler: { source: 'x' } as CardData['spoiler'] };
    expect(anyLeaderAllowed(spoiler, ['OP01', 'OP02'])).toBe(false);
    expect(anyLeaderAllowed(spoiler, ['OP01', 'op99'])).toBe(true);
    expect(anyLeaderAllowed({ id: 'OP01-001', category: 'leader' }, [])).toBe(true);
    expect(anyLeaderAllowed({ id: 'OP01-004', category: 'character' }, ['OP01'])).toBe(false);
    const catalog = new Map(byId).set('OP99-001', { ...byId.get('OP01-001')!, id: 'OP99-001', set: 'OP99', spoiler: spoiler.spoiler });
    expect(validateLimitedDeck(deck('OP99-001'), catalog, pool, rules).issues.map((i) => i.code)).toContain('rules.leaderSpoilerSet');
    expect(validateLimitedDeck(deck('OP99-001'), catalog, pool, { leaders: 'any', sets: ['OP01', 'OP99'] }).valid).toBe(true);
  });

  it('o rótulo da partida diz que é Pack Rush e de quais coleções', () => {
    expect(playModeLabel({ format: 'sealed', sealedSet: 'OP01+OP02' })).toBe('Pack Rush OP01 + OP02');
    expect(playModeLabel({ format: 'sealed', sealedSet: 'OP01' })).toBe('Selado OP01');
  });
});
