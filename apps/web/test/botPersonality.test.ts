// Estilo do bot na partida do navegador (roadmap D3): a jogada do Worker usa a personalidade, e o menu tem os textos.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, BOT_PERSONALITIES, type CardData, createGame, type DeckList, type GameState } from '@gumgum/engine';
import { describe, expect, it } from 'vitest';
import { computeBotMove } from '../src/game/botMove';
import de from '../src/i18n/de';
import en from '../src/i18n/en';
import es from '../src/i18n/es';
import fr from '../src/i18n/fr';
import ja from '../src/i18n/ja';
import ptBR from '../src/i18n/pt-BR';

const DATA = join(__dirname, '../../../data');
const load = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const cards: CardData[] = ['st01', 'st02'].flatMap((set) => load(`cards/${set}.json`).cards as CardData[]);
const luffy: DeckList = load('decks/st01-luffy.json');
const kid: DeckList = load('decks/st02-kid.json');

/** O Líder do Kid (jogador 0) ataca o Líder do Luffy (jogador 1, o bot, com 1 de Vida e o Chopper [Blocker] em campo). */
function attackOnLastLife(): GameState {
  let s = createGame({ seed: 1, firstPlayer: 0, cards, players: [{ name: 'Kid', deck: kid }, { name: 'Bot', deck: luffy }] });
  s = applyAction(s, { type: 'mulligan', player: 0, redraw: false });
  s = applyAction(s, { type: 'mulligan', player: 1, redraw: false });
  while (s.turn < 3) s = applyAction(s, { type: 'endTurn', player: s.activePlayer });
  const bot = s.players[1];
  bot.life = bot.life.slice(0, 1);
  const i = bot.deck.findIndex((u) => s.cards[u].cardId === 'ST01-006');
  const [chopper] = bot.deck.splice(i, 1);
  bot.characters.push({ uid: chopper, rested: false, don: 0, playedOnTurn: 0 });
  return applyAction(s, { type: 'attack', player: 0, attacker: s.players[0].leader.uid, target: bot.leader.uid });
}

describe('estilo do bot no navegador', () => {
  it('o equilibrado bloqueia na última Vida; o agressivo não', () => {
    const s = attackOnLastLife();
    expect(s.pending?.kind).toBe('block');
    const balanced = computeBotMove({ state: s, player: 1, level: 'easy' }).action;
    const aggressive = computeBotMove({ state: s, player: 1, level: 'easy', personality: 'aggressive' }).action;
    expect(balanced.type === 'choose' ? balanced.uids.length : -1).toBe(1);
    expect(aggressive.type === 'choose' ? aggressive.uids.length : -1).toBe(0);
  });

  it('os textos do estilo existem nos seis idiomas', () => {
    const label = { balanced: 'Balanced', aggressive: 'Aggressive', control: 'Control', cautious: 'Cautious' } as const;
    for (const dict of [ptBR, en, es, ja, fr, de] as Record<string, string>[]) {
      expect(dict['menu.botStyle']).toBeTruthy();
      for (const p of BOT_PERSONALITIES) {
        expect(dict[`menu.bot${label[p]}`]).toBeTruthy();
        expect(dict[`menu.bot${label[p]}Title`]).toBeTruthy();
      }
    }
  });
});
