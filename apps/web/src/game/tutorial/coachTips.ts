// Dicas do treinador nas partidas contra o bot (opção "Dicas do treinador"): uma dica curta
// para o momento da partida, calculada só pelo estado do motor. Textos: `coach.tip.<key>`.

import { cardDef, counterValue, type GameState, getPower, legalActions, type PlayerId } from '@gumgum/engine';

export interface CoachTip {
  key: CoachTipKey;
  params?: Record<string, string | number>;
}

export const COACH_TIP_KEYS = [
  'mulliganKeep',
  'mulliganRedraw',
  'block',
  'blockNotNeeded',
  'counterSafe',
  'counterCan',
  'counterCannot',
  'trigger',
  'spend',
  'attack',
] as const;
export type CoachTipKey = (typeof COACH_TIP_KEYS)[number];

/** Custo que conta como "barato" para começar a partida. */
const CHEAP = 3;

/** A dica para `me` agora, ou nenhuma (vez do oponente, nada a sugerir, partida encerrada). */
export function coachTip(s: GameState, me: PlayerId): CoachTip | null {
  if (s.phase === 'gameover') return null;
  const p = s.pending;
  if (p) {
    if (p.player !== me) return null;
    switch (p.kind) {
      case 'mulligan': {
        const cheap = s.players[me].hand.filter((u) => {
          const d = cardDef(s, u);
          return d.category !== 'stage' && (d.cost ?? 0) <= CHEAP;
        }).length;
        return { key: cheap >= 2 ? 'mulliganKeep' : 'mulliganRedraw', params: { n: cheap } };
      }
      case 'block': {
        const b = s.battle;
        if (!b || p.options.length === 0) return null;
        const atk = getPower(s, b.attacker);
        const def = getPower(s, b.target);
        if (atk < def) return { key: 'blockNotNeeded', params: { atk, def } };
        return { key: 'block', params: { name: cardDef(s, p.options[0]).name, atk, def } };
      }
      case 'counter': {
        const b = s.battle;
        if (!b) return null;
        const atk = getPower(s, b.attacker);
        const def = getPower(s, b.target);
        if (atk < def) return { key: 'counterSafe', params: { atk, def } };
        const need = atk - def + 1000;
        const hand = p.options.reduce((sum, u) => sum + counterValue(s, u), 0);
        const events = p.options.some((u) => cardDef(s, u).category === 'event');
        return hand >= need || events ? { key: 'counterCan', params: { need, atk, def } } : { key: 'counterCannot', params: { need, atk, def } };
      }
      case 'lifeCard':
        return cardDef(s, p.card).abilities.some((a) => a.timing === 'trigger') ? { key: 'trigger', params: { name: cardDef(s, p.card).name } } : null;
      default:
        return null;
    }
  }
  if (s.activePlayer !== me || s.phase !== 'main') return null;
  const legal = legalActions(s, me);
  const ps = s.players[me];
  const playable = legal.filter((a) => a.type === 'playCard');
  if (ps.donActive > 0 && playable.length > 0) {
    return { key: 'spend', params: { n: ps.donActive, name: cardDef(s, (playable[0] as { uid: string }).uid).name } };
  }
  const attack = legal.find((a) => a.type === 'attack');
  if (attack && attack.type === 'attack') return { key: 'attack', params: { name: cardDef(s, attack.attacker).name } };
  return null;
}
