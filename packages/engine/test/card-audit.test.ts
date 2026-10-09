import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, attackError, canPayCost, costInHand, createGame, getPower, hasKeyword, hasName, koProtected, matchesFilter } from '../src/engine';
import { fixCard } from '../src/errata';
import { upgradeReplayActions } from '../src/replay';
import { applySourceFixes } from '../src/source-fixes';
import type { Ability, Action, CardData, DeckList, EffectStep, GameState, PlayerId } from '../src/types';
import { cards as baseCards, noDefense, toTurn } from './helpers';

// Auditoria das cartas automatizadas (card 21 do Trello, "Testar as funcionalidades das cartas em
// busca de bugs"): texto oficial x o que o motor entendia. Cartas reais da optcgapi.
const auditCards = (JSON.parse(readFileSync(join(__dirname, 'fixtures/bugs-auditoria-cartas.json'), 'utf8')) as { cards: CardData[] }).cards;
// Cartas de teste: um Evento que faz o oponente descartar (ST33-004).
const synthetic: CardData[] = [
  { id: 'AU-001', name: 'Descarte', category: 'event', colors: ['blue'], cost: 0, types: [], text: '[Main] Your opponent trashes 1 card from their hand.' },
];
const cards = [...baseCards, ...auditCards, ...synthetic];
const byId = (id: string) => cards.find((c) => c.id === id)!;
const def = (id: string) => buildCardDef(byId(id));
const abilities = (id: string): Ability[] => def(id).abilities;

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['ST01-001', 'ST02-001'], seed = 7): GameState {
  let s = createGame({
    seed,
    firstPlayer: 0,
    cards,
    players: [
      { name: 'A', deck: deck(leaders[0]) },
      { name: 'B', deck: deck(leaders[1]) },
    ],
  });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
/** Troca a carta do topo do deck por `cardId` (mutação direta, só para testes). */
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= def(cardId);
  return uid;
};
const hand = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
};
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const emptyHand = (s: GameState, player: PlayerId) => {
  const ps = s.players[player];
  ps.deck.push(...ps.hand.splice(0));
};
const setDon = (s: GameState, player: PlayerId, active: number, rested = 0) => {
  const ps = s.players[player];
  ps.donDeck = 10 - active - rested;
  ps.donActive = active;
  ps.donRested = rested;
};
const answer = (s: GameState, yes: boolean) => applyAction(s, { type: 'answer', player: s.pending!.player, yes });
const stepsOf = (id: string, timing: Ability['timing']) => abilities(id).find((a) => a.timing === timing)!.steps;
/** Responde "Nenhum" na escolha entre carta e DON!! do oponente. */
const nothing = (s: GameState) => {
  const p = s.pending;
  return p?.kind === 'option' ? applyAction(s, { type: 'option', player: p.player, index: p.options.length - 1 }) : s;
};

describe('Law OP01-002: "Then, play … different color than the returned Character" depende da devolução', () => {
  it('com 4 Personagens não devolve nada e também não joga o Personagem da mão', () => {
    let s = toTurn(game(['OP01-002', 'ST02-001']), 3);
    setDon(s, 0, 2);
    for (const id of ['ST01-003', 'ST01-008', 'ST01-009', 'ST02-002']) field(s, 0, id);
    const inHand = hand(s, 0, 'ST02-006');
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    // Antes: a jogada de graça abria mesmo sem a devolução (qualquer cor, custo até 5).
    expect(s.pending).toBeNull();
    expect(s.players[0].hand).toContain(inHand);
    expect(s.players[0].characters).toHaveLength(4);
  });
});

describe('Shu OP11-088: "can be activated when your opponent\'s Character attacks"', () => {
  it('o ataque do Líder do oponente não gasta o [Once Per Turn]; o ataque seguinte de um Personagem (Slash) dá +5000', () => {
    let s = toTurn(game(), 4);
    setDon(s, 1, 4);
    const shu = field(s, 0, 'OP11-088');
    const zoro = field(s, 1, 'ST01-013'); // "Slash"
    const base = getPower(s, shu);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target: s.players[0].leader.uid });
    expect(getPower(s, shu)).toBe(base);
    s = noDefense(s);
    expect(s.battle).toBeNull();
    s = applyAction(s, { type: 'attack', player: 1, attacker: zoro, target: s.players[0].leader.uid });
    expect(getPower(s, shu)).toBe(base + 5000);
  });

  it('a condição de ativação fica na habilidade e o atributo no efeito', () => {
    const ab = abilities('OP11-088').find((a) => a.timing === 'onOpponentAttack')!;
    expect(ab.condition).toEqual({ attackerCharacter: true });
    expect(ab.steps[0].if).toEqual({ attackerAttribute: 'Slash' });
  });
});

