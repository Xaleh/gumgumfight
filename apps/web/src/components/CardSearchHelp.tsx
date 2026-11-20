// Painel dos atalhos da busca de cartas (ver `cardSearch.ts`): cada atalho é um botão que entra
// na busca, ou sai dela se já estiver lá.

import { hasSearchCode, toggleSearchCode } from '../cardSearch';
import { type MessageKey, useT } from '../i18n';

const GROUPS: Array<{ title: MessageKey; rows: Array<{ codes: string[]; text: MessageKey }> }> = [
  {
    title: 'deck.searchHelp.numbers',
    rows: [
      { codes: ['c3'], text: 'deck.searchHelp.cost' },
      { codes: ['c3+', 'c3-', 'c2-4'], text: 'deck.searchHelp.costRange' },
      { codes: ['c2000'], text: 'deck.searchHelp.counter' },
      { codes: ['sc'], text: 'deck.searchHelp.noCounter' },
      { codes: ['p5000', 'p6000+'], text: 'deck.searchHelp.power' },
      { codes: ['v4'], text: 'deck.searchHelp.life' },
    ],
  },
  {
    title: 'deck.searchHelp.card',
    rows: [
      { codes: ['red', 'green', 'blue', 'purple', 'black', 'yellow'], text: 'deck.searchHelp.color' },
      { codes: ['char', 'event', 'stage', 'leader'], text: 'deck.searchHelp.category' },
      { codes: ['slash', 'strike', 'ranged', 'special', 'wisdom'], text: 'deck.searchHelp.attribute' },
      { codes: ['sr', 'sec', 'uc', 'rare', 'common', 'promo'], text: 'deck.searchHelp.rarity' },
      { codes: ['op05', 'st10'], text: 'deck.searchHelp.set' },
    ],
  },
  {
    title: 'deck.searchHelp.effect',
    rows: [
      { codes: ['blocker', 'rush', 'banish', 'double', 'unblockable', 'trigger'], text: 'deck.searchHelp.keyword' },
      { codes: ['onplay', 'onko', 'whenattacking', 'main', 'activate', 'counter'], text: 'deck.searchHelp.timing' },
      { codes: ['don2', 'don-2'], text: 'deck.searchHelp.don' },
      { codes: ['vanilla'], text: 'deck.searchHelp.vanilla' },
    ],
  },
  {
    title: 'deck.searchHelp.deck',
    rows: [
      { codes: ['indeck'], text: 'deck.searchHelp.indeck' },
      { codes: ['banned', 'legal', 'rotated'], text: 'deck.searchHelp.legality' },
      { codes: ['new'], text: 'deck.searchHelp.new' },
    ],
  },
  {
    title: 'deck.searchHelp.operators',
    rows: [
      { codes: ['-blocker'], text: 'deck.searchHelp.not' },
      { codes: ['"straw hat"'], text: 'deck.searchHelp.phrase' },
      { codes: ['n:luffy', 't:supernovas'], text: 'deck.searchHelp.field' },
    ],
  },
];

export function CardSearchHelp({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const t = useT();
  return (
    <div className="search-help" role="region" aria-label={t('deck.searchHelp')}>
      <p className="search-help-hint muted small">{t('deck.searchHelp.hint')}</p>
      <div className="search-help-groups">
        {GROUPS.map((g) => (
          <section key={g.title} className="search-help-group">
            <h4>{t(g.title)}</h4>
            {g.rows.map((r) => (
              <div key={r.text} className="search-help-row">
                <span className="search-help-codes">
                  {r.codes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={['search-code', hasSearchCode(query, code) ? 'on' : ''].join(' ')}
                      aria-pressed={hasSearchCode(query, code)}
                      onClick={() => onQuery(toggleSearchCode(query, code))}
                    >
                      {code}
                    </button>
                  ))}
                </span>
                <span className="search-help-text">{t(r.text)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
