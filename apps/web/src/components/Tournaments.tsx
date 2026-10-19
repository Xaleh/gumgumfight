import { FORMATS } from '@gumgum/engine';
import { Fragment, lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import {
  type AdminSponsor,
  api,
  canPlay,
  type DeckSummary,
  isAdmin,
  type OnlineSeat,
  type OrganizeLimits,
  type PublicSponsor,
  STRUCTURE_LABEL,
  type TournamentDetail,
  type TournamentIncidents,
  type TournamentInput,
  type TournamentMatchInfo,
  type TournamentStage,
  type TournamentSummary,
  type TournamentWarnings,
  TOURNAMENT_STATUS_LABEL,
  TIER_LABEL,
  tourFormatLabel,
  type WatchTarget,
  winsNeeded,
} from '../api';
import { useAuth } from '../auth';
import type { GameSetup } from '../game/useGame';
import { type Locale, type MessageKey, type Translate, tryT, useLocale, useT } from '../i18n';
import { fmtDateTime, fmtTime } from '../i18n/format';
import { useNow } from './HomeBlocks';
import { Icon } from './Icons';
import { LeaderArt } from './LeaderArt';
import { openReplay, ReportsPanel } from './Reports';
import { SupportModal } from './Support';

/** Kit de divulgação: carregado só quando aberto (desenho em canvas e geradores de ZIP/PDF). */
const TournamentRecap = lazy(() => import('./TournamentRecap'));
/** Lobby do torneio (mesas em cartões, relógios para o Judge): carregado quando aberto. */
const TournamentLobby = lazy(() => import('./TournamentLobby'));

// Neste arquivo `t` costuma ser o torneio; a função de tradução (`useT()`) se chama `tr`.

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateTime = (iso: string | null, locale: Locale) => (iso ? fmtDateTime(iso, locale) : null);

/** ISO → valor do <input type="datetime-local"> (hora local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const time = (iso: string | null, locale: Locale) => (iso ? fmtTime(iso, locale) : null);

/** Junta trechos independentes com " · " (os vazios somem). */
const dots = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(' · ');

/** "restam 4min30s" (ou "o prazo acabou"). */
const remaining = (tr: Translate, deadline: string, now: number) => {
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  if (!left) return tr('tour.deadlineOver');
  return tr('tour.remaining', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') });
};

/** Minutos de um intervalo em ms ("30 min"). */
const minutes = (tr: Translate, ms: number) => tr('tour.minutes', { n: Math.round(ms / 60_000) });

/** 1050000 → "17min30s". */
const clock = (tr: Translate, ms: number) => {
  const s = Math.round(ms / 1000);
  return s % 60 ? tr('tour.clockMinSec', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }) : tr('tour.clockMin', { m: Math.floor(s / 60) });
};

/** Fases da eliminatória que o organizador pode escolher (vagas; 256 = toda a eliminatória). */
const PHASES = [256, 32, 16, 8, 4, 2];
const TOP_CUTS = [2, 4, 8, 16, 32, 64];

/** Nome da fase da eliminatória pelo número de vagas (mesma regra do servidor). */
export function phaseName(tr: Translate, size: number): string {
  if (size <= 2) return tr('tour.phase.final');
  if (size === 4) return tr('tour.phase.semi');
  if (size === 8) return tr('tour.phase.quarter');
  if (size === 16) return tr('tour.phase.r16');
  return tr('tour.phase.roundOf', { n: size });
}

/** A fase em minúsculas, no meio de uma frase ("quartas de final"). */
function phaseLower(tr: Translate, size: number): string {
  if (size <= 2) return tr('tour.phaseLow.final');
  if (size === 4) return tr('tour.phaseLow.semi');
  if (size === 8) return tr('tour.phaseLow.quarter');
  if (size === 16) return tr('tour.phaseLow.r16');
  return tr('tour.phaseLow.roundOf', { n: size });
}

/** "das quartas de final", "da final"… */
function phaseFrom(tr: Translate, size: number): string {
  if (size >= 256) return tr('tour.phaseFrom.start');
  if (size <= 2) return tr('tour.phaseFrom.final');
  if (size === 4) return tr('tour.phaseFrom.semi');
  if (size === 8) return tr('tour.phaseFrom.quarter');
  if (size === 16) return tr('tour.phaseFrom.r16');
  return tr('tour.phaseFrom.roundOf', { n: size });
}

/** Nome curto da fase para os botões das rodadas. */
function shortPhase(tr: Translate, size: number): string {
  if (size <= 2) return tr('tour.phaseShort.final');
  if (size === 4) return tr('tour.phaseShort.semi');
  if (size === 8) return tr('tour.phaseShort.quarter');
  if (size === 16) return tr('tour.phaseShort.r16');
  return tr('tour.phaseShort.roundOf', { n: size });
}

/** Vagas da fase eliminatória de uma rodada (cada mesa tem 2 vagas). */
const roundSize = (r: { matches: unknown[] }) => r.matches.length * 2;

/**
 * Rótulo da rodada, no idioma da interface. Mesma regra do `label` que o servidor manda
 * (fase pelo nº de mesas na eliminatória; "Rodada N" no suíço).
 */
const roundLabel = (tr: Translate, r: { round: number; stage: TournamentStage; matches: unknown[] }) =>
  r.stage === 'elim' ? phaseName(tr, roundSize(r)) : tr('tour.roundN', { n: r.round });

/** "Melhor de 3" (ou "Jogo único"). */
const bestOfLabel = (tr: Translate, n: number) => (n === 1 ? tr('tour.singleGame') : tr('tour.bestOf', { n }));

/** Mensagem com trechos em JSX: os `{slot}` que ficaram sem preencher no `tr()` viram os elementos de `slots`. */
function rich(text: string, slots: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in slots ? <Fragment key={i}>{slots[m[1]]}</Fragment> : part;
  });
}

/**
 * Torneios: a lista, a página de cada torneio (inscrição, rodadas, classificação e
 * inscritos) e, para organizadores e admins, a criação e o gerenciamento.
 */