describe('Vinsmoke Ichiji OP11-043: "This effect can be activated when you only have {GERMA} Characters"', () => {
  it('é condição para ativar (não gasta o [Once Per Turn] quando não vale)', () => {
    const ab = abilities('OP11-043').find((a) => a.timing === 'onOpponentAttack')!;
    expect(ab.condition).toEqual({ onlyTypeIncludes: 'GERMA' });
    expect(ab.oncePerTurn).toBe(true);
    expect(ab.steps.every((st) => !st.if)).toBe(true);
  });
});

describe('"If you have 8 or more rested cards" conta os DON!! virados', () => {
  it('Jewelry Bonney OP12-118: com 10 DON!! virados compra 2 cartas', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 5, 5);
    const bonney = hand(s, 0, 'OP12-118');
    s = applyAction(s, { type: 'playCard', player: 0, uid: bonney });
    // Pagou 5: 10 DON!! virados. Comprou 2 e escolhe 1 para descartar.
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
  });

  it('com 7 cartas viradas não compra', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 5, 2);
    const bonney = hand(s, 0, 'OP12-118');
    s = applyAction(s, { type: 'playCard', player: 0, uid: bonney });
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('OP06-038, ST24-001 e ST16-003 usam a mesma contagem', () => {
    expect(stepsOf('OP06-038', 'counter')[1].if).toEqual({ ownRestedCardsMin: 8 });
  });
});

describe('Klabautermann EB02-033: "If you have [Merry Go] on your field" (Merry Go é um Stage)', () => {
  it('ganha [Blocker] com o Stage [Merry Go] em campo', () => {
    const s = toTurn(game(), 3);
    const klab = field(s, 0, 'EB02-033');
    expect(hasKeyword(s, klab, 'blocker')).toBe(false);
    s.players[0].stage = { uid: take(s, 0, 'EB02-041'), rested: false, don: 0, playedOnTurn: 0 };
    expect(hasKeyword(s, klab, 'blocker')).toBe(true);
  });
});

describe('Mr.2.Bon.Kurei(Bentham) OP14-091: "other than [Mr.2.Bon.Kurei.(Bentham)]"', () => {
  it('o nome do texto (com um ponto a mais) é o nome da própria carta', () => {
    const playStep = stepsOf('OP14-091', 'onKO').find((st) => st.do === 'playFrom') as Extract<EffectStep, { do: 'playFrom' }>;
    expect(playStep.filter.excludeName).toBe('Mr.2.Bon.Kurei.(Bentham)');
    expect(hasName(def('OP14-091'), playStep.filter.excludeName!)).toBe(true);
    expect(hasName(def('OP14-091'), 'Mr.3')).toBe(false);
  });
});

describe('Octoballoon OP15-106: "yellow Character or Stage card with a cost of 2 or less"', () => {
  it('cor e custo valem para as duas categorias', () => {
    const step = stepsOf('OP15-106', 'trigger')[1] as Extract<EffectStep, { do: 'playFrom' }>;
    expect(step.filter.either).toEqual([
      { color: 'yellow', category: 'character', maxCost: 2 },
      { color: 'yellow', category: 'stage', maxCost: 2 },
    ]);
  });
});

describe('"you may trash 1 card from your hand. If you do, …" com a mão vazia', () => {
  it('Roronoa Zoro OP16-035: sem carta na mão não pergunta e o Líder não recebe DON!!', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 7, 3);
    const zoro = hand(s, 0, 'OP16-035');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    // "Rest up to 1 of your opponent's cards" (carta ou DON!!): não escolhe nada.
    s = nothing(s);
    expect(s.pending).toBeNull();
    expect(s.players[0].leader.don).toBe(0);
  });

  it('com 1 carta na mão pergunta, descarta e dá os DON!! ao Líder', () => {
    let s = toTurn(game(), 3);
    emptyHand(s, 0);
    setDon(s, 0, 7, 3);
    const zoro = hand(s, 0, 'OP16-035');
    const other = hand(s, 0, 'ST01-006');
    s = applyAction(s, { type: 'playCard', player: 0, uid: zoro });
    s = nothing(s);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [other] });
    expect(s.players[0].trash).toContain(other);
    // "give up to 3 rested DON!! cards to your Leader": escolhe quantos (3, 2 ou 1).
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, options: ['3', '2', '1'] });
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.players[0].leader.don).toBe(3);
  });
});

