import { describe, expect, it } from 'vitest';
import { CARD_SCRIPTS, detectKeywords, parseCard } from '../src/cards';
import type { Ability, CardData } from '../src/types';
import { cards } from './helpers';

/** JSON com chaves em ordem alfabética (a ordem das chaves não importa). */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;

/** Remove o que é só apresentação (rótulos) para comparar a lógica. */
const logic = (abilities: Ability[]) => canonical(abilities.map(({ label: _l, labelKey: _k, labelParams: _p, text: _t, ...rest }) => rest));

describe('leitor automático de efeitos', () => {
  it('reproduz os scripts escritos à mão dos starter decks ST01–ST05', () => {
    const scripted = cards.filter((c) => CARD_SCRIPTS[c.id]);
    expect(scripted.length).toBeGreaterThan(50);
    const diffs: string[] = [];
    for (const c of scripted) {
      const script = CARD_SCRIPTS[c.id];
      const parsed = parseCard(c);
      const sameKeywords =
        JSON.stringify([...(script.keywords ?? detectKeywords(c.text))].sort()) === JSON.stringify([...parsed.keywords].sort());
      const same = JSON.stringify(logic(parsed.abilities)) === JSON.stringify(logic(script.abilities));
      if (!same || !sameKeywords || parsed.unparsed.length) {
        diffs.push(`${c.id}\n  texto:  ${c.text} | ${c.trigger ?? ''}\n  script: ${JSON.stringify(logic(script.abilities))}\n  leitor: ${JSON.stringify(logic(parsed.abilities))}`);
      }
    }
    expect(diffs.join('\n')).toBe('');
  });
});

describe('modelos de frase', () => {
  const card = (text: string, extra: Partial<CardData> = {}): CardData => ({
    id: 'T-1',
    name: 'Teste',
    category: 'character',
    colors: ['red'],
    cost: 3,
    power: 4000,
    types: [],
    text,
    ...extra,
  });
  const steps = (text: string, extra: Partial<CardData> = {}) => {
    const p = parseCard(card(text, extra));
    expect(p.unparsed).toEqual([]);
    return p.abilities.map((a) => a.steps);
  };

  it('"Give … 2000 power" sem sinal (a API perde o −) é −2000', () => {
    expect(steps("[On Play] Give up to 1 of your opponent's Characters 2000 power during this turn.")).toEqual([
      [{ do: 'power', target: { side: 'opponent', kinds: ['character'], upTo: 1 }, amount: -2000, duration: 'turn' }],
    ]);
  });

  it('"DON!! 1:" sem sinal é DON!! −1, e o custo de efeito automático vira pergunta', () => {
    expect(steps('[On Play] DON!! 1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): Draw 1 card.')).toEqual([
      [{ do: 'payCost', cost: { donMinus: 1 } }, { do: 'draw', count: 1 }],
    ]);
  });

  it('custo/poder "base" usam os valores impressos', () => {
    const [[st]] = steps("[On K.O.] K.O. up to 1 of your opponent's Characters with 6000 base power or less.");
    expect(st).toMatchObject({ target: { maxPower: 6000, base: true } });
    const [[st2]] = steps("[On Play] K.O. up to 1 of your opponent's Characters with a base cost of 4 or less.");
    expect(st2).toMatchObject({ target: { maxCost: 4, base: true } });
  });

  it('tipo entre colchetes ("[Supernovas] type") e várias condições com "and"', () => {
    expect(
      steps(
        '[On Play] If your Leader has the [Supernovas] type and you have 2 or less Life cards, set up to 2 of your DON!! cards as active.',
      ),
    ).toEqual([[{ do: 'setDonActive', count: 2, if: { leaderHasType: 'Supernovas', lifeMax: 2 } }]]);
  });

  it('"Leader\'s type includes "CP"" conta CP9 e CP0 (trecho do tipo, não o tipo inteiro)', () => {
    expect(steps('[On Play] If your Leader\'s type includes "CP", draw 1 card.')).toEqual([[{ do: 'draw', count: 1, if: { leaderTypeIncludes: 'CP' } }]]);
    expect(steps('[On Play] If your Leader has a type including "CP", draw 1 card.')).toEqual([[{ do: 'draw', count: 1, if: { leaderTypeIncludes: 'CP' } }]]);
  });

  it('[Trigger] com custo, Vida a partir do deck e efeito [On Play] via [Trigger]', () => {
    expect(steps('', { trigger: 'You may trash 1 card from your hand: Play this card.' })).toEqual([
      [{ do: 'payCost', cost: { trashFromHand: 1 } }, { do: 'playThis' }],
    ]);
    expect(steps('[On Play] Add up to 1 card from the top of your deck to the top of your Life cards.')).toEqual([
      [{ do: 'addLifeFromDeck', count: 1, upTo: true }],
    ]);
    expect(steps('[On Play] Draw 1 card.', { trigger: "Activate this card's [On Play] effect." })[1]).toEqual([
      { do: 'useOwnEffect', timing: 'onPlay' },
    ]);
  });

  it('efeitos contínuos: custo, "cannot attack", proteção contra efeitos', () => {
    const p = parseCard(card('If your Leader has the {Elbaph} type, this Character gains +12 cost.'));
    expect(p.abilities).toEqual([{ timing: 'static', steps: [], condition: { leaderHasType: 'Elbaph' }, staticCost: 12 }]);
    expect(parseCard(card('This Leader cannot attack.', { category: 'leader' })).abilities[0]).toMatchObject({ staticCannotAttack: true });
    expect(parseCard(card("This Character cannot be K.O.'d by effects.")).abilities[0]).toMatchObject({ staticNoEffectKO: true });
  });

  it('"up to 1 of your [Shanks]" sem substantivo: Líder ou Personagem com esse nome (OP17-036, OP17-115, OP17-055)', () => {
    const named = { side: 'own', kinds: ['leader', 'character'], upTo: 1 };
    expect(steps('[Counter] Up to 1 of your [Shanks] gains +4000 power during this battle.', { category: 'event', cost: 1 })).toEqual([
      [{ do: 'power', target: { ...named, name: 'Shanks' }, amount: 4000, duration: 'battle' }],
    ]);
    expect(steps('[Main] Up to 1 of your [Rocks.D.Xebec] gains [Unblockable] during this turn.', { category: 'event', cost: 1 })).toEqual([
      [{ do: 'gainKeyword', target: { ...named, name: 'Rocks.D.Xebec' }, keyword: 'unblockable', duration: 'turn' }],
    ]);
    // "[X] cards" continua valendo para o Líder; sem dono ("play up to 1 [Pacifista]"), o nome não inclui o Líder.
    expect(steps('[On Play] Set up to 1 of your [Charlotte Linlin] cards as active.')).toEqual([
      [{ do: 'setActive', target: { ...named, name: 'Charlotte Linlin' } }],
    ]);
  });

  it('texto desconhecido fica manual (linha a linha)', () => {
    const p = parseCard(card('[On Play] Draw 1 card.\n[When Attacking] Swap the universe.'));
    expect(p.unparsed).toEqual(['[When Attacking] Swap the universe.']);
    expect(p.abilities.map((a) => a.manual ?? false)).toEqual([false, true]);
  });
});
