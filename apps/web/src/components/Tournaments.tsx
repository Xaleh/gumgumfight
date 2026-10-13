import { FORMATS, formatLabel } from '@gumgum/engine';
import { Fragment, type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  api,
  canPlay,
  type DeckSummary,
  type OnlineSeat,
  STRUCTURE_LABEL,
  type TournamentDetail,
  type TournamentInput,
  type TournamentMatchInfo,
  type TournamentStage,
  type TournamentSummary,
  TOURNAMENT_STATUS_LABEL,
  type WatchTarget,
  winsNeeded,
} from '../api';
import { useAuth } from '../auth';
import type { GameSetup } from '../game/useGame';
import { type Locale, type MessageKey, type Translate, useLocale, useT } from '../i18n';
import { fmtDateTime, fmtTime } from '../i18n/format';
import { useNow } from './HomeBlocks';
import { LeaderArt } from './LeaderArt';
import { openReplay, ReportsPanel } from './Reports';

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
function phaseName(tr: Translate, size: number): string {
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
  onExit,
  onPlay,
  onWatch,
  onReplay,
}: {
  initialId?: string;
  onExit: () => void;
  /** Entra na sala online da partida do torneio. */
  onPlay: (seat: OnlineSeat, tournamentId: string) => void;
  onWatch: (target: WatchTarget, tournamentId: string) => void;
  /** Abre o replay gravado de um jogo (auditoria). */
  onReplay: (setup: GameSetup, tournamentId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      <TournamentForm
        onCancel={() => setCreating(false)}
        onSaved={(t) => {
          setCreating(false);
          setOpenId(t.id);
        }}
      />
    );
  }
  if (openId) {
    return (
      <TournamentPage
        id={openId}
        onExit={onExit}
        onDeleted={() => setOpenId(null)}
        onPlay={(seat) => onPlay(seat, openId)}
        onWatch={(t) => onWatch(t, openId)}
        onReplay={(setup) => onReplay(setup, openId)}
      />
    );
  }
  return <TournamentList onExit={onExit} onOpen={setOpenId} onCreate={() => setCreating(true)} />;
}

// ------------------------------------------------------------------ lista

