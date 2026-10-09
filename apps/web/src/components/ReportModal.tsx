import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Relatar um problema numa partida ranqueada ou de torneio que acabou de terminar. O
 * relato vai para o organizador do torneio e para os admins, com o replay da partida.
 */
export function ReportModal({ matchId, tournament, onClose }: { matchId: number; tournament: string | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.matches.report(matchId, text);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet report-sheet" role="dialog" aria-label="Relatar problema" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>⚑ Relatar um problema</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body report-body">
          {sent ? (
            <>
              <p>
                <b>Relato enviado.</b> {tournament ? 'O organizador do torneio e os administradores' : 'Os administradores'} vão analisar
                a partida pelo replay gravado.
              </p>
              <div className="btn-row">
                <button className="btn primary" onClick={onClose}>
                  Fechar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">
                Descreva o que aconteceu (uma carta que não funcionou como devia, queda de conexão, comportamento do oponente…). O
                replay da partida fica gravado e vai junto com o relato
                {tournament ? ` para o organizador de ${tournament} e para os administradores.` : ' para os administradores.'}
              </p>
              <textarea
                className="admin-search"
                rows={5}
                maxLength={2000}
                autoFocus
                placeholder="O que aconteceu?"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {error && <div className="error">{error}</div>}
              <div className="btn-row">
                <button className="btn" onClick={onClose}>
                  Cancelar
                </button>
                <button className="btn primary" disabled={busy || text.trim().length < 5} onClick={send}>
                  {busy ? 'Enviando…' : 'Enviar relato'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
