import { Fragment, useEffect, useState } from 'react';
import { api, type CoverageRow, type GapCard, type GapLine, type GapPattern, type GapStage, type GapSummary } from '../api';
import { type MessageKey, useLocale, useT } from '../i18n';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Bar({ parts }: { parts: Array<{ n: number; cls: string; title: string }> }) {
  const t = useT();
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  return (
    <div className="cov-bar">
      {parts.map((p) => (
        <span key={p.cls} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} title={t('admin.coverage.barTitle', { title: p.title, n: p.n })} />
      ))}
    </div>
  );
}

const stageKey = (s: GapStage | undefined) => `admin.coverage.stage.${s ?? 'unknown'}` as MessageKey;

/** A linha da carta com o trecho onde o leitor parou destacado (quando ele aparece igual na linha). */
function Line({ l }: { l: GapLine }) {
  const t = useT();
  const at = l.ok || !l.fragment ? -1 : l.line.toLowerCase().indexOf(l.fragment.toLowerCase());
  return (
    <li className={l.ok ? 'gap-line ok' : 'gap-line gap'}>
      <span className="gap-mark" title={t(l.ok ? 'admin.coverage.lineOk' : 'admin.coverage.lineGap')}>
        {l.ok ? '✓' : '✗'}
      </span>
      <span>
        {at < 0 ? (
          l.line
        ) : (
          <>
            {l.line.slice(0, at)}
            <mark>{l.line.slice(at, at + l.fragment!.length)}</mark>
            {l.line.slice(at + l.fragment!.length)}
          </>
        )}
        {!l.ok && (
          <span className="gap-where">
            {t('admin.coverage.stoppedAt', { stage: t(stageKey(l.stage)) })} <code>{l.fragment}</code>
          </span>
        )}
      </span>
    </li>
  );
}