function TournamentList({ onExit, onOpen, onCreate }: { onExit: () => void; onOpen: (id: string) => void; onCreate: () => void }) {
  const { user } = useAuth();
  const tr = useT();
  const locale = useLocale();
  const [data, setData] = useState<{ tournaments: TournamentSummary[]; canCreate: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <button className="btn small primary tour-create" onClick={onCreate}>
            {tr('tour.create')}
          </button>
        )}
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}
        {!user && <p className="muted small">{tr('tour.signInToRegister')}</p>}
        {data === null && !error && <p className="muted">{tr('common.loading')}</p>}
        {data?.tournaments.length === 0 && <p className="muted">{tr(data.canCreate ? 'tour.emptyCreate' : 'tour.emptyOrganizer')}</p>}
        <div className="tour-list">
          {data?.tournaments.map((t) => (
            <button key={t.id} className="tour-card" onClick={() => onOpen(t.id)}>
              <div className="tour-card-head">
                <strong>{t.name}</strong>
                <span className={['tour-status', t.status].join(' ')}>{tr(TOURNAMENT_STATUS_LABEL[t.status])}</span>
              </div>
              <span className="muted small">
                {dots(
                  formatLabel(t.format),
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
  onCancel,
  onSaved,
}: {
  initial?: TournamentDetail;
  onCancel: () => void;
  onSaved: (t: TournamentDetail) => void;
}) {
  const tr = useT();
  const [form, setForm] = useState<TournamentInput>(() => ({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    format: initial?.format ?? 'standard',
    structure: initial?.structure ?? 'swiss',
    rounds: initial && !initial.roundsAuto ? initial.swissRounds : null,
    swissBestOf: initial?.swissBestOf ?? 1,
    topCut: initial?.topCut ?? null,
    bo3From: initial?.bo3From ?? null,
    bo5From: initial?.bo5From ?? null,
    maxPlayers: initial?.maxPlayers ?? null,
    startsAt: initial?.startsAt ?? null,
    checkIn: initial?.checkIn ?? true,
    toleranceMin: initial?.toleranceMin ?? 5,
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
      const input = { ...form, checkIn: form.checkIn && Boolean(form.startsAt) };
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
            <div className="seg small">
              {FORMATS.map((f) => (
                <button key={f.id} className={form.format === f.id ? 'on' : ''} onClick={() => set('format', f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
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
                max={256}
                placeholder={tr('tour.noLimit')}
                value={form.maxPlayers ?? ''}
                onChange={(e) => set('maxPlayers', num(e.target.value))}
              />
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
              )}
            </div>
          ) : (
            <p className="muted small">{tr('tour.noStartHint')}</p>
          )}
          {form.structure === 'swiss' && <p className="muted small">{tr('tour.roundsAutoHint')}</p>}
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

type Tab = 'rounds' | 'standings' | 'players' | 'reports';

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
  onExit,
  onDeleted,
  onPlay,
  onWatch,
  onReplay,
}: {
  id: string;
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

  if (editing && t) {
    return (
      <TournamentForm
        initial={t}
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
                  formatLabel(t.format),
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
                    tr('tour.autoStart', { date: dateTime(t.startsAt, locale) }),
                    tr('tour.checkedInCount', { n: t.checkedIn, total: t.players.length }),
                  )}
                </p>
              )}
              {t.checkIn && t.status === 'running' && <p className="muted small">{tr('tour.toleranceInfo', { tolerance: minutes(tr, t.toleranceMs) })}</p>}
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
              {t.description && <p className="tour-desc">{t.description}</p>}
              {t.status === 'finished' && t.standings[0] && (
                <p className="tour-champion">{rich(tr('tour.champion'), { name: <b>{t.standings[0].name}</b> })}</p>
              )}
            </section>

            <MyArea t={t} busy={busy} run={run} onPlay={onPlay} setError={setError} />

            {t.canManage && (
              <section className="menu-card tour-manage">
                <h2>{tr('tour.manage')}</h2>
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
                  {t.status === 'running' && (
                    <>
                      <button
                        className="btn primary"
                        disabled={busy || !t.roundComplete}
                        title={t.roundComplete ? undefined : tr('tour.roundIncomplete')}
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
                {t.status === 'registration' && t.checkIn && (
                  <p className="muted small">{tr('tour.autoStartHint', { date: dateTime(t.startsAt, locale), tolerance: minutes(tr, t.toleranceMs) })}</p>
                )}
                {t.status !== 'registration' && <p className="muted small">{tr('tour.manageHint')}</p>}
              </section>
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
                      onScore={(wins) => run(() => api.tournaments.setScore(t.id, m.id, wins))}
                      onWatch={() => m.roomId && onWatch({ roomId: m.roomId, hands: false })}
                      onReplay={(statsMatchId) => run(() => openReplay(statsMatchId, onReplay))}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'standings' && <Standings t={t} />}

            {activeTab === 'reports' && t.canManage && <ReportsPanel tournament={t.id} onReplay={onReplay} />}

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

  useEffect(() => {
    if (t.status !== 'registration' || !user) return;
    let stop = false;
    api
      .decks()
      .then((d) => !stop && setDecks(d))
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, [t.status, user, setError]);

  if (!user) {
    return t.status === 'registration' ? (
      <section className="menu-card">
        <p className="muted small">{tr('tour.signInToRegisterHere')}</p>
      </section>
    ) : null;
  }

  if (t.status === 'registration') {
    const playable = decks?.filter((d) => canPlay(d, t.format)) ?? [];
    const mine = playable.filter((d) => d.kind === 'user' && d.mine);
    const others = playable.filter((d) => !(d.kind === 'user' && d.mine));
    const full = t.maxPlayers !== null && t.players.length >= t.maxPlayers && !t.me;
    return (
      <section className="menu-card tour-me">
        <h2>{tr(t.me ? 'tour.myRegistration' : 'tour.registration')}</h2>
        {t.me && <p className="small">{rich(tr('tour.registeredWith'), { deck: <b>{t.me.deckName}</b> })}</p>}
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
        {full ? (
          <p className="muted">{tr('tour.full')}</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tour-deck">{tr('tour.deckLabel', { format: formatLabel(t.format) })}</label>
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
              {decks && !playable.length && <p className="muted small">{tr('tour.noPlayableDeck', { format: formatLabel(t.format) })}</p>}
            </div>
            <div className="btn-row">
              <button
                className="btn primary"
                disabled={busy || !deckId || (t.me?.deckId === deckId)}
                onClick={() => run(() => api.tournaments.register(t.id, deckId))}
              >
                {tr(t.me ? 'tour.changeDeck' : 'tour.register')}
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
        <p>{rich(tr('tour.byeRound'), { bye: <b>{tr('tour.bye')}</b> })}</p>
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
                  ? tr('tour.resultDoubleNoShow')
                  : m.winner === user.id
                    ? tr(m.reportedBy === 'noshow' ? 'tour.resultWinNoShow' : 'tour.resultWin')
                    : tr('tour.resultLoss'),
                tr('tour.waitNextRound'),
              ].join(' ')}
            </p>
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
  organizer: 'tour.reported.organizer',
};

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
  onScore,
  onWatch,
  onReplay,
}: {
  m: TournamentMatchInfo;
  /** O organizador pode lançar ou corrigir o placar. */
  editable: boolean;
  /** Rodada atual (só nela o placar pode ser apagado). */
  current: boolean;
  /** Prazo para entrar na sala (tolerância correndo): mostra quem ainda falta. */
  deadline: string | null;
  busy: boolean;
  onScore: (wins: [number, number]) => void;
  onWatch: () => void;
  /** Abre o replay gravado de um jogo da série. */
  onReplay: (statsMatchId: number) => void;
}) {
  const tr = useT();
  const locale = useLocale();
  const name = (p: TournamentMatchInfo['p1'] | null, won: boolean) =>
    p ? <span className={['tour-player', won ? 'won' : m.result ? 'lost' : ''].join(' ')}>{p.name}</span> : null;
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
          <span className="muted small">{tr('tour.bye')}</span>
        )}
      </div>
      <div className="tour-match-side">
        {m.result === 'none' && <span className="muted small">{tr('tour.doubleNoShow')}</span>}
        {m.result && m.result !== 'none' && m.reportedBy && m.reportedBy !== 'bye' && <span className="muted small">{tr(REPORTED[m.reportedBy])}</span>}
        {!m.result && m.room === 'playing' && (
          <button className="btn small" onClick={onWatch}>
            {m.bestOf > 1 ? tr('tour.watchGameN', { n: m.game }) : tr('tour.watch')}
          </button>
        )}
        {!m.result && m.room !== 'playing' && (
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
          {current && (played || m.result) && (
            <button disabled={busy} title={tr('tour.clearScore')} onClick={() => onScore([0, 0])}>
              ✕
            </button>
          )}
        </div>
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

function Players({ t, busy, onDrop }: { t: TournamentDetail; busy: boolean; onDrop: (userId: string, name: string) => void }) {
  const tr = useT();
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
                <b>{p.name}</b>
                <span className="muted small">
                  {dots(
                    p.leader ? (p.leaderName ?? p.leader) : tr('tour.deckHidden'),
                    p.dropped && tr('tour.leftTournament'),
                    t.checkIn && t.status === 'registration' && p.checkedIn && tr('tour.checkedInTag'),
                  )}
                </span>
              </span>
              {t.canManage && t.status !== 'finished' && !p.dropped && (
                <button className="btn small" disabled={busy} onClick={() => onDrop(p.userId, p.name)}>
                  {tr(t.status === 'registration' ? 'tour.remove' : 'tour.drop')}
                </button>
              )}
            </div>
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
