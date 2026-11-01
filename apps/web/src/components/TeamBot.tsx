// "Bot do Time" (docs/plano-bot-time.md, tela 3.4): os decks do meta com o estado do guia e do perfil, e a caixa
// de correções (marcações de jogadas e notas que o Time enviou). O Time lê; o admin trata cada correção
// (estado e resposta) e abre o replay na jogada marcada.

import { useEffect, useState } from 'react';
import { api, FEEDBACK_STATUSES, type FeedbackDeckSummary, type FeedbackItem, type FeedbackStatus, type MetaDeckInfo } from '../api';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useLocale, useT } from '../i18n';
import { fmtDateTime, fmtNumber } from '../i18n/format';
import { openReplay } from './Reports';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATUS_KEY: Record<FeedbackStatus, MessageKey> = {
  open: 'teambot.status.open',
  test: 'teambot.status.test',
  fixed: 'teambot.status.fixed',
  dismissed: 'teambot.status.dismissed',
};

/** A jogada por números de carta, numa linha ("attack ST01-013 → ST02-001"). */
function choiceText(c: unknown): string {
  if (!c) return '';
  if (typeof c === 'string') return c;
  const o = c as Record<string, unknown>;
  const parts = [String(o.type ?? '')];
  if (o.card) parts.push(String(o.card));
  if (Array.isArray(o.cards)) parts.push(o.cards.join(', '));
  if (o.target) parts.push(`→ ${String(o.target)}`);
  if (o.yes !== undefined) parts.push(o.yes ? 'sim' : 'não');
  if (o.index !== undefined) parts.push(`#${String(o.index)}`);
  if (o.redraw !== undefined) parts.push(o.redraw ? 'trocar' : 'manter');
  return parts.join(' ');
}

/** Tela inteira (menu "Bot do Time", para quem é do Time). */
export function TeamBot({ onExit, onReplay, admin }: { onExit: () => void; onReplay: (setup: GameSetup) => void; admin: boolean }) {
  const t = useT();
  return (
    <div className="coverage admin teambot">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('admin.menu')}
        </button>
        <h2>{t('teambot.title')}</h2>
      </header>
      <div className="coverage-body">
        <TeamBotPanel onReplay={onReplay} admin={admin} />
      </div>
    </div>
  );
}

/** O conteúdo (também a aba "Bot do Time" da Administração). */
export function TeamBotPanel({ onReplay, admin }: { onReplay: (setup: GameSetup) => void; admin: boolean }) {
  const t = useT();
  const [decks, setDecks] = useState<MetaDeckInfo[] | null>(null);
  const [summary, setSummary] = useState<FeedbackDeckSummary[]>([]);
  const [agent, setAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    Promise.all([api.bot.profiles(), api.bot.feedbackSummary(), api.bot.agent().catch(() => ({ enabled: false }))])
      .then(([p, s, a]) => {
        if (stop) return;
        setDecks(p.decks);
        setSummary(s.decks);
        setAgent(a.enabled);
      })
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, []);
  return (
    <>
      <section className="menu-card">
        <h3>{t('teambot.decks')}</h3>
        <p className="muted small">{t('teambot.decksHelp')}</p>
        {error && <div className="error">{error}</div>}
        {decks === null && !error && <p className="muted">{t('common.loading')}</p>}
        {decks?.length === 0 && <p className="muted">{t('teambot.noDecks')}</p>}
        {decks && decks.length > 0 && (
          <DeckTable decks={decks} summary={summary} admin={admin} agent={agent} onSaved={(d) => setDecks((list) => list?.map((x) => (x.id === d.id ? { ...x, ...d } : x)) ?? null)} />
        )}
      </section>
      <Inbox onReplay={onReplay} admin={admin} agent={agent} />
    </>
  );
}

