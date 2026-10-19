// Judge na mesa: a faixa de "partida pausada" (para todos) e o painel do Judge (quem entrou
// na sala como Judge do torneio ou organizador): pausar, retomar com o relato, dar warnings e o
// modo manual (desfazer jogadas e corrigir a mesa quando uma carta não fez o que devia).

import { cardDef, type GameState, type ManualOp, type ManualZone, type PlayerId } from '@gumgum/engine';
import { useState } from 'react';
import { api, ApiError, errorMessage, type ManualHistoryItem } from '../api';
import { logText } from '../game/engineText';
import type { OnlineGame } from '../game/useOnlineGame';
import { type MessageKey, useT, useTryT } from '../i18n';

const errorText = (e: unknown) => (e instanceof ApiError ? errorMessage(e.data, e.message) : e instanceof Error ? e.message : String(e));

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

/** Painel do Judge na sala: pausar/retomar (com o relato ao organizador) e warnings para cada jogador. */
export function JudgePanel({ online }: { online: OnlineGame }) {
  const t = useT();
  const room = online.room;
  const [note, setNote] = useState('');
  const [warning, setWarning] = useState<{ seat: PlayerId; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  if (!room?.tournament) return null;
  const tour = room.tournament;
  const paused = Boolean(room.pause);
  const playing = room.status === 'playing';
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
              <textarea
                className="admin-search"
                rows={2}
                maxLength={300}
                placeholder={t('judge.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn primary small"
                disabled={busy}
                onClick={() => run(() => api.tournaments.resume(tour.id, tour.matchId, note.trim() || undefined).then(() => setNote('')), t('judge.resumed'))}
              >
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
          {playing && !room.manual && (
            <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.manual(tour.id, tour.matchId, true))}>
              {t('judge.manualOn')}
            </button>
          )}
          {playing && room.manual && <ManualTools online={online} tour={tour} busy={busy} run={run} />}
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
        </div>
      )}
    </div>
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
 * Modo manual (a partida está pausada e só o Judge mexe na mesa): desfazer até uma jogada escolhida e
 * corrigir a mesa pelo lado de cada jogador, com as ferramentas manuais do motor. As cartas vêm da
 * visão do Judge (as duas mãos à vista); o motivo é obrigatório e vai para as ocorrências do torneio.
 */
