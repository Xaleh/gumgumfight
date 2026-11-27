import { describe, expect, it } from 'vitest';
import type { StatsOverview } from '../src/api';
import ptBR from '../src/i18n/pt-BR';
import { daysAgo, DECK_MIN_GAMES, deckTips, MATCHUP_MIN_GAMES, metaTip, nextTip, RULE_TIPS, shuffled, spoilerTips, TIP_START, type WaitTip } from '../src/waitTips';

const card = (name: string) => ({ name, category: 'leader', colors: ['red'] });
const cards = { L1: card('Luffy'), L2: card('Zoro'), L3: card('Nami'), L4: card('Sanji') };
const win = { firstGames: 0, firstWins: 0 };
const summary = (games: number, wins: number): StatsOverview['summary'] => {
  const none = { games: 0, wins: 0 };
  return { games, wins, matches: games, players: 1, first: none, second: none, mulligan: none, keep: none };
};

describe('cartão de dicas da espera: itens de dados', () => {
  it('meta da semana: os três mais jogados, com a fatia de cada um', () => {
    const tip = metaTip({
      leaders: [
        { leader: 'L2', games: 30, wins: 10, lists: 1, ...win },
        { leader: 'L1', games: 50, wins: 20, lists: 1, ...win },
        { leader: 'L4', games: 5, wins: 1, lists: 1, ...win },
        { leader: 'L3', games: 15, wins: 9, lists: 1, ...win },
      ],
      cards,
    });
    expect(tip).toEqual({
      kind: 'meta',
      leaders: [
        { name: 'Luffy', pct: 50 },
        { name: 'Zoro', pct: 30 },
        { name: 'Nami', pct: 15 },
      ],
    });
  });

  it('meta da semana: sem partidas não há item', () => {
    expect(metaTip(null)).toBeNull();
    expect(metaTip({ leaders: [], cards: {} })).toBeNull();
  });

  it('histórico com o Líder: total, melhor e pior confronto', () => {
    const tips = deckTips(
      {
        summary: summary(20, 12),
        matchups: [
          { leader: 'L1', oppLeader: 'L2', games: 10, wins: 8, ...win },
          { leader: 'L1', oppLeader: 'L3', games: 6, wins: 2, ...win },
          // Poucas partidas: fora da conta, mesmo com 100%.
          { leader: 'L1', oppLeader: 'L4', games: MATCHUP_MIN_GAMES - 1, wins: MATCHUP_MIN_GAMES - 1, ...win },
          // De outro Líder do jogador.
          { leader: 'L2', oppLeader: 'L3', games: 9, wins: 9, ...win },
        ],
        cards,
      },
      'L1',
    );
    expect(tips).toEqual([
      { kind: 'deck', name: 'Luffy', games: 20, wins: 12, pct: 60 },
      { kind: 'matchup', best: true, name: 'Luffy', opp: 'Zoro', games: 10, pct: 80 },
      { kind: 'matchup', best: false, name: 'Luffy', opp: 'Nami', games: 6, pct: 33 },
    ]);
  });

  it('histórico com o Líder: poucas partidas não viram dica; um confronto só não tem "pior"', () => {
    expect(deckTips(null, 'L1')).toEqual([]);
    expect(deckTips({ summary: summary(DECK_MIN_GAMES - 1, 1), matchups: [], cards }, 'L1')).toEqual([]);
    const one = deckTips({ summary: summary(4, 3), matchups: [{ leader: 'L1', oppLeader: 'L2', games: 4, wins: 3, ...win }], cards }, 'L1');
    expect(one).toEqual([{ kind: 'matchup', best: true, name: 'Luffy', opp: 'Zoro', games: 4, pct: 75 }]);
    // Dois confrontos com a mesma taxa: não há um pior para mostrar.
    const same = deckTips(
      {
        summary: summary(0, 0),
        matchups: [
          { leader: 'L1', oppLeader: 'L2', games: 4, wins: 2, ...win },
          { leader: 'L1', oppLeader: 'L3', games: 6, wins: 3, ...win },
        ],
        cards,
      },
      'L1',
    );
    expect(same).toEqual([{ kind: 'matchup', best: true, name: 'Luffy', opp: 'Nami', games: 6, pct: 50 }]);
  });
});

describe('cartão de dicas da espera: spoilers novos', () => {
  const now = new Date(2026, 10, 27, 10, 0, 0);
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0).toISOString();

  it('há quantos dias do calendário a carta chegou', () => {
    expect(daysAgo(at(2026, 10, 27, 9), now)).toBe(0);
    // Ontem à noite, há menos de 24 horas: já é "ontem".
    expect(daysAgo(at(2026, 10, 26, 23), now)).toBe(1);
    expect(daysAgo(at(2026, 10, 21, 8), now)).toBe(6);
    // Relógio do navegador atrasado em relação ao servidor: nunca um número negativo.
    expect(daysAgo(at(2026, 10, 28, 1), now)).toBe(0);
    expect(daysAgo('sem data', now)).toBeNull();
  });

  it('as cartas da rota viram itens, na ordem em que vieram, sem a data dentro da carta', () => {
    const card = (id: string, addedAt: string) => ({ id, name: id, category: 'character' as const, colors: ['red' as const], types: [], text: '', addedAt });
    const tips = spoilerTips({ cards: [card('EB05-002', at(2026, 10, 27, 8)), card('EB05-001', at(2026, 10, 25, 8)), card('EB05-009', 'quebrada')] }, now);
    expect(tips.map((t) => (t.kind === 'spoiler' ? [t.card.id, t.daysAgo] : null))).toEqual([
      ['EB05-002', 0],
      ['EB05-001', 2],
    ]);
    expect(tips[0].kind === 'spoiler' && 'addedAt' in tips[0].card).toBe(false);
    expect(spoilerTips(null, now)).toEqual([]);
  });
});

