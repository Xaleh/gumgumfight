import {
  type Action,
  actingPlayer,
  cardDef,
  type GameState,
  getPower,
  legalActions,
  locate,
  manualAllowed,
  translateToPt,
  type PlayerId,
} from '@gumgum/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { type GameSetup, useGame } from '../game/useGame';
import { cardText, SettingsControls, useSettings } from '../settings';
import { Board } from './Board';
import { CardTextInfo } from './CardInfo';
import { CardView, type Highlight } from './CardView';
import { ManualTools } from './ManualTools';

type Mode = null | { kind: 'attack'; attacker: string } | { kind: 'don' };

export function GameScreen({ setup, onExit }: { setup: GameSetup; onExit: () => void }) {
  const game = useGame(setup);
  const { state, dispatch, human } = game;
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [showBotHand, setShowBotHand] = useState(setup.mode !== 'bot');

  const pending = state.pending;
  const myPending = pending && human !== null && pending.player === human ? pending : null;
  const legal = useMemo(() => (human !== null ? legalActions(state, human) : []), [state, human]);
  const myTurnIdle = human !== null && !pending && state.activePlayer === human && state.phase === 'main' && !state.stack.length;

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Registra o resultado no servidor quando a partida termina.
  const saved = useRef(false);
  useEffect(() => {
    if (state.phase === 'gameover' && !saved.current) {
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
  }, [state, setup]);

  const has = (pred: (a: Action) => boolean) => legal.some(pred);

  const highlight = (uid: string): Highlight => {
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
    if (uid === selected) return 'selected';
    if (myTurnIdle && has((a) => a.type === 'playCard' && a.uid === uid)) return 'playable';
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
      }
      setMode(null);
      return;
    }
    if (mode?.kind === 'don') {
      if (has((a) => a.type === 'attachDon' && a.target === uid)) dispatch({ type: 'attachDon', player: human!, target: uid });
      else setMode(null);
      return;
    }
    setSelected(uid === selected ? null : uid);
  };

  const onCardDouble = (uid: string) => {
    if (myTurnIdle && has((a) => a.type === 'playCard' && a.uid === uid)) {
      dispatch({ type: 'playCard', player: human!, uid });
      setSelected(null);
    }
  };

  const onDon = (player: PlayerId) => {
    if (player !== human || !myTurnIdle) return;
    setMode((m) => (m?.kind === 'don' ? null : has((a) => a.type === 'attachDon') ? { kind: 'don' } : null));
  };

  const acting = actingPlayer(state);
  const detailUid = hovered ?? selected ?? (pending?.kind === 'trigger' ? pending.card : null);

  return (
    <div className="game">
      <div className="board-wrap">
        <Board
          state={state}
          bottom={0}
          revealBottom
          revealTop={showBotHand}
          highlight={highlight}
          onCard={onCard}
          onCardDouble={onCardDouble}
          onHover={setHovered}
          onDon={onDon}
          donHighlight={(p) => p === human && (mode?.kind === 'don' || (myTurnIdle && state.players[p].donActive > 0))}
          center={
            <CenterBar
              state={state}
              human={human}
              mode={mode}
              canEnd={myTurnIdle}
              onEnd={() => dispatch({ type: 'endTurn', player: human! })}
              onCancelMode={() => setMode(null)}
            />
          }
        />
        <PromptBar
          state={state}
          human={human}
          acting={acting}
          picked={picked}
          onDispatch={dispatch}
        />
        {state.phase === 'gameover' && (
          <div className="overlay">
            <div className="overlay-box">
              <h2>{state.winner === human ? 'Vitória!' : human === null ? 'Fim de jogo' : 'Derrota'}</h2>
              <p>
                <b>{state.players[state.winner!].name}</b> venceu no turno {state.turn}.
              </p>
              <p className="muted">{state.winReason}</p>
              <div className="btn-row">
                <button className="btn primary" onClick={onExit}>
                  Voltar ao menu
                </button>
                <button className="btn" onClick={() => downloadReplay(game.exportReplay())}>
                  Baixar replay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

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
          {setup.mode === 'bot' && (
            <label className="check">
              <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> Ver mão do bot
            </label>
          )}
        </div>
        <SettingsControls compact />
        {game.error && (
          <div className="error" onClick={() => game.setError(null)}>
            {game.error}
          </div>
        )}
        <CardDetail state={state} uid={detailUid} />
        {myTurnIdle && selected && (
          <SelectedActions
            state={state}
            uid={selected}
            legal={legal}
            onDispatch={(a) => {
              dispatch(a);
              setSelected(null);
            }}
            onAttackMode={(attacker) => setMode({ kind: 'attack', attacker })}
          />
        )}
        {pending?.kind === 'manual' && pending.player === human && (
          <ManualPrompt state={state} onDone={() => dispatch({ type: 'manualDone', player: human })} />
        )}
        {human !== null && manualAllowed(state, human) && (
          <ManualTools state={state} human={human} selected={selected} onDispatch={dispatch} onSelect={setSelected} />
        )}
        <LogPanel state={state} />
      </aside>
    </div>
  );
}

function CenterBar(props: {
  state: GameState;
  human: PlayerId | null;
  mode: Mode;
  canEnd: boolean;
  onEnd: () => void;
  onCancelMode: () => void;
}) {
  const { state, mode } = props;
  const b = state.battle;
  const active = state.players[state.activePlayer];
  return (
    <>
      <div className="turn-info">
        {state.phase === 'mulligan' ? (
          <span>Preparação — mulligan</span>
        ) : (
          <span>
            Turno <b>{state.turn}</b> · vez de <b>{active.name}</b>
          </span>
        )}
      </div>
      <div className="battle-info">
        {b ? (
          <span className="battle">
            ⚔ {cardDef(state, b.attacker).name} <b>{getPower(state, b.attacker)}</b> → {cardDef(state, b.target).name}{' '}
            <b>{getPower(state, b.target)}</b>
            {b.blocked && <em> (bloqueado)</em>}
          </span>
        ) : mode?.kind === 'attack' ? (
          <span className="hint">
            Escolha o alvo do ataque (líder ou personagem virado) ·{' '}
            <a onClick={props.onCancelMode}>cancelar</a>
          </span>
        ) : mode?.kind === 'don' ? (
          <span className="hint">
            Clique no líder ou num personagem para anexar 1 DON!! · <a onClick={props.onCancelMode}>concluir</a>
          </span>
        ) : props.canEnd ? (
          <span className="hint">
            {state.turn <= 2 ? 'Primeiro turno: não é possível atacar. ' : ''}Selecione uma carta para ver as ações.
          </span>
        ) : null}
      </div>
      <button className="btn primary end-turn" disabled={!props.canEnd} onClick={props.onEnd}>
        Encerrar turno
      </button>
    </>
  );
}

function PromptBar(props: {
  state: GameState;
  human: PlayerId | null;
  acting: PlayerId | null;
  picked: string[];
  onDispatch: (a: Action) => void;
}) {
  const { state, human, picked, onDispatch } = props;
  const { lang } = useSettings();
  const pending = state.pending;
  if (state.phase === 'gameover') return null;
  if (props.acting !== null && props.acting !== human) {
    const who = state.players[props.acting];
    if (!who.isBot) return null;
    return <div className="prompt thinking">{who.name} está pensando…</div>;
  }
  if (!pending || human === null) return null;

  const b = state.battle;
  const battleLine = b ? (
    <div className="prompt-battle">
      {cardDef(state, b.attacker).name} ({getPower(state, b.attacker)}) ataca {cardDef(state, b.target).name} (
      {getPower(state, b.target)})
    </div>
  ) : null;

  switch (pending.kind) {
    case 'mulligan':
      return (
        <div className="prompt">
          <div className="prompt-title">Mão inicial</div>
          <p>Você pode trocar sua mão uma única vez (as 5 cartas voltam ao deck, que é embaralhado).</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: false })}>
              Manter mão
            </button>
            <button className="btn" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: true })}>
              Trocar mão
            </button>
          </div>
        </div>
      );
    case 'selectTargets':
      return (
        <div className="prompt">
          <div className="prompt-title">{pending.prompt}</div>
          <p className="muted">
            Clique nas cartas destacadas ({picked.length}/{pending.max}).
          </p>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={picked.length < pending.min}
              onClick={() => onDispatch({ type: 'choose', player: human, uids: picked })}
            >
              Confirmar
            </button>
            {pending.min === 0 && (
              <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
                Não escolher
              </button>
            )}
          </div>
        </div>
      );
    case 'block':
      return (
        <div className="prompt">
          <div className="prompt-title">Bloquear?</div>
          {battleLine}
          <p className="muted">Clique em um personagem com [Blocker] para redirecionar o ataque.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              Não bloquear
            </button>
          </div>
        </div>
      );
    case 'counter':
      return (
        <div className="prompt">
          <div className="prompt-title">Etapa de Counter</div>
          {battleLine}
          <p className="muted">Clique em cartas da mão com Counter (ou eventos [Counter]) para aumentar o poder do alvo.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => onDispatch({ type: 'pass', player: human })}>
              Concluir counters
            </button>
          </div>
        </div>
      );
    case 'manual':
      // Fica no painel lateral (ManualPrompt), para não cobrir a mão e o campo.
      return null;
    case 'trigger':
      return (
        <div className="prompt">
          <div className="prompt-title">[Trigger] revelado: {cardDef(state, pending.card).name}</div>
          <p className="muted">{cardText(cardDef(state, pending.card), lang).trigger}</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
              Ativar [Trigger]
            </button>
            <button className="btn" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
              Adicionar à mão
            </button>
          </div>
        </div>
      );
  }
}

