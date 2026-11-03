import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine';
import { cardStatuses, modifierUntil } from '../src/status';
import type { CardData, DeckList, GameState, Modifier } from '../src/types';
import { createAliases, viewFor } from '../src/view';
import { cards, putOnField, started, toTurn } from './helpers';

// Marcadores de estado nas cartas (Trello): tudo o que o motor guarda de temporário sobre uma carta em campo,
// com texto e até quando vale, igual para os dois jogadores e para o espectador.

let n = 0;
const randomId = () => `k${(++n * 7919).toString(36)}x`;

/** Modificador como `addModifier` registraria no turno atual, para o controlador `controller`. */
function mod(s: GameState, controller: 0 | 1, m: Omit<Modifier, 'untilTurn'>): Modifier {
  const mine = s.activePlayer === controller;
  const out: Modifier = { ...m };
  if (m.duration === 'nextOpponentTurn') out.untilTurn = s.turn + (mine ? 1 : 2);
  else if (m.duration === 'untilYourNextTurn' || m.duration === 'endOfYourNextTurn') out.untilTurn = s.turn + (mine ? 2 : 1);
  return out;
}

const kinds = (s: GameState, uid: string) => cardStatuses(s, uid).map((x) => x.kind);

/** Teach (OP09-081, ST27) contra Kid: A começa. */
function teachVsKid(): GameState {
  const st27 = JSON.parse(readFileSync(join(__dirname, '../../../data/cards/st27.json'), 'utf8')).cards as CardData[];
  const deck = (leader: string): DeckList => ({ id: leader, name: leader, leader, cards: [{ id: 'ST01-006', count: 50 }] });
  let s = createGame({ seed: 7, firstPlayer: 0, cards: [...cards, ...st27], players: [{ name: 'A', deck: deck('OP09-081') }, { name: 'B', deck: deck('ST02-001') }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  return applyAction(s, { type: 'mulligan', player: 1, redraw: false });
}

describe('cardStatuses', () => {
  it('fora do campo não há estados; em campo sem efeitos também não', () => {
    const s = toTurn(started(), 3);
    expect(cardStatuses(s, s.players[0].hand[0])).toEqual([]);
    expect(cardStatuses(s, s.players[0].leader.uid)).toEqual([]);
  });

  it('não ataca, não vira, não desvira e Blocker ganho aparecem com texto e duração', () => {
    const s = toTurn(started(), 3); // turno de Luffy (0)
    const zoro = putOnField(s, 0, 'ST01-013');
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'cannotAttack', amount: 0, duration: 'turn' }));
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'cannotBeRested', amount: 0, duration: 'nextOpponentTurn' }));
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn' }));
    s.modifiers.push(mod(s, 0, { uid: zoro, kind: 'keyword', keyword: 'blocker', amount: 0, duration: 'turn' }));
    s.modifiers.push(mod(s, 0, { uid: zoro, kind: 'power', amount: 1000, duration: 'turn' }));
    s.modifiers.push(mod(s, 0, { uid: zoro, kind: 'power', amount: 2000, duration: 'turn' }));

    const st = cardStatuses(s, zoro);
    expect(st.map((x) => x.kind)).toEqual(['cannotAttack', 'cannotRest', 'skipRefresh', 'keyword', 'power']);
    const by = Object.fromEntries(st.map((x) => [x.kind, x]));
    expect(by.cannotAttack).toMatchObject({ icon: '🚫', tone: 'bad', onCard: true, until: 'até o fim deste turno' });
    // Kid aplicou "until the end of your opponent's next turn" no turno de Luffy: vale até o fim do turno 5 (de Luffy).
    expect(by.cannotRest.until).toBe('até o fim do próximo turno de Luffy');
    expect(by.skipRefresh.until).toBe('até a próxima Fase de Renovação de Luffy');
    expect(by.keyword).toMatchObject({ keyword: 'blocker', tone: 'good', text: 'Ganhou [Blocker]' });
    // Poder somado por duração; não vira ícone na carta (o número do poder já muda de cor).
    expect(by.power).toMatchObject({ label: '+3000 poder', onCard: false });
    // Ao lado de cada texto, a chave de tradução e os parâmetros.
    expect(by.cannotAttack).toMatchObject({ tagKey: 'status.cannotAttackTag', textKey: 'status.cannotAttack', untilKey: 'status.untilEndOfTurn' });
    expect(by.cannotRest).toMatchObject({ untilKey: 'status.untilEndOfNextTurn', untilParams: { name: 'Luffy' } });
    expect(by.skipRefresh).toMatchObject({ untilKey: 'status.untilNextRefresh', untilParams: { name: 'Luffy' } });
    expect(by.keyword).toMatchObject({ textKey: 'status.gainedKeyword', textParams: { keyword: 'Blocker' } });
    expect(by.power).toMatchObject({ tagKey: 'status.powerTag', tagParams: { amount: '+3000' }, textKey: 'status.power', textParams: { amount: '+3000' } });
  });

  it('a palavra-chave impressa não é marcada como ganha', () => {
    const s = toTurn(started(), 3);
    const usopp = putOnField(s, 0, 'ST01-002'); // Usopp: sem Blocker impresso
    const blocker = putOnField(s, 0, 'ST01-006'); // Chopper: [Blocker] impresso
    s.modifiers.push(mod(s, 0, { uid: usopp, kind: 'keyword', keyword: 'blocker', amount: 0, duration: 'turn' }));
    s.modifiers.push(mod(s, 0, { uid: blocker, kind: 'keyword', keyword: 'blocker', amount: 0, duration: 'turn' }));
    expect(kinds(s, usopp)).toEqual(['keyword']);
    expect(kinds(s, blocker)).toEqual([]);
  });

  it('restrição do jogador "não pode atacar o Líder" aparece no Líder e nos Personagens dele', () => {
    const s = toTurn(started(), 3);
    const zoro = putOnField(s, 0, 'ST01-013');
    s.restrictions = [{ player: 0, kind: 'noAttackLeader' }];
    expect(kinds(s, zoro)).toEqual(['cannotAttackLeader']);
    expect(kinds(s, s.players[0].leader.uid)).toEqual(['cannotAttackLeader']);
    expect(kinds(s, s.players[1].leader.uid)).toEqual([]);
  });

  it('os estados somem quando o efeito expira', () => {
    let s = toTurn(started(), 3);
    const zoro = putOnField(s, 0, 'ST01-013');
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'cannotAttack', amount: 0, duration: 'turn' }));
    // Efeito do próprio Luffy "até o fim do próximo turno do oponente": acaba no fim do turno 4 (de Kid).
    s.modifiers.push(mod(s, 0, { uid: zoro, kind: 'cannotBeRested', amount: 0, duration: 'nextOpponentTurn' }));
    // Como o motor registra para uma carta do oponente: dura até a Renovação de Luffy no turno 5.
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn' }));
    expect(kinds(s, zoro)).toEqual(['cannotAttack', 'cannotRest', 'skipRefresh']);
    expect(cardStatuses(s, zoro).find((x) => x.kind === 'cannotRest')!.until).toBe('até o fim do próximo turno de Kid');
    s = applyAction(s, { type: 'endTurn', player: 0 }); // fim do turno 3: "este turno" acaba
    expect(kinds(s, zoro)).toEqual(['cannotRest', 'skipRefresh']);
    expect(cardStatuses(s, zoro).find((x) => x.kind === 'cannotRest')!.until).toBe('até o fim deste turno');
    s = applyAction(s, { type: 'endTurn', player: 1 }); // fim do turno 4 (Kid): acaba; a Renovação de Luffy consome o skipRefresh
    expect(kinds(s, zoro)).toEqual([]);
  });

  it('modifierUntil descreve "até o início do próximo turno" de quem for', () => {
    const s = toTurn(started(), 3);
    expect(modifierUntil(s, { duration: 'untilYourNextTurn', untilTurn: 5 })).toBe('até o início do próximo turno de Luffy');
    expect(modifierUntil(s, { duration: 'untilYourNextTurn', untilTurn: 4 })).toBe('até o início do próximo turno de Kid');
    expect(modifierUntil(s, { duration: 'battle' })).toBe('até o fim deste turno'); // sem batalha em andamento
  });

  it('as visões dos dois jogadores e do espectador mostram os mesmos estados (online)', () => {
    const s = toTurn(started(), 3);
    const zoro = putOnField(s, 0, 'ST01-013');
    const kidChar = putOnField(s, 1, 'ST02-004');
    s.modifiers.push(mod(s, 1, { uid: zoro, kind: 'cannotAttack', amount: 0, duration: 'nextOpponentTurn' }));
    s.modifiers.push(mod(s, 0, { uid: kidChar, kind: 'cannotBeRested', amount: 0, duration: 'turn' }));
    s.modifiers.push(mod(s, 0, { uid: kidChar, kind: 'keyword', keyword: 'rush', amount: 0, duration: 'turn' }));
    s.restrictions = [{ player: 1, kind: 'noAttackLeader' }];
    const aliases = createAliases(s, randomId);
    for (const viewer of [0, 1, null] as const) {
      const v = viewFor(s, viewer, aliases);
      expect(cardStatuses(v, aliases.toAlias[zoro])).toEqual(cardStatuses(s, zoro));
      expect(cardStatuses(v, aliases.toAlias[kidChar])).toEqual(cardStatuses(s, kidChar));
      expect(cardStatuses(v, aliases.toAlias[s.players[1].leader.uid])).toEqual(cardStatuses(s, s.players[1].leader.uid));
    }
    expect(kinds(s, kidChar)).toEqual(['cannotAttackLeader', 'cannotRest', 'keyword']);
  });

  it('Teach (OP09-081): "EFEITO USADO" no Líder que anulou e "SEM ON PLAY" no Líder afetado, até o fim do próximo turno do oponente', () => {
    let s = toTurn(teachVsKid(), 3); // turno de A (Teach)
    const teach = s.players[0].leader.uid;
    const kid = s.players[1].leader.uid;
    expect(kinds(s, teach)).toEqual([]);
    expect(kinds(s, kid)).toEqual([]);

    s = applyAction(s, { type: 'activate', player: 0, uid: teach, ability: 1 });
    if (s.pending?.kind === 'selectTargets') s = applyAction(s, { type: 'choose', player: 0, uids: [s.players[0].hand[0]] });
    expect(s.pending).toBeNull();
    expect(s.onPlayNegated).toEqual([{ player: 1, untilTurn: 4, source: teach }]);

    const used = cardStatuses(s, teach);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      kind: 'effectUsed',
      tag: 'EFEITO USADO',
      tagKey: 'status.effectUsedTag',
      text: 'Efeito usado: os [Ao Jogar] de B estão anulados',
      textKey: 'status.effectUsed',
      textParams: { name: 'B' },
      until: 'até o fim do próximo turno de B',
      untilKey: 'status.untilEndOfNextTurn',
      tone: 'good',
      onCard: true,
    });
    const no = cardStatuses(s, kid);
    expect(no).toHaveLength(1);
    expect(no[0]).toMatchObject({
      kind: 'noOnPlay',
      tag: 'SEM ON PLAY',
      tagKey: 'status.noOnPlayTag',
      text: 'Os efeitos [Ao Jogar] de B estão anulados',
      textKey: 'status.noOnPlay',
      textParams: { name: 'B' },
      until: 'até o fim do próximo turno de B',
      tone: 'bad',
      onCard: true,
    });
    // Só nos Líderes: os Personagens de B não ganham a tag.
    const ch = putOnField(s, 1, 'ST01-006');
    expect(kinds(s, ch)).toEqual([]);

    // As visões dos dois jogadores e do espectador mostram o mesmo.
    const aliases = createAliases(s, randomId);
    for (const viewer of [0, 1, null] as const) {
      const v = viewFor(s, viewer, aliases);
      expect(cardStatuses(v, aliases.toAlias[teach])).toEqual(cardStatuses(s, teach));
      expect(cardStatuses(v, aliases.toAlias[kid])).toEqual(cardStatuses(s, kid));
    }

    // No turno de B ainda vale ("até o fim deste turno"); depois dele, some dos dois.
    s = applyAction(s, { type: 'endTurn', player: 0 });
    expect(cardStatuses(s, kid)[0]).toMatchObject({ kind: 'noOnPlay', until: 'até o fim deste turno' });
    expect(kinds(s, teach)).toEqual(['effectUsed']);
    s = applyAction(s, { type: 'endTurn', player: 1 });
    expect(kinds(s, teach)).toEqual([]);
    expect(kinds(s, kid)).toEqual([]);
  });
});
