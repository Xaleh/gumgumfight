// Selado: o deck sai dos boosters que o jogador abre.
//
// Regras (eventos Sealed Battle da Bandai, mais as escolhas do GumGum Fight):
//  - cada jogador abre 6 boosters de uma coleção e monta um deck de 40 cartas + 1 Líder;
//  - a cor do Líder não limita o deck e não há limite de cópias: vale o que saiu;
//  - o Líder é um dos que saíram nos boosters ou o Luffy de 6 cores, que todo jogador tem;
//  - não há lista de banidas, pares proibidos nem rotação (`formats.ts`, formato `sealed`).
//
// Pack Rush é o mesmo Selado com várias coleções: cada um dos 6 boosters é sorteado entre as
// coleções escolhidas por quem abre, e o Líder pode ser qualquer Líder do jogo (`leaders: 'any'`).
//
// Tudo aqui é função pura. O sorteio usa o RNG com seed do motor: a mesma seed abre os mesmos
// boosters, então o servidor grava a seed e as cartas, e o navegador só revela.

import { needsManual } from './cards';
import { type DeckIssue, type DeckReport, deckSize, leaderRuleBroken } from './deck';
import { LIMITED_DECK_SIZE } from './engine';
import { rarityCode, type RuleParams, SEALED_LEADER_ID } from './formats';
import { nextRandom, type RngHolder, seedRng128 } from './rng';
import type { CardData, DeckList } from './types';

/** Boosters por jogador no Selado. */
export const SEALED_PACKS = 6;

/**
 * Montagem de um booster: as vagas fixas (comuns, incomuns, raras) e uma vaga de destaque, que é
 * uma SR ou uma SEC com as chances de `hits` e, no resto das vezes, uma rara. `leaderChance`:
 * chance de o booster trazer um Líder, que entra no lugar de uma comum.
 *
 * A Bandai não publica as taxas; os números vêm de aberturas de caixas registradas pela comunidade
 * (caixa em inglês de 24 boosters; as fontes estão no README), por isso aparecem como "tantos por
 * caixa" divididos por 24. As artes alternativas contam como a carta que são (a de uma SR é uma SR).
 * O DON!! que vem em alguns boosters não é carta de deck: no lugar dele entra uma comum (OP01 a
 * OP03, um por booster) ou uma rara (o DON!! de arte alternativa, 2 por caixa nos boosters de hoje).
 */
export interface BoosterModel {
  commons: number;
  uncommons: number;
  rares: number;
  /** Chance de a vaga de destaque de um booster ser uma SR e de ser uma SEC (0 a 1). */
  hits: Readonly<Record<'SR' | 'SEC', number>>;
  leaderChance: number;
  /** Booster com Líder tem sempre uma rara na vaga de destaque (os de hoje: Líder e SR não saem juntos). */
  leaderTakesHit: boolean;
  /** Teto da chance de Líder por Líder que a coleção tem (Extra Booster com um Líder só traz poucos por caixa). */
  leaderChancePerLeader?: number;
}

/**
 * Booster principal de hoje (OP04 em diante), por caixa de 24: 8 com Líder (mais 1 a cada 3 caixas com
 * o Líder de arte alternativa), 7 com SR, 2 SEC a cada 3 caixas e 4 artes alternativas a cada 3
 * caixas (repartidas aqui em 60% SR, 30% R, 10% SEC); os outros trazem duas raras.
 */
const MAIN_BOOSTER: BoosterModel = { commons: 7, uncommons: 3, rares: 1, hits: { SR: 7.8 / 24, SEC: 0.8 / 24 }, leaderChance: 8.33 / 24, leaderTakesHit: true };
/**
 * Booster das primeiras coleções (OP01 a OP03): 7 comuns, 3 incomuns, uma vaga de destaque e um
 * DON!! (aqui, a oitava comum). 7 SR por caixa e cerca de um destaque (SEC ou arte alternativa).
 */
