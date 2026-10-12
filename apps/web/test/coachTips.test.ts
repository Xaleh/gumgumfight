import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, type CardData, createGame, createScenario, type DeckList, type GameConfig } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { coachTip } from '../src/game/tutorial/coachTips';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = ['st01', 'st03'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
const decks: [DeckList, DeckList] = [load('decks/st01-luffy.json'), load('decks/st03-crocodile.json')];
const config: GameConfig = { seed: 3, cards, players: [{ name: 'Você', deck: decks[0] }, { name: 'Bot', deck: decks[1], isBot: true }] };

describe('dicas do treinador contra o bot', () => {
  it('Main Phase: DON!! sobrando com carta jogável, depois ataque disponível, depois nada', () => {
    let s = createScenario(config, { turn: 5, active: 0, sides: [{ hand: ['ST01-007'], characters: ['ST01-013'], donActive: 1 }, {}] });
    expect(coachTip(s, 0)).toMatchObject({ key: 'spend', params: { n: 1 } });
    s = applyAction(s, { type: 'playCard', player: 0, uid: s.players[0].hand[0] });
    expect(coachTip(s, 0)?.key).toBe('attack');
    s = createScenario(config, { turn: 5, active: 0, sides: [{ characters: [{ id: 'ST01-013', rested: true }], leader: { rested: true } }, {}] });
    expect(coachTip(s, 0)).toBeNull();
  });

  it('Counter Step: diz se os Counters da mão seguram o ataque', () => {
    const attackLeader = (hand: string[]) => {
      let s = createScenario(config, { turn: 6, active: 1, sides: [{ hand }, { characters: ['ST03-012'] }] });
      const pacifista = s.players[1].characters[0].uid;
      s = applyAction(s, { type: 'attack', player: 1, attacker: pacifista, target: s.players[0].leader.uid });
      if (s.pending?.kind === 'block') s = applyAction(s, { type: 'choose', player: 0, uids: [] });
      return s;
    };
    expect(coachTip(attackLeader(['ST01-011']), 0)).toMatchObject({ key: 'counterCan', params: { need: 2000 } });
    expect(coachTip(attackLeader(['ST01-007']), 0)).toMatchObject({ key: 'counterCannot', params: { need: 2000 } });
    // Na vez do oponente, sem escolha minha pendente: nenhuma dica.
    expect(coachTip(createScenario(config, { turn: 6, active: 1, sides: [{}, {}] }), 0)).toBeNull();
  });

  it('Block Step: sugere o Blocker quando o ataque acertaria', () => {
    let s = createScenario(config, { turn: 6, active: 1, sides: [{ characters: ['ST01-006'] }, { characters: ['ST03-012'] }] });
    s = applyAction(s, { type: 'attack', player: 1, attacker: s.players[1].characters[0].uid, target: s.players[0].leader.uid });
    expect(coachTip(s, 0)).toMatchObject({ key: 'block' });
  });

  it('mulligan: manter com cartas baratas, trocar sem elas', () => {
    const s = createGame({ ...config, firstPlayer: 0, chooseFirst: false });
    const tip = coachTip(s, 0)!;
    const cheap = s.players[0].hand.map((u) => s.defs[s.cards[u].cardId]).filter((d) => d.category !== 'stage' && (d.cost ?? 0) <= 3).length;
    expect(tip.key).toBe(cheap >= 2 ? 'mulliganKeep' : 'mulliganRedraw');
  });
});
