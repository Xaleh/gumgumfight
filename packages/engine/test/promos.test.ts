// Promos (P-xxx) que vinham com texto estragado da optcgapi ou com efeito manual/parcial (DV-37):
// o texto é corrigido por SOURCE_TEXT_FIXES e cada efeito agora é lido pelo leitor automático.
// As cartas estão em fixtures/promos.json, como a importação do servidor as monta a partir da API.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot/simple';
import { automationStatus, buildCardDef } from '../src/cards';
import { parseCard } from '../src/cards/parser';
import { validateDeck } from '../src/deck';
import { applyAction, getPower, koProtected } from '../src/engine';
import { fixCard } from '../src/errata';
import { translateCardPt } from '../src/i18n/render';
import { applySourceFixes, SOURCE_TEXT_FIXES } from '../src/source-fixes';
import type { CardData, DeckList, GameState, PlayerId } from '../src/types';
import { cards as baseCards, noDefense, started, toTurn } from './helpers';

const promos = (JSON.parse(readFileSync(join(__dirname, 'fixtures/promos.json'), 'utf8')) as { cards: CardData[] }).cards;
const promo = (id: string) => promos.find((c) => c.id === id)!;
const cards = [...baseCards, ...promos];

/** Troca a carta do fundo do deck por `cardId` e devolve o uid (só para testes). */
function take(s: GameState, player: PlayerId, cardId: string): string {
  const uid = s.players[player].deck.pop()!;
  s.cards[uid] = { ...s.cards[uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
  return uid;
}
function toHand(s: GameState, player: PlayerId, cardId: string): string {
  const uid = take(s, player, cardId);
  s.players[player].hand.push(uid);
  return uid;
}
function onField(s: GameState, player: PlayerId, cardId: string, opts: { don?: number; rested?: boolean } = {}): string {
  const uid = take(s, player, cardId);
  const don = opts.don ?? 0;
  s.players[player].characters.push({ uid, rested: opts.rested ?? true, don, playedOnTurn: 0 });
  s.players[player].donDeck -= don;
  return uid;
}
function setLeader(s: GameState, player: PlayerId, cardId: string) {
  const leader = s.players[player].leader;
  s.cards[leader.uid] = { ...s.cards[leader.uid], cardId };
  s.defs[cardId] ??= buildCardDef(cards.find((c) => c.id === cardId)!);
}
/** DON!! ativos a mais, tirados do deck de DON!! (para pagar custos altos cedo). */
function addDon(s: GameState, player: PlayerId, n: number) {
  s.players[player].donDeck -= n;
  s.players[player].donActive += n;
}
const answer = (s: GameState, yes: boolean) => applyAction(s, { type: 'answer', player: s.pending!.player, yes });
const choose = (s: GameState, uids: string[]) => applyAction(s, { type: 'choose', player: s.pending!.player, uids });
const play = (s: GameState, uid: string) => applyAction(s, { type: 'playCard', player: s.activePlayer, uid });

describe('textos estragados na fonte (SOURCE_TEXT_FIXES)', () => {
  it('P-091, P-115, P-142 e P-147 ficam com o texto da carta', () => {
    expect(applySourceFixes(promo('P-091')).text).toMatch(/^\[On Play\] Play up to 1 \{Neptunian\}/);
    expect(applySourceFixes(promo('P-115')).text).toBe('[On Play] Give up to 1 rested DON!! card to your Leader or 1 of your Characters.');
    expect(applySourceFixes(promo('P-142')).text).toBe(
      "If your {Straw Hat Crew} type Character with 8000 base power or less would be K.O.'d, you may trash this Stage instead.",
    );
    expect(applySourceFixes(promo('P-147')).text).toMatch(/this Character gains \+2000 power\./);
  });

  it('a troca só vale para o trecho estragado e aplicar de novo não muda nada', () => {
    // As cartas de coleção da tabela (OP03-013, OP03-112) estão em card-audit.test.ts.
    for (const id of Object.keys(SOURCE_TEXT_FIXES).filter((k) => k.startsWith('P-'))) {
      const fixed = applySourceFixes(promo(id));
      expect(fixed.text).not.toBe(promo(id).text);
      expect(applySourceFixes(fixed)).toBe(fixed);
    }
    // Fonte já corrigida (ou outro texto): a carta volta igual.
    const ok = fixCard(promo('P-115'));
    expect(fixCard(ok)).toBe(ok);
  });

  it('todas as promos do fixture ficam automáticas (antes: 9 manuais e 5 parciais)', () => {
    for (const c of promos) {
      expect([c.id, automationStatus(fixCard(c))]).toEqual([c.id, 'auto']);
      expect(parseCard(fixCard(c)).unparsed).toEqual([]);
      expect(translateCardPt(fixCard(c)).complete).toBe(true);
    }
  });
});

describe('proteção em batalha filtrada pelo atributo do atacante', () => {
  it('P-007 Luffy [DON!! x1]: Líder "Strike" não o nocauteia; sem DON!! nocauteia', () => {
    const s0 = toTurn(started(), 3); // Líder do jogador 0: Luffy ST01-001 (Strike, 5000)
    const luffy = onField(s0, 1, 'P-007', { don: 1 });
    let s = noDefense(applyAction(s0, { type: 'attack', player: 0, attacker: s0.players[0].leader.uid, target: luffy }));
    expect(s.players[1].characters.map((c) => c.uid)).toContain(luffy);

    const t0 = toTurn(started(), 3);
    const bare = onField(t0, 1, 'P-007');
    const t = noDefense(applyAction(t0, { type: 'attack', player: 0, attacker: t0.players[0].leader.uid, target: bare }));
    expect(t.players[1].trash).toContain(bare);
  });

  it('P-007 também resiste a Personagem "Strike", não aos de outro atributo', () => {
    const s = toTurn(started(), 3);
    const luffy = onField(s, 1, 'P-007', { don: 1 });
    const strike = onField(s, 0, 'P-036'); // Strike
    const slash = onField(s, 0, 'P-009'); // Slash
    expect(koProtected(s, luffy, true, strike)).toBe(true);
    expect(koProtected(s, luffy, true, slash)).toBe(false);
  });

  it('P-025 Smoker [DON!! x1]: só Personagens sem "Special" não o nocauteiam; o Líder nocauteia', () => {
    const s = toTurn(started(), 3);
    const smoker = onField(s, 1, 'P-025', { don: 1 });
    const strike = onField(s, 0, 'P-036'); // Strike
    const special = onField(s, 0, 'P-071'); // Special
    expect(koProtected(s, smoker, true, strike)).toBe(true);
    expect(koProtected(s, smoker, true, special)).toBe(false);
    // "by Characters": o Líder (Luffy, Strike) não está no texto.
    expect(koProtected(s, smoker, true, s.players[0].leader.uid)).toBe(false);
    const after = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: smoker }));
    expect(after.players[1].trash).toContain(smoker);
    // Sem o DON!!, nem o Personagem sem "Special" é barrado.
    const t = toTurn(started(), 3);
    const bare = onField(t, 1, 'P-025');
    expect(koProtected(t, bare, true, onField(t, 0, 'P-036'))).toBe(false);
  });
});

