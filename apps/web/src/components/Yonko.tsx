// Entrada do Yonko ("Mesa dos 4 Imperadores"): o deck de quem joga, as regras da mesa e as duas formas de
// jogar: a mesa online (criar com código, ou entrar com o código de alguém) e a mesa local contra três bots,
// no navegador. A sala de espera e a mesa online estão em YonkoOnline.tsx.

import { type CardData, type DeckList, type GameConfig, type TableRules, yonkoTableDeck } from '@gumgum/engine';
import { useEffect, useMemo, useState } from 'react';
import { api, type DeckSummary, type YonkoSeatRef } from '../api';
import { useAuth } from '../auth';
import { rememberDeck, yonkoLegal } from '../deckLibrary';
import type { YonkoSetup } from '../game/useYonkoGame';
import { useT } from '../i18n';
import { DeckPicker } from './DeckPicker';
import { Icon } from './Icons';
import { usableForYonko } from './YonkoOnline';
import { MANUAL_RULES, RulesPanel } from './YonkoRules';

const DECK_KEY = 'gumgum.yonko.deck';
const RULES_KEY = 'gumgum.yonko.rules';
const SEATS = 4;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function savedRules(): TableRules {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as TableRules | null;
    if (r && typeof r === 'object') {
      return {
        extraLife: Number.isInteger(r.extraLife) ? Math.min(4, Math.max(0, r.extraLife!)) : MANUAL_RULES.extraLife,
        curveChoice: typeof r.curveChoice === 'boolean' ? r.curveChoice : MANUAL_RULES.curveChoice,
        eliminationDraw: Number.isInteger(r.eliminationDraw) ? Math.min(2, Math.max(0, r.eliminationDraw!)) : 0,
      };
    }
  } catch {
    /* sem armazenamento */
  }
  return { ...MANUAL_RULES };
}

/** Só os campos ligados (o motor trata a ausência como desligado). */
const compactRules = (r: TableRules): TableRules => ({
  ...(r.extraLife ? { extraLife: r.extraLife } : {}),
  ...(r.curveChoice ? { curveChoice: true } : {}),
  ...(r.eliminationDraw ? { eliminationDraw: r.eliminationDraw } : {}),
});

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

