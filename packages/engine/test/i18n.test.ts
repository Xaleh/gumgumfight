import { describe, expect, it } from 'vitest';
import { translateToPt } from '../src/i18n/pt';
import { cards } from './helpers';

describe('tradução automática para português', () => {
  it('traduz por completo os textos dos decks iniciais', () => {
    for (const c of cards) {
      for (const t of [c.text, c.trigger].filter(Boolean) as string[]) {
        const r = translateToPt(t);
        expect(r.complete, `${c.id}: ${r.text}`).toBe(true);
      }
    }
  });

  it('traduz modelos comuns', () => {
    expect(translateToPt("[On Play] K.O. up to 1 of your opponent's Characters with a cost of 3 or less.").text).toBe(
      '[Ao Jogar] Nocauteie (K.O.) até 1 Personagem do oponente com custo 3 ou menos.',
    );
    expect(translateToPt('[DON!! x1] [When Attacking] [Once Per Turn] Draw 1 card.').text).toBe(
      '[DON!! x1] [Ao Atacar] [Uma Vez por Turno] Compre 1 carta.',
    );
    expect(translateToPt('[Activate: Main] [Once Per Turn] ③ (You may rest the specified number of DON!! cards in your cost area.): Set this Leader as active.').text).toBe(
      '[Ativar: Principal] [Uma Vez por Turno] ③ (Você pode virar a quantidade indicada de DON!! da sua área de custo.): Deixe este Líder ativo.',
    );
  });

  it('marca como parcial quando sobra inglês', () => {
    const r = translateToPt('[On Play] Swap the positions of all Characters on the field.');
    expect(r.complete).toBe(false);
    expect(r.text.startsWith('[Ao Jogar]')).toBe(true);
  });

  it('aceita <br> como quebra de linha', () => {
    expect(translateToPt('[Rush] (This card can attack on the turn in which it is played.)<br>[Blocker]').text).toContain('\n');
  });
});
