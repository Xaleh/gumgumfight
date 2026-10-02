import {
  type Action,
  actingPlayer,
  cardDef,
  type GameState,
  getPower,
  legalActions,
  locate,
  manualAllowed,
  type PlayerId,
  translateToPt,
  zoneOf,
} from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { type GameSetup, useGame } from '../game/useGame';
import { cardText, SettingsControls, useSettings } from '../settings';
import { Board } from './Board';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight } from './CardView';
import { GameResult } from './GameResult';
import { ManualTools } from './ManualTools';

type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don' };
type DragKind = 'hand' | 'attacker' | 'don';
interface Drag {
  kind: DragKind;
  uid: string | null;
  x: number;
  y: number;
  /** Carta (uid) ou 'field' sob o dedo, se for um destino válido. */
  over: string | null;
}
type Sheet = null | 'menu' | 'log' | 'tools' | { trash: PlayerId };

const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 9;

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function GameScreen({ setup, onExit, onRematch }: { setup: GameSetup; onExit: () => void; onRematch?: () => void }) {
  const game = useGame(setup);
  const { state, dispatch, human } = game;
  const wide = useMediaQuery('(min-width: 1000px)');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [showBotHand, setShowBotHand] = useState(setup.mode !== 'bot');
  const [banner, setBanner] = useState<{ text: string; mine: boolean; key: number } | null>(null);
  const [showResult, setShowResult] = useState(false);

  const pending = state.pending;
  const myPending = pending && human !== null && pending.player === human ? pending : null;
  const legal = useMemo(() => (human !== null ? legalActions(state, human) : []), [state, human]);
  const myTurnIdle =
    human !== null && !game.auto && !pending && state.activePlayer === human && state.phase === 'main' && !state.stack.length;
  const acting = actingPlayer(state);
  const bottom: PlayerId = human ?? 0;

  // Limpa seleções quando a situação muda.
  useEffect(() => setPicked([]), [pending]);
  useEffect(() => {
    if (!myTurnIdle) setMode(null);
    if (mode?.kind === 'don' && human !== null && state.players[human].donActive === 0) setMode(null);
  }, [myTurnIdle, state, human, mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode(null);
        setSelected(null);
        setZoom(null);
        setSheet(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Faixa "Seu turno" / "Você joga primeiro" a cada troca de turno.
  const turnKey = state.phase === 'main' ? `${state.turn}:${state.activePlayer}` : null;
  useEffect(() => {
    if (turnKey === null) return;
    const p = state.activePlayer;
    const mine = human === null ? p === 0 : p === human;
    const name = state.players[p].name;
    const text =
      state.turn === 1
        ? human !== null && p === human
          ? 'Você jogará primeiro.'
          : `${name} jogará primeiro.`
        : human !== null && p === human
          ? 'Seu turno!'
          : `Turno de ${name}`;
    setBanner({ text, mine, key: state.turn });
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
    // Só muda na troca de turno (não a cada ação).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, human]);

  // Registra o resultado no servidor quando a partida termina e mostra o resumo após o último golpe.
  const saved = useRef(false);
  useEffect(() => {
    if (state.phase !== 'gameover') {
      setShowResult(false);
      return;
    }
    if (!saved.current) {
      saved.current = true;
      void api.saveMatch({
        seed: state.seed,
        mode: setup.mode,
        deck0: setup.deckIds[0],
        deck1: setup.deckIds[1],
        winner: state.winner,
        turns: state.turn,
        reason: state.winReason,
      });
    }
    const t = setTimeout(() => setShowResult(true), 1200);
    return () => clearTimeout(t);
  }, [state, setup]);

  const has = useCallback((pred: (a: Action) => boolean) => legal.some(pred), [legal]);
  const canPlay = (uid: string) => myTurnIdle && has((a) => a.type === 'playCard' && a.uid === uid);
  const canAttackWith = (uid: string) => myTurnIdle && has((a) => a.type === 'attack' && a.attacker === uid);

  /** Destinos válidos para o que está sendo arrastado. */
  const dropValid = (d: Pick<Drag, 'kind' | 'uid'>, over: string | null): boolean => {
    if (!over) return false;
    if (d.kind === 'hand') return over === 'field' && d.uid !== null && canPlay(d.uid);
    if (d.kind === 'attacker') return has((a) => a.type === 'attack' && a.attacker === d.uid && a.target === over);
    return has((a) => a.type === 'attachDon' && a.target === over);
  };

  const highlight = (uid: string): Highlight => {
    if (drag) {
      if (uid === drag.uid) return 'selected';
      if (drag.kind !== 'hand' && dropValid(drag, uid)) return 'option';
      return null;
    }
    if (myPending) {
      if (myPending.kind === 'selectTargets') {
        if (picked.includes(uid)) return 'selected';
        if (myPending.options.includes(uid)) return 'option';
      }
      if ((myPending.kind === 'block' || myPending.kind === 'counter') && myPending.options.includes(uid)) return 'option';
    }
    if (state.battle) {
      if (uid === state.battle.attacker) return 'attacker';
      if (uid === state.battle.target) return 'target';
    }
    if (mode?.kind === 'attack') {
      if (uid === mode.attacker) return 'selected';
      if (has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) return 'option';
      return null;
    }
    if (mode?.kind === 'don') {
      return has((a) => a.type === 'attachDon' && a.target === uid) ? 'option' : null;
    }
    if (uid === selected && !wide) return null;
    if (uid === selected) return 'selected';
    if (canPlay(uid)) return 'playable';
    if (canAttackWith(uid)) return 'ready';
    return null;
  };

  const onCard = (uid: string) => {
    if (myPending) {
      if (myPending.kind === 'selectTargets' && myPending.options.includes(uid)) {
        setPicked((p) =>
          p.includes(uid) ? p.filter((x) => x !== uid) : myPending.max === 1 ? [uid] : p.length < myPending.max ? [...p, uid] : p,
        );
        return;
      }
      if (myPending.kind === 'block' && myPending.options.includes(uid)) {
        dispatch({ type: 'choose', player: human!, uids: [uid] });
        return;
      }
      if (myPending.kind === 'counter' && myPending.options.includes(uid)) {
        dispatch({ type: 'counter', player: human!, uid });
        return;
      }
    }
    if (mode?.kind === 'attack') {
      if (has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) {
        dispatch({ type: 'attack', player: human!, attacker: mode.attacker, target: uid });
        setSelected(null);
        setMode(null);
        return;
      }
      setMode(null);
      if (uid === mode.attacker) return;
    }
    if (mode?.kind === 'don') {
      if (has((a) => a.type === 'attachDon' && a.target === uid)) {
        dispatch({ type: 'attachDon', player: human!, target: uid });
        return;
      }
      setMode(null);
    }
    // Carta escondida (mão do oponente) não abre.
    const owner = state.cards[uid]?.owner;
    if (owner !== undefined && owner !== human && zoneOf(state, uid) === 'hand' && !showBotHand) return;
    setSelected(uid);
    setZoom(uid);
  };

  const onCardDouble = (uid: string) => {
    if (canPlay(uid)) {
      dispatch({ type: 'playCard', player: human!, uid });
      setSelected(null);
      setZoom(null);
    }
  };

  const onDon = (player: PlayerId) => {
    if (player !== human || !myTurnIdle) return;
    setMode((m) => (m?.kind === 'don' ? null : has((a) => a.type === 'attachDon') ? { kind: 'don' } : null));
  };

  // ------------------------------------------------------------ gestos: toque longo e arrastar

  const press = useRef<{
    x: number;
    y: number;
    uid: string | null;
    kind: DragKind | null;
    timer: ReturnType<typeof setTimeout>;
    moved: boolean;
  } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef<(d: Drag) => void>(() => undefined);
  const dropValidRef = useRef(dropValid);
  dropValidRef.current = dropValid;

  dropRef.current = (d: Drag) => {
    if (!d.over || !dropValid(d, d.over) || human === null) return;
    if (d.kind === 'hand') dispatch({ type: 'playCard', player: human, uid: d.uid! });
    else if (d.kind === 'attacker') dispatch({ type: 'attack', player: human, attacker: d.uid!, target: d.over });
    else dispatch({ type: 'attachDon', player: human, target: d.over });
    setMode(null);
    setSelected(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target as HTMLElement;
    const dragEl = el.closest<HTMLElement>('[data-drag]');
    const cardEl = el.closest<HTMLElement>('[data-uid]');
    if (!dragEl && !cardEl) return;
    const uid = (dragEl ?? cardEl)!.dataset.uid ?? null;
    const kind = (dragEl?.dataset.drag as DragKind | undefined) ?? null;
    if (press.current) clearTimeout(press.current.timer);
    const timer = setTimeout(() => {
      const p = press.current;
      if (!p || p.moved || !cardEl?.dataset.uid) return;
      suppressClick.current = true;
      press.current = null;
      setZoom(cardEl.dataset.uid);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
    press.current = { x: e.clientX, y: e.clientY, uid, kind, timer, moved: false };
  };

  useEffect(() => {
    const findOver = (x: number, y: number, d: Drag): string | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return null;
      if (d.kind === 'hand') return el.closest('[data-drop="field"]') ? 'field' : null;
      const uid = el.closest<HTMLElement>('[data-uid]')?.dataset.uid ?? null;
      return uid && dropValidRef.current(d, uid) ? uid : null;
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
        p.moved = true;
        clearTimeout(p.timer);
        if (!p.kind) return;
        dragRef.current = { kind: p.kind, uid: p.uid, x: e.clientX, y: e.clientY, over: null };
        setZoom(null);
        setMode(null);
      }
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY, over: findOver(e.clientX, e.clientY, d) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const p = press.current;
      if (p) clearTimeout(p.timer);
      press.current = null;
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        setDrag(null);
        suppressClick.current = true;
        dropRef.current(d);
      }
      // O clique (se houver) chega logo depois do pointerup; depois disso, libera.
      setTimeout(() => (suppressClick.current = false), 60);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // ------------------------------------------------------------ render

  const handlers = {
    highlight,
    onCard,
    onCardDouble,
    onHover: setHovered,
    onDon,
    onTrash: (p: PlayerId) => setSheet({ trash: p }),
    donHighlight: (p: PlayerId) =>
      p === human && (mode?.kind === 'don' || (drag?.kind === 'don') || (myTurnIdle && has((a) => a.type === 'attachDon'))),
    canDragHand: (uid: string) => canPlay(uid),
    canDragAttacker: (uid: string) => canAttackWith(uid),
    canDragDon: (p: PlayerId) => p === human && myTurnIdle && has((a) => a.type === 'attachDon'),
    fieldDrop: (p: PlayerId) => p === human && drag?.kind === 'hand',
  };

  const corner = (
    <>
      <button className="round-btn" onClick={() => setSheet('menu')} aria-label="Menu da partida">
        <span className="burger" />
      </button>
      {human !== null && (
        <button
          className={['auto-toggle', game.auto ? 'on' : ''].join(' ')}
          onClick={() => game.setAuto((a) => !a)}
          title="O bot joga por você enquanto estiver ligado"
        >
          <span className="knob" />
          Auto
        </button>
      )}
    </>
  );

  const detailUid = hovered ?? selected;

  return (
    <div
      className={['game', wide ? 'wide' : '', drag ? 'dragging' : ''].join(' ')}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-col">
        <Board
          state={state}
          bottom={bottom}
          revealBottom
          revealTop={showBotHand}
          corner={corner}
          center={
            <CenterBand
              state={state}
              human={human}
              acting={acting}
              mode={mode}
              paused={game.paused}
              canEnd={myTurnIdle}
              onEnd={() => dispatch({ type: 'endTurn', player: human! })}
              onCancelMode={() => setMode(null)}
              onTogglePause={() => game.setPaused((p) => !p)}
            />
          }
          {...handlers}
        />

        {banner && state.phase === 'main' && (
          <div key={banner.key} className={['turn-banner', banner.mine ? 'mine' : 'theirs'].join(' ')}>
            {banner.text}
          </div>
        )}

        {game.error && (
          <div className="toast error" onClick={() => game.setError(null)}>
            {game.error}
          </div>
        )}

        <Prompt
          state={state}
          human={human}
          picked={picked}
          onDispatch={dispatch}
          onCard={onCard}
          highlight={highlight}
          onTools={() => setSheet('tools')}
        />

        {drag && (
          <div
            className={['drag-ghost', `ghost-${drag.kind}`, drag.over ? 'over' : ''].join(' ')}
            style={{ left: drag.x, top: drag.y }}
          >
            {drag.kind === 'don' ? <div className="don-token">DON!!</div> : drag.uid && <CardView state={state} uid={drag.uid} />}
          </div>
        )}

        {zoom && state.cards[zoom] && (
          <CardZoom
            state={state}
            uid={zoom}
            legal={myTurnIdle ? legal : []}
            canManual={human !== null && manualAllowed(state, human)}
            onClose={() => setZoom(null)}
            onDispatch={(a) => {
              dispatch(a);
              setZoom(null);
              setSelected(null);
            }}
            onAttackMode={(attacker) => {
              setMode({ kind: 'attack', attacker });
              setZoom(null);
            }}
            onTools={() => {
              setZoom(null);
              setSheet('tools');
            }}
          />
        )}

        {sheet === 'menu' && (
          <SheetFrame title="Partida" onClose={() => setSheet(null)}>
            <div className="menu-grid">
              {human !== null && (
                <button className="btn" onClick={game.undo} disabled={!game.canUndo}>
                  ↶ Desfazer
                </button>
              )}
              <button className="btn" onClick={() => game.setPaused((p) => !p)}>
                {game.paused ? '▶ Continuar' : '❚❚ Pausar'}
              </button>
              <button className="btn" onClick={() => setSheet('log')}>
                📜 Histórico
              </button>
              {human !== null && manualAllowed(state, human) && (
                <button className="btn" onClick={() => setSheet('tools')}>
                  ⚙ Ferramentas manuais
                </button>
              )}
              <button className="btn" onClick={() => downloadReplay(game.exportReplay())}>
                ⤓ Baixar replay
              </button>
              {human !== null && state.phase === 'main' && (
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm('Desistir desta partida?')) {
                      dispatch({ type: 'concede', player: human });
                      setSheet(null);
                    }
                  }}
                >
                  🏳 Desistir
                </button>
              )}
              <button className="btn" onClick={onExit}>
                ← Sair para o menu
              </button>
            </div>
            <div className="sheet-section">
              <label className="sheet-label">Velocidade do bot</label>
              <div className="seg small">
                {[0.5, 1, 2, 4].map((v) => (
                  <button key={v} className={game.speed === v ? 'on' : ''} onClick={() => game.setSpeed(v)}>
                    {v}×
                  </button>
                ))}
              </div>
            </div>
            {setup.mode === 'bot' && (
              <label className="check">
                <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> Ver a mão do bot
              </label>
            )}
            <div className="sheet-section">
              <SettingsControls compact />
            </div>
          </SheetFrame>
        )}

        {sheet === 'log' && (
          <SheetFrame title="Histórico" onClose={() => setSheet(null)}>
            <LogPanel state={state} />
          </SheetFrame>
        )}

        {sheet === 'tools' && human !== null && (
          <SheetFrame title="Ferramentas manuais" onClose={() => setSheet(null)}>
            <ManualPrompt state={state} onDone={() => dispatch({ type: 'manualDone', player: human })} />
            {manualAllowed(state, human) ? (
              <ManualTools state={state} human={human} selected={selected} onDispatch={dispatch} onSelect={setSelected} />
            ) : (
              <p className="muted">As ferramentas ficam disponíveis no seu turno, num efeito manual ou na etapa de Counter.</p>
            )}
          </SheetFrame>
        )}

        {sheet !== null && typeof sheet === 'object' && (
          <SheetFrame
            title={`Descarte de ${state.players[sheet.trash].name} (${state.players[sheet.trash].trash.length})`}
            onClose={() => setSheet(null)}
          >
            <div className="card-list">
              {[...state.players[sheet.trash].trash].reverse().map((uid) => (
                <CardView key={uid} state={state} uid={uid} onClick={() => setZoom(uid)} onHover={setHovered} />
              ))}
              {state.players[sheet.trash].trash.length === 0 && <p className="muted">Nenhuma carta no descarte.</p>}
            </div>
          </SheetFrame>
        )}

        {state.phase === 'gameover' && showResult && (
          <GameResult
            state={state}
            human={human}
            actions={game.actions()}
            onExit={onExit}
            onRematch={onRematch}
            onReplay={() => downloadReplay(game.exportReplay())}
            onLog={() => setSheet('log')}
          />
        )}
      </div>

      {wide && (
        <aside className="side-panel">
          <div className="panel-controls">
            <button className="btn small" onClick={onExit}>
              ← Menu
            </button>
            {human !== null && (
              <button className="btn small" onClick={game.undo} disabled={!game.canUndo}>
                ↶ Desfazer
              </button>
            )}
            <button className="btn small" onClick={() => game.setPaused((p) => !p)}>
              {game.paused ? '▶ Continuar' : '❚❚ Pausar'}
            </button>
            <select
              className="speed"
              value={game.speed}
              onChange={(e) => game.setSpeed(Number(e.target.value))}
              title="Velocidade do bot"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
            <button className="btn small" onClick={() => downloadReplay(game.exportReplay())} title="Salvar as ações como roteiro">
              ⤓ Replay
            </button>
          </div>
          <CardDetail state={state} uid={detailUid && state.cards[detailUid] ? detailUid : null} />
          {human !== null && manualAllowed(state, human) && pending?.kind !== 'manual' && (
            <ManualTools state={state} human={human} selected={selected} onDispatch={dispatch} onSelect={setSelected} />
          )}
          <LogPanel state={state} />
        </aside>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ faixa central

function CenterBand(props: {
  state: GameState;
  human: PlayerId | null;
  acting: PlayerId | null;
  mode: Mode;
  paused: boolean;
  canEnd: boolean;
  onEnd: () => void;
  onCancelMode: () => void;
  onTogglePause: () => void;
}) {
  const { state, human, mode, acting } = props;
  const b = state.battle;
  const mineTurn = human === null ? state.activePlayer === 0 : state.activePlayer === human;

  let middle: ReactNode = null;
  if (b) middle = <BattleInfo state={state} human={human} />;
  else if (mode?.kind === 'attack')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        Escolha o alvo do ataque <small>(toque aqui para cancelar)</small>
      </button>
    );
  else if (mode?.kind === 'don')
    middle = (
      <button className="hint-pill" onClick={props.onCancelMode}>
        Toque no Líder ou num Personagem para dar 1 DON!! <small>(toque aqui para concluir)</small>
      </button>
    );
  else if (props.paused) middle = <span className="hint-pill">Pausado</span>;
  else if (acting !== null && acting !== human && state.players[acting].isBot && state.phase === 'main')
    middle = (
      <span className="hint-pill thinking">
        {state.players[acting].name} está pensando<span className="dots" />
      </span>
    );
  else if (props.canEnd)
    middle = (
      <span className="hint-pill soft">
        {state.turn <= 2 ? 'Primeiro turno: sem ataques. ' : ''}Toque numa carta para agir ou arraste-a.
      </span>
    );

  return (
    <>
      <div className={['turn-chip', mineTurn ? 'mine' : 'theirs'].join(' ')}>
        <small>Turno</small>
        <b>{state.phase === 'mulligan' ? '—' : state.turn}</b>
      </div>
      <div className="band-middle">{middle}</div>
      {human !== null ? (
        <button className="end-turn" disabled={!props.canEnd} onClick={props.onEnd}>
          Encerrar
          <br />
          turno
        </button>
      ) : (
        <button className="end-turn" onClick={props.onTogglePause}>
          {props.paused ? '▶' : '❚❚'}
        </button>
      )}
    </>
  );
}

/** Poder do atacante contra o alvo, com o que falta para defender (como o "Dano previsto" do Pocket). */
function BattleInfo({ state, human }: { state: GameState; human: PlayerId | null }) {
  const b = state.battle!;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const defender = state.cards[b.target].owner;
  const hits = atk >= def;
  const need = atk - def + 1000;
  let status: string;
  if (human !== null && defender === human) status = hits ? `Faltam +${need} para defender` : 'Defendido!';
  else status = hits ? 'O ataque vai acertar' : `Faltam +${def - atk} para acertar`;
  return (
    <div className="battle-info">
      <div className="battle-row">
        <span className="pow atk">
          <em>{cardDef(state, b.attacker).name}</em>
          <b>{atk}</b>
        </span>
        <span className="vs">⚔</span>
        <span className="pow def">
          <em>{cardDef(state, b.target).name}</em>
          <b>{def}</b>
        </span>
      </div>
      <div className={['battle-status', hits ? 'hit' : 'safe'].join(' ')}>
        {b.blocked ? 'Bloqueado · ' : ''}
        {status}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ prompts

function Prompt(props: {
  state: GameState;
  human: PlayerId | null;
  picked: string[];
  onDispatch: (a: Action) => void;
  onCard: (uid: string) => void;
  highlight: (uid: string) => Highlight;
  onTools: () => void;
}) {
  const { state, human, picked, onDispatch } = props;
  const { lang } = useSettings();
  const pending = state.pending;
  if (state.phase === 'gameover' || !pending || human === null || pending.player !== human) return null;

  switch (pending.kind) {
    case 'mulligan': {
      const first = state.firstPlayer === human;
      return (
        <div className="modal-backdrop">
          <div className="modal-card mulligan">
            <div className="modal-kicker">{first ? 'Você jogará primeiro' : `${state.players[state.firstPlayer].name} jogará primeiro`}</div>
            <h2>Mão inicial</h2>
            <div className="mulligan-hand">
              {state.players[human].hand.map((uid, i) => (
                <div key={uid} className="deal" style={{ animationDelay: `${i * 70}ms` }}>
                  <CardView state={state} uid={uid} onClick={() => props.onCard(uid)} />
                </div>
              ))}
            </div>
            <p className="muted small">Toque numa carta para ler. Você pode trocar a mão uma única vez.</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: false })}>
                Manter mão
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: true })}>
                Trocar mão
              </button>
            </div>
          </div>
        </div>
      );
    }
    case 'selectTargets': {
      // Opções fora da mesa (topo do deck, descarte, Vida) aparecem dentro do prompt.
      const offBoard = pending.options.filter((u) => ['deck', 'trash', 'life'].includes(zoneOf(state, u) ?? ''));
      const confirm = (
        <div className="btn-row">
          {pending.min === 0 && (
            <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              Não escolher
            </button>
          )}
          <button
            className="btn primary"
            disabled={picked.length < pending.min}
            onClick={() => onDispatch({ type: 'choose', player: human, uids: picked })}
          >
            Confirmar {pending.max > 1 ? `(${picked.length}/${pending.max})` : ''}
          </button>
        </div>
      );
      const order = pending.ordered && picked.length > 0 && (
        <p className="muted small">Ordem: {picked.map((u, i) => `${i + 1}. ${cardDef(state, u).name}`).join(' → ')}</p>
      );
      const options = (
        <div className="prompt-options">
          {offBoard.map((uid) => (
            <CardView key={uid} state={state} uid={uid} highlight={props.highlight(uid)} onClick={() => props.onCard(uid)} />
          ))}
        </div>
      );
      if (offBoard.length === pending.options.length) {
        return (
          <div className="modal-backdrop">
            <div className="modal-card">
              <SourceLine state={state} uid={pending.source} />
              <h3>{pending.prompt}</h3>
              <p className="muted small">Toque nas cartas para escolher. Segure para ler.</p>
              {options}
              {order}
              {confirm}
            </div>
          </div>
        );
      }
      return (
        <PromptPill title={pending.prompt} subtitle={`Toque nas cartas destacadas (${picked.length}/${pending.max}).`}>
          {offBoard.length > 0 && options}
          {order}
          {confirm}
        </PromptPill>
      );
    }
    case 'block':
      return (
        <PromptPill title="Bloquear?" subtitle="Toque num Personagem com [Blocker] para receber o ataque.">
          <div className="btn-row">
            <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              Não bloquear
            </button>
          </div>
        </PromptPill>
      );
    case 'counter':
      return (
        <PromptPill title="Etapa de Counter" subtitle="Toque nas cartas da mão com Counter (ou eventos [Counter]) para aumentar o poder do alvo.">
          <div className="btn-row">
            <button className="btn" onClick={props.onTools}>
              ⚙
            </button>
            <button className="btn primary" onClick={() => onDispatch({ type: 'pass', player: human })}>
              Concluir counters
            </button>
          </div>
        </PromptPill>
      );
    case 'manual': {
      const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
      return (
        <PromptPill title={`⚙ Efeito manual: ${cardDef(state, pending.source).name}`} subtitle={text} clamp>
          <div className="btn-row">
            <button className="btn" onClick={props.onTools}>
              Ferramentas
            </button>
            <button className="btn primary" onClick={() => onDispatch({ type: 'manualDone', player: human })}>
              Concluir efeito
            </button>
          </div>
        </PromptPill>
      );
    }
    case 'trigger':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">[Trigger] revelado da Vida</div>
            <div className="modal-feature">
              <CardView state={state} uid={pending.card} />
            </div>
            <h3>{cardDef(state, pending.card).name}</h3>
            <p className="effect trigger">{cardText(cardDef(state, pending.card), lang).trigger}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                Ativar [Trigger]
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                Adicionar à mão
              </button>
            </div>
          </div>
        </div>
      );
    case 'option':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{pending.prompt}</h3>
            <div className="btn-col">
              {pending.options.map((label, index) => (
                <button
                  key={index}
                  className={`btn${index === 0 ? ' primary' : ''}`}
                  onClick={() => onDispatch({ type: 'option', player: human, index })}
                >
                  {lang === 'pt' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    case 'confirm':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{pending.prompt}</h3>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                Pagar e usar
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                Não usar
              </button>
            </div>
          </div>
        </div>
      );
  }
}

function SourceLine({ state, uid }: { state: GameState; uid: string }) {
  if (!state.cards[uid]) return null;
  return (
    <div className="source-line">
      <div className="source-thumb">
        <CardView state={state} uid={uid} />
      </div>
      <span>{cardDef(state, uid).name}</span>
    </div>
  );
}

function PromptPill({
  title,
  subtitle,
  clamp,
  children,
}: {
  title: string;
  subtitle?: string;
  clamp?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="prompt-pill">
      <div className="prompt-title">{title}</div>
      {subtitle && (
        <p className={['prompt-sub', clamp && !open ? 'clamp' : ''].join(' ')} onClick={() => setOpen((o) => !o)}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

function ManualPrompt({ state, onDone }: { state: GameState; onDone: () => void }) {
  const { lang } = useSettings();
  const pending = state.pending;
  if (pending?.kind !== 'manual') return null;
  const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
  return (
    <div className="manual-box">
      <div className="prompt-title">⚙ Efeito manual: {cardDef(state, pending.source).name}</div>
      <p className="effect">{text}</p>
      <p className="muted small">
        Ainda não é automático: aplique com as ferramentas abaixo (toque numa carta da mesa e depois em ⚙ para ver as opções
        dela) e depois conclua. Se não se aplicar, só conclua.
      </p>
      <button className="btn primary" onClick={onDone}>
        Concluir efeito
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ zoom da carta

function CardZoom(props: {
  state: GameState;
  uid: string;
  legal: Action[];
  canManual: boolean;
  onClose: () => void;
  onDispatch: (a: Action) => void;
  onAttackMode: (attacker: string) => void;
  onTools: () => void;
}) {
  const { state, uid, legal } = props;
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  const play = legal.find((a) => a.type === 'playCard' && a.uid === uid);
  const activates = legal.filter((a): a is Extract<Action, { type: 'activate' }> => a.type === 'activate' && a.uid === uid);
  const canAttack = legal.some((a) => a.type === 'attack' && a.attacker === uid);
  const attach = legal.find((a) => a.type === 'attachDon' && a.target === uid);
  const owner = state.cards[uid].owner;
  const hasActions = Boolean(play || activates.length || canAttack || attach || props.canManual);

  return (
    <div className="modal-backdrop zoom-backdrop" onClick={props.onClose}>
      <div className="zoom" onClick={(e) => e.stopPropagation()}>
        <button className="zoom-close" onClick={props.onClose} aria-label="Fechar">
          ✕
        </button>
        <div className="zoom-card">
          <CardView state={state} uid={uid} fc={loc?.fc} />
        </div>
        {hasActions && (
          <div className="zoom-actions">
            {play && (
              <button className="btn primary big" onClick={() => props.onDispatch(play)}>
                {def.category === 'event' ? 'Usar evento' : 'Jogar'} <span className="cost-chip">{def.cost}</span>
              </button>
            )}
            {canAttack && (
              <button className="btn attack big" onClick={() => props.onAttackMode(uid)}>
                ⚔ Atacar <span className="cost-chip">{getPower(state, uid)}</span>
              </button>
            )}
            {activates.map((a) => (
              <button key={a.ability} className="btn big" onClick={() => props.onDispatch(a)}>
                ✦ {def.abilities[a.ability].label ?? 'Ativar efeito'}
              </button>
            ))}
            {attach && (
              <button className="btn don big" onClick={() => props.onDispatch(attach)}>
                + 1 DON!! <small>({state.players[owner].donActive} ativos)</small>
              </button>
            )}
            {props.canManual && (
              <button className="btn small" onClick={props.onTools}>
                ⚙ Ferramentas manuais
              </button>
            )}
          </div>
        )}
        <div className="zoom-text">
          <CardTextInfo def={def} power={loc ? getPower(state, uid) : undefined} />
        </div>
      </div>
    </div>
  );
}

function CardDetail({ state, uid }: { state: GameState; uid: string | null }) {
  if (!uid) {
    return <div className="detail empty">Passe o mouse sobre uma carta para ver os detalhes. Clique para agir.</div>;
  }
  const def = cardDef(state, uid);
  const loc = locate(state, uid);
  return (
    <div className="detail">
      <div className="detail-card">
        <CardView state={state} uid={uid} fc={loc?.fc} />
      </div>
      <CardTextInfo def={def} power={loc ? getPower(state, uid) : undefined} />
    </div>
  );
}

// ------------------------------------------------------------------ folhas

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function LogPanel({ state }: { state: GameState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.log.length]);
  return (
    <div className="log" ref={ref}>
      {state.log.map((e, i) => (
        <div key={i} className={['log-line', e.player === null ? '' : `p${e.player}`, e.text.startsWith('—') ? 'turn' : ''].join(' ')}>
          {e.text}
        </div>
      ))}
    </div>
  );
}

export function downloadReplay(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gumgum-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
