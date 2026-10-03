import { type Action, cardDef, type GameState, type PlayerId } from '@gumgum/engine';
import type { ReactNode } from 'react';
import { CardView } from './CardView';

interface Props {
  state: GameState;
  human: PlayerId | null;
  actions: Action[];
  onExit: () => void;
  onRematch?: () => void;
  /** Texto do botão de revanche (online: "Pedir revanche"). */
  rematchLabel?: string;
  onReplay: () => void;
  onLog: () => void;
  /** Informações a mais (online: recompensa da ranqueada). */
  extra?: ReactNode;
}

/** Resumo do fim da partida: resultado, carta do jogo e números. */
export function GameResult({ state, human, actions, onExit, onRematch, rematchLabel, onReplay, onLog, extra }: Props) {
  const me: PlayerId = human ?? state.winner ?? 0;
  const opp = (me === 0 ? 1 : 0) as PlayerId;
  const won = state.winner === me;
  const title = human === null ? `${state.players[state.winner ?? 0].name} venceu!` : won ? 'Vitória!' : 'Derrota';

  const mine = actions.filter((a) => a.player === me);
  const attacks = mine.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
  const played = mine.filter((a) => a.type === 'playCard').length;

  // Carta do jogo: a que mais atacou (empate: a mais recente); sem ataques, o Líder.
  const count = new Map<string, number>();
  for (const a of attacks) count.set(a.attacker, (count.get(a.attacker) ?? 0) + 1);
  let mvp = state.players[me].leader.uid;
  let best = 0;
  for (const [uid, n] of count) {
    if (n >= best) {
      best = n;
      mvp = uid;
    }
  }

  const oppLeader = cardDef(state, state.players[opp].leader.uid);
  const lifeOf = (p: PlayerId) => {
    const ps = state.players[p];
    const max = Math.max(cardDef(state, ps.leader.uid).life ?? 0, ps.life.length);
    return { left: ps.life.length, max };
  };
  const myLife = lifeOf(me);
  const oppLife = lifeOf(opp);
  const pips = ({ left, max }: { left: number; max: number }) => (
    <span className="pips">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < left ? 'on' : ''}>
          {i < left ? i + 1 : ''}
        </span>
      ))}
    </span>
  );

  return (
    <div className={['result', won ? 'won' : 'lost'].join(' ')}>
      <div className="result-sky" />
      <header className="result-head">
        <div className="result-avatar">
          {oppLeader.imageUrl ? (
            <img src={oppLeader.imageUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span>{oppLeader.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="result-vs">
          vs. {state.players[opp].name} ({oppLeader.name})
        </div>
        <h1>{title}</h1>
      </header>

      <div className="result-body">
        <button className="btn small pill" onClick={onLog}>
          Histórico
        </button>
        <div className="mvp">
          <div className="laurel">
            <span className="crown">♛</span>
            <span>
              Carta
              <br />
              do jogo
            </span>
          </div>
          <div className="mvp-card">
            <CardView state={state} uid={mvp} />
          </div>
        </div>

        <dl className="stats">
          <dt>Ordem do turno</dt>
          <dd>{state.firstPlayer === me ? 'Primeiro a jogar' : 'Segundo a jogar'}</dd>
          <dt>Turnos jogados</dt>
          <dd>{state.turn}</dd>
          <dt>{human === null ? `Vida de ${state.players[me].name}` : 'Sua Vida'}</dt>
          <dd>{pips(myLife)}</dd>
          <dt>Vida do oponente</dt>
          <dd>{pips(oppLife)}</dd>
          <dt>Ataques</dt>
          <dd>{attacks.length}</dd>
          <dt>Cartas jogadas</dt>
          <dd>{played}</dd>
        </dl>
        {state.winReason && <p className="muted small result-reason">{state.winReason}</p>}
        {extra}

        <div className="result-actions">
          {onRematch && (
            <button className="btn primary big" onClick={onRematch}>
              {rematchLabel ?? 'Jogar de novo'}
            </button>
          )}
          <button className="btn big" onClick={onExit}>
            Voltar ao menu
          </button>
          <button className="btn small pill" onClick={onReplay}>
            ⤓ Baixar replay
          </button>
        </div>
      </div>
    </div>
  );
}