function DeckTable({ decks, summary, admin, agent, onSaved }: { decks: MetaDeckInfo[]; summary: FeedbackDeckSummary[]; admin: boolean; agent: boolean; onSaved: (d: MetaDeckInfo) => void }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, { guide: string | null; profile: unknown }>>({});
  const show = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!detail[id]) {
      try {
        const d = await api.bot.profile(id);
        setDetail((m) => ({ ...m, [id]: { guide: d.guide, profile: d.profile } }));
      } catch {
        /* a linha mostra só o estado */
      }
    }
  };
  return (
    <table className="admin-table teambot-decks">
      <thead>
        <tr>
          <th>{t('teambot.colDeck')}</th>
          <th>{t('teambot.colArchetype')}</th>
          <th>{t('teambot.colGuide')}</th>
          <th>{t('teambot.colProfile')}</th>
          <th>{t('teambot.colRatings')}</th>
          <th>{t('teambot.colMarks')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {decks.map((d) => {
          const s = summary.find((x) => x.botDeck === d.id);
          const row = (
            <tr key={d.id}>
              <td>
                <b>{d.name}</b> <span className="muted small">({d.leader})</span>
              </td>
              <td>{d.archetype ? t(`teambot.archetype.${d.archetype}` as MessageKey) : '—'}</td>
              <td>{d.hasGuide ? '✓' : '—'}</td>
              <td title={d.profileError ?? undefined}>{d.hasProfile ? '✓' : d.profileError ? t('teambot.profileInvalid') : '—'}</td>
              <td>{s?.ratings ? `${fmtNumber(s.ratings, locale)} · ★ ${(s.avgRating ?? 0).toFixed(1)}` : '—'}</td>
              <td>{s?.marks ? t('teambot.marksCount', { open: s.openMarks, n: s.marks }) : '—'}</td>
              <td>
                <button className="btn small" onClick={() => show(d.id)}>
                  {open === d.id ? t('teambot.hideGuide') : t('teambot.showGuide')}
                </button>
              </td>
            </tr>
          );
          if (open !== d.id) return row;
          const dd = detail[d.id];
          return [
            row,
            <tr key={`${d.id}-detail`} className="teambot-detail">
              <td colSpan={7}>
                {d.summary && <p>{d.summary}</p>}
                {d.profileError && <p className="error small">{d.profileError}</p>}
                {d.overridden && <p className="muted small">{t('teambot.overridden')}</p>}
                {!dd ? (
                  <p className="muted">{t('common.loading')}</p>
                ) : admin ? (
                  <DeckEditor
                    deck={d}
                    guide={dd.guide}
                    profile={dd.profile}
                    agent={agent}
                    onSaved={(saved) => {
                      setDetail((m) => ({ ...m, [d.id]: { guide: saved.guide, profile: saved.profile } }));
                      onSaved(saved);
                    }}
                  />
                ) : (
                  <div className="teambot-detail-cols">
                    <div>
                      <b className="small">{t('teambot.guide')}</b>
                      <pre>{dd.guide ?? t('teambot.noGuide')}</pre>
                    </div>
                    <div>
                      <b className="small">{t('teambot.profile')}</b>
                      <pre>{dd.profile ? JSON.stringify(dd.profile, null, 2) : t('teambot.noProfile')}</pre>
                    </div>
                  </div>
                )}
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

/** Admin: edita o guia (markdown) e o perfil (JSON), gera o rascunho do perfil com o agente e salva no servidor. */
function DeckEditor({
  deck,
  guide,
  profile,
  agent,
  onSaved,
}: {
  deck: MetaDeckInfo;
  guide: string | null;
  profile: unknown;
  agent: boolean;
  onSaved: (d: MetaDeckInfo & { guide: string | null; profile: unknown }) => void;
}) {
  const t = useT();
  const [guideText, setGuideText] = useState(guide ?? '');
  const [profileText, setProfileText] = useState(profile ? JSON.stringify(profile, null, 2) : '');
  const [why, setWhy] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<'save' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = guideText !== (guide ?? '') || profileText !== (profile ? JSON.stringify(profile, null, 2) : '');
  const save = async () => {
    setBusy('save');
    setError(null);
    setSaved(false);
    try {
      let parsed: unknown = null;
      if (profileText.trim()) {
        try {
          parsed = JSON.parse(profileText);
        } catch (e) {
          throw new Error(t('teambot.profileJsonError', { message: errorText(e) }));
        }
      }
      const r = await api.bot.saveProfile(deck.id, { guide: guideText.trim() ? guideText : null, profile: parsed });
      onSaved(r);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const generate = async () => {
    setBusy('generate');
    setError(null);
    setWhy(null);
    try {
      const r = await api.bot.generateProfile(deck.id);
      setProfileText(JSON.stringify(r.profile, null, 2));
      setWhy(r.why);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="teambot-editor">
      <p className="muted small">{t('teambot.editorHelp')}</p>
      <div className="teambot-detail-cols">
        <label>
          <b className="small">{t('teambot.guide')}</b>
          <textarea value={guideText} rows={14} maxLength={60000} placeholder={t('teambot.guidePlaceholder')} onChange={(e) => setGuideText(e.target.value)} />
        </label>
        <label>
          <b className="small">{t('teambot.profile')}</b>
          <textarea value={profileText} rows={14} spellCheck={false} placeholder={t('teambot.profilePlaceholder')} onChange={(e) => setProfileText(e.target.value)} />
        </label>
      </div>
      {why && (
        <details className="teambot-why" open>
          <summary>{t('teambot.why')}</summary>
          <ul>
            {Object.entries(why).map(([k, v]) => (
              <li key={k}>
                <b>{k}</b>: {v}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="teambot-actions">
        {agent && (
          <button className="btn small" disabled={busy !== null || !guideText.trim()} onClick={generate} title={t('teambot.generateTitle')}>
            {busy === 'generate' ? t('teambot.generating') : t('teambot.generate')}
          </button>
        )}
        <button className="btn small primary" disabled={busy !== null || !dirty} onClick={save}>
          {busy === 'save' ? t('common.saving') : t('common.save')}
        </button>
        {saved && !dirty && <span className="muted small">{t('teambot.saved')}</span>}
        {error && <span className="error small">{error}</span>}
      </div>
    </div>
  );
}

function Inbox({ onReplay, admin, agent }: { onReplay: (setup: GameSetup) => void; admin: boolean; agent: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('open');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ id: number; status: FeedbackStatus; note: string } | null>(null);
  useEffect(() => {
    let stop = false;
    setItems(null);
    api.bot
      .feedbackList(status)
      .then((r) => !stop && (setItems(r.items), setError(null)))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [status]);
  const save = async () => {
    if (!edit) return;
    setBusy(edit.id);
    try {
      const saved = await api.bot.setFeedbackStatus(edit.id, edit.status, edit.note.trim() || undefined);
      setItems((list) => list?.map((x) => (x.id === saved.id ? saved : x)) ?? null);
      setEdit(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  /** Revisão do agente por partida (markdown em texto). */
  const [reviews, setReviews] = useState<Record<number, string>>({});
  const [reviewing, setReviewing] = useState<number | null>(null);
  const review = async (f: FeedbackItem) => {
    setReviewing(f.matchId);
    setError(null);
    try {
      const r = await api.bot.reviewMatch(f.matchId);
      setReviews((m) => ({ ...m, [f.matchId]: r.review }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReviewing(null);
    }
  };
  const replayAt = async (f: FeedbackItem) => {
    try {
      await openReplay(f.matchId, (setup) => onReplay({ ...setup, replayStart: { paused: true, speed: 1, ...(f.actionIndex !== null ? { at: f.actionIndex } : {}) } }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="menu-card">
      <h3>{t('teambot.inbox')}</h3>
      <div className="seg small">
        {([...FEEDBACK_STATUSES, 'all'] as const).map((k) => (
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
            {k === 'all' ? t('teambot.filterAll') : t(STATUS_KEY[k])}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {items === null && !error && <p className="muted">{t('common.loading')}</p>}
      {items?.length === 0 && <p className="muted">{t('teambot.empty')}</p>}
      <div className="teambot-items">
        {items?.map((f) => (
          <article key={f.id} className={['teambot-item', f.kind, f.status].join(' ')}>
            <header>
              <span className={['role-tag', f.kind === 'mark' ? 'organizer' : ''].join(' ')}>{f.kind === 'mark' ? t('teambot.kindMark') : t('teambot.kindRating')}</span>
              <span className="muted small">
                #{f.matchId} · {f.leader ?? '?'} × {f.oppLeader ?? '?'}
                {f.botLevel ? ` · ${f.botLevel}` : ''}
                {f.turn !== null ? ` · ${t('teambot.turn', { n: f.turn })}` : ''}
              </span>
              <span className="muted small">
                {f.userName ?? '—'} · {fmtDateTime(f.createdAt, locale)}
              </span>
              <span className="teambot-status">{t(STATUS_KEY[f.status])}</span>
            </header>
            {f.kind === 'rating' && <p className="teambot-stars">{'★'.repeat(f.rating ?? 0)}</p>}
            {f.kind === 'mark' && (
              <dl className="teambot-mark">
                <dt>{t('teambot.botDid')}</dt>
                <dd>
                  <code>{choiceText(f.botAction)}</code>
                </dd>
                {f.expected !== null && (
                  <>
                    <dt>{t('teambot.expected')}</dt>
                    <dd>
                      <code>{choiceText(f.expected)}</code>
                    </dd>
                  </>
                )}
              </dl>
            )}
            {f.comment && <p className="teambot-comment">{f.comment}</p>}
            {f.note && (
              <p className="muted small">
                {t('teambot.noteLabel')} {f.note}
              </p>
            )}
            {reviews[f.matchId] && <pre className="teambot-review">{reviews[f.matchId]}</pre>}
            <div className="teambot-actions">
              <button className="btn small" onClick={() => replayAt(f)}>
                {t('teambot.openReplay')}
              </button>
              {admin && agent && (
                <button className="btn small" disabled={reviewing === f.matchId} onClick={() => review(f)} title={t('teambot.reviewTitle')}>
                  {reviewing === f.matchId ? t('teambot.reviewing') : t('teambot.review')}
                </button>
              )}
              {admin && edit?.id !== f.id && (
                <button className="btn small" disabled={busy === f.id} onClick={() => setEdit({ id: f.id, status: f.status, note: f.note ?? '' })}>
                  {t('teambot.treat')}
                </button>
              )}
              {admin && edit?.id === f.id && (
                <>
                  <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as FeedbackStatus })}>
                    {FEEDBACK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(STATUS_KEY[s])}
                      </option>
                    ))}
                  </select>
                  <input className="admin-search report-note" placeholder={t('teambot.notePlaceholder')} maxLength={2000} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                  <button className="btn small primary" disabled={busy === f.id} onClick={save}>
                    {t('common.save')}
                  </button>
                  <button className="btn small" onClick={() => setEdit(null)}>
                    {t('common.cancel')}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