const EARLY_BOOSTER: BoosterModel = { commons: 8, uncommons: 3, rares: 0, hits: { SR: 7.3 / 24, SEC: 0.55 / 24 }, leaderChance: 8 / 24, leaderTakesHit: false };
/**
 * Extra Booster (EB): não tem incomuns. Por caixa: 6 SR, perto de 2 artes alternativas e 1 SEC a
 * cada 2 caixas. Líder: 2 por caixa para cada Líder da coleção (EB01, com 3 Líderes, traz 6).
 */
const EXTRA_BOOSTER: BoosterModel = { commons: 10, uncommons: 0, rares: 1, hits: { SR: 7.2 / 24, SEC: 0.7 / 24 }, leaderChance: 6 / 24, leaderTakesHit: true, leaderChancePerLeader: 2 / 24 };

export const BOOSTER_MODELS = { main: MAIN_BOOSTER, early: EARLY_BOOSTER, extra: EXTRA_BOOSTER } as const;
export const DEFAULT_BOOSTER: BoosterModel = MAIN_BOOSTER;

/** O modelo do booster de uma coleção: Extra Booster, as três primeiras coleções ou o booster principal de hoje. */
export function boosterModelOf(set: string): BoosterModel {
  const code = set.toUpperCase();
  if (code.startsWith('EB')) return EXTRA_BOOSTER;
  if (/^OP0?[123]$/.test(code)) return EARLY_BOOSTER;
  return MAIN_BOOSTER;
}

/** Cartas por booster no modelo (as vagas fixas e a de destaque; o Líder entra no lugar de uma comum). */
export const boosterSize = (model: BoosterModel = DEFAULT_BOOSTER): number => model.commons + model.uncommons + model.rares + 1;

/** A chance de Líder de um booster numa coleção com `leaders` Líderes. */
const leaderChanceOf = (model: BoosterModel, leaders: number): number =>
  leaders ? Math.min(model.leaderChance, model.leaderChancePerLeader === undefined ? 1 : model.leaderChancePerLeader * leaders) : 0;

/**
 * As chances de um booster, para mostrar ao jogador: de trazer uma SR, uma SEC e um Líder (0 a 1).
 * `leaders`: quantos Líderes a coleção tem.
 */
export function boosterOdds(model: BoosterModel = DEFAULT_BOOSTER, leaders = 1): { SR: number; SEC: number; leader: number } {
  return { SR: model.hits.SR, SEC: model.hits.SEC, leader: leaderChanceOf(model, leaders) };
}

/** Coleções vendidas em booster (OP, EB e PRB): starters e promos não têm booster. */
export const isBoosterSet = (set: string): boolean => /^(OP|EB|PRB)\d+$/i.test(set);

const setOf = (c: Pick<CardData, 'id' | 'set'>) => (c.set ?? c.id.split('-')[0]).toUpperCase();

/** As cartas de uma coleção que saem nos boosters dela (sem o Líder de 6 cores). */
export function boosterCards(cards: Iterable<CardData>, set: string): CardData[] {
  const code = set.toUpperCase();
  return [...cards].filter((c) => c.id !== SEALED_LEADER_ID && setOf(c) === code).sort((a, b) => a.id.localeCompare(b.id));
}

/** Quantas cartas de cada raridade a coleção tem no banco (Líderes à parte). */
export interface BoosterStock {
  C: number;
  UC: number;
  R: number;
  SR: number;
  SEC: number;
  leaders: number;
  /** Cartas fora dos Líderes sem raridade conhecida: não saem em booster. */
  unknown: number;
}

export function boosterStock(setCards: readonly CardData[]): BoosterStock {
  const stock: BoosterStock = { C: 0, UC: 0, R: 0, SR: 0, SEC: 0, leaders: 0, unknown: 0 };
  for (const c of setCards) {
    if (c.category === 'leader') stock.leaders++;
    else {
      const r = rarityCode(c.rarity);
      if (r === 'C' || r === 'UC' || r === 'R' || r === 'SR' || r === 'SEC') stock[r]++;
      else stock.unknown++;
    }
  }
  return stock;
}

