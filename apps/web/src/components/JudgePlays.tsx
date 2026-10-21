// "Jogadas e escolhas": a lista do Judge e do organizador com tudo o que cada jogador fez na partida,
// a pergunta que estava aberta (o efeito, as opções que havia e as cartas vistas), o que ele escolheu
// e as linhas do log que a jogada gerou. Serve para conferir se o problema foi do app ou do jogador
// e, no modo manual, para escolher até onde voltar a partida.

import type { Action } from '@gumgum/engine';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JudgePlay, JudgePlays } from '../api';
import { logText } from '../game/engineText';
import { askText, citedName, describePlay, offered, playText } from '../game/judgePlays';
import { useLocale, useT, useTryT } from '../i18n';

/** Jogadas mostradas de cada vez (as mais recentes primeiro). */
const PAGE = 120;

/** Desfazer no modo manual: o motivo (o mesmo do painel) e o botão em cada jogada. */
export interface PlaysUndo {
  busy: boolean;
  note: string;
  setNote: (note: string) => void;
  missing: boolean;
  onUndo: (count: number) => void;
}

/** Cartas que a ação marcou entre as oferecidas (os alvos escolhidos, o bloqueador, o Counter). */
function chosen(a: Action): string[] {
  if (a.type === 'choose') return a.uids;
  if (a.type === 'counter') return [a.uid];
  return [];
}

export function PlaysSheet({
  data,
  error,
  message,
  onClose,
  undo,
}: {
  data: JudgePlays | null;
  error?: string | null;
  /** Aviso do painel depois de agir (jogadas desfeitas, erro do servidor). */
  message?: { ok: boolean; text: string } | null;
  onClose: () => void;
  undo?: PlaysUndo;
}) {
  const t = useT();
  const tryT = useTryT();
  const locale = useLocale();
  const [filter, setFilter] = useState('');
  const [choicesOnly, setChoicesOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(
    () => (data ? data.plays.map((play) => ({ play, cue: describePlay(data, play, locale) })).reverse() : []),
    [data, locale],
  );
  const q = filter.trim().toLowerCase();
  const list = rows.filter(({ play, cue }) => (!choicesOnly || play.pending !== null) && (!q || playText(tryT, data!, play, cue).includes(q)));
  const visible = list.slice(0, shown);
  // Fora do painel do Judge (que fica por cima da mesa): a folha cobre a tela toda.
  return createPortal(
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet plays-sheet" role="dialog" aria-modal="true" aria-label={t('judge.playsTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>📜 {t('judge.playsTitle')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="muted small">{t('judge.playsHint')}</p>
          {undo && (
            <div className="plays-undo">
              <p className="small">{t('judge.playsUndoHint')}</p>
              <textarea
                className={['admin-search', undo.missing ? 'invalid' : ''].join(' ')}
                rows={2}
                maxLength={300}
                placeholder={t('judge.manualNote')}
                value={undo.note}
                onChange={(e) => undo.setNote(e.target.value)}
              />
              {undo.missing && <div className="error small">{t('judge.manualNoteMissing')}</div>}
            </div>
          )}
          {message && <div className={message.ok ? 'judge-done small' : 'error small'}>{message.text}</div>}
          <div className="plays-tools">
            <input className="admin-search" placeholder={t('judge.playsFilter')} value={filter} onChange={(e) => (setFilter(e.target.value), setShown(PAGE))} />
            <label className="small">
              <input type="checkbox" checked={choicesOnly} onChange={(e) => (setChoicesOnly(e.target.checked), setShown(PAGE))} /> {t('judge.playsOnlyChoices')}
            </label>
          </div>
          {error && <div className="error small">{error}</div>}
          {!data ? (
            !error && <p className="muted small">{t('judge.playsLoading')}</p>
          ) : visible.length === 0 ? (
            <p className="muted small">{t('judge.playsNone')}</p>
          ) : (
            <ol className="plays-list">
              {visible.map(({ play, cue }, i) => (
                <PlayRow
                  key={play.count}
                  data={data}
                  play={play}
                  title={cue.title}
                  sub={cue.sub}
                  turnStart={i === 0 || visible[i - 1].play.turn !== play.turn}
                  undo={undo}
                  logLine={(e) => logText(tryT, e)}
                />
              ))}
            </ol>
          )}
          {list.length > shown && (
            <button className="btn small" onClick={() => setShown((n) => n + PAGE)}>
              {t('judge.playsMore', { n: list.length - shown })}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PlayRow({
  data,
  play,
  title,
  sub,
  turnStart,
  undo,
  logLine,
}: {
  data: JudgePlays;
  play: JudgePlay;
  title: string;
  sub?: string;
  turnStart: boolean;
  undo?: PlaysUndo;
  logLine: (e: JudgePlay['lines'][number]) => string;
}) {
  const t = useT();
  const tryT = useTryT();
  const p = play.pending;
  const ask = p ? askText(tryT, p) : null;
  const source = p && 'source' in p ? citedName(data, p.source) : null;
  const options = offered(p);
  const picked = new Set(chosen(play.action));
  const seen = p && (p.kind === 'selectTargets' || p.kind === 'option') ? (p.shown ?? []).filter((u) => !options.includes(u)) : [];
  const life = p?.kind === 'lifeCard' ? citedName(data, p.card) : null;
  return (
    <>
      {turnStart && <li className="plays-turn">{t('judge.playsTurn', { n: play.turn })}</li>}
      <li className={['plays-row', play.action.type === 'judge' || play.by ? 'judge' : '', p ? 'answer' : ''].join(' ')}>
        <div className="plays-head">
          <span className="plays-n">#{play.count + 1}</span>
          <b>{data.names[play.player]}</b>
          <span>{title}</span>
        </div>
        {play.by && <div className="plays-by small">{t('judge.playsBy', { by: play.by, name: data.names[play.player] })}</div>}
        {(source || ask) && (
          <div className="plays-ask small">
            {source && <b>{t('judge.playsEffect', { name: source })}</b>} {ask ?? sub}
          </div>
        )}
        {life && <div className="plays-ask small">{t('judge.behalfLife', { name: life })}</div>}
        {options.length > 0 && (
          <div className="plays-cards small">
            <span className="muted">{t('judge.playsOffered')}</span>
            {options.map((u) => (
              <span key={u} className={['plays-chip', picked.has(u) ? 'on' : ''].join(' ')}>
                {picked.has(u) ? '✔ ' : ''}
                {citedName(data, u)}
              </span>
            ))}
          </div>
        )}
        {seen.length > 0 && (
          <div className="plays-cards small">
            <span className="muted">{t('judge.playsShown')}</span>
            {seen.map((u) => (
              <span key={u} className="plays-chip">
                {citedName(data, u)}
              </span>
            ))}
          </div>
        )}
        {play.lines.length > 0 ? (
          <ul className="plays-lines small">
            {play.lines.map((e, i) => (
              <li key={i}>{logLine(e)}</li>
            ))}
          </ul>
        ) : (
          // Escolheu (ou aceitou) e nada entrou no histórico: vale conferir se a carta fez o que devia.
          (picked.size > 0 || (play.action.type === 'answer' && play.action.yes) || play.action.type === 'option') && (
            <div className="muted small">{t('judge.undoNoLog')}</div>
          )
        )}
        {undo && (
          <button className="btn small" disabled={undo.busy} onClick={() => undo.onUndo(play.count)}>
            {t('judge.undoTo')}
          </button>
        )}
      </li>
    </>
  );
}
