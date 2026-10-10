import { type Action, cardDef, type GameState, type PlayerId } from '@gumgum/engine';
import { Fragment, type ReactNode } from 'react';
import { useT } from '../i18n';
import { CardView } from './CardView';

interface Props {
  state: GameState;
  human: PlayerId | null;
  actions: Action[];
  onExit: () => void;
  /** Texto do botão de saída (padrão "Voltar ao menu"). */
  exitLabel?: string;
  onRematch?: () => void;
  /** Texto do botão de revanche (online: "Pedir revanche"). */
  rematchLabel?: string;
  onReplay: () => void;
  onLog: () => void;
  /** Replay: fecha o resumo para rever a partida (voltar ações). */
  onClose?: () => void;
  /** Informações a mais (online: recompensa da ranqueada). */
  extra?: ReactNode;
}

/** Resumo do fim da partida: resultado, carta do jogo e números. */
export function GameResult({ state, human, actions, onExit, exitLabel, onRematch, rematchLabel, onReplay, onLog, onClose, extra }: Props) {
  const t = useT();
  const me: PlayerId = human ?? state.winner ?? 0;
  const opp = (me === 0 ? 1 : 0) as PlayerId;
  const won = state.winner === me;
  // Sem vencedor: os dois perderam juntos (9-2-1) ou houve um laço infinito (11-1).
  const draw = state.winner === null;
  const title = draw
    ? t('result.draw')
    : human === null
      ? t('result.playerWon', { name: state.players[state.winner ?? 0].name })
      : won
        ? t('result.victory')
        : t('result.defeat');

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
    <div className={['result', won ? 'won' : draw ? 'draw' : 'lost'].join(' ')}>
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
          {t('result.vs', { name: state.players[opp].name, leader: oppLeader.name })}
        </div>
        <h1>{title}</h1>
      </header>

      <div className="result-body">
        <button className="btn small pill" onClick={onLog}>
          {t('result.history')}
        </button>
        <div className="mvp">
          <div className="laurel">
            <span className="crown">♛</span>
            <span>
              {/* Duas linhas, como no troféu. */}
              {t('result.mvp')
                .split('\n')
                .map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 && <br />}
                    {line}
                  </Fragment>
                ))}
            </span>
          </div>
          <div className="mvp-card">
            <CardView state={state} uid={mvp} />
          </div>
        </div>

        <dl className="stats">
          <dt>{t('result.turnOrder')}</dt>
          <dd>{state.firstPlayer === me ? t('result.first') : t('result.second')}</dd>
          <dt>{t('result.turns')}</dt>
          <dd>{state.turn}</dd>
          <dt>{human === null ? t('result.lifeOf', { name: state.players[me].name }) : t('result.yourLife')}</dt>
          <dd>{pips(myLife)}</dd>
          <dt>{t('result.oppLife')}</dt>
          <dd>{pips(oppLife)}</dd>
          <dt>{t('result.attacks')}</dt>
          <dd>{attacks.length}</dd>
          <dt>{t('result.cardsPlayed')}</dt>
          <dd>{played}</dd>
        </dl>
        {state.winReason && <p className="muted small result-reason">{state.winReason}</p>}
        {extra}

        <div className="result-actions">
          {onRematch && (
            <button className="btn primary big" onClick={onRematch}>
              {rematchLabel ?? t('result.rematch')}
            </button>
          )}
          <button className="btn big" onClick={onExit}>
            {exitLabel ?? t('result.exit')}
          </button>
          {onClose && (
            <button className="btn big" onClick={onClose}>
              {t('result.review')}
            </button>
          )}
          <button className="btn small pill" onClick={onReplay}>
            {t('result.download')}
          </button>
        </div>
      </div>
    </div>
  );
}
