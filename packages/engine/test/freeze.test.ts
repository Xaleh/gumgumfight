// "Freeze": cartas que não desviram na próxima Fase de Renovação do dono. O efeito vale por exatamente
// uma Renovação (a próxima do dono da carta): nem some antes dela, nem sobra para a seguinte. Junto, o
// Líder Monkey.D.Luffy verde do OP18 (OP18-022) e o Zoro & Sogeking (OP18-027).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCardDef } from '../src/cards';
import { applyAction, createGame, getPower, YONKO_TABLE } from '../src/engine';
import { fixCard } from '../src/errata';
import { cardStatuses } from '../src/status';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, toTurn } from './helpers';

const op18 = (JSON.parse(readFileSync(join(__dirname, 'fixtures/op18-oficial.json'), 'utf8')) as { cards: CardData[] }).cards.map(fixCard);

const char = (id: string, name: string, text: string, extra: Partial<CardData> = {}): CardData => ({ id, name, category: 'character', colors: ['green'], cost: 1, power: 2000, types: [], text, ...extra });
const extra: CardData[] = [
  char('FZ-001', 'Gelo', "[On Play] Up to 1 of your opponent's rested Characters will not become active in your opponent's next Refresh Phase."),
  char('FZ-002', 'Gelo de DON!!', "[On Play] Up to 1 of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase."),
  char('FZ-003', 'Gelo de 2 DON!!', "[On Play] Up to 2 of your opponent's rested DON!! cards will not become active in your opponent's next Refresh Phase."),
  char('FZ-004', 'De Novo', '[On Play] Take an extra turn after this one.'),
  char('FZ-005', 'Sono', "[On Play] Rest up to 1 of your opponent's cards."),
  char('FZ-006', 'Carrasco', "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 5 or less."),
  char('FZ-007', 'Volta', "[On Play] Return up to 1 of your opponent's Characters with a cost of 5 or less to the owner's hand."),
  char('FZ-008', 'Atirador', "[When Attacking] K.O. up to 1 of your opponent's Characters with a cost of 5 or less.", { cost: 5, power: 6000 }),
  char('FZ-009', 'Grandão', '', { cost: 5, power: 8000 }),
  char('FZ-010', 'Gelo de carta', "[On Play] Up to 1 of your opponent's rested cards will not become active in your opponent's next Refresh Phase."),
  { id: 'FZ-L', name: 'Capitão', category: 'leader', colors: ['green'], life: 5, power: 5000, types: [], text: '' },
];
const cards = [...baseCards, ...op18, ...extra];

const LUFFY = 'OP18-022';
const ZORO_SOGEKING = 'OP18-027';
const CHOPPER = 'OP18-029';
const BUGGY = 'OP18-032';

const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });

function game(leaders: [string, string] = ['ST01-001', 'ST02-001']): GameState {
  let s = createGame({ seed: 7, firstPlayer: 0, cards, players: [{ name: 'A', deck: deck(leaders[0]) }, { name: 'B', deck: deck(leaders[1]) }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}
const take = (s: GameState, player: PlayerId, cardId: string) => {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
};
const field = (s: GameState, player: PlayerId, cardId: string, rested = false) => {
  const uid = take(s, player, cardId);
  s.players[player].characters.push({ uid, rested, don: 0, playedOnTurn: 0 });
  return uid;
};
const fc = (s: GameState, uid: string) => s.players.flatMap((p) => [p.leader, ...p.characters]).find((c) => c.uid === uid)!;
const rested = (s: GameState, uid: string) => fc(s, uid).rested;
const frozen = (s: GameState, uid: string) => cardStatuses(s, uid).some((x) => x.kind === 'skipRefresh');
/** Joga `cardId` da mão (com DON!! de sobra) e, se o efeito pedir, escolhe `targets`. */
function play(s: GameState, player: PlayerId, cardId: string, targets?: string[]): GameState {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  s.players[player].donActive += 10;
  s = applyAction(s, { type: 'playCard', player, uid });
  if (targets && s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player, uids: targets });
  return s;
}
const pass = (s: GameState) => applyAction(s, { type: 'endTurn', player: s.activePlayer });
/** O defensor não usa [Blocker] nem Counter; a Vida vai para a mão sem [Trigger]. */
function noDefense(s: GameState): GameState {
  for (let guard = 0; guard < 10; guard++) {
    if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: s.pending.player, uids: [] });
    else if (s.pending?.kind === 'counter') s = applyAction(s, { type: 'pass', player: s.pending.player });
    else if (s.pending?.kind === 'lifeCard') s = applyAction(s, { type: 'answer', player: s.pending.player, yes: false });
    else break;
  }
  return s;
}
/** "Your opponent's cards" inclui DON!!: responde "uma carta" à pergunta e escolhe `uid`. */
function pickCard(s: GameState, uid: string): GameState {
  if (s.pending?.kind === 'option') s = applyAction(s, { type: 'option', player: s.pending.player, index: s.pending.options.findIndex((o) => /carta/i.test(o)) });
  if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: s.pending.player, uids: [uid] });
  return s;
}
const attack = (s: GameState, attacker: string, target: string) => applyAction(s, { type: 'attack', player: s.activePlayer, attacker, target });

