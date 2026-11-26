// As duas últimas cartas ⚙ da base (26/11/2026):
// - ST38-015 (spoiler): "return up to 1 Character … to its owner's hand or the bottom of their deck"; o leitor
//   só conhecia a redação da Ulti OP04-043 ("to the owner's hand or the bottom of their deck").
// - OP02-093 Smoker: a impressão original na optcgapi traz "Give up to 1o of your opponent's Characters".

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { automationStatus, buildCardDef, parseCard } from '../src/cards';
import { applyAction, createGame } from '../src/engine';
import { translateCardPt } from '../src/i18n/render';
import type { CardData, DeckList, GameState } from '../src/types';
import { cards as baseCards, crocodile, fetchToHand, luffy, putOnField, toTurn } from './helpers';

const fishbait: CardData = {
  id: 'ST38-015',
  name: "Don't Be so Full of Yourself Fishbait",
  category: 'event',
  colors: ['blue'],
  cost: 1,
  types: ['The Seven Warlords of the Sea', 'Baroque Works'],
  text: '[Main] If your Leader\'s type includes "Baroque Works", return up to 1 Character with a cost of 2 or less to its owner\'s hand or the bottom of their deck.\n[Counter] Your Leader gains +3000 power during this battle.',
};
const cards = [...baseCards, fishbait];

/** O deck com 1 cópia do evento no lugar de uma carta qualquer. */
const withEvent = (d: DeckList): DeckList => ({ ...d, cards: [...d.cards.map((c, i) => (i === 0 ? { ...c, count: c.count - 1 } : c)), { id: fishbait.id, count: 1 }] });

/** Turno 3 do jogador 0, com o evento na mão dele. */
function game(decks: [DeckList, DeckList]): { s: GameState; event: string } {
  let s = createGame({ seed: 3, firstPlayer: 0, cards, players: [{ name: 'A', deck: withEvent(decks[0]) }, { name: 'B', deck: decks[1] }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  s = toTurn(s, 3);
  return { s, event: fetchToHand(s, 0, fishbait.id) };
}

describe('ST38-015: devolver à mão do dono ou ao fundo do deck', () => {
  it('a carta é lida por inteiro e a tradução sai completa', () => {
    expect(parseCard(fishbait).unparsed).toEqual([]);
    expect(automationStatus(fishbait)).toBe('auto');
    const pt = translateCardPt(fishbait);
    expect(pt.complete).toBe(true);
    expect(pt.text).toContain('Devolva essa carta à mão do dono');
    expect(pt.text).toContain('Coloque essa carta no fundo do deck do dono');
  });

  it('com Líder {Baroque Works}: escolhe o Personagem de custo 2 ou menos e depois para onde ele vai', () => {
    // Crocodile ST03-001 é {The Seven Warlords of the Sea}/{Baroque Works}.
    for (const [index, where] of [[0, 'hand'], [1, 'deck']] as const) {
      const { s: start, event } = game([crocodile, luffy]);
      let s = start;
      const usopp = putOnField(s, 1, 'ST01-002'); // custo 2
      const big = putOnField(s, 1, 'ST01-012'); // custo 5: fora do alcance
      s = applyAction(s, { type: 'playCard', player: 0, uid: event });
      expect(s.pending).toMatchObject({ kind: 'selectTargets', player: 0, options: [usopp] });
      s = applyAction(s, { type: 'choose', player: 0, uids: [usopp] });
      expect(s.pending).toMatchObject({ kind: 'option', player: 0, options: ['Devolver à mão', 'Fundo do deck'] });
      s = applyAction(s, { type: 'option', player: 0, index });
      expect(s.pending).toBeNull();
      expect(s.players[1].characters.map((c) => c.uid)).toEqual([big]);
      if (where === 'hand') expect(s.players[1].hand).toContain(usopp);
      else expect(s.players[1].deck[s.players[1].deck.length - 1]).toBe(usopp);
      expect(s.players[0].trash).toContain(event);
    }
  });

  it('sem Líder {Baroque Works}, o [Main] não faz nada', () => {
    const { s: start, event } = game([luffy, crocodile]);
    let s = start;
    const jinbe = putOnField(s, 1, 'ST03-006'); // custo 2
    s = applyAction(s, { type: 'playCard', player: 0, uid: event });
    expect(s.pending).toBeNull();
    expect(s.players[1].characters.map((c) => c.uid)).toEqual([jinbe]);
  });
});

describe('OP02-093 Smoker: "up to 1o of" na impressão original da API', () => {
  const DATA = join(__dirname, '../../../data/cards');
  const repoCards: CardData[] = readdirSync(DATA)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(join(DATA, f), 'utf8')) as { cards: CardData[] }).cards);
  const smoker = repoCards.find((c) => c.id === 'OP02-093')!;

  it('o texto da API é corrigido e o efeito é lido', () => {
    const fromApi = { ...smoker, text: smoker.text!.replace('Give up to 1 of', 'Give up to 1o of') };
    expect(fromApi.text).not.toBe(smoker.text);
    const def = buildCardDef(fromApi);
    expect(def.text).toBe(smoker.text);
    expect(def.manual).toBe(false);
    expect(def.abilities).toHaveLength(1);
  });

  it('nenhuma carta de data/cards fica com efeito parcial ou manual', () => {
    expect(repoCards.filter((c) => ['partial', 'manual'].includes(automationStatus(c))).map((c) => c.id)).toEqual([]);
  });
});
