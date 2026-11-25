// Personalidade do bot (roadmap D3): cada estilo tem uma posição em que decide diferente do equilibrado, nos três
// níveis (fácil, normal e difícil). O bot decide pela visão, como no servidor; o oponente scriptado não defende.

import { describe, expect, it } from 'vitest';
import { actingPlayer } from '../src/actions';
import { DEFAULT_WEIGHTS } from '../src/bot/evaluate';
import { BOT_PERSONALITIES, type BotPersonality, isBotPersonality, PERSONALITY_WEIGHTS, personalityWeights } from '../src/bot/personality';
import { type BotLevel, chooseBotAction, resetPlanner } from '../src/bot/planner';
import { validateProfile } from '../src/bot/profile';
import { chooseBotAction as simpleBot } from '../src/bot/simple';
import { applyAction } from '../src/engine';
import type { Action, GameState, PlayerId } from '../src/types';
import { actionFromView, identityAliases, viewFor } from '../src/view';
import { fetchToHand, kid, luffy, started, toTurn } from './helpers';

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

/** Decisão do bot `p` pela visão dele (busca determinística e sem teto de tempo). */
function decide(s: GameState, p: PlayerId, level: BotLevel, personality: BotPersonality): Action {
  resetPlanner();
  const aliases = identityAliases(s);
  const a = actionFromView(s, aliases, chooseBotAction(viewFor(s, p, aliases), p, level, { personality, random: () => 0.5, timeBudgetMs: 60_000 }));
  if (typeof a === 'string') throw new Error(a);
  return a;
}

function clearHand(s: GameState, p: PlayerId) {
  s.players[p].deck.push(...s.players[p].hand);
  s.players[p].hand = [];
}

let injected = 0;
/** Uma instância nova da carta no campo de `player` (mutação direta, só para testes). */
function inject(s: GameState, player: PlayerId, cardId: string, rested = false): string {
  const uid = `p${++injected}`;
  s.cards[uid] = { uid, cardId, owner: player };
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
}

/** O turno inteiro do bot `p`; o oponente não bloqueia, não usa Counter e põe a Vida na mão. */
function botTurn(s: GameState, p: PlayerId, level: BotLevel, personality: BotPersonality): Action[] {
  const actions: Action[] = [];
  for (let i = 0; i < 200 && s.phase !== 'gameover'; i++) {
    const acting = actingPlayer(s)!;
    if (acting !== p) {
      const kind = s.pending?.kind;
      s = applyAction(
        s,
        kind === 'block'
          ? { type: 'choose', player: acting, uids: [] }
          : kind === 'counter'
            ? { type: 'pass', player: acting }
            : kind === 'lifeCard'
              ? { type: 'answer', player: acting, yes: false }
              : simpleBot(s, acting),
      );
      continue;
    }
    if (!s.pending && s.activePlayer !== p) break;
    const a = decide(s, p, level, personality);
    actions.push(a);
    s = applyAction(s, a);
    if (a.type === 'endTurn') break;
  }
  return actions;
}

/** O Líder do Kid (jogador 0) ataca o Líder do Luffy (jogador 1, o bot): 5000 contra 5000. */
function leaderAttack(life: number, setup: (s: GameState) => void): GameState {
  const s = toTurn(started(1, [kid, luffy]), 3);
  s.players[1].life = s.players[1].life.slice(0, life);
  clearHand(s, 1);
  setup(s);
  return applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: s.players[1].leader.uid });
}

/** Usa Counter (Robin +1000 e Brook +2000 na mão) contra o ataque ao Líder com `life` de Vida? */
const counters = (life: number, level: BotLevel, p: BotPersonality) =>
  decide(
    leaderAttack(life, (s) => ['ST01-008', 'ST01-011'].forEach((id) => fetchToHand(s, 1, id))),
    1,
    level,
    p,
  ).type === 'counter';

/** Bloqueia com o Chopper [Blocker] o ataque ao Líder com `life` de Vida? */
function blocks(life: number, level: BotLevel, p: BotPersonality): boolean {
  const s = leaderAttack(life, (s) => inject(s, 1, 'ST01-006'));
  const a = decide(s, 1, level, p);
  return a.type === 'choose' && a.uids.length > 0;
}

/**
 * No turno do bot (Luffy, jogador 0), o Franky (6000) pode bater no Líder do oponente (com `oppLife` de Vida) ou num
 * Personagem virado dele (`target`). Devolve onde o Franky bateu. `leaderRested`: o Líder do bot já atacou.
 */