describe('freeze: vale por exatamente uma Fase de Renovação', () => {
  it('Personagem do oponente congelado no meu turno: fica virado na próxima Renovação dele e desvira na seguinte', () => {
    let s = toTurn(game(), 3);
    const victim = field(s, 1, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    expect(frozen(s, victim)).toBe(true);
    s = pass(s); // turno 4 (B): a Renovação dele pula a carta
    expect(s.turn).toBe(4);
    expect(rested(s, victim)).toBe(true);
    expect(frozen(s, victim)).toBe(false);
    s = pass(s); // turno 5 (A)
    expect(rested(s, victim)).toBe(true);
    s = pass(s); // turno 6 (B): desvira
    expect(rested(s, victim)).toBe(false);
  });

  it('congelado no turno do próprio dono (Buggy [On K.O.]): vale para a próxima Renovação dele, dois turnos depois', () => {
    let s = toTurn(game(), 4); // turno de B
    const buggy = field(s, 0, BUGGY, true);
    const attacker = field(s, 1, 'FZ-009');
    s = noDefense(attack(s, attacker, buggy));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [attacker] });
    expect(s.players[0].characters.some((c) => c.uid === buggy)).toBe(false);
    expect(frozen(s, attacker)).toBe(true);
    s = pass(s); // turno 5 (A)
    expect(frozen(s, attacker)).toBe(true);
    s = pass(s); // turno 6 (B): a Renovação pula
    expect(rested(s, attacker)).toBe(true);
    expect(frozen(s, attacker)).toBe(false);
    s = pass(pass(s)); // turno 8 (B)
    expect(rested(s, attacker)).toBe(false);
  });

  it('carta congelada que chega ativa na Renovação: o freeze acaba ali e não sobra para a seguinte', () => {
    let s = toTurn(game(), 3);
    const victim = field(s, 1, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    fc(s, victim).rested = false; // desvirada por um efeito antes da Renovação
    s = pass(s); // turno 4 (B)
    expect(frozen(s, victim)).toBe(false);
    fc(s, victim).rested = true; // atacou
    s = pass(pass(s)); // turno 6 (B)
    expect(rested(s, victim)).toBe(false);
  });

  it('dois freezes na mesma carta não somam duas Renovações', () => {
    let s = toTurn(game(), 3);
    const victim = field(s, 1, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    s = play(s, 0, 'FZ-001', [victim]);
    s = pass(s);
    expect(rested(s, victim)).toBe(true);
    s = pass(pass(s));
    expect(rested(s, victim)).toBe(false);
  });

  it('Chopper (OP18-029): fica ativo ao atacar e não desvira só na próxima Renovação', () => {
    let s = toTurn(game(), 3);
    const chopper = field(s, 0, CHOPPER);
    s = noDefense(attack(s, chopper, s.players[1].leader.uid));
    expect(rested(s, chopper)).toBe(false);
    expect(frozen(s, chopper)).toBe(true);
    s = noDefense(attack(s, chopper, s.players[1].leader.uid)); // segundo ataque: vira
    expect(rested(s, chopper)).toBe(true);
    s = pass(pass(s)); // turno 5 (A)
    expect(rested(s, chopper)).toBe(true);
    expect(frozen(s, chopper)).toBe(false);
    s = pass(pass(s)); // turno 7 (A)
    expect(rested(s, chopper)).toBe(false);
  });

  it('turno extra de quem congelou: o Personagem do oponente continua congelado até a Renovação dele', () => {
    let s = toTurn(game(), 3);
    const victim = field(s, 1, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    s = play(s, 0, 'FZ-004');
    s = pass(s); // turno 4: turno extra de A
    expect(s.activePlayer).toBe(0);
    expect(frozen(s, victim)).toBe(true);
    s = pass(s); // turno 5 (B)
    expect(s.activePlayer).toBe(1);
    expect(rested(s, victim)).toBe(true);
    s = pass(pass(s)); // turno 7 (B)
    expect(rested(s, victim)).toBe(false);
  });

  it('turno extra do oponente: a minha carta congelada continua congelada até a minha Renovação', () => {
    let s = toTurn(game(), 3);
    const chopper = field(s, 0, CHOPPER);
    s = noDefense(attack(s, chopper, s.players[1].leader.uid));
    s = noDefense(attack(s, chopper, s.players[1].leader.uid));
    s = pass(s); // turno 4 (B)
    s = play(s, 1, 'FZ-004');
    s = pass(s); // turno 5: turno extra de B
    expect(s.activePlayer).toBe(1);
    expect(frozen(s, chopper)).toBe(true);
    s = pass(s); // turno 6 (A)
    expect(s.activePlayer).toBe(0);
    expect(rested(s, chopper)).toBe(true);
    s = pass(pass(s)); // turno 8 (A)
    expect(rested(s, chopper)).toBe(false);
  });

  it('carta que sai do campo perde o freeze', () => {
    let s = toTurn(game(), 3);
    const victim = field(s, 1, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    s = play(s, 0, 'FZ-007', [victim]);
    expect(s.players[1].hand).toContain(victim);
    expect(s.modifiers.some((m) => m.uid === victim)).toBe(false);
  });

  it('Líder e Stage do oponente também ficam congelados por uma Renovação ("rested cards")', () => {
    let s = toTurn(game(), 3);
    const leader = s.players[1].leader.uid;
    fc(s, leader).rested = true;
    s = play(s, 0, 'FZ-010');
    // "cartas" inclui DON!!: primeiro a pergunta do que congelar.
    s = pickCard(s, leader);
    expect(frozen(s, leader)).toBe(true);
    s = pass(s);
    expect(rested(s, leader)).toBe(true);
    s = pass(pass(s));
    expect(rested(s, leader)).toBe(false);
  });
});

describe('freeze de DON!!', () => {
  it('1 DON!! virado do oponente fica virado na próxima Renovação dele e desvira na seguinte', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested = 2;
    s.players[1].donActive = 0;
    s = play(s, 0, 'FZ-002');
    s = pass(s); // turno 4 (B): 2 DON!! do DON!! Phase + 1 que desvirou
    expect(s.players[1].donRested).toBe(1);
    expect(s.players[1].donActive).toBe(3);
    s = pass(pass(s)); // turno 6 (B)
    expect(s.players[1].donRested).toBe(0);
  });

  it('sem DON!! virado na hora do efeito, nenhum fica congelado (mesmo que vire um depois)', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested = 0;
    s.players[1].donActive = 2;
    s = play(s, 0, 'FZ-002');
    // Depois do efeito, o oponente vira 1 DON!! (pagou um Counter, por exemplo).
    s.players[1].donActive = 1;
    s.players[1].donRested = 1;
    s = pass(s);
    expect(s.players[1].donRested).toBe(0);
  });

  it('DON!! dados a cartas não são "DON!! virados": não ficam congelados quando voltam na Renovação', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested = 0;
    s.players[1].donActive = 0;
    s.players[1].leader.don = 2;
    s = play(s, 0, 'FZ-002');
    s = pass(s);
    expect(s.players[1].donRested).toBe(0);
  });

  it('"up to 2" com só 1 DON!! virado congela 1', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested = 1;
    s.players[1].donActive = 1;
    s = play(s, 0, 'FZ-003');
    s.players[1].donActive = 0;
    s.players[1].donRested = 2; // virou mais um depois do efeito
    s = pass(s);
    expect(s.players[1].donRested).toBe(1);
  });

  it('dois efeitos não congelam o mesmo DON!! duas vezes', () => {
    let s = toTurn(game(), 3);
    s.players[1].donRested = 1;
    s.players[1].donActive = 1;
    s = play(s, 0, 'FZ-002');
    s = play(s, 0, 'FZ-002');
    s.players[1].donActive = 0;
    s.players[1].donRested = 2;
    s = pass(s);
    expect(s.players[1].donRested).toBe(1);
  });
});

