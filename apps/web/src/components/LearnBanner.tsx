// Convite da home para quem ainda não conhece o jogo: começa (ou continua) o tutorial.
// Some com "Já sei jogar" ou quando o primeiro capítulo termina.

import { LESSONS } from '../game/tutorial/lessons';
import { useTutorialProgress } from '../game/tutorial/progress';
import { useT } from '../i18n';
import { Icon } from './Icons';

export function LearnBanner({ onLearn }: { onLearn: () => void }) {
  const t = useT();
  const { done, dismissed, dismiss } = useTutorialProgress();
  const firstChapter = LESSONS.filter((l) => l.chapter === 1);
  if (dismissed || firstChapter.every((l) => done.includes(l.id))) return null;
  return (
    <section className="learn-banner" aria-labelledby="learn-banner-title">
      <span className="learn-banner-ico" aria-hidden="true">
        <Icon name="learn" size={30} />
      </span>
      <div className="learn-banner-text">
        <span className="kicker">{t('menu.learnKicker')}</span>
        <h2 id="learn-banner-title">{t('menu.learnTitle')}</h2>
        <p>{t('menu.learnSub', { n: LESSONS.length })}</p>
      </div>
      <div className="learn-banner-actions">
        <button type="button" className="learn-cta" onClick={onLearn}>
          {done.length ? t('menu.learnContinue') : t('menu.learnStart')}
        </button>
        <button type="button" className="hero-link" onClick={dismiss}>
          {t('menu.learnDismiss')}
        </button>
      </div>
    </section>
  );
}
