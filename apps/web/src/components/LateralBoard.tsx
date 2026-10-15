import { cardDef, type GameState, MAX_CHARACTERS, type PlayerId } from '@gumgum/engine';
import { type ReactNode, useState } from 'react';
import { useT } from '../i18n';
import { type BoardHandlers, FieldCard, MiniHand, PlayerBanner, vars } from './Board';
import { CardBack, CardView } from './CardView';

/**
 * Mesa lateral da visão do Streamer, como a câmera de cima das transmissões de loja: os jogadores um
 * de cada lado da tela (o da esquerda é o ponto de vista; o da direita é o mesmo bloco girado 180°,
 * com as cartas de cabeça para baixo), cada playmat girado 90° e a mesa em leve perspectiva.
 *
 * Cada lado, da borda para o centro: a cost area (deck de DON!! deitado, os DON!! semi-empilhados e o
 * descarte no canto), a coluna do Líder (Vida deitada no alto, Líder, Stage e o deck no fim da mesa) e
 * a coluna dos Personagens, encostada no meio. As mãos ficam fora da mesa, nas linhas do HUD
 * (minimizadas) e nos leques das bordas (abertas).
 */
export interface LateralBoardProps extends BoardHandlers {
  state: GameState;
  /** Jogador da esquerda (o ponto de vista); o outro fica à direita. */
  left: PlayerId;
  /** Botões do canto (menu, histórico) e as etiquetas de quem assiste: na linha de cima do HUD. */
  corner: ReactNode;
  /** Faixa central (turno, batalha, mensagens), na vertical. */
  center: ReactNode;
  bannerExtra?: (player: PlayerId) => ReactNode;
  miniHands: { open: PlayerId | null; canOpen: boolean; onToggle: (player: PlayerId) => void };
}

export function LateralBoard({ state, left, corner, center, bannerExtra, miniHands, ...h }: LateralBoardProps) {
  const right = (left === 0 ? 1 : 0) as PlayerId;
  const mini = (player: PlayerId, position: 'top' | 'bottom') => (
    <MiniHand state={state} player={player} position={position} open={miniHands.open === player} canOpen={miniHands.canOpen} onToggle={() => miniHands.onToggle(player)} />
  );
  return (
    <div className="mat lateral">
      <div className="lat-hud top">
        <div className="corner">{corner}</div>
        <span className="lat-spacer" />
        {mini(right, 'top')}
        <DonStats state={state} player={right} />
        <PlayerBanner state={state} player={right} align="right" extra={bannerExtra?.(right)} />
      </div>
      <div className="lat-scene">
        <div className="lat-table" data-drop="field" data-anchor="arena">
          <LateralHalf state={state} player={left} side="left" {...h} />
          <div className="lat-center" data-drop="field">
            {center}
          </div>
          <LateralHalf state={state} player={right} side="right" {...h} />
        </div>
      </div>
      <div className="lat-hud bottom">
        <PlayerBanner state={state} player={left} align="left" extra={bannerExtra?.(left)} />
        <DonStats state={state} player={left} />
        {mini(left, 'bottom')}
        <span className="lat-spacer" />
      </div>
    </div>
  );
}

/** Contadores de DON!! (deck, ativos, virados, anexados), nas linhas do HUD. */
export function DonStats({ state, player }: { state: GameState; player: PlayerId }) {
  const t = useT();
  const ps = state.players[player];
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  return (
    <dl className="don-stats" aria-label="DON!!">
      <div>
        <dt>{t('board.donDeck')}</dt>
        <dd>{ps.donDeck}</dd>
      </div>
      <div className="act">
        <dt>{t('board.donActive')}</dt>
        <dd>{ps.donActive}</dd>
      </div>
      <div className="rest">
        <dt>{t('board.donRested')}</dt>
        <dd>{ps.donRested}</dd>
      </div>
      <div className="att">
        <dt>{t('board.donAttached')}</dt>
        <dd>{attached}</dd>
      </div>
    </dl>
  );
}

/** Quantas cartas do descarte aparecem no semi-empilhamento aberto (as mais recentes). */
const TRASH_SPREAD = 5;

