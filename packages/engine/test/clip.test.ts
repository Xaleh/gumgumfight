import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ClipCard, type ClipFrame, clipFrame, clipFrames, highlightedCard, spectatorView } from '../src/clip';
import { applyAction, createGame } from '../src/engine';
import { upgradeReplayActions } from '../src/replay';
import type { Action, CardData, DeckList, GameConfig, GameState, PlayerId } from '../src/types';
import { visibleCards } from '../src/view';

// Trecho do replay em vídeo ou GIF (roadmap F2): os quadros só levam o que um espectador vê.
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/replay-trello-70.json'), 'utf8')) as {
  decks: [DeckList, DeckList];
  cards: CardData[];
  replay: { seed: number; firstPlayer: PlayerId; chooseFirst?: boolean; actions: Action[] };
};
const config: GameConfig = {
  seed: fx.replay.seed,
  firstPlayer: fx.replay.chooseFirst ? undefined : fx.replay.firstPlayer,
  chooseFirst: fx.replay.chooseFirst,
  cards: fx.cards,
  players: [
    { name: 'Xaleh', deck: fx.decks[0], isBot: false },
    { name: 'Bot', deck: fx.decks[1], isBot: true },
  ],
};
const script = upgradeReplayActions(config, fx.replay.actions);
const states: GameState[] = [createGame(config)];
for (const a of script) states.push(applyAction(states[states.length - 1], a));
const n = script.length;

/** Todas as cartas que o quadro mostra. */
function cardsOf(f: ClipFrame): ClipCard[] {
  const out: ClipCard[] = [];
  for (const s of f.players) {
    out.push(s.leader, ...s.characters, ...s.lifeFaceUp);
    if (s.stage) out.push(s.stage);
    if (s.trashTop) out.push(s.trashTop);
  }
  if (f.highlight) out.push(f.highlight.card);
  return out;
}

describe('trecho do replay (clipFrames)', () => {
  it('começa na mesa do início do trecho e segue as posições do roteiro', () => {
    const frames = clipFrames(states[0], script, 10, 40);
    expect(frames[0].pos).toBe(10);
    expect(frames[0]).toEqual(clipFrame(states[10], 10));
    expect(frames[frames.length - 1].pos).toBeLessThanOrEqual(40);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].pos).toBeGreaterThan(frames[i - 1].pos);
      expect(frames[i]).toEqual(clipFrame(states[frames[i].pos], frames[i].pos, script[frames[i].pos - 1]));
    }
    // Ações que não mudam nada à vista não geram quadro: nunca dois quadros iguais seguidos.
    const look = (f: ClipFrame) => JSON.stringify({ ...f, pos: 0 });
    for (let i = 1; i < frames.length; i++) expect(look(frames[i])).not.toBe(look(frames[i - 1]));
  });

  it('nenhuma carta escondida aparece, nem no fim de jogo', () => {
    const frames = clipFrames(states[0], script, 0, n);
    expect(frames[frames.length - 1].phase).toBe('gameover');
    expect(frames[frames.length - 1].winner).toBe(states[n].winner);
    for (const f of frames) {
      const real = states[f.pos];
      const pub = visibleCards(real, null, [], { revealEnd: false });
      for (const c of cardsOf(f)) {
        expect(pub.has(c.uid), `quadro ${f.pos}: ${c.cardId}`).toBe(true);
        expect(c.cardId).toBe(real.cards[c.uid].cardId);
      }
      // Mão, deck e Vida só em quantidade.
      for (const p of [0, 1] as const) {
        const ps = real.players[p];
        expect(f.players[p].hand).toBe(ps.hand.length);
        expect(f.players[p].deck).toBe(ps.deck.length);
        expect(f.players[p].life).toBe(ps.life.length);
        const shown = new Set(cardsOf(f).map((c) => c.uid));
        for (const u of [...ps.hand, ...ps.deck]) if (!pub.has(u)) expect(shown.has(u)).toBe(false);
      }
    }
    // O fim do replay revela tudo na mesa; o trecho, não.
    const end = JSON.stringify(frames[frames.length - 1]);
    const hidden = [...states[n].players[0].deck, ...states[n].players[1].deck].filter((u) => !visibleCards(states[n], null, [], { revealEnd: false }).has(u));
    expect(hidden.length).toBeGreaterThan(0);
    for (const u of hidden) expect(end).not.toContain(`"uid":"${u}"`);
  });

  it('a carta jogada fica em destaque, como na tela de transmissão', () => {
    const i = script.findIndex((a) => a.type === 'playCard');
    expect(i).toBeGreaterThanOrEqual(0);
    const play = script[i] as Extract<Action, { type: 'playCard' }>;
    const frames = clipFrames(states[0], script, i, i + 1);
    const last = frames[frames.length - 1];
    expect(last.highlight).toMatchObject({ player: play.player, kind: 'play', card: { uid: play.uid, cardId: states[i + 1].cards[play.uid].cardId } });
    expect(highlightedCard(spectatorView(states[i + 1]), play)?.uid).toBe(play.uid);
    // Uma ação sem carta (passar) não destaca nada.
    expect(highlightedCard(states[i + 1], { type: 'endTurn', player: 0 } as Action)).toBeNull();
  });

  it('limites fora do roteiro são ajustados', () => {
    expect(clipFrames(states[0], script, -5, 0)).toHaveLength(1);
    const tail = clipFrames(states[0], script, n - 3, n + 100);
    expect(tail[0].pos).toBe(n - 3);
    expect(tail[tail.length - 1].pos).toBeLessThanOrEqual(n);
    // Início depois do fim: só a mesa daquela posição.
    expect(clipFrames(states[0], script, 30, 20)).toEqual([clipFrame(states[20], 20)]);
  });
});
