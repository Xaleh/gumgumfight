import {
  type Action,
  cardDef,
  type GameState,
  type ManualOp,
  type ManualZone,
  opponent,
  type PlayerId,
  zoneOf,
} from '@gumgum/engine';
import { useState } from 'react';
import { CardView } from './CardView';

const ZONE_NAME: Record<string, string> = {
  hand: 'mão',
  deck: 'deck',
  trash: 'descarte',
  life: 'Vida',
  leader: 'Líder',
  character: 'campo',
  stage: 'Stage',
};

interface Props {
  state: GameState;
  human: PlayerId;
  selected: string | null;
  onDispatch: (a: Action) => void;
  onSelect: (uid: string | null) => void;
  /**
   * Online: o servidor só mostra o topo do deck depois de um pedido (que fica no log
   * do oponente). Valor = quantas cartas o servidor está mostrando agora.
   */
  peek?: number;
}

/**
 * Ferramentas para aplicar à mão efeitos ainda não automatizados.
 * Cada botão vira uma ação 'manual' validada pelo motor (nenhuma carta some ou duplica).
 */
export function ManualTools({ state, human, selected, onDispatch, onSelect, peek }: Props) {
  const [viewer, setViewer] = useState<null | 'deck' | 'trash' | 'oppTrash'>(null);
  const [deckCount, setDeckCount] = useState(5);
  const me = state.players[human];
  const opp = state.players[opponent(human)];
  const run = (op: ManualOp) => onDispatch({ type: 'manual', player: human, op });
  const move = (uid: string, to: ManualZone, rested?: boolean) => run({ op: 'move', uid, to, rested });
  const showTop = (n: number) => {
    setDeckCount(n);
    setViewer('deck');
    if (peek !== undefined && n > peek) run({ op: 'peek', count: n });
  };

  const zone = selected ? zoneOf(state, selected) : null;
  const mine = selected ? state.cards[selected].owner === human : false;
  const def = selected ? cardDef(state, selected) : null;
  const onField = zone === 'character' || zone === 'leader' || zone === 'stage';
  const rested = selected && onField ? fieldRested(state, selected) : false;
  // Na etapa de Counter, a carta da mão só vale como Counter (o motor recusa jogá-la no campo).
  const counterStep = state.pending?.kind === 'counter' && zone === 'hand';

  return (
    <div className="actions manual-tools">
      <div className="actions-title">⚙ Ferramentas manuais</div>

      {selected && def && zone && (
        <div className="tool-group">
          <div className="tool-label">
            {def.name} · {ZONE_NAME[zone]}
            {mine ? '' : ' do oponente'}
          </div>
          <div className="tool-buttons">
            {zone === 'character' && <button className="btn small danger" onClick={() => run({ op: 'ko', uid: selected })}>K.O.</button>}
            {onField && (
              <button className="btn small" onClick={() => run({ op: 'setRested', uid: selected, rested: !rested })}>
                {rested ? 'Desvirar' : 'Virar'}
              </button>
            )}
            {(zone === 'character' || zone === 'leader') && (
              <>
                <button className="btn small" onClick={() => run({ op: 'power', uid: selected, amount: 1000, duration: 'turn' })}>+1000</button>
                <button className="btn small" onClick={() => run({ op: 'power', uid: selected, amount: -1000, duration: 'turn' })}>−1000</button>
                {state.battle && (
                  <button className="btn small" onClick={() => run({ op: 'power', uid: selected, amount: 1000, duration: 'battle' })}>
                    +1000 (batalha)
                  </button>
                )}
              </>
            )}
            {mine && (zone === 'character' || zone === 'leader') && (
              <>
                <button className="btn small" disabled={!me.donActive} onClick={() => run({ op: 'donGive', uid: selected, from: 'active' })}>
                  +DON!! ativo
                </button>
                <button className="btn small" disabled={!me.donRested} onClick={() => run({ op: 'donGive', uid: selected, from: 'rested' })}>
                  +DON!! virado
                </button>
              </>
            )}
            {zone !== 'leader' && (mine || onField || zone === 'life') && (
              <>
                {zone !== 'hand' && <button className="btn small" onClick={() => move(selected, 'hand')}>→ Mão</button>}
                {zone !== 'trash' && <button className="btn small" onClick={() => move(selected, 'trash')}>→ Descarte</button>}
                <button className="btn small" onClick={() => move(selected, 'deckBottom')}>→ Fundo do deck</button>
                <button className="btn small" onClick={() => move(selected, 'deckTop')}>→ Topo do deck</button>
                {zone !== 'life' && <button className="btn small" onClick={() => move(selected, 'life')}>→ Vida</button>}
                {counterStep && (def.category === 'character' || def.category === 'stage') && (
                  <span className="muted small">Na etapa de Counter, use “Usar como Counter” (a carta vai para o descarte).</span>
                )}
                {def.category === 'character' && zone !== 'character' && mine && !counterStep && (
                  <>
                    <button className="btn small primary" onClick={() => move(selected, 'character')}>Jogar no campo</button>
                    <button className="btn small" onClick={() => move(selected, 'character', true)}>Jogar virado</button>
                  </>
                )}
                {def.category === 'stage' && zone !== 'stage' && mine && !counterStep && (
                  <button className="btn small primary" onClick={() => move(selected, 'stage')}>Jogar Stage</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="tool-group">
        <div className="tool-label">Cartas</div>
        <div className="tool-buttons">
          <button className="btn small" onClick={() => run({ op: 'draw', count: 1 })}>Comprar 1</button>
          <button className="btn small" onClick={() => showTop(deckCount)}>Ver topo do deck</button>
          <button className="btn small" onClick={() => setViewer('trash')}>Ver meu descarte ({me.trash.length})</button>
          <button className="btn small" onClick={() => setViewer('oppTrash')}>Descarte do oponente ({opp.trash.length})</button>
          <button className="btn small" onClick={() => run({ op: 'shuffle' })}>Embaralhar deck</button>
        </div>
      </div>

      <div className="tool-group">
        <div className="tool-label">Vida</div>
        <div className="tool-buttons">
          <button className="btn small" disabled={!me.life.length} onClick={() => move(me.life[me.life.length - 1], 'hand')}>
            Minha Vida (topo) → mão
          </button>
          <button className="btn small" disabled={!me.life.length} onClick={() => move(me.life[me.life.length - 1], 'trash')}>
            Minha Vida (topo) → descarte
          </button>
          <button className="btn small" disabled={!opp.life.length} onClick={() => move(opp.life[opp.life.length - 1], 'trash')}>
            Vida do oponente (topo) → descarte
          </button>
          <button className="btn small" disabled={!opp.life.length} onClick={() => move(opp.life[opp.life.length - 1], 'hand')}>
            Vida do oponente (topo) → mão dele
          </button>
        </div>
      </div>

      <div className="tool-group">
        <div className="tool-label">DON!!</div>
        <div className="tool-buttons">
          <button className="btn small" disabled={!me.donDeck} onClick={() => run({ op: 'donFromDeck', count: 1, rested: false })}>+1 ativo</button>
          <button className="btn small" disabled={!me.donDeck} onClick={() => run({ op: 'donFromDeck', count: 1, rested: true })}>+1 virado</button>
          <button className="btn small" onClick={() => run({ op: 'donToDeck', count: 1 })}>DON!! −1</button>
          <button className="btn small" disabled={!me.donRested} onClick={() => run({ op: 'donSetState', player: human, rested: false, count: 1 })}>
            Desvirar 1 meu
          </button>
          <button className="btn small" disabled={!opp.donActive} onClick={() => run({ op: 'donSetState', player: opp.id, rested: true, count: 1 })}>
            Virar 1 do oponente
          </button>
        </div>
      </div>

      {viewer && (
        <div className="overlay" onClick={() => setViewer(null)}>
          <div className="overlay-box modal viewer" onClick={(e) => e.stopPropagation()}>
            <h3>
              {viewer === 'deck' ? 'Topo do seu deck' : viewer === 'trash' ? 'Seu descarte' : 'Descarte do oponente'}
            </h3>
            {viewer === 'deck' && (
              <div className="btn-row viewer-count">
                {[1, 3, 5, 10].map((n) => (
                  <button key={n} className={['btn small', n === deckCount ? 'primary' : ''].join(' ')} onClick={() => showTop(n)}>
                    {n}
                  </button>
                ))}
                <span className="muted small">cartas do topo (a primeira é o topo)</span>
              </div>
            )}
            <div className="viewer-list">
              {(viewer === 'deck' ? me.deck.slice(0, deckCount) : viewer === 'trash' ? [...me.trash].reverse() : [...opp.trash].reverse()).map(
                (uid) => (
                  <div key={uid} className="viewer-item">
                    <CardView state={state} uid={uid} />
                    {viewer !== 'oppTrash' && (
                      <div className="viewer-actions">
                        <button className="btn small" onClick={() => move(uid, 'hand')}>Mão</button>
                        {cardDef(state, uid).category === 'character' && (
                          <button className="btn small primary" onClick={() => move(uid, 'character')}>Campo</button>
                        )}
                        {viewer !== 'trash' && <button className="btn small" onClick={() => move(uid, 'trash')}>Descarte</button>}
                        <button className="btn small" onClick={() => move(uid, 'deckBottom')}>Fundo</button>
                        {viewer !== 'deck' && <button className="btn small" onClick={() => move(uid, 'deckTop')}>Topo</button>}
                        <button className="btn small" onClick={() => move(uid, 'life')}>Vida</button>
                        <button
                          className="btn small"
                          onClick={() => {
                            onSelect(uid);
                            setViewer(null);
                          }}
                        >
                          Selecionar
                        </button>
                      </div>
                    )}
                  </div>
                ),
              )}
              {(viewer === 'deck' ? me.deck : viewer === 'trash' ? me.trash : opp.trash).length === 0 && (
                <div className="muted">Vazio.</div>
              )}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => setViewer(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fieldRested(state: GameState, uid: string): boolean {
  for (const ps of state.players) {
    if (ps.leader.uid === uid) return ps.leader.rested;
    if (ps.stage?.uid === uid) return ps.stage.rested;
    const c = ps.characters.find((x) => x.uid === uid);
    if (c) return c.rested;
  }
  return false;
}