describe('Monkey.D.Luffy EB02-061: "return 2 of your active DON!! cards"', () => {
  it('DON!! virados ou dados não pagam o custo', () => {
    let s = toTurn(game(), 3);
    const luffy = field(s, 0, 'EB02-061');
    setDon(s, 0, 1, 3);
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    // Antes: 4 DON!! em campo bastavam e o efeito perguntava.
    expect(s.pending?.kind).not.toBe('confirm');
    expect(s.players[0].donDeck).toBe(6);
  });

  it('com 2 ativos paga devolvendo os ativos (os virados ficam)', () => {
    let s = toTurn(game(), 3);
    const luffy = field(s, 0, 'EB02-061');
    setDon(s, 0, 2, 3);
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.players[0].donActive).toBe(0);
    expect(s.players[0].donRested).toBe(3);
    expect(s.players[0].donDeck).toBe(7);
  });

  it('Sengoku OP16-060 lê o mesmo custo', () => {
    expect(abilities('OP16-060')[0].cost).toEqual({ donMinus: 8, donMinusActive: true });
  });
});

describe('Portgas.D.Ace OP03-001: "When this Leader attacks or is attacked"', () => {
  it('não dispara quando o oponente ataca um Personagem', () => {
    let s = toTurn(game(['OP03-001', 'ST02-001']), 4);
    setDon(s, 1, 4);
    const target = field(s, 0, 'ST01-006', true);
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].leader.uid, target });
    expect(['block', 'counter']).toContain(s.pending?.kind);
  });

  it('é o evento "Líder ataca ou é atacado"', () => {
    expect(abilities('OP03-001')).toEqual([expect.objectContaining({ timing: 'event', event: { kind: 'leaderBattle' } })]);
  });
});

describe('Leitura de outras cartas da auditoria', () => {
  it('Foxy OP07-059: a condição vale para o Líder e para o Personagem', () => {
    const steps = stepsOf('OP07-059', 'whenAttacking').filter((st) => st.do === 'skipRefresh');
    expect(steps).toHaveLength(2);
    for (const st of steps) expect(st.if).toEqual({ minTypedCharacters: { count: 3, type: 'Foxy Pirates' } });
  });

  it('Portgas.D.Ace OP13-119: aceitar e não devolver nenhum Personagem não deixa o oponente jogar', () => {
    const steps = stepsOf('OP13-119', 'onPlay');
    expect(steps.find((st) => st.do === 'opponentPlays')!.if).toEqual({ lastDone: true });
  });

  it('Crocodile OP04-058 e Charlotte Brulee EB03-033: "returned to your DON!! deck by your effect"', () => {
    for (const id of ['OP04-058', 'EB03-033']) {
      expect(abilities(id).find((a) => a.timing === 'event')!.event).toEqual({ kind: 'donReturned', byYourEffect: true });
    }
  });

  it('Nico Robin EB03-055: "you may deal 1 damage" pergunta antes', () => {
    expect(stepsOf('EB03-055', 'onKO')).toEqual([
      { do: 'payCost', cost: {}, scope: 1 },
      { do: 'takeDamage', count: 1, opponent: true },
    ]);
  });

  it('Koala OP12-081: "using a Character\'s effect" e Sanji OP02-026: "from your hand"', () => {
    const koala = abilities('OP12-081').find((a) => a.timing === 'event')!.event!;
    expect(koala.kind === 'anyOf' && koala.events[1]).toMatchObject({ kind: 'characterPlayed', byCharacterEffect: true });
    expect(abilities('OP02-026')[0].event).toMatchObject({ kind: 'characterPlayed', who: 'self', fromHand: true });
  });
});

// ---------------------------------------------------------------------------
// Rodada 2: OP01 a OP09, e as regras confirmadas pelo dono do projeto
// ("your cards" inclui DON!!, Stage e Líder; "up to" sempre aceita 0).
// ---------------------------------------------------------------------------

