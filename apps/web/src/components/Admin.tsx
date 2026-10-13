import { useEffect, useState } from 'react';
import {
  type AdminSponsor,
  type AdminUser,
  api,
  type Role,
  ROLE_LABEL,
  type SponsorInput,
  SUPPORTER_TIERS,
  type SupporterPayment,
  type SupporterTier,
  TIER_LABEL,
} from '../api';
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

const EMPTY_SPONSOR: SponsorInput = { name: '', url: null, offer: null, placements: ['tournaments'], startsAt: null, endsAt: null, sort: 0 };
const PLACEMENT_LABEL = { tournaments: 'Página de torneios', home: 'Tela inicial' } as const;
const MAX_LOGO_KB = 300;

/** Formulário de uma loja (nova ou existente). */
function SponsorForm({ initial, onSaved, onCancel }: { initial?: AdminSponsor; onSaved: (sp: AdminSponsor) => void; onCancel?: () => void }) {
  const [form, setForm] = useState<SponsorInput>(() =>
    initial
      ? {
          name: initial.name,
          url: initial.url,
          offer: initial.offer,
          placements: initial.placements,
          startsAt: initial.startsAt?.slice(0, 10) ?? null,
          endsAt: initial.endsAt ? new Date(Date.parse(initial.endsAt) - 3 * 3_600_000).toISOString().slice(0, 10) : null,
          sort: initial.sort,
        }
      : EMPTY_SPONSOR,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SponsorInput>(k: K, v: SponsorInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const togglePlacement = (p: 'tournaments' | 'home') =>
    set('placements', form.placements.includes(p) ? form.placements.filter((x) => x !== p) : [...form.placements, p]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(initial ? await api.admin.updateSponsor(initial.id, form) : await api.admin.createSponsor(form));
      if (!initial) setForm(EMPTY_SPONSOR);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sponsor-form">
      <div className="tour-form-row">
        <label className="field">
          <span className="muted small">Nome da loja</span>
          <input className="admin-search" maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">Link (site ou loja online)</span>
          <input className="admin-search" placeholder="https://" value={form.url ?? ''} onChange={(e) => set('url', e.target.value || null)} />
        </label>
      </div>
      <label className="field">
        <span className="muted small">Oferta do mês (opcional)</span>
        <input
          className="admin-search"
          maxLength={160}
          placeholder="Ex.: 10% de desconto em boosters com o cupom GUMGUM"
          value={form.offer ?? ''}
          onChange={(e) => set('offer', e.target.value || null)}
        />
      </label>
      <div className="tour-form-row">
        <label className="field">
          <span className="muted small">Início</span>
          <input className="admin-search" type="date" value={form.startsAt ?? ''} onChange={(e) => set('startsAt', e.target.value || null)} />
        </label>
        <label className="field">
          <span className="muted small">Fim (último dia)</span>
          <input className="admin-search" type="date" value={form.endsAt ?? ''} onChange={(e) => set('endsAt', e.target.value || null)} />
        </label>
        <label className="field">
          <span className="muted small">Ordem</span>
          <input className="admin-search" type="number" value={form.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} />
        </label>
      </div>
      <div className="sponsor-placements">
        {(Object.keys(PLACEMENT_LABEL) as Array<keyof typeof PLACEMENT_LABEL>).map((p) => (
          <label key={p} className="check">
            <input type="checkbox" checked={form.placements.includes(p)} onChange={() => togglePlacement(p)} />
            {PLACEMENT_LABEL[p]}
          </label>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="btn-row">
        {onCancel && (
          <button className="btn small" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn small primary" disabled={busy || form.name.trim().length < 2} onClick={save}>
          {initial ? 'Salvar' : 'Adicionar loja'}
        </button>
      </div>
    </div>
  );
}

/** Lojas patrocinadoras: aparecem na página de torneios (e na home, se marcado) e no torneio que patrocinam. */
function SponsorsPanel() {
  const [list, setList] = useState<AdminSponsor[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.admin
      .sponsors()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const replace = (sp: AdminSponsor) => setList((l) => (l?.some((x) => x.id === sp.id) ? l.map((x) => (x.id === sp.id ? sp : x)) : [...(l ?? []), sp]));
  const upload = (sp: AdminSponsor, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_KB * 1024) {
      setError(`O logo pode ter até ${MAX_LOGO_KB} KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      api.admin
        .setSponsorLogo(sp.id, String(reader.result))
        .then((saved) => (replace(saved), setError(null)))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    reader.readAsDataURL(file);
  };
  const remove = async (sp: AdminSponsor) => {
    if (!window.confirm(`Apagar a loja ${sp.name}? Os torneios patrocinados por ela ficam sem loja.`)) return;
    try {
      await api.admin.deleteSponsor(sp.id);
      setList((l) => l?.filter((x) => x.id !== sp.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="admin-sponsors">
      <p className="muted small">
        Só a marca da loja e a oferta: nada de arte de carta nem logo da Bandai ou de One Piece. Logo em PNG, JPEG ou WebP, até {MAX_LOGO_KB} KB, de
        preferência quadrado. Para patrocinar um torneio, escolha a loja no formulário do torneio do time.
      </p>
      {error && <div className="error">{error}</div>}
      {list === null && !error && <p className="muted">Carregando…</p>}
      {list?.map((sp) => (
        <div key={sp.id} className="admin-user admin-sponsor">
          {sp.logoUrl ? <img className="account-avatar" src={sp.logoUrl} alt="" /> : <span className="account-avatar">{sp.name.slice(0, 1)}</span>}
          <span className="account-who">
            <strong>
              {sp.name} {!sp.active && <span className="muted small">(fora do período)</span>}
            </strong>
            <span className="muted small">
              {sp.placements.map((p) => PLACEMENT_LABEL[p]).join(' · ')}
              {sp.offer ? ` · ${sp.offer}` : ''}
            </span>
          </span>
          <div className="btn-row">
            <label className="btn small">
              Logo
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(sp, e.target.files?.[0])} />
            </label>
            <button className="btn small" onClick={() => setEditing(editing === sp.id ? null : sp.id)}>
              Editar
            </button>
            <button className="btn small danger" onClick={() => remove(sp)}>
              Apagar
            </button>
          </div>
          {editing === sp.id && (
            <SponsorForm
              initial={sp}
              onCancel={() => setEditing(null)}
              onSaved={(saved) => {
                replace(saved);
                setEditing(null);
              }}
            />
          )}
        </div>
      ))}
      <h3>Nova loja</h3>
      <SponsorForm onSaved={replace} />
    </div>
  );
}

/** Administração (só admin e dev): perfis das contas e os relatos de problemas das partidas. */
export function Admin({ onExit, onReplay }: { onExit: () => void; onReplay: (setup: GameSetup) => void }) {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<'users' | 'reports' | 'payments' | 'sponsors'>('users');
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
          <button className={tab === 'sponsors' ? 'on' : ''} onClick={() => setTab('sponsors')}>
            Lojas parceiras
          </button>
        </div>
        {tab === 'reports' && <ReportsPanel onReplay={onReplay} />}
        {tab === 'payments' && <PaymentsPanel />}
        {tab === 'sponsors' && <SponsorsPanel />}
        {tab === 'users' && (
          <>
            <ul className="role-help muted small">
              {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                <li key={r}>
                  <b>{ROLE_LABEL[r]}</b>: {ROLE_HELP[r]}
                </li>
              ))}
              <li>
                <b>Apoio</b>: plano de apoiador da conta. Vem sozinho do Ko-fi (pelo e-mail da conta Google) ou é dado aqui à mão (Pix mensal,
                parceria, cortesia). Tripulante libera as Estatísticas Pro e a homologação; Capitão e Almirante organizam até 5 torneios por mês;
                Almirante tem prioridade nos torneios do time.
              </li>
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
