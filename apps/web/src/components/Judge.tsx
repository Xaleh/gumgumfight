// Judge na mesa: a faixa de "partida pausada" (para todos) e o painel do Judge (quem entrou
// na sala como Judge do torneio ou organizador): pausar, retomar com o relato, conferir as jogadas
// e o que cada jogador escolheu, dar warnings e o modo manual (voltar a partida para antes de uma
// jogada, corrigir a mesa e responder no lugar do jogador quando uma carta não fez o que devia).

import { cardDef, type ManualOp, type ManualZone, type PlayerId } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  APP_OUTCOMES,
  ApiError,
  CALL_OUTCOMES,
  CALL_REASONS,
  type CallOutcome,
  type CallReason,
  errorMessage,
  type JudgeAnswer,
  type JudgeCall,
  type JudgePlays,
} from '../api';
import { logText } from '../game/engineText';
import { askText, citedName, optionText } from '../game/judgePlays';
import type { OnlineGame } from '../game/useOnlineGame';
import { type MessageKey, useLocale, useT, useTryT } from '../i18n';
import { PlaysSheet } from './JudgePlays';

const errorText = (e: unknown) => (e instanceof ApiError ? errorMessage(e.data, e.message) : e instanceof Error ? e.message : String(e));

/** Turnos do histórico mostrados de cada vez na escolha da jogada (os mais recentes primeiro). */
const CALL_TURNS = 3;

/**
 * "Chamar o Judge" do jogador: o que aconteceu (um toque), a jogada do problema (uma linha do próprio
 * histórico, que o servidor liga à jogada exata) e um texto opcional. O Judge já entra sabendo o que conferir.
 */