const option = (s: GameState, index: number) => applyAction(s, { type: 'option', player: s.pending!.player, index });
const choose = (s: GameState, uids: string[]) => applyAction(s, { type: 'choose', player: s.pending!.player, uids });

describe('"rest N of your cards" inclui DON!!, Stage e o próprio Líder', () => {
  it('Mihawk OP14-020 (Líder): paga virando 1 DON!! ativo em vez de uma carta', () => {
    let s = toTurn(game(['OP14-020', 'ST02-001']), 3);
    setDon(s, 0, 1);
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 1 });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    expect(s.pending).toMatchObject({ kind: 'option', player: 0, options: ['1 DON!!', '0 DON!!'] });
    s = option(s, 0);
    expect(s.players[0].donRested).toBe(1);
    expect(s.players[0].leader.rested).toBe(false);
  });

  it('sem DON!! ativo, o próprio Líder paga (a carta pode se virar: o texto não diz "other")', () => {
    let s = toTurn(game(['OP14-020', 'ST02-001']), 3);
    setDon(s, 0, 0);
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 1 });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [s.players[0].leader.uid] });
    s = choose(s, [s.players[0].leader.uid]);
    expect(s.players[0].leader.rested).toBe(true);
  });
});

describe('"your opponent\'s cards" inclui DON!!', () => {
  it('Brook OP15-032: "Rest up to 1 of your opponent\'s cards" pode virar 1 DON!! ativo do oponente', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 6);
    setDon(s, 1, 3);
    field(s, 1, 'ST01-003');
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'OP15-032') });
    expect(s.pending).toMatchObject({ kind: 'option', player: 0 });
    const opts = (s.pending as { options: string[] }).options;
    expect(opts).toEqual(['Virar 1 DON!! ativo do oponente', 'Virar uma carta do oponente (Líder, Personagem ou Stage)', 'Nenhum']);
    s = option(s, 0);
    expect(s.players[1].donActive).toBe(2);
    expect(s.players[1].donRested).toBe(1);
  });

  it('Franky OP13-033 ("up to 2") e Arlong OP15-023 ("rested cards will not become active") escolhem uma a uma', () => {
    expect(stepsOf('OP13-033', 'onKO')).toHaveLength(2);
    expect(stepsOf('OP13-033', 'onKO').every((st) => st.do === 'restDonOrCharacter')).toBe(true);
    expect(stepsOf('OP15-023', 'onKO').every((st) => st.do === 'restDonOrCharacter' && st.skipRefresh)).toBe(true);
  });
});

describe('"up to N" aceita 0 nos passos de Vida e nos DON!! virados', () => {
  it('passos de Vida com "up to" (OP10-109, OP14-112) perguntam a quantidade', () => {
    expect(stepsOf('OP10-109', 'onKO')).toEqual([{ do: 'trashLife', side: 'opponent', count: 1, upTo: true }]);
    const hancock = stepsOf('OP14-112', 'onPlay');
    expect(hancock[0]).toMatchObject({ do: 'addLifeFromDeck', count: 1, upTo: true });
    expect(hancock[1]).toEqual({ do: 'opponentLifeToHand', count: 1, upTo: true });
  });

  it('escolher 0 não mexe na Vida', () => {
    let s = toTurn(game(['ST04-001', 'ST02-001']), 3);
    setDon(s, 0, 7);
    const life = s.players[1].life.length;
    s = applyAction(s, { type: 'activate', player: 0, uid: s.players[0].leader.uid, ability: 0 });
    expect(s.pending).toMatchObject({ kind: 'option', options: ['1', '0'] });
    s = option(s, 1);
    expect(s.players[1].life).toHaveLength(life);
  });
});

