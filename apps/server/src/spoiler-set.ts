// Próxima coleção a ser lançada: a única cujos spoilers valem nos modos "+ spoilers" fora do
// Livre (torneios, salas privadas e treinos contra o bot). Sai das datas de lançamento dos
// arquivos data/spoilers e das cartas que ainda são spoiler no banco: quando a coleção é
// lançada e as cartas viram oficiais (sincronização dos spoilers), a seguinte assume sozinha.

import { nextSpoilerSet, type PlayFormat, spoilerRule } from '@gumgum/engine';
import { join } from 'node:path';
import { type DB, spoilerSetCodes } from './db';
import { DATA_DIR } from './paths';
import { readSpoilerFiles } from './seed';

/** Datas de lançamento dos arquivos (só mudam com um deploy): lidas uma vez por pasta. */
const releases = new Map<string, Array<{ set: string; release?: string }>>();

export function currentSpoilerSet(db: DB, dir = join(DATA_DIR, 'spoilers')): string | null {
  let sets = releases.get(dir);
  if (!sets) {
    sets = readSpoilerFiles(dir).map(({ file }) => ({ set: file.set, release: file.release }));
    releases.set(dir, sets);
  }
  return nextSpoilerSet(sets, spoilerSetCodes(db));
}

/**
 * Coleção de spoiler aceita num torneio: a gravada no início (fica no histórico) ou, antes
 * disso, a próxima a ser lançada agora. null = o torneio não aceita spoilers só de uma coleção
 * (sem spoilers ou Livre) ou não há coleção de spoiler.
 */
export function tournamentSpoilerSet(
  db: DB,
  t: { format: PlayFormat; spoilers: boolean; spoilerSet?: string | null; status?: string },
): string | null {
  if (spoilerRule(t) !== 'next') return null;
  if (t.spoilerSet) return t.spoilerSet;
  // Torneios começados antes de a coleção ser gravada: não dá para saber qual era.
  return t.status === 'running' || t.status === 'finished' ? null : currentSpoilerSet(db);
}
