// Administração: a parte do apoio ao projeto. O plano de cada conta, os apoios
// registrados (Apoia.se) e as lojas parceiras.

import { useEffect, useState } from 'react';
import {
  type AdminSponsor,
  type AdminUser,
  api,
  type SponsorInput,
  SUPPORTER_TIERS,
  type SupporterPayment,
  type SupporterTier,
  TIER_LABEL,
} from '../api';
import { useLocale, useT } from '../i18n';
import { fmtDate } from '../i18n/format';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type SavedSupporter = Pick<AdminUser, 'id' | 'supporterTier' | 'supporterUntil' | 'supporterSource'>;

/** Plano de apoio de uma conta: vindo da Apoia.se ou dado à mão (Pix mensal, parceria, cortesia). */
export function SupporterEditor({ u, onSaved }: { u: AdminUser; onSaved: (u: SavedSupporter) => void }) {
  const t = useT();
  const locale = useLocale();
  const [tier, setTier] = useState<SupporterTier | ''>(u.supporterTier ?? '');
  const [until, setUntil] = useState(u.supporterUntil && u.supporterTier ? u.supporterUntil.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = tier !== (u.supporterTier ?? '') || (tier !== '' && until !== (u.supporterUntil?.slice(0, 10) ?? ''));
  const date = u.supporterUntil ? fmtDate(u.supporterUntil, locale) : t('admin.noDeadline');
  const source =
    u.supporterSource === 'apoiase'
      ? t('admin.sourceApoiase', { date })
      : u.supporterSource === 'kofi'
        ? t('admin.sourceKofi', { date })
        : t('admin.sourceManual', { date });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.admin.setSupporter(u.id, tier || null, tier && until ? until : null));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-supporter">
      <label className="muted small">
        {t('admin.supporter')}
        <select value={tier} onChange={(e) => setTier(e.target.value as SupporterTier | '')}>
          <option value="">{t('admin.noPlan')}</option>
          {SUPPORTER_TIERS.map((x) => (
            <option key={x} value={x}>
              {TIER_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      {tier && (
        <label className="muted small">
          {t('admin.until')}
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} title={t('admin.untilTitle')} />
        </label>
      )}
      {u.supporterTier && <span className="muted small">{source}</span>}
      {dirty && (
        <button className="btn small" disabled={busy} onClick={save}>
          {t('common.save')}
        </button>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** Apoios registrados: os conferidos na Apoia.se (um por conta e mês) e os do Ko-fi, se ligado. */
export function PaymentsPanel() {
  const t = useT();
  const locale = useLocale();
  const [list, setList] = useState<SupporterPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.admin
      .payments()
      .then(setList)
      .catch((e) => setError(errorText(e)));
  }, []);
  return (
    <div className="admin-payments">
      <p className="muted small">{t('admin.paymentsHelp')}</p>
      {error && <div className="error">{error}</div>}
      {list === null && !error && <p className="muted">{t('common.loading')}</p>}
      {list?.length === 0 && <p className="muted">{t('admin.paymentsEmpty')}</p>}
      {list && list.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.colDate')}</th>
              <th>{t('admin.colKind')}</th>
              <th>{t('admin.colPlan')}</th>
              <th>{t('admin.colValue')}</th>
              <th>{t('admin.colAccount')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.paidAt, locale)}</td>
                <td>{p.kind}</td>
                <td>{p.tier ? TIER_LABEL[p.tier] : '—'}</td>
                <td>{p.amount.toLocaleString(locale, { style: 'currency', currency: p.currency || 'BRL' })}</td>
                <td>{p.userName ?? <span className="muted">{t('admin.noAccount', { email: p.email ?? '—' })}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const EMPTY_SPONSOR: SponsorInput = { name: '', url: null, offer: null, placements: ['tournaments'], startsAt: null, endsAt: null, sort: 0 };
const MAX_LOGO_KB = 300;

/** Formulário de uma loja (nova ou existente). */
function SponsorForm({ initial, onSaved, onCancel }: { initial?: AdminSponsor; onSaved: (sp: AdminSponsor) => void; onCancel?: () => void }) {
  const t = useT();
  const [form, setForm] = useState<SponsorInput>(() =>
    initial
      ? {
          name: initial.name,
          url: initial.url,
          offer: initial.offer,
          placements: initial.placements,
          startsAt: initial.startsAt?.slice(0, 10) ?? null,
          // O fim é gravado como 23:59:59 de Brasília (02:59:59 UTC do dia seguinte).
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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const placements = [
    ['tournaments', t('admin.placementTournaments')],
    ['home', t('admin.placementHome')],
  ] as const;
  return (
    <div className="sponsor-form">
      <div className="tour-form-row">
        <label className="field">
          <span className="muted small">{t('admin.sponsorName')}</span>
          <input className="admin-search" maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">{t('admin.sponsorUrl')}</span>
          <input className="admin-search" placeholder="https://" value={form.url ?? ''} onChange={(e) => set('url', e.target.value || null)} />
        </label>
      </div>
      <label className="field">
        <span className="muted small">{t('admin.sponsorOffer')}</span>
        <input
          className="admin-search"
          maxLength={160}
          placeholder={t('admin.sponsorOfferPlaceholder')}
          value={form.offer ?? ''}
          onChange={(e) => set('offer', e.target.value || null)}
        />
      </label>
      <div className="tour-form-row">
        <label className="field">
          <span className="muted small">{t('admin.sponsorStart')}</span>
          <input className="admin-search" type="date" value={form.startsAt ?? ''} onChange={(e) => set('startsAt', e.target.value || null)} />
        </label>
        <label className="field">
          <span className="muted small">{t('admin.sponsorEnd')}</span>
          <input className="admin-search" type="date" value={form.endsAt ?? ''} onChange={(e) => set('endsAt', e.target.value || null)} />
        </label>
        <label className="field">
          <span className="muted small">{t('admin.sponsorOrder')}</span>
          <input className="admin-search" type="number" value={form.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} />
        </label>
      </div>
      <div className="sponsor-placements">
        {placements.map(([p, label]) => (
          <label key={p} className="check">
            <input type="checkbox" checked={form.placements.includes(p)} onChange={() => togglePlacement(p)} />
            {label}
          </label>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="btn-row">
        {onCancel && (
          <button className="btn small" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button className="btn small primary" disabled={busy || form.name.trim().length < 2} onClick={save}>
          {initial ? t('common.save') : t('admin.sponsorAdd')}
        </button>
      </div>
    </div>
  );
}

/** Lojas patrocinadoras: aparecem na página de torneios (e na home, se marcado) e no torneio que patrocinam. */
export function SponsorsPanel() {
  const t = useT();
  const [list, setList] = useState<AdminSponsor[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.admin
      .sponsors()
      .then(setList)
      .catch((e) => setError(errorText(e)));
  }, []);
  const replace = (sp: AdminSponsor) => setList((l) => (l?.some((x) => x.id === sp.id) ? l.map((x) => (x.id === sp.id ? sp : x)) : [...(l ?? []), sp]));
  const placementLabel = (p: 'tournaments' | 'home') => (p === 'home' ? t('admin.placementHome') : t('admin.placementTournaments'));
  const upload = (sp: AdminSponsor, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_KB * 1024) {
      setError(t('errors.sponsorLogoSize', { kb: MAX_LOGO_KB }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      api.admin
        .setSponsorLogo(sp.id, String(reader.result))
        .then((saved) => (replace(saved), setError(null)))
        .catch((e) => setError(errorText(e)));
    };
    reader.readAsDataURL(file);
  };
  const remove = async (sp: AdminSponsor) => {
    if (!window.confirm(t('admin.sponsorDeleteConfirm', { name: sp.name }))) return;
    try {
      await api.admin.deleteSponsor(sp.id);
      setList((l) => l?.filter((x) => x.id !== sp.id) ?? null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="admin-sponsors">
      <p className="muted small">{t('admin.sponsorsHelp', { kb: MAX_LOGO_KB })}</p>
      {error && <div className="error">{error}</div>}
      {list === null && !error && <p className="muted">{t('common.loading')}</p>}
      {list?.map((sp) => (
        <div key={sp.id} className="admin-user admin-sponsor">
          {sp.logoUrl ? <img className="account-avatar" src={sp.logoUrl} alt="" /> : <span className="account-avatar">{sp.name.slice(0, 1)}</span>}
          <span className="account-who">
            <strong>
              {sp.name} {!sp.active && <span className="muted small">{t('admin.sponsorInactive')}</span>}
            </strong>
            <span className="muted small">
              {sp.placements.map(placementLabel).join(' · ')}
              {sp.offer ? ` · ${sp.offer}` : ''}
            </span>
          </span>
          <div className="btn-row">
            <label className="btn small">
              {t('admin.sponsorLogo')}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(sp, e.target.files?.[0])} />
            </label>
            <button className="btn small" onClick={() => setEditing(editing === sp.id ? null : sp.id)}>
              {t('admin.sponsorEdit')}
            </button>
            <button className="btn small danger" onClick={() => remove(sp)}>
              {t('admin.sponsorDelete')}
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
      <h3>{t('admin.sponsorNew')}</h3>
      <SponsorForm onSaved={replace} />
    </div>
  );
}
