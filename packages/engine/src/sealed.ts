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
 * Montagem de um booster. `hits`: peso de cada raridade na vaga de "rara ou melhor". `leaderChance`:
 * chance de a última carta ser um Líder (senão, mais uma incomum). As proporções do produto real
 * mudam de coleção para coleção; este é o padrão, e uma coleção pode ter o seu.
 */
export interface BoosterModel {
  commons: number;
  uncommons: number;
  hits: Readonly<Record<'R' | 'SR' | 'SEC', number>>;
  leaderChance: number;
}

export const DEFAULT_BOOSTER: BoosterModel = { commons: 7, uncommons: 3, hits: { R: 0.8, SR: 0.17, SEC: 0.03 }, leaderChance: 1 / 3 };

/** Cartas por booster no modelo (7 comuns + 3 incomuns + 1 rara ou melhor + 1 Líder ou incomum). */
export const boosterSize = (model: BoosterModel = DEFAULT_BOOSTER): number => model.commons + model.uncommons + 2;

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

/** Se dá para abrir boosters da coleção: tem comuns, incomuns e raras o bastante, com raridade conhecida. */
export function boosterReady(setCards: readonly CardData[]): boolean {
  const s = boosterStock(setCards);
  return s.C >= BOOSTER_MIN.C && s.UC >= BOOSTER_MIN.UC && s.R >= BOOSTER_MIN.R && s.unknown * 10 <= setCards.length;
}

const holderOf = (seed: number | readonly number[]): RngHolder => (typeof seed === 'number' ? { rng: seed | 0 } : { rng: 0, rng128: seedRng128(seed) });

/** `n` cartas diferentes de `from` (ou todas, se houver menos). */
function draw(holder: RngHolder, from: readonly string[], n: number, taken: Set<string>): string[] {
  const left = from.filter((id) => !taken.has(id));
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

/** Um booster da coleção. Nenhuma carta se repete dentro dele. */
function openBooster(holder: RngHolder, src: BoosterSource, model: BoosterModel): string[] {
  const taken = new Set<string>();
  const pack = [...draw(holder, src.C, model.commons, taken), ...draw(holder, src.UC, model.uncommons, taken)];
  // Rara ou melhor, pelos pesos das raridades que a coleção tem.
  const hits = (['R', 'SR', 'SEC'] as const).filter((r) => src[r].length && model.hits[r] > 0);
  if (hits.length) {
    let roll = nextRandom(holder) * hits.reduce((n, r) => n + model.hits[r], 0);
    const rarity = hits.find((r) => (roll -= model.hits[r]) < 0) ?? hits[0];
    pack.push(...draw(holder, src[rarity], 1, taken));
  }
  // Última vaga: um Líder ou mais uma incomum.
  if (src.leaders.length && nextRandom(holder) < model.leaderChance) pack.push(...draw(holder, src.leaders, 1, taken));
  else pack.push(...draw(holder, src.UC.length > model.uncommons ? src.UC : src.any, 1, taken));
  // Coleção pequena demais para alguma vaga: completa com o que houver.
  pack.push(...draw(holder, src.any, boosterSize(model) - pack.length, taken));
  return pack;
}

/**
 * Abre `packs` boosters da coleção. `seed`: número (32 bits) ou as 4 palavras do sfc32 (o servidor
 * usa esta, com `crypto`, para ninguém prever o que sai). Dentro de um booster nenhuma carta se
 * repete; entre boosters, sim. Coleção sem carta de alguma raridade: a vaga é preenchida com a
 * raridade mais próxima.
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
 */
export function openMixedBoosters(
  sources: ReadonlyArray<{ set: string; cards: readonly CardData[] }>,
  seed: number | readonly number[],
  packs = SEALED_PACKS,
  model: BoosterModel = DEFAULT_BOOSTER,
): { sets: string[]; packs: string[][] } {
  const holder = holderOf(seed);
  const built = sources.map((s) => ({ set: s.set.toUpperCase(), src: boosterSource(s.cards) }));
  const out = { sets: [] as string[], packs: [] as string[][] };
  for (let p = 0; p < packs; p++) {
    const pick = built[Math.floor(nextRandom(holder) * built.length)];
    out.sets.push(pick.set);
    out.packs.push(openBooster(holder, pick.src, model));
  }
  return out;
}

/**
 * Boosters de um Draft: `rounds` rodadas, um booster por assento em cada uma. Com mais de uma
 * coleção (Pack Rush draft), a de cada booster é sorteada entre elas, como no Pack Rush selado.
 * Devolve `packs[rodada][assento]` e a coleção de cada um.
 */
export function openDraftBoosters(
  sources: ReadonlyArray<{ set: string; cards: readonly CardData[] }>,
  seed: number | readonly number[],
  seats: number,
  rounds: number,
  model: BoosterModel = DEFAULT_BOOSTER,
): { sets: string[][]; packs: string[][][] } {
  const holder = holderOf(seed);
  const built = sources.map((s) => ({ set: s.set.toUpperCase(), src: boosterSource(s.cards) }));
  const out = { sets: [] as string[][], packs: [] as string[][][] };
  for (let r = 0; r < rounds; r++) {
    const sets: string[] = [];
    const packs: string[][] = [];
    for (let seat = 0; seat < seats; seat++) {
      const pick = built.length === 1 ? built[0] : built[Math.floor(nextRandom(holder) * built.length)];
      sets.push(pick.set);
      packs.push(openBooster(holder, pick.src, model));
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
 * Quem pode ser o Líder. `pool` (Selado de uma coleção): os que saíram nos boosters ou o de 6
 * cores. `any` (Pack Rush e os outros modos com várias coleções): qualquer Líder do jogo; os de
 * spoiler, só se a coleção deles estiver entre as do modo (`sets`).
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