function ManualTools({ online, tour, busy, run }: { online: OnlineGame; tour: { id: string; matchId: number }; busy: boolean; run: Run }) {
  const t = useT();
  const tryT = useTryT();
  const room = online.room!;
  const state = online.state;
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ManualHistoryItem[] | null>(null);
  const [side, setSide] = useState<PlayerId>(0);
  const [card, setCard] = useState('');
  const [missing, setMissing] = useState(false);
  if (!state) return null;
  const reason = note.trim();
  const seq = state.actionCount;
  /** Só com o motivo escrito; depois de agir, a lista de jogadas fica velha. */
  const act = (fn: () => Promise<unknown>, after: string) => {
    if (reason.length < 3) {
      setMissing(true);
      return;
    }
    setMissing(false);
    void run(() => fn().then(() => setHistory(null)), after);
  };
  const fix = (body: { op?: ManualOp; action?: { type: 'manualDone' | 'pass' | 'endTurn' } }, player: PlayerId = side) =>
    act(() => api.tournaments.judgeAction(tour.id, tour.matchId, { seq, player, note: reason, ...body }), t('judge.fixed'));
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
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {missing && <div className="error small">{t('judge.manualNoteMissing')}</div>}

      <h4>{t('judge.undoTitle')}</h4>
      {history === null ? (
        <button
          className="btn small"
          disabled={busy}
          onClick={() => run(() => api.tournaments.manualHistory(tour.id, tour.matchId).then((r) => setHistory(r.history)))}
        >
          {t('judge.undoLoad')}
        </button>
      ) : history.length === 0 ? (
        <p className="muted small">{t('judge.undoEmpty')}</p>
      ) : (
        <ol className="judge-history">
          {history.map((h) => {
            const lines = state.log.slice(h.logFrom, h.logTo).map((e) => logText(tryT, e));
            return (
              <li key={h.count}>
                <span className="small">
                  <b>#{h.count + 1}</b> {actingName(h.player)}: {lines.length ? lines.join(' ') : t('judge.undoNoLog')}
                </span>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => {
                    if (reason.length >= 3 && !window.confirm(t('judge.undoConfirm', { n: seq - h.count }))) return;
                    act(() => api.tournaments.undo(tour.id, tour.matchId, seq, h.count, reason), t('judge.undone'));
                  }}
                >
                  {t('judge.undoTo')}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <h4>{t('judge.fixTitle')}</h4>
      <div className="judge-warn-row">
        {([0, 1] as const).map((p) => (
          <button key={p} className={['btn', 'small', side === p ? 'on' : ''].join(' ')} onClick={() => (setSide(p), setCard(''))}>
            {t('judge.fixSide', { name: actingName(p) })}
          </button>
        ))}
      </div>
      <div className="judge-manual-row">
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'draw', count: 1 } })}>
          {t('judge.fixDraw')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'shuffle' } })}>
          {t('judge.fixShuffle')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donFromDeck', count: 1, rested: false } })}>
          {t('judge.fixDonActive')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donFromDeck', count: 1, rested: true } })}>
          {t('judge.fixDonRested')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donToDeck', count: 1 } })}>
          {t('judge.fixDonReturn')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donSetState', player: side, rested: true, count: 1 } })}>
          {t('judge.fixDonRest')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donSetState', player: side, rested: false, count: 1 } })}>
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
              onChange={(e) => e.target.value && fix({ op: { op: 'move', uid: picked, to: e.target.value as ManualZone } })}
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
            <button className="btn small danger" disabled={busy} onClick={() => fix({ op: { op: 'ko', uid: picked } })}>
              {t('judge.fixKo')}
            </button>
          )}
          {fieldCard && (
            <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'setRested', uid: picked, rested: !fieldCard.rested } })}>
              {fieldCard.rested ? t('judge.fixActivate') : t('judge.fixRest')}
            </button>
          )}
          {onField && (
            <>
              <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'power', uid: picked, amount: 1000, duration: 'turn' } })}>
                {t('judge.fixPowerUp')}
              </button>
              <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'power', uid: picked, amount: -1000, duration: 'turn' } })}>
                {t('judge.fixPowerDown')}
              </button>
            </>
          )}
          {onField && picked !== ps.stage?.uid && (
            <button className="btn small" disabled={busy} onClick={() => fix({ op: { op: 'donGive', uid: picked, from: 'active' } })}>
              {t('judge.fixGiveDon')}
            </button>
          )}
        </div>
      )}
      <OnBehalf state={state} busy={busy} name={actingName} fix={(type, p) => fix({ action: { type } }, p)} />
    </div>
  );
}

/** Respostas no lugar do jogador que a partida espera: concluir o efeito manual, passar ou encerrar o turno. */
function OnBehalf({
  state,
  busy,
  name,
  fix,
}: {
  state: GameState;
  busy: boolean;
  name: (p: PlayerId) => string;
  fix: (type: 'manualDone' | 'pass' | 'endTurn', p: PlayerId) => void;
}) {
  const t = useT();
  const pendingKind = state.pending?.kind;
  const p = state.pending ? state.pending.player : state.activePlayer;
  return (
    <div className="judge-manual-row">
      <span className="small">{t('judge.fixOnBehalf', { name: name(p) })}</span>
      {pendingKind === 'manual' && (
        <button className="btn small" disabled={busy} onClick={() => fix('manualDone', p)}>
          {t('judge.fixManualDone')}
        </button>
      )}
      {pendingKind !== undefined && pendingKind !== 'manual' && (
        <button className="btn small" disabled={busy} onClick={() => fix('pass', p)}>
          {t('judge.fixPass')}
        </button>
      )}
      {pendingKind === undefined && (
        <button className="btn small" disabled={busy} onClick={() => fix('endTurn', p)}>
          {t('judge.fixEndTurn')}
        </button>
      )}
    </div>
  );
}
