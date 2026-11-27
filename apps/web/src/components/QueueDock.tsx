// A busca por oponente (fila casual e ranqueada) na tela, em qualquer página do app: a janela "Procurando
// oponente" (com o cartão de dicas e a mão de teste do deck da fila), a busca minimizada, que acompanha o jogador
// pelas telas de navegar (uma pílula embaixo; nas telas de mesa, uma etiqueta no canto da mesa), e a pergunta
// "Sair da fila?" ao abrir uma tela que tira ele da fila.
//
// O estado da fila mora na raiz do app (`MainApp`, com `useQueue`) e chega aos componentes pelo contexto daqui:
// assim a busca não acaba quando o jogador sai da tela inicial. Quais telas mantêm a fila: `queueScreens.ts`.

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { FormatId, QueueKind, QueueLeader } from '../api';
import { useT } from '../i18n';
import { queueChipInTable } from '../queueScreens';
import { useSettings } from '../settings';
import { LeaderArt } from './LeaderArt';
import { fmtWait, type QueueState } from './OnlineMenu';
import { useWaitDeck, WaitHandSheet } from './WaitHandTest';
import { WaitTips } from './WaitTips';

/** Como a busca aparece: a janela, minimizada, ou a folha da mão de teste. */
export type QueueView = 'wait' | 'pill' | 'hand';

export interface AppQueue {
  /** A busca em andamento (null: fora da fila). */
  queue: QueueState | null;
  view: QueueView;
  setView: (view: QueueView) => void;
  enqueue: (deckId: string, format: FormatId, kind: QueueKind, leader?: QueueLeader | null) => Promise<void>;
  cancel: () => void;
  /** Recusa do servidor que encerrou a busca (a tela inicial mostra e limpa; nas outras telas, o aviso daqui). */
  error: unknown;
  clearError: () => void;
}

const QueueContext = createContext<AppQueue | null>(null);
export const QueueProvider = QueueContext.Provider;

export function useAppQueue(): AppQueue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useAppQueue fora do QueueProvider');
  return ctx;
}

/** A busca está minimizada (fora do app principal, onde não há fila, é sempre falso). */
export function useQueueMinimized(): boolean {
  const ctx = useContext(QueueContext);
  return Boolean(ctx?.queue && ctx.view === 'pill');
}

/**
 * A busca minimizada nas telas de mesa (assistir e replay): uma etiqueta com o tempo, no canto da mesa, ao lado das
 * outras ("Assistindo", chat). Tocar reabre a janela. Fora do app principal (transmissão, replay embutido) não há
 * fila, e ela não aparece.
 */
export function QueueChip() {
  const t = useT();
  const { animations } = useSettings();
  const ctx = useContext(QueueContext);
  if (!ctx?.queue || ctx.view !== 'pill') return null;
  const time = fmtWait(ctx.queue.waited);
  return (
    <button type="button" className={`queue-chip anim-${animations}`} onClick={() => ctx.setView('wait')} aria-label={t('wait.pillOpen', { time })} title={t('wait.pill')}>
      <i className="queue-pill-dot" aria-hidden="true" />
      <b>{time}</b>
    </button>
  );
}

/**
 * A busca na tela. Abre como janela; "Minimizar" (ou Esc, ou tocar fora) deixa só a pílula com o tempo, e o
 * jogador segue navegando. `screen`: a tela aberta (trocar de tela minimiza; nas telas de mesa quem mostra a busca
 * minimizada é a etiqueta da mesa, `QueueChip`).
 */