function LateralHalf({ state, player, side, ...h }: BoardHandlers & { state: GameState; player: PlayerId; side: 'left' | 'right' }) {
  const t = useT();
  const ps = state.players[player];
  const isActive = state.activePlayer === player && state.phase === 'main';
  const maxLife = Math.max(cardDef(state, ps.leader.uid).life ?? 0, ps.life.length);
  const dons = [...Array.from({ length: ps.donActive }, () => false), ...Array.from({ length: ps.donRested }, () => true)];
  const attached = ps.leader.don + ps.characters.reduce((n, c) => n + c.don, 0) + (ps.stage?.don ?? 0);
  /** Descarte aberto: as últimas cartas semi-empilhadas a partir do canto (clicar numa amplia). */
  const [spread, setSpread] = useState(false);
  const shown = spread ? ps.trash.slice(-TRASH_SPREAD) : ps.trash.slice(-1);
  const slots = Array.from({ length: MAX_CHARACTERS }, (_, i) => ps.characters[i] ?? null);
  const label = (text: string) => <span className="lat-label">{text}</span>;
  return (
    <section className={['lat-half', side, isActive ? 'active-side' : ''].join(' ')} data-drop={side === 'left' ? 'field' : undefined}>
      <div className="lat-cost">
        <div
          className="lat-zone lat-dondeck"
          data-anchor={`dondeck-${player}`}
          title={t('board.donTitle', { deck: ps.donDeck, active: ps.donActive, rested: ps.donRested, attached })}
        >
          <span className={['lat-donback', ps.donDeck > 0 ? '' : 'empty'].join(' ')} />
          <span className="pile-count">{ps.donDeck}</span>
          {label(t('board.area.cost'))}
        </div>
        <div className="lat-dons" style={vars({ '--n': Math.max(dons.length, 1) })} data-anchor={`don-${player}`}>
          {dons.map((rested, i) => (
            <span key={i} className={['lat-don', rested ? 'rested' : 'active'].join(' ')} style={vars({ '--i': i })}>
              <span className="don-card" />
            </span>
          ))}
        </div>
        <div className={['lat-zone', 'lat-trash', spread ? 'spread' : ''].join(' ')} data-anchor={`trash-${player}`} style={vars({ '--n': Math.max(shown.length, 1) })}>
          {shown.length === 0 && <div className="slot-empty">{t('board.trashSlot')}</div>}
          {shown.map((uid, i) => (
            <div
              key={uid}
              className="lat-trash-card"
              style={vars({ '--i': i, '--k': shown.length - 1 - i })}
              onClick={() => (spread ? h.onCard(uid) : setSpread(true))}
              title={spread ? undefined : t('board.trashSpreadTitle')}
            >
              <CardView state={state} uid={uid} onHover={h.onHover} />
            </div>
          ))}
          <button type="button" className="pile-count clickable" onClick={() => h.onTrash(player)} title={t('board.trashTitle', { n: ps.trash.length })}>
            {ps.trash.length}
          </button>
          {spread && (
            <button type="button" className="lat-trash-close" onClick={() => setSpread(false)} aria-label={t('common.close')}>
              ✕
            </button>
          )}
          {label(t('board.area.trash'))}
        </div>
      </div>

      <div className="lat-life" style={vars({ '--n': Math.max(ps.life.length, 1) })} title={t('board.lifeTitle', { n: ps.life.length })}>
        <div className="lat-life-stack" key={ps.life.length} data-anchor={`life-${player}`}>
          {ps.life.map((uid, i) => {
            // Vida virada para cima é pública (3-10-2-1): mostra a carta.
            const faceUp = ps.lifeFaceUp?.includes(uid);
            return (
              <div key={uid} className={['lat-life-card', faceUp ? 'face-up' : ''].join(' ')} style={vars({ '--i': i })}>
                {faceUp ? <CardView state={state} uid={uid} onHover={h.onHover} /> : <CardBack />}
              </div>
            );
          })}
        </div>
        <span className={['life-count', ps.life.length === 0 ? 'zero' : ''].join(' ')}>
          ♥ {ps.life.length}
          <small>/{maxLife}</small>
        </span>
        {label(t('board.area.life'))}
      </div>

      <div className="lat-mid">
        <div className="lat-leader-block">
          <div className={['lat-zone', 'lat-leader', isActive ? 'active' : ''].join(' ')}>
            <FieldCard state={state} uid={ps.leader.uid} fc={ps.leader} h={h} />
            {label(t('board.area.leader'))}
          </div>
          <div className="lat-zone lat-stage">
            {ps.stage ? <FieldCard state={state} uid={ps.stage.uid} fc={ps.stage} h={h} /> : <div className="slot-empty">{t('board.stageSlot')}</div>}
            {label(t('board.area.stage'))}
          </div>
        </div>
        <div className="lat-zone lat-deck" data-anchor={`deck-${player}`} title={t('board.deckTitle', { n: ps.deck.length })}>
          <div className="lat-side">
            <CardBack />
          </div>
          <span className="pile-count">{ps.deck.length}</span>
          {label(t('board.area.deck'))}
        </div>
      </div>

      <div className="lat-chars">
        {slots.map((fc, i) => (
          <div key={fc?.uid ?? `empty${i}`} className="lat-slot">
            {fc ? <FieldCard state={state} uid={fc.uid} fc={fc} h={h} /> : <div className="slot-empty" />}
          </div>
        ))}
        {label(t('board.area.character'))}
      </div>
    </section>
  );
}
