// Resolve cada lição do tutorial sem navegador: monta a mesa, faz as jogadas que o texto pede e
// confere que cada passo de ação termina (e que o oponente roteirizado faz o que a lição conta).
// Se uma mudança no motor quebrar uma lição, este teste avisa.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Action, actingPlayer, applyAction, type CardData, type DeckList, type GameState } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import ptBR from '../src/i18n/pt-BR';
import { BATTLE_TIPS, cardIdOf, GLOSSARY, LESSONS, type Lesson, ME, OPP, type TutorialData, uidsOf } from '../src/game/tutorial/lessons';
import { humanAllowed, opponentAction } from '../src/game/tutorial/runner';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = ['st01', 'st03'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
const decks: [DeckList, DeckList] = [load('decks/st01-luffy.json'), load('decks/st03-crocodile.json')];
const data: TutorialData = { cards, decks, names: ['Você', 'Bot'] };

const one = (s: GameState, cardId: string, player = ME) => {
  const [uid] = uidsOf(s, player, cardId);
  if (!uid) throw new Error(`${cardId} não encontrado`);
  return uid;
};
const leader = (s: GameState, player = ME) => s.players[player].leader.uid;

/** As jogadas de quem resolve a lição, por passo: devolve a próxima jogada (ou null para só esperar). */
type Solver = (s: GameState) => Action | null;
const respond = (s: GameState, pick: (p: NonNullable<GameState['pending']>) => Action | null): Action | null =>
  s.pending?.player === ME ? pick(s.pending) : null;
/** Responde escolhas de alvo pegando o primeiro do oponente (ou nenhum). */
const chooseFirst = (s: GameState): Action | null =>
  respond(s, (p) => (p.kind === 'selectTargets' ? { type: 'choose', player: ME, uids: p.options.slice(0, Math.max(p.min, 1)) } : null));

const SOLUTIONS: Record<string, Record<string, Solver>> = {
  goal: { attack: (s) => (s.pending ? null : { type: 'attack', player: ME, attacker: one(s, 'ST01-013'), target: leader(s, OPP) }) },
  setup: { mulligan: (s) => respond(s, () => ({ type: 'mulligan', player: ME, redraw: true })) },
  turn: { end: (s) => (s.activePlayer === ME && !s.pending && s.turn === 3 ? { type: 'endTurn', player: ME } : null) },
  don: {
    play: (s) => ({ type: 'playCard', player: ME, uid: one(s, 'ST01-013') }),
    playNami: (s) => chooseFirst(s) ?? ({ type: 'playCard', player: ME, uid: one(s, 'ST01-007') }),
  },
  cards: {
    stage: (s) => ({ type: 'playCard', player: ME, uid: one(s, 'ST01-017') }),
    event: (s) =>
      respond(s, (p) => (p.kind === 'selectTargets' ? { type: 'choose', player: ME, uids: [one(s, 'ST03-012', OPP)] } : null)) ??
      ({ type: 'playCard', player: ME, uid: one(s, 'ST01-015') }),
    sixth: (s) =>
      chooseFirst(s) ?? respond(s, (p) => (p.kind === 'option' ? { type: 'option', player: ME, index: 0 } : null)) ??
      ({ type: 'playCard', player: ME, uid: one(s, 'ST01-011') }),
  },
  attack: {
    hitLeader: (s) => ({ type: 'attack', player: ME, attacker: one(s, 'ST01-013'), target: leader(s, OPP) }),
    hitCharacter: (s) => ({ type: 'attack', player: ME, attacker: leader(s), target: one(s, 'ST03-011', OPP) }),
  },
  giveDon: {
    give: (s) => ({ type: 'attachDon', player: ME, target: one(s, 'ST01-008') }),
    attack: (s) => ({ type: 'attack', player: ME, attacker: one(s, 'ST01-008'), target: one(s, 'ST03-012', OPP) }),
    leader: (s) =>
      s.players[ME].donActive > 0
        ? { type: 'attachDon', player: ME, target: leader(s) }
        : { type: 'attack', player: ME, attacker: leader(s), target: leader(s, OPP) },
  },
  defense: {
    incoming: () => null,
    block: (s) => respond(s, () => ({ type: 'choose', player: ME, uids: [one(s, 'ST01-006')] })),
    blocked: (s) => respond(s, () => ({ type: 'pass', player: ME })),
    next: (s) => respond(s, (p) => (p.kind === 'block' ? { type: 'choose', player: ME, uids: [] } : null)),
    counter: (s) =>
      respond(s, (p) => {
        if (p.kind === 'counter') {
          const used = s.modifiers.some((m) => m.uid === leader(s) && m.kind === 'power');
          return used ? { type: 'pass', player: ME } : { type: 'counter', player: ME, uid: one(s, 'ST01-011') };
        }
        return { type: 'answer', player: ME, yes: false };
      }),
  },
  damage: {
    incoming: () => null,
    noCounter: (s) => respond(s, () => ({ type: 'pass', player: ME })),
    trigger: (s) =>
      respond(s, (p) =>
        p.kind === 'lifeCard'
          ? { type: 'answer', player: ME, yes: true }
          : p.kind === 'selectTargets'
            ? { type: 'choose', player: ME, uids: [one(s, 'ST03-012', OPP)] }
            : null,
      ),
  },
};

/** Faz o passo de ação até `done` (o oponente joga pelo plano da lição). */
function drive(lesson: Lesson, stepIndex: number, s: GameState): GameState {
  const step = lesson.steps[stepIndex];
  const start = s;
  const solve = SOLUTIONS[lesson.id]?.[step.id];
  for (let i = 0; i < 300; i++) {
    if (step.do!.done(s, start)) return s;
    if (step.do!.fail?.(s, start)) throw new Error(`${lesson.id}/${step.id}: o passo falhou`);
    const acting = actingPlayer(s);
    let a: Action | null;
    if (acting === OPP) {
      a = opponentAction(lesson, s);
    } else {
      a = solve?.(s) ?? null;
      if (a) expect(humanAllowed(step, a, s), `${lesson.id}/${step.id}: ${JSON.stringify(a)} deveria ser permitido`).toBe(true);
    }
    if (!a) throw new Error(`${lesson.id}/${step.id}: travou (pendente: ${s.pending?.kind ?? 'nenhum'}, vez de ${acting})`);
    s = applyAction(s, a);
  }
  throw new Error(`${lesson.id}/${step.id}: não terminou`);
}

describe('lições do tutorial', () => {
  for (const lesson of LESSONS.filter((l) => l.board && l.board.opponent !== 'bot')) {
    it(`${lesson.id}: dá para cumprir todos os passos`, () => {
      let s = lesson.board!.build(data);
      lesson.steps.forEach((step, i) => {
        if (step.do) s = drive(lesson, i, s);
      });
    });
  }

  it('a batalha final começa no mulligan, com você jogando primeiro', () => {
    const s = LESSONS.find((l) => l.id === 'battle')!.board!.build(data);
    expect(s.pending?.kind).toBe('mulligan');
    expect(s.firstPlayer).toBe(ME);
  });

  it('a jogada errada fica travada no passo de ação', () => {
    const lesson = LESSONS.find((l) => l.id === 'don')!;
    const s = lesson.board!.build(data);
    const play = lesson.steps.find((x) => x.id === 'play')!;
    expect(humanAllowed(play, { type: 'playCard', player: ME, uid: one(s, 'ST01-004') }, s)).toBe(false);
    expect(humanAllowed(play, { type: 'playCard', player: ME, uid: one(s, 'ST01-013') }, s)).toBe(true);
    expect(humanAllowed(lesson.steps[0], { type: 'endTurn', player: ME }, s)).toBe(false);
  });

  it('o passo de Counter falha se o Líder levar dano', () => {
    const lesson = LESSONS.find((l) => l.id === 'defense')!;
    let s = lesson.board!.build(data);
    const counterIdx = lesson.steps.findIndex((x) => x.id === 'counter');
    for (let i = 0; i < counterIdx; i++) if (lesson.steps[i].do) s = drive(lesson, i, s);
    const start = s;
    // Só a Nami (+1000): 6000 contra 6000, o atacante vence.
    s = applyAction(s, { type: 'counter', player: ME, uid: one(s, 'ST01-007') });
    s = applyAction(s, { type: 'pass', player: ME });
    while (s.pending?.player === ME && s.pending.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: ME, yes: false });
    expect(lesson.steps[counterIdx].do!.fail!(s, start)).toBe(true);
  });

  it('todos os textos existem no dicionário', () => {
    const keys = new Set(Object.keys(ptBR));
    const need: string[] = [];
    for (const c of [1, 2, 3, 4]) need.push(`tutorial.ch${c}.name`, `tutorial.ch${c}.kicker`, `tutorial.ch${c}.desc`);
    for (const l of LESSONS) {
      need.push(`tutorial.${l.id}.name`);
      for (const st of l.steps) {
        const base = `tutorial.${l.id}.${st.id}`;
        need.push(`${base}.title`, `${base}.body`);
        if (st.quiz) {
          for (let i = 1; i <= st.quiz.options; i++) need.push(`${base}.o${i}`);
          need.push(`${base}.why`);
        }
        if (st.do?.fail) need.push(`${base}.fail`);
      }
    }
    for (const tip of BATTLE_TIPS) need.push(`tutorial.battle.tip.${tip}`);
    for (const g of GLOSSARY) need.push(`tutorial.term.${g.id}`);
    expect(need.filter((k) => !keys.has(k))).toEqual([]);
  });

  it('as cartas citadas existem nos decks do tutorial', () => {
    const ids = new Set(cards.map((c) => c.id));
    for (const l of LESSONS) for (const st of l.steps) if (st.card) expect(ids.has(st.card), st.card).toBe(true);
    expect(cardIdOf).toBeTypeOf('function');
  });
});
