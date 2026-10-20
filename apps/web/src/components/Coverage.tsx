import { type FormEvent, Fragment, useEffect, useState } from 'react';
import { api, type CoverageRow, type EngineReading, type EngineTextItem, type GapCard, type GapPattern, type GapStage, type GapSummary } from '../api';
import { useLocale, useT } from '../i18n';
import { EngineTextEditor } from './EngineTextEditor';
import { Lines, stageKey, StatusChip } from './GapLines';

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

/** As cartas ⚙ de uma coleção, de uma frase ou as novas, carregadas quando a lista abre. */
function GapList({
  query,
  onReviewed,
  onEngineText,
}: {
  query: Parameters<typeof api.cardGapCards>[0];
  onReviewed?: (cards: Array<Pick<GapCard, 'set'>>) => void;
  /** Um texto para o motor foi gravado ou apagado (as contagens do resumo mudam); avisado ao fechar o editor. */
  onEngineText?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  // A situação pode mudar aqui mesmo (texto para o motor gravado): vira 'auto' sem sair da lista.
  const [cards, setCards] = useState<Array<Omit<GapCard, 'status'> & { status: EngineReading['status'] }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Atualizar o resumo com o editor aberto poderia tirar a carta da tela (a frase ou a coleção some).
  const [changed, setChanged] = useState(false);
  const edit = (id: string | null) => {
    setEditing(id);
    if (changed) {
      setChanged(false);
      onEngineText?.();
    }
  };
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
            <StatusChip status={c.status} />
            {c.engineText && <span className="gap-chip">{t('admin.engineText.badge')}</span>}
            {c.provisional && <span className="gap-chip">{t('admin.coverage.badgeSpoiler')}</span>}
            {c.isNew && <span className="gap-chip gap-new">{t('admin.coverage.badgeNew')}</span>}
            {c.firstSeen && <span className="muted small">{t('admin.coverage.firstSeen', { date: date(c.firstSeen) })}</span>}
            <span className="gap-seen">
              {c.isNew && (
                <button className="btn small" onClick={() => review([c.id])}>
                  {t('admin.coverage.markOne')}
                </button>
              )}{' '}
              <button className="btn small" aria-expanded={editing === c.id} onClick={() => edit(editing === c.id ? null : c.id)}>
                {t('admin.engineText.open')}
              </button>
            </span>
          </header>
          {editing === c.id ? (
            <EngineTextEditor
              cardId={c.id}
              onClose={() => edit(null)}
              onChange={(d) => {
                setCards((cs) =>
                  (cs ?? []).map((x) =>
                    x.id === c.id ? { ...x, status: d.current.status, lines: d.current.lines, engineText: Boolean(d.engineText && !d.stale) } : x,
                  ),
                );
                setChanged(true);
              }}
            />
          ) : (
            <Lines lines={c.lines} />
          )}
        </article>
      ))}
    </div>
  );
}