describe('Líder Monkey.D.Luffy (OP18-022)', () => {
  /** Turno 3 de A com o Luffy: 3 DON!! no Líder, ataca e usa o efeito. */
  function attacked(yes = true): GameState {
    let s = toTurn(game([LUFFY, 'ST02-001']), 3);
    const leader = s.players[0].leader;
    s.players[0].donActive -= 3;
    leader.don = 3;
    s = attack(s, leader.uid, s.players[1].leader.uid);
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = applyAction(s, { type: 'answer', player: 0, yes });
    return noDefense(s);
  }

  it('sem 3 DON!! o efeito não aparece; recusando, o Líder vira e não fica congelado', () => {
    let s = toTurn(game([LUFFY, 'ST02-001']), 3);
    const leader = s.players[0].leader;
    leader.don = 2;
    s = attack(s, leader.uid, s.players[1].leader.uid);
    expect(s.pending?.kind).not.toBe('confirm');

    s = attacked(false);
    const l = s.players[0].leader.uid;
    expect(rested(s, l)).toBe(true);
    expect(frozen(s, l)).toBe(false);
    s = pass(pass(s));
    expect(rested(s, l)).toBe(false);
  });

  it('passa a vez em pé e o oponente vira o Líder: ele não desvira na Renovação, só na seguinte', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    expect(rested(s, leader)).toBe(false);
    expect(frozen(s, leader)).toBe(true);
    s = pass(s); // turno 4 (B)
    expect(rested(s, leader)).toBe(false);
    expect(frozen(s, leader)).toBe(true);
    // O oponente vira o Líder com um efeito.
    s = play(s, 1, 'FZ-005');
    s = pickCard(s, leader);
    expect(rested(s, leader)).toBe(true);
    s = pass(s); // turno 5 (A): a Renovação não desvira o Líder
    expect(s.activePlayer).toBe(0);
    expect(rested(s, leader)).toBe(true);
    expect(frozen(s, leader)).toBe(false);
    expect(s.players[0].leader.don).toBe(0);
    s = pass(pass(s)); // turno 7 (A)
    expect(rested(s, leader)).toBe(false);
  });

  it('passa a vez em pé e ninguém vira o Líder: ele segue ativo e o freeze acaba na Renovação', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    s = pass(pass(s)); // turno 5 (A)
    expect(rested(s, leader)).toBe(false);
    expect(frozen(s, leader)).toBe(false);
    // Ataca sem o efeito (sem DON!!): vira e desvira normalmente no turno 7.
    s = noDefense(attack(s, leader, s.players[1].leader.uid));
    expect(rested(s, leader)).toBe(true);
    s = pass(pass(s));
    expect(rested(s, leader)).toBe(false);
  });

  it('ataca de novo no mesmo turno (fica virado): não desvira na Renovação seguinte', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    s = attack(s, leader, s.players[1].leader.uid);
    // [Once Per Turn]: a pergunta não volta.
    expect(s.pending?.kind).not.toBe('confirm');
    s = noDefense(s);
    expect(rested(s, leader)).toBe(true);
    s = pass(pass(s));
    expect(rested(s, leader)).toBe(true);
    s = pass(pass(s));
    expect(rested(s, leader)).toBe(false);
  });

  it('Zoro & Sogeking: 7000 de poder base no turno do oponente com o Líder ativo e 3 DON!!; some na hora em que o Personagem sai', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    const zs = field(s, 0, ZORO_SOGEKING);
    // No meu turno não vale: 5000 + 3 DON!!.
    expect(getPower(s, leader)).toBe(8000);
    s = pass(s); // turno 4 (B): os DON!! continuam no Líder, que está ativo
    expect(s.players[0].leader.don).toBe(3);
    expect(getPower(s, leader)).toBe(7000);
    // K.O. por efeito: o bônus some na hora.
    s = play(s, 1, 'FZ-006', [zs]);
    expect(s.players[0].characters.some((c) => c.uid === zs)).toBe(false);
    expect(getPower(s, leader)).toBe(5000);
  });

  it('Zoro & Sogeking devolvido para a mão: o Líder volta a 5000 na hora', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    const zs = field(s, 0, ZORO_SOGEKING);
    s = pass(s);
    expect(getPower(s, leader)).toBe(7000);
    s = play(s, 1, 'FZ-007', [zs]);
    expect(s.players[0].hand).toContain(zs);
    expect(getPower(s, leader)).toBe(5000);
  });

  it('Zoro & Sogeking nocauteado no meio do ataque: a batalha já conta 5000', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    const zs = field(s, 0, ZORO_SOGEKING);
    s = pass(s);
    const shooter = field(s, 1, 'FZ-008'); // 6000: perde para 7000, ganha de 5000
    const life = s.players[0].life.length;
    s = attack(s, shooter, leader);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 1 });
    s = applyAction(s, { type: 'choose', player: 1, uids: [zs] });
    expect(getPower(s, leader)).toBe(5000);
    s = noDefense(s);
    expect(s.players[0].life.length).toBe(life - 1);
  });

  it('Zoro & Sogeking: com o Líder virado ou com menos de 3 DON!! não vale; virado o próprio Personagem, vale', () => {
    let s = attacked();
    const leader = s.players[0].leader.uid;
    const zs = field(s, 0, ZORO_SOGEKING, true);
    s = pass(s);
    expect(getPower(s, leader)).toBe(7000);
    fc(s, leader).rested = true;
    expect(getPower(s, leader)).toBe(5000);
    fc(s, leader).rested = false;
    fc(s, leader).don = 2;
    expect(getPower(s, leader)).toBe(5000);
    fc(s, leader).don = 3;
    expect(getPower(s, leader)).toBe(7000);
    // Dois Zoro & Sogeking não somam: o poder base "passa a ser" 7000.
    field(s, 0, ZORO_SOGEKING);
    expect(getPower(s, leader)).toBe(7000);
    expect(rested(s, zs)).toBe(true);
  });
});

