// Painel "Treinador do bot" (Bot do Time): a cada jogada do bot, a linha (ou a resposta) escolhida, a nota, os
// termos da avaliação que mais pesaram e as alternativas consideradas. Cada entrada pode ser marcada ("ele
// deveria ter feito X"); as marcações vão junto com a nota no fim da partida (`BotRating`).

import { type Action, type GameState } from '@gumgum/engine';
import { useState } from 'react';
import type { CoachEntry, FeedbackMark } from '../api';
import { describeReplayAction } from '../game/replayCue';
import { hasKey, type MessageKey, useLocale, useT } from '../i18n';
import { fmtNumber } from '../i18n/format';

/** A jogada por números de carta (o mesmo formato do extrator no servidor), para a marcação. */
function choiceOf(state: GameState, a: Action): Record<string, unknown> {
  const id = (uid: string) => state.cards[uid]?.cardId ?? uid;
  switch (a.type) {
    case 'playCard':
    case 'activate':
      return { type: a.type, card: id(a.uid) };
    case 'attachDon':
    case 'detachDon':
      return { type: a.type, target: id(a.target) };
    case 'attack':
      return { type: a.type, card: id(a.attacker), target: id(a.target) };
    case 'counter':
      return { type: a.type, card: id(a.uid), ...(a.target ? { target: id(a.target) } : {}) };
    case 'choose':
      return { type: a.type, cards: a.uids.map(id).sort() };
    case 'answer':
      return { type: a.type, yes: a.yes };
    case 'option':
      return { type: a.type, index: a.index };
    case 'mulligan':
      return { type: a.type, redraw: a.redraw };
    default:
      return { type: a.type };
  }
}

const signed = (n: number, locale: Parameters<typeof fmtNumber>[1]) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNumber(Math.abs(n), locale)}`;

export function CoachPanel({
  state,
  entries,
  marks,
  onMark,
}: {
  state: GameState;
  entries: CoachEntry[];
  marks: FeedbackMark[];
  /** Guarda (ou tira, com null) a marcação da jogada `index`. */
  onMark: (index: number, mark: FeedbackMark | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  const title = (a: Action) => describeReplayAction(state, a, locale).title;
  const line = (actions: Action[]) => actions.map(title).join(' → ');
  const termLabel = (key: string) => (hasKey(`coach.term.${key}`) ? t(`coach.term.${key}` as MessageKey) : key);
  const sorted = [...entries].sort((a, b) => b.index - a.index);
  return (
    <div className="coach-panel">
      <p className="muted small coach-hint">{t('coach.hint')}</p>
      {!sorted.length && <p className="muted small">{t('coach.empty')}</p>}
      {sorted.map((e) => {
        const mark = marks.find((m) => m.index === e.index);
        return (
          <article key={e.index} className={['coach-entry', mark ? 'marked' : ''].join(' ')}>
            <header>
              <b>{e.kind === 'turn' ? t('coach.turnLine', { n: e.turn }) : t('coach.answer', { n: e.turn })}</b>
              <span className="muted small">{t('coach.score', { n: fmtNumber(e.score, locale) })}</span>
            </header>
            <p className="coach-line">{line(e.actions)}</p>
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
            {e.alternatives.length > 0 && (
              <div className="coach-alts">
                <span className="muted small">{t('coach.alternatives')}</span>
                <ul>
                  {e.alternatives.map((alt, i) => (
                    <li key={i}>
                      {line(alt.actions)} <span className="muted small">({fmtNumber(alt.score, locale)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="coach-actions">
              {mark && <span className="coach-marked">✓ {t('coach.marked')}</span>}
              <button type="button" className="btn small" onClick={() => setOpen(open === e.index ? null : e.index)}>
                {mark ? t('coach.editMark') : t('coach.mark')}
              </button>
              {mark && (
                <button type="button" className="btn small" onClick={() => onMark(e.index, null)}>
                  {t('coach.unmark')}
                </button>
              )}
            </div>
            {open === e.index && (
              <MarkForm
                entry={e}
                state={state}
                initial={mark}
                describe={line}
                onSave={(m) => {
                  onMark(e.index, m);
                  setOpen(null);
                }}
                onCancel={() => setOpen(null)}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

function MarkForm({
  entry,
  state,
  initial,
  describe,
  onSave,
  onCancel,
}: {
  entry: CoachEntry;
  state: GameState;
  initial?: FeedbackMark;
  describe: (actions: Action[]) => string;
  onSave: (m: FeedbackMark) => void;
  onCancel: () => void;
}) {
  const t = useT();
  /** Índice da alternativa escolhida, ou -1 para "outra". */
  const [pick, setPick] = useState<number>(initial && typeof initial.expected === 'string' ? -1 : 0);
  const [other, setOther] = useState(initial && typeof initial.expected === 'string' ? initial.expected : '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const alts = entry.alternatives;
  const save = () => {
    const expected = pick >= 0 && alts[pick] ? choiceOf(state, alts[pick].actions[0]) : other.trim() || undefined;
    onSave({ index: entry.index, ...(expected ? { expected } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
  };
  return (
    <div className="coach-form">
      <b className="small">{t('coach.expected')}</b>
      {alts.map((alt, i) => (
        <label key={i} className="small">
          <input type="radio" name={`mark-${entry.index}`} checked={pick === i} onChange={() => setPick(i)} />
          {describe(alt.actions)}
        </label>
      ))}
      <label className="small">
        <input type="radio" name={`mark-${entry.index}`} checked={pick === -1} onChange={() => setPick(-1)} />
        {t('coach.expectedOther')}
      </label>
      {pick === -1 && <input value={other} maxLength={500} placeholder={t('coach.expectedPlaceholder')} onChange={(e) => setOther(e.target.value)} />}
      <textarea value={comment} rows={2} maxLength={2000} placeholder={t('coach.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} />
      <div className="coach-form-row">
        <button type="button" className="btn small" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn small primary" disabled={pick === -1 && !other.trim() && !comment.trim()} onClick={save}>
          {t('coach.save')}
        </button>
      </div>
    </div>
  );
}