export function QueueDock({ queue, screen, onCancel }: { queue: QueueState; screen: string; onCancel: () => void }) {
  const t = useT();
  const { animations } = useSettings();
  const { view, setView } = useAppQueue();
  const deck = useWaitDeck(queue.deckId);
  const minimize = useCallback(() => setView('pill'), [setView]);
  const openWait = useCallback(() => setView('wait'), [setView]);

  const last = useRef(screen);
  useEffect(() => {
    if (last.current === screen) return;
    last.current = screen;
    setView('pill');
  }, [screen, setView]);
  useEffect(() => {
    if (view !== 'wait') return;
    // Com uma carta ampliada aberta (o spoiler do cartão de dicas), o Esc fecha só ela.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.zoom-backdrop') && minimize();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, minimize]);

  // Com a pílula embaixo, a página ganha espaço no fim para o último conteúdo rolar por cima dela (styles.css).
  const pillBelow = view === 'pill' && !queueChipInTable(screen);
  useEffect(() => {
    if (!pillBelow) return;
    document.documentElement.classList.add('queue-pill-open');
    return () => document.documentElement.classList.remove('queue-pill-open');
  }, [pillBelow]);

  const time = fmtWait(queue.waited);
  if (view === 'pill') {
    if (!pillBelow) return null;
    return (
      <button
        type="button"
        className={`queue-pill anim-${animations}`}
        onClick={openWait}
        aria-label={t('wait.pillOpen', { time })}
      >
        <i className="queue-pill-dot" aria-hidden="true" />
        <span>{t('wait.pill')}</span>
        <b>{time}</b>
      </button>
    );
  }
  if (view === 'hand') {
    return <WaitHandSheet deck={deck.data} failed={deck.failed} status={t('wait.handSearching', { time })} onClose={openWait} />;
  }
  return (
    <div className="modal-backdrop page-sheet" onClick={minimize}>
      <div className="modal-card queue-wait" role="dialog" aria-modal="true" aria-labelledby="queue-wait-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{queue.kind === 'ranked' ? t('menu.onlineRanked') : t('menu.onlineCasual')}</div>
        <h2 id="queue-wait-title">
          {t('menu.onlineSearching')}
          <span className="dots" />
        </h2>
        <p className="queue-time">{time}</p>
        {queue.leader && (
          <div className="queue-leader">
            <LeaderArt name={queue.leader.name} image={queue.leader.imageUrl} colors={queue.leader.colors} size="small" />
            <p className="small">
              {queue.leaderWait > 0
                ? t('menu.queueLeaderSearching', { name: queue.leader.name, time: fmtWait(queue.leaderWait + 999) })
                : t('menu.queueLeaderExpired', { name: queue.leader.name })}
            </p>
          </div>
        )}
        <p className="muted small">{queue.players > 1 ? t('menu.onlineQueuePlayers', { n: queue.players }) : t('menu.onlineQueueAlone')}</p>
        <WaitTips leader={deck.data?.deck.leader} />
        <div className="btn-row center queue-actions">
          <button className="btn" onClick={() => setView('hand')}>
            {t('wait.handTest')}
          </button>
          <button className="btn primary" onClick={minimize}>
            {t('wait.minimize')}
          </button>
          <button className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
        <p className="muted small queue-hint">{t('wait.minimizeHint')}</p>
      </div>
    </div>
  );
}

/** "Sair da fila?": o jogador, na fila, pediu uma tela onde se joga ou se edita algo. */
export function QueueLeaveConfirm({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onStay();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay]);
  return (
    <div className="modal-backdrop page-sheet queue-leave" onClick={onStay}>
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="queue-leave-title" aria-describedby="queue-leave-text" onClick={(e) => e.stopPropagation()}>
        <h2 id="queue-leave-title">{t('wait.leaveTitle')}</h2>
        <p id="queue-leave-text">{t('wait.leaveText')}</p>
        <div className="btn-row center">
          <button className="btn primary" onClick={onStay}>
            {t('wait.leaveStay')}
          </button>
          <button className="btn" onClick={onLeave}>
            {t('wait.leaveGo')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A busca parou por uma recusa do servidor, com o jogador fora da tela inicial (lá o erro aparece nos modos). */
export function QueueStopped({ reason, onClose }: { reason: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="queue-stopped" role="alert">
      <span>{t('wait.stopped', { reason })}</span>
      <button type="button" className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  );
}