describe('freeze na mesa com mais de dois jogadores', () => {
  function table(): GameState {
    let s = createGame({
      seed: 3,
      firstPlayer: 0,
      cards,
      table: YONKO_TABLE,
      players: ['A', 'B', 'C'].map((name) => ({ name, deck: { id: name, name, leader: 'FZ-L', cards: [{ id: 'ST01-006', count: 50 }] } })),
    });
    for (let guard = 0; guard < 20 && s.phase === 'mulligan'; guard++) {
      const p = s.pending!;
      if (p.kind === 'mulligan') s = applyAction(s, { type: 'mulligan', player: p.player, redraw: false });
      else if (p.kind === 'option') s = applyAction(s, { type: 'option', player: p.player, index: 0 });
      else break;
    }
    return s;
  }

  it('congelado no turno do próprio dono por outro jogador: continua congelado até a Renovação do dono', () => {
    let s = table();
    while (s.activePlayer !== 1 || s.turn < 4) s = pass(s);
    const buggy = field(s, 0, BUGGY, true);
    const attacker = field(s, 1, 'FZ-009');
    s = noDefense(attack(s, attacker, buggy));
    expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0 });
    s = applyAction(s, { type: 'choose', player: 0, uids: [attacker] });
    expect(frozen(s, attacker)).toBe(true);
    s = pass(s); // C
    s = pass(s); // A: o turno de quem congelou começa antes da Renovação de B
    expect(s.activePlayer).toBe(0);
    expect(frozen(s, attacker)).toBe(true);
    s = pass(s); // B: a Renovação pula
    expect(s.activePlayer).toBe(1);
    expect(rested(s, attacker)).toBe(true);
    expect(frozen(s, attacker)).toBe(false);
    while (s.activePlayer !== 0) s = pass(s);
    s = pass(s); // B de novo
    expect(rested(s, attacker)).toBe(false);
  });

  it('congelado no turno de quem congelou: fica virado na Renovação do dono e desvira na seguinte', () => {
    let s = table();
    while (s.activePlayer !== 0 || s.turn < 4) s = pass(s);
    const victim = field(s, 2, 'ST01-006', true);
    s = play(s, 0, 'FZ-001', [victim]);
    s = pass(s); // B
    expect(frozen(s, victim)).toBe(true);
    s = pass(s); // C
    expect(rested(s, victim)).toBe(true);
    s = pass(pass(pass(s))); // C de novo
    expect(s.activePlayer).toBe(2);
    expect(rested(s, victim)).toBe(false);
  });
});