/** Mínimo de cartas para a coleção entrar no Selado: abaixo disso ela está incompleta no banco. */
export const BOOSTER_MIN = { C: 20, UC: 10, R: 5 } as const;

/**
 * Se dá para abrir boosters da coleção: tem comuns, raras e (quando o booster dela leva incomuns)
 * incomuns o bastante, com raridade conhecida.
 */
export function boosterReady(setCards: readonly CardData[], model: BoosterModel = DEFAULT_BOOSTER): boolean {
  const s = boosterStock(setCards);
  return s.C >= BOOSTER_MIN.C && (model.uncommons === 0 || s.UC >= BOOSTER_MIN.UC) && s.R >= BOOSTER_MIN.R && s.unknown * 10 <= setCards.length;
}

/** O RNG de um sorteio a partir da seed: um número (32 bits) ou as 4 palavras do sfc32. */
export const holderOf = (seed: number | readonly number[]): RngHolder => (typeof seed === 'number' ? { rng: seed | 0 } : { rng: 0, rng128: seedRng128(seed) });

/** `n` cartas diferentes de `from` (ou todas, se houver menos). Uma lista com o mesmo id duas vezes conta uma. */
function draw(holder: RngHolder, from: readonly string[], n: number, taken: Set<string>): string[] {
  const left = [...new Set(from)].filter((id) => !taken.has(id));
  const out: string[] = [];
  while (out.length < n && left.length) {
    const [id] = left.splice(Math.floor(nextRandom(holder) * left.length), 1);
    out.push(id);
    taken.add(id);
  }
  return out;
}

/** As cartas de uma coleção separadas por vaga do booster. */
interface BoosterSource {
  C: string[];
  UC: string[];
  R: string[];
  SR: string[];
  SEC: string[];
  leaders: string[];
  any: string[];
}

function boosterSource(setCards: readonly CardData[]): BoosterSource {
  const by = (r: string) => setCards.filter((c) => c.category !== 'leader' && rarityCode(c.rarity) === r).map((c) => c.id);
  const src = { C: by('C'), UC: by('UC'), R: by('R'), SR: by('SR'), SEC: by('SEC') };
  return { ...src, leaders: setCards.filter((c) => c.category === 'leader').map((c) => c.id), any: [...src.C, ...src.UC, ...src.R] };
}

/**
 * Um booster da coleção. Nenhuma carta se repete dentro dele. `leaders: false` (Draft de Pack Rush,
 * em que vale qualquer Líder do jogo): o booster não traz Líder, e a carta que ele tiraria do lugar fica.
 */
function openBooster(holder: RngHolder, src: BoosterSource, model: BoosterModel, leaders = true): string[] {
  const taken = new Set<string>();
  // Um sorteio decide o booster. Nos de hoje, Líder, SR e SEC são fatias separadas dele (não saem
  // juntos); nos das primeiras coleções, o Líder é sorteado à parte da vaga de destaque.
  const chance = leaders ? leaderChanceOf(model, src.leaders.length) : 0;
  const roll = nextRandom(holder);
  const leader = model.leaderTakesHit ? roll < chance : nextRandom(holder) < chance;
  const at = model.leaderTakesHit ? roll - chance : roll;
  // Coleção sem SEC: a fatia dela vira SR; sem SR, rara.
  const wanted = leader && model.leaderTakesHit ? 'R' : at < model.hits.SEC ? 'SEC' : at < model.hits.SEC + model.hits.SR ? 'SR' : 'R';
  const rarity = wanted === 'SEC' && !src.SEC.length ? (src.SR.length ? 'SR' : 'R') : wanted === 'SR' && !src.SR.length ? 'R' : wanted;
  const pack = [
    ...draw(holder, src.C, model.commons - (leader ? 1 : 0), taken),
    ...draw(holder, src.UC, model.uncommons, taken),
    ...draw(holder, src.R, model.rares, taken),
  ];
  // A vaga de destaque.
  pack.push(...draw(holder, src[rarity], 1, taken));
  if (leader) pack.push(...draw(holder, src.leaders, 1, taken));
  // Coleção pequena demais para alguma vaga: completa com o que houver.
  pack.push(...draw(holder, src.any, boosterSize(model) - pack.length, taken));
  return pack;
}

