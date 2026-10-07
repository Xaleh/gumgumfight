// Estados temporários de uma carta em campo, para a interface mostrar na própria carta.
//
// Reúne o que o motor guarda espalhado (modificadores, auras de outras cartas e restrições
// do jogador) numa lista com ícone, texto e até quando vale. Funciona também sobre a visão
// de um jogador ou do espectador (`viewFor`): os modificadores das cartas em campo e as
// definições de todas as cartas em campo fazem parte da visão.

import { aurasOn, cannotBeRested, cardDef, hasKeyword, isNegated, locate, noRefreshByAura, ownerOf, restricted } from './engine';
import type { GameState, Keyword, Modifier } from './types';

export type CardStatusKind =
  | 'cannotAttack'
  | 'cannotAttackLeader'
  | 'cannotAttackChars'
  | 'attackTax'
  | 'cannotRest'
  | 'skipRefresh'
  | 'cannotBlock'
  | 'negated'
  | 'keyword'
  | 'attribute'
  | 'cannotBeKO'
  | 'canAttackActive'
  | 'noBlockerWhenAttacking'
  | 'cost'
  | 'power';

export interface CardStatus {
  kind: CardStatusKind;
  /** Ícone curto para o canto da carta. */
  icon: string;
  /** Rótulo de poucas palavras ("Não ataca"). */
  label: string;
  /** Etiqueta curta, em caixa alta, para a tag na carta ("NÃO VIRA"). */
  tag: string;
  /** Texto do efeito ("Não pode atacar"). */
  text: string;
  /** Até quando vale ("até o fim deste turno"). */
  until: string;
  /** Restrição (bad) ou ganho (good). */
  tone: 'bad' | 'good';
  /** Vale a pena um ícone na carta (o ±poder já aparece no número do poder). */
  onCard: boolean;
  keyword?: Keyword;
}

const KEYWORD: Record<Keyword, { icon: string; label: string; tag: string }> = {
  rush: { icon: '⚡', label: 'Rush', tag: 'RUSH' },
  blocker: { icon: '🛡', label: 'Blocker', tag: 'BLOCKER' },
  doubleAttack: { icon: '⚔', label: 'Double Attack', tag: 'DOUBLE ATTACK' },
  banish: { icon: '💥', label: 'Banish', tag: 'BANISH' },
  rushCharacter: { icon: '⚡', label: 'Rush: Character', tag: 'RUSH: CHAR.' },
  unblockable: { icon: '🎯', label: 'Unblockable', tag: 'UNBLOCKABLE' },
};

const AURA_UNTIL = 'enquanto o efeito contínuo da outra carta valer';

/** Jogador de quem é o turno de número `turn`. */
function playerOfTurn(state: GameState, turn: number) {
  const same = (turn - state.turn) % 2 === 0;
  return state.players[same ? state.activePlayer : 1 - state.activePlayer];
}

/** "até o fim deste turno", "até o fim do próximo turno de Kid", "até o início do próximo turno de Luffy"… */
export function modifierUntil(state: GameState, m: Pick<Modifier, 'duration' | 'untilTurn'>): string {
  if (m.duration === 'battle') return state.battle ? 'até o fim desta batalha' : 'até o fim deste turno';
  const until = m.untilTurn ?? state.turn;
  if (m.duration === 'untilYourNextTurn') {
    return until <= state.turn ? 'até o fim deste turno' : `até o início do próximo turno de ${playerOfTurn(state, until).name}`;
  }
  if (m.duration === 'turn' || until <= state.turn) return 'até o fim deste turno';
  return `até o fim do próximo turno de ${playerOfTurn(state, until).name}`;
}

