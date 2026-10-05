import { formatLabel } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type LiveRoom, type WatchTarget } from '../api';
import { useAuth } from '../auth';
import { LeaderArt } from './LeaderArt';
import { TIER_LABEL } from './Online';

const QUEUE_LABEL: Record<LiveRoom['queue'], string> = {
  ranked: '🏆 Ranqueada',
  casual: 'Casual',
  private: 'Sala privada',
  bot: '🤖 Treino contra o bot',
};

const HANDS_PREF = 'gumgum.watchHands';

function savedHands(): boolean {
  try {
    return localStorage.getItem(HANDS_PREF) === '1';
  } catch {
    return false;
  }
}

/** Lista das partidas online em andamento para assistir (modo espectador). */
export function Watch({ onExit, onWatch }: { onExit: () => void; onWatch: (t: WatchTarget) => void }) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [canHands, setCanHands] = useState(false);
  const [hands, setHands] = useState(savedHands);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A lista muda sozinha (partidas começam e terminam): atualiza a cada 5 s.
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.online
        .live()
        .then((r) => {
          if (stop) return;
          setRooms(r.rooms);
          setCanHands(r.hands);
        })
        .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user?.id]);

  const toggleHands = (on: boolean) => {
    setHands(on);
    try {
      localStorage.setItem(HANDS_PREF, on ? '1' : '0');
    } catch {
      /* sem armazenamento */
    }
  };
  // Na própria partida o servidor não mostra as mãos: assiste sem elas.
  const watch = (roomId: string, mine = false) => onWatch({ roomId, hands: canHands && hands && !mine });

  const byCode = async () => {
    setError(null);
    try {
      const room = await api.online.byCode(code);
      watch(room.id, room.mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="coverage watch">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          ← Menu
        </button>
        <h2>Assistir partidas</h2>
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}

        {canHands ? (
          <label className="check watch-hands">
            <input type="checkbox" checked={hands} onChange={(e) => toggleHands(e.target.checked)} /> Ver as mãos dos jogadores
            <span className="muted small"> (perfil {user?.role === 'admin' ? 'Admin' : 'Streamer'})</span>
          </label>
        ) : (
          <p className="muted small">
            Você assiste sem ver as mãos dos jogadores. Ver as mãos é só para os perfis Streamer e Admin.
          </p>
        )}

        <div className="watch-list">
          {rooms === null && !error && <p className="muted">Carregando…</p>}
          {rooms?.length === 0 && <p className="muted">Nenhuma partida em andamento agora. A lista se atualiza sozinha.</p>}
          {rooms?.map((r) => (
            <button key={r.id} className="watch-room" onClick={() => watch(r.id, r.mine)}>
              <div className="watch-meta">
                <span className="watch-queue">{QUEUE_LABEL[r.queue]}</span>
                {r.mine && (
                  <span className="muted small" title="Você joga esta partida: ela aparece sem as mãos dos jogadores">
                    Sua partida
                  </span>
                )}
                <span className="muted small">
                  {formatLabel(r.format)} · {r.turn ? `Turno ${r.turn}` : 'Mão inicial'}
                  {r.spectators ? ` · 👁 ${r.spectators}` : ''}
                </span>
              </div>
              <div className="watch-players">
                {r.players.map((p, i) => (
                  <div key={i} className={['watch-player', i === 1 ? 'right' : ''].join(' ')}>
                    <LeaderArt name={p.leaderName ?? p.leader} image={p.leaderImage} colors={p.colors} size="small" />
                    <span className="watch-name">
                      <b>{p.bot ? '🤖 ' : ''}{p.name}</b>
                      <span className="muted small">
                        {r.queue === 'ranked' ? `${TIER_LABEL[p.tier] ?? p.tier} · ` : ''}❤ {p.life} · ✋ {p.hand}
                      </span>
                    </span>
                  </div>
                ))}
                <span className="vs-badge">VS</span>
              </div>
            </button>
          ))}
        </div>

        <div className="field">
          <label>Sala privada</label>
          <p className="muted small">Salas privadas não aparecem na lista: peça o código a quem está jogando.</p>
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder="Código"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn" disabled={code.length !== 6} onClick={byCode}>
              Assistir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
