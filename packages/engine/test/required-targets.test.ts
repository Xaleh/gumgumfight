// Escolha sem "up to": o jogador escolhe o máximo possível até o número pedido; só com "up to"
// pode escolher 0 (8-4-4-1). "You may <ação> 1 …" deixa a ação inteira opcional, mas quem aceita
// escolhe o alvo (docs/rules/divergencias.md, DV-08).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { buildCardDef, parseTarget } from '../src/cards';
import { applyAction, createGame, IllegalActionError, locate } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, EffectStep, GameConfig, GameState, PlayerId, TargetRef } from '../src/types';
import { cards as baseCards } from './helpers';

const load = (set: string) => (JSON.parse(readFileSync(join(__dirname, `../../../data/cards/${set}.json`), 'utf8')) as { cards: CardData[] }).cards;
const cards = [...baseCards, ...load('op01'), ...load('st24')];

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });
const config = (leader = 'OP01-002'): GameConfig => ({
  seed: 3,
  firstPlayer: 0,
  cards,
  players: [
    { name: 'A', deck: deck(leader) },
    { name: 'B', deck: deck('ST01-001') },
  ],
});

/** Turno 3 do jogador 0 (depois dos mulligans), com as ações usadas para chegar lá. */
function turn3(leader?: string): { s: GameState; actions: Action[] } {
  const actions: Action[] = [
    { type: 'mulligan', player: 0, redraw: false },
    { type: 'mulligan', player: 1, redraw: false },
    { type: 'endTurn', player: 0 },
    { type: 'endTurn', player: 1 },
  ];
  let s = createGame(config(leader));
  for (const a of actions) s = applyAction(s, a);
  return { s, actions };
}
/** Troca a carta do topo do deck por `cardId` (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
const field = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested: false, don: 0, playedOnTurn: 0 });
  return uid;
};
const choose = (s: GameState, uids: string[]) => applyAction(s, { type: 'choose', player: s.pending!.player, uids });
const answer = (s: GameState, yes: boolean) => applyAction(s, { type: 'answer', player: s.pending!.player, yes });
const rested = (s: GameState, uid: string) => locate(s, uid)!.fc.rested;

/** Law OP01-002 com 5 Personagens (3 vermelhos, 2 verdes) e um Personagem verde de custo 4 na mão. */
function lawSetup() {
  const { s, actions } = turn3();
  const red = [field(s, 0, 'ST01-003'), field(s, 0, 'ST01-008'), field(s, 0, 'ST01-009')];
  const green = [field(s, 0, 'ST02-002'), field(s, 0, 'ST02-011')];
  const greenInHand = hand(s, 0, 'ST02-006');
  return { s, actions, red, green, greenInHand };
}
const activateLaw = (s: GameState) => {
  s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
  return s.pending?.kind === 'confirm' ? answer(s, true) : s;
};

