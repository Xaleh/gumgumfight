// Sala do Yonko ("Mesa dos 4 Imperadores"): os quatro lugares, o deck de quem joga e as regras da mesa. Por
// enquanto a mesa é local: quem abre joga contra três bots, no navegador. A sala com código para quatro
// pessoas depende do servidor (fase 2 do plano, docs/plano-modos-de-jogo.md).

import { type CardData, type DeckList, type GameConfig, type TableRules, YONKO_TABLE, yonkoDeckFrom } from '@gumgum/engine';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary } from '../api';
import { useAuth } from '../auth';
import { rememberDeck } from '../deckLibrary';
import type { YonkoSetup } from '../game/useYonkoGame';
import { useT } from '../i18n';
import { DeckPicker } from './DeckPicker';
import { Icon } from './Icons';

const DECK_KEY = 'gumgum.yonko.deck';
const RULES_KEY = 'gumgum.yonko.rules';
const SEATS = 4;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function savedRules(): TableRules {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as TableRules | null;
    if (r && typeof r === 'object') {
      return {
        extraLife: Number.isInteger(r.extraLife) ? Math.min(4, Math.max(0, r.extraLife!)) : YONKO_TABLE.extraLife,
        curveChoice: typeof r.curveChoice === 'boolean' ? r.curveChoice : YONKO_TABLE.curveChoice,
        eliminationDraw: Number.isInteger(r.eliminationDraw) ? Math.min(2, Math.max(0, r.eliminationDraw!)) : 0,
      };
    }
  } catch {
    /* sem armazenamento */
  }
  return { ...YONKO_TABLE, eliminationDraw: 0 };
}

const sameRules = (a: TableRules, b: TableRules) => (a.extraLife ?? 0) === (b.extraLife ?? 0) && Boolean(a.curveChoice) === Boolean(b.curveChoice) && (a.eliminationDraw ?? 0) === (b.eliminationDraw ?? 0);

/** Sorteia `n` decks prontos para os bots, com Líderes diferentes entre si (e do de quem joga) enquanto der. */
function drawBotDecks(decks: DeckSummary[], mine: DeckSummary | undefined, n: number): DeckSummary[] {
  const pool = decks.filter((d) => d.kind === 'builtin' && d.valid && !d.allBlue);
  const out: DeckSummary[] = [];
  const used = new Set(mine ? [mine.leader] : []);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const d of shuffled) {
    if (out.length === n) break;
    if (used.has(d.leader)) continue;
    used.add(d.leader);
    out.push(d);
  }
  for (const d of shuffled) {
    if (out.length === n) break;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function Stepper({ value, min, max, onChange, label, plus }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string; plus?: boolean }) {
  return (
    <span className="yk-step" role="group" aria-label={label}>
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="−">
        −
      </button>
      <span className="v">{plus && value > 0 ? `+${value}` : value}</span>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="+">
        +
      </button>
    </span>
  );
}

