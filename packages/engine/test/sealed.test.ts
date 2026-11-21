import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actingPlayer } from '../src/actions';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef, needsManual } from '../src/cards';
import { validateDeck } from '../src/deck';
import { applyAction, createGame, hasName, hasType, LIMITED_DECK_SIZE } from '../src/engine';
import { cardLegality, formatIssues, formatLabel, playMode, playModeLabel, rarityCode, SEALED_LEADER_ID, spoilerRule } from '../src/formats';
import {
  autoBuildLimited,
  boosterCards,
  boosterReady,
  boosterSize,
  boosterStock,
  isBoosterSet,
  openBoosters,
  poolCounts,
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

  it('6 boosters de 12: 7 comuns, 3 incomuns, 1 rara ou melhor e 1 Líder ou incomum, sem repetir carta no booster', () => {
    const packs = openBoosters(op01, 42);
    expect(packs).toHaveLength(SEALED_PACKS);
    for (const pack of packs) {
      expect(pack).toHaveLength(boosterSize());
      expect(new Set(pack).size).toBe(pack.length);
      expect(pack.every((id) => id.startsWith('OP01-'))).toBe(true);
      const cards = pack.filter((id) => !isLeader(id));
      expect(cards.filter((id) => rarity(id) === 'C')).toHaveLength(7);
      expect(cards.filter((id) => ['R', 'SR', 'SEC'].includes(rarity(id)!))).toHaveLength(1);
      // A última vaga é um Líder ou mais uma incomum.
      const leaders = pack.filter(isLeader).length;
      expect(leaders).toBeLessThanOrEqual(1);
      expect(cards.filter((id) => rarity(id) === 'UC')).toHaveLength(leaders ? 3 : 4);
    }
  });

  it('a mesma seed abre os mesmos boosters; outra seed, outros (também com a seed de 128 bits do servidor)', () => {
    expect(openBoosters(op01, 7)).toEqual(openBoosters(op01, 7));
    expect(openBoosters(op01, 7)).not.toEqual(openBoosters(op01, 8));
    const words = [1, 2, 3, 4];
    expect(openBoosters(op01, words)).toEqual(openBoosters(op01, [1, 2, 3, 4]));
    expect(openBoosters(op01, words)).not.toEqual(openBoosters(op01, [1, 2, 3, 5]));
  });

  it('as raridades saem perto dos pesos: a maioria rara, algumas SR e poucas SEC; Líder em cerca de 1 a cada 3', () => {
    const packs = openBoosters(op01, 2026, 3000);
    const hits = packs.map((p) => p.find((id) => !isLeader(id) && ['R', 'SR', 'SEC'].includes(rarity(id)!))!).map(rarity);
    const share = (r: string) => hits.filter((x) => x === r).length / hits.length;
    expect(share('R')).toBeGreaterThan(0.75);
    expect(share('R')).toBeLessThan(0.85);
    expect(share('SR')).toBeGreaterThan(0.13);
    expect(share('SEC')).toBeGreaterThan(0.01);
    expect(share('SEC')).toBeLessThan(0.06);
    const withLeader = packs.filter((p) => p.some(isLeader)).length / packs.length;
    expect(withLeader).toBeGreaterThan(0.28);
    expect(withLeader).toBeLessThan(0.39);
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
    // As outras cartas continuam com o que têm impresso.
    const zoro = buildCardDef(byId.get('OP01-001')!);
    expect(zoro.wild).toBeUndefined();
    expect([hasType(zoro, 'Straw Hat Crew'), hasType(zoro, 'Navy'), hasName(zoro, 'Kaido')]).toEqual([true, false, false]);
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
