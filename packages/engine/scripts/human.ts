// Oponente "humano fraco" para medir o bot: desenvolve e ataca como o bot heurístico (`simple.ts`),
// mas defende como um jogador de verdade: segura o ataque fatal sempre que pode, usa Counter com Vida
// baixa, bloqueia para salvar o Líder no fim. Só para medição (não é um nível do jogo).
import { legalActions } from '../src/actions';
import { chooseBotAction as simpleBot } from '../src/bot/simple';
import { cardDef, counterValue, getPower } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';

function boost(state: GameState, uid: string): number {
  const d = cardDef(state, uid);
  if (d.category !== 'event') return counterValue(state, uid);
  const steps = d.abilities.find((a) => a.timing === 'counter')?.steps ?? [];
  return steps.reduce((sum, st) => sum + (st.do === 'power' && st.amount > 0 ? st.amount : 0), 0);
}

export function humanAction(state: GameState, player: PlayerId): Action {
  const pending = state.pending;
  const me = state.players[player];
  if (pending?.kind === 'block' && state.battle) {
    const b = state.battle;
    const ap = getPower(state, b.attacker);
    const tp = getPower(state, b.target);
    const leader = b.target === me.leader.uid;
    if (!pending.options.length || ap < tp) return { type: 'choose', player, uids: [] };
    const counters = me.hand.reduce((s, u) => s + boost(state, u), 0);
    const canCounter = counters >= ap - tp + 1000;
    // Líder com Vida baixa: bloqueia (com o Blocker mais barato) se não dá para segurar com uma carta da mão.
    const needBlock = leader && (me.life.length === 0 || (me.life.length <= 2 && !canCounter));
    // Personagem valioso atacado por quem o Blocker aguenta.
    const saveChar = !leader && (cardDef(state, b.target).cost ?? 0) >= 4;
    if (needBlock || saveChar) {
      const sorted = [...pending.options].sort((x, y) => (cardDef(state, x).cost ?? 0) - (cardDef(state, y).cost ?? 0));
      const survivor = sorted.find((u) => getPower(state, u) > ap);
      const pick = needBlock ? (survivor ?? sorted[0]) : survivor;
      if (pick) return { type: 'choose', player, uids: [pick] };
    }
    return { type: 'choose', player, uids: [] };
  }
  if (pending?.kind === 'counter' && state.battle) {
    const b = state.battle;
    const ap = getPower(state, b.attacker);
    const tp = getPower(state, b.target);
    if (ap < tp) return { type: 'pass', player };
    const need = ap - tp + 1000;
    const leader = b.target === me.leader.uid;
    const options = pending.options.filter((u) => boost(state, u) > 0);
    const sorted = [...options].sort((x, y) => boost(state, x) - boost(state, y));
    const single = sorted.find((u) => boost(state, u) >= need);
    // Quantas cartas seriam gastas (as maiores primeiro).
    let sum = 0;
    let cards = 0;
    for (const u of [...sorted].reverse()) {
      sum += boost(state, u);
      cards++;
      if (sum >= need) break;
    }
    if (sum < need) return { type: 'pass', player };
    const life = me.life.length;
    const hand = me.hand.length;
    let worth: boolean;
    const careful = process.env.HUMAN === 'careful';
    if (leader) {
      if (life === 0) worth = true;
      else if (life === 1) worth = careful || cards <= 2 || hand >= 5;
      else if (life === 2) worth = careful || cards === 1 || hand >= 5;
      else if (life === 3) worth = careful ? cards === 1 || (cards === 2 && hand >= 5) : cards === 1 && hand >= 5;
      else worth = careful && cards === 1 && hand >= 6;
    } else {
      worth = (cardDef(state, b.target).cost ?? 0) >= 4 && cards === 1 && hand >= 3;
    }
    if (!worth) return { type: 'pass', player };
    return { type: 'counter', player, uid: single ?? sorted[sorted.length - 1] };
  }
  const a = simpleBot(state, player);
  // Confere que é legal (defesa contra mudanças no motor).
  if (!legalActions(state, player).length) throw new Error('sem ações');
  return a;
}