describe('Rodada 2: leitura e execução', () => {
  it('Crocodile OP09-046: o "cost of 5 or less" vale também para o {Cross Guild}', () => {
    const step = stepsOf('OP09-046', 'onPlay')[0] as Extract<EffectStep, { do: 'playFrom' }>;
    const buggy = { ...def('OP09-046'), hasAnyType: undefined, types: ['Cross Guild'], cost: 10, category: 'character' as const };
    expect(matchesFilter(buggy, step.filter)).toBe(false);
    expect(matchesFilter({ ...buggy, cost: 5 }, step.filter)).toBe(true);
    // Mr.3 OP09-056: o "other than [Mr.3(Galdino)]" vale para as duas opções.
    const search = stepsOf('OP09-056', 'onPlay')[0] as Extract<EffectStep, { do: 'search' }>;
    expect(search.filter.either!.every((f) => f.excludeName === 'Mr.3(Galdino)')).toBe(true);
  });

  it('Aramaki OP06-043: "place 1 Character … at the bottom of the owner\'s deck" aceita Personagem do oponente', () => {
    let s = toTurn(game(), 3);
    const aramaki = field(s, 0, 'OP06-043');
    const discard = hand(s, 0, 'ST01-006');
    const theirs = field(s, 1, 'ST01-009'); // custo 2
    const ability = def('OP06-043').abilities.findIndex((a) => a.timing === 'activateMain');
    expect(canPayCost(s, 0, aramaki, def('OP06-043').abilities[ability].cost!)).toBe(true);
    s = applyAction(s, { type: 'activate', player: 0, uid: aramaki, ability });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    for (let guard = 0; guard < 4 && s.pending?.kind === 'selectTargets'; guard++) {
      const opts = (s.pending as { options: string[] }).options;
      s = choose(s, [opts.includes(theirs) ? theirs : discard]);
    }
    expect(s.players[1].deck[s.players[1].deck.length - 1]).toBe(theirs);
    expect(getPower(s, aramaki)).toBe(def('OP06-043').power! + 3000);
    // "… at the bottom of your deck" (P-086 Law) continua só com os seus.
    expect(abilities('P-086')[0].cost!.ownToBottom!.spec.side).toBe('own');
  });

  it('Marco OP03-013 e Pudding OP03-112: texto cortado e "{Sanji}" corrigidos pela lista oficial', () => {
    const marco = applySourceFixes(byId('OP03-013'));
    expect(marco.text).toMatch(/You may trash 1 Event from your hand: You may play this Character card from your trash rested\.$/);
    expect(applySourceFixes(marco)).toBe(marco);
    expect(stepsOf('OP03-013', 'onKO').some((st) => st.do === 'playThis')).toBe(true);
    expect(applySourceFixes(byId('OP03-112')).text).toContain('reveal up to 1 [Sanji] or {Big Mom Pirates}');
  });

  it('Zephyr OP06-074: "if that Character has 5000 power or less" olha o poder atual', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 8);
    const boosted = field(s, 1, 'ST01-009'); // 4000 impresso
    s.modifiers.push({ uid: boosted, kind: 'power', amount: 2000, duration: 'turn' });
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'OP06-074') });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    if (s.pending?.kind === 'option') s = option(s, 0);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = choose(s, [boosted]);
    // 6000 agora: não é nocauteado (antes: o impresso, 4000, nocauteava).
    expect(s.players[1].characters.some((c) => c.uid === boosted)).toBe(true);
  });

  it('I Bid 500 Million!! OP05-096: o "Then, draw 1" vale para qualquer opção', () => {
    const steps = stepsOf('OP05-096', 'main');
    expect(steps.map((st) => st.do)).toEqual(['chooseOne', 'draw']);
  });

  it('Rosinante OP04-119: só os Personagens ativos de custo base 5 ficam protegidos', () => {
    const s = toTurn(game(), 4);
    field(s, 0, 'OP04-119', true);
    s.defs['ST01-010'] = { ...s.defs['ST01-010'] ?? def('ST01-010'), cost: 5 };
    const active = field(s, 0, 'ST01-010');
    const rested = field(s, 0, 'ST01-010', true);
    expect(koProtected(s, active, false, s.players[1].leader.uid, 1)).toBe(true);
    expect(koProtected(s, rested, false, s.players[1].leader.uid, 1)).toBe(false);
  });

  it('Rayleigh OP08-118: o −2000 vai para "the other" Personagem', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 8);
    const a = field(s, 1, 'ST01-010');
    const b = field(s, 1, 'ST01-008');
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'OP08-118') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = choose(s, [a]);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    expect((s.pending as { options: string[] }).options).toEqual([b]);
  });

  it('Luffy OP01-024: "by "Strike" attribute Characters" não protege contra o Líder', () => {
    expect(abilities('OP01-024').find((a) => a.noBattleKOVsAttribute)).toMatchObject({ noBattleKOVsAttribute: 'Strike', noBattleKOVsAttributeCharacters: true });
  });

  it('Helmeppo OP03-091: Personagem só com [Blocker] tem efeito base', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 1);
    const vanilla = field(s, 1, 'ST01-003');
    field(s, 1, 'ST01-006'); // [Blocker]
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'OP03-091') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [vanilla] });
  });

  it('"reveal 1 card … play up to 1" pergunta antes de jogar (OP06-057, OP08-052)', () => {
    for (const [id, timing] of [['OP06-057', 'main'], ['OP08-052', 'onPlay']] as const) {
      expect(stepsOf(id, timing).find((st) => st.do === 'playRevealed')).toMatchObject({ upTo: true });
    }
  });

  it('Hotori OP05-111: aceitar o custo obriga a jogar o [Kotori]', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 3);
    const kotori = hand(s, 0, 'OP05-103');
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'OP05-111') });
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, min: 1 });
    expect((s.pending as { options: string[] }).options).toContain(kotori);
  });

  it('Law OP01-047: "return 1 Character to your hand" pode devolver o próprio Law', () => {
    const s = toTurn(game(), 3);
    const law = field(s, 0, 'OP01-047');
    const cost = stepsOf('OP01-047', 'onPlay').find((st) => st.do === 'payCost') as Extract<EffectStep, { do: 'payCost' }>;
    expect(canPayCost(s, 0, law, cost.cost)).toBe(true);
  });
});