/**
 * Abre `packs` boosters da coleção. `seed`: número (32 bits) ou as 4 palavras do sfc32 (o servidor
 * usa esta, com `crypto`, para ninguém prever o que sai). Dentro de um booster nenhuma carta se
 * repete; entre boosters, sim. Coleção sem carta de alguma raridade: a vaga é preenchida com a
 * raridade mais próxima. `model`: o booster da coleção (`boosterModelOf`).
 */
export function openBoosters(setCards: readonly CardData[], seed: number | readonly number[], packs = SEALED_PACKS, model: BoosterModel = DEFAULT_BOOSTER): string[][] {
  const holder = holderOf(seed);
  const src = boosterSource(setCards);
  return Array.from({ length: packs }, () => openBooster(holder, src, model));
}

/** Coleções de um Pack Rush: no mínimo duas (com uma só é o Selado comum) e um teto para a lista caber na tela. */
export const RUSH_MIN_SETS = 2;
export const RUSH_MAX_SETS = 12;

/**
 * Pack Rush: cada booster é de uma das coleções de `sources`, sorteada na hora (a mesma coleção
 * pode sair mais de uma vez, e alguma pode não sair). Devolve os boosters e a coleção de cada um.
 * Os boosters trazem Líder como os de uma coleção só: no Pack Rush selado o Líder do deck é um dos
 * que saírem (ou o de 6 cores).
 */
export function openMixedBoosters(
  sources: ReadonlyArray<{ set: string; cards: readonly CardData[] }>,
  seed: number | readonly number[],
  packs = SEALED_PACKS,
  model?: BoosterModel,
): { sets: string[]; packs: string[][] } {
  const holder = holderOf(seed);
  const built = sources.map((s) => ({ set: s.set.toUpperCase(), src: boosterSource(s.cards), model: model ?? boosterModelOf(s.set) }));
  const out = { sets: [] as string[], packs: [] as string[][] };
  for (let p = 0; p < packs; p++) {
    const pick = built[Math.floor(nextRandom(holder) * built.length)];
    out.sets.push(pick.set);
    out.packs.push(openBooster(holder, pick.src, pick.model));
  }
  return out;
}

/**
 * Boosters de um Draft: `rounds` rodadas, um booster por assento em cada uma. Com mais de uma
 * coleção (Pack Rush draft), a de cada booster é sorteada entre elas e nenhum traz Líder: nesse
 * draft vale qualquer Líder do jogo, então a vaga fica com outra carta da coleção. Devolve
 * `packs[rodada][assento]` e a coleção de cada um.
 */
export function openDraftBoosters(
  sources: ReadonlyArray<{ set: string; cards: readonly CardData[] }>,
  seed: number | readonly number[],
  seats: number,
  rounds: number,
  model?: BoosterModel,
): { sets: string[][]; packs: string[][][] } {
  const holder = holderOf(seed);
  const built = sources.map((s) => ({ set: s.set.toUpperCase(), src: boosterSource(s.cards), model: model ?? boosterModelOf(s.set) }));
  const out = { sets: [] as string[][], packs: [] as string[][][] };
  for (let r = 0; r < rounds; r++) {
    const sets: string[] = [];
    const packs: string[][] = [];
    for (let seat = 0; seat < seats; seat++) {
      const pick = built.length === 1 ? built[0] : built[Math.floor(nextRandom(holder) * built.length)];
      sets.push(pick.set);
      packs.push(openBooster(holder, pick.src, pick.model, built.length < 2));
    }
    out.sets.push(sets);
    out.packs.push(packs);
  }
  return out;
}

