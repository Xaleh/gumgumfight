import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CHARACTER_KEYS } from '../game/shortcuts';
import { type MessageKey, useT } from '../i18n';

/** Uma linha da lista: as teclas (um texto traduzido, como "Espaço", ou a própria tecla) e o que elas fazem. */
interface Row {
  keys: (string | { label: MessageKey })[];
  /** Entre as teclas: "+" (juntas) ou "…" (de uma à outra); sem nada, uma ao lado da outra. */
  join?: '+' | '…';
  text: MessageKey;
}

const LETTERS = CHARACTER_KEYS.map((k) => k.toUpperCase());

const GROUPS: { title: MessageKey; rows: Row[] }[] = [
  {
    title: 'shortcuts.groupTurn',
    rows: [
      { keys: [{ label: 'shortcuts.keySpace' }], text: 'shortcuts.endTurn' },
      { keys: ['Enter'], text: 'shortcuts.confirm' },
      { keys: ['Esc'], text: 'shortcuts.cancel' },
      { keys: ['1', '9'], join: '…', text: 'shortcuts.options' },
    ],
  },
  {
    title: 'shortcuts.groupCards',
    rows: [
      { keys: LETTERS, text: 'shortcuts.characters' },
      { keys: ['L'], text: 'shortcuts.leader' },
      { keys: ['Shift', { label: 'shortcuts.keyAny' }], join: '+', text: 'shortcuts.opponentCard' },
      { keys: ['A'], text: 'shortcuts.attack' },
      { keys: ['H'], text: 'shortcuts.ability' },
    ],
  },
  {
    title: 'shortcuts.groupDon',
    rows: [
      { keys: ['1', '9'], join: '…', text: 'shortcuts.don' },
      { keys: ['0'], text: 'shortcuts.donTen' },
      { keys: ['X'], text: 'shortcuts.attachAll' },
    ],
  },
  {
    title: 'shortcuts.groupTrash',
    rows: [
      { keys: ['D'], text: 'shortcuts.trashMine' },
      { keys: ['O'], text: 'shortcuts.trashOpponent' },
    ],
  },
];

/**
 * A lista dos atalhos de teclado da mesa (aberta em Configurações e no menu da partida). Fica no `body`, por
 * cima de onde foi aberta; o Esc fecha só ela (a janela de baixo e a mesa não veem a tecla).
 */
export function ShortcutsHelp({ enabled, onClose }: { enabled: boolean; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      className="modal-backdrop sheet-backdrop page-sheet centered shortcuts-backdrop"
      onClick={(e) => {
        // O clique não chega à janela de baixo (o portal repassa os eventos pela árvore do React).
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="sheet shortcuts-sheet" role="dialog" aria-label={t('shortcuts.title')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('shortcuts.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {!enabled && <p className="shortcuts-off">{t('shortcuts.off')}</p>}
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h4>{t(group.title)}</h4>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.text} className="shortcut-row">
                    <dt>
                      {row.keys.map((key, i) => (
                        <span key={i}>
                          {i > 0 && row.join && <span className="shortcut-join">{row.join}</span>}
                          <kbd>{typeof key === 'string' ? key : t(key.label)}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{t(row.text)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="shortcuts-example">{t('shortcuts.example')}</p>
          <p className="muted small">{t('shortcuts.note')}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
