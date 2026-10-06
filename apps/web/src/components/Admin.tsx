import { useEffect, useState } from 'react';
import { type AdminUser, api, type Role, ROLE_LABEL } from '../api';
import { useAuth } from '../auth';

const ROLE_HELP: Record<Role, string> = {
  player: 'Joga e assiste às partidas sem ver as mãos.',
  streamer: 'Assiste às partidas podendo ver as mãos dos dois jogadores.',
  organizer: 'Cria torneios e gerencia os que criou (inscrições, rodadas e resultados).',
  admin: 'Tudo do Streamer e do Organizador, gerencia qualquer torneio e muda os perfis das contas.',
  dev: 'Tudo do Admin e as funções de desenvolvimento: ferramentas manuais na partida, cobertura das cartas e opções de teste.',
};

/** Perfis das contas (só admin): Player, Streamer, Organizador, Admin ou Dev. */
export function Admin({ onExit }: { onExit: () => void }) {
  const { user, refresh } = useAuth();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const t = setTimeout(() => {
      api.admin
        .users(query)
        .then((u) => !stop && (setUsers(u), setError(null)))
        .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [query]);

  const change = async (u: AdminUser, role: Role) => {
    setSaving(u.id);
    setError(null);
    try {
      const saved = await api.admin.setRole(u.id, role);
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, role: saved.role } : x)) ?? null);
      // Promoveu a si mesmo a Dev: a barra de conta e o menu passam a mostrar as funções de desenvolvimento.
      if (u.id === user?.id) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="coverage admin">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          ← Menu
        </button>
        <h2>Perfis das contas</h2>
      </header>
      <div className="coverage-body">
        <ul className="role-help muted small">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <li key={r}>
              <b>{ROLE_LABEL[r]}</b>: {ROLE_HELP[r]}
            </li>
          ))}
        </ul>
        <input
          className="admin-search"
          value={query}
          placeholder="Buscar por nome ou e-mail"
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        {users === null && !error && <p className="muted">Carregando…</p>}
        {users?.length === 0 && <p className="muted">Nenhuma conta encontrada.</p>}
        <div className="admin-users">
          {users?.map((u) => (
            <div key={u.id} className="admin-user">
              {u.picture ? (
                <img className="account-avatar" src={u.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar">{(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}</span>
              )}
              <span className="account-who">
                <strong>{u.name ?? 'Conta Google'}</strong>
                {u.email && <span className="muted small">{u.email}</span>}
              </span>
              <div className="seg small">
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <button
                    key={r}
                    className={u.role === r ? 'on' : ''}
                    disabled={(u.id === user?.id && r !== 'dev') || saving === u.id}
                    title={u.id === user?.id && r !== 'dev' ? 'Você só pode mudar o seu próprio perfil para Dev' : ROLE_HELP[r]}
                    onClick={() => u.role !== r && change(u, r)}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
