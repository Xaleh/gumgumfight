// Fontes das cartas e a ordem de prioridade de cada cadeia (deploy.env):
//   CARD_SOURCES=cardkaizoku,optcgapi       cartas lançadas (padrão: optcgapi)
//   SPOILER_SOURCES=cardkaizoku,optcgleaks  coleções anunciadas (padrão: optcgleaks)
// Como a cadeia junta as fontes: chain.ts.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FetchJson } from '../card-import';
import { type DB, upsertCards } from '../db';
import { DB_PATH } from '../paths';
import { cardkaizokuSource } from './cardkaizoku';
import type { CardSource, ChainReport, ResolvedCard, SourceKind } from './chain';
import { optcgapiSource } from './optcgapi';
import { optcgleaksSource } from './optcgleaks';

export * from './chain';

export const DEFAULT_CHAINS: Record<SourceKind, string[]> = { official: ['optcgapi'], spoiler: ['optcgleaks'] };
const ENV_NAMES: Record<SourceKind, string> = { official: 'CARD_SOURCES', spoiler: 'SPOILER_SOURCES' };

export interface ChainContext {
  /** Endereço da optcgapi (CARD_API_BASE). */
  base: string;
  fetchJson: FetchJson;
  /** Respostas da optcgapi salvas em arquivo (cards:import --file). */
  files?: string[];
  onBody?: (label: string, entries: number) => void;
}

const FACTORIES: Record<string, { kinds: SourceKind[]; make: (ctx: ChainContext) => CardSource }> = {
  optcgapi: { kinds: ['official'], make: (ctx) => optcgapiSource(ctx) },
  cardkaizoku: { kinds: ['official', 'spoiler'], make: (ctx) => cardkaizokuSource(ctx.fetchJson) },
  optcgleaks: { kinds: ['spoiler'], make: (ctx) => optcgleaksSource(ctx.fetchJson) },
};
/** Fontes previstas e ainda sem adaptador. */
const PLANNED = ['sweetapp'];

/** Nomes da cadeia lidos do ambiente; nomes desconhecidos viram aviso e, sem nenhum válido, vale o padrão. */
export function chainNames(kind: SourceKind, env: NodeJS.ProcessEnv = process.env): { names: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const names: string[] = [];
  for (const name of (env[ENV_NAMES[kind]] ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    const factory = FACTORIES[name];
    if (!factory) warnings.push(PLANNED.includes(name) ? `${name}: fonte ainda não disponível` : `${name}: fonte desconhecida`);
    else if (!factory.kinds.includes(kind)) warnings.push(`${name}: não serve para ${ENV_NAMES[kind]}`);
    else if (!names.includes(name)) names.push(name);
  }
  if (warnings.length) warnings.unshift(`${ENV_NAMES[kind]}=${env[ENV_NAMES[kind]]}`);
  return { names: names.length ? names : DEFAULT_CHAINS[kind], warnings };
}

/** As fontes da cadeia, na ordem. `cache` reaproveita a mesma fonte entre as cadeias de uma rodada. */
export function buildChain(names: string[], ctx: ChainContext, cache = new Map<string, CardSource>()): CardSource[] {
  return names.map((name) => {
    let source = cache.get(name);
    if (!source) cache.set(name, (source = FACTORIES[name].make(ctx)));
    return source;
  });
}

/** Grava as cartas resolvidas como oficiais, cada uma com a sua fonte vencedora. */
export function writeOfficial(db: DB, resolved: ResolvedCard[]): number {
  const bySource = new Map<CardSource, ResolvedCard[]>();
  for (const r of resolved) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  let written = 0;
  for (const [source, list] of bySource) {
    const raw = new Map(list.filter((r) => r.raw !== undefined).map((r) => [r.card.id, r.raw]));
    written += upsertCards(db, list.map((r) => r.card), { provisional: false, source: `api:${source.host}`, raw }).written;
  }
  return written;
}

/** Arquivo do relatório de divergências, ao lado do banco. */
export const diffReportPath = () => (DB_PATH === ':memory:' ? null : join(dirname(DB_PATH), 'card-source-diff.json'));

/**
 * Guarda o relatório da última importação de cada tipo ("official", "spoiler:OP18"), para a
 * auditoria cruzada entre fontes. As seções das outras importações continuam no arquivo.
 */
export function saveDiffReport(key: string, chain: CardSource[], report: ChainReport, path = diffReportPath()): string | null {
  if (!path) return null;
  try {
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      // primeiro relatório (ou arquivo estragado): começa do zero
    }
    all[key] = { generatedAt: new Date().toISOString(), chain: chain.map((s) => s.id), ...report };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(all, null, 1));
    return path;
  } catch {
    return null;
  }
}
