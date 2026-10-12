// Administração: funil anônimo das lições do tutorial (onde as pessoas começam, saem, falham e concluem).

import { useEffect, useState } from 'react';
import { api, type TutorialFunnel } from '../api';
import { LESSONS, lessonNumber } from '../game/tutorial/lessons';
import { useT } from '../i18n';
import { useLessonText } from './Coach';

const PERIODS = [7, 30, 90] as const;

export function TutorialFunnelPanel() {
  const t = useT();
  const lt = useLessonText();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<TutorialFunnel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    setData(null);
    api.admin
      .tutorial(days)
      .then((r) => !stop && (setData(r.lessons), setError(null)))
      .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stop = true;
    };
  }, [days]);

  // Na ordem da Rota do Aprendiz; lições que não existem mais (ids antigos) vão para o fim.
  const byId = new Map((data ?? []).map((f) => [f.lesson, f]));
  const rows = [
    ...LESSONS.map((l) => byId.get(l.id) ?? { lesson: l.id, starts: 0, completes: 0, exits: 0, fails: 0, steps: [] }),
    ...(data ?? []).filter((f) => !LESSONS.some((l) => l.id === f.lesson)),
  ];
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <section className="tutorial-funnel">
      <p className="muted small">{t('tutorial.admin.hint')}</p>
      <div className="seg small" role="group" aria-label={t('tutorial.admin.period')}>
        {PERIODS.map((d) => (
          <button key={d} className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
            {t('tutorial.admin.days', { n: d })}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {data === null && !error && <p className="muted">{t('common.loading')}</p>}
      {data && (
        <div className="funnel-table" role="table" aria-label={t('tutorial.admin.title')}>
          <div className="funnel-row head" role="row">
            <span role="columnheader">{t('tutorial.admin.lesson')}</span>
            <span role="columnheader">{t('tutorial.admin.starts')}</span>
            <span role="columnheader">{t('tutorial.admin.completes')}</span>
            <span role="columnheader">{t('tutorial.admin.exits')}</span>
            <span role="columnheader">{t('tutorial.admin.fails')}</span>
          </div>
          {rows.map((f) => {
            const known = LESSONS.some((l) => l.id === f.lesson);
            const worst = [...f.steps].sort((a, b) => b.exits - a.exits)[0];
            return (
              <div key={f.lesson} className="funnel-group" role="rowgroup">
                <button type="button" className="funnel-row" role="row" aria-expanded={open === f.lesson} onClick={() => setOpen(open === f.lesson ? null : f.lesson)}>
                  <span role="cell">
                    <b>{known ? `${lessonNumber(f.lesson)}. ${lt(`tutorial.${f.lesson}.name`)}` : f.lesson}</b>
                    {worst && worst.exits > 0 && <small className="muted"> · {t('tutorial.admin.worstStep', { step: worst.step, n: worst.exits })}</small>}
                  </span>
                  <span role="cell" data-label={t('tutorial.admin.starts')}>
                    {f.starts}
                  </span>
                  <span role="cell" data-label={t('tutorial.admin.completes')}>
                    {f.completes} <small className="muted">({pct(f.completes, f.starts)})</small>
                  </span>
                  <span role="cell" data-label={t('tutorial.admin.exits')}>
                    {f.exits}
                  </span>
                  <span role="cell" data-label={t('tutorial.admin.fails')}>
                    {f.fails}
                  </span>
                </button>
                {open === f.lesson && (
                  <ol className="funnel-steps">
                    {(known ? LESSONS.find((l) => l.id === f.lesson)!.steps.map((s) => s.id) : f.steps.map((s) => s.step)).map((id) => {
                      const s = f.steps.find((x) => x.step === id) ?? { step: id, reached: 0, exits: 0, fails: 0 };
                      return (
                        <li key={id}>
                          <span>{known ? lt(`tutorial.${f.lesson}.${id}.title`) : id}</span>
                          <span className="muted small">{t('tutorial.admin.stepLine', { reached: s.reached, exits: s.exits, fails: s.fails })}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