export function Yonko({
  onExit,
  onStart,
  onOnline,
  onBuildDecks,
  again,
  code: initialCode,
}: {
  onExit: () => void;
  onStart: (setup: YonkoSetup) => void;
  onOnline: (seat: YonkoSeatRef) => void;
  onBuildDecks: () => void;
  again?: YonkoSetup;
  /** Código de um convite (`/?yonko=CODE`): já vem preenchido em "Entrar com código". */
  code?: string;
}) {
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
  const [busy, setBusy] = useState<null | 'local' | 'create' | 'join'>(null);
  const [joinCode, setJoinCode] = useState(initialCode ?? '');
  const [active, setActive] = useState<YonkoSeatRef[]>([]);

  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch((e) => setError(errorText(e)));
    api.yonko
      .active()
      .then(setActive)
      .catch(() => undefined);
  }, []);

  const mine = useMemo(
    () =>
      decks?.find((d) => d.id === deckId && usableForYonko(d)) ??
      decks?.find((d) => d.mine && yonkoLegal(d)) ??
      decks?.find((d) => d.mine && d.valid) ??
      decks?.find((d) => d.kind === 'builtin' && d.valid && !d.allBlue),
    [decks, deckId],
  );
  // Os decks dos bots da mesa local: sorteados ao abrir e quando o Líder de quem joga muda.
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

  const remember = () => {
    if (!mine) return;
    try {
      localStorage.setItem(DECK_KEY, mine.id);
    } catch {
      /* sem armazenamento */
    }
    rememberDeck(mine.id);
  };

  const startLocal = async () => {
    if (!mine || bots.length < SEATS - 1) return;
    setBusy('local');
    setError(null);
    try {
      const [all, ...lists] = await Promise.all([api.cards(), ...[mine, ...bots].map((d) => api.deck(d.id))]);
      const seed = Math.floor(Math.random() * 1_000_000);
      const built: DeckList[] = [];
      for (const [i, { deck }] of lists.entries()) {
        const made = yonkoTableDeck(deck, all as CardData[], seed + i);
        if (!made) throw new Error(t('yonko.deckTooSmall', { name: deck.name }));
        built.push(made.deck);
      }
      // Só as cartas dos quatro decks vão para a partida.
      const used = new Set(built.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]));
      const name = user?.name?.split(' ')[0] || t('yonko.you');
      const config: GameConfig = {
        seed,
        cards: (all as CardData[]).filter((c) => used.has(c.id)),
        table: compactRules(rules),
        players: built.map((deck, i) => ({ name: i === 0 ? name : t('yonko.botName', { n: i }), deck, isBot: i !== 0 })),
      };
      remember();
      onStart({ config, human: 0, deckIds: [mine.id, ...bots.map((d) => d.id)] });
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const create = async () => {
    if (!mine) return;
    setBusy('create');
    setError(null);
    try {
      const seat = await api.yonko.create(mine.id, compactRules(rules));
      remember();
      onOnline(seat);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const join = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!mine || !code) return;
    setBusy('join');
    setError(null);
    try {
      const seat = await api.yonko.join(code, mine.id);
      remember();
      onOnline(seat);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const sixty = mine ? yonkoLegal(mine) : false;

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
        </div>

        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        {active.map((a) => (
          <div key={a.id} className="yk-resume">
            <span>
              {a.status === 'playing' ? t('yonko.resumePlaying', { code: a.code }) : a.status === 'finished' ? t('yonko.resumeFinished', { code: a.code }) : t('yonko.resumeWaiting', { code: a.code })}
            </span>
            <button type="button" className="btn small primary" onClick={() => onOnline(a)}>
              {t('yonko.resume')}
            </button>
          </div>
        ))}

        <section className="yk-panel yk-deck">
          <div className="yk-deck-info">
            <span className="yk-avatar" data-c={mine?.colors[0] ?? 'red'}>
              <Icon name="deck" size={28} />
            </span>
            <div>
              <div className="yk-kicker">{t('yonko.yourDeck')}</div>
              <b className="yk-deck-name">{mine ? mine.name : decks ? t('yonko.noDeck') : t('common.loading')}</b>
              {mine && <p className="muted small">{sixty ? t('yonko.deck60') : t('yonko.deckTest')}</p>}
            </div>
          </div>
          <div className="yk-deck-actions">
            <button type="button" className="btn small" disabled={!decks} onClick={() => setPicking(true)}>
              {t('yonko.changeDeck')}
            </button>
            <button type="button" className="btn small" onClick={onBuildDecks}>
              {t('yonko.buildDecks')}
            </button>
          </div>
        </section>

        <div className="yk-modes">
          <section className="yk-panel yk-mode">
            <div className="yk-kicker">{t('yonko.onlineKicker')}</div>
            <h3>{t('yonko.onlineTitle')}</h3>
            <p className="muted">{t('yonko.onlineDesc')}</p>
            <button type="button" className="mode-btn yk-cta" disabled={!mine || busy !== null} onClick={() => void create()}>
              {busy === 'create' ? t('yonko.creating') : t('yonko.create')}
            </button>
            <form
              className="yk-join"
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <label className="muted small" htmlFor="yk-code">
                {t('yonko.joinLabel')}
              </label>
              <div className="yk-join-row">
                <input
                  id="yk-code"
                  className="input"
                  value={joinCode}
                  maxLength={6}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="ABC123"
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                />
                <button type="submit" className="btn primary" disabled={!mine || joinCode.trim().length < 6 || busy !== null}>
                  {busy === 'join' ? t('yonko.joining') : t('yonko.join')}
                </button>
              </div>
            </form>
          </section>

          <section className="yk-panel yk-mode">
            <div className="yk-kicker">{t('yonko.localKicker')}</div>
            <h3>{t('yonko.localTitle')}</h3>
            <p className="muted">{t('yonko.localDesc')}</p>
            <div className="yk-bots">
              {bots.map((d, i) => (
                <span key={d.id} className="yk-chip" title={d.name}>
                  <Icon name="bot" size={14} /> {t('yonko.botName', { n: i + 1 })} · {d.leaderName ?? d.name}
                </span>
              ))}
              <button type="button" className="btn small" disabled={!decks} onClick={() => decks && setBots(drawBotDecks(decks, mine, SEATS - 1))}>
                {t('yonko.rerollBots')}
              </button>
            </div>
            <button type="button" className="mode-btn yk-cta" disabled={!mine || bots.length < SEATS - 1 || busy !== null} onClick={() => void startLocal()}>
              {busy === 'local' ? t('yonko.starting') : t('yonko.start')}
            </button>
          </section>
        </div>

        <div className="yk-lobby-grid">
          <RulesPanel rules={rules} editable onChange={update} onBuildDecks={onBuildDecks} />
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
          </div>
        </div>
      </div>

      {picking && decks && (
        <DeckPicker
          title={t('yonko.pickDeck')}
          context={t('yonko.pickDeckContext')}
          decks={decks.filter((d) => !d.allBlue)}
          value={mine?.id ?? ''}
          canUse={usableForYonko}
          whyNot={(d) => (usableForYonko(d) ? null : (d.errors[0] ?? t('yonko.deckInvalid')))}
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
