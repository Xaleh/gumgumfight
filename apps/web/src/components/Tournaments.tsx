import { FORMATS, formatLabel } from '@gumgum/engine';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  canPlay,
  type DeckSummary,
  type OnlineSeat,
  phaseLabel,
  STRUCTURE_LABEL,
  type TournamentDetail,
  type TournamentInput,
  type TournamentMatchInfo,
  type TournamentSummary,
  TOURNAMENT_STATUS_LABEL,
  type WatchTarget,
  winsNeeded,
} from '../api';
import { useAuth } from '../auth';
import type { GameSetup } from '../game/useGame';
import { useNow } from './HomeBlocks';
import { LeaderArt } from './LeaderArt';
import { openReplay, ReportsPanel } from './Reports';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

/** ISO → valor do <input type="datetime-local"> (hora local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null);

/** "restam 4min30s" (ou "o prazo acabou"). */
const remaining = (deadline: string, now: number) => {
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  if (!left) return 'o prazo acabou';
  return `restam ${Math.floor(left / 60)}min${String(left % 60).padStart(2, '0')}s`;
};

/** Minutos de um intervalo em ms ("30 min"). */
const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

/** 1050000 → "17min30s". */
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}min${s % 60 ? `${String(s % 60).padStart(2, '0')}s` : ''}`;
};

/** Fases da eliminatória que o organizador pode escolher (vagas → nome). */
const PHASES: Array<[number, string]> = [
  [256, 'Toda a eliminatória'],
  [32, 'Rodada de 32'],
  [16, 'Oitavas de final'],
  [8, 'Quartas de final'],
  [4, 'Semifinal'],
  [2, 'Final'],
];
const TOP_CUTS = [2, 4, 8, 16, 32, 64];

/** "das quartas de final", "da final"… */
const phaseFrom = (size: number) => {
  if (size >= 256) return 'do início da eliminatória';
  const name = phaseLabel(size).toLowerCase();
  return `${name === 'final' || name === 'semifinal' ? 'da' : name.startsWith('rodada') ? 'da' : 'das'} ${name}`;
};

/** Nome curto da fase para os botões das rodadas. */
const shortPhase = (label: string) =>
  ({ Final: 'Final', Semifinal: 'Semi', 'Quartas de final': 'Quartas', 'Oitavas de final': 'Oitavas' })[label] ?? label.replace('Rodada de ', 'R');

/** "Melhor de 3" (ou "Jogo único"). */
const bestOfLabel = (n: number) => (n === 1 ? 'Jogo único' : `Melhor de ${n}`);

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
          ← Menu
        </button>
        <h2>Torneios</h2>
        {data?.canCreate && (
          <button className="btn small primary tour-create" onClick={onCreate}>
            + Criar torneio
          </button>
        )}
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}
        {!user && (
          <p className="muted small">Para se inscrever num torneio, entre com a conta Google no menu.</p>
        )}
        {data === null && !error && <p className="muted">Carregando…</p>}
        {data?.tournaments.length === 0 && (
          <p className="muted">
            Nenhum torneio ainda.
            {data.canCreate ? ' Crie o primeiro!' : ' Torneios são criados por contas com o perfil Organizador.'}
          </p>
        )}
        <div className="tour-list">
          {data?.tournaments.map((t) => (
            <button key={t.id} className="tour-card" onClick={() => onOpen(t.id)}>
              <div className="tour-card-head">
                <strong>{t.name}</strong>
                <span className={['tour-status', t.status].join(' ')}>{TOURNAMENT_STATUS_LABEL[t.status]}</span>
              </div>
              <span className="muted small">
                {formatLabel(t.format)} · {STRUCTURE_LABEL[t.structure]}
                {t.topCut ? ` + Top ${t.topCut}` : ''} · {t.players}
                {t.maxPlayers ? `/${t.maxPlayers}` : ''} jogador{t.players === 1 ? '' : 'es'}
                {t.status === 'running' && ` · Rodada ${t.round}${t.totalRounds ? `/${t.totalRounds}` : ''}`}
              </span>
              <span className="muted small">
                {t.organizerName ? `Organizado por ${t.organizerName}` : ''}
                {t.startsAt && t.status === 'registration' ? ` · Começa em ${dateTime(t.startsAt)}` : ''}
              </span>
              {t.registered && <span className="tour-registered">✔ Você está inscrito</span>}
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
          ← Voltar
        </button>
        <h2>{initial ? 'Editar torneio' : 'Novo torneio'}</h2>
      </header>
      <div className="coverage-body">
        <section className="menu-card tour-form">
          <div className="field">
            <label htmlFor="tour-name">Nome</label>
            <input id="tour-name" className="admin-search" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tour-desc">Descrição e regras</label>
            <textarea
              id="tour-desc"
              className="admin-search"
              rows={4}
              maxLength={2000}
              placeholder="Premiação, horário de cada rodada, onde combinar as partidas…"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Formato</label>
            <div className="seg small">
              {FORMATS.map((f) => (
                <button key={f.id} className={form.format === f.id ? 'on' : ''} onClick={() => set('format', f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Estrutura</label>
            <div className="seg small">
              {(['swiss', 'single'] as const).map((s) => (
                <button key={s} className={form.structure === s ? 'on' : ''} onClick={() => set('structure', s)}>
                  {STRUCTURE_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="muted small">
              {form.structure === 'swiss'
                ? 'Todos jogam todas as rodadas, sempre contra quem tem a mesma pontuação (vitória vale 3 pontos). Desempate por % de vitórias dos oponentes. Opcionalmente, os melhores vão para um top cut no fim.'
                : 'Quem perde sai. A chave é sorteada no início; com número de jogadores fora de potência de 2, os primeiros sorteados ganham bye.'}
            </p>
          </div>
          {form.structure === 'swiss' && (
            <div className="tour-form-row">
              <div className="field">
                <label htmlFor="tour-rounds">Rodadas</label>
                <input
                  id="tour-rounds"
                  className="admin-search"
                  type="number"
                  min={1}
                  max={15}
                  placeholder="Automático"
                  value={form.rounds ?? ''}
                  onChange={(e) => set('rounds', num(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Partidas do suíço</label>
                <div className="seg small">
                  {[1, 3].map((n) => (
                    <button key={n} className={form.swissBestOf === n ? 'on' : ''} onClick={() => set('swissBestOf', n)}>
                      {bestOfLabel(n)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="tour-cut">Top cut</label>
                <select
                  id="tour-cut"
                  className="admin-search"
                  value={form.topCut ?? ''}
                  onChange={(e) => set('topCut', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sem top cut</option>
                  {TOP_CUTS.map((n) => (
                    <option key={n} value={n}>
                      Top {n} ({phaseLabel(n).toLowerCase()})
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
                    ['bo3From', 'Melhor de 3 a partir de', 'tour-bo3'],
                    ['bo5From', 'Melhor de 5 a partir de', 'tour-bo5'],
                  ] as const
                ).map(([key, label, id]) => (
                  <div className="field" key={key}>
                    <label htmlFor={id}>{label}</label>
                    <select
                      id={id}
                      className="admin-search"
                      value={form[key] ?? ''}
                      onChange={(e) => set(key, e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Nunca</option>
                      {PHASES.map(([size, name]) => (
                        <option key={size} value={size}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="muted small">
                Antes dessas fases, as partidas da eliminatória são jogo único. Ex.: melhor de 3 a partir das quartas e melhor de 5
                na final.
              </p>
            </>
          )}
          <div className="tour-form-row">
            <div className="field">
              <label htmlFor="tour-max">Limite de jogadores</label>
              <input
                id="tour-max"
                className="admin-search"
                type="number"
                min={2}
                max={256}
                placeholder="Sem limite"
                value={form.maxPlayers ?? ''}
                onChange={(e) => set('maxPlayers', num(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="tour-start">Início previsto</label>
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
                Check-in, início automático e W.O. por ausência
              </label>
              <p className="muted small">
                O check-in abre 30 minutos antes do início para os inscritos. Na hora marcada o torneio começa sozinho: a rodada 1 é
                sorteada entre todos os inscritos e a sala de cada mesa fica pronta para os dois jogadores. Em cada rodada, cada
                jogador tem a tolerância abaixo para entrar na sala: quem não entra perde por W.O. e sai do torneio; se nenhum dos
                dois entra, os dois perdem. Na rodada 1, o check-in já vale como presença.
              </p>
              {form.checkIn && (
                <div className="tour-form-row">
                  <div className="field">
                    <label htmlFor="tour-tolerance">Tolerância para entrar na sala (minutos)</label>
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
            <p className="muted small">Com uma data de início, o torneio pode ter check-in e começar sozinho na hora marcada.</p>
          )}
          {form.structure === 'swiss' && (
            <p className="muted small">Rodadas em branco: o número é calculado no início pelo total de inscritos.</p>
          )}
          {error && <div className="error">{error}</div>}
          <div className="btn-row">
            <button className="btn" onClick={onCancel}>
              Cancelar
            </button>
            <button className="btn primary" disabled={saving || form.name.trim().length < 3} onClick={save}>
              {saving ? 'Salvando…' : initial ? 'Salvar' : 'Criar torneio'}
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
function nextLabel(t: TournamentDetail): string {
  if (t.next === 'finish') return 'Encerrar torneio';
  if (t.next === 'cut') return `Começar o Top ${t.topCut}`;
  if (t.next === 'elim') {
    const current = t.rounds[t.round - 1]?.matches.length ?? 0;
    return `Próxima fase: ${phaseLabel(current)}`;
  }
  return `Gerar rodada ${t.round + 1}`;
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

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          ← Menu
        </button>
        <h2>{t?.name ?? 'Torneio'}</h2>
      </header>
      <div className="coverage-body tour-page">
        {error && <div className="error">{error}</div>}
        {!t && !error && <p className="muted">Carregando…</p>}
        {t && (
          <>
            <section className="menu-card tour-info">
              <div className="tour-card-head">
                <span className={['tour-status', t.status].join(' ')}>{TOURNAMENT_STATUS_LABEL[t.status]}</span>
                {t.status === 'running' && current && (
                  <strong>
                    {current.stage === 'elim' ? current.label : `Rodada ${t.round} de ${t.swissRounds ?? t.totalRounds}`}
                    {current.bestOf > 1 && ` · ${bestOfLabel(current.bestOf)}`}
                  </strong>
                )}
              </div>
              <p className="muted small">
                {formatLabel(t.format)} · {STRUCTURE_LABEL[t.structure]}
                {t.structure === 'swiss' &&
                  (t.roundsAuto && t.status === 'registration' ? ' (rodadas pelo nº de inscritos)' : ` (${t.swissRounds} rodadas)`)}
                {t.structure === 'swiss' && t.swissBestOf > 1 && ` em ${bestOfLabel(t.swissBestOf).toLowerCase()}`}
                {t.topCut && ` + Top ${t.topCut}`} · {t.players.length}
                {t.maxPlayers ? `/${t.maxPlayers}` : ''} inscrito{t.players.length === 1 ? '' : 's'}
                {t.organizerName && ` · Organizado por ${t.organizerName}`}
                {t.startsAt && t.status === 'registration' && ` · Começa em ${dateTime(t.startsAt)}`}
              </p>
              {t.checkIn && t.status === 'registration' && (
                <p className="small tour-checkin-info">
                  ✅ Check-in {t.checkInOpen ? 'aberto' : `abre às ${time(t.checkInOpensAt)}`} ({minutes(t.checkInMs)} antes do início) ·
                  o torneio começa sozinho em {dateTime(t.startsAt)} · {t.checkedIn}/{t.players.length} com check-in
                </p>
              )}
              {t.checkIn && t.status === 'running' && (
                <p className="muted small">
                  ⏳ Em cada rodada, cada jogador tem {minutes(t.toleranceMs)} para entrar na sala: quem não entra perde por W.O. e sai do
                  torneio; se nenhum dos dois entra, os dois perdem.
                </p>
              )}
              {(t.bo3From || t.bo5From) && (
                <p className="muted small">
                  Eliminatória:
                  {t.bo3From && ` melhor de 3 a partir ${phaseFrom(t.bo3From)}`}
                  {t.bo3From && t.bo5From && ';'}
                  {t.bo5From && ` melhor de 5 a partir ${phaseFrom(t.bo5From)}`}.
                </p>
              )}
              <p className="muted small">
                ⏱ Cada jogador tem {clock(t.clockMs)} por jogo, que só corre na vez dele. Quem zera o tempo perde o jogo: não há
                turnos extras nem empate por tempo.
              </p>
              {t.description && <p className="tour-desc">{t.description}</p>}
              {t.status === 'finished' && t.standings[0] && (
                <p className="tour-champion">
                  🏆 Campeão: <b>{t.standings[0].name}</b>
                </p>
              )}
            </section>

            <MyArea t={t} busy={busy} run={run} onPlay={onPlay} setError={setError} />

            {t.canManage && (
              <section className="menu-card tour-manage">
                <h2>Organização</h2>
                <div className="btn-row">
                  {t.status === 'registration' && (
                    <>
                      <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
                        Editar
                      </button>
                      <button
                        className="btn primary"
                        disabled={busy || t.players.length < 2}
                        title={t.players.length < 2 ? 'São precisos pelo menos 2 inscritos' : undefined}
                        onClick={() =>
                          run(
                            () => api.tournaments.start(t.id),
                            `Fechar as inscrições e começar o torneio com ${t.players.length} jogadores?`,
                          ).then(() => {
                            setTab('rounds');
                            setViewRound(null);
                          })
                        }
                      >
                        Começar torneio
                      </button>
                    </>
                  )}
                  {t.status === 'running' && (
                    <>
                      <button
                        className="btn primary"
                        disabled={busy || !t.roundComplete}
                        title={t.roundComplete ? undefined : 'Todas as partidas da rodada precisam de resultado'}
                        onClick={() =>
                          run(
                            () => api.tournaments.next(t.id),
                            lastRound ? 'Esta é a última rodada. Encerrar o torneio?' : undefined,
                          ).then(() => setViewRound(null))
                        }
                      >
                        {nextLabel(t)}
                      </button>
                      {!lastRound && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            run(() => api.tournaments.finish(t.id), 'Encerrar o torneio agora? A classificação fica como está.')
                          }
                        >
                          Encerrar agora
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
                      }, `Apagar o torneio "${t.name}"? Isso não pode ser desfeito.`)
                    }
                  >
                    Apagar
                  </button>
                </div>
                {t.status === 'registration' && t.checkIn && (
                  <p className="muted small">
                    O torneio começa sozinho em {dateTime(t.startsAt)} com todos os inscritos (quem não fez check-in nem entra na sala em{' '}
                    {minutes(t.toleranceMs)} perde por W.O.). Começar agora não espera a hora.
                  </p>
                )}
                {t.status !== 'registration' && (
                  <p className="muted small">
                    Os resultados dos jogos disputados no site entram sozinhos. Lance à mão os de W.O. ou de partidas jogadas fora do
                    site. Para corrigir um resultado lançado errado, escolha o placar certo na partida, inclusive em rodadas
                    passadas. Todos os jogos ficam gravados: em cada partida, abra "Jogos gravados" para rever o replay; os
                    problemas relatados pelos jogadores ficam na aba Relatos.
                  </p>
                )}
              </section>
            )}

            <div className="seg tour-tabs">
              {t.status !== 'registration' && (
                <button className={activeTab === 'rounds' ? 'on' : ''} onClick={() => setTab('rounds')}>
                  Rodadas
                </button>
              )}
              {t.status !== 'registration' && (
                <button className={activeTab === 'standings' ? 'on' : ''} onClick={() => setTab('standings')}>
                  Classificação
                </button>
              )}
              <button className={activeTab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
                Inscritos ({t.players.length})
              </button>
              {t.canManage && t.status !== 'registration' && (
                <button className={activeTab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
                  Relatos{t.openReports ? ` (${t.openReports})` : ''}
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
                        title={r.label}
                        onClick={() => setViewRound(r.round)}
                      >
                        {r.stage === 'elim' ? shortPhase(r.label) : r.round}
                      </button>
                    ))}
                  </div>
                )}
                {t.rounds[shownRound - 1] && (
                  <h3 className="tour-round-title">
                    {t.rounds[shownRound - 1].label}
                    <span className="muted small"> · {bestOfLabel(t.rounds[shownRound - 1].bestOf)}</span>
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
                    t.status === 'registration'
                      ? `Remover a inscrição de ${name}?`
                      : `Tirar ${name} do torneio? A partida pendente dele nesta rodada vai para o oponente.`,
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
        <p className="muted small">Entre com a conta Google no menu para se inscrever.</p>
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
        <h2>{t.me ? 'Sua inscrição' : 'Inscrição'}</h2>
        {t.me && (
          <p className="small">
            Inscrito com <b>{t.me.deckName}</b>. A lista fica congelada como estava na inscrição: se mudar o deck depois, inscreva-o
            de novo.
          </p>
        )}
        {t.me && t.checkIn && (
          <div className="tour-checkin">
            {t.me.checkedInAt ? (
              <p className="tour-my-result">
                ✔ Check-in feito às {time(t.me.checkedInAt)}. O torneio começa em {dateTime(t.startsAt)}: a sua sala aparece aqui e na
                tela inicial.
              </p>
            ) : t.checkInOpen ? (
              <>
                <button className="btn primary" disabled={busy} onClick={() => run(() => api.tournaments.checkIn(t.id))}>
                  Fazer check-in
                </button>
                <p className="muted small">
                  O torneio começa em {dateTime(t.startsAt)}. Sem check-in, você ainda tem {minutes(t.toleranceMs)} depois do início
                  para entrar na sala; depois disso perde por W.O.
                </p>
              </>
            ) : (
              <p className="muted small">
                O check-in abre às {time(t.checkInOpensAt)} ({minutes(t.checkInMs)} antes do início, em {dateTime(t.startsAt)}).
              </p>
            )}
          </div>
        )}
        {full ? (
          <p className="muted">O torneio está lotado.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="tour-deck">Deck ({formatLabel(t.format)})</label>
              <select id="tour-deck" className="admin-search" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">{decks ? 'Escolha um deck' : 'Carregando…'}</option>
                {mine.length > 0 && (
                  <optgroup label="Meus decks">
                    {mine.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label="Outros decks">
                    {others.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {decks && !playable.length && (
                <p className="muted small">Nenhum dos decks é permitido no {formatLabel(t.format)}. Monte um em "Montar decks".</p>
              )}
            </div>
            <div className="btn-row">
              <button
                className="btn primary"
                disabled={busy || !deckId || (t.me?.deckId === deckId)}
                onClick={() => run(() => api.tournaments.register(t.id, deckId))}
              >
                {t.me ? 'Trocar deck' : 'Inscrever-se'}
              </button>
              {t.me && (
                <button className="btn" disabled={busy} onClick={() => run(() => api.tournaments.leave(t.id), 'Cancelar a sua inscrição?')}>
                  Cancelar inscrição
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
          Você terminou em <b>{s.rank}º</b> lugar ({s.wins}V {s.losses}D{t.structure === 'swiss' ? ' no suíço' : ''}).
        </p>
      </section>
    ) : null;
  }
  if (t.me.dropped) {
    return (
      <section className="menu-card tour-me">
        <p className="muted">Você saiu deste torneio.</p>
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
        Sua partida · {round?.label ?? `Rodada ${t.round}`}
        {m && m.bestOf > 1 ? ` · ${bestOfLabel(m.bestOf)}` : ''}
      </h2>
      {!m ? (
        <p className="muted">Você não está nesta rodada.</p>
      ) : !opp ? (
        <p>Você está de <b>bye</b> nesta rodada: a vitória já é sua. Aguarde a próxima rodada.</p>
      ) : (
        <>
          <p>
            Mesa {m.table}: contra <b>{opp.name}</b>
            {m.bestOf > 1 && (
              <>
                {' '}
                · placar <b>{m.wins[mine!]}–{m.wins[1 - mine!]}</b>
              </>
            )}
          </p>
          {m.result ? (
            <p className="tour-my-result">
              {m.result === 'none' ? 'W.O. duplo: ninguém entrou na sala.' : m.winner === user.id ? '✔ Vitória!' : 'Derrota.'}
              {m.reportedBy === 'noshow' && m.winner === user.id && ' O oponente não entrou na sala.'} Aguarde a próxima rodada.
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
                {m.room === 'playing' ? 'Voltar ao jogo' : m.bestOf > 1 ? `Jogar o jogo ${m.game}` : 'Jogar partida'}
              </button>
              <p className="muted small">
                {m.room === 'waiting'
                  ? 'Uma das pessoas já está na sala esperando.'
                  : `Quem entrar primeiro espera o oponente na sala. O resultado entra sozinho no torneio.${
                      m.bestOf > 1 ? ` Vence quem ganhar ${winsNeeded(m.bestOf)} jogos; quem perde um jogo começa o seguinte.` : ''
                    }`}
              </p>
            </>
          )}
        </>
      )}
      <div className="btn-row">
        <button
          className="btn small"
          disabled={busy}
          onClick={() =>
            run(
              () => api.tournaments.leave(t.id),
              'Desistir do torneio? Você sai das próximas rodadas e, se a sua partida desta rodada não terminou, o oponente vence.',
            )
          }
        >
          Desistir do torneio
        </button>
      </div>
    </section>
  );
}

const REPORTED: Record<NonNullable<TournamentMatchInfo['reportedBy']>, string> = {
  game: 'partida no site',
  bye: 'bye',
  drop: 'desistência',
  noshow: 'W.O. por ausência',
  organizer: 'lançado pelo organizador',
};

/** Prazo para entrar na sala (contagem regressiva). */
function Deadline({ deadline, mine }: { deadline: string; mine: boolean }) {
  const now = useNow(1000);
  return (
    <p className="tour-deadline">
      ⏳ {mine ? 'O oponente tem' : 'Entre na sala'} até <b>{time(deadline)}</b> ({remaining(deadline, now)}).
      {mine ? ' Se não entrar, a vitória é sua por W.O.' : ' Quem não entra perde por W.O.'}
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
  const name = (p: TournamentMatchInfo['p1'] | null, won: boolean) =>
    p ? <span className={['tour-player', won ? 'won' : m.result ? 'lost' : ''].join(' ')}>{p.name}</span> : null;
  const played = m.wins[0] + m.wins[1] > 0;
  const missing = deadline && !m.result && m.p2 ? [m.p1, m.p2].filter((_, i) => !m.present[i]).map((p) => p.name) : [];
  return (
    <div className="tour-match">
      <span className="tour-table muted small">Mesa {m.table}</span>
      <div className="tour-vs">
        {name(m.p1, m.winner === m.p1.userId)}
        {m.p2 ? (
          <>
            <span className={m.bestOf > 1 && (played || m.result) ? 'tour-score' : 'muted small'}>
              {m.bestOf > 1 && (played || m.result) ? `${m.wins[0]}–${m.wins[1]}` : 'vs'}
            </span>
            {name(m.p2, m.winner === m.p2.userId)}
          </>
        ) : (
          <span className="muted small">bye</span>
        )}
      </div>
      <div className="tour-match-side">
        {m.result === 'none' && <span className="muted small">W.O. duplo</span>}
        {m.result && m.result !== 'none' && m.reportedBy && m.reportedBy !== 'bye' && <span className="muted small">{REPORTED[m.reportedBy]}</span>}
        {!m.result && m.room === 'playing' && (
          <button className="btn small" onClick={onWatch}>
            👁 Assistir{m.bestOf > 1 ? ` o jogo ${m.game}` : ''}
          </button>
        )}
        {!m.result && m.room !== 'playing' && (
          <span className="muted small">
            {missing.length
              ? `Falta entrar: ${missing.join(' e ')}`
              : m.room === 'waiting'
                ? 'Na sala…'
                : m.bestOf > 1 && played
                  ? `Jogo ${m.game} pendente`
                  : 'Pendente'}
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
                {m.bestOf === 1 ? `${winner} venceu` : `${winner} ${Math.max(a, b)}–${Math.min(a, b)}`}
              </button>
            );
          })}
          {current && (played || m.result) && (
            <button disabled={busy} title="Zerar o placar" onClick={() => onScore([0, 0])}>
              ✕
            </button>
          )}
        </div>
      )}
      {m.games.length > 0 && (
        <details className="tour-games">
          <summary className="small">Jogos gravados ({m.games.length})</summary>
          <ul className="small">
            {m.games.map((g, i) => (
              <li key={i}>
                Jogo {g.game} · {g.winner ? <>venceu <b>{g.winner.name}</b></> : 'sem vencedor'} · {time(g.playedAt)}
                {!g.counted && <span className="muted"> · não contou no placar</span>}
                {g.statsMatchId !== null && (
                  <button className="btn small" disabled={busy} onClick={() => onReplay(g.statsMatchId!)}>
                    ▶ Assistir replay
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
  const champion = t.status === 'finished' ? t.standings[0]?.userId : null;
  return (
    <section className="menu-card tour-standings">
      <table className="cov-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Jogador</th>
            <th>Pts</th>
            <th>V-D</th>
            <th title="% de vitórias dos oponentes">OMW</th>
            <th title="% de vitórias dos oponentes dos oponentes">OOMW</th>
          </tr>
        </thead>
        <tbody>
          {t.standings.map((s) => (
            <tr key={s.userId} className={s.dropped ? 'muted' : ''}>
              <td>{s.rank}</td>
              <td>
                {s.name}
                {s.userId === champion && <span className="tour-badge gold">campeão</span>}
                {s.dropped && <span className="tour-badge">saiu</span>}
                {t.topCut && s.inElim && s.userId !== champion && <span className="tour-badge">Top {t.topCut}</span>}
                {s.inElim && !s.alive && !s.dropped && t.status === 'running' && <span className="tour-badge">eliminado</span>}
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
        <p className="muted small">
          Classificação do suíço pelas regras oficiais: pontos (vitória 3, derrota 0; bye conta como vitória), depois OMW (% de
          vitórias dos oponentes, mínimo de 33% por oponente), depois OOMW (média do OMW dos oponentes) e, empatado em tudo,
          a ordem sorteada no início.
          {t.topCut ? ` Quem chegou mais longe no Top ${t.topCut} fica acima.` : ''}
        </p>
      )}
    </section>
  );
}

function Players({ t, busy, onDrop }: { t: TournamentDetail; busy: boolean; onDrop: (userId: string, name: string) => void }) {
  if (!t.players.length) {
    return (
      <section className="menu-card">
        <p className="muted">Ninguém se inscreveu ainda.</p>
      </section>
    );
  }
  return (
    <section className="menu-card">
      <div className="tour-players">
        {t.players.map((p) => (
          <div key={p.userId} className={['tour-entry', p.dropped ? 'dropped' : ''].join(' ')}>
            <div className="tour-entry-head">
              <LeaderArt name={p.leaderName ?? p.leader} image={p.leaderImage} colors={p.colors} size="small" />
              <span className="watch-name">
                <b>{p.name}</b>
                <span className="muted small">
                  {p.leaderName ?? p.leader}
                  {p.dropped ? ' · saiu do torneio' : ''}
                  {t.checkIn && t.status === 'registration' && p.checkedIn ? ' · ✔ check-in' : ''}
                </span>
              </span>
              {t.canManage && t.status !== 'finished' && !p.dropped && (
                <button className="btn small" disabled={busy} onClick={() => onDrop(p.userId, p.name)}>
                  {t.status === 'registration' ? 'Remover' : 'Tirar'}
                </button>
              )}
            </div>
            {p.deck && (
              <details className="tour-deck">
                <summary className="small">Lista: {p.deck.name}</summary>
                <ul className="small">
                  {p.deck.cards.map((c) => (
                    <li key={c.id}>
                      {c.count}× {c.name ?? c.id} <span className="muted">{c.id}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
      {t.status !== 'finished' && !t.canManage && (
        <p className="muted small">As listas dos decks ficam públicas quando o torneio termina.</p>
      )}
    </section>
  );
}
