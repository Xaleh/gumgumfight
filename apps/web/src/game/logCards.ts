// Nomes de carta nas linhas do histórico: achá-los no texto e dizer qual carta está por trás de cada um.

import { type CardDef, type GameState, HIDDEN_CARD, type LogEntry, zoneOf } from '@gumgum/engine';

export interface LogNames {
  /** Todos os nomes de carta da partida, do maior para o menor, como alternativas de uma regex. */
  regex: RegExp | null;
  /** Nome → ids das cartas com esse nome (reimpressões com o mesmo nome). */
  byName: Map<string, string[]>;
}

/** Nomes das cartas conhecidas da partida, para achá-los nas linhas do histórico. */
export function logCardNames(defs: GameState['defs']): LogNames {
  const byName = new Map<string, string[]>();
  for (const def of Object.values(defs)) {
    if (def.id === HIDDEN_CARD || !def.name) continue;
    const ids = byName.get(def.name);
    if (ids) ids.push(def.id);
    else byName.set(def.name, [def.id]);
  }
  // Os nomes maiores primeiro: "Monkey.D.Luffy" antes de "Luffy".
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Só nomes inteiros: nada de letra ou número colado antes ou depois.
  const regex = names.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
  return { regex, byName };
}

/** Onde a carta está vale mais que de quem é: líder antes de personagem/stage, depois descarte, depois o resto. */
const LOG_ZONE_RANK: Record<string, number> = { leader: 0, character: 1, stage: 1, trash: 2 };

/**
 * A carta por trás de um nome do histórico: a que a própria linha diz (`cards`, `revealed`). Numa linha com
 * duas cartas de mesmo nome ("Counter: Boa Hancock dá +2000 a Boa Hancock", a Personagem e a Líder), a
 * `nth`-ésima vez que o nome aparece (0 = a primeira) é a `nth`-ésima carta com esse nome.
 *
 * Linhas de partidas antigas não dizem a carta. Nelas, entre as homônimas (líder e personagem de mesmo nome,
 * reimpressões), vale a que está à vista na mesa; em empate, a de quem fez a jogada. É um palpite: com a
 * Personagem Boa Hancock usada de Counter contra um deck de Boa Hancock, ele abre a Líder.
 */
export function resolveLogCard(state: GameState, names: LogNames, entry: LogEntry, name: string, nth = 0): CardDef | null {
  const told = [...(entry.cards ?? []), ...(entry.revealed ?? [])].filter((id) => state.defs[id]?.name === name);
  if (told.length) return state.defs[told[Math.min(nth, told.length - 1)]];
  const ids = names.byName.get(name);
  if (!ids?.length) return null;
  let best = ids[0];
  if (ids.length > 1) {
    let bestScore = Infinity;
    for (const c of Object.values(state.cards)) {
      if (!ids.includes(c.cardId)) continue;
      const score = (LOG_ZONE_RANK[zoneOf(state, c.uid) ?? ''] ?? 3) * 2 + (c.owner === entry.player ? 0 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c.cardId;
      }
    }
  }
  return state.defs[best] ?? null;
}
