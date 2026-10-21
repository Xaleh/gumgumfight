// [Trigger] revelado da Vida entre dois estados seguidos da partida.
//
// Vem da linha do histórico (`log.triggerActivated`), que é pública: vale igual para o bot, o
// replay e o online. Pelo estado da pilha não dá: o [Trigger] sem escolhas resolve inteiro na
// mesma ação e o estado novo já não traz o efeito.

import { cardDef, type GameState, HIDDEN_CARD, type PlayerId } from '@gumgum/engine';

export interface TriggerHit {
  /** Dono da carta (quem ativou o [Trigger]). */
  player: PlayerId;
  /** A carta no estado novo; null se ela não está à vista (voltou para a mão do oponente, o deck…). */
  uid: string | null;
}

/** O [Trigger] ativado de `prev` para `next` (o último, se houver mais de um). */
export function freshTrigger(prev: GameState, next: GameState): TriggerHit | null {
  if (next.log.length <= prev.log.length) return null;
  let entry: GameState['log'][number] | undefined;
  for (let i = next.log.length - 1; i >= prev.log.length && !entry; i--) if (next.log[i].key === 'log.triggerActivated') entry = next.log[i];
  if (!entry || entry.player === null) return null;
  const player = entry.player;
  const name = entry.params?.card;
  // Antes da resposta a carta já saiu da Vida e não está em área nenhuma: no estado anterior ela
  // não aparece. Agora ela está fora das áreas (resolvendo) ou onde o efeito a deixou.
  const before = new Set<string>();
  for (const ps of prev.players) {
    for (const u of [...ps.hand, ...ps.trash, ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : [])]) before.add(u);
  }
  for (const u of prev.limbo ?? []) before.add(u);
  const ps = next.players[player];
  const pool = [...(next.limbo ?? []), ...[...ps.trash].reverse(), ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : []), ...ps.hand];
  const uid =
    pool.find((u) => !before.has(u) && next.cards[u] && next.cards[u].cardId !== HIDDEN_CARD && (name === undefined || cardDef(next, u).name === name)) ??
    null;
  return { player, uid };
}