function Option({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="yk-opt">
      <div className="t">
        {title}
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}

export function Yonko({ onExit, onStart, onBuildDecks, again }: { onExit: () => void; onStart: (setup: YonkoSetup) => void; onBuildDecks: () => void; again?: YonkoSetup }) {
  const t = useT();
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string>(() => {
    try {
      return again?.deckIds[0] ?? localStorage.getItem(DECK_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [rules, setRules] = useState<TableRules>(savedRules);
  const [bots, setBots] = useState<DeckSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch((e) => setError(errorText(e)));
  }, []);

  const mine = useMemo(() => decks?.find((d) => d.id === deckId) ?? decks?.find((d) => d.mine && d.valid) ?? decks?.find((d) => d.kind === 'builtin' && d.valid && !d.allBlue), [decks, deckId]);
  // Os decks dos bots são sorteados ao abrir a sala e quando o Líder de quem joga muda.
  useEffect(() => {
    if (decks) setBots(drawBotDecks(decks, mine, SEATS - 1));
  }, [decks, mine?.leader]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: TableRules) => {
    setRules(next);
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(next));
    } catch {
      /* sem armazenamento */
    }
  };

  const start = async () => {
    if (!mine || bots.length < SEATS - 1) return;
    setBusy(true);
    setError(null);
    try {
      const [all, ...lists] = await Promise.all([api.cards(), ...[mine, ...bots].map((d) => api.deck(d.id))]);
      const seed = Math.floor(Math.random() * 1_000_000);
      const built: DeckList[] = [];
      for (const [i, { deck }] of lists.entries()) {
        const made = yonkoDeckFrom(deck, all as CardData[], seed + i);
        if (!made) throw new Error(t('yonko.deckTooSmall', { name: deck.name }));
        built.push(made);
      }
      // Só as cartas dos quatro decks vão para a partida.
      const used = new Set(built.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]));
      const name = user?.name?.split(' ')[0] || t('yonko.you');
      const config: GameConfig = {
        seed,
        cards: (all as CardData[]).filter((c) => used.has(c.id)),
        table: { ...(rules.extraLife ? { extraLife: rules.extraLife } : {}), ...(rules.curveChoice ? { curveChoice: true } : {}), ...(rules.eliminationDraw ? { eliminationDraw: rules.eliminationDraw } : {}) },
        players: built.map((deck, i) => ({ name: i === 0 ? name : t('yonko.botName', { n: i }), deck, isBot: i !== 0 })),
      };
      try {
        localStorage.setItem(DECK_KEY, mine.id);
      } catch {
        /* sem armazenamento */
      }
      rememberDeck(mine.id);
      onStart({ config, human: 0, deckIds: [mine.id, ...bots.map((d) => d.id)] });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const ready = Boolean(mine) && bots.length === SEATS - 1;
  const manual = sameRules(rules, { ...YONKO_TABLE, eliminationDraw: 0 });

  return (
    <div className="yk-lobby">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('common.back')}
        </button>
        <h2>{t('yonko.title')}</h2>
      </header>
      <div className="yk-lobby-wrap">
        <div className="yk-lobby-head">
          <div>
            <div className="yk-kicker">{t('yonko.lobbyKicker')}</div>
            <h1 className="yk-h1">{t('yonko.lobbyTitle')}</h1>
          </div>
          <div className="yk-local">
            <span className="yk-kicker">{t('yonko.localKicker')}</span>
            <p>{t('yonko.localNote')}</p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="yk-seats">
          <div className="yk-seat me">
            <span className="yk-avatar" data-c={mine?.colors[0] ?? 'red'}>
              {(user?.name ?? t('yonko.you')).slice(0, 1).toUpperCase()}
            </span>
            <b className="yk-seat-name">{user?.name?.split(' ')[0] || t('yonko.you')}</b>
            <span className="muted small">{t('yonko.seatOwner')}</span>
            <span className="yk-chip">{mine ? mine.name : decks ? t('yonko.noDeck') : t('common.loading')}</span>
            <button type="button" className="btn small" disabled={!decks} onClick={() => setPicking(true)}>
              {t('yonko.changeDeck')}
            </button>
          </div>
          {Array.from({ length: SEATS - 1 }, (_, i) => {
            const d = bots[i];
            return (
              <div key={i} className="yk-seat">
                <span className="yk-avatar bot" data-c={d?.colors[0] ?? 'black'}>
                  <Icon name="bot" size={30} />
                </span>
                <b className="yk-seat-name">{t('yonko.botName', { n: i + 1 })}</b>
                <span className="muted small">{t('yonko.seatBot')}</span>
                <span className="yk-chip">{d ? (d.leaderName ?? d.name) : t('common.loading')}</span>
              </div>
            );
          })}
        </div>
        <div className="yk-lobby-row">
          <p className="muted small">{t('yonko.deckNote')}</p>
          <button type="button" className="btn small" disabled={!decks} onClick={() => decks && setBots(drawBotDecks(decks, mine, SEATS - 1))}>
            {t('yonko.rerollBots')}
          </button>
        </div>

        <div className="yk-lobby-grid">
          <section className="yk-panel">
            <div className="yk-panel-head">
              <h3>{t('yonko.rules')}</h3>
              <span className={['yk-chip', manual ? 'gold' : ''].join(' ')}>{manual ? t('yonko.rulesManual') : t('yonko.rulesHouse')}</span>
              {!manual && (
                <button type="button" className="btn small" onClick={() => update({ ...YONKO_TABLE, eliminationDraw: 0 })}>
                  {t('yonko.rulesReset')}
                </button>
              )}
            </div>
            <Option title={t('yonko.ruleLife')} hint={t('yonko.ruleLifeHint')}>
              <Stepper plus label={t('yonko.ruleLife')} value={rules.extraLife ?? 0} min={0} max={4} onChange={(n) => update({ ...rules, extraLife: n })} />
            </Option>
            <Option title={t('yonko.ruleCurve')} hint={t('yonko.ruleCurveHint')}>
              <div className="seg small" role="group" aria-label={t('yonko.ruleCurve')}>
                <button type="button" className={rules.curveChoice ? 'on' : ''} aria-pressed={Boolean(rules.curveChoice)} onClick={() => update({ ...rules, curveChoice: true })}>
                  {t('yonko.ruleCurveChoice')}
                </button>
                <button type="button" className={!rules.curveChoice ? 'on' : ''} aria-pressed={!rules.curveChoice} onClick={() => update({ ...rules, curveChoice: false })}>
                  {t('yonko.ruleCurveNormal')}
                </button>
              </div>
            </Option>
            <Option title={t('yonko.ruleReward')} hint={t('yonko.ruleRewardHint')}>
              <Stepper label={t('yonko.ruleReward')} value={rules.eliminationDraw ?? 0} min={0} max={2} onChange={(n) => update({ ...rules, eliminationDraw: n })} />
            </Option>
            <Option title={t('yonko.ruleDeck')} hint={t('yonko.ruleDeckHint')}>
              <button type="button" className="btn small" onClick={onBuildDecks}>
                {t('yonko.buildDecks')}
              </button>
            </Option>
          </section>

          <div className="yk-lobby-col">
            <section className="yk-panel">
              <h3>{t('yonko.howEffects')}</h3>
              <ul className="yk-list">
                <li>{t('yonko.howTarget')}</li>
                <li>{t('yonko.howEach')}</li>
                <li>{t('yonko.howCounter')}</li>
              </ul>
            </section>
            <section className="yk-panel">
              <h3>{t('yonko.howWin')}</h3>
              <p className="muted">{t('yonko.howWinText')}</p>
            </section>
            <button type="button" className="mode-btn yk-cta" disabled={!ready || busy} onClick={() => void start()}>
              {busy ? t('yonko.starting') : t('yonko.start')}
            </button>
          </div>
        </div>
      </div>

      {picking && decks && (
        <DeckPicker
          title={t('yonko.pickDeck')}
          context={t('yonko.pickDeckContext')}
          decks={decks.filter((d) => !d.allBlue)}
          value={mine?.id ?? ''}
          canUse={(d) => d.valid}
          whyNot={(d) => (d.valid ? null : (d.errors[0] ?? t('yonko.deckInvalid')))}
          onPick={(id) => {
            setDeckId(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
          onFavorite={() => undefined}
        />
      )}
    </div>
  );
}