function Patterns({ gaps, onEngineText }: { gaps: GapSummary; onEngineText: () => void }) {
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
                        <GapList query={{ ids: p.cards }} onEngineText={onEngineText} />
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

/** Os textos para o motor gravados e o atalho para escrever o de qualquer carta. */
function EngineTexts({ onCount, onEngineText }: { onCount: (n: number) => void; onEngineText: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<EngineTextItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [id, setId] = useState('');

  const reload = () =>
    api
      .engineTexts()
      .then((r) => {
        setItems(r.texts);
        onCount(r.texts.length);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (e: FormEvent) => {
    e.preventDefault();
    const v = id.trim().toUpperCase();
    if (v) setEditing(v);
  };
  return (
    <>
      <p className="muted">{t('admin.engineText.tabIntro')}</p>
      <form className="et-open" onSubmit={open}>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder={t('admin.engineText.idPlaceholder')} aria-label={t('admin.engineText.idPlaceholder')} />
        <button className="btn small" type="submit">
          {t('admin.engineText.open')}
        </button>
      </form>
      {editing && !items?.some((i) => i.cardId === editing) && (
        <EngineTextEditor cardId={editing} onClose={() => setEditing(null)} onChange={() => (void reload(), onEngineText())} />
      )}
      {error && <div className="error">{error}</div>}
      {!items && !error && <div className="muted">{t('common.loading')}</div>}
      {items && !items.length && <div className="muted">{t('admin.engineText.none')}</div>}
      {items && items.length > 0 && (
        <div className="table-scroll">
          <table className="cov-table et-table">
            <thead>
              <tr>
                <th>{t('admin.coverage.colSet')}</th>
                <th>{t('admin.engineText.colCard')}</th>
                <th>{t('admin.engineText.colStatus')}</th>
                <th>{t('admin.engineText.colBy')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Fragment key={i.cardId}>
                  <tr className="cov-click" onClick={() => setEditing(editing === i.cardId ? null : i.cardId)} aria-expanded={editing === i.cardId}>
                    <td>{i.set ?? '—'}</td>
                    <td>
                      <b>{i.cardId}</b> {i.name}
                    </td>
                    <td>
                      {i.missing ? (
                        <span className="gap-chip">{t('admin.engineText.missing')}</span>
                      ) : (
                        <>
                          {i.officialStatus && <StatusChip status={i.officialStatus} />} → {i.status && <StatusChip status={i.status} />}
                          {i.stale && <span className="gap-chip gap-new">{t('admin.engineText.staleChip')}</span>}
                        </>
                      )}
                    </td>
                    <td className="small">
                      {i.authorName ?? '?'} · {new Date(i.updatedAt).toLocaleDateString(locale)}
                    </td>
                  </tr>
                  {editing === i.cardId && !i.missing && (
                    <tr className="cov-detail">
                      <td colSpan={4}>
                        <EngineTextEditor cardId={i.cardId} onClose={() => setEditing(null)} onChange={() => (void reload(), onEngineText())} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type Tab = 'sets' | 'patterns' | 'new' | 'texts';

/** Quanto da base de cartas já é automático e traduzido, por coleção; e, nas cartas ⚙, onde o leitor parou. */
export function Coverage({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ total: CoverageRow; sets: CoverageRow[] } | null>(null);
  const [gaps, setGaps] = useState<GapSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [textCount, setTextCount] = useState<number | null>(null);

  const loadCoverage = () =>
    api
      .coverage()
      .then(setData)
      .catch((e) => setError(errorText(e)));
  const loadGaps = () =>
    api
      .cardGaps()
      .then((g) => {
        setGaps(g);
        setTab((cur) => cur ?? (g.newCount ? 'new' : 'sets'));
      })
      .catch((e) => setGapError(errorText(e)));
  // Texto para o motor gravado ou apagado: a carta muda de situação nas contagens.
  const refresh = () => {
    void loadCoverage();
    void loadGaps();
  };
  useEffect(refresh, []);

  const current = tab ?? 'sets';
  const newBySet = new Map((gaps?.sets ?? []).map((s) => [s.set, s.new]));
  const reviewed = (seen: Array<Pick<GapCard, 'set'>>) =>
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
              <GapList query={{ set: r.set }} onReviewed={reviewed} onEngineText={refresh} />
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
    ['texts', textCount === null ? t('admin.engineText.tab') : t('admin.engineText.tabCount', { n: textCount })],
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
            <button key={k} role="tab" aria-selected={current === k} className={current === k ? 'on' : ''}
              // Trocar de aba recarrega as contagens (um texto para o motor pode ter mudado alguma).
              onClick={() => {
                setTab(k);
                if (k !== current) refresh();
              }}
            >
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

        {current === 'patterns' && (gaps ? <Patterns gaps={gaps} onEngineText={refresh} /> : !gapError && <div className="muted">{t('common.loading')}</div>)}

        {current === 'texts' && <EngineTexts onCount={setTextCount} onEngineText={refresh} />}

        {current === 'new' && (
          <>
            <p className="muted">{t('admin.coverage.newIntro')}</p>
            {gaps && <GapList query={{ new: true }} onReviewed={reviewed} onEngineText={refresh} />}
          </>
        )}
      </div>
    </div>
  );
}
