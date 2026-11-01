// Decks do meta e os perfis do Bot do Time, lidos do disco (`data/decks/meta/`): por deck, a lista
// (`<id>.json`, que também entra no banco pela semente), o guia em prosa (`<id>.md`) e o perfil que o
// bot lê (`<id>.profile.json`, conferido por `validateProfile`). Os arquivos são relidos quando mudam
// (data de modificação), então editar um perfil no servidor vale na próxima partida.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type DeckProfile, validateProfile } from '@gumgum/engine';
import { DATA_DIR } from '../paths';

export interface MetaDeckInfo {
  id: string;
  name: string;
  leader: string;
  /** O guia (`<id>.md`) existe. */
  hasGuide: boolean;
  /** O perfil existe e é válido (`archetype` e `summary` vêm dele). */
  hasProfile: boolean;
  archetype: string | null;
  summary: string | null;
  /** O perfil existe mas não passou na validação: o motivo. */
  profileError: string | null;
  /** Última modificação entre os três arquivos (ISO). */
  updatedAt: string;
}

interface Cached<T> {
  mtime: number;
  value: T;
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class MetaProfiles {
  private profiles = new Map<string, Cached<DeckProfile | string | null>>();
  private guides = new Map<string, Cached<string | null>>();

  constructor(private dir = join(DATA_DIR, 'decks', 'meta')) {}

  get directory() {
    return this.dir;
  }

  private mtime(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** Os decks do meta (os `.json` da pasta), com o estado do guia e do perfil de cada um. */
  list(): MetaDeckInfo[] {
    if (!existsSync(this.dir)) return [];
    const out: MetaDeckInfo[] = [];
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.json') && !f.endsWith('.profile.json')).sort()) {
      const id = f.replace(/\.json$/, '');
      if (!SAFE_ID.test(id)) continue;
      let deck: { name?: string; leader?: string };
      try {
        deck = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as { name?: string; leader?: string };
      } catch {
        continue;
      }
      const profile = this.profile(id);
      const raw = this.rawProfile(id);
      const updated = Math.max(this.mtime(join(this.dir, f)), this.mtime(join(this.dir, `${id}.md`)), this.mtime(join(this.dir, `${id}.profile.json`)));
      out.push({
        id,
        name: deck.name ?? id,
        leader: deck.leader ?? '',
        hasGuide: existsSync(join(this.dir, `${id}.md`)),
        hasProfile: profile !== null,
        archetype: profile?.archetype ?? null,
        summary: profile?.summary ?? null,
        profileError: typeof raw === 'string' ? raw : null,
        updatedAt: new Date(updated).toISOString(),
      });
    }
    return out;
  }

  /** O perfil válido de um deck (null se não há, ou se não passou na validação). */
  profile(id: string): DeckProfile | null {
    const raw = this.rawProfile(id);
    return raw && typeof raw === 'object' ? raw : null;
  }

  /** O perfil, ou o motivo da recusa (string), ou null sem arquivo. */
  private rawProfile(id: string): DeckProfile | string | null {
    if (!SAFE_ID.test(id)) return null;
    const path = join(this.dir, `${id}.profile.json`);
    const mtime = this.mtime(path);
    const hit = this.profiles.get(id);
    if (hit && hit.mtime === mtime) return hit.value;
    let value: DeckProfile | string | null = null;
    if (mtime) {
      try {
        value = validateProfile(JSON.parse(readFileSync(path, 'utf8')));
      } catch (e) {
        value = `JSON ilegível: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    this.profiles.set(id, { mtime, value });
    return value;
  }

  /** O guia em prosa (markdown) de um deck, ou null. */
  guide(id: string): string | null {
    if (!SAFE_ID.test(id)) return null;
    const path = join(this.dir, `${id}.md`);
    const mtime = this.mtime(path);
    const hit = this.guides.get(id);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = mtime ? readFileSync(path, 'utf8') : null;
    this.guides.set(id, { mtime, value });
    return value;
  }
}