export function CallJudgeSheet({ online, onClose }: { online: OnlineGame; onClose: () => void }) {
  const t = useT();
  const tryT = useTryT();
  const [reason, setReason] = useState<CallReason | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [details, setDetails] = useState('');
  const [turns, setTurns] = useState(CALL_TURNS);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tour = online.room?.tournament;
  const log = online.state?.log ?? [];
  if (!tour) return null;
  const last = log.length ? log[log.length - 1].turn : 0;
  // As linhas dos últimos turnos, da mais nova para a mais antiga, com a posição no histórico.
  const lines = log
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.turn > last - turns)
    .reverse();
  const send = async () => {
    if (!reason) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.tournaments.call(tour.id, tour.matchId, { reason, ...(details.trim() ? { details: details.trim() } : {}), ...(line !== null ? { logIndex: line } : {}) });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet call-sheet" role="dialog" aria-modal="true" aria-label={t('judge.callTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>⚖ {t('judge.callTitle')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="muted small">{t('judge.callIntro')}</p>
          <h4>{t('judge.callReasonTitle')}</h4>
          <div className="call-reasons">
            {CALL_REASONS.map((r) => (
              <button key={r} className={['btn', 'small', reason === r ? 'on' : ''].join(' ')} aria-pressed={reason === r} onClick={() => (setReason(r), setMissing(false))}>
                {t(`judge.reason.${r}`)}
              </button>
            ))}
          </div>
          {missing && <div className="error small">{t('judge.callReasonMissing')}</div>}
          <h4>{t('judge.callPlayTitle')}</h4>
          <ol className="call-lines">
            <li>
              <button className={['call-line', line === null ? 'on' : ''].join(' ')} onClick={() => setLine(null)}>
                {t('judge.callPlayNone')}
              </button>
            </li>
            {lines.map(({ e, index }) => (
              <li key={index}>
                <button className={['call-line', line === index ? 'on' : ''].join(' ')} onClick={() => setLine(index)}>
                  {logText(tryT, e)}
                </button>
              </li>
            ))}
          </ol>
          {last - turns > 0 && (
            <button className="btn small" onClick={() => setTurns((n) => n + CALL_TURNS)}>
              {t('judge.callMore')}
            </button>
          )}
          <textarea className="admin-search" rows={2} maxLength={300} placeholder={t('judge.callDetails')} value={details} onChange={(e) => setDetails(e.target.value)} />
          {error && <div className="error small">{error}</div>}
          <button className="btn primary" disabled={busy} onClick={() => void send()}>
            {t('judge.callSend')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Faixa sobre a mesa enquanto a partida está pausada por um chamado de Judge. */
export function PauseBanner({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  if (!room?.pause || room.status !== 'playing') return null;
  const by = room.pause.by === null ? null : room.players[room.pause.by]?.name;
  return (
    <div className="judge-pause" role="status">
      <span className="judge-pause-ico">⚖</span>
      <div>
        <strong>{t('judge.paused')}</strong>
        <span>{room.manual ? t('judge.manualBanner', { name: room.manual.name }) : by ? t('judge.pausedBy', { name: by }) : t('judge.pausedByJudge')}</span>
        {!online.watching && <span className="muted">{t('judge.pausedHint')}</span>}
      </div>
    </div>
  );
}

/**
 * Jogadas da partida para o painel (`api.tournaments.plays`), buscadas enquanto `enabled` e de novo a
 * cada jogada nova. `data` pode estar uma jogada atrás da mesa: quem responde pelo jogador confere
 * `data.actionCount` antes.
 */
function useJudgePlays(tour: { id: string; matchId: number }, actionCount: number, enabled: boolean) {
  const [data, setData] = useState<JudgePlays | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Jogadas seguidas (o Judge corrigindo, os jogadores jogando) viram uma busca só.
    const timer = setTimeout(
      () =>
        api.tournaments
          .plays(tour.id, tour.matchId)
          .then((d) => {
            loaded.current = true;
            if (live) (setData(d), setError(null));
          })
          .catch((e: unknown) => live && setError(errorText(e))),
      loaded.current ? 400 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, tour.id, tour.matchId, actionCount]);
  return { data, error };
}

/** O chamado aberto da partida (quem chamou, o motivo, a jogada apontada), buscado enquanto a sala está pausada. */
function useJudgeCall(tour: { id: string; matchId: number }, paused: boolean, actionCount: number) {
  const [call, setCall] = useState<JudgeCall | null>(null);
  useEffect(() => {
    if (!paused) {
      setCall(null);
      return;
    }
    let live = true;
    api.tournaments
      .callInfo(tour.id, tour.matchId)
      .then((r) => live && setCall(r.call))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [paused, tour.id, tour.matchId, actionCount]);
  return call;
}

/**
 * O desfecho que o painel sugere: depois de voltar jogadas ou corrigir a mesa, erro do app (ou, se o próprio
 * jogador disse que clicou errado, a jogada refeita); sem correção, nenhum (o Judge escolhe).
 */
function suggestedOutcome(call: JudgeCall | null): CallOutcome | null {
  if (!call || (!call.undone && !call.fixes)) return null;
  return call.reason === 'misclick' && !call.fixes ? 'misclick' : 'app_fixed';
}

/** Painel do Judge na sala: pausar/retomar (com o relato ao organizador), as jogadas, o modo manual e warnings. */
export function JudgePanel({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  const [note, setNote] = useState('');
  const [warning, setWarning] = useState<{ seat: PlayerId; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [help, setHelp] = useState(false);
  const [playsOpen, setPlaysOpen] = useState(false);
  /** A lista de jogadas aberta na jogada apontada pelo chamado. */
  const [playsFocus, setPlaysFocus] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ call: number; value: CallOutcome } | null>(null);
  const [outcomeMissing, setOutcomeMissing] = useState(false);
  // Motivo do modo manual: o mesmo no painel e na lista de jogadas (desfazer e corrigir pedem o motivo).
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const tour = room?.tournament ?? null;
  const seq = online.state?.actionCount ?? 0;
  const playing = room?.status === 'playing';
  const manual = Boolean(room?.manual) && playing;
  const plays = useJudgePlays(tour ?? { id: '', matchId: 0 }, seq, Boolean(tour) && playing && (playsOpen || manual));
  const call = useJudgeCall(tour ?? { id: '', matchId: 0 }, Boolean(tour) && Boolean(room?.pause) && playing, seq);
  if (!room || !tour) return null;
  const paused = Boolean(room.pause);
  const chosen = call && outcome?.call === call.id ? outcome.value : suggestedOutcome(call);
  const resume = () => {
    // Com o chamado à vista, o Judge fecha com um desfecho pronto; "outro" pede o relato.
    if (call && (!chosen || (chosen === 'other' && !note.trim()))) {
      setOutcomeMissing(true);
      return;
    }
    setOutcomeMissing(false);
    void run(() => api.tournaments.resume(tour.id, tour.matchId, note.trim() || undefined, chosen ?? undefined).then(() => setNote('')), t('judge.resumed'));
  };
  const openPlays = (focus: number | null) => {
    setPlaysFocus(focus);
    setPlaysOpen(true);
  };
  const run = async (fn: () => Promise<unknown>, after?: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      if (after) setDone(after);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  /** Ação do modo manual: só com o motivo escrito. */
  const act = (fn: () => Promise<unknown>, after: string) => {
    if (reason.trim().length < 3) {
      setMissing(true);
      return;
    }
    setMissing(false);
    void run(fn, after);
  };
  const undo = (count: number) => {
    if (reason.trim().length < 3) {
      setMissing(true);
      return;
    }
    if (!window.confirm(t('judge.undoConfirm', { n: seq - count }))) return;
    act(() => api.tournaments.undo(tour.id, tour.matchId, seq, count, reason.trim()), t('judge.undone'));
  };
  return (
    <div className={['judge-panel', open ? '' : 'closed', paused ? 'paused' : ''].join(' ')}>
      <button className="judge-panel-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>⚖ {t('judge.panelTitle')}</span>
        <span className="muted small">{paused ? t('judge.statusPaused') : playing ? t('judge.statusPlaying') : t('judge.statusOver')}</span>
      </button>
      {open && (
        <div className="judge-panel-body">
          {paused ? (
            <>
              {call && <CallBox call={call} onSeePlay={() => openPlays(call.play)} />}
              {call && (
                <fieldset className="judge-outcomes">
                  <legend className="small judge-label">{t('judge.outcomeTitle')}</legend>
                  {(call.undone > 0 || call.fixes > 0) && <p className="muted small">{t('judge.outcomeDone', { n: call.undone, f: call.fixes })}</p>}
                  {CALL_OUTCOMES.map((o) => (
                    <label key={o} className={['judge-outcome', 'small', chosen === o ? 'on' : ''].join(' ')}>
                      <input
                        type="radio"
                        name={`judge-outcome-${call.id}`}
                        checked={chosen === o}
                        onChange={() => (setOutcome({ call: call.id, value: o }), setOutcomeMissing(false))}
                      />
                      {t(`judge.outcome.${o}`)}
                    </label>
                  ))}
                  {chosen && APP_OUTCOMES.includes(chosen) && <p className="muted small">{t('judge.outcomeApp')}</p>}
                  {outcomeMissing && <div className="error small">{t(chosen === 'other' ? 'judge.outcomeNoteMissing' : 'judge.outcomeMissing')}</div>}
                </fieldset>
              )}
              <label className="small judge-label" htmlFor="judge-resume-note">
                {t('judge.noteLabel')}
              </label>
              <textarea
                id="judge-resume-note"
                className="admin-search"
                rows={2}
                maxLength={300}
                placeholder={t('judge.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="btn primary small" disabled={busy} onClick={resume}>
                {t('judge.resume')}
              </button>
            </>
          ) : (
            playing && (
              <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.call(tour.id, tour.matchId))}>
                {t('judge.pause')}
              </button>
            )
          )}
          {playing && (
            <button className="btn small" onClick={() => openPlays(null)}>
              {t('judge.plays')}
            </button>
          )}
          {playing && !room.manual && (
            <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.manual(tour.id, tour.matchId, true))}>
              {t('judge.manualOn')}
            </button>
          )}
          {manual && (
            <ManualTools
              online={online}
              tour={tour}
              busy={busy}
              run={run}
              act={act}
              reason={reason}
              setReason={setReason}
              missing={missing}
              plays={plays.data}
              onOpenPlays={() => openPlays(call?.play ?? null)}
            />
          )}
          <div className="judge-warn-row">
            {room.players.map((p, i) =>
              p.userId ? (
                <button
                  key={i}
                  className={['btn', 'small', warning?.seat === i ? 'on' : ''].join(' ')}
                  disabled={busy}
                  onClick={() => setWarning(warning?.seat === i ? null : { seat: i as PlayerId, reason: '' })}
                >
                  {t('judge.warnBtn', { name: p.name })}
                </button>
              ) : null,
            )}
          </div>
          {warning && (
            <form
              className="judge-warn-form"
              onSubmit={(e) => {
                e.preventDefault();
                const userId = room.players[warning.seat]?.userId;
                if (!userId || warning.reason.trim().length < 3) return;
                void run(() => api.tournaments.warn(tour.id, userId, warning.reason.trim(), tour.matchId), t('judge.warned', { name: room.players[warning.seat].name })).then(() =>
                  setWarning(null),
                );
              }}
            >
              <input
                className="admin-search"
                maxLength={300}
                placeholder={t('judge.reasonPlaceholder')}
                value={warning.reason}
                onChange={(e) => setWarning({ ...warning, reason: e.target.value })}
              />
              <button className="btn small danger" type="submit" disabled={busy || warning.reason.trim().length < 3}>
                {t('judge.warnConfirm', { name: room.players[warning.seat]?.name ?? '?' })}
              </button>
            </form>
          )}
          {error && <div className="error small">{error}</div>}
          {done && <div className="judge-done small">{done}</div>}
          <p className="muted small">{t('judge.panelHint')}</p>
          <button className="btn small link" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
            {t('judge.help')}
          </button>
          {help && <JudgeHelp />}
        </div>
      )}
      {playsOpen && (
        <PlaysSheet
          data={plays.data}
          error={plays.error}
          message={error ? { ok: false, text: error } : done ? { ok: true, text: done } : null}
          focus={playsFocus !== null && call ? { count: playsFocus, by: call.byName } : undefined}
          onClose={() => setPlaysOpen(false)}
          undo={manual ? { busy, note: reason, setNote: setReason, missing, onUndo: undo } : undefined}
        />
      )}
    </div>
  );
}

/** O chamado aberto: quem chamou, o que aconteceu, o texto dele e a jogada apontada (com o atalho para ela). */
function CallBox({ call, onSeePlay }: { call: JudgeCall; onSeePlay: () => void }) {
  const t = useT();
  if (!call.byPlayer && !call.reason) return <p className="muted small">{t('judge.callByJudge', { name: call.byName })}</p>;
  return (
    <div className="judge-call-box">
      <strong className="small">{t('judge.callBox', { name: call.byName })}</strong>
      {call.reason && <span className="small">{t(`judge.reason.${call.reason}`)}</span>}
      {call.details && <q className="small">{call.details}</q>}
      {call.play !== null ? (
        <div className="judge-manual-row">
          <span className="small">{t('judge.callPlay', { n: call.play + 1, turn: call.playTurn ?? '?' })}</span>
          <button className="btn small" onClick={onSeePlay}>
            {t('judge.callSeePlay')}
          </button>
        </div>
      ) : (
        <span className="muted small">{t('judge.callNoPlay')}</span>
      )}
    </div>
  );
}

const HELP: MessageKey[] = ['judge.helpPause', 'judge.helpPlays', 'judge.helpManual', 'judge.helpUndo', 'judge.helpFix', 'judge.helpBehalf', 'judge.helpResume', 'judge.helpWarnings'];

/** O que o Judge e o organizador podem fazer na mesa, na ordem em que costuma acontecer. */
function JudgeHelp() {
  const t = useT();
  return (
    <ol className="judge-help small">
      {HELP.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ol>
  );
}

type Run = (fn: () => Promise<unknown>, after?: string) => Promise<void>;

const MOVE_TO: Array<[ManualZone, MessageKey]> = [
  ['hand', 'replay.zoneHand'],
  ['trash', 'replay.zoneTrash'],
  ['deckTop', 'replay.zoneDeckTop'],
  ['deckBottom', 'replay.zoneDeckBottom'],
  ['life', 'replay.zoneLife'],
  ['character', 'replay.zoneCharacter'],
  ['stage', 'replay.zoneStage'],
];

/**
 * Modo manual (a partida está pausada e só o Judge mexe na mesa): voltar a partida para antes de uma
 * jogada (escolhida na lista de jogadas), corrigir a mesa pelo lado de cada jogador, com as ferramentas
 * manuais do motor, e responder a pergunta aberta no lugar do jogador. As cartas das ferramentas vêm da
 * visão do Judge (as duas mãos à vista); o motivo é obrigatório e vai para as ocorrências do torneio.
 */
function ManualTools({
  online,
  tour,
  busy,
  run,
  act,
  reason,
  setReason,
  missing,
  plays,
  onOpenPlays,
}: {
  online: OnlineGame;
  tour: { id: string; matchId: number };
  busy: boolean;
  run: Run;
  act: (fn: () => Promise<unknown>, after: string) => void;
  reason: string;
  setReason: (r: string) => void;
  missing: boolean;
  plays: JudgePlays | null;
  onOpenPlays: () => void;
}) {
  const t = useT();
  const room = online.room!;
  const state = online.state;
  const [side, setSide] = useState<PlayerId>(0);
  const [card, setCard] = useState('');
  if (!state) return null;
  const seq = state.actionCount;
  const send = (body: { op?: ManualOp; action?: JudgeAnswer }, player: PlayerId) =>
    act(() => api.tournaments.judgeAction(tour.id, tour.matchId, { seq, player, note: reason.trim(), ...body }), t('judge.fixed'));
  const fix = (op: ManualOp) => send({ op }, side);
  const ps = state.players[side];
  const name = (ref: string) => (state.cards[ref] ? cardDef(state, ref).name : '?');
  const zones: Array<[string, Array<[string, string]>]> = [
    [t('board.area.leader'), [[ps.leader.uid, name(ps.leader.uid)]]],
    [t('board.area.character'), ps.characters.map((c) => [c.uid, `${name(c.uid)}${c.rested ? ' ↷' : ''}`])],
    [t('board.area.stage'), ps.stage ? [[ps.stage.uid, name(ps.stage.uid)]] : []],
    [t('judge.fixHand'), ps.hand.map((u) => [u, name(u)])],
    [t('board.area.life'), [...ps.life].reverse().map((u, i) => [u, `${t('judge.fixLifeCard', { n: i + 1 })}${state.cards[u]?.cardId !== '?' ? `: ${name(u)}` : ''}`])],
    [t('board.area.trash'), [...ps.trash].reverse().map((u) => [u, name(u)])],
  ];
  const picked = zones.some(([, list]) => list.some(([u]) => u === card)) ? card : '';
  const onField = picked !== '' && (picked === ps.leader.uid || picked === ps.stage?.uid || ps.characters.some((c) => c.uid === picked));
  const fieldCard = onField ? [ps.leader, ps.stage, ...ps.characters].find((c) => c?.uid === picked) : undefined;
  const actingName = (p: PlayerId) => room.players[p]?.name ?? '?';
  return (
    <div className="judge-manual">
      <div className="judge-manual-head">
        <strong>🛠 {t('judge.manualTitle')}</strong>
        <span className="muted small">{t('judge.manualBy', { name: room.manual?.name ?? '?' })}</span>
        <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.manual(tour.id, tour.matchId, false))}>
          {t('judge.manualLeave')}
        </button>
      </div>
      <p className="muted small">{t('judge.manualHint')}</p>
      <textarea
        className={['admin-search', missing ? 'invalid' : ''].join(' ')}
        rows={2}
        maxLength={300}
        placeholder={t('judge.manualNote')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {missing && <div className="error small">{t('judge.manualNoteMissing')}</div>}

      <h4>{t('judge.undoTitle')}</h4>
      <p className="muted small">{t('judge.undoHint')}</p>
      <button className="btn small" onClick={onOpenPlays}>
        {t('judge.playsOpenUndo')}
      </button>

      <OnBehalf plays={plays} seq={seq} active={state.activePlayer} busy={busy} name={actingName} answer={(action, p) => send({ action }, p)} />

      <h4>{t('judge.fixTitle')}</h4>
      <div className="judge-warn-row">
        {([0, 1] as const).map((p) => (
          <button key={p} className={['btn', 'small', side === p ? 'on' : ''].join(' ')} onClick={() => (setSide(p), setCard(''))}>
            {t('judge.fixSide', { name: actingName(p) })}
          </button>
        ))}
      </div>
      <div className="judge-manual-row">
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'draw', count: 1 })}>
          {t('judge.fixDraw')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'shuffle' })}>
          {t('judge.fixShuffle')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donFromDeck', count: 1, rested: false })}>
          {t('judge.fixDonActive')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donFromDeck', count: 1, rested: true })}>
          {t('judge.fixDonRested')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donToDeck', count: 1 })}>
          {t('judge.fixDonReturn')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donSetState', player: side, rested: true, count: 1 })}>
          {t('judge.fixDonRest')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donSetState', player: side, rested: false, count: 1 })}>
          {t('judge.fixDonActivate')}
        </button>
      </div>
      <select className="admin-search" value={picked} onChange={(e) => setCard(e.target.value)}>
        <option value="">{t('judge.fixCardPick')}</option>
        {zones.map(([label, list]) =>
          list.length ? (
            <optgroup key={label} label={label}>
              {list.map(([u, text], i) => (
                <option key={`${u}-${i}`} value={u}>
                  {text}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
      {picked && (
        <div className="judge-manual-row">
          {picked !== ps.leader.uid && (
            <select
              className="admin-search"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && fix({ op: 'move', uid: picked, to: e.target.value as ManualZone })}
            >
              <option value="">{t('judge.fixMoveTo')}</option>
              {MOVE_TO.map(([zone, key]) => (
                <option key={zone} value={zone}>
                  {t(key)}
                </option>
              ))}
            </select>
          )}
          {onField && ps.characters.some((c) => c.uid === picked) && (
            <button className="btn small danger" disabled={busy} onClick={() => fix({ op: 'ko', uid: picked })}>
              {t('judge.fixKo')}
            </button>
          )}
          {fieldCard && (
            <button className="btn small" disabled={busy} onClick={() => fix({ op: 'setRested', uid: picked, rested: !fieldCard.rested })}>
              {fieldCard.rested ? t('judge.fixActivate') : t('judge.fixRest')}
            </button>
          )}
          {onField && (
            <>
              <button className="btn small" disabled={busy} onClick={() => fix({ op: 'power', uid: picked, amount: 1000, duration: 'turn' })}>
                {t('judge.fixPowerUp')}
              </button>
              <button className="btn small" disabled={busy} onClick={() => fix({ op: 'power', uid: picked, amount: -1000, duration: 'turn' })}>
                {t('judge.fixPowerDown')}
              </button>
            </>
          )}
          {onField && picked !== ps.stage?.uid && (
            <button className="btn small" disabled={busy} onClick={() => fix({ op: 'donGive', uid: picked, from: 'active' })}>
              {t('judge.fixGiveDon')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Resposta no lugar do jogador que a partida espera, conforme a pergunta aberta: escolher os alvos (as
 * opções completas vêm das jogadas, mesmo as do deck), bloquear ou não, usar ou não o Counter, sim/não,
 * uma das opções, a carta da Vida, concluir o efeito manual ou, sem pergunta, encerrar o turno.
 */
function OnBehalf({
  plays,
  seq,
  active,
  busy,
  name,
  answer,
}: {
  plays: JudgePlays | null;
  seq: number;
  active: PlayerId;
  busy: boolean;
  name: (p: PlayerId) => string;
  answer: (a: JudgeAnswer, p: PlayerId) => void;
}) {
  const t = useT();
  const tryT = useTryT();
  const locale = useLocale();
  const [marked, setMarked] = useState<{ seq: number; uids: string[] }>({ seq, uids: [] });
  // As jogadas ainda não chegaram para esta versão da mesa: a pergunta pode ter mudado.
  if (!plays || plays.actionCount !== seq) return <p className="muted small">{t('judge.behalfLoading')}</p>;
  const p = plays.pending;
  const who = p ? p.player : active;
  const uids = marked.seq === seq ? marked.uids : [];
  const toggle = (uid: string, max: number) =>
    setMarked({ seq, uids: uids.includes(uid) ? uids.filter((u) => u !== uid) : max === 1 ? [uid] : uids.length < max ? [...uids, uid] : uids });
  const ask = p ? askText(tryT, p) : null;
  const source = p && 'source' in p ? citedName(plays, p.source) : null;
  const say = (a: JudgeAnswer) => answer(a, who);
  const chips = (options: string[], max: number) => (
    <div className="judge-manual-row">
      {options.map((u) => (
        <button key={u} className={['btn', 'small', uids.includes(u) ? 'on' : ''].join(' ')} disabled={busy} onClick={() => toggle(u, max)}>
          {uids.includes(u) ? `✔ ${uids.length > 1 ? `${uids.indexOf(u) + 1}. ` : ''}` : ''}
          {citedName(plays, u)}
        </button>
      ))}
    </div>
  );
  let body: JSX.Element | null = null;
  switch (p?.kind) {
    case undefined:
      body = (
        <button className="btn small" disabled={busy} onClick={() => say({ type: 'endTurn' })}>
          {t('judge.fixEndTurn')}
        </button>
      );
      break;
    case 'manual':
      body = (
        <button className="btn small" disabled={busy} onClick={() => say({ type: 'manualDone' })}>
          {t('judge.fixManualDone')}
        </button>
      );
      break;
    case 'selectTargets':
      body = (
        <>
          {p.options.length > 0 && chips(p.options, p.max)}
          <button
            className="btn small primary"
            disabled={busy || uids.length < p.min || uids.length > p.max}
            onClick={() => say({ type: 'choose', uids })}
          >
            {uids.length ? t('judge.behalfConfirm', { n: uids.length }) : t('judge.behalfNone')}
          </button>
        </>
      );
      break;
    case 'block':
      body = (
        <>
          {chips(p.options, 1)}
          <button className="btn small primary" disabled={busy} onClick={() => say({ type: 'choose', uids })}>
            {uids.length ? t('judge.behalfBlock', { name: citedName(plays, uids[0]) }) : t('judge.behalfNoBlock')}
          </button>
        </>
      );
      break;
    case 'counter':
      body = (
        <button className="btn small" disabled={busy} onClick={() => say({ type: 'pass' })}>
          {t('judge.behalfNoCounter')}
        </button>
      );
      break;
    case 'confirm':
      body = (
        <div className="judge-manual-row">
          <button className="btn small" disabled={busy || Boolean(p.cannot)} onClick={() => say({ type: 'answer', yes: true })}>
            {t('common.yes')}
          </button>
          <button className="btn small" disabled={busy} onClick={() => say({ type: 'answer', yes: false })}>
            {t('common.no')}
          </button>
        </div>
      );
      break;
    case 'lifeCard':
      body = (
        <>
          <p className="small">{t('judge.behalfLife', { name: citedName(plays, p.card) })}</p>
          <div className="judge-manual-row">
            <button className="btn small" disabled={busy} onClick={() => say({ type: 'answer', yes: true })}>
              {t('judge.behalfTrigger')}
            </button>
            <button className="btn small" disabled={busy} onClick={() => say({ type: 'answer', yes: false })}>
              {t('judge.behalfToHand')}
            </button>
          </div>
        </>
      );
      break;
    case 'option':
      body = (
        <div className="judge-manual-row">
          {p.options.map((_, index) => (
            <button key={index} className="btn small" disabled={busy} onClick={() => say({ type: 'option', index })}>
              {optionText(tryT, p, index, locale)}
            </button>
          ))}
        </div>
      );
      break;
    default:
      body = <p className="muted small">{t('judge.behalfSetup')}</p>;
  }
  return (
    <div className="judge-behalf">
      <h4>{t('judge.fixOnBehalf', { name: name(who) })}</h4>
      <p className="muted small">{t('judge.behalfHint')}</p>
      {p ? (
        (source || ask) && (
          <p className="small">
            {source && <b>{t('judge.playsEffect', { name: source })}</b>} {ask}
          </p>
        )
      ) : (
        <p className="small">{t('judge.behalfTurn', { name: name(who) })}</p>
      )}
      {body}
    </div>
  );
}
