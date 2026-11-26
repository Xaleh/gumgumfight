// Os painéis ao lado da mesa no desktop: o treinador da lição, o histórico da transmissão, o painel do Streamer
// (histórico, partidas, decklist) e o de quem joga (histórico, a própria decklist, o treinador do bot).

import type { CardData, CardDef } from '@gumgum/engine';
import type { CoachEntry, LiveRoom, RoomDecks } from '../../api';
import type { EffectiveLayout } from '../../game/boardLayout';
import type { CoachMark } from '../../game/botReport';
import { useT } from '../../i18n';
import { CoachPanel } from '../CoachPanel';
import type { TableGame, TableKind, TableTutorial } from '../GameScreen';
import { DeckListPanel, DeckPanel, MatchesPanel } from '../StreamerPanel';
import { CardDetail } from './CardZoom';
import { LogPanel } from './LogPanel';
import type { Panel } from './shared';
import type { ExitTo } from './Table';

export function TableSidePanels({
  game,
  kind,
  wide,
  tutorial,
  broadcast,
  streamer,
  playerPanel,
  panel,
  shownPanel,
  setPanel,
  spectator,
  onExit,
  exitTo,
  bare,
  callJudge,
  loadOwnDeck,
  detailUid,
  setLogCard,
  onLogSearching,
  setDeckCard,
  coachOn,
  coachEntries,
  marks,
  coachReport,
  toggleMark,
  updateMark,
  wideBoard,
  layout,
}: {
  game: TableGame;
  kind: TableKind;
  wide: boolean;
  tutorial?: TableTutorial;
  broadcast: boolean;
  /** Visão do Streamer; `playerPanel`: quem joga no desktop. */
  streamer: boolean;
  playerPanel: boolean;
  /** O painel escolhido e o que está na tela agora. */
  panel: Panel;
  shownPanel: Panel;
  setPanel: (p: Panel) => void;
  spectator?: { roomId?: string; onSwitchRoom?: (room: LiveRoom) => void };
  onExit: () => void;
  exitTo: ExitTo;
  /** Replay embutido sem os botões de sair e de baixar. */
  bare: boolean;
  callJudge?: () => void;
  /** O deck de quem joga, para a decklist do painel. */
  loadOwnDeck?: () => Promise<RoomDecks>;
  /** A carta sob o mouse (ou a escolhida), para o detalhe. */
  detailUid: string | null;
  setLogCard: (card: CardDef | null) => void;
  onLogSearching: (on: boolean) => void;
  setDeckCard: (card: CardData | null) => void;
  /** Painel do treinador do Bot do Time. */
  coachOn: boolean;
  coachEntries: CoachEntry[];
  marks: CoachMark[];
  coachReport: string;
  toggleMark: (index: number, step: number) => void;
  updateMark: (index: number, step: number, patch: Partial<Pick<CoachMark, 'alt' | 'why'>>) => void;
  /** Mesa larga (layout por blocos) e o layout em vigor. */
  wideBoard: boolean;
  layout: EffectiveLayout;
}) {
  const { state, human } = game;
  const t = useT();
  const isOnline = kind === 'online';
  const sandbox = kind === 'sandbox';
  const replay = game.replay;
  const over = state.phase === 'gameover';
  const toTournament = exitTo === 'tournament';
  return (
    <>
      {wide && tutorial && (
        <aside className="side-panel lesson-panel">
          <div className="panel-controls">
            <button className="btn small" onClick={onExit}>
              {tutorial.exitLabel ?? t('tutorial.exitLesson')}
            </button>
          </div>
          {tutorial.coach}
          <CardDetail state={state} uid={detailUid} />
        </aside>
      )}
      {wide && broadcast && (
        <aside className="side-panel">
          <LogPanel state={state} />
        </aside>
      )}
      {streamer && panel && (
        <aside className="side-panel tabbed-panel streamer-panel" aria-label={t('game.panelLabel')}>
          <div className="panel-tabs">
            <div className="seg small" role="tablist">
              <button type="button" role="tab" aria-selected={panel === 'log'} className={panel === 'log' ? 'on' : ''} onClick={() => setPanel('log')}>
                {t('game.log')}
              </button>
              {spectator?.onSwitchRoom && (
                <button type="button" role="tab" aria-selected={panel === 'matches'} className={panel === 'matches' ? 'on' : ''} onClick={() => setPanel('matches')}>
                  {t('game.matches')}
                </button>
              )}
              {spectator?.roomId && (
                <button type="button" role="tab" aria-selected={panel === 'deck'} className={panel === 'deck' ? 'on' : ''} onClick={() => setPanel('deck')}>
                  {t('game.decklist')}
                </button>
              )}
            </div>
            <button className="zoom-close static" onClick={() => setPanel(null)} aria-label={t('game.closePanel')} title={t('game.closePanel')}>
              ✕
            </button>
          </div>
          {panel === 'log' && <LogPanel state={state} onCardZoom={setLogCard} onSearching={onLogSearching} />}
          {panel === 'matches' && spectator?.onSwitchRoom && <MatchesPanel currentId={spectator.roomId ?? null} onWatch={spectator.onSwitchRoom} />}
          {panel === 'deck' && spectator?.roomId && <DeckPanel roomId={spectator.roomId} onZoom={setDeckCard} />}
        </aside>
      )}
      {playerPanel && shownPanel && (
        <aside className="side-panel tabbed-panel player-panel" aria-label={t('game.panelLabel')}>
          <div className="panel-tabs">
            <div className="seg small" role="tablist">
              <button type="button" role="tab" aria-selected={panel !== 'deck' && panel !== 'coach'} className={panel !== 'deck' && panel !== 'coach' ? 'on' : ''} onClick={() => setPanel('log')}>
                {t('game.log')}
              </button>
              {loadOwnDeck && (
                <button type="button" role="tab" aria-selected={panel === 'deck'} className={panel === 'deck' ? 'on' : ''} onClick={() => setPanel('deck')}>
                  {t('game.decklist')}
                </button>
              )}
              {coachOn && (
                <button type="button" role="tab" aria-selected={panel === 'coach'} className={panel === 'coach' ? 'on' : ''} onClick={() => setPanel('coach')}>
                  {t('coach.panel')}
                  {coachEntries.length > 0 && <span className="dk-count">{coachEntries.length}</span>}
                </button>
              )}
            </div>
            <button className="zoom-close static" onClick={() => setPanel(null)} aria-label={t('game.closePanel')} title={t('game.closePanelFull')}>
              ✕
            </button>
          </div>
          {!bare && (
            <div className="panel-controls">
              <button className="btn small" onClick={onExit}>
                {sandbox ? t('sandbox.backToEditor') : toTournament ? t('game.sideTournament') : exitTo === 'back' ? t('game.sideBack') : t('game.sideMenu')}
              </button>
              {callJudge && (
                <button className="btn small judge-call" onClick={callJudge}>
                  {t('judge.call')}
                </button>
              )}
              {human !== null && !isOnline && (
                <button className="btn small" onClick={game.undo} disabled={!game.canUndo}>
                  {t('game.undo')}
                </button>
              )}
              {/* A velocidade do bot fica só no menu da partida. */}
              {!isOnline && !replay && (
                <button className="btn small" onClick={() => game.setPaused((p) => !p)}>
                  {game.paused ? t('game.resume') : t('game.pause')}
                </button>
              )}
              {(over || replay) && (
                <button className="btn small" onClick={game.downloadReplay} title={t('game.replayTitle')}>
                  {t('game.replayBtn')}
                </button>
              )}
            </div>
          )}
          {panel === 'deck' && loadOwnDeck ? (
            <DeckListPanel load={loadOwnDeck} onZoom={setDeckCard} />
          ) : panel === 'coach' && coachOn ? (
            <CoachPanel state={state} entries={coachEntries} marks={marks} report={coachReport} onToggle={toggleMark} onUpdate={updateMark} />
          ) : (
            <>
              {(!wideBoard || (layout.hover.show && layout.hover.position === 'panel')) && <CardDetail state={state} uid={detailUid} />}
              {(!wideBoard || (layout.log.show && layout.log.position === 'panel')) && <LogPanel state={state} fresh={replay?.logFrom} onCardZoom={setLogCard} onSearching={onLogSearching} />}
            </>
          )}
        </aside>
      )}
    </>
  );
}