describe('P-009 Trafalgar Law: oponente com 6 ou mais cartas na mão põe 1 da Vida na mão', () => {
  function law(oppHand: number) {
    const s = toTurn(started(), 3);
    addDon(s, 0, 3);
    const opp = s.players[1];
    while (opp.hand.length > oppHand) opp.deck.push(opp.hand.pop()!);
    while (opp.hand.length < oppHand) opp.hand.push(opp.deck.shift()!);
    const top = opp.life[opp.life.length - 1];
    return { s: play(s, toHand(s, 0, 'P-009')), top, life: opp.life.length };
  }

  it('com 6 cartas: a carta do topo da Vida vai para a mão do oponente (obrigatório, Q&A P-009)', () => {
    const { s, top, life } = law(6);
    expect(s.pending).toBeNull();
    expect(s.players[1].life).toHaveLength(life - 1);
    expect(s.players[1].hand).toContain(top);
    expect(s.players[1].hand).toHaveLength(7);
  });

  it('com 5 cartas: nada acontece', () => {
    const { s, life } = law(5);
    expect(s.players[1].life).toHaveLength(life);
    expect(s.players[1].hand).toHaveLength(5);
  });
});

describe('P-036 Luffy: "This Character and up to 1 of your Leader gain +1000 power"', () => {
  it('pago o custo de Vida, este Personagem e o Líder ganham +1000 (Q&A P-036)', () => {
    let s = toTurn(started(), 3);
    const luffy = onField(s, 0, 'P-036', { rested: false });
    const leader = s.players[0].leader.uid;
    const life = s.players[0].life.length;
    const hand = s.players[0].hand.length;
    s = applyAction(s, { type: 'attack', player: 0, attacker: luffy, target: s.players[1].leader.uid });
    expect(s.pending?.kind).toBe('confirm');
    s = answer(s, true);
    // topo ou fundo da Vida
    expect(s.pending?.kind).toBe('option');
    s = applyAction(s, { type: 'option', player: 0, index: 0 });
    expect(s.players[0].life).toHaveLength(life - 1);
    expect(s.players[0].hand).toHaveLength(hand + 1);
    expect(s.pending).toMatchObject({ kind: 'selectTargets', options: [leader] });
    s = choose(s, [leader]);
    expect(getPower(s, luffy)).toBe(5000);
    expect(getPower(s, leader)).toBe(6000);
  });

  it('o leitor separa "esta carta" (sempre) do "up to 1 of your Leader" (escolha)', () => {
    const [ab] = parseCard(promo('P-036')).abilities;
    expect(ab.steps.slice(1)).toEqual([
      { do: 'power', target: 'self', amount: 1000, duration: 'turn' },
      { do: 'power', target: { side: 'own', kinds: ['leader'], upTo: 1 }, amount: 1000, duration: 'turn' },
    ]);
  });
});

