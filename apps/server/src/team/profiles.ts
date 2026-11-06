// Decks do meta e os perfis do Bot do Time, lidos do disco (`data/decks/meta/`): por deck, a lista
// (`<id>.json`, que também entra no banco pela semente), o guia em prosa (`<id>.md`) e o perfil que o
// bot lê (`<id>.profile.json`, conferido por `validateProfile`). Os arquivos são relidos quando mudam
// (data de modificação), então editar um perfil no servidor vale na próxima partida.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type DeckProfile, validateProfile } from '@gumgum/engine';
import type { DB } from '../db';
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
  /** Guia ou perfil salvos pela tela (no banco), por cima dos arquivos. */
  overridden: boolean;
  /** Última modificação entre os três arquivos (ISO). */
  updatedAt: string;
}

interface Cached<T> {
  mtime: number;
  value: T;
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

type OverrideRow = { deck_id: string; guide: string | null; profile: string | null; updated_at: string };

export class MetaProfiles {
  private profiles = new Map<string, Cached<DeckProfile | string | null>>();
  private guides = new Map<string, Cached<string | null>>();
  private leaders = new Map<string, Cached<string | null>>();

  /** `db`: a tela "Bot do Time" salva guia e perfil no banco, por cima dos arquivos (que são a semente). */
  constructor(
    private dir = join(DATA_DIR, 'decks', 'meta'),
    private db: DB | null = null,
  ) {}

  get directory() {
    return this.dir;
  }

  private override(id: string): OverrideRow | null {
    if (!this.db) return null;
    return (this.db.prepare('SELECT deck_id, guide, profile, updated_at FROM meta_profiles WHERE deck_id = ?').get(id) as OverrideRow | undefined) ?? null;
  }

  /**
   * Salva o guia e/ou o perfil (já conferido) no banco. `null` num campo volta ao arquivo. Quem salva deve
   * copiar o resultado para `data/decks/meta` no repositório: o banco é o que vale no servidor; o arquivo, a semente.
   */
  save(id: string, patch: { guide?: string | null; profile?: DeckProfile | null }, by: string | null): void {
    if (!this.db) throw new Error('sem banco: os perfis só podem ser editados nos arquivos');
    if (!SAFE_ID.test(id)) throw new Error('id inválido');
    const cur = this.override(id);
    const guide = patch.guide === undefined ? (cur?.guide ?? null) : patch.guide;
    const profile = patch.profile === undefined ? (cur?.profile ?? null) : patch.profile ? JSON.stringify(patch.profile) : null;
    if (guide === null && profile === null) this.db.prepare('DELETE FROM meta_profiles WHERE deck_id = ?').run(id);
    else {
      this.db
        .prepare(
          `INSERT INTO meta_profiles (deck_id, guide, profile, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(deck_id) DO UPDATE SET guide = excluded.guide, profile = excluded.profile, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .run(id, guide, profile, by);
    }
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
      const over = this.override(id);
      const updated = Math.max(this.mtime(join(this.dir, f)), this.mtime(join(this.dir, `${id}.md`)), this.mtime(join(this.dir, `${id}.profile.json`)), over ? Date.parse(`${over.updated_at.replace(' ', 'T')}Z`) || 0 : 0);
      out.push({
        id,
        name: deck.name ?? id,
        leader: deck.leader ?? '',
        hasGuide: this.guide(id) !== null,
        hasProfile: profile !== null,
        archetype: profile?.archetype ?? null,
        summary: profile?.summary ?? null,
        profileError: typeof raw === 'string' ? raw : null,
        /** Guia ou perfil vindos do banco (salvos pela tela), não do arquivo. */
        overridden: Boolean(over && (over.guide !== null || over.profile !== null)),
        updatedAt: new Date(updated).toISOString(),
      });
    }
    return out;
  }

  /** O Líder de um deck do meta (`<id>.json`), relido quando o arquivo muda. */
  private leaderOf(id: string): string | null {
    const path = join(this.dir, `${id}.json`);
    const mtime = this.mtime(path);
    const hit = this.leaders.get(id);
    if (hit && hit.mtime === mtime) return hit.value;
    let value: string | null = null;
    try {
      value = mtime ? ((JSON.parse(readFileSync(path, 'utf8')) as { leader?: string }).leader ?? null) : null;
    } catch {
      value = null;
    }
    this.leaders.set(id, { mtime, value });
    return value;
  }

  /**
   * O perfil com que o bot joga um deck: o do próprio deck do meta ou, num deck que não é do meta (o deck de um
   * jogador escolhido para o bot), o do primeiro deck do meta (em ordem de id) com o mesmo Líder e perfil válido.
   * Devolve também de qual deck do meta o perfil veio.
   */
  profileFor(deckId: string | null, leader: string | null): { id: string; profile: DeckProfile } | null {
    const own = deckId ? this.profile(deckId) : null;
    if (deckId && own) return { id: deckId, profile: own };
    if (!leader || !existsSync(this.dir)) return null;
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.json') && !f.endsWith('.profile.json')).sort()) {
      const id = f.replace(/\.json$/, '');
      if (!SAFE_ID.test(id) || this.leaderOf(id) !== leader) continue;
      const profile = this.profile(id);
      if (profile) return { id, profile };
    }
    return null;
  }

  /** O perfil válido de um deck (null se não há, ou se não passou na validação). */
  profile(id: string): DeckProfile | null {
    const raw = this.rawProfile(id);
    return raw && typeof raw === 'object' ? raw : null;
  }

  /** O perfil, ou o motivo da recusa (string), ou null sem arquivo. O salvo no banco vem antes do arquivo. */
  private rawProfile(id: string): DeckProfile | string | null {
    if (!SAFE_ID.test(id)) return null;
    const over = this.override(id);
    if (over?.profile) {
      try {
        return validateProfile(JSON.parse(over.profile));
      } catch (e) {
        return `JSON ilegível: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
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

  /** O guia em prosa (markdown) de um deck, ou null. O salvo no banco vem antes do arquivo. */
  guide(id: string): string | null {
    if (!SAFE_ID.test(id)) return null;
    const over = this.override(id);
    if (over?.guide) return over.guide;
    const path = join(this.dir, `${id}.md`);
    const mtime = this.mtime(path);
    const hit = this.guides.get(id);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = mtime ? readFileSync(path, 'utf8') : null;
    this.guides.set(id, { mtime, value });
    return value;
  }
}
