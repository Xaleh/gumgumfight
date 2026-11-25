// Administração → Monitoramento (A2): erros do servidor e do navegador (agrupados), os canais SSE das partidas e o
// processo no ar. Os botões de teste forçam um erro em cada lado para conferir a captura.

import { useCallback, useEffect, useState } from 'react';
import { api, type MonitorError, type MonitorPanel as Panel } from '../api';
import { useT } from '../i18n';
import { forceBrowserError } from '../monitor';
import { poll } from '../poll';

const REFRESH_MS = 15_000;

/** "3 h 20 min", "5 min", "40 s". */
function duration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${seconds} s`;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

export function MonitorPanel() {
  const t = useT();
  const [data, setData] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.admin.monitor
        .get(resolved)
        .then((d) => (setData(d), setError(null)))
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [resolved],
  );

  useEffect(() => poll(load, REFRESH_MS), [load]);

  const serverTest = async () => {
    // A resposta é um 500 de propósito: o erro fica gravado no servidor.
    await api.admin.monitor.testError().catch(() => undefined);
    setNote(t('monitor.testServerDone'));
    await load();
  };
  const browserTest = () => {
    forceBrowserError();
    setNote(t('monitor.testBrowserDone'));
    setTimeout(() => void load(), 1500);
  };
  const resolve = async (e: MonitorError) => {
    await api.admin.monitor.resolve(e.id).catch(() => undefined);
    await load();
  };
  const clear = async () => {
    await api.admin.monitor.clear();
    await load();
  };

  const sse = data?.sse;
  const last24 = sse?.hours.slice(-24) ?? [];
  const sum = (k: 'opened' | 'clientClosed' | 'reconnects') => last24.reduce((a, h) => a + h[k], 0);
  const maxOpened = Math.max(1, ...last24.map((h) => h.opened));

  return (
    <section className="monitor">
      <p className="muted small">{t('monitor.hint')}</p>
      <div className="btn-row">
        <button className="btn small" onClick={() => void serverTest()}>
          {t('monitor.testServer')}
        </button>
        <button className="btn small" onClick={browserTest}>
          {t('monitor.testBrowser')}
        </button>
        <button className="btn small" onClick={() => void load()}>
          {t('monitor.refresh')}
        </button>
      </div>
      {note && <p className="muted small">{note}</p>}
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">{t('common.loading')}</p>}
      {data && sse && (
        <>
          <div className="monitor-cards">
            <div className="monitor-card">
              <span className="muted small">{t('monitor.uptime')}</span>
              <b>{duration(data.uptimeSeconds)}</b>
              <span className="muted small">
                {t('monitor.release', { release: data.release })} · {t('monitor.memory', { rss: data.memory.rssMb, heap: data.memory.heapMb })}
              </span>
            </div>
            <div className="monitor-card">
              <span className="muted small">{t('monitor.sseOpen')}</span>
              <b>{sse.open.total}</b>
              <span className="muted small">{t('monitor.sseOpenSplit', { online: sse.open.online, yonko: sse.open.yonko })}</span>
            </div>
            <div className="monitor-card">
              <span className="muted small">{t('monitor.sse24h')}</span>
              <b>{t('monitor.sseOpened', { n: sum('opened') })}</b>
              <span className="muted small">{t('monitor.sseDropsReconnects', { drops: sum('clientClosed'), reconnects: sum('reconnects') })}</span>
            </div>
            <div className="monitor-card">
              <span className="muted small">{t('monitor.errorsOpen')}</span>
              <b className={data.errors.counts.open ? 'monitor-bad' : ''}>{data.errors.counts.open}</b>
              <span className="muted small">{t('monitor.errors24h', { n: data.errors.counts.last24h })}</span>
            </div>
          </div>

          <h3>{t('monitor.sseTitle')}</h3>
          <p className="muted small">
            {t('monitor.sseSinceStart', {
              opened: sse.sinceStart.online.opened + sse.sinceStart.yonko.opened,
              drops: sse.sinceStart.online.clientClosed + sse.sinceStart.yonko.clientClosed,
              ended: sse.sinceStart.online.serverClosed + sse.sinceStart.yonko.serverClosed,
              reconnects: sse.sinceStart.online.reconnects + sse.sinceStart.yonko.reconnects,
              avg: duration(sse.sinceStart.online.avgSeconds),
            })}
          </p>
          {last24.length === 0 ? (
            <p className="muted small">{t('monitor.sseEmpty')}</p>
          ) : (
            <div className="monitor-hours" role="table" aria-label={t('monitor.sseTitle')}>
              <div className="monitor-hour head" role="row">
                <span role="columnheader">{t('monitor.hour')}</span>
                <span role="columnheader">{t('monitor.opened')}</span>
                <span role="columnheader">{t('monitor.drops')}</span>
                <span role="columnheader">{t('monitor.reconnects')}</span>
                <span role="columnheader">{t('monitor.peak')}</span>
              </div>
              {[...last24].reverse().map((h) => (
                <div key={h.hour} className="monitor-hour" role="row">
                  <span role="cell">{new Date(`${h.hour}:00:00Z`).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span role="cell" data-label={t('monitor.opened')}>
                    <i className="monitor-bar" style={{ width: `${Math.round((h.opened / maxOpened) * 100)}%` }} aria-hidden="true" />
                    {h.opened}
                  </span>
                  <span role="cell" data-label={t('monitor.drops')}>
                    {h.clientClosed}
                  </span>
                  <span role="cell" data-label={t('monitor.reconnects')}>
                    {h.reconnects}
                  </span>
                  <span role="cell" data-label={t('monitor.peak')}>
                    {h.peak}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h3>{t('monitor.errorsTitle')}</h3>
          <div className="btn-row">
            <label className="muted small">
              <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} /> {t('monitor.showResolved')}
            </label>
            {data.errors.counts.resolved > 0 && (
              <button className="btn small" onClick={() => void clear()}>
                {t('monitor.clearResolved', { n: data.errors.counts.resolved })}
              </button>
            )}
          </div>
          {data.errors.list.length === 0 && <p className="muted small">{t('monitor.noErrors')}</p>}
          <ul className="monitor-errors">
            {data.errors.list.map((e) => (
              <li key={e.id} className={e.resolvedAt ? 'resolved' : ''}>
                <button type="button" className="monitor-error-head" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <span className={`monitor-tag ${e.source}`}>{t(e.source === 'server' ? 'monitor.sourceServer' : 'monitor.sourceWeb')}</span>
                  {e.kind === 'test' && <span className="monitor-tag test">{t('monitor.kindTest')}</span>}
                  <b className="monitor-error-msg">{e.message}</b>
                  <span className="muted small">
                    {t('monitor.occurrences', { n: e.count })} · {when(e.lastSeen)}
                  </span>
                </button>
                {open === e.id && (
                  <div className="monitor-error-body small">
                    <p className="muted">
                      {[e.url, e.status ? `HTTP ${e.status}` : null, e.kind, e.release].filter(Boolean).join(' · ')}
                      <br />
                      {t('monitor.firstSeen', { when: when(e.firstSeen) })}
                      {e.userAgent && (
                        <>
                          <br />
                          {e.userAgent}
                        </>
                      )}
                    </p>
                    {e.stack && <pre className="monitor-stack">{e.stack}</pre>}
                    {!e.resolvedAt && (
                      <button className="btn small" onClick={() => void resolve(e)}>
                        {t('monitor.resolve')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
