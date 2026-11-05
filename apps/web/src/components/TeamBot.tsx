// "Bot do Time" (docs/plano-bot-time.md, tela 3.4): os decks do meta com o guia (à esquerda) e o perfil (à direita), e
// os relatórios das partidas (as jogadas que o Time marcou como erradas), com o pacote para o Claude.

import { useEffect, useState } from 'react';
import { api, type BotReportItem, type FeedbackDeckSummary, type MetaDeckInfo } from '../api';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useLocale, useT } from '../i18n';
import { fmtDateTime, fmtNumber } from '../i18n/format';
import { saveFile } from '../recap/export';
import { copyText } from './CoachPanel';
import { openReplay } from './Reports';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
      <Reports onReplay={onReplay} admin={admin} agent={agent} />
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

/**
 * Os relatórios das partidas: o texto que a mesa monta com as jogadas marcadas como erradas. Cada um pode ser copiado
 * ou baixado num pacote para o Claude (o relatório, o guia e o perfil do deck e o replay); vários selecionados saem
 * num pacote só. O admin marca o que já foi usado e pode abrir o replay ou pedir a revisão do agente.
 */
function Reports({ onReplay, admin, agent }: { onReplay: (setup: GameSetup) => void; admin: boolean; agent: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState<'new' | 'used' | 'all'>('new');
  const [reports, setReports] = useState<BotReportItem[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Revisão do agente por partida (markdown em texto). */
  const [reviews, setReviews] = useState<Record<number, string>>({});
  useEffect(() => {
    let stop = false;
    setReports(null);
    setSelected([]);
    api.bot
      .reports(filter === 'all' ? undefined : filter === 'used')
      .then((r) => !stop && (setReports(r.reports), setError(null)))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [filter]);
  const download = async (ids: number[]) => {
    setBusy(`pkg:${ids.join(',')}`);
    setError(null);
    try {
      const pkg = await api.bot.reportPackage(ids);
      saveFile(new Blob([pkg.content], { type: 'text/markdown' }), pkg.filename);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (r: BotReportItem) => {
    if (await copyText(r.report)) {
      setCopied(r.id);
      setTimeout(() => setCopied(null), 2000);
    }
  };
  const toggleUsed = async (r: BotReportItem) => {
    setBusy(`used:${r.id}`);
    try {
      const saved = await api.bot.setReportUsed(r.id, !r.usedAt);
      // Fora do filtro escolhido, o relatório sai da lista.
      setReports((list) => list?.flatMap((x) => (x.id !== r.id ? [x] : filter === 'all' ? [saved] : [])) ?? null);
      setSelected((ids) => ids.filter((id) => id !== r.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const replayAt = async (r: BotReportItem) => {
    try {
      await openReplay(r.matchId, (setup) => onReplay({ ...setup, replayStart: { paused: true, speed: 1 } }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const review = async (r: BotReportItem) => {
    setBusy(`review:${r.id}`);
    setError(null);
    try {
      const res = await api.bot.reviewMatch(r.matchId);
      setReviews((m) => ({ ...m, [r.matchId]: res.review }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="menu-card">
      <h3>{t('teambot.reports')}</h3>
      <p className="muted small">{t('teambot.reportsHelp')}</p>
      <div className="teambot-reports-bar">
        <div className="seg small">
          {(
            [
              ['new', 'teambot.filterNew'],
              ['used', 'teambot.filterUsed'],
              ['all', 'teambot.filterAll'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {t(label)}
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <button className="btn small primary" disabled={busy !== null} onClick={() => download(selected)}>
            {t('teambot.packageSelected', { n: selected.length })}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {reports === null && !error && <p className="muted">{t('common.loading')}</p>}
      {reports?.length === 0 && <p className="muted">{t('teambot.reportsEmpty')}</p>}
      <div className="teambot-items">
        {reports?.map((r) => (
          <article key={r.id} className={['teambot-item', r.usedAt ? 'used' : ''].join(' ')}>
            <header>
              <label className="teambot-select" title={t('teambot.select')}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)))}
                />
              </label>
              <b>
                {r.botDeck ?? '?'} × {r.oppLeader ?? '?'}
              </b>
              <span className="muted small">
                #{r.matchId} · {r.userName ?? '—'} · {fmtDateTime(r.createdAt, locale)}
              </span>
              <span className="role-tag organizer">{t('teambot.reportMarks', { n: r.marks })}</span>
              {r.rating ? <span className="teambot-stars">{'★'.repeat(r.rating)}</span> : null}
              {r.usedAt && <span className="teambot-status">✓ {t('teambot.used')}</span>}
            </header>
            {open === r.id && <pre className="teambot-review">{r.report}</pre>}
            {reviews[r.matchId] && <pre className="teambot-review">{reviews[r.matchId]}</pre>}
            <div className="teambot-actions">
              <button className="btn small" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? t('teambot.hideReport') : t('teambot.showReport')}
              </button>
              <button className="btn small" onClick={() => copy(r)}>
                {copied === r.id ? t('coach.copied') : t('coach.copy')}
              </button>
              <button className="btn small primary" disabled={busy !== null} onClick={() => download([r.id])} title={t('teambot.packageTitle')}>
                {t('teambot.package')}
              </button>
              {admin && (
                <button className="btn small" onClick={() => replayAt(r)}>
                  {t('teambot.openReplay')}
                </button>
              )}
              {admin && agent && (
                <button className="btn small" disabled={busy !== null} onClick={() => review(r)} title={t('teambot.reviewTitle')}>
                  {busy === `review:${r.id}` ? t('teambot.reviewing') : t('teambot.review')}
                </button>
              )}
              {admin && (
                <button className="btn small" disabled={busy !== null} onClick={() => toggleUsed(r)}>
                  {r.usedAt ? t('teambot.unmarkUsed') : t('teambot.markUsed')}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
