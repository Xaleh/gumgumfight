// Painel "Treinador do bot" (Bot do Time): a cada jogada do bot, a linha (ou a resposta) escolhida, a nota, os
// termos da avaliação que mais pesaram e as alternativas consideradas. Cada passo da linha é um botão: um toque marca
// o passo como errado e ele entra no relatório da partida (o texto no alto do painel), que vai no fim da partida para
// a tela "Bot do Time" e para o pacote do Claude. "O certo era" (uma das alternativas) e "por quê" são opcionais.

import { type Action, type GameState } from '@gumgum/engine';
import { useState } from 'react';
import type { CoachEntry } from '../api';
import { type CoachMark, distinctAlternatives, sameMark } from '../game/botReport';
import { describeReplayAction } from '../game/replayCue';
import { hasKey, type MessageKey, useLocale, useT } from '../i18n';
import { fmtNumber } from '../i18n/format';

const signed = (n: number, locale: Parameters<typeof fmtNumber>[1]) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNumber(Math.abs(n), locale)}`;

/** Copia o texto e diz se deu certo (o navegador pode negar a área de transferência). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CoachPanel({
  state,
  entries,
  marks,
  report,
  onToggle,
  onUpdate,
}: {
  state: GameState;
  entries: CoachEntry[];
  marks: CoachMark[];
  /** O relatório da partida até aqui (markdown), para a prévia e o botão de copiar. */
  report: string;
  /** Marca (ou desmarca) o passo `step` da decisão `index` como errado. */
  onToggle: (index: number, step: number) => void;
  /** Muda o "o certo era" ou o "por quê" de um passo marcado. */
  onUpdate: (index: number, step: number, patch: Partial<Pick<CoachMark, 'alt' | 'why'>>) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const title = (a: Action) => describeReplayAction(state, a, locale).title;
  const line = (actions: Action[]) => actions.map(title).join(' → ');
  const termLabel = (key: string) => (hasKey(`coach.term.${key}`) ? t(`coach.term.${key}` as MessageKey) : key);
  const sorted = [...entries].sort((a, b) => b.index - a.index);
  const copy = async () => {
    if (await copyText(report)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="coach-panel">
      <p className="muted small coach-hint">{t('coach.hint')}</p>
      {marks.length > 0 && (
        <details className="coach-report">
          <summary>{t('coach.report', { n: marks.length })}</summary>
          <pre>{report}</pre>
          <button type="button" className="btn small" onClick={copy}>
            {copied ? t('coach.copied') : t('coach.copy')}
          </button>
        </details>
      )}
      {!sorted.length && <p className="muted small">{t('coach.empty')}</p>}
      {sorted.map((e) => {
        const mine = marks.filter((m) => m.index === e.index);
        const alts = distinctAlternatives(e, title);
        return (
          <article key={e.index} className={['coach-entry', mine.length ? 'marked' : ''].join(' ')}>
            <header>
              <b>{e.kind === 'turn' ? t('coach.turnLine', { n: e.turn }) : t('coach.answer', { n: e.turn })}</b>
              <span className="muted small">{t('coach.score', { n: fmtNumber(e.score, locale) })}</span>
            </header>
            <div className="coach-steps" role="group" aria-label={t('coach.stepsLabel')}>
              {e.actions.map((a, step) => {
                const wrong = mine.some((m) => sameMark(m, { index: e.index, step }));
                return (
                  <button
                    key={step}
                    type="button"
                    className={['coach-step', wrong ? 'wrong' : ''].join(' ')}
                    aria-pressed={wrong}
                    title={wrong ? t('coach.unmarkStep') : t('coach.markStep')}
                    onClick={() => onToggle(e.index, step)}
                  >
                    {wrong && <span aria-hidden="true">✗ </span>}
                    {title(a)}
                  </button>
                );
              })}
            </div>
            {mine
              .sort((a, b) => a.step - b.step)
              .map((m) => (
                <div key={m.step} className="coach-mark">
                  <span className="small">
                    <b>✗ {title(e.actions[m.step] ?? e.actions[0])}</b>
                  </span>
                  {alts.length > 0 && (
                    <div className="coach-alts-pick">
                      <span className="muted small">{t('coach.rightWas')}</span>
                      {alts.map((alt) => (
                        <button
                          key={alt.i}
                          type="button"
                          className={['coach-alt', m.alt === alt.i ? 'on' : ''].join(' ')}
                          aria-pressed={m.alt === alt.i}
                          onClick={() => onUpdate(e.index, m.step, { alt: m.alt === alt.i ? undefined : alt.i })}
                        >
                          {alt.text}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className="coach-why"
                    value={m.why ?? ''}
                    maxLength={500}
                    placeholder={t('coach.why')}
                    onChange={(ev) => onUpdate(e.index, m.step, { why: ev.target.value })}
                  />
                </div>
              ))}
            {e.terms.length > 0 && (
              <div className="coach-terms">
                <span className="muted small">{t('coach.terms')}</span>
                {e.terms.map((term) => (
                  <span key={term.key} className={['coach-term', term.delta >= 0 ? 'up' : 'down'].join(' ')}>
                    {termLabel(term.key)} {signed(term.delta, locale)}
                  </span>
                ))}
              </div>
            )}
            {alts.length > 0 && !mine.length && (
              <div className="coach-alts">
                <span className="muted small">{t('coach.alternatives')}</span>
                <ul>
                  {alts.map((alt) => (
                    <li key={alt.i}>
                      {alt.text} <span className="muted small">({fmtNumber(alt.score, locale)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