describe('Replays da versão 10 continuam carregando', () => {
  it('"give up to 2 rested DON!!" (Brook ST01-011): a pergunta nova recebe a quantidade máxima, como antes', () => {
    const brooks: DeckList = { id: 'b', name: 'b', leader: 'ST01-001', cards: [{ id: 'ST01-011', count: 50 }] };
    const config = {
      seed: 3,
      firstPlayer: 0 as PlayerId,
      cards,
      players: [
        { name: 'A', deck: brooks },
        { name: 'B', deck: deck('ST02-001') },
      ] as [{ name: string; deck: DeckList }, { name: string; deck: DeckList }],
    };
    const opening: Action[] = [
      { type: 'mulligan', player: 0, redraw: false },
      { type: 'mulligan', player: 1, redraw: false },
      { type: 'endTurn', player: 0 },
      { type: 'endTurn', player: 1 },
    ];
    let s = createGame(config);
    for (const a of opening) s = applyAction(s, a);
    // Turno 3: 3 DON!!; o Brook custa 2 e deixa 2 DON!! virados para o [On Play].
    const brook = s.players[0].hand[0];
    const leader = s.players[0].leader.uid;
    // Roteiro gravado na versão 10: jogar o Brook e escolher o Líder, sem a pergunta "quantos DON!!".
    const old: Action[] = [...opening, { type: 'playCard', player: 0, uid: brook }, { type: 'choose', player: 0, uids: [leader] }];
    const upgraded = upgradeReplayActions(config, old);
    expect(upgraded).toEqual([...old, { type: 'option', player: 0, index: 0 }]);
    let t = createGame(config);
    for (const a of upgraded) t = applyAction(t, a);
    expect(t.players[0].leader.don).toBe(2);
    expect(t.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rodada 3: starter decks, promos e spoilers de EB05/OP18
// ---------------------------------------------------------------------------

describe('Rodada 3: leitura e execução', () => {
  it('Sabo ST13-007: sem [Sabo] de custo 5 no topo da Vida, o Líder não ganha +2000 ("If you do")', () => {
    let s = toTurn(game(), 3);
    const sabo = field(s, 0, 'ST13-007');
    const top = s.players[0].life[s.players[0].life.length - 1];
    s.cards[top] = { ...s.cards[top], cardId: 'ST01-006' };
    const leaderPower = getPower(s, s.players[0].leader.uid);
    s = applyAction(s, { type: 'activate', player: 0, uid: sabo, ability: 0 });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    expect(s.pending).toBeNull();
    expect(getPower(s, s.players[0].leader.uid)).toBe(leaderPower);
  });

  it('Avalo Pizarro ST27-001: "rest 1 of your [Fullalead] cards" aceita o Stage [Fullalead]', () => {
    const s = toTurn(game(), 3);
    const avalo = field(s, 0, 'ST27-001');
    s.players[0].stage = { uid: take(s, 0, 'OP09-099'), rested: false, don: 0, playedOnTurn: 0 };
    const ability = def('ST27-001').abilities.find((a) => a.timing === 'activateMain')!;
    expect(canPayCost(s, 0, avalo, ability.cost!)).toBe(true);
  });

  it('Borsalino ST33-004: o descarte forçado pelo oponente também vale ("trashed by an effect")', () => {
    let s = toTurn(game(), 3);
    const borsalino = hand(s, 1, 'ST33-004');
    const cost = costInHand(s, borsalino);
    s = applyAction(s, { type: 'playCard', player: 0, uid: hand(s, 0, 'AU-001') });
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = choose(s, [s.players[1].hand.find((u) => u !== borsalino)!]);
    expect(costInHand(s, borsalino)).toBe(cost - 3);
  });

  it('Zoro OP18-017: "give your Leader −2000 power … instead" vale com o Líder virado', () => {
    const s = toTurn(game(), 4);
    const zoro = field(s, 0, 'OP18-017');
    s.players[0].leader.rested = true;
    const ab = def('OP18-017').abilities.find((a) => a.timing === 'replace')!;
    expect(ab.cost).toEqual({ leaderPowerMinus: 2000 });
    expect(canPayCost(s, 0, zoro, ab.cost!)).toBe(true);
    // "your 1 active Leader" (EB01-004) continua exigindo o Líder ativo.
    expect(stepsOf('EB01-004', 'whenAttacking')[0]).toMatchObject({ cost: { leaderPowerMinusActive: true } });
  });

  it('Zambai OP18-066: "K.O. 1 of your Stages" manda o Stage para o descarte', () => {
    let s = toTurn(game(), 3);
    const zambai = field(s, 0, 'OP18-066');
    const stage = take(s, 0, 'OP09-099');
    s.players[0].stage = { uid: stage, rested: false, don: 0, playedOnTurn: 0 };
    s = applyAction(s, { type: 'activate', player: 0, uid: zambai, ability: def('OP18-066').abilities.findIndex((a) => a.timing === 'activateMain') });
    if (s.pending?.kind === 'confirm') s = answer(s, true);
    if (s.pending?.kind === 'selectTargets') s = choose(s, [stage]);
    expect(s.players[0].stage).toBeFalsy();
    expect(s.players[0].trash).toContain(stage);
    expect(hasKeyword(s, zambai, 'rush')).toBe(true);
  });

  it('spoilers OP18-069, EB05-033 e EB05-059 deixam o modo manual', () => {
    for (const id of ['OP18-069', 'EB05-033', 'EB05-059']) expect([id, def(id).manual]).toEqual([id, false]);
    expect(abilities('OP18-069')[0]).toMatchObject({ timing: 'replace', cost: { donMinus: 1, restSelf: true } });
    expect(stepsOf('EB05-059', 'main')[1]).toMatchObject({ do: 'cannotBeKO', inBattle: true, duration: 'nextOpponentTurn' });
  });

  it('Hody & Hyouzou P-062: "Slash Strike" vira dois atributos', () => {
    expect(fixCard(byId('P-062')).attributes).toEqual(['Slash', 'Strike']);
    expect(matchesFilter(def('P-062'), { attribute: 'Strike' })).toBe(true);
  });

  it('Kid P-067: com duas cópias viradas, as duas podem ser atacadas', () => {
    const s = toTurn(game(), 4);
    const a = field(s, 0, 'P-067', true);
    const b = field(s, 0, 'P-067', true);
    const other = field(s, 0, 'ST01-003', true);
    const atk = s.players[1].leader.uid;
    expect(attackError(s, 1, atk, a)).toBeNull();
    expect(attackError(s, 1, atk, b)).toBeNull();
    expect(attackError(s, 1, atk, other)).toMatch(/Só é possível atacar/);
  });

  it('Buggy P-084: "Characters with a cost of 3 or 4 cannot attack" olha o custo atual', () => {
    const s = toTurn(game(['OP09-042', 'ST02-001']), 3);
    field(s, 0, 'P-084');
    const garp = field(s, 0, 'ST08-010'); // custo 5 impresso
    expect(attackError(s, 0, garp, s.players[1].leader.uid)).toBeNull();
    s.modifiers.push({ uid: garp, kind: 'cost', amount: -2, duration: 'turn' });
    expect(attackError(s, 0, garp, s.players[1].leader.uid)).not.toBeNull();
  });

  it('Luffy PRB02-005: o oponente vira 1 DON!! ativo no início da próxima Fase Principal dele', () => {
    expect(stepsOf('PRB02-005', 'onPlay').find((st) => st.do === 'skipRefreshDon')).toMatchObject({ count: 1, atMainPhase: true });
    let s = toTurn(game(), 3);
    s.donRestAtMain = [{ player: 1, count: 1 }];
    s = applyAction(s, { type: 'endTurn', player: 0 });
    // O jogador 1 desvirou tudo e recebeu os DON!! da fase; 1 deles foi virado no começo da Fase Principal.
    expect(s.players[1].donRested).toBe(1);
  });

  it('Zephyr ST05-010: o +3000 contra Personagem "Strike" dura o turno, não só a batalha', () => {
    let s = toTurn(game(), 4);
    setDon(s, 1, 4);
    const zephyr = field(s, 0, 'ST05-010', true);
    const base = getPower(s, zephyr);
    const strike = field(s, 1, 'ST01-010'); // Franky, "Strike"
    s = noDefense(applyAction(s, { type: 'attack', player: 1, attacker: strike, target: zephyr }));
    expect(s.battle).toBeNull();
    expect(getPower(s, zephyr)).toBe(base + 3000);
  });

  it('Thatch OP03-005: jogado de novo no mesmo turno, o Thatch novo não é descartado no fim do turno', () => {
    let s = toTurn(game(), 3);
    setDon(s, 0, 5);
    const thatch = field(s, 0, 'OP03-005');
    s = applyAction(s, { type: 'activate', player: 0, uid: thatch, ability: 0 });
    // Volta para a mão (mutação de teste) e é jogado de novo.
    s.players[0].characters = s.players[0].characters.filter((c) => c.uid !== thatch);
    s.players[0].hand.push(thatch);
    s = applyAction(s, { type: 'playCard', player: 0, uid: thatch });
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.players[0].characters.some((c) => c.uid === thatch)).toBe(true);
  });

  it('Usopp OP15-024: só efeitos de Líder e de Personagem do oponente não o viram', () => {
    expect(abilities('OP15-024').find((a) => a.staticNoRest)).toMatchObject({ staticNoRest: 'leaderOrCharacter' });
  });

  it('Gecko Moria OP06-086: o jogador escolhe qual das duas cartas entra virada', () => {
    const [step] = stepsOf('OP06-086', 'onPlay');
    expect(step.do).toBe('chooseOne');
    const options = (step as Extract<EffectStep, { do: 'chooseOne' }>).options;
    expect(options.map((o) => o.map((st) => Boolean((st as { rested?: boolean }).rested)))).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('Kid ST36-005: "turn 1 card from the top or bottom of your Life cards" deixa escolher topo ou fundo', () => {
    const ab = abilities('ST36-005').find((a) => a.timing === 'onOpponentAttack')!;
    const pay = ab.steps.find((st) => st.do === 'payCost') as Extract<EffectStep, { do: 'payCost' }> | undefined;
    expect(pay?.cost.lifeFace ?? ab.cost?.lifeFace).toMatchObject({ count: 1, topOrBottom: true });
  });
});

// ---------------------------------------------------------------------------
// Regras confirmadas depois da rodada 3
// ---------------------------------------------------------------------------

describe('"If you have [X]" conta qualquer carta sua com o nome, Líder incluído', () => {
  it('Pacifista EB04-056: o Líder [Jewelry Bonney] conta (com 0 de Vida, ganha [Blocker])', () => {
    const s = toTurn(game(['OP07-019', 'ST02-001']), 3);
    const pacifista = field(s, 0, 'EB04-056');
    s.players[0].trash.push(...s.players[0].life.splice(0));
    expect(hasKeyword(s, pacifista, 'blocker')).toBe(true);
  });

  it('Kouzuki Toki OP02-031: "a [Kouzuki Oden] Character" continua só com Personagem', () => {
    const s = toTurn(game(['EB01-001', 'ST02-001']), 3);
    const toki = field(s, 0, 'OP02-031');
    expect(hasKeyword(s, toki, 'blocker')).toBe(false);
  });

  it('Oars OP15-080: "[Gecko Moria] with 10000 power or more on your field" conta o Líder', () => {
    const cond = abilities('OP15-080').find((a) => a.staticPower)!.condition!;
    expect(cond.ownMatching!.spec.kinds).toEqual(['leader', 'character']);
  });
});
