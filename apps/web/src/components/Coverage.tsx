import { useEffect, useState } from 'react';
import { api, type CoverageRow } from '../api';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function Bar({ parts }: { parts: Array<{ n: number; cls: string; title: string }> }) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  return (
    <div className="cov-bar">
      {parts.map((p) => (
        <span key={p.cls} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.title}: ${p.n}`} />
      ))}
    </div>
  );
}

/** Quanto da base de cartas já é automático e traduzido, por coleção. */
export function Coverage({ onExit }: { onExit: () => void }) {
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
              { n: r.scripted + r.auto, cls: 'cov-scripted', title: 'Efeito automatizado' },
              { n: r.vanilla, cls: 'cov-vanilla', title: 'Sem efeito' },
              { n: r.partial, cls: 'cov-partial', title: 'Parcial (parte automática, parte manual)' },
              { n: r.manual, cls: 'cov-manual', title: 'Manual' },
            ]}
          />
        </td>
        <td>
          <b>{pct(auto, r.total)}%</b>{' '}
          <span className="muted small">
            ({r.partial} parciais, {r.manual} manuais)
          </span>
        </td>
        <td>
          <b>{pct(r.ptComplete, r.total)}%</b>
        </td>
      </tr>
    );
  };

  return (
    <div className="coverage">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          ← Menu
        </button>
        <h2>Cobertura das cartas</h2>
      </header>
      <div className="coverage-body">
        <p className="muted">
          <span className="legend cov-scripted" /> efeito automatizado <span className="legend cov-vanilla" /> sem efeito
          (nada a automatizar) <span className="legend cov-partial" /> parcial (parte dos efeitos é automática){' '}
          <span className="legend cov-manual" /> manual (o jogador aplica o efeito com as ferramentas manuais).
          "Automático" = automatizadas + sem efeito.
        </p>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="muted">Carregando…</div>}
        {data && (
          <table className="cov-table">
            <thead>
              <tr>
                <th>Coleção</th>
                <th>Cartas</th>
                <th>Automação</th>
                <th>Automático</th>
                <th>Tradução PT completa</th>
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