describe('P-046 Yamato: mão inteira no fundo do deck e compra o mesmo número', () => {
  it('aceitando, a mão vai para o fundo (sem embaralhar) e compra a mesma quantidade', () => {
    let s = toTurn(started(), 3);
    const yamato = toHand(s, 0, 'P-046');
    s = play(s, yamato);
    const hand = [...s.players[0].hand];
    const deck = s.players[0].deck.length;
    const top = s.players[0].deck.slice(0, hand.length);
    expect(s.pending?.kind).toBe('confirm');
    s = answer(s, true);
    expect(s.players[0].deck.slice(-hand.length)).toEqual(hand);
    expect(s.players[0].hand).toEqual(top);
    expect(s.players[0].deck).toHaveLength(deck);
  });

  it('recusando, nada muda', () => {
    let s = toTurn(started(), 3);
    s = play(s, toHand(s, 0, 'P-046'));
    const hand = [...s.players[0].hand];
    s = answer(s, false);
    expect(s.players[0].hand).toEqual(hand);
  });
});

describe('P-071 Marco: "[On K.O.] You may add this Character card to your hand"', () => {
  it('nocauteado em batalha, volta para a mão de quem aceita', () => {
    let s = toTurn(started(), 3);
    const marco = onField(s, 1, 'P-071');
    s.players[1].characters.find((c) => c.uid === marco)!.don = 0;
    // Marco tem 6000: o Líder (5000) precisa de 1 DON!! para nocautear.
    s.players[0].leader.don = 1;
    s.players[0].donActive -= 1;
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: marco }));
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1 });
    s = answer(s, true);
    expect(s.players[1].hand).toContain(marco);
    expect(s.players[1].trash).not.toContain(marco);
  });
});

describe('P-114 Zoro: "[End of Your Turn] If you have any active DON!! cards, set this Character as active"', () => {
  it('com DON!! ativo desvira no fim do turno; com todos virados, fica virado', () => {
    let s = toTurn(started(), 3);
    const zoro = onField(s, 0, 'P-114', { rested: true });
    expect(s.players[0].donActive).toBeGreaterThan(0);
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(s.players[0].characters.find((c) => c.uid === zoro)?.rested).toBe(false);

    let t = toTurn(started(), 3);
    const z2 = onField(t, 0, 'P-114', { rested: true });
    t.players[0].donRested += t.players[0].donActive;
    t.players[0].donActive = 0;
    t = applyAction(t, { type: 'endTurn', player: 0 });
    expect(t.players[0].characters.find((c) => c.uid === z2)?.rested).toBe(true);
  });
});

describe('P-024 "Your Leader gains +1000 power for each of your Characters during this turn"', () => {
  it('conta os Personagens ao resolver', () => {
    let s = toTurn(started(), 3);
    for (const id of ['P-036', 'P-071', 'P-009']) onField(s, 0, id);
    const leader = s.players[0].leader.uid;
    s = play(s, toHand(s, 0, 'P-024'));
    expect(getPower(s, leader)).toBe(5000 + 3000);
    // Personagem que entra depois não muda o valor.
    onField(s, 0, 'P-114');
    expect(getPower(s, leader)).toBe(8000);
  });
});