/** As cartas ⚙ de uma coleção, de uma frase ou as novas, carregadas quando a lista abre. */
function GapList({ query, onReviewed }: { query: Parameters<typeof api.cardGapCards>[0]; onReviewed?: (cards: GapCard[]) => void }) {
  const t = useT();
  const locale = useLocale();
  const [cards, setCards] = useState<GapCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);

  useEffect(() => {
    setCards(null);
    api
      .cardGapCards(query)
      .then((r) => setCards(r.cards))
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Sem `ids`, o servidor marca todas as novas da base (a lista "Novas" mostra todas elas).
  const review = (ids: string[] | null) =>
    api
      .markCardGapsReviewed(ids ?? undefined)
      .then(() => {
        const seen = (cards ?? []).filter((c) => c.isNew && (!ids || ids.includes(c.id)));
        setCards((cs) => (cs ?? []).map((c) => (seen.includes(c) ? { ...c, isNew: false } : c)));
        onReviewed?.(seen);
      })
      .catch((e) => setError(errorText(e)));

  if (error) return <div className="error">{error}</div>;
  if (!cards) return <div className="muted">{t('common.loading')}</div>;
  if (!cards.length) return <div className="muted">{t('new' in query ? 'admin.coverage.newNone' : 'admin.coverage.noGaps')}</div>;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  return (
    <div className="gap-list">
      {'new' in query && cards.some((c) => c.isNew) && (
        <button className="btn small" onClick={() => review(null)}>
          {t('admin.coverage.markAll')}
        </button>
      )}
      {cards.map((c) => (
        <article key={c.id} className="gap-card">
          <header>
            <b>{c.id}</b> {c.name}
            <span className={`gap-chip cov-${c.status}`}>{t(c.status === 'partial' ? 'admin.coverage.statusPartial' : 'admin.coverage.statusManual')}</span>
            {c.provisional && <span className="gap-chip">{t('admin.coverage.badgeSpoiler')}</span>}
            {c.isNew && <span className="gap-chip gap-new">{t('admin.coverage.badgeNew')}</span>}
            {c.firstSeen && <span className="muted small">{t('admin.coverage.firstSeen', { date: date(c.firstSeen) })}</span>}
            {c.isNew && (
              <button className="btn small gap-seen" onClick={() => review([c.id])}>
                {t('admin.coverage.markOne')}
              </button>
            )}
          </header>
          <ul>
            {c.lines.map((l, i) => (
              <Line key={i} l={l} />
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function Patterns({ gaps }: { gaps: GapSummary }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const keyOf = (p: GapPattern) => `${p.stage}:${p.pattern}`;
  const stages = Object.entries(gaps.stages).sort((a, b) => b[1] - a[1]) as Array<[GapStage, number]>;
  return (
    <>
      <p className="muted">{t('admin.coverage.patternsIntro')}</p>
      <p className="gap-stages">
        {stages.map(([s, n]) => (
          <span key={s} className="gap-chip">
            {t(stageKey(s))}: {n}
          </span>
        ))}
      </p>
      {gaps.patternCount > gaps.patterns.length && (
        <p className="muted small">{t('admin.coverage.patternsMore', { shown: gaps.patterns.length, total: gaps.patternCount })}</p>
      )}
      <div className="table-scroll">
        <table className="cov-table gap-patterns">
          <thead>
            <tr>
              <th>{t('admin.coverage.colPatternCards')}</th>
              <th>{t('admin.coverage.colStage')}</th>
              <th>{t('admin.coverage.colPattern')}</th>
              <th>{t('admin.coverage.colSets')}</th>
            </tr>
          </thead>
          <tbody>
            {gaps.patterns.map((p) => {
              const k = keyOf(p);
              return (
                <Fragment key={k}>
                  <tr className="cov-click" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
                    <td>
                      <b>{p.cards.length}</b>
                    </td>
                    <td className="small">{t(stageKey(p.stage))}</td>
                    <td title={p.example}>
                      <code>{p.pattern}</code>
                    </td>
                    <td className="small">{p.sets.join(', ')}</td>
                  </tr>
                  {open === k && (
                    <tr className="cov-detail">
                      <td colSpan={4}>
                        <GapList query={{ ids: p.cards }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

type Tab = 'sets' | 'patterns' | 'new';

/** Quanto da base de cartas já é automático e traduzido, por coleção; e, nas cartas ⚙, onde o leitor parou. */
export function Coverage({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ total: CoverageRow; sets: CoverageRow[] } | null>(null);
  const [gaps, setGaps] = useState<GapSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [openSet, setOpenSet] = useState<string | null>(null);

  useEffect(() => {
    api
      .coverage()
      .then(setData)
      .catch((e) => setError(errorText(e)));
    api
      .cardGaps()
      .then((g) => {
        setGaps(g);
        setTab((cur) => cur ?? (g.newCount ? 'new' : 'sets'));
      })
      .catch((e) => setGapError(errorText(e)));
  }, []);

  const current = tab ?? 'sets';
  const newBySet = new Map((gaps?.sets ?? []).map((s) => [s.set, s.new]));
  const reviewed = (seen: GapCard[]) =>
    setGaps((g) => {
      if (!g) return g;
      const bySet = (set: string) => seen.filter((c) => c.set === set).length;
      return { ...g, newCount: Math.max(0, g.newCount - seen.length), sets: g.sets.map((s) => ({ ...s, new: Math.max(0, s.new - bySet(s.set)) })) };
    });

  const row = (r: CoverageRow, strong = false) => {
    const auto = r.scripted + r.auto + r.vanilla;
    const gapsHere = r.partial + r.manual;
    const clickable = !strong && gapsHere > 0 && Boolean(gaps);
    const isOpen = clickable && openSet === r.set;
    const fresh = strong ? gaps?.newCount : newBySet.get(r.set);
    return (
      <Fragment key={r.set}>
        <tr
          className={[strong ? 'cov-total' : '', clickable ? 'cov-click' : ''].join(' ')}
          onClick={clickable ? () => setOpenSet(isOpen ? null : r.set) : undefined}
          title={clickable ? t('admin.coverage.openSet', { set: r.set }) : undefined}
          aria-expanded={clickable ? isOpen : undefined}
        >
          <td>{r.set}</td>
          <td>{r.total}</td>
          <td>
            <Bar
              parts={[
                { n: r.scripted + r.auto, cls: 'cov-scripted', title: t('admin.coverage.scripted') },
                { n: r.vanilla, cls: 'cov-vanilla', title: t('admin.coverage.vanilla') },
                { n: r.partial, cls: 'cov-partial', title: t('admin.coverage.partial') },
                { n: r.manual, cls: 'cov-manual', title: t('admin.coverage.manual') },
              ]}
            />
          </td>
          <td>
            <b>{t('admin.coverage.percent', { n: pct(auto, r.total) })}</b>{' '}
            <span className="muted small">{t('admin.coverage.partialManual', { partial: r.partial, manual: r.manual })}</span>
          </td>
          <td>
            <b>{t('admin.coverage.percent', { n: pct(r.ptComplete, r.total) })}</b>
          </td>
          <td>{fresh ? <span className="gap-chip gap-new">{fresh}</span> : ''}</td>
        </tr>
        {isOpen && (
          <tr className="cov-detail">
            <td colSpan={6}>
              <GapList query={{ set: r.set }} onReviewed={reviewed} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tabs: Array<[Tab, string]> = [
    ['sets', t('admin.coverage.tabSets')],
    ['patterns', t('admin.coverage.tabPatterns')],
    ['new', t('admin.coverage.tabNew', { n: gaps?.newCount ?? 0 })],
  ];

  return (
    <div className="coverage">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('admin.coverage.menu')}
        </button>
        <h2>{t('admin.coverage.title')}</h2>
      </header>
      <div className="coverage-body">
        <div className="seg small cov-tabs" role="tablist" aria-label={t('admin.coverage.title')}>
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={current === k} className={current === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {gapError && current !== 'sets' && <div className="error">{gapError}</div>}

        {current === 'sets' && (
          <>
            <p className="muted">
              <span className="legend cov-scripted" /> {t('admin.coverage.legendScripted')} <span className="legend cov-vanilla" />{' '}
              {t('admin.coverage.legendVanilla')} <span className="legend cov-partial" /> {t('admin.coverage.legendPartial')}{' '}
              <span className="legend cov-manual" /> {t('admin.coverage.legendManual')} {t('admin.coverage.legendAuto')} {gaps && t('admin.coverage.legendOpen')}
            </p>
            {error && <div className="error">{error}</div>}
            {!data && !error && <div className="muted">{t('common.loading')}</div>}
            {data && (
              <div className="table-scroll">
                <table className="cov-table">
                  <thead>
                    <tr>
                      <th>{t('admin.coverage.colSet')}</th>
                      <th>{t('admin.coverage.colCards')}</th>
                      <th>{t('admin.coverage.colAutomation')}</th>
                      <th>{t('admin.coverage.colAuto')}</th>
                      <th>{t('admin.coverage.colPt')}</th>
                      <th>{t('admin.coverage.colNew')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row(data.total, true)}
                    {data.sets.map((r) => row(r))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {current === 'patterns' && (gaps ? <Patterns gaps={gaps} /> : !gapError && <div className="muted">{t('common.loading')}</div>)}

        {current === 'new' && (
          <>
            <p className="muted">{t('admin.coverage.newIntro')}</p>
            {gaps && <GapList query={{ new: true }} onReviewed={reviewed} />}
          </>
        )}
      </div>
    </div>
  );
}
