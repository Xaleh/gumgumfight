import { useEffect, useState } from 'react';
import { api, type CoverageRow } from '../api';
import { useT } from '../i18n';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

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

/** Quanto da base de cartas já é automático e traduzido, por coleção. */
export function Coverage({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ total: CoverageRow; sets: CoverageRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .coverage()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const row = (r: CoverageRow, strong = false) => {
    const auto = r.scripted + r.auto + r.vanilla;
    return (
      <tr key={r.set} className={strong ? 'cov-total' : ''}>
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
      </tr>
    );
  };

  return (
    <div className="coverage">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('admin.coverage.menu')}
        </button>
        <h2>{t('admin.coverage.title')}</h2>
      </header>
      <div className="coverage-body">
        <p className="muted">
          <span className="legend cov-scripted" /> {t('admin.coverage.legendScripted')} <span className="legend cov-vanilla" /> {t('admin.coverage.legendVanilla')}{' '}
          <span className="legend cov-partial" /> {t('admin.coverage.legendPartial')} <span className="legend cov-manual" /> {t('admin.coverage.legendManual')}{' '}
          {t('admin.coverage.legendAuto')}
        </p>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="muted">{t('common.loading')}</div>}
        {data && (
          <table className="cov-table">
            <thead>
              <tr>
                <th>{t('admin.coverage.colSet')}</th>
                <th>{t('admin.coverage.colCards')}</th>
                <th>{t('admin.coverage.colAutomation')}</th>
                <th>{t('admin.coverage.colAuto')}</th>
                <th>{t('admin.coverage.colPt')}</th>
              </tr>
            </thead>
            <tbody>
              {row(data.total, true)}
              {data.sets.map((r) => row(r))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
