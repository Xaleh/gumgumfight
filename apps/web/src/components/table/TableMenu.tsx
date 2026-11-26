// O menu da partida (a folha que o botão do canto abre): desfazer, pausar, histórico, layout, decklist, replay,
// chamar o Judge, desistir, sair, e as opções da mesa (playmat, velocidade do bot, mão do bot, configurações).

import { useRef, useState } from 'react';
import { isAdmin, type LiveRoom } from '../../api';
import { useAuth } from '../../auth';
import { useT } from '../../i18n';
import { playmatLogo } from '../../picture';
import { PLAYMATS, SettingsControls, useSettings } from '../../settings';
import type { TableEmbed, TableGame, TableKind, TableTutorial } from '../GameScreen';
import { SheetFrame } from './CardZoom';
import type { Panel, Sheet } from './shared';
import type { ExitTo } from './Table';

export function TableMenu({
  game,
  kind,
  tutorial,
  embed,
  spectator,
  onExit,
  onRematch,
  exitTo,
  streamer,
  lateral,
  playerPanel,
  panelLogOn,
  layoutChoice,
  hasOwnDeck,
  canBroadcast,
  sendToBroadcast,
  callJudge,
  showBotHand,
  setShowBotHand,
  setSheet,
  openPanel,
}: {
  game: TableGame;
  kind: TableKind;
  tutorial?: TableTutorial;
  embed?: TableEmbed;
  spectator?: { roomId?: string; onSwitchRoom?: (room: LiveRoom) => void };
  onExit: () => void;
  /** Sandbox: recomeçar a situação. */
  onRematch?: () => void;
  exitTo: ExitTo;
  /** Visão do Streamer, e ela com a mesa lateral. */
  streamer: boolean;
  lateral: boolean;
  /** Quem joga no desktop tem o painel lateral; `panelLogOn`: o histórico mora nele. */
  playerPanel: boolean;
  panelLogOn: boolean;
  /** Dá para escolher o layout da mesa (desktop, quem joga). */
  layoutChoice: boolean;
  /** Há a decklist de quem joga para o painel. */
  hasOwnDeck: boolean;
  canBroadcast: boolean;
  sendToBroadcast: () => void;
  callJudge?: () => void;
  showBotHand: boolean;
  setShowBotHand: (show: boolean) => void;
  setSheet: (s: Sheet) => void;
  openPanel: (p: Panel) => void;
}) {
  const { state, dispatch, human } = game;
  const t = useT();
  const { streamerPlaymat, update: updateSettings } = useSettings();
  const isOnline = kind === 'online';
  const sandbox = kind === 'sandbox';
  const replay = game.replay;
  const over = state.phase === 'gameover';
  const toTournament = exitTo === 'tournament';
  return (
    <SheetFrame title={t('game.matchSheet')} onClose={() => setSheet(null)}>
      <div className="menu-grid">
        {human !== null && !isOnline && !tutorial && (
          <button className="btn" onClick={game.undo} disabled={!game.canUndo}>
            {t('game.undo')}
          </button>
        )}
        {!isOnline && !replay && !tutorial && (
          <button className="btn" onClick={() => game.setPaused((p) => !p)}>
            {game.paused ? t('game.resume') : t('game.pause')}
          </button>
        )}
        <button className="btn" onClick={() => (streamer || (playerPanel && panelLogOn) ? openPanel('log') : setSheet('log'))}>
          {t('game.logBtn')}
        </button>
        {layoutChoice && (
          <button className="btn" onClick={() => setSheet('layout')}>
            {t('game.layoutBtn')}
          </button>
        )}
        {playerPanel && hasOwnDeck && (
          <button className="btn" onClick={() => openPanel('deck')}>
            {t('game.decklistBtn')}
          </button>
        )}
        {streamer && !embed?.layout && (
          <button className="btn" onClick={() => updateSettings({ streamerLayout: lateral ? 'upright' : 'lateral' })} title={t('game.layoutTitle')}>
            {lateral ? t('game.layoutToUpright') : t('game.layoutToLateral')}
          </button>
        )}
        {streamer && spectator?.onSwitchRoom && (
          <button className="btn" onClick={() => openPanel('matches')}>
            {t('game.matchesBtn')}
          </button>
        )}
        {streamer && spectator?.roomId && (
          <button className="btn" onClick={() => openPanel('deck')}>
            {t('game.decklistBtn')}
          </button>
        )}
        {canBroadcast && (
          <button className="btn" onClick={sendToBroadcast}>
            {t('broadcast.sendThis')}
          </button>
        )}
        {sandbox && onRematch && (
          <button
            className="btn"
            onClick={() => {
              setSheet(null);
              onRematch();
            }}
          >
            {t('sandbox.restart')}
          </button>
        )}
        {(over || replay) && !tutorial && !sandbox && (
          <button className="btn" onClick={game.downloadReplay}>
            {t('game.downloadReplay')}
          </button>
        )}
        {callJudge && (
          <button className="btn judge-call" onClick={callJudge}>
            {t('judge.call')}
          </button>
        )}
        {human !== null && state.phase === 'main' && !tutorial && !sandbox && (
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm(t('game.concedeConfirm'))) {
                dispatch({ type: 'concede', player: human });
                setSheet(null);
              }
            }}
          >
            {t('game.concede')}
          </button>
        )}
        <button className="btn" onClick={onExit}>
          {tutorial ? (tutorial.exitLabel ?? t('tutorial.exitLesson')) : sandbox ? t('sandbox.backToEditor') : toTournament ? t('game.exitToTournament') : exitTo === 'back' ? t('game.exitBack') : t('game.exitToMenu')}
        </button>
      </div>
      {lateral && (
        <div className="sheet-section">
          <label className="sheet-label">{t('game.playmat')}</label>
          <p className="muted small sheet-hint">{t('game.playmatHint')}</p>
          <div className="seg small playmat-pick">
            {PLAYMATS.map((pm) => (
              <button key={pm} className={streamerPlaymat === pm ? 'on' : ''} onClick={() => updateSettings({ streamerPlaymat: pm })}>
                <span className={`playmat-dot playmat-${pm}`} aria-hidden />
                {t(`game.playmat.${pm}`)}
              </button>
            ))}
          </div>
          {!embed && <PlaymatLogoField />}
        </div>
      )}
      {!isOnline && !replay && !tutorial && (
        <div className="sheet-section">
          <label className="sheet-label">{t('game.botSpeed')}</label>
          <p className="muted small sheet-hint">{t('game.botSpeedHint')}</p>
          <div className="seg small">
            {[0.5, 1, 2, 4].map((v) => (
              <button key={v} className={game.speed === v ? 'on' : ''} onClick={() => game.setSpeed(v)}>
                {t('game.speedX', { v })}
              </button>
            ))}
          </div>
        </div>
      )}
      {(kind === 'bot' || sandbox) && !tutorial && (
        <label className="check">
          <input type="checkbox" checked={showBotHand} onChange={(e) => setShowBotHand(e.target.checked)} /> {t('game.showBotHand')}
        </label>
      )}
      <div className="sheet-section">
        <SettingsControls />
      </div>
    </SheetFrame>
  );
}