export function Tournaments({
  initialId,
  initialLobby,
  onExit,
  onPlay,
  onWatch,
  onReplay,
}: {
  initialId?: string;
  /** Abre direto o lobby do torneio (toque na notificação de chamado de Judge). */
  initialLobby?: boolean;
  onExit: () => void;
  /** Entra na sala online da partida do torneio. */
  onPlay: (seat: OnlineSeat, tournamentId: string) => void;
  onWatch: (target: WatchTarget, tournamentId: string) => void;
  /** Abre o replay gravado de um jogo (auditoria). */
  onReplay: (setup: GameSetup, tournamentId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  /** Criando um torneio: o limite de jogadores de quem cria (null = não está criando). */
  const [creating, setCreating] = useState<number | null>(null);

  if (creating !== null) {
    return (
      <TournamentForm
        cap={creating}
        onCancel={() => setCreating(null)}
        onSaved={(t) => {
          setCreating(null);
          setOpenId(t.id);
        }}
      />
    );
  }
  if (openId) {
    return (
      <TournamentPage
        id={openId}
        initialLobby={initialLobby}
        onExit={onExit}
        onDeleted={() => setOpenId(null)}
        onPlay={(seat) => onPlay(seat, openId)}
        onWatch={(t) => onWatch(t, openId)}
        onReplay={(setup) => onReplay(setup, openId)}
      />
    );
  }
  return <TournamentList onExit={onExit} onOpen={setOpenId} onCreate={setCreating} />;
}

// ------------------------------------------------------------------ torneio do time e lojas parceiras

/** Selos do torneio: do time, prêmio, loja e inscrição antecipada. */
function OfficialBadges({
  t,
  hideSponsor,
}: {
  t: Pick<TournamentSummary, 'official' | 'prize' | 'sponsor' | 'priorityUntil' | 'status'>;
  /** Na página do torneio a loja aparece com o logo logo abaixo. */
  hideSponsor?: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  if (!t.official && !t.prize && !t.sponsor) return null;
  const early = t.priorityUntil && Date.parse(t.priorityUntil) > Date.now() && t.status === 'registration';
  return (
    <span className="tour-official-line">
      {t.official && <span className="tour-badge official">{tr('tour.officialBadge')}</span>}
      {t.prize && <span className="tour-prize">🏆 {t.prize}</span>}
      {t.sponsor && !hideSponsor && <span className="muted small">{tr('tour.sponsoredBy', { name: t.sponsor.name })}</span>}
      {early && <span className="muted small">{tr('tour.priorityUntil', { date: dateTime(t.priorityUntil, locale) })}</span>}
    </span>
  );
}

function SponsorCard({ sp }: { sp: PublicSponsor }) {
  const inner = (
    <>
      {sp.logoUrl ? <img src={sp.logoUrl} alt="" loading="lazy" /> : <span className="sponsor-initial">{sp.name.slice(0, 1)}</span>}
      <span className="sponsor-text">
        <b>{sp.name}</b>
        {sp.offer && <span className="small">{sp.offer}</span>}
      </span>
    </>
  );
  return sp.url ? (
    <a className="sponsor-card" href={sp.url} target="_blank" rel="noopener noreferrer sponsored">
      {inner}
    </a>
  ) : (
    <div className="sponsor-card">{inner}</div>
  );
}

/** Faixa "Lojas parceiras" com o convite para novas lojas. */
export function SponsorsStrip({ placement, hideEmpty }: { placement: 'tournaments' | 'home'; /** Sem lojas, nem mostra o convite. */ hideEmpty?: boolean }) {
  const tr = useT();
  const [data, setData] = useState<{ sponsors: PublicSponsor[]; contactUrl: string | null } | null>(null);
  useEffect(() => {
    api
      .sponsors(placement)
      .then(setData)
      .catch(() => setData(null));
  }, [placement]);
  if (!data || (!data.sponsors.length && (!data.contactUrl || hideEmpty))) return null;
  return (
    <section className="menu-card sponsors-strip" aria-label={tr('sponsors.title')}>
      <div className="sponsors-head">
        <h3>
          <Icon name="store" size={18} /> {tr('sponsors.title')}
        </h3>
        {data.contactUrl && (
          <a className="text-link small" href={data.contactUrl} target="_blank" rel="noopener noreferrer">
            {tr('sponsors.become')}
          </a>
        )}
      </div>
      {data.sponsors.length > 0 ? (
        <div className="sponsors-list">
          {data.sponsors.map((sp) => (
            <SponsorCard key={sp.id} sp={sp} />
          ))}
        </div>
      ) : (
        <p className="muted small">{tr('sponsors.empty')}</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ lista

function TournamentList({ onExit, onOpen, onCreate }: { onExit: () => void; onOpen: (id: string) => void; onCreate: (cap: number) => void }) {
  const { user, config } = useAuth();
  const tr = useT();
  const locale = useLocale();
  const [data, setData] = useState<{ tournaments: TournamentSummary[]; canCreate: boolean; organize: OrganizeLimits | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const quota = data?.organize?.kind === 'supporter' ? data.organize : null;

  useEffect(() => {
    let stop = false;
    api.tournaments
      .list()
      .then((d) => !stop && (setData(d), setError(null)))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [user?.id]);

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {tr('tour.backMenu')}
        </button>
        <h2>{tr('tour.title')}</h2>
        {data?.canCreate && (
          <button className="btn small primary tour-create" onClick={() => onCreate(data.organize?.maxPlayers ?? 256)}>
            {tr('tour.create')}
          </button>
        )}
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}
        {!user && <p className="muted small">{tr('tour.signInToRegister')}</p>}
        {quota && (
          <p className="muted small tour-quota">{tr('tour.quota', { used: quota.used, perMonth: quota.perMonth, max: quota.maxPlayers })}</p>
        )}
        {data && !data.organize && config?.support && (
          <p className="small tour-quota">
            {tr('tour.quotaInvite', { n: 5 })}{' '}
            <button className="text-link" onClick={() => setShowSupport(true)}>
              {tr('tour.quotaInviteLink')}
            </button>
          </p>
        )}
        {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
        <SponsorsStrip placement="tournaments" />
        {data === null && !error && <p className="muted">{tr('common.loading')}</p>}
        {data?.tournaments.length === 0 && <p className="muted">{tr(data.canCreate ? 'tour.emptyCreate' : 'tour.emptyOrganizer')}</p>}
        <div className="tour-list">
          {data?.tournaments.map((t) => (
            <button key={t.id} className={['tour-card', t.official ? 'official' : ''].join(' ')} onClick={() => onOpen(t.id)}>
              <div className="tour-card-head">
                <strong>{t.name}</strong>
                <span className={['tour-status', t.status].join(' ')}>{tr(TOURNAMENT_STATUS_LABEL[t.status])}</span>
              </div>
              <OfficialBadges t={t} />
              <span className="muted small">
                {dots(
                  tourFormatLabel(t),
                  t.topCut ? tr('tour.plusTopCut', { text: tr(STRUCTURE_LABEL[t.structure]), n: t.topCut }) : tr(STRUCTURE_LABEL[t.structure]),
                  t.maxPlayers ? tr('tour.playersOfMax', { n: t.players, max: t.maxPlayers }) : tr('tour.playersCount', { n: t.players }),
                  t.status === 'running' &&
                    (t.totalRounds ? tr('tour.roundOfTotalShort', { n: t.round, total: t.totalRounds }) : tr('tour.roundN', { n: t.round })),
                )}
              </span>
              <span className="muted small">
                {dots(
                  t.organizerName ? tr('tour.organizedBy', { name: t.organizerName }) : null,
                  t.startsAt && t.status === 'registration' ? tr('tour.startsAt', { date: dateTime(t.startsAt, locale) }) : null,
                )}
              </span>
              {t.registered && <span className="tour-registered">{tr('tour.youRegistered')}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ criação e edição

function TournamentForm({
  initial,
  cap,
  onCancel,
  onSaved,
}: {
  initial?: TournamentDetail;
  /** Limite de jogadores de quem cria (plano de apoiador: 64). */
  cap: number;
  onCancel: () => void;
  onSaved: (t: TournamentDetail) => void;
}) {
  const tr = useT();
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [sponsors, setSponsors] = useState<AdminSponsor[]>([]);
  useEffect(() => {
    if (admin) api.admin.sponsors().then(setSponsors, () => setSponsors([]));
  }, [admin]);
  const [form, setForm] = useState<TournamentInput>(() => ({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    format: initial?.format ?? 'standard',
    spoilers: initial?.spoilers ?? false,
    structure: initial?.structure ?? 'swiss',
    rounds: initial && !initial.roundsAuto ? initial.swissRounds : null,
    swissBestOf: initial?.swissBestOf ?? 1,
    topCut: initial?.topCut ?? null,
    bo3From: initial?.bo3From ?? null,
    bo5From: initial?.bo5From ?? null,
    maxPlayers: initial?.maxPlayers ?? null,
    startsAt: initial?.startsAt ?? null,
    checkIn: initial?.checkIn ?? true,
    autoStart: initial?.autoStart ?? false,
    liveHands: initial?.liveHands ?? false,
    maxWarnings: initial?.maxWarnings ?? null,
    toleranceMin: initial?.toleranceMin ?? 5,
    official: initial?.official ?? false,
    prize: initial?.prize ?? null,
    sponsorId: initial?.sponsor?.id ?? null,
    priority: Boolean(initial?.priorityUntil),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TournamentInput>(k: K, v: TournamentInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Sem data de início não há check-in nem início automático.
      const checkIn = form.checkIn && Boolean(form.startsAt);
      const input = { ...form, checkIn, autoStart: checkIn && form.autoStart };
      onSaved(initial ? await api.tournaments.update(initial.id, input) : await api.tournaments.create(input));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onCancel}>
          {tr('tour.back')}
        </button>
        <h2>{tr(initial ? 'tour.editTitle' : 'tour.newTitle')}</h2>
      </header>
      <div className="coverage-body">
        <section className="menu-card tour-form">
          <div className="field">
            <label htmlFor="tour-name">{tr('tour.name')}</label>
            <input id="tour-name" className="admin-search" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tour-desc">{tr('tour.description')}</label>
            <textarea
              id="tour-desc"
              className="admin-search"
              rows={4}
              maxLength={2000}
              placeholder={tr('tour.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="field">
            <label>{tr('tour.format')}</label>
            {/* Três opções: o "Todas as cartas + spoilers" quebra em duas linhas no celular. */}
            <div className="seg small tour-format">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={form.format === f.id && !form.spoilers ? 'on' : ''}
                  onClick={() => setForm((x) => ({ ...x, format: f.id, spoilers: false }))}
                >
                  {f.label}
                </button>
              ))}
              <button className={form.spoilers ? 'on' : ''} onClick={() => setForm((x) => ({ ...x, format: 'egb', spoilers: true }))}>
                {tr('tour.formatSpoilers')}
              </button>
            </div>
            <p className="muted small">{tr(form.spoilers ? 'tour.formatSpoilersHint' : 'tour.formatReleasedHint')}</p>
          </div>
          <div className="field">
            <label>{tr('tour.structure')}</label>
            <div className="seg small">
              {(['swiss', 'single'] as const).map((s) => (
                <button key={s} className={form.structure === s ? 'on' : ''} onClick={() => set('structure', s)}>
                  {tr(STRUCTURE_LABEL[s])}
                </button>
              ))}
            </div>
            <p className="muted small">{tr(form.structure === 'swiss' ? 'tour.swissHint' : 'tour.singleHint')}</p>
          </div>
          {form.structure === 'swiss' && (
            <div className="tour-form-row">
              <div className="field">
                <label htmlFor="tour-rounds">{tr('tour.rounds')}</label>
                <input
                  id="tour-rounds"
                  className="admin-search"
                  type="number"
                  min={1}
                  max={15}
                  placeholder={tr('tour.auto')}
                  value={form.rounds ?? ''}
                  onChange={(e) => set('rounds', num(e.target.value))}
                />
              </div>
              <div className="field">
                <label>{tr('tour.swissMatches')}</label>
                <div className="seg small">
                  {[1, 3].map((n) => (
                    <button key={n} className={form.swissBestOf === n ? 'on' : ''} onClick={() => set('swissBestOf', n)}>
                      {bestOfLabel(tr, n)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="tour-cut">{tr('tour.topCut')}</label>
                <select
                  id="tour-cut"
                  className="admin-search"
                  value={form.topCut ?? ''}
                  onChange={(e) => set('topCut', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{tr('tour.noTopCut')}</option>
                  {TOP_CUTS.map((n) => (
                    <option key={n} value={n}>
                      {tr('tour.topCutOption', { n, phase: phaseLower(tr, n) })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {(form.structure === 'single' || form.topCut !== null) && (
            <>
              <div className="tour-form-row">
                {(
                  [
                    ['bo3From', 'tour.bo3From', 'tour-bo3'],
                    ['bo5From', 'tour.bo5From', 'tour-bo5'],
                  ] as const
                ).map(([key, label, id]) => (
                  <div className="field" key={key}>
                    <label htmlFor={id}>{tr(label)}</label>
                    <select
                      id={id}
                      className="admin-search"
                      value={form[key] ?? ''}
                      onChange={(e) => set(key, e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">{tr('tour.never')}</option>
                      {PHASES.map((size) => (
                        <option key={size} value={size}>
                          {size >= 256 ? tr('tour.phase.all') : phaseName(tr, size)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="muted small">{tr('tour.bestOfHint')}</p>
            </>
          )}
          <div className="tour-form-row">
            <div className="field">
              <label htmlFor="tour-max">{tr('tour.maxPlayers')}</label>
              <input
                id="tour-max"
                className="admin-search"
                type="number"
                min={2}
                max={cap}
                placeholder={cap < 256 ? tr('tour.capPlaceholder', { max: cap }) : tr('tour.noLimit')}
                value={form.maxPlayers ?? ''}
                onChange={(e) => set('maxPlayers', num(e.target.value))}
              />
              {cap < 256 && <p className="muted small">{tr('tour.capHint', { max: cap })}</p>}
            </div>
            <div className="field">
              <label htmlFor="tour-start">{tr('tour.startsAtLabel')}</label>
              <input
                id="tour-start"
                className="admin-search"
                type="datetime-local"
                value={toLocalInput(form.startsAt)}
                onChange={(e) => set('startsAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
              />
            </div>
          </div>
          {form.startsAt ? (
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={form.checkIn} onChange={(e) => set('checkIn', e.target.checked)} />
                {tr('tour.checkInOption')}
              </label>
              <p className="muted small">{tr('tour.checkInHint')}</p>
              {form.checkIn && (
                <>
                  <div className="tour-form-row">
                    <div className="field">
                      <label htmlFor="tour-tolerance">{tr('tour.tolerance')}</label>
                      <input
                        id="tour-tolerance"
                        className="admin-search"
                        type="number"
                        min={1}
                        max={60}
                        value={form.toleranceMin}
                        onChange={(e) => set('toleranceMin', Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                      />
                    </div>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={form.autoStart} onChange={(e) => set('autoStart', e.target.checked)} />
                    {tr('tour.autoStartOption')}
                  </label>
                  <p className="muted small">{tr(form.autoStart ? 'tour.autoStartOnHint' : 'tour.autoStartOffHint')}</p>
                </>
              )}
            </div>
          ) : (
            <p className="muted small">{tr('tour.noStartHint')}</p>
          )}
          <div className="field">
            <label htmlFor="tour-warnings">{tr('tour.maxWarnings')}</label>
            <select
              id="tour-warnings"
              className="admin-search"
              value={form.maxWarnings ?? ''}
              onChange={(e) => set('maxWarnings', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{tr('tour.maxWarningsNone')}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {tr('tour.maxWarningsN', { n })}
                </option>
              ))}
            </select>
            <p className="muted small">{tr('tour.maxWarningsHint')}</p>
          </div>
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={form.liveHands} onChange={(e) => set('liveHands', e.target.checked)} />
              {tr('tour.liveHandsOption')}
            </label>
            <p className="muted small">{tr('tour.liveHandsHint')}</p>
          </div>
          {form.structure === 'swiss' && <p className="muted small">{tr('tour.roundsAutoHint')}</p>}
          {admin && (
            <div className="field tour-official-form">
              <label className="check">
                <input type="checkbox" checked={Boolean(form.official)} onChange={(e) => set('official', e.target.checked)} />
                {tr('tour.officialCheck')}
              </label>
              {form.official && (
                <>
                  <div className="tour-form-row">
                    <div className="field">
                      <label htmlFor="tour-prize">{tr('tour.prize')}</label>
                      <input
                        id="tour-prize"
                        className="admin-search"
                        maxLength={200}
                        placeholder={tr('tour.prizePlaceholder')}
                        value={form.prize ?? ''}
                        onChange={(e) => set('prize', e.target.value || null)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="tour-sponsor">{tr('tour.sponsor')}</label>
                      <select
                        id="tour-sponsor"
                        className="admin-search"
                        value={form.sponsorId ?? ''}
                        onChange={(e) => set('sponsorId', e.target.value || null)}
                      >
                        <option value="">{tr('tour.sponsorNone')}</option>
                        {sponsors.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                            {sp.active ? '' : ` ${tr('tour.sponsorInactive')}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={Boolean(form.priority)} onChange={(e) => set('priority', e.target.checked)} />
                    {tr('tour.priorityCheck')}
                  </label>
                  <p className="muted small">{tr('tour.officialHint')}</p>
                </>
              )}
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="btn-row">
            <button className="btn" onClick={onCancel}>
              {tr('common.cancel')}
            </button>
            <button className="btn primary" disabled={saving || form.name.trim().length < 3} onClick={save}>
              {saving ? tr('common.saving') : initial ? tr('common.save') : tr('tour.createSubmit')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ página do torneio

type Tab = 'rounds' | 'standings' | 'players' | 'reports' | 'incidents';

/** Texto do botão de avançar, conforme o próximo passo. */
function nextLabel(tr: Translate, t: TournamentDetail): string {
  if (t.next === 'finish') return tr('tour.nextFinish');
  if (t.next === 'cut') return tr('tour.nextCut', { n: t.topCut });
  if (t.next === 'elim') {
    const current = t.rounds[t.round - 1]?.matches.length ?? 0;
    return tr('tour.nextPhase', { phase: phaseName(tr, current) });
  }
  return tr('tour.nextRound', { n: t.round + 1 });
}

function TournamentPage({
  id,
  initialLobby,
  onExit,
  onDeleted,
  onPlay,
  onWatch,
  onReplay,
}: {
  id: string;
  initialLobby?: boolean;
  /** Volta para o menu principal. */
  onExit: () => void;
  onDeleted: () => void;
  onPlay: (seat: OnlineSeat) => void;
  onWatch: (t: WatchTarget) => void;
  onReplay: (setup: GameSetup) => void;
}) {
  const { user } = useAuth();
  const tr = useT();
  const locale = useLocale();
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [viewRound, setViewRound] = useState<number | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [lobbyOpen, setLobbyOpen] = useState(Boolean(initialLobby));

  const load = useCallback(
    () =>
      api.tournaments
        .get(id)
        .then((d) => setT(d))
        .catch((e) => setError(errorText(e))),
    [id],
  );

  // Os resultados das partidas online chegam sozinhos: atualiza a cada 5 s durante o torneio.
  useEffect(() => {
    void load();
  }, [load, user?.id]);
  useEffect(() => {
    if (t?.status !== 'running') return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [t?.status, load]);

  /** Ação que devolve o torneio atualizado. */
  const run = async (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) setT(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (lobbyOpen && t) {
    return (
      <Suspense fallback={<p className="muted">{tr('common.loading')}</p>}>
        <TournamentLobby
          id={t.id}
          onClose={() => setLobbyOpen(false)}
          onPlay={onPlay}
          onWatch={onWatch}
          run={run}
          busy={busy}
        />
      </Suspense>
    );
  }

  if (editing && t) {
    return (
      <TournamentForm
        initial={t}
        cap={t.maxPlayersCap}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setT(saved);
          setEditing(false);
        }}
      />
    );
  }

  const activeTab: Tab = tab ?? (t?.status === 'registration' ? 'players' : t?.status === 'finished' ? 'standings' : 'rounds');
  const shownRound = viewRound ?? t?.round ?? 0;
  const lastRound = t?.next === 'finish';
  const current = t?.rounds[t.round - 1];

  /** "Suíço (5 rodadas) em melhor de 3 + Top 8": estrutura com rodadas, série e top cut. */
  const structureText = (t: TournamentDetail) => {
    let text = tr(STRUCTURE_LABEL[t.structure]);
    if (t.structure === 'swiss') {
      text =
        t.roundsAuto && t.status === 'registration'
          ? tr('tour.swissAutoRounds', { structure: text })
          : tr('tour.swissNRounds', { structure: text, n: t.swissRounds ?? t.totalRounds });
    }
    if (t.structure === 'swiss' && t.swissBestOf > 1) text = tr('tour.swissBestOf', { text, n: t.swissBestOf });
    if (t.topCut) text = tr('tour.plusTopCut', { text, n: t.topCut });
    return text;
  };

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {tr('tour.backMenu')}
        </button>
        <h2>{t?.name ?? tr('tour.tournament')}</h2>
      </header>
      <div className="coverage-body tour-page">
        {error && <div className="error">{error}</div>}
        {!t && !error && <p className="muted">{tr('common.loading')}</p>}
        {t && (
          <>
            <section className="menu-card tour-info">
              <div className="tour-card-head">
                <span className={['tour-status', t.status].join(' ')}>{tr(TOURNAMENT_STATUS_LABEL[t.status])}</span>
                {t.status === 'running' && current && (
                  <strong>
                    {dots(
                      current.stage === 'elim' ? roundLabel(tr, current) : tr('tour.roundOfTotal', { n: t.round, total: t.swissRounds ?? t.totalRounds }),
                      current.bestOf > 1 && bestOfLabel(tr, current.bestOf),
                    )}
                  </strong>
                )}
              </div>
              <p className="muted small">
                {dots(
                  tourFormatLabel(t),
                  structureText(t),
                  t.maxPlayers
                    ? tr('tour.registeredOfMax', { n: t.players.length, max: t.maxPlayers })
                    : tr('tour.registeredCount', { n: t.players.length }),
                  t.organizerName && tr('tour.organizedBy', { name: t.organizerName }),
                  t.startsAt && t.status === 'registration' && tr('tour.startsAt', { date: dateTime(t.startsAt, locale) }),
                )}
              </p>
              {t.checkIn && t.status === 'registration' && (
                <p className="small tour-checkin-info">
                  {dots(
                    t.checkInOpen
                      ? tr('tour.checkInOpen', { before: minutes(tr, t.checkInMs) })
                      : tr('tour.checkInOpensAt', { time: time(t.checkInOpensAt, locale), before: minutes(tr, t.checkInMs) }),
                    t.autoStart ? tr('tour.autoStart', { date: dateTime(t.startsAt, locale) }) : tr('tour.manualStart', { date: dateTime(t.startsAt, locale) }),
                    tr('tour.checkedInCount', { n: t.checkedIn, total: t.players.length }),
                  )}
                </p>
              )}
              {t.checkIn && t.status === 'running' && <p className="muted small">{tr('tour.toleranceInfo', { tolerance: minutes(tr, t.toleranceMs) })}</p>}
              {t.maxWarnings !== null && <p className="muted small">{tr('tour.maxWarningsInfo', { n: t.maxWarnings })}</p>}
              {t.liveHands && <p className="muted small">{tr('tour.liveHandsInfo')}</p>}
              {(t.judges.length > 0 || t.isJudge) && (
                <p className="small tour-judges-line">
                  <b>{tr('tour.judgesLabel')}</b> {t.judges.length ? t.judges.map((j) => j.name).join(', ') : tr('tour.judgeIsOrganizer')}
                  {t.isJudge && <span className="tour-badge gold">{tr('tour.youAreJudge')}</span>}
                </p>
              )}
              {t.status !== 'finished' && (
                <div className="btn-row tour-lobby-row">
                  <button className="btn primary small" onClick={() => setLobbyOpen(true)}>
                    {t.openCalls.length ? tr('tour.openLobbyCalls', { n: t.openCalls.length }) : tr('tour.openLobby')}
                  </button>
                </div>
              )}
              {(t.bo3From || t.bo5From) && (
                <p className="muted small">
                  {tr('tour.elimLine', {
                    rules: [
                      t.bo3From ? tr('tour.elimBo3', { phase: phaseFrom(tr, t.bo3From) }) : null,
                      t.bo5From ? tr('tour.elimBo5', { phase: phaseFrom(tr, t.bo5From) }) : null,
                    ]
                      .filter(Boolean)
                      .join('; '),
                  })}
                </p>
              )}
              <p className="muted small">{tr('tour.clockInfo', { clock: clock(tr, t.clockMs) })}</p>
              <OfficialBadges t={t} hideSponsor />
              {t.sponsor && (
                <div className="tour-sponsor">
                  <span className="muted small">{tr('tour.sponsorLabel')}</span>
                  <SponsorCard sp={t.sponsor} />
                </div>
              )}
              {t.description && <p className="tour-desc">{t.description}</p>}
              {t.status === 'finished' && t.standings[0] && (
                <p className="tour-champion">{rich(tr('tour.champion'), { name: <b>{t.standings[0].name}</b> })}</p>
              )}
            </section>

            <MyArea t={t} busy={busy} run={run} onPlay={onPlay} setError={setError} />

            {t.canManage && (
              <section className="menu-card tour-manage">
                <h2>{tr('tour.manage')}</h2>
                {t.staleDecks && t.staleDecks.length > 0 && (
                  <div className="error">{tr('tour.staleDecks', { n: t.staleDecks.length, names: t.staleDecks.join(', ') })}</div>
                )}
                <div className="btn-row">
                  {t.status === 'registration' && (
                    <>
                      <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
                        {tr('tour.edit')}
                      </button>
                      <button
                        className="btn primary"
                        disabled={busy || t.players.length < 2}
                        title={t.players.length < 2 ? tr('tour.needTwo') : undefined}
                        onClick={() =>
                          run(() => api.tournaments.start(t.id), tr('tour.confirmStart', { n: t.players.length })).then(() => {
                            setTab('rounds');
                            setViewRound(null);
                          })
                        }
                      >
                        {tr('tour.start')}
                      </button>
                    </>
                  )}
                  {t.status === 'running' && !t.roundStartedAt && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(() => api.tournaments.beginRound(t.id), tr('tour.confirmBeginRound', { ready: t.readyTables, tables: t.tables }))}
                    >
                      {tr('tour.beginRound', { ready: t.readyTables, tables: t.tables })}
                    </button>
                  )}
                  {t.status === 'running' && (
                    <>
                      <button
                        className="btn primary"
                        disabled={busy || !t.roundComplete || t.warningsPending.length > 0}
                        title={t.roundComplete ? (t.warningsPending.length ? tr('tour.warningsPendingTitle') : undefined) : tr('tour.roundIncomplete')}
                        onClick={() =>
                          run(() => api.tournaments.next(t.id), lastRound ? tr('tour.confirmLastRound') : undefined).then(() => setViewRound(null))
                        }
                      >
                        {nextLabel(tr, t)}
                      </button>
                      {!lastRound && (
                        <button className="btn" disabled={busy} onClick={() => run(() => api.tournaments.finish(t.id), tr('tour.confirmFinish'))}>
                          {tr('tour.finishNow')}
                        </button>
                      )}
                    </>
                  )}
                  {t.status === 'finished' && (
                    <button className="btn primary" disabled={busy} onClick={() => setRecapOpen(true)}>
                      {tr('recap.button')}
                    </button>
                  )}
                  <button
                    className="btn danger"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.tournaments.remove(t.id);
                        onDeleted();
                      }, tr('tour.confirmDelete', { name: t.name }))
                    }
                  >
                    {tr('tour.delete')}
                  </button>
                </div>
                {t.status === 'running' && !t.roundStartedAt && <p className="muted small">{tr('tour.beginRoundHint')}</p>}
                {t.warningsPending.length > 0 && (
                  <WarningsPending t={t} busy={busy} run={run} />
                )}
                {t.lateWindow && <LateEntry t={t} busy={busy} run={run} />}
                {t.status !== 'finished' && <Judges t={t} busy={busy} run={run} />}
                {t.status === 'registration' && t.checkIn && (
                  <p className="muted small">
                    {t.autoStart
                      ? tr('tour.autoStartHint', { date: dateTime(t.startsAt, locale), tolerance: minutes(tr, t.toleranceMs) })
                      : tr('tour.manualStartHint', { date: dateTime(t.startsAt, locale), tolerance: minutes(tr, t.toleranceMs) })}
                  </p>
                )}
                {t.status === 'finished' && <p className="muted small">{tr('recap.hint')}</p>}
                {t.status !== 'registration' && <p className="muted small">{tr('tour.manageHint')}</p>}
              </section>
            )}
            {recapOpen && t.canManage && (
              <Suspense fallback={null}>
                <TournamentRecap id={t.id} onClose={() => setRecapOpen(false)} />
              </Suspense>
            )}

            <div className="seg tour-tabs">
              {t.status !== 'registration' && (
                <button className={activeTab === 'rounds' ? 'on' : ''} onClick={() => setTab('rounds')}>
                  {tr('tour.tabRounds')}
                </button>
              )}
              {t.status !== 'registration' && (
                <button className={activeTab === 'standings' ? 'on' : ''} onClick={() => setTab('standings')}>
                  {tr('tour.tabStandings')}
                </button>
              )}
              <button className={activeTab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
                {tr('tour.tabPlayers', { n: t.players.length })}
              </button>
              {t.canManage && t.status !== 'registration' && (
                <button className={activeTab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
                  {t.openReports ? tr('tour.tabReportsCount', { n: t.openReports }) : tr('tour.tabReports')}
                </button>
              )}
              {t.isJudge && t.status !== 'registration' && (
                <button className={activeTab === 'incidents' ? 'on' : ''} onClick={() => setTab('incidents')}>
                  {tr('tour.tabIncidents')}
                </button>
              )}
            </div>

            {activeTab === 'rounds' && t.round > 0 && (
              <section className="menu-card">
                {t.round > 1 && (
                  <div className="seg small tour-rounds">
                    {t.rounds.map((r) => (
                      <button
                        key={r.round}
                        className={shownRound === r.round ? 'on' : ''}
                        title={roundLabel(tr, r)}
                        onClick={() => setViewRound(r.round)}
                      >
                        {r.stage === 'elim' ? shortPhase(tr, roundSize(r)) : r.round}
                      </button>
                    ))}
                  </div>
                )}
                {t.rounds[shownRound - 1] && (
                  <h3 className="tour-round-title">
                    {roundLabel(tr, t.rounds[shownRound - 1])}
                    <span className="muted small"> · {bestOfLabel(tr, t.rounds[shownRound - 1].bestOf)}</span>
                  </h3>
                )}
                <div className="tour-matches">
                  {t.rounds[shownRound - 1]?.matches.map((m) => (
                    <MatchRow
                      key={m.id}
                      m={m}
                      editable={t.canManage && t.status !== 'registration'}
                      current={t.status === 'running' && shownRound === t.round}
                      deadline={shownRound === t.round ? t.deadline : null}
                      busy={busy}
                      canDrop={t.status === 'running'}
                      judge={t.isJudge}
                      started={Boolean(t.roundStartedAt)}
                      onScore={(wins) => run(() => api.tournaments.setScore(t.id, m.id, wins))}
                      onDouble={(dropBoth) => run(() => api.tournaments.doubleLoss(t.id, m.id, dropBoth))}
                      onWatch={() => m.roomId && onWatch({ roomId: m.roomId, hands: false, ...(t.isJudge ? { judge: true } : {}) })}
                      onReplay={(statsMatchId) => run(() => openReplay(statsMatchId, onReplay))}
                      replaysSealed={t.status === 'running' && !t.canManage && !t.isJudge && Boolean(user && (m.p1.userId === user.id || m.p2?.userId === user.id))}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'standings' && <Standings t={t} />}

            {activeTab === 'reports' && t.canManage && <ReportsPanel tournament={t.id} onReplay={onReplay} />}

            {activeTab === 'incidents' && t.isJudge && <Incidents t={t} busy={busy} run={run} />}

            {activeTab === 'players' && (
              <Players
                t={t}
                busy={busy}
                onDrop={(userId, name) =>
                  run(
                    () => api.tournaments.drop(t.id, userId),
                    t.status === 'registration' ? tr('tour.confirmRemove', { name }) : tr('tour.confirmDrop', { name }),
                  )
                }
                onReinstate={(userId, restore) => run(() => api.tournaments.reinstate(t.id, userId, restore))}
                onWarn={(userId, reason) => run(() => api.tournaments.warn(t.id, userId, reason))}
                onRevoke={(warningId) => run(() => api.tournaments.revokeWarning(t.id, warningId))}
                onKeep={(userId) => run(() => api.tournaments.keepPlayer(t.id, userId))}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Inscrição, a partida da rodada e a desistência de quem está vendo. */
function MyArea({
  t,
  busy,
  run,
  onPlay,
  setError,
}: {
  t: TournamentDetail;
  busy: boolean;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
  onPlay: (seat: OnlineSeat) => void;
  setError: (e: string | null) => void;
}) {
  const { user } = useAuth();
  const tr = useT();
  const locale = useLocale();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [deckId, setDeckId] = useState<string>(t.me?.deckId ?? '');

  /** Inscrição atrasada liberada (suíço, rodada 1): o mesmo formulário, entrando com uma derrota. */
  const late = t.status === 'running' && !t.me && t.canLateRegister;

  useEffect(() => {
    if ((t.status !== 'registration' && !late) || !user) return;
    let stop = false;
    api
      .decks()
      .then((d) => !stop && setDecks(d))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [t.status, late, user, setError]);

  if (!user) {
    return t.status === 'registration' ? (
      <section className="menu-card">
        <p className="muted small">{tr('tour.signInToRegisterHere')}</p>
      </section>
    ) : null;
  }

  // Judge do torneio (sem gerenciá-lo): não joga o torneio.
  if (!t.me && t.isJudge && !t.canManage && t.status !== 'finished') {
    return (
      <section className="menu-card tour-me">
        <p className="small">{tr('errors.judgeCannotRegister')}</p>
      </section>
    );
  }

  if (t.status === 'registration' || late) {
    const playable = decks?.filter((d) => canPlay(d, t.format, !t.spoilers)) ?? [];
    const mine = playable.filter((d) => d.kind === 'user' && d.mine);
    const others = playable.filter((d) => !(d.kind === 'user' && d.mine));
    const full = t.maxPlayers !== null && t.players.length >= t.maxPlayers && !t.me;
    return (
      <section className="menu-card tour-me">
        <h2>{tr(t.me ? 'tour.myRegistration' : late ? 'tour.lateRegistration' : 'tour.registration')}</h2>
        {late && <p className="small">{tr('tour.lateRegisterHint')}</p>}
        {t.me && <p className="small">{rich(tr('tour.registeredWith'), { deck: <b>{t.me.deckName}</b> })}</p>}
        {t.me?.deckIssue && (
          <div className="error">{tr('tour.deckIssue', { issue: tryT(t.me.deckIssue.code, t.me.deckIssue.params) ?? t.me.deckIssue.message })}</div>
        )}
        {t.me && t.checkIn && (
          <div className="tour-checkin">
            {t.me.checkedInAt ? (
              <p className="tour-my-result">{tr('tour.checkedInAt', { time: time(t.me.checkedInAt, locale), date: dateTime(t.startsAt, locale) })}</p>
            ) : t.checkInOpen ? (
              <>
                <button className="btn primary" disabled={busy} onClick={() => run(() => api.tournaments.checkIn(t.id))}>
                  {tr('tour.doCheckIn')}
                </button>
                <p className="muted small">{tr('tour.checkInNow', { date: dateTime(t.startsAt, locale), tolerance: minutes(tr, t.toleranceMs) })}</p>
              </>
            ) : (
              <p className="muted small">
                {tr('tour.checkInLater', {
                  time: time(t.checkInOpensAt, locale),
                  before: minutes(tr, t.checkInMs),
                  date: dateTime(t.startsAt, locale),
                })}
              </p>
            )}
          </div>
        )}
        {!late && !t.me && t.priorityOpen && !t.canRegister ? (
          <p className="muted">{tr('tour.priorityNotice', { date: dateTime(t.priorityUntil, locale) })}</p>
        ) : full ? (
          <p className="muted">{tr('tour.full')}</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tour-deck">{tr('tour.deckLabel', { format: tourFormatLabel(t) })}</label>
              <select id="tour-deck" className="admin-search" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">{tr(decks ? 'tour.chooseDeck' : 'common.loading')}</option>
                {mine.length > 0 && (
                  <optgroup label={tr('tour.myDecks')}>
                    {mine.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={tr('tour.otherDecks')}>
                    {others.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {decks && !playable.length && <p className="muted small">{tr(t.spoilers ? 'tour.noPlayableDeck' : 'tour.noPlayableDeckReleased', { format: tourFormatLabel(t) })}</p>}
            </div>
            <div className="btn-row">
              <button
                className="btn primary"
                disabled={busy || !deckId || (t.me?.deckId === deckId)}
                onClick={() => run(() => api.tournaments.register(t.id, deckId))}
              >
                {tr(t.me ? 'tour.changeDeck' : late ? 'tour.lateRegister' : 'tour.register')}
              </button>
              {t.me && (
                <button className="btn" disabled={busy} onClick={() => run(() => api.tournaments.leave(t.id), tr('tour.confirmLeave'))}>
                  {tr('tour.cancelRegistration')}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    );
  }

  if (!t.me) return null;
  if (t.status === 'finished') {
    const s = t.standings.find((x) => x.userId === user.id);
    return s ? (
      <section className="menu-card tour-me">
        <p>
          {rich(tr(t.structure === 'swiss' ? 'tour.finishedPlaceSwiss' : 'tour.finishedPlace', { wins: s.wins, losses: s.losses }), {
            rank: <b>{tr('tour.ordinal', { n: s.rank })}</b>,
          })}
        </p>
      </section>
    ) : null;
  }
  if (t.me.dropped) {
    return (
      <section className="menu-card tour-me">
        <p className="muted">{tr('tour.youDropped')}</p>
      </section>
    );
  }
  const round = t.rounds[t.round - 1];
  const m = round?.matches.find((x) => x.id === t.me!.matchId);
  const opp = m && (m.p1.userId === user.id ? m.p2 : m.p1);
  const mine = m && (m.p1.userId === user.id ? 0 : 1);
  return (
    <section className="menu-card tour-me">
      <h2>
        {dots(
          tr('tour.myMatch', { round: round ? roundLabel(tr, round) : tr('tour.roundN', { n: t.round }) }),
          m && m.bestOf > 1 && bestOfLabel(tr, m.bestOf),
        )}
      </h2>
      {!m ? (
        <p className="muted">{tr('tour.notInRound')}</p>
      ) : !opp ? (
        m.result === 'loss' ? (
          <p>{tr('tour.lateLossRound')}</p>
        ) : (
          <p>{rich(tr('tour.byeRound'), { bye: <b>{tr('tour.bye')}</b> })}</p>
        )
      ) : (
        <>
          <p>
            {rich(tr('tour.tableVs', { table: m.table }), { opp: <b>{opp.name}</b> })}
            {m.bestOf > 1 && (
              <>
                {' · '}
                {rich(tr('tour.score'), {
                  score: (
                    <b>
                      {m.wins[mine!]}–{m.wins[1 - mine!]}
                    </b>
                  ),
                })}
              </>
            )}
          </p>
          {m.result ? (
            <p className="tour-my-result">
              {[
                m.result === 'none'
                  ? tr(m.reportedBy === 'noshow' ? 'tour.resultDoubleNoShow' : 'tour.resultDoubleLoss')
                  : m.winner === user.id
                    ? tr(m.reportedBy === 'noshow' ? 'tour.resultWinNoShow' : 'tour.resultWin')
                    : tr('tour.resultLoss'),
                tr('tour.waitNextRound'),
              ].join(' ')}
            </p>
          ) : !t.roundStartedAt ? (
            <>
              <p className="muted small">{tr('tour.waitingBegin')}</p>
              <button
                className={['btn', t.me.ready ? '' : 'primary'].join(' ')}
                disabled={busy}
                onClick={() => run(() => api.tournaments.ready(t.id, m.id, !t.me!.ready))}
              >
                {t.me.ready ? tr('tour.readyOn') : tr('tour.readyBtn')}
              </button>
              <p className="muted small">
                {m.ready?.[1 - mine!] ? tr('tour.oppReady', { name: opp.name }) : tr('tour.oppNotReady', { name: opp.name })}
              </p>
            </>
          ) : (
            <>
              {t.deadline && (!m.present[mine!] || !m.present[1 - mine!]) && <Deadline deadline={t.deadline} mine={m.present[mine!]} />}
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    onPlay(await api.tournaments.play(t.id, m.id));
                  })
                }
              >
                {m.room === 'playing' ? tr('tour.backToGame') : m.bestOf > 1 ? tr('tour.playGameN', { n: m.game }) : tr('tour.playMatch')}
              </button>
              <p className="muted small">
                {m.room === 'waiting'
                  ? tr('tour.someoneWaiting')
                  : [tr('tour.enterHint'), m.bestOf > 1 ? tr('tour.seriesHint', { n: winsNeeded(m.bestOf) }) : null].filter(Boolean).join(' ')}
              </p>
            </>
          )}
        </>
      )}
      {t.me.warnings.count > 0 && <MyWarnings w={t.me.warnings} />}
      <div className="btn-row">
        <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.leave(t.id), tr('tour.confirmDropSelf'))}>
          {tr('tour.dropSelf')}
        </button>
      </div>
    </section>
  );
}

const REPORTED: Record<NonNullable<TournamentMatchInfo['reportedBy']>, MessageKey> = {
  game: 'tour.reported.game',
  bye: 'tour.reported.bye',
  drop: 'tour.reported.drop',
  noshow: 'tour.reported.noshow',
  late: 'tour.reported.late',
  organizer: 'tour.reported.organizer',
};

/** Confirmação na própria linha (com uma opção marcável), no lugar do `confirm()` do navegador. */
function InlineConfirm({
  text,
  option,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  text: string;
  option?: { label: string; checked: boolean; onChange: (v: boolean) => void };
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  return (
    <div className="tour-confirm" role="group">
      <p className="small">{text}</p>
      {option && (
        <label className="check">
          <input type="checkbox" checked={option.checked} onChange={(e) => option.onChange(e.target.checked)} />
          {option.label}
        </label>
      )}
      <div className="btn-row">
        <button className="btn small primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn small" disabled={busy} onClick={onCancel}>
          {tr('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Inscrição atrasada (suíço, durante a rodada 1): liberar para todos, para um jogador pelo apelido, ou fechar. */
function LateEntry({
  t,
  busy,
  run,
}: {
  t: TournamentDetail;
  busy: boolean;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
}) {
  const tr = useT();
  const [player, setPlayer] = useState('');
  const status = !t.lateEntry ? tr('tour.lateClosed') : t.lateEntry.all ? tr('tour.lateOpenAll') : tr('tour.lateOpenFor', { name: t.lateEntry.name ?? '?' });
  return (
    <div className="tour-late">
      <h3>{tr('tour.lateTitle')}</h3>
      <p className="small">
        <b>{status}</b> · <span className="muted">{tr('tour.lateHint')}</span>
      </p>
      <div className="btn-row">
        {!t.lateEntry?.all && (
          <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.lateEntry(t.id, true))}>
            {tr('tour.lateOpenAllBtn')}
          </button>
        )}
        {t.lateEntry && (
          <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.lateEntry(t.id, false))}>
            {tr('tour.lateCloseBtn')}
          </button>
        )}
      </div>
      <form
        className="btn-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (player.trim()) void run(() => api.tournaments.lateEntry(t.id, true, player.trim())).then(() => setPlayer(''));
        }}
      >
        <input
          className="admin-search"
          value={player}
          maxLength={40}
          placeholder={tr('tour.latePlayerPlaceholder')}
          aria-label={tr('tour.latePlayerPlaceholder')}
          onChange={(e) => setPlayer(e.target.value)}
        />
        <button className="btn small" type="submit" disabled={busy || !player.trim()}>
          {tr('tour.lateOpenForBtn')}
        </button>
      </form>
    </div>
  );
}

/** Prazo para entrar na sala (contagem regressiva). */
function Deadline({ deadline, mine }: { deadline: string; mine: boolean }) {
  const tr = useT();
  const locale = useLocale();
  const now = useNow(1000);
  return (
    <p className="tour-deadline">
      {rich(tr(mine ? 'tour.deadlineOpp' : 'tour.deadlineMe', { left: remaining(tr, deadline, now) }), { time: <b>{time(deadline, locale)}</b> })}
    </p>
  );
}

/** Placares finais possíveis de uma melhor de N, do ponto de vista de p1 e depois de p2. */
function finalScores(bestOf: number): Array<[number, number]> {
  const need = winsNeeded(bestOf);
  const p1 = Array.from({ length: need }, (_, k): [number, number] => [need, k]);
  const p2 = Array.from({ length: need }, (_, k): [number, number] => [need - 1 - k, need]);
  return [...p1, ...p2];
}

function MatchRow({
  m,
  editable,
  current,
  deadline,
  busy,
  canDrop,
  judge,
  started,
  onScore,
  onDouble,
  onWatch,
  onReplay,
  replaysSealed,
}: {
  m: TournamentMatchInfo;
  /** O organizador pode lançar ou corrigir o placar. */
  editable: boolean;
  /** Quem vê jogou esta partida, mas o torneio ainda corre: os replays (com as listas) só abrem no fim. */
  replaysSealed: boolean;
  /** Rodada atual (só nela o placar pode ser apagado). */
  current: boolean;
  /** Quem vê é Judge: assiste vendo as mãos e o chamado aberto. */
  judge: boolean;
  /** A rodada já foi iniciada (antes disso, as mesas mostram quem está pronto). */
  started: boolean;
  /** Prazo para entrar na sala (tolerância correndo): mostra quem ainda falta. */
  deadline: string | null;
  busy: boolean;
  /** Torneio em andamento: a derrota dupla pode também tirar os dois. */
  canDrop: boolean;
  onScore: (wins: [number, number]) => void;
  /** Derrota dupla (`dropBoth`: os dois saem do torneio). */
  onDouble: (dropBoth: boolean) => void;
  onWatch: () => void;
  /** Abre o replay gravado de um jogo da série. */
  onReplay: (statsMatchId: number) => void;
}) {
  const tr = useT();
  const locale = useLocale();
  const name = (p: TournamentMatchInfo['p1'] | null, won: boolean) =>
    p ? <span className={['tour-player', won ? 'won' : m.result ? 'lost' : ''].join(' ')}>{p.name}</span> : null;
  const [askDouble, setAskDouble] = useState(false);
  const [dropBoth, setDropBoth] = useState(false);
  const played = m.wins[0] + m.wins[1] > 0;
  const missing = deadline && !m.result && m.p2 ? [m.p1, m.p2].filter((_, i) => !m.present[i]).map((p) => p.name) : [];
  return (
    <div className="tour-match">
      <span className="tour-table muted small">{tr('tour.tableN', { n: m.table })}</span>
      <div className="tour-vs">
        {name(m.p1, m.winner === m.p1.userId)}
        {m.p2 ? (
          <>
            <span className={m.bestOf > 1 && (played || m.result) ? 'tour-score' : 'muted small'}>
              {m.bestOf > 1 && (played || m.result) ? `${m.wins[0]}–${m.wins[1]}` : tr('tour.vs')}
            </span>
            {name(m.p2, m.winner === m.p2.userId)}
          </>
        ) : (
          <span className="muted small">{tr(m.result === 'loss' ? 'tour.lateLoss' : 'tour.bye')}</span>
        )}
      </div>
      <div className="tour-match-side">
        {m.result === 'none' && <span className="muted small">{tr(m.reportedBy === 'noshow' ? 'tour.doubleNoShow' : 'tour.doubleLoss')}</span>}
        {m.result && m.result !== 'none' && m.reportedBy && m.reportedBy !== 'bye' && m.reportedBy !== 'late' && <span className="muted small">{tr(REPORTED[m.reportedBy])}</span>}
        {!m.result && m.call && <span className="tour-call-tag">{judge ? tr('tour.callOpenBy', { name: m.call.byName }) : tr('tour.callOpen')}</span>}
        {!m.result && m.room === 'playing' && (
          <button className={['btn', 'small', m.call ? 'danger' : ''].join(' ')} onClick={onWatch}>
            {judge ? tr('tour.watchAsJudge') : m.bestOf > 1 ? tr('tour.watchGameN', { n: m.game }) : tr('tour.watch')}
          </button>
        )}
        {!m.result && m.room !== 'playing' && !started && current && m.p2 && (
          <span className="muted small">{tr('tour.readyCount', { n: (m.ready ?? []).filter(Boolean).length })}</span>
        )}
        {!m.result && m.room !== 'playing' && (started || !current) && (
          <span className="muted small">
            {missing.length
              ? tr('tour.missing', { names: missing.length > 1 ? tr('tour.andNames', { a: missing[0], b: missing[1] }) : missing[0] })
              : m.room === 'waiting'
                ? tr('tour.inRoom')
                : m.bestOf > 1 && played
                  ? tr('tour.gamePending', { n: m.game })
                  : tr('tour.pending')}
          </span>
        )}
      </div>
      {editable && m.p2 && (
        <div className="seg small tour-result">
          {finalScores(m.bestOf).map(([a, b]) => {
            const winner = a > b ? m.p1.name : m.p2!.name;
            const on = m.wins[0] === a && m.wins[1] === b;
            return (
              <button key={`${a}-${b}`} className={on ? 'on' : ''} disabled={busy || on} onClick={() => onScore([a, b])}>
                {m.bestOf === 1
                  ? tr('tour.scoreWon', { name: winner })
                  : tr('tour.scoreSeries', { name: winner, a: Math.max(a, b), b: Math.min(a, b) })}
              </button>
            );
          })}
          <button
            className={m.result === 'none' ? 'on' : ''}
            disabled={busy || m.result === 'none'}
            title={tr('tour.doubleLossTitle')}
            onClick={() => {
              setDropBoth(false);
              setAskDouble(true);
            }}
          >
            {tr('tour.doubleLoss')}
          </button>
          {current && (played || m.result) && (
            <button disabled={busy} title={tr('tour.clearScore')} onClick={() => onScore([0, 0])}>
              ✕
            </button>
          )}
        </div>
      )}
      {editable && m.p2 && askDouble && (
        <InlineConfirm
          text={tr('tour.confirmDoubleLoss', { a: m.p1.name, b: m.p2.name })}
          option={canDrop ? { label: tr('tour.doubleLossDropBoth'), checked: dropBoth, onChange: setDropBoth } : undefined}
          busy={busy}
          confirmLabel={tr('tour.doubleLoss')}
          onConfirm={() => {
            setAskDouble(false);
            onDouble(dropBoth);
          }}
          onCancel={() => setAskDouble(false)}
        />
      )}
      {m.games.length > 0 && (
        <details className="tour-games">
          <summary className="small">{tr('tour.recordedGames', { n: m.games.length })}</summary>
          <ul className="small">
            {m.games.map((g, i) => (
              <li key={i}>
                {rich(tr('tour.gameLine', { n: g.game, time: time(g.playedAt, locale) }), {
                  result: g.winner ? rich(tr('tour.gameWonBy'), { name: <b>{g.winner.name}</b> }) : tr('tour.gameNoWinner'),
                })}
                {!g.counted && <span className="muted"> · {tr('tour.notCounted')}</span>}
                {g.statsMatchId !== null && (
                  <button className="btn small" disabled={busy} onClick={() => onReplay(g.statsMatchId!)}>
                    {tr('tour.watchReplay')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {replaysSealed && <p className="muted small">{tr('tour.replaysAtEnd')}</p>}
        </details>
      )}
    </div>
  );
}

function Standings({ t }: { t: TournamentDetail }) {
  const tr = useT();
  const champion = t.status === 'finished' ? t.standings[0]?.userId : null;
  return (
    <section className="menu-card tour-standings">
      <table className="cov-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{tr('tour.colPlayer')}</th>
            <th>{tr('tour.colPoints')}</th>
            <th>{tr('tour.colRecord')}</th>
            <th title={tr('tour.omwTitle')}>{tr('tour.colOmw')}</th>
            <th title={tr('tour.oomwTitle')}>{tr('tour.colOomw')}</th>
          </tr>
        </thead>
        <tbody>
          {t.standings.map((s) => (
            <tr key={s.userId} className={s.dropped ? 'muted' : ''}>
              <td>{s.rank}</td>
              <td>
                {s.name}
                {s.userId === champion && <span className="tour-badge gold">{tr('tour.badgeChampion')}</span>}
                {s.dropped && <span className="tour-badge">{tr('tour.badgeDropped')}</span>}
                {t.topCut && s.inElim && s.userId !== champion && <span className="tour-badge">{tr('tour.badgeTopCut', { n: t.topCut })}</span>}
                {s.inElim && !s.alive && !s.dropped && t.status === 'running' && <span className="tour-badge">{tr('tour.badgeEliminated')}</span>}
              </td>
              <td>{s.points}</td>
              <td>
                {s.wins}-{s.losses}
              </td>
              <td>{pct(s.omw)}</td>
              <td>{pct(s.oomw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.structure === 'swiss' && (
        <p className="muted small">{[tr('tour.swissTiebreak'), t.topCut ? tr('tour.topCutAbove', { n: t.topCut }) : null].filter(Boolean).join(' ')}</p>
      )}
    </section>
  );
}

function Players({
  t,
  busy,
  onDrop,
  onReinstate,
  onWarn,
  onRevoke,
  onKeep,
}: {
  t: TournamentDetail;
  busy: boolean;
  onDrop: (userId: string, name: string) => void;
  /** Desfaz a desistência (`restore`: a partida da rodada volta a ficar pendente). */
  onReinstate: (userId: string, restore: boolean) => void;
  /** Warning do Judge ou do organizador (com o motivo). */
  onWarn: (userId: string, reason: string) => void;
  /** O organizador anula um warning. */
  onRevoke: (warningId: number) => void;
  /** O organizador mantém quem atingiu o limite de warnings. */
  onKeep: (userId: string) => void;
}) {
  const tr = useT();
  const { user } = useAuth();
  const [reinstating, setReinstating] = useState<string | null>(null);
  const [restore, setRestore] = useState(false);
  const [warning, setWarning] = useState<{ userId: string; reason: string } | null>(null);
  if (!t.players.length) {
    return (
      <section className="menu-card">
        <p className="muted">{tr('tour.noPlayers')}</p>
      </section>
    );
  }
  return (
    <section className="menu-card">
      <div className="tour-players">
        {t.players.map((p) => (
          <div key={p.userId} className={['tour-entry', p.dropped ? 'dropped' : ''].join(' ')}>
            <div className="tour-entry-head">
              <LeaderArt name={p.leader ? (p.leaderName ?? p.leader) : undefined} image={p.leaderImage} colors={p.colors} size="small" />
              <span className="watch-name">
                <b>
                  {p.name}
                  {p.supporter && (
                    <span className="supporter-tag" title={tr('support.tagTitleTier', { tier: TIER_LABEL[p.supporter] })}>
                      ❤ {TIER_LABEL[p.supporter]}
                    </span>
                  )}
                </b>
                <span className="muted small">
                  {dots(
                    p.leader ? (p.leaderName ?? p.leader) : tr('tour.deckHidden'),
                    p.dropped && tr('tour.leftTournament'),
                    t.checkIn && t.status === 'registration' && p.checkedIn && tr('tour.checkedInTag'),
                  )}
                </span>
                {(p.warnings.count > 0 || p.warnings.pending) && <WarningDots w={p.warnings} />}
              </span>
              {t.isJudge && t.status === 'running' && !p.dropped && p.userId !== user?.id && (
                <button
                  className={['btn', 'small', warning?.userId === p.userId ? 'on' : ''].join(' ')}
                  disabled={busy}
                  onClick={() => setWarning(warning?.userId === p.userId ? null : { userId: p.userId, reason: '' })}
                >
                  {tr('tour.warnBtn')}
                </button>
              )}
              {t.canManage && t.status !== 'finished' && !p.dropped && (
                <button className="btn small" disabled={busy} onClick={() => onDrop(p.userId, p.name)}>
                  {tr(t.status === 'registration' ? 'tour.remove' : 'tour.drop')}
                </button>
              )}
              {t.canManage && p.dropped && p.reinstate && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => {
                    setRestore(p.reinstate !== 'no');
                    setReinstating(p.userId);
                  }}
                >
                  {tr('tour.reinstate')}
                </button>
              )}
            </div>
            {reinstating === p.userId && p.reinstate && (
              <InlineConfirm
                text={[tr('tour.confirmReinstate', { name: p.name }), p.reinstate === 'required' ? tr('tour.reinstateRestoreRequired') : null]
                  .filter(Boolean)
                  .join(' ')}
                option={p.reinstate === 'optional' ? { label: tr('tour.reinstateRestore'), checked: restore, onChange: setRestore } : undefined}
                busy={busy}
                confirmLabel={tr('tour.reinstate')}
                onConfirm={() => {
                  setReinstating(null);
                  onReinstate(p.userId, p.reinstate === 'required' || (p.reinstate === 'optional' && restore));
                }}
                onCancel={() => setReinstating(null)}
              />
            )}
            {warning?.userId === p.userId && (
              <form
                className="tour-warn-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (warning.reason.trim().length < 3) return;
                  onWarn(p.userId, warning.reason.trim());
                  setWarning(null);
                }}
              >
                <input
                  className="admin-search"
                  maxLength={300}
                  autoFocus
                  placeholder={tr('tour.warnReasonPlaceholder')}
                  value={warning.reason}
                  onChange={(e) => setWarning({ ...warning, reason: e.target.value })}
                />
                <button className="btn small danger" type="submit" disabled={busy || warning.reason.trim().length < 3}>
                  {tr('tour.warnConfirm', { name: p.name })}
                </button>
                <button className="btn small" type="button" onClick={() => setWarning(null)}>
                  {tr('common.cancel')}
                </button>
              </form>
            )}
            {p.warnings.pending && t.canManage && !p.dropped && (
              <div className="tour-confirm tour-warn-pending" role="group">
                <p className="small">{tr('tour.warnLimitReached', { name: p.name, n: p.warnings.count, max: p.warnings.max })}</p>
                <div className="btn-row">
                  <button className="btn small danger" disabled={busy} onClick={() => onDrop(p.userId, p.name)}>
                    {tr('tour.eliminate')}
                  </button>
                  <button className="btn small primary" disabled={busy} onClick={() => onKeep(p.userId)}>
                    {tr('tour.keepPlayer')}
                  </button>
                </div>
              </div>
            )}
            {p.warnings.list && p.warnings.list.length > 0 && (
              <details className="tour-warn-list">
                <summary className="small">{tr('tour.warnHistory', { n: p.warnings.count })}</summary>
                <ul className="small">
                  {p.warnings.list.map((w) => (
                    <li key={w.id} className={w.revoked ? 'muted' : ''}>
                      {tr('tour.warnLine', { reason: w.reason, by: w.byName, round: w.round })}
                      {w.revoked && <span className="tour-badge">{tr('tour.warnRevoked')}</span>}
                      {!w.revoked && t.canManage && t.status !== 'finished' && (
                        <button className="btn small" disabled={busy} onClick={() => onRevoke(w.id)}>
                          {tr('tour.warnRevoke')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {p.deck && (
              <details className="tour-deck">
                <summary className="small">{tr('tour.deckList', { name: p.deck.name })}</summary>
                <ul className="small">
                  {p.deck.cards.map((c) => (
                    <li key={c.id}>
                      {tr('tour.deckCardLine', { n: c.count, name: c.name ?? c.id })} <span className="muted">{c.id}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
      {t.status === 'registration' && !t.canManage && <p className="muted small">{tr('tour.decksRevealHint')}</p>}
      {t.status === 'running' && !t.canManage && <p className="muted small">{tr('tour.decksPublicHint')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ Judge, warnings e ocorrências

/** Bolinhas de warning (●●○ = 2 de 3); sem limite, só a contagem. */
export function WarningDots({ w }: { w: Pick<TournamentWarnings, 'count' | 'max' | 'pending' | 'limitReached'> }) {
  const tr = useT();
  const title = w.max !== null ? tr('tour.warnOfMax', { n: w.count, max: w.max }) : tr('tour.warnCount', { n: w.count });
  return (
    <span className={['warn-dots', w.limitReached ? 'limit' : '', w.pending ? 'pending' : ''].join(' ')} title={title} aria-label={title}>
      {w.max !== null
        ? Array.from({ length: Math.max(w.max, w.count) }, (_, i) => (
            <span key={i} className={['warn-dot', i < w.count ? 'on' : ''].join(' ')} />
          ))
        : Array.from({ length: w.count }, (_, i) => <span key={i} className="warn-dot on" />)}
      {w.pending && <span className="warn-pending-tag">{tr('tour.warnPendingTag')}</span>}
    </span>
  );
}

/** Os warnings de quem está vendo (na área "Sua partida"). */
function MyWarnings({ w }: { w: TournamentWarnings }) {
  const tr = useT();
  return (
    <div className="tour-my-warnings">
      <p className="small">
        <b>{w.max !== null ? tr('tour.myWarnings', { n: w.count, max: w.max }) : tr('tour.myWarningsNoMax', { n: w.count })}</b> <WarningDots w={w} />
      </p>
      {w.list && (
        <ul className="small">
          {w.list
            .filter((x) => !x.revoked)
            .map((x) => (
              <li key={x.id}>{tr('tour.warnLine', { reason: x.reason, by: x.byName, round: x.round })}</li>
            ))}
        </ul>
      )}
      {w.limitReached && <p className="small tour-warn-limit">{tr('tour.myWarnLimit')}</p>}
    </div>
  );
}

/** Para o organizador: quem atingiu o limite de warnings e espera a decisão (a próxima rodada fica travada). */
function WarningsPending({
  t,
  busy,
  run,
}: {
  t: TournamentDetail;
  busy: boolean;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
}) {
  const tr = useT();
  return (
    <div className="error tour-warn-block">
      <p className="small">{tr('tour.warningsPendingIntro')}</p>
      {t.warningsPending.map((p) => {
        const w = t.players.find((x) => x.userId === p.userId)?.warnings;
        return (
          <div key={p.userId} className="btn-row tour-warn-pending-row">
            <b>{p.name}</b>
            {w && <WarningDots w={w} />}
            <button className="btn small danger" disabled={busy} onClick={() => run(() => api.tournaments.drop(t.id, p.userId), tr('tour.confirmDrop', { name: p.name }))}>
              {tr('tour.eliminate')}
            </button>
            <button className="btn small primary" disabled={busy} onClick={() => run(() => api.tournaments.keepPlayer(t.id, p.userId))}>
              {tr('tour.keepPlayer')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Judges do torneio (organizador): adicionar pelo apelido e remover. */
function Judges({
  t,
  busy,
  run,
}: {
  t: TournamentDetail;
  busy: boolean;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
}) {
  const tr = useT();
  const [name, setName] = useState('');
  return (
    <div className="tour-late tour-judges">
      <h3>{tr('tour.judgesTitle')}</h3>
      <p className="small muted">{tr('tour.judgesHint')}</p>
      {t.judges.length > 0 ? (
        <ul className="tour-judge-list">
          {t.judges.map((j) => (
            <li key={j.userId}>
              <b>{j.name}</b>
              <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.removeJudge(t.id, j.userId))}>
                {tr('tour.judgeRemove')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">
          <b>{tr('tour.judgeIsOrganizer')}</b>
        </p>
      )}
      <form
        className="btn-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(() => api.tournaments.addJudge(t.id, name.trim())).then(() => setName(''));
        }}
      >
        <input
          className="admin-search"
          value={name}
          maxLength={40}
          placeholder={tr('tour.judgePlaceholder')}
          aria-label={tr('tour.judgePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn small" type="submit" disabled={busy || !name.trim()}>
          {tr('tour.judgeAdd')}
        </button>
      </form>
    </div>
  );
}

/** Ocorrências (Judge e organizador): chamados de Judge com o relato e os warnings. */
function Incidents({
  t,
  busy,
  run,
}: {
  t: TournamentDetail;
  busy: boolean;
  run: (fn: () => Promise<TournamentDetail | void>, confirmText?: string) => Promise<void>;
}) {
  const tr = useT();
  const locale = useLocale();
  const [data, setData] = useState<TournamentIncidents | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    api.tournaments
      .incidents(t.id)
      .then((d) => !stop && setData(d))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [t.id, t.openCalls.length, t.players]);
  const where = (m: { round: number; table: number; names: Array<string | null> } | null) =>
    m ? tr('tour.incidentWhere', { round: m.round, table: m.table, a: m.names[0] ?? '?', b: m.names[1] ?? '?' }) : '';
  return (
    <section className="menu-card tour-incidents">
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">{tr('common.loading')}</p>}
      {data && (
        <>
          <h3>{tr('tour.incidentCalls', { n: data.calls.length })}</h3>
          {data.calls.length === 0 && <p className="muted small">{tr('tour.incidentNoCalls')}</p>}
          <ul className="tour-incident-list">
            {data.calls.map((c) => (
              <li key={c.id} className={c.resolvedAt ? '' : 'open'}>
                <b>{where(c.match)}</b>
                <span className="small">
                  {dots(
                    tr('tour.incidentOpened', { name: c.openedByName, time: time(c.openedAt, locale) }),
                    c.resolvedAt ? tr('tour.incidentResolved', { name: c.resolvedByName ?? '?', time: time(c.resolvedAt, locale) }) : tr('tour.incidentStillOpen'),
                  )}
                </span>
                {c.note && <span className="small tour-incident-note">{c.note}</span>}
              </li>
            ))}
          </ul>
          <h3>{tr('tour.incidentWarnings', { n: data.warnings.length })}</h3>
          {data.warnings.length === 0 && <p className="muted small">{tr('tour.incidentNoWarnings')}</p>}
          <ul className="tour-incident-list">
            {data.warnings.map((w) => (
              <li key={w.id} className={w.revokedAt ? 'muted' : ''}>
                <b>{w.name}</b>
                <span className="small">
                  {dots(tr('tour.warnLine', { reason: w.reason, by: w.byName, round: w.round }), w.match && where(w.match), time(w.givenAt, locale))}
                </span>
                {w.revokedAt && <span className="tour-badge">{tr('tour.warnRevoked')}</span>}
                {!w.revokedAt && t.canManage && t.status !== 'finished' && (
                  <button className="btn small" disabled={busy} onClick={() => run(() => api.tournaments.revokeWarning(t.id, w.id))}>
                    {tr('tour.warnRevoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3>{tr('tour.incidentInterventions', { n: data.interventions?.length ?? 0 })}</h3>
          {!data.interventions?.length && <p className="muted small">{tr('tour.incidentNoInterventions')}</p>}
          <ul className="tour-incident-list">
            {(data.interventions ?? []).map((i) => (
              <li key={i.id}>
                <b>{dots(where(i.match), tr('tour.interventionBy', { name: i.byName, role: tr(`tour.interventionRole.${i.role}`) }))}</b>
                <span className="small">{dots(tr(`tour.intervention.${i.kind}`, { n: i.removedCount }), time(i.at, locale))}</span>
                {i.note && <span className="small tour-incident-note">{i.note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