/** Ordem de expiração, para ficar com o modificador que dura mais quando há repetidos. */
function expiry(state: GameState, m: Pick<Modifier, 'duration' | 'untilTurn'>): number {
  if (m.duration === 'battle') return 0;
  if (m.duration === 'turn') return 1;
  const until = Math.max(state.turn, m.untilTurn ?? state.turn);
  return (until - state.turn) * 2 + (m.duration === 'untilYourNextTurn' ? 1 : 2);
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Estados temporários de uma carta em campo (vazio fora do campo). */
export function cardStatuses(state: GameState, uid: string): CardStatus[] {
  const loc = locate(state, uid);
  if (!loc || !state.cards[uid]) return [];
  const def = cardDef(state, uid);
  const mods = state.modifiers.filter((m) => m.uid === uid);
  const out = new Map<string, CardStatus & { order: number }>();
  const add = (key: string, order: number, s: CardStatus) => {
    const prev = out.get(key);
    if (!prev || prev.order < order) out.set(key, { ...s, order });
  };
  /** Estado vindo de modificadores de um tipo: um só, com a duração mais longa. */
  const fromMods = (kinds: Modifier['kind'][], key: string, make: (m: Modifier) => Omit<CardStatus, 'until'>) => {
    for (const m of mods) if (kinds.includes(m.kind)) add(key, expiry(state, m), { ...make(m), until: modifierUntil(state, m) });
  };
  const aura = (want: Parameters<typeof aurasOn>[3]) => loc.zone !== 'stage' && aurasOn(state, uid, loc.zone, want).length > 0;
  const attacker = loc.zone !== 'stage';

  // Restrições.
  if (attacker) {
    fromMods(['cannotAttack'], 'cannotAttack', () => ({ kind: 'cannotAttack', icon: '🚫', label: 'Não ataca', tag: 'NÃO ATACA', text: 'Não pode atacar', tone: 'bad', onCard: true }));
    if (loc.zone === 'character' && aura((au) => Boolean(au.cannotAttack))) {
      add('cannotAttack', 99, { kind: 'cannotAttack', icon: '🚫', label: 'Não ataca', tag: 'NÃO ATACA', text: 'Não pode atacar', until: AURA_UNTIL, tone: 'bad', onCard: true });
    }
    if (restricted(state, loc.player, 'noAttackLeader')) {
      add('cannotAttackLeader', 1, {
        kind: 'cannotAttackLeader',
        icon: '🚫',
        label: 'Não ataca o Líder',
        tag: 'NÃO ATACA LÍDER',
        text: 'Não pode atacar o Líder',
        until: 'até o fim deste turno',
        tone: 'bad',
        onCard: true,
      });
    }
    fromMods(['cannotAttackCharMaxCost'], 'cannotAttackChars', (m) => ({
      kind: 'cannotAttackChars',
      icon: '🚫',
      label: `Não ataca custo ≤${m.amount}`,
      tag: `NÃO ATACA CUSTO ≤${m.amount}`,
      text: `Não pode atacar Personagens com custo base de ${m.amount} ou menos`,
      tone: 'bad',
      onCard: true,
    }));
    fromMods(['attackTax'], 'attackTax', (m) => ({
      kind: 'attackTax',
      icon: '💸',
      label: `Ataque custa ${m.amount} carta(s)`,
      tag: `ATAQUE CUSTA ${m.amount}`,
      text: `Só pode atacar se o oponente descartar ${m.amount} carta(s) da mão`,
      tone: 'bad',
      onCard: true,
    }));
  }
  if (cannotBeRested(state, uid)) {
    fromMods(['cannotBeRested'], 'cannotRest', () => ({ kind: 'cannotRest', icon: '🔒', label: 'Não vira', tag: 'NÃO VIRA', text: 'Não pode ser virada (não ataca nem paga custos de virar)', tone: 'bad', onCard: true }));
  }
  fromMods(['skipRefresh'], 'skipRefresh', () => ({
    kind: 'skipRefresh',
    icon: '💤',
    label: 'Não desvira',
    tag: 'NÃO DESVIRA',
    text: 'Não fica ativa na próxima Fase de Renovação',
    tone: 'bad',
    onCard: true,
  }));
  if (out.has('skipRefresh')) {
    out.get('skipRefresh')!.until = `até a próxima Fase de Renovação de ${state.players[ownerOf(state, uid)].name}`;
  } else if (noRefreshByAura(state, uid)) {
    add('skipRefresh', 99, { kind: 'skipRefresh', icon: '💤', label: 'Não desvira', tag: 'NÃO DESVIRA', text: 'Não fica ativa nas Fases de Renovação', until: AURA_UNTIL, tone: 'bad', onCard: true });
  }
  if (loc.zone === 'character') {
    fromMods(['cannotBlock'], 'cannotBlock', () => ({ kind: 'cannotBlock', icon: '⛔', label: 'Sem Blocker', tag: 'SEM BLOCKER', text: 'Não pode ativar [Blocker]', tone: 'bad', onCard: true }));
  }
  if (isNegated(state, uid)) {
    fromMods(['negated'], 'negated', () => ({ kind: 'negated', icon: '❌', label: 'Efeitos anulados', tag: 'ANULADA', text: 'Os efeitos desta carta estão anulados', tone: 'bad', onCard: true }));
    if (!out.has('negated')) {
      add('negated', 99, { kind: 'negated', icon: '❌', label: 'Efeitos anulados', tag: 'ANULADA', text: 'Os efeitos desta carta estão anulados', until: AURA_UNTIL, tone: 'bad', onCard: true });
    }
  }

  // Ganhos.
  for (const kw of Object.keys(KEYWORD) as Keyword[]) {
    if (def.keywords.includes(kw) || !hasKeyword(state, uid, kw)) continue;
    const { icon, label, tag } = KEYWORD[kw];
    const base = { kind: 'keyword' as const, icon, label: `Ganhou ${label}`, tag, text: `Ganhou [${label}]`, tone: 'good' as const, onCard: true, keyword: kw };
    const byMod = mods.filter((m) => m.kind === 'keyword' && m.keyword === kw);
    if (byMod.length) for (const m of byMod) add(`kw:${kw}`, expiry(state, m), { ...base, until: modifierUntil(state, m) });
    else add(`kw:${kw}`, 99, { ...base, until: AURA_UNTIL });
  }
  for (const m of mods) {
    if (m.kind !== 'attribute' || !m.attribute) continue;
    add(`attr:${m.attribute}`, expiry(state, m), {
      kind: 'attribute',
      icon: '🔪',
      label: `Atributo ${m.attribute}`,
      tag: m.attribute.toUpperCase(),
      text: `Ganhou o atributo "${m.attribute}"`,
      until: modifierUntil(state, m),
      tone: 'good',
      onCard: true,
    });
  }
  fromMods(['cannotBeKO', 'cannotBeKOInBattle', 'cannotBeKOByEffect'], 'cannotBeKO', (m) => ({
    kind: 'cannotBeKO',
    icon: '✨',
    label: 'Não é nocauteada',
    tag: 'SEM K.O.',
    text: m.kind === 'cannotBeKOInBattle' ? 'Não pode ser nocauteada em batalha' : m.kind === 'cannotBeKOByEffect' ? 'Não pode ser nocauteada por efeitos' : 'Não pode ser nocauteada',
    tone: 'good',
    onCard: true,
  }));
  if (attacker) {
    fromMods(['canAttackActive'], 'canAttackActive', () => ({
      kind: 'canAttackActive',
      icon: '🏹',
      label: 'Ataca ativos',
      tag: 'ATACA ATIVOS',
      text: 'Pode atacar Personagens ativos',
      tone: 'good',
      onCard: true,
    }));
    fromMods(['noBlockerWhenAttacking'], 'noBlockerWhenAttacking', () => ({
      kind: 'noBlockerWhenAttacking',
      icon: '🚷',
      label: 'Sem Blocker contra',
      tag: 'ANTI-BLOCKER',
      text: 'Quando esta carta ataca, o oponente não pode ativar [Blocker]',
      tone: 'good',
      onCard: true,
    }));
  }

  // Custo e poder: somados por duração; o poder já aparece no número da carta, então fica só no painel.
  const sums = (kind: 'cost' | 'power') => {
    const groups = new Map<string, { amount: number; m: Modifier }>();
    for (const m of mods) {
      if (m.kind !== kind || !m.amount) continue;
      const k = modifierUntil(state, m);
      const g = groups.get(k);
      if (g) g.amount += m.amount;
      else groups.set(k, { amount: m.amount, m });
    }
    return groups;
  };
  for (const [until, g] of sums('cost')) {
    if (!g.amount) continue;
    add(`cost:${until}`, expiry(state, g.m), {
      kind: 'cost',
      icon: '🏷',
      label: `${signed(g.amount)} custo`,
      tag: `${signed(g.amount)} CUSTO`,
      text: `${signed(g.amount)} de custo`,
      until,
      tone: g.amount > 0 ? 'bad' : 'good',
      onCard: true,
    });
  }
  for (const [until, g] of sums('power')) {
    if (!g.amount) continue;
    add(`power:${until}`, expiry(state, g.m), {
      kind: 'power',
      icon: g.amount > 0 ? '▲' : '▼',
      label: `${signed(g.amount)} poder`,
      tag: `${signed(g.amount)} PODER`,
      text: `${signed(g.amount)} de poder`,
      until,
      tone: g.amount > 0 ? 'good' : 'bad',
      onCard: false,
    });
  }

  return [...out.values()].map(({ order: _order, ...s }) => s);
}