/**
 * A logo de quem transmite (perfis Streamer e Admin) no centro do playmat da mesa lateral, no lugar da padrão:
 * enviar, trocar ou voltar para a padrão. Fica guardada na conta e só aparece na tela de quem enviou.
 */
function PlaymatLogoField() {
  const t = useT();
  const { user, changePlaymatLogo } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user || !(user.role === 'streamer' || isAdmin(user.role))) return null;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onFile = (file: File) =>
    run(async () => {
      const image = await playmatLogo(file).catch(() => {
        throw new Error(t('account.photoUnreadable'));
      });
      await changePlaymatLogo(image);
    });
  return (
    <div className="playmat-logo">
      <label className="sheet-label">{t('game.playmatLogo')}</label>
      <p className="muted small sheet-hint">{t('game.playmatLogoHint')}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/webp,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onFile(file);
        }}
      />
      <div className="playmat-logo-row">
        {user.playmatLogo && <img className="playmat-logo-thumb" src={user.playmatLogo} alt="" />}
        <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('account.photoSaving') : user.playmatLogo ? t('game.playmatLogoChange') : t('game.playmatLogoUpload')}
        </button>
        {user.playmatLogo && !busy && (
          <button type="button" className="btn small" onClick={() => void run(() => changePlaymatLogo(null))}>
            {t('game.playmatLogoRemove')}
          </button>
        )}
      </div>
      {error && (
        <span className="warn small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
