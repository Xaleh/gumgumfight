import { useEffect, useState } from 'react';
import { type AdminUser, api, type Role, ROLE_LABEL, SUPPORTER_TIERS, type SupporterPayment, type SupporterTier, TIER_LABEL } from '../api';
import { useAuth } from '../auth';
import type { GameSetup } from '../game/useGame';
import { ReportsPanel } from './Reports';

const ROLE_HELP: Record<Role, string> = {
  player: 'Joga e assiste às partidas sem ver as mãos.',
  streamer: 'Assiste às partidas podendo ver as mãos dos dois jogadores.',
  organizer: 'Cria torneios e gerencia os que criou (inscrições, rodadas e resultados).',
  admin: 'Tudo do Streamer e do Organizador, gerencia qualquer torneio e muda os perfis das contas.',
  dev: 'Tudo do Admin e as funções de desenvolvimento: ferramentas manuais na partida, cobertura das cartas e opções de teste.',
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'sem prazo');

/** Plano de apoio de uma conta: dado à mão (Pix mensal, parceria, cortesia) ou vindo do Ko-fi. */
function SupporterEditor({ u, onSaved }: { u: AdminUser; onSaved: (u: Pick<AdminUser, 'id' | 'supporterTier' | 'supporterUntil' | 'supporterSource'>) => void }) {
  const [tier, setTier] = useState<SupporterTier | ''>(u.supporterTier ?? '');
  const [until, setUntil] = useState(u.supporterUntil && u.supporterTier ? u.supporterUntil.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = tier !== (u.supporterTier ?? '') || (tier !== '' && until !== (u.supporterUntil?.slice(0, 10) ?? ''));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.admin.setSupporter(u.id, tier || null, tier && until ? until : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-supporter">
      <label className="muted small">
        Apoio
        <select value={tier} onChange={(e) => setTier(e.target.value as SupporterTier | '')}>
          <option value="">Sem plano</option>
          {SUPPORTER_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {tier && (
        <label className="muted small">
          até
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} title="Vazio = sem prazo" />
        </label>
      )}
      {u.supporterTier && <span className="muted small">{u.supporterSource === 'kofi' ? `Ko-fi, vence ${fmtDate(u.supporterUntil)}` : `manual, ${fmtDate(u.supporterUntil)}`}</span>}
      {dirty && (
        <button className="btn small" disabled={busy} onClick={save}>
          Salvar
        </button>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** Pagamentos recebidos pelo webhook do Ko-fi (conferência). */
function PaymentsPanel() {
  const [list, setList] = useState<SupporterPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.admin
      .payments()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <div className="admin-payments">
      <p className="muted small">
        Pagamentos que chegaram pelo webhook do Ko-fi. Assinaturas com plano reconhecido ligam o plano na conta Google do mesmo e-mail por 35 dias. Pagamentos por
        Pix não passam por aqui: dê o plano à mão na aba de contas.
      </p>
      {error && <div className="error">{error}</div>}
      {list === null && !error && <p className="muted">Carregando…</p>}
      {list?.length === 0 && <p className="muted">Nenhum pagamento recebido ainda.</p>}
      {list && list.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Plano</th>
              <th>Valor</th>
              <th>Conta</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.paidAt).toLocaleDateString('pt-BR')}</td>
                <td>{p.kind}</td>
                <td>{p.tier ? TIER_LABEL[p.tier] : '—'}</td>
                <td>
                  {p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} {p.currency}
                </td>
                <td>{p.userName ?? <span className="muted">{p.email ?? '—'} (sem conta)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Administração (só admin e dev): perfis das contas e os relatos de problemas das partidas. */
export function Admin({ onExit, onReplay }: { onExit: () => void; onReplay: (setup: GameSetup) => void }) {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<'users' | 'reports' | 'payments'>('users');
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
        <h2>Administração</h2>
      </header>
      <div className="coverage-body">
        <div className="seg tour-tabs">
          <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
            Perfis das contas
          </button>
          <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
            Relatos de partidas
          </button>
          <button className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>
            Apoios recebidos
          </button>
        </div>
        {tab === 'reports' && <ReportsPanel onReplay={onReplay} />}
        {tab === 'payments' && <PaymentsPanel />}
        {tab === 'users' && (
          <>
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
                  <SupporterEditor
                    key={`${u.supporterTier}-${u.supporterUntil}`}
                    u={u}
                    onSaved={(saved) => {
                      setUsers((list) => list?.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)) ?? null);
                      if (saved.id === user?.id) void refresh();
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