function frankyHits(level: BotLevel, p: BotPersonality, oppLife: number, target: string, leaderRested = false): 'ko' | 'leader' | null {
  const s = toTurn(started(1, [luffy, kid]), 5);
  clearHand(s, 0);
  s.players[1].life = s.players[1].life.slice(0, oppLife);
  s.players[0].donActive = 0;
  if (leaderRested) s.players[0].leader.rested = true;
  const franky = inject(s, 0, 'ST01-010');
  const victim = inject(s, 1, target, true);
  const attack = botTurn(s, 0, level, p).find((a) => a.type === 'attack' && a.attacker === franky);
  if (!attack || attack.type !== 'attack') return null;
  return attack.target === victim ? 'ko' : 'leader';
}

describe('personalidade: pesos', () => {
  it('cada personalidade só usa pesos que existem, com o tamanho certo', () => {
    for (const p of BOT_PERSONALITIES) {
      const checked = validateProfile({ id: 'x', leader: 'ST01-001', archetype: 'midrange', weights: PERSONALITY_WEIGHTS[p] });
      expect(typeof checked, p).toBe('object');
    }
    expect(personalityWeights('balanced', DEFAULT_WEIGHTS)).toBe(DEFAULT_WEIGHTS);
    expect(personalityWeights(undefined, DEFAULT_WEIGHTS)).toBe(DEFAULT_WEIGHTS);
    expect(personalityWeights('aggressive', DEFAULT_WEIGHTS).lifeOpp[1]).toBeGreaterThan(DEFAULT_WEIGHTS.lifeOpp[1]);
    expect(isBotPersonality('cautious')).toBe(true);
    expect(isBotPersonality('team')).toBe(false);
  });

  it('o Bot do Time ignora a personalidade (o estilo dele vem do perfil do deck)', () => {
    const s = leaderAttack(2, (s) => ['ST01-008', 'ST01-011'].forEach((id) => fetchToHand(s, 1, id)));
    expect(decide(s, 1, 'team', 'cautious')).toEqual(decide(s, 1, 'team', 'balanced'));
  });
});

describe.each(LEVELS)('personalidade no nível %s', (level) => {
  it('equilibrado: Counter com 1 de Vida e não com 3, bloqueio só com 1', () => {
    expect(counters(1, level, 'balanced')).toBe(true);
    expect(counters(3, level, 'balanced')).toBe(false);
    expect(blocks(1, level, 'balanced')).toBe(true);
    expect(blocks(2, level, 'balanced')).toBe(false);
  });

  it('conservador com a Vida: usa Counter com 3 de Vida e bloqueia com 2', () => {
    expect(counters(3, level, 'cautious')).toBe(true);
    expect(blocks(2, level, 'cautious')).toBe(true);
    // Com 4 de Vida ainda deixa passar: conservador não é gastar a mão toda.
    expect(counters(4, level, 'cautious')).toBe(false);
  });

  it('agressivo: não bloqueia nem com 1 de Vida (o Blocker fica para atacar)', () => {
    expect(blocks(1, level, 'aggressive')).toBe(false);
  });
});

describe.each(['normal', 'hard'] as BotLevel[])('personalidade com busca (%s): para onde vai o ataque', (level) => {
  it('agressivo vai no Líder com 3 de Vida; o equilibrado tira a Robin (custo 3)', () => {
    expect(frankyHits(level, 'balanced', 3, 'ST01-008')).toBe('ko');
    expect(frankyHits(level, 'aggressive', 3, 'ST01-008')).toBe('leader');
  });

  it('controle tira a Robin mesmo com o oponente em 2 de Vida; o equilibrado vai no Líder', () => {
    expect(frankyHits(level, 'balanced', 2, 'ST01-008')).toBe('leader');
    expect(frankyHits(level, 'control', 2, 'ST01-008')).toBe('ko');
  });
});

describe('personalidade no fácil: para onde vai o ataque', () => {
  it('agressivo vai no Líder; o equilibrado tira a Robin (custo 3)', () => {
    expect(frankyHits('easy', 'balanced', 5, 'ST01-008', true)).toBe('ko');
    expect(frankyHits('easy', 'aggressive', 5, 'ST01-008', true)).toBe('leader');
  });

  it('controle tira até o Personagem barato; o equilibrado vai no Líder', () => {
    // Usopp ST01-002 (custo 2, 2000). O equilibrado só tira Personagem de custo 3 ou mais antes do Líder.
    expect(frankyHits('easy', 'balanced', 5, 'ST01-002', true)).toBe('leader');
    expect(frankyHits('easy', 'control', 5, 'ST01-002', true)).toBe('ko');
  });
});