function ManualPrompt({ state, onDone }: { state: GameState; onDone: () => void }) {
  const { lang } = useSettings();
  const pending = state.pending;
  if (pending?.kind !== 'manual') return null;
  const text = lang === 'pt' ? translateToPt(pending.text).text : pending.text;
  return (
    <div className="prompt manual in-panel">
      <div className="prompt-title">⚙ Efeito manual: {cardDef(state, pending.source).name}</div>
      <p className="effect">{text}</p>
      <p className="muted small">
        Ainda não é automático: aplique com as ferramentas abaixo (clique numa carta do tabuleiro para ver as opções dela)
        e depois conclua. Se não se aplicar, só conclua.
      </p>
      <button className="btn primary" onClick={onDone}>
        Concluir efeito
      </button>
    </div>
  );
}

function CardDetail({ state, uid }: { state: GameState; uid: string | null }) {
  if (!uid) {
    return (
      <div className="detail empty">
        Passe o mouse sobre uma carta para ver os detalhes.
      </div>
    );
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

function SelectedActions(props: {
  state: GameState;
  uid: string;
  legal: Action[];
  onDispatch: (a: Action) => void;
  onAttackMode: (attacker: string) => void;
}) {
  const { state, uid, legal } = props;
  const def = cardDef(state, uid);
  const play = legal.find((a) => a.type === 'playCard' && a.uid === uid);
  const activates = legal.filter((a): a is Extract<Action, { type: 'activate' }> => a.type === 'activate' && a.uid === uid);
  const canAttack = legal.some((a) => a.type === 'attack' && a.attacker === uid);
  const attach = legal.find((a) => a.type === 'attachDon' && a.target === uid);
  if (!play && !activates.length && !canAttack && !attach) return null;
  return (
    <div className="actions">
      <div className="actions-title">Ações: {def.name}</div>
      {play && (
        <button className="btn primary" onClick={() => props.onDispatch(play)}>
          Jogar (custo {def.cost})
        </button>
      )}
      {canAttack && (
        <button className="btn danger" onClick={() => props.onAttackMode(uid)}>
          ⚔ Atacar
        </button>
      )}
      {activates.map((a) => (
        <button key={a.ability} className="btn" onClick={() => props.onDispatch(a)}>
          ✦ {def.abilities[a.ability].label ?? 'Ativar efeito'}
        </button>
      ))}
      {attach && (
        <button className="btn" onClick={() => props.onDispatch(attach)}>
          + Anexar 1 DON!!
        </button>
      )}
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

function downloadReplay(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gumgum-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