describe('P-117 Nami (Líder): só {East Blue} no deck e vitória com o deck zerado', () => {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const eastBlue: CardData = { id: 'EB-TEST', name: 'Usopp', category: 'character', colors: ['blue'], cost: 1, power: 2000, types: ['East Blue'], text: '' };
  byId.set(eastBlue.id, eastBlue);
  const deck = (fill: string): DeckList => ({ id: 'n', name: 'Nami', leader: 'P-117', cards: [{ id: fill, count: 50 }] });

  it('a construção do deck recusa carta azul sem o tipo {East Blue}', () => {
    const leaderRule = (r: ReturnType<typeof validateDeck>) => r.issues.filter((i) => /East Blue/.test(i.message));
    expect(leaderRule(validateDeck(deck('EB-TEST'), byId))).toEqual([]);
    const other = { ...eastBlue, id: 'XX-TEST', types: ['Navy'] };
    byId.set(other.id, other);
    const r = validateDeck({ ...deck('XX-TEST'), cards: [{ id: 'XX-TEST', count: 4 }, { id: 'EB-TEST', count: 46 }] }, byId);
    expect(r.valid).toBe(false);
    expect(leaderRule(r)).toEqual([
      {
        level: 'error',
        message: 'Usopp (XX-TEST): o Líder só permite cartas do tipo {East Blue}.',
        code: 'rules.leaderOnlyType',
        params: { name: 'Usopp', id: 'XX-TEST', type: 'East Blue' },
        cardId: 'XX-TEST',
      },
    ]);
  });

  it('o [DON!! x1] descarta a última carta do deck e Nami vence em vez de perder', () => {
    let s = toTurn(started(), 3);
    setLeader(s, 0, 'P-117');
    s.players[0].leader.don = 1;
    s.players[0].donActive -= 1;
    const ps = s.players[0];
    ps.trash.push(...ps.deck.splice(1));
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: ps.leader.uid, target: s.players[1].leader.uid }));
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 0 });
    s = answer(s, true);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
  });
});

describe('P-142 Merry Go (Stage): substitui o K.O. de {Straw Hat Crew} com 8000 de poder base ou menos', () => {
  it('o dono pode descartar o Stage no lugar do Personagem', () => {
    let s = toTurn(started(), 3);
    const merry = take(s, 1, 'P-142');
    s.players[1].stage = { uid: merry, rested: false, don: 0, playedOnTurn: 0 };
    const luffy = onField(s, 1, 'P-036'); // {Straw Hat Crew}, 4000
    s = noDefense(applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: luffy }));
    expect(s.pending).toMatchObject({ kind: 'confirm', player: 1 });
    s = answer(s, true);
    expect(s.players[1].characters.map((c) => c.uid)).toContain(luffy);
    expect(s.players[1].stage).toBeNull();
    expect(s.players[1].trash).toContain(merry);
  });
});

describe('P-097 Shanks: "[On Play]/[When Attacking] Your opponent cannot activate [Blocker] during this turn"', () => {
  it('as duas habilidades restringem o [Blocker] do oponente', () => {
    const abs = parseCard(promo('P-097')).abilities;
    expect(abs.map((a) => a.timing)).toEqual(['onPlay', 'whenAttacking']);
    for (const a of abs) expect(a.steps).toEqual([{ do: 'restrict', kind: 'noBlocker', opponent: true }]);
  });
});

describe('bot: P-136 Usopp sem alvo {Land of Wano} (simulate:all com as promos)', () => {
  it('não ativa "Give up to 1 rested DON!! card to 1 of your {Land of Wano} type …" sem alvo; com alvo, ativa', () => {
    const s = toTurn(started(), 3);
    setLeader(s, 0, 'P-117'); // sem {Land of Wano} e sem habilidade que dê DON!!
    const usopp = onField(s, 0, 'P-136', { rested: false });
    s.players[0].donActive -= 1;
    s.players[0].donRested += 1;
    // Antes: sem custo nem [Once Per Turn], o bot o ativava sem parar (a partida não terminava).
    expect(chooseBotAction(s, 0)).not.toMatchObject({ type: 'activate', uid: usopp });
    onField(s, 0, 'P-036'); // {Land of Wano}
    expect(chooseBotAction(s, 0)).toMatchObject({ type: 'activate', uid: usopp });
  });
});
