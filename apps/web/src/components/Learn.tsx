// "Aprender a jogar": a Rota do Aprendiz (capítulos e lições), o progresso e o glossário.

import { useEffect, useState } from 'react';
import { CHAPTERS, GLOSSARY, LESSONS, lessonNumber } from '../game/tutorial/lessons';
import { useTutorialProgress } from '../game/tutorial/progress';
import { useT } from '../i18n';
import { useLessonText } from './Coach';
import { Icon } from './Icons';

const CHAPTER_COLOR: Record<number, string> = { 1: 'red', 2: 'green', 3: 'blue-card', 4: 'purple' };

export function Learn({ onExit, onLesson }: { onExit: () => void; onLesson: (id: string) => void }) {
  const t = useT();
  const lt = useLessonText();
  const { done, next, reset } = useTutorialProgress();
  const [term, setTerm] = useState<string | null>(null);
  // Chaves: em navegadores novos scrollTo devolve uma Promise, que o React tentaria chamar como limpeza.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const totalMin = LESSONS.reduce((n, l) => n + l.minutes, 0);
  const leftMin = LESSONS.filter((l) => !done.includes(l.id)).reduce((n, l) => n + l.minutes, 0);
  const chaptersDone = CHAPTERS.filter((c) => LESSONS.filter((l) => l.chapter === c).every((l) => done.includes(l.id))).length;
  const pct = Math.round((done.length / LESSONS.length) * 100);
  const battle = LESSONS[LESSONS.length - 1];
  const picked = GLOSSARY.find((g) => g.id === term);

  return (
    <div className="learn">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('common.back')}
        </button>
        <h2>{t('tutorial.title')}</h2>
      </header>

      <section className="learn-hero">
        <div className="learn-wrap learn-hero-inner">
          <div className="learn-hero-text">
            <div className="hero-kicker">{t('tutorial.heroKicker')}</div>
            <h1 className="hero-title">{t('tutorial.heroTitle')}</h1>
            <p className="hero-sub">{t('tutorial.heroSub', { n: LESSONS.length, min: totalMin })}</p>
            <div className="hero-links">
              {next ? (
                <button type="button" className="learn-cta" onClick={() => onLesson(next.id)}>
                  <Icon name="play" size={18} />
                  {done.length === 0 ? t('tutorial.start') : t('tutorial.continue', { n: lessonNumber(next.id) })}
                </button>
              ) : (
                <span className="learn-all-done">{t('tutorial.allDone')}</span>
              )}
              {done.length === 0 && (
                <button type="button" className="hero-link" onClick={() => onLesson(battle.id)}>
                  {t('tutorial.skipToBattle')}
                </button>
              )}
            </div>
          </div>
          <div className="learn-progress" role="group" aria-label={t('tutorial.progress')}>
            <div className="learn-progress-head">
              <span>{t('tutorial.progress')}</span>
              <span>{t('tutorial.lessonsDone', { n: done.length, total: LESSONS.length })}</span>
            </div>
            <div className="learn-bar" role="progressbar" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={done.length}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="learn-stats">
              <div>
                <b>
                  {chaptersDone}/{CHAPTERS.length}
                </b>
                <small>{t('tutorial.chapters')}</small>
              </div>
              <div>
                <b>~{leftMin}</b>
                <small>{t('tutorial.minLeft')}</small>
              </div>
              <div>
                <b>{chaptersDone}</b>
                <small>{t('tutorial.badges', { n: chaptersDone })}</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="learn-wrap learn-main">
        <div className="section-head">
          <h2 className="home-h2">{t('tutorial.route')}</h2>
          <span className="muted">{t('tutorial.routeHint')}</span>
        </div>
        <div className="learn-grid">
          {CHAPTERS.map((c) => {
            const lessons = LESSONS.filter((l) => l.chapter === c);
            const n = lessons.filter((l) => done.includes(l.id)).length;
            const complete = n === lessons.length;
            return (
              <section key={c} className="chapter-card" style={{ ['--mode' as string]: `var(--${CHAPTER_COLOR[c]})` }} aria-labelledby={`chapter-${c}`}>
                <div className="chapter-top">
                  <span className="mode-kicker">{lt(`tutorial.ch${c}.kicker`)}</span>
                  <span className={['chapter-count', complete ? 'complete' : ''].join(' ')}>
                    {complete && <Icon name="trophy" size={14} />}
                    {n}/{lessons.length}
                  </span>
                </div>
                <h3 className="mode-title" id={`chapter-${c}`}>
                  {lt(`tutorial.ch${c}.name`)}
                </h3>
                <p className="mode-desc">{lt(`tutorial.ch${c}.desc`)}</p>
                <ol className="lesson-list">
                  {lessons.map((l) => {
                    const isDone = done.includes(l.id);
                    const isNext = next?.id === l.id;
                    return (
                      <li key={l.id}>
                        <button type="button" className={['lesson-item', isDone ? 'done' : '', isNext ? 'next' : ''].join(' ')} onClick={() => onLesson(l.id)}>
                          <span className="lesson-mark" aria-hidden="true">
                            {isDone ? <Icon name="check" size={16} stroke={3} /> : isNext ? <Icon name="play" size={14} /> : lessonNumber(l.id)}
                          </span>
                          <span className="lesson-text">
                            <strong>{lt(`tutorial.${l.id}.name`)}</strong>
                            <small>
                              {t('tutorial.minutes', { n: l.minutes })} · {lt(`tutorial.format.${l.format}`)}
                              {isDone ? ` · ${t('tutorial.doneShort')}` : ''}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {complete && (
                  <p className="chapter-badge">
                    <Icon name="trophy" size={16} />
                    {t('tutorial.badgeEarned', { name: lt(`tutorial.ch${c}.name`) })}
                  </p>
                )}
              </section>
            );
          })}
        </div>

        <section className="menu-card glossary" aria-labelledby="glossary-title">
          <div className="section-head">
            <h2 className="home-h2" id="glossary-title">
              {t('tutorial.glossary')}
            </h2>
            <span className="muted">{t('tutorial.glossaryHint')}</span>
          </div>
          <ul className="glossary-terms">
            {GLOSSARY.map((g) => (
              <li key={g.id}>
                <button type="button" className={['term-chip', term === g.id ? 'on' : ''].join(' ')} aria-pressed={term === g.id} onClick={() => setTerm(term === g.id ? null : g.id)}>
                  {g.label}
                </button>
              </li>
            ))}
          </ul>
          {picked && (
            <div className="glossary-def" aria-live="polite">
              <strong>{picked.label}</strong>
              <p>{lt(`tutorial.term.${picked.id}`)}</p>
              <button type="button" className="text-link" onClick={() => onLesson(picked.lesson)}>
                {t('tutorial.seeLesson', { n: lessonNumber(picked.lesson), name: lt(`tutorial.${picked.lesson}.name`) })}
              </button>
            </div>
          )}
        </section>

        {done.length > 0 && (
          <p className="learn-reset">
            <button
              type="button"
              className="text-link"
              onClick={() => {
                if (window.confirm(t('tutorial.resetConfirm'))) reset();
              }}
            >
              {t('tutorial.reset')}
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