describe('cartão de dicas da espera: rotação', () => {
  const rules: WaitTip[] = RULE_TIPS.map((key) => ({ kind: 'rule', key }));
  const data: WaitTip[] = [
    { kind: 'meta', leaders: [] },
    { kind: 'deck', name: 'Luffy', games: 5, wins: 3, pct: 60 },
  ];
  const spoiler = (id: string): WaitTip => ({ kind: 'spoiler', card: { id, name: id, category: 'character', colors: ['red'], types: [], text: '' }, daysAgo: 0 });
  const spoilers = [spoiler('EB05-001'), spoiler('EB05-002'), spoiler('EB05-003')];
  const run = (n: number, dataAt: (step: number) => readonly WaitTip[], spoilersAt: (step: number) => readonly WaitTip[] = () => []) => {
    const out: Array<WaitTip | null> = [];
    let cursor = TIP_START;
    for (let i = 0; i < n; i++) {
      const r = nextTip(cursor, rules, dataAt(i), spoilersAt(i));
      cursor = r.cursor;
      out.push(r.tip);
    }
    return out;
  };

  it('toda dica de regra tem texto no dicionário', () => {
    for (const key of RULE_TIPS) expect(ptBR[key].length).toBeGreaterThan(10);
    expect(new Set(RULE_TIPS).size).toBe(RULE_TIPS.length);
  });

  it('sem dados, passa por todas as dicas de regra antes de repetir', () => {
    const seen = run(RULE_TIPS.length + 1, () => []);
    expect(seen.slice(0, RULE_TIPS.length)).toEqual(rules);
    expect(seen[RULE_TIPS.length]).toEqual(rules[0]);
  });

  it('com dados: duas dicas de regra e um item de dados, em ciclo', () => {
    const seen = run(9, () => data);
    expect(seen.map((t) => t?.kind)).toEqual(['rule', 'rule', 'meta', 'rule', 'rule', 'deck', 'rule', 'rule', 'meta']);
    // As dicas de regra seguem na ordem, sem pular nenhuma por causa dos dados.
    expect(seen.filter((t) => t?.kind === 'rule')).toEqual(rules.slice(0, 6));
  });

  it('dados que chegam no meio da espera entram sem repetir nem pular dica de regra', () => {
    const seen = run(7, (step) => (step >= 4 ? data : []));
    expect(seen.map((t) => t?.kind)).toEqual(['rule', 'rule', 'rule', 'rule', 'rule', 'meta', 'rule']);
    expect(seen.filter((t) => t?.kind === 'rule')).toEqual(rules.slice(0, 6));
  });

  it('spoilers novos se alternam com o resto, um de cada vez, e voltam ao primeiro', () => {
    const seen = run(12, () => data, () => spoilers);
    expect(seen.map((t) => t?.kind)).toEqual(['rule', 'spoiler', 'rule', 'spoiler', 'meta', 'spoiler', 'rule', 'spoiler', 'rule', 'spoiler', 'deck', 'spoiler']);
    const cards = seen.flatMap((t) => (t?.kind === 'spoiler' ? [t.card.id] : []));
    expect(cards).toEqual(['EB05-001', 'EB05-002', 'EB05-003', 'EB05-001', 'EB05-002', 'EB05-003']);
    // O ciclo de regras e dados segue igual por baixo: nenhuma dica de regra é pulada.
    expect(seen.filter((t) => t?.kind === 'rule')).toEqual(rules.slice(0, 4));
  });

  it('spoilers que chegam no meio da espera entram na vez seguinte', () => {
    const seen = run(6, () => [], (step) => (step >= 2 ? spoilers : []));
    expect(seen.map((t) => t?.kind)).toEqual(['rule', 'rule', 'rule', 'spoiler', 'rule', 'spoiler']);
    expect(seen.filter((t) => t?.kind === 'rule')).toEqual(rules.slice(0, 4));
  });

  it('só spoilers: o cartão passa por eles', () => {
    let cursor = TIP_START;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextTip(cursor, [], [], spoilers);
      cursor = r.cursor;
      if (r.tip?.kind === 'spoiler') ids.push(r.tip.card.id);
    }
    expect(ids).toEqual(['EB05-001', 'EB05-002', 'EB05-003', 'EB05-001']);
  });

  it('sem nenhuma lista não há o que mostrar', () => {
    expect(nextTip(TIP_START, [], []).tip).toBeNull();
    expect(nextTip(TIP_START, [], data).tip).toEqual(data[0]);
  });

  it('embaralhar: mesma semente, mesma ordem; nada some nem se repete', () => {
    const a = shuffled(RULE_TIPS, 42);
    expect(shuffled(RULE_TIPS, 42)).toEqual(a);
    expect([...a].sort()).toEqual([...RULE_TIPS].sort());
    expect(shuffled(RULE_TIPS, 7)).not.toEqual(a);
  });
});
