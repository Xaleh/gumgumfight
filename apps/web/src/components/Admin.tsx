import { useEffect, useState } from 'react';
import { type AdminUser, api, type Role, ROLE_LABEL } from '../api';
import { useAuth } from '../auth';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useT } from '../i18n';
import { ReportsPanel } from './Reports';

/** O que cada perfil pode fazer: chave do dicionário. */
const ROLE_HELP: Record<Role, MessageKey> = {
  player: 'admin.roleHelp.player',
  streamer: 'admin.roleHelp.streamer',
  organizer: 'admin.roleHelp.organizer',
  admin: 'admin.roleHelp.admin',
  dev: 'admin.roleHelp.dev',
};

/** Administração (só admin e dev): perfis das contas e os relatos de problemas das partidas. */
export function Admin({ onExit, onReplay }: { onExit: () => void; onReplay: (setup: GameSetup) => void }) {
  const t = useT();
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<'users' | 'reports'>('users');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const timer = setTimeout(() => {
      api.admin
        .users(query)
        .then((u) => !stop && (setUsers(u), setError(null)))
        .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      stop = true;
      clearTimeout(timer);
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
          {t('admin.menu')}
        </button>
        <h2>{t('admin.title')}</h2>
      </header>
      <div className="coverage-body">
        <div className="seg tour-tabs">
          <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
            {t('admin.tabUsers')}
          </button>
          <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
            {t('admin.tabReports')}
          </button>
        </div>
        {tab === 'reports' && <ReportsPanel onReplay={onReplay} />}
        {tab === 'users' && (
          <>
            <ul className="role-help muted small">
              {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                <li key={r}>
                  <b>{t(ROLE_LABEL[r])}</b>: {t(ROLE_HELP[r])}
                </li>
              ))}
            </ul>
            <input className="admin-search" value={query} placeholder={t('admin.searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
            {error && <div className="error">{error}</div>}
            {users === null && !error && <p className="muted">{t('common.loading')}</p>}
            {users?.length === 0 && <p className="muted">{t('admin.noAccounts')}</p>}
            <div className="admin-users">
              {users?.map((u) => (
                <div key={u.id} className="admin-user">
                  {u.picture ? (
                    <img className="account-avatar" src={u.picture} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="account-avatar">{(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="account-who">
                    <strong>{u.name ?? t('admin.googleAccount')}</strong>
                    {u.email && <span className="muted small">{u.email}</span>}
                  </span>
                  <div className="seg small">
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                      <button
                        key={r}
                        className={u.role === r ? 'on' : ''}
                        disabled={(u.id === user?.id && r !== 'dev') || saving === u.id}
                        title={u.id === user?.id && r !== 'dev' ? t('admin.selfRoleTitle') : t(ROLE_HELP[r])}
                        onClick={() => u.role !== r && change(u, r)}
                      >
                        {t(ROLE_LABEL[r])}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