describe('Escolha sem "up to" é obrigatória (DV-08)', () => {
  it('Law OP01-002: "return 1 of your Characters" não aceita 0 alvos', () => {
    const { s: s0, red } = lawSetup();
    const s = activateLaw(s0);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, min: 1, max: 1 });
    // Antes: min 0, dava para devolver nenhum e mesmo assim jogar o Personagem da mão.
    expect(() => choose(s, [])).toThrow(IllegalActionError);
    const after = choose(s, [red[0]]);
    expect(after.players[0].hand).toContain(red[0]);
  });

  it('Law OP01-002: depois de devolver, joga só Personagem de outra cor', () => {
    const { s: s0, red, greenInHand } = lawSetup();
    let s = choose(activateLaw(s0), [red[1]]);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toContain(greenInHand);
    expect(options).not.toContain(red[1]);
    s = choose(s, [greenInHand]);
    expect(s.players[0].characters.map((c) => c.uid)).toContain(greenInHand);
    expect(s.players[0].characters).toHaveLength(5);
  });

  it('"up to" continua aceitando 0 (o "play up to 1" do Law)', () => {
    const { s: s0, red } = lawSetup();
    const s = choose(activateLaw(s0), [red[0]]);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', min: 0 });
    expect(choose(s, []).players[0].characters).toHaveLength(4);
  });

  it('o bot respeita o mínimo: devolve 1 dos próprios Personagens', () => {
    const { s: s0 } = lawSetup();
    const s = activateLaw(s0);
    const a = chooseBotAction(s, 0);
    expect(a).toMatchObject({ type: 'choose', player: 0 });
    expect((a as { uids: string[] }).uids).toHaveLength(1);
    expect(applyAction(s, a).players[0].characters).toHaveLength(4);
  });

  describe('OP07-036: "you may rest 1 of your Characters with a cost of 3 or more. If you do, rest up to 1 …"', () => {
    function play(withOwn = true) {
      const { s } = turn3('ST02-001');
      const own = withOwn ? field(s, 0, 'ST01-008') : field(s, 0, 'ST01-003'); // custo 3 / custo 1
      const opp = field(s, 1, 'ST02-002');
      const ev = hand(s, 0, 'OP07-036');
      let g = applyAction(s, { type: 'playCard', player: 0, uid: ev });
      // "Up to 1 of your Leader or Character cards gains +3000": o Líder.
      g = choose(g, [g.players[0].leader.uid]);
      return { s: g, own, opp };
    }

    it('quem aceita tem de virar 1 Personagem; não dá para escolher 0 e ainda virar o do oponente', () => {
      const { s: s0, own, opp } = play();
      expect(s0.pending).toMatchObject({ kind: 'confirm', player: 0 });
      const s = answer(s0, true);
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [own], min: 1, max: 1 });
      expect(() => choose(s, [])).toThrow(IllegalActionError);
      let g = choose(s, [own]);
      expect(rested(g, own)).toBe(true);
      g = choose(g, [opp]);
      expect(rested(g, opp)).toBe(true);
    });

    it('recusar o "you may" pula o "If you do"', () => {
      const { s: s0, own, opp } = play();
      const s = answer(s0, false);
      expect(s.pending).toBeNull();
      expect(rested(s, own)).toBe(false);
      expect(rested(s, opp)).toBe(false);
    });

    it('sem Personagem de custo 3 ou mais, nem pergunta: a ação não pode ser feita e o "If you do" não acontece', () => {
      const { s, own, opp } = play(false);
      // Antes: perguntava, "sim" virava 0 cartas e o Personagem do oponente era virado.
      expect(s.pending).toBeNull();
      expect(rested(s, own)).toBe(false);
      expect(rested(s, opp)).toBe(false);
      expect(s.log.some((l) => /nenhuma carta pode ser escolhida/.test(l.text))).toBe(true);
    });
  });

  it('replay gravado antes (versão 5) com 0 alvos é completado com a 1ª opção', () => {
    // Partida real (sem mutação): o Law joga Personagens de custo 1 até ter 5 e ativa o efeito.
    const cfg = config();
    let s = createGame(cfg);
    const old: Action[] = [];
    const act = (a: Action) => {
      old.push(a);
      s = applyAction(s, a);
    };
    act({ type: 'mulligan', player: 0, redraw: false });
    act({ type: 'mulligan', player: 1, redraw: false });
    const me = () => s.players[0];
    while (me().characters.length < 5) {
      while (s.activePlayer === 0 && me().donActive > 0 && me().hand.length && me().characters.length < 5) {
        act({ type: 'playCard', player: 0, uid: me().hand[0] });
      }
      if (me().characters.length < 5) act({ type: 'endTurn', player: s.activePlayer });
    }
    expect(s.activePlayer).toBe(0);
    act({ type: 'activate', player: 0, uid: me().leader.uid, ability: 0 });
    if (s.pending?.kind === 'confirm') act({ type: 'answer', player: 0, yes: true });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', min: 1 });
    const first = (s.pending as { options: string[] }).options[0];
    // O roteiro antigo devolvia 0 Personagens (hoje ilegal) e encerrava o turno.
    const script: Action[] = [...old, { type: 'choose', player: 0, uids: [] }, { type: 'endTurn', player: 0 }];
    const modern = upgradeReplayActions(cfg, script);
    expect(modern[old.length]).toEqual({ type: 'choose', player: 0, uids: [first] });
    let g = createGame(cfg);
    for (const a of modern) g = applyAction(g, a);
    expect(g.players[0].hand).toContain(first);
    expect(upgradeReplayActions(cfg, modern)).toEqual(modern);
  });
});

describe('Parser: marca a escolha obrigatória (DV-08)', () => {
  const req = (t: TargetRef | null) => typeof t === 'object' && t !== null && Boolean(t.required);

  it('sem "up to" é obrigatória; com "up to", não', () => {
    expect(req(parseTarget('1 of your Characters'))).toBe(true);
    expect(req(parseTarget("2 of your opponent's Characters with a cost of 3 or less"))).toBe(true);
    expect(req(parseTarget('your Leader or 1 of your Characters'))).toBe(true);
    expect(req(parseTarget('up to 1 of your Characters'))).toBe(false);
    expect(req(parseTarget("up to 1 of your opponent's Characters"))).toBe(false);
    expect(req(parseTarget('all of your Characters'))).toBe(false);
  });

  // Varredura das cartas da base (data/cards + data/spoilers).
  const all = ['cards', 'spoilers'].flatMap((dir) =>
    readdirSync(join(__dirname, `../../../data/${dir}`))
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => (JSON.parse(readFileSync(join(__dirname, `../../../data/${dir}/${f}`), 'utf8')) as { cards: CardData[] }).cards),
  );
  const steps = (c: CardData): EffectStep[] => buildCardDef(c).abilities.flatMap((a) => a.steps);
  const requiredSteps = (c: CardData) => steps(c).filter((st) => 'target' in st && req(st.target as TargetRef));

  it('Law OP01-002 e OP07-036 têm alvo obrigatório', () => {
    const byId = (id: string) => all.find((c) => c.id === id)!;
    expect(requiredSteps(byId('OP01-002')).map((st) => st.do)).toEqual(['returnToHand']);
    expect(requiredSteps(byId('OP07-036')).map((st) => st.do)).toEqual(['rest']);
  });

  it('"Give up to N rested DON!! cards to your Leader or 1 of your Characters": dar 0 DON!! é permitido, o alvo fica opcional', () => {
    const give = all.flatMap((c) => steps(c).filter((st) => st.do === 'giveRestedDon'));
    expect(give.length).toBeGreaterThan(10);
    expect(give.filter((st) => 'target' in st && req(st.target as TargetRef))).toEqual([]);
  });
});
