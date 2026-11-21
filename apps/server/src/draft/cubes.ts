// Os Cubos publicados: um arquivo por temporada em `data/cubes/<id>.json`, gerado por
// `npm run cube:build` (cube-cli.ts) e editável à mão. O Cubo em uso é o de publicação mais recente.
//
// O arquivo guarda só os ids e o uso de cada carta. Ao carregar, o servidor fica com as cartas que
// existem no banco dele e que podem estar num Cubo (`cubeEligible`): uma carta que saiu do banco
// ou perdeu a automação some da lista sem quebrar o arquivo.

import { type CardData, cubeCardsNeeded, cubeEligible, cubeIdOf, cubeKey, DRAFT_ROUNDS, DRAFT_SEATS } from '@gumgum/engine';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DB, getCards } from '../db';
import { DATA_DIR } from '../paths';

export interface CubeFile {
  /** "T1": vai na chave do modo ("CUBE:T1") e no nome do arquivo. */
  id: string;
  name: string;
  /** Data de publicação (AAAA-MM-DD): o Cubo em uso é o mais recente. */
  publishedAt: string;
  /** De onde saiu o uso das cartas. */
  source: { name: string; url: string; tournaments: number; decks: number; from: string; to: string };
  perColor: number;
  /** `usage`: a nota que pôs a carta na lista (0 a 1); `decks`: decks com a carta na amostra. */
  cards: Array<{ id: string; usage: number; decks: number }>;
}

export interface Cube {
  key: string;
  file: CubeFile;
  /** As cartas da lista que este servidor tem e pode usar, na ordem do arquivo. */
  cards: string[];
  usage: Map<string, number>;
}

const isCubeFile = (v: unknown): v is CubeFile => {
  const f = v as CubeFile;
  return Boolean(f && typeof f.id === 'string' && /^[A-Za-z0-9]{1,12}$/.test(f.id) && typeof f.name === 'string' && typeof f.publishedAt === 'string' && Array.isArray(f.cards));
};

/** Os arquivos de `data/cubes`, do mais recente para o mais antigo (arquivo ilegível fica de fora). */
export function readCubeFiles(dir = join(DATA_DIR, 'cubes')): CubeFile[] {
  if (!existsSync(dir)) return [];
  const files: CubeFile[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
      if (isCubeFile(file)) files.push(file);
    } catch {
      /* arquivo ilegível */
    }
  }
  return files.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
}

let memo: { at: number; db: DB; cubes: Cube[] } | null = null;
const TTL_MS = 60_000;
let cubeDir: string | undefined;

/** Troca a pasta dos Cubos (testes); sem argumento, volta para `data/cubes`. */
export function setCubeDir(dir?: string) {
  cubeDir = dir;
  memo = null;
}

/** Os Cubos que dá para draftar neste servidor (com cartas para um pod inteiro), o mais recente primeiro. */
export function cubes(db: DB, now = Date.now()): Cube[] {
  if (memo && memo.db === db && now - memo.at < TTL_MS) return memo.cubes;
  const list: Cube[] = [];
  for (const file of readCubeFiles(cubeDir)) {
    const ids = [...new Set(file.cards.map((c) => c.id))];
    const known = new Map((getCards(db, ids) as CardData[]).map((c) => [c.id, c]));
    const cards = ids.filter((id) => known.has(id) && cubeEligible(known.get(id)!));
    if (cards.length < cubeCardsNeeded(DRAFT_SEATS, DRAFT_ROUNDS)) continue;
    list.push({ key: cubeKey(file.id), file, cards, usage: new Map(file.cards.map((c) => [c.id, c.usage])) });
  }
  memo = { at: now, db, cubes: list };
  return list;
}

export const currentCube = (db: DB): Cube | null => cubes(db)[0] ?? null;
export const cubeByKey = (db: DB, key: string): Cube | null => cubes(db).find((c) => c.file.id.toUpperCase() === cubeIdOf(key).toUpperCase()) ?? null;

/** Esquece os Cubos lidos (testes e depois de publicar um arquivo novo). */
export const forgetCubes = () => {
  memo = null;
};