/** Chave das coleções de um Pack Rush ("OP01+OP05+EB02"): em ordem, para duas escolhas iguais darem a mesma. */
export const rushKey = (sets: readonly string[]): string => [...new Set(sets.map((s) => s.toUpperCase()))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join('+');
/** As coleções de uma chave; uma só = Selado comum. */
export const rushSets = (key: string): string[] => key.split('+').filter(Boolean);
export const isRush = (key: string): boolean => key.includes('+');

/** Quantas cópias de cada carta o jogador abriu. */
export function poolCounts(packs: ReadonlyArray<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of packs.flat()) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

type Catalog = ReadonlyMap<string, CardData> | Readonly<Record<string, CardData>>;
const getter = (cards: Catalog) => (id: string) => (cards instanceof Map ? cards.get(id) : (cards as Readonly<Record<string, CardData>>)[id]);

/** Líderes que o jogador pode usar: os que saíram nos boosters e o Luffy de 6 cores, sempre. */
export function sealedLeaders(pool: ReadonlyMap<string, number>, cards: Catalog): string[] {
  const get = getter(cards);
  return [...[...pool.keys()].filter((id) => get(id)?.category === 'leader').sort(), SEALED_LEADER_ID];
}

/**
 * Quem pode ser o Líder. `pool` (Selado, de uma coleção ou Pack Rush, e Draft de uma coleção): os
 * que saíram nos boosters ou o de 6 cores. `any` (Draft de Pack Rush e Draft Cubo): qualquer Líder
 * do jogo; os de spoiler, só se a coleção deles estiver entre as do modo (`sets`). O Líder de 6
 * cores vale em todos.
 */
export interface LimitedRules {
  leaders?: 'pool' | 'any';
  sets?: readonly string[];
}

/** Se o Líder vale num modo de qualquer Líder (`LimitedRules.leaders: 'any'`). */
export function anyLeaderAllowed(leader: Pick<CardData, 'id' | 'set' | 'category' | 'spoiler'>, sets: readonly string[] = []): boolean {
  return leader.category === 'leader' && (!leader.spoiler || sets.map((s) => s.toUpperCase()).includes(setOf(leader)));
}

/**
 * Confere um deck do Selado contra as cartas que o jogador abriu (`pool`): 1 Líder (dos que
 * saíram, ou o de 6 cores; no Pack Rush, qualquer um), exatamente 40 cartas e nenhuma carta além
 * das cópias abertas. A cor do Líder não limita o deck e não há limite de cópias. As regras de
 * deck escritas no próprio Líder ("you cannot include cards with a cost of 5 or more") continuam valendo.
 */
export function validateLimitedDeck(deck: DeckList, cards: Catalog, pool: ReadonlyMap<string, number>, rules: LimitedRules = {}): DeckReport {
  const get = getter(cards);
  const issues: DeckIssue[] = [];
  const unscripted = new Set<string>();
  const total = deckSize(deck);
  const error = (message: string, code: string, params: RuleParams = {}, cardId?: string) =>
    issues.push({ level: 'error', message, code: `rules.${code}`, params, ...(cardId ? { cardId } : {}) });

  const leader = deck.leader ? get(deck.leader) : undefined;
  if (!deck.leader) error('Escolha um Líder.', 'pickLeader');
  else if (!leader) error(`Líder desconhecido: ${deck.leader}.`, 'unknownLeader', { id: deck.leader }, deck.leader);
  else if (leader.category !== 'leader') error(`${leader.name} não é um Líder.`, 'notLeader', { name: leader.name }, leader.id);
  else {
    if (rules.leaders === 'any') {
      if (!anyLeaderAllowed(leader, rules.sets)) {
        error(`${leader.name} ainda não foi lançado e a coleção dele não está neste Pack Rush.`, 'leaderSpoilerSet', { name: leader.name }, leader.id);
      }
    } else if (leader.id !== SEALED_LEADER_ID && !pool.has(leader.id)) {
      error(`${leader.name} não saiu nos seus boosters: use um Líder que saiu ou o Luffy de 6 cores.`, 'leaderNotInPool', { name: leader.name }, leader.id);
    }
    if (needsManual(leader)) unscripted.add(leader.id);
  }

  if (total < LIMITED_DECK_SIZE) {
    error(`O deck tem ${total} cartas; faltam ${LIMITED_DECK_SIZE - total}.`, 'tooFewCards', { total, missing: LIMITED_DECK_SIZE - total });
  } else if (total > LIMITED_DECK_SIZE) {
    error(`O deck tem ${total} cartas; sobram ${total - LIMITED_DECK_SIZE}.`, 'tooManyCards', { total, extra: total - LIMITED_DECK_SIZE });
  }

  const counts = new Map<string, number>();
  for (const entry of deck.cards) counts.set(entry.id, (counts.get(entry.id) ?? 0) + entry.count);
  for (const [id, count] of counts) {
    const card = get(id);
    if (!card) {
      error(`Carta desconhecida: ${id}.`, 'unknownCard', { id }, id);
      continue;
    }
    const name = card.name;
    if (count < 1 || !Number.isInteger(count)) error(`Quantidade inválida de ${name}.`, 'badCount', { name }, id);
    if (card.category === 'leader') error(`${name} é um Líder e não pode ir no deck.`, 'leaderInDeck', { name }, id);
    const have = pool.get(id) ?? 0;
    if (count > have) {
      error(
        have ? `${name} (${id}): você abriu ${have} e o deck tem ${count}.` : `${name} (${id}) não saiu nos seus boosters.`,
        have ? 'poolCopies' : 'notInPool',
        { name, id, have, count },
        id,
      );
    }
    const broken = leader?.category === 'leader' ? leaderRuleBroken(leader, card) : undefined;
    if (broken?.kind === 'deckMaxCost') {
      const events = broken.category === 'event';
      error(
        `${name} (${id}): o Líder não permite ${events ? 'Eventos' : 'cartas'} com custo ${broken.cost + 1} ou mais.`,
        events ? 'leaderMaxCostEvents' : 'leaderMaxCost',
        { name, id, cost: broken.cost + 1 },
        id,
      );
    } else if (broken?.kind === 'deckOnlyType') {
      error(`${name} (${id}): o Líder só permite cartas do tipo {${broken.type}}.`, 'leaderOnlyType', { name, id, type: broken.type }, id);
    }
    if (needsManual(card)) unscripted.add(id);
  }

  if (unscripted.size) {
    const n = unscripted.size;
    issues.push({
      level: 'warning',
      message: `${n} carta${n > 1 ? 's' : ''} com efeito ainda não automatizado (aplicado à mão, com as ferramentas manuais).`,
      code: 'rules.unscripted',
      params: { n },
    });
  }
  return { valid: !issues.some((i) => i.level === 'error'), total, issues, unscripted: [...unscripted] };
}

// ---------------------------------------------------------------------------
// Montagem automática ("Montar sozinho" e o deck do bot)
// ---------------------------------------------------------------------------

const KEYWORD_BONUS: Array<[RegExp, number]> = [
  [/\[Blocker\]/i, 1.5],
  [/\[Rush\]/i, 1.5],
  [/\[Double Attack\]/i, 1],
  [/\[On Play\]/i, 1],
  [/\[Trigger\]/i, 0.5],
];

/** Nota de uma carta para um deck de Selado: corpo pelo custo, Counter, palavras-chave e efeito automatizado. */
export function limitedScore(card: CardData): number {
  const cost = card.cost ?? 0;
  const text = `${card.text ?? ''} ${card.trigger ?? ''}`;
  let score = KEYWORD_BONUS.reduce((n, [re, bonus]) => n + (re.test(text) ? bonus : 0), 0);
  if (card.category === 'character') score += (card.power ?? 0) / 1000 - cost * 0.9 + (card.counter ?? 0) / 1000 + 3;
  // Eventos: os de [Counter] seguram a mesa de quem tem poucos Counters; os baratos cabem em qualquer curva.
  else if (card.category === 'event') score += (/\[Counter\]/i.test(text) ? 6 : 4.5) + (cost <= 2 ? 0.5 : 0);
  else score += 0.5;
  if (text.trim()) score += 0.5;
  // Efeito aplicado à mão atrapalha a partida (e o bot não o usa).
  if (needsManual(card)) score -= 3;
  return score;
}

/** Quantas cartas o deck quer de cada faixa de custo (somam 40). */
const CURVE: Array<{ max: number; want: number }> = [
  { max: 2, want: 13 },
  { max: 4, want: 15 },
  { max: 6, want: 8 },
  { max: Infinity, want: 4 },
];
/** Tetos de cartas que não são Personagem: num deck de Selado, corpo na mesa vale mais. */
const MAX_EVENTS = 5;
const MAX_STAGES = 1;

/**
 * Monta um deck jogável com o que o jogador abriu: o Líder de mais Vida entre os que saíram (ou o
 * de 6 cores) e as 40 melhores cartas, respeitando uma curva de custo. Com menos de 40 cartas
 * válidas na coleção, devolve o que deu (o chamador confere com `validateLimitedDeck`).
 */
export function autoBuildLimited(pool: ReadonlyMap<string, number>, cards: Catalog, leader?: string): Pick<DeckList, 'leader' | 'cards'> {
  const get = getter(cards);
  const own = [...pool.keys()].map(get).filter((c): c is CardData => Boolean(c));
  const pickLeader = () =>
    own
      .filter((c) => c.category === 'leader' && !needsManual(c))
      .sort((a, b) => (b.life ?? 0) - (a.life ?? 0) || a.id.localeCompare(b.id))[0]?.id ?? SEALED_LEADER_ID;
  const leaderId = leader ?? pickLeader();
  const leaderCard = get(leaderId);

  // Uma entrada por cópia, da melhor para a pior (desempate pelo número, para o resultado ser estável).
  const copies = own
    .filter((c) => c.category !== 'leader' && !(leaderCard && leaderRuleBroken(leaderCard, c)))
    .flatMap((c) => Array.from({ length: pool.get(c.id) ?? 0 }, () => c))
    .map((c) => ({ c, score: limitedScore(c) }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  const chosen = new Map<string, number>();
  const used = new Set<number>();
  let events = 0;
  let stages = 0;
  let size = 0;
  const fits = (c: CardData) => (c.category === 'event' ? events < MAX_EVENTS : c.category === 'stage' ? stages < MAX_STAGES : true);
  const take = (i: number) => {
    const { c } = copies[i];
    used.add(i);
    chosen.set(c.id, (chosen.get(c.id) ?? 0) + 1);
    if (c.category === 'event') events++;
    if (c.category === 'stage') stages++;
    size++;
  };
  // 1) Cada faixa de custo pega as melhores dela. 2) O que faltar sai das melhores que sobraram.
  let min = -Infinity;
  for (const band of CURVE) {
    let got = 0;
    for (let i = 0; i < copies.length && got < band.want; i++) {
      const cost = copies[i].c.cost ?? 0;
      if (used.has(i) || cost <= min || cost > band.max || !fits(copies[i].c)) continue;
      take(i);
      got++;
    }
    min = band.max;
  }
  for (const strict of [true, false]) {
    for (let i = 0; i < copies.length && size < LIMITED_DECK_SIZE; i++) {
      if (!used.has(i) && (!strict || fits(copies[i].c))) take(i);
    }
  }
  return { leader: leaderId, cards: [...chosen].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id)) };
}
