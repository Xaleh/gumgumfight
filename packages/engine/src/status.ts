// Estados temporários de uma carta em campo, para a interface mostrar na própria carta.
//
// Reúne o que o motor guarda espalhado (modificadores, auras de outras cartas e restrições
// do jogador) numa lista com ícone, texto e até quando vale. Funciona também sobre a visão
// de um jogador ou do espectador (`viewFor`): os modificadores das cartas em campo e as
// definições de todas as cartas em campo fazem parte da visão.
//
// Os textos ficam em português (replays, testes e clientes antigos dependem deles); ao lado de
// cada um vai a chave de tradução (`status.…`) com os parâmetros, para a interface traduzir.

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

/** Parâmetros das chaves de tradução (`{nome}` na mensagem). */
export type StatusParams = Record<string, string | number>;

export interface CardStatus {
  kind: CardStatusKind;
  /** Ícone curto para o canto da carta. */
  icon: string;
  /** Rótulo de poucas palavras ("Não ataca"). */
  label: string;
  /** Etiqueta curta, em caixa alta, para a tag na carta ("NÃO VIRA"). */
  tag: string;
  /** Chave de tradução da etiqueta (`status.…Tag`); sem chave (palavras-chave, atributos) a etiqueta não se traduz. */
  tagKey?: string;
  tagParams?: StatusParams;
  /** Texto do efeito ("Não pode atacar"). */
  text: string;
  /** Chave de tradução do texto (`status.…`); em português a mensagem é igual a `text`. */
  textKey: string;
  textParams?: StatusParams;
  /** Até quando vale ("até o fim deste turno"). */
  until: string;
  /** Chave de tradução de `until` (`status.until…`). */
  untilKey: string;
  untilParams?: StatusParams;
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

/** Duração de um estado: o texto em português e a chave de tradução com os parâmetros. */
export type StatusUntil = Pick<CardStatus, 'until' | 'untilKey' | 'untilParams'>;

const AURA_UNTIL: StatusUntil = { until: 'enquanto o efeito contínuo da outra carta valer', untilKey: 'status.untilAura' };
const END_OF_TURN: StatusUntil = { until: 'até o fim deste turno', untilKey: 'status.untilEndOfTurn' };

/** Jogador de quem é o turno de número `turn`. */
function playerOfTurn(state: GameState, turn: number) {
  const same = (turn - state.turn) % 2 === 0;
  return state.players[same ? state.activePlayer : 1 - state.activePlayer];
}

/** `modifierUntil` com a chave de tradução e os parâmetros. */
export function modifierUntilInfo(state: GameState, m: Pick<Modifier, 'duration' | 'untilTurn'>): StatusUntil {
  if (m.duration === 'battle') return state.battle ? { until: 'até o fim desta batalha', untilKey: 'status.untilEndOfBattle' } : END_OF_TURN;
  const until = m.untilTurn ?? state.turn;
  if (m.duration === 'untilYourNextTurn') {
    if (until <= state.turn) return END_OF_TURN;
    const name = playerOfTurn(state, until).name;
    return { until: `até o início do próximo turno de ${name}`, untilKey: 'status.untilStartOfNextTurn', untilParams: { name } };
  }
  if (m.duration === 'turn' || until <= state.turn) return END_OF_TURN;
  const name = playerOfTurn(state, until).name;
  return { until: `até o fim do próximo turno de ${name}`, untilKey: 'status.untilEndOfNextTurn', untilParams: { name } };
}

/** "até o fim deste turno", "até o fim do próximo turno de Kid", "até o início do próximo turno de Luffy"… */
export function modifierUntil(state: GameState, m: Pick<Modifier, 'duration' | 'untilTurn'>): string {
  return modifierUntilInfo(state, m).until;
}

/** Ordem de expiração, para ficar com o modificador que dura mais quando há repetidos. */
function expiry(state: GameState, m: Pick<Modifier, 'duration' | 'untilTurn'>): number {
  if (m.duration === 'battle') return 0;
  if (m.duration === 'turn') return 1;
  const until = Math.max(state.turn, m.untilTurn ?? state.turn);
  return (until - state.turn) * 2 + (m.duration === 'untilYourNextTurn' ? 1 : 2);
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Texto de "não pode ser nocauteada" conforme o tipo do modificador. */
const NO_KO: Partial<Record<Modifier['kind'], { text: string; textKey: string }>> = {
  cannotBeKOInBattle: { text: 'Não pode ser nocauteada em batalha', textKey: 'status.cannotBeKOInBattle' },
  cannotBeKOByEffect: { text: 'Não pode ser nocauteada por efeitos', textKey: 'status.cannotBeKOByEffect' },
  cannotBeKOByOpponentEffect: { text: 'Não pode ser nocauteada por efeitos do oponente', textKey: 'status.cannotBeKOByOpponentEffect' },
};

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
  const fromMods = (kinds: Modifier['kind'][], key: string, make: (m: Modifier) => Omit<CardStatus, keyof StatusUntil>) => {
    for (const m of mods) if (kinds.includes(m.kind)) add(key, expiry(state, m), { ...make(m), ...modifierUntilInfo(state, m) });
  };
  const aura = (want: Parameters<typeof aurasOn>[3]) => loc.zone !== 'stage' && aurasOn(state, uid, loc.zone, want).length > 0;
  const attacker = loc.zone !== 'stage';

  // Restrições.
  if (attacker) {
    const cannotAttack = {
      kind: 'cannotAttack',
      icon: '🚫',
      label: 'Não ataca',
      tag: 'NÃO ATACA',
      tagKey: 'status.cannotAttackTag',
      text: 'Não pode atacar',
      textKey: 'status.cannotAttack',
      tone: 'bad',
      onCard: true,
    } as const;
    fromMods(['cannotAttack'], 'cannotAttack', () => cannotAttack);
    if (loc.zone === 'character' && aura((au) => Boolean(au.cannotAttack))) {
      add('cannotAttack', 99, { ...cannotAttack, ...AURA_UNTIL });
    }
    if (restricted(state, loc.player, 'noAttackLeader')) {
      add('cannotAttackLeader', 1, {
        kind: 'cannotAttackLeader',
        icon: '🚫',
        label: 'Não ataca o Líder',
        tag: 'NÃO ATACA LÍDER',
        tagKey: 'status.cannotAttackLeaderTag',
        text: 'Não pode atacar o Líder',
        textKey: 'status.cannotAttackLeader',
        ...END_OF_TURN,
        tone: 'bad',
        onCard: true,
      });
    }
    fromMods(['cannotAttackCharMaxCost'], 'cannotAttackChars', (m) => ({
      kind: 'cannotAttackChars',
      icon: '🚫',
      label: `Não ataca custo ≤${m.amount}`,
      tag: `NÃO ATACA CUSTO ≤${m.amount}`,
      tagKey: 'status.cannotAttackCharsTag',
      tagParams: { n: m.amount },
      text: `Não pode atacar Personagens com custo base de ${m.amount} ou menos`,
      textKey: 'status.cannotAttackChars',
      textParams: { n: m.amount },
      tone: 'bad',
      onCard: true,
    }));
    fromMods(['attackTax'], 'attackTax', (m) => ({
      kind: 'attackTax',
      icon: '💸',
      label: `Ataque custa ${m.amount} carta(s)`,
      tag: `ATAQUE CUSTA ${m.amount}`,
      tagKey: 'status.attackTaxTag',
      tagParams: { n: m.amount },
      text: `Só pode atacar se o oponente descartar ${m.amount} carta(s) da mão`,
      textKey: 'status.attackTax',
      textParams: { n: m.amount },
      tone: 'bad',
      onCard: true,
    }));
  }
  if (cannotBeRested(state, uid)) {
    fromMods(['cannotBeRested'], 'cannotRest', () => ({
      kind: 'cannotRest',
      icon: '🔒',
      label: 'Não vira',
      tag: 'NÃO VIRA',
      tagKey: 'status.cannotRestTag',
      text: 'Não pode ser virada (não ataca nem paga custos de virar)',
      textKey: 'status.cannotRest',
      tone: 'bad',
      onCard: true,
    }));
  }
  fromMods(['skipRefresh'], 'skipRefresh', () => ({
    kind: 'skipRefresh',
    icon: '💤',
    label: 'Não desvira',
    tag: 'NÃO DESVIRA',
    tagKey: 'status.skipRefreshTag',
    text: 'Não fica ativa na próxima Fase de Renovação',
    textKey: 'status.skipRefresh',
    tone: 'bad',
    onCard: true,
  }));
  if (out.has('skipRefresh')) {
    const name = state.players[ownerOf(state, uid)].name;
    const until: StatusUntil = { until: `até a próxima Fase de Renovação de ${name}`, untilKey: 'status.untilNextRefresh', untilParams: { name } };
    Object.assign(out.get('skipRefresh')!, until);
  } else if (noRefreshByAura(state, uid)) {
    add('skipRefresh', 99, {
      kind: 'skipRefresh',
      icon: '💤',
      label: 'Não desvira',
      tag: 'NÃO DESVIRA',
      tagKey: 'status.skipRefreshTag',
      text: 'Não fica ativa nas Fases de Renovação',
      textKey: 'status.skipRefreshAura',
      ...AURA_UNTIL,
      tone: 'bad',
      onCard: true,
    });
  }
  if (loc.zone === 'character') {
    fromMods(['cannotBlock'], 'cannotBlock', () => ({
      kind: 'cannotBlock',
      icon: '⛔',
      label: 'Sem Blocker',
      tag: 'SEM BLOCKER',
      tagKey: 'status.cannotBlockTag',
      text: 'Não pode ativar [Blocker]',
      textKey: 'status.cannotBlock',
      tone: 'bad',
      onCard: true,
    }));
  }
  if (isNegated(state, uid)) {
    const negated = {
      kind: 'negated',
      icon: '❌',
      label: 'Efeitos anulados',
      tag: 'ANULADA',
      tagKey: 'status.negatedTag',
      text: 'Os efeitos desta carta estão anulados',
      textKey: 'status.negated',
      tone: 'bad',
      onCard: true,
    } as const;
    fromMods(['negated'], 'negated', () => negated);
    if (!out.has('negated')) add('negated', 99, { ...negated, ...AURA_UNTIL });
  }

  // Ganhos.
  for (const kw of Object.keys(KEYWORD) as Keyword[]) {
    if (def.keywords.includes(kw) || !hasKeyword(state, uid, kw)) continue;
    // O nome da palavra-chave e a etiqueta ficam em inglês, como no jogo.
    const { icon, label, tag } = KEYWORD[kw];
    const base = {
      kind: 'keyword' as const,
      icon,
      label: `Ganhou ${label}`,
      tag,
      text: `Ganhou [${label}]`,
      textKey: 'status.gainedKeyword',
      textParams: { keyword: label },
      tone: 'good' as const,
      onCard: true,
      keyword: kw,
    };
    const byMod = mods.filter((m) => m.kind === 'keyword' && m.keyword === kw);
    if (byMod.length) for (const m of byMod) add(`kw:${kw}`, expiry(state, m), { ...base, ...modifierUntilInfo(state, m) });
    else add(`kw:${kw}`, 99, { ...base, ...AURA_UNTIL });
  }
  for (const m of mods) {
    if (m.kind !== 'attribute' || !m.attribute) continue;
    add(`attr:${m.attribute}`, expiry(state, m), {
      kind: 'attribute',
      icon: '🔪',
      label: `Atributo ${m.attribute}`,
      tag: m.attribute.toUpperCase(),
      text: `Ganhou o atributo "${m.attribute}"`,
      textKey: 'status.gainedAttribute',
      textParams: { attribute: m.attribute },
      ...modifierUntilInfo(state, m),
      tone: 'good',
      onCard: true,
    });
  }
  fromMods(['cannotBeKO', 'cannotBeKOInBattle', 'cannotBeKOByEffect', 'cannotBeKOByOpponentEffect'], 'cannotBeKO', (m) => ({
    kind: 'cannotBeKO',
    icon: '✨',
    label: 'Não é nocauteada',
    tag: 'SEM K.O.',
    tagKey: 'status.cannotBeKOTag',
    ...(NO_KO[m.kind] ?? { text: 'Não pode ser nocauteada', textKey: 'status.cannotBeKO' }),
    tone: 'good',
    onCard: true,
  }));
  if (attacker) {
    fromMods(['canAttackActive'], 'canAttackActive', () => ({
      kind: 'canAttackActive',
      icon: '🏹',
      label: 'Ataca ativos',
      tag: 'ATACA ATIVOS',
      tagKey: 'status.canAttackActiveTag',
      text: 'Pode atacar Personagens ativos',
      textKey: 'status.canAttackActive',
      tone: 'good',
      onCard: true,
    }));
    fromMods(['noBlockerWhenAttacking'], 'noBlockerWhenAttacking', () => ({
      kind: 'noBlockerWhenAttacking',
      icon: '🚷',
      label: 'Sem Blocker contra',
      tag: 'ANTI-BLOCKER',
      tagKey: 'status.noBlockerWhenAttackingTag',
      text: 'Quando esta carta ataca, o oponente não pode ativar [Blocker]',
      textKey: 'status.noBlockerWhenAttacking',
      tone: 'good',
      onCard: true,
    }));
  }

  // Custo e poder: somados por duração; o poder já aparece no número da carta, então fica só no painel.
  const sums = (kind: 'cost' | 'power') => {
    const groups = new Map<string, { amount: number; m: Modifier; until: StatusUntil }>();
    for (const m of mods) {
      if (m.kind !== kind || !m.amount) continue;
      const until = modifierUntilInfo(state, m);
      const g = groups.get(until.until);
      if (g) g.amount += m.amount;
      else groups.set(until.until, { amount: m.amount, m, until });
    }
    return groups;
  };
  for (const [until, g] of sums('cost')) {
    if (!g.amount) continue;
    const amount = signed(g.amount);
    add(`cost:${until}`, expiry(state, g.m), {
      kind: 'cost',
      icon: '🏷',
      label: `${amount} custo`,
      tag: `${amount} CUSTO`,
      tagKey: 'status.costTag',
      tagParams: { amount },
      text: `${amount} de custo`,
      textKey: 'status.cost',
      textParams: { amount },
      ...g.until,
      tone: g.amount > 0 ? 'bad' : 'good',
      onCard: true,
    });
  }
  for (const [until, g] of sums('power')) {
    if (!g.amount) continue;
    const amount = signed(g.amount);
    add(`power:${until}`, expiry(state, g.m), {
      kind: 'power',
      icon: g.amount > 0 ? '▲' : '▼',
      label: `${amount} poder`,
      tag: `${amount} PODER`,
      tagKey: 'status.powerTag',
      tagParams: { amount },
      text: `${amount} de poder`,
      textKey: 'status.power',
      textParams: { amount },
      ...g.until,
      tone: g.amount > 0 ? 'good' : 'bad',
      onCard: false,
    });
  }

  return [...out.values()].map(({ order: _order, ...s }) => s);
}
