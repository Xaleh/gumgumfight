import { FORMATS, formatLabel } from '@gumgum/engine';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  canPlay,
  type DeckSummary,
  type OnlineSeat,
  STRUCTURE_LABEL,
  type TournamentDetail,
  type TournamentInput,
  type TournamentMatchInfo,
  type TournamentResult,
  type TournamentSummary,
  TOURNAMENT_STATUS_LABEL,
  type WatchTarget,
} from '../api';
import { useAuth } from '../auth';
import { LeaderArt } from './LeaderArt';

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

/**
 * Torneios: a lista, a página de cada torneio (inscrição, rodadas, classificação e
 * inscritos) e, para organizadores e admins, a criação e o gerenciamento.
 */
export function Tournaments({
  initialId,
  onExit,
  onPlay,
  onWatch,
}: {
  initialId?: string;
  onExit: () => void;
  /** Entra na sala online da partida do torneio. */
  onPlay: (seat: OnlineSeat, tournamentId: string) => void;
  onWatch: (target: WatchTarget, tournamentId: string) => void;
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
        onBack={() => setOpenId(null)}
        onPlay={(seat) => onPlay(seat, openId)}
        onWatch={(t) => onWatch(t, openId)}
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
                {formatLabel(t.format)} · {STRUCTURE_LABEL[t.structure]} · {t.players}
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
    rounds: initial && !initial.roundsAuto ? initial.totalRounds : null,
    maxPlayers: initial?.maxPlayers ?? null,
    startsAt: initial?.startsAt ?? null,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TournamentInput>(k: K, v: TournamentInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(initial ? await api.tournaments.update(initial.id, form) : await api.tournaments.create(form));
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
                ? 'Todos jogam todas as rodadas, sempre contra quem tem a mesma pontuação (vitória 3, empate 1). Desempate por % de vitórias dos oponentes.'
                : 'Quem perde sai. A chave é sorteada no início; com número de jogadores fora de potência de 2, os primeiros sorteados ganham bye.'}
            </p>
          </div>
          <div className="tour-form-row">
            {form.structure === 'swiss' && (
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
            )}
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

type Tab = 'rounds' | 'standings' | 'players';

function TournamentPage({
  id,
  onBack,
  onPlay,
  onWatch,
}: {
  id: string;
  onBack: () => void;
  onPlay: (seat: OnlineSeat) => void;
  onWatch: (t: WatchTarget) => void;
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
  const lastRound = t ? (t.structure === 'swiss' ? t.round >= t.totalRounds : (t.rounds.at(-1)?.matches.length ?? 0) <= 1) : false;

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onBack}>
          ← Torneios
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
                {t.status === 'running' && (
                  <strong>
                    Rodada {t.round} de {t.totalRounds}
                  </strong>
                )}
              </div>
              <p className="muted small">
                {formatLabel(t.format)} · {STRUCTURE_LABEL[t.structure]} · {t.players.length}
                {t.maxPlayers ? `/${t.maxPlayers}` : ''} inscrito{t.players.length === 1 ? '' : 's'}
                {t.structure === 'swiss' && t.status === 'registration' && (t.roundsAuto ? ' · rodadas pelo nº de inscritos' : ` · ${t.totalRounds} rodadas`)}
                {t.organizerName && ` · Organizado por ${t.organizerName}`}
                {t.startsAt && t.status === 'registration' && ` · Começa em ${dateTime(t.startsAt)}`}
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
                        {lastRound ? 'Encerrar torneio' : `Gerar rodada ${t.round + 1}`}
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
                        onBack();
                      }, `Apagar o torneio "${t.name}"? Isso não pode ser desfeito.`)
                    }
                  >
                    Apagar
                  </button>
                </div>
                {t.status === 'running' && !t.roundComplete && (
                  <p className="muted small">
                    Os resultados das partidas jogadas no site entram sozinhos. Lance à mão os de W.O. ou de partidas jogadas fora
                    do site; você também pode corrigir qualquer resultado da rodada atual.
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
            </div>

            {activeTab === 'rounds' && t.round > 0 && (
              <section className="menu-card">
                {t.round > 1 && (
                  <div className="seg small tour-rounds">
                    {t.rounds.map((r) => (
                      <button key={r.round} className={shownRound === r.round ? 'on' : ''} onClick={() => setViewRound(r.round)}>
                        {r.round}
                      </button>
                    ))}
                  </div>
                )}
                <div className="tour-matches">
                  {t.rounds[shownRound - 1]?.matches.map((m) => (
                    <MatchRow
                      key={m.id}
                      t={t}
                      m={m}
                      editable={t.canManage && t.status === 'running' && shownRound === t.round}
                      busy={busy}
                      onResult={(r) => run(() => api.tournaments.setResult(t.id, m.id, r))}
                      onWatch={() => m.roomId && onWatch({ roomId: m.roomId, hands: false })}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'standings' && <Standings t={t} />}

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
          Você terminou em <b>{s.rank}º</b> lugar ({s.wins}V {s.losses}D{s.draws ? ` ${s.draws}E` : ''}).
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
  const m = t.rounds[t.round - 1]?.matches.find((x) => x.id === t.me!.matchId);
  const opp = m && (m.p1.userId === user.id ? m.p2 : m.p1);
  return (
    <section className="menu-card tour-me">
      <h2>Sua partida · Rodada {t.round}</h2>
      {!m ? (
        <p className="muted">Você não foi pareado nesta rodada.</p>
      ) : !opp ? (
        <p>Você está de <b>bye</b> nesta rodada: a vitória já é sua. Aguarde a próxima rodada.</p>
      ) : (
        <>
          <p>
            Mesa {m.table}: contra <b>{opp.name}</b>
          </p>
          {m.result ? (
            <p className="tour-my-result">
              {m.result === 'draw' ? 'Empate.' : m.winner === user.id ? '✔ Vitória!' : 'Derrota.'} Aguarde a próxima rodada.
            </p>
          ) : (
            <>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    onPlay(await api.tournaments.play(t.id, m.id));
                  })
                }
              >
                {m.room === 'playing' ? 'Voltar à partida' : 'Jogar partida'}
              </button>
              <p className="muted small">
                {m.room === 'waiting'
                  ? 'Uma das pessoas já está na sala esperando.'
                  : 'Quem entrar primeiro espera o oponente na sala. O resultado entra sozinho no torneio.'}
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
  organizer: 'lançado pelo organizador',
};

function MatchRow({
  t,
  m,
  editable,
  busy,
  onResult,
  onWatch,
}: {
  t: TournamentDetail;
  m: TournamentMatchInfo;
  editable: boolean;
  busy: boolean;
  onResult: (r: TournamentResult | null) => void;
  onWatch: () => void;
}) {
  const name = (p: TournamentMatchInfo['p1'] | null, won: boolean) =>
    p ? <span className={['tour-player', won ? 'won' : m.result && m.result !== 'draw' ? 'lost' : ''].join(' ')}>{p.name}</span> : null;
  return (
    <div className="tour-match">
      <span className="tour-table muted small">Mesa {m.table}</span>
      <div className="tour-vs">
        {name(m.p1, m.winner === m.p1.userId)}
        {m.p2 ? (
          <>
            <span className="muted small">vs</span>
            {name(m.p2, m.winner === m.p2.userId)}
          </>
        ) : (
          <span className="muted small">bye</span>
        )}
      </div>
      <div className="tour-match-side">
        {m.result === 'draw' && <span className="tour-badge">Empate</span>}
        {m.result && m.reportedBy && m.reportedBy !== 'bye' && <span className="muted small">{REPORTED[m.reportedBy]}</span>}
        {!m.result && m.room === 'playing' && (
          <button className="btn small" onClick={onWatch}>
            👁 Assistir
          </button>
        )}
        {!m.result && m.room !== 'playing' && <span className="muted small">{m.room === 'waiting' ? 'Na sala…' : 'Pendente'}</span>}
      </div>
      {editable && m.p2 && (
        <div className="seg small tour-result">
          <button className={m.result === 'p1' ? 'on' : ''} disabled={busy} onClick={() => onResult('p1')}>
            {m.p1.name} venceu
          </button>
          {t.structure === 'swiss' && (
            <button className={m.result === 'draw' ? 'on' : ''} disabled={busy} onClick={() => onResult('draw')}>
              Empate
            </button>
          )}
          <button className={m.result === 'p2' ? 'on' : ''} disabled={busy} onClick={() => onResult('p2')}>
            {m.p2.name} venceu
          </button>
          {m.result && (
            <button disabled={busy} title="Apagar o resultado" onClick={() => onResult(null)}>
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Standings({ t }: { t: TournamentDetail }) {
  return (
    <section className="menu-card tour-standings">
      <table className="cov-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Jogador</th>
            <th>Pts</th>
            <th>V-D-E</th>
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
                {s.dropped && <span className="tour-badge">saiu</span>}
                {t.structure === 'single' && !s.alive && !s.dropped && t.status === 'running' && (
                  <span className="tour-badge">eliminado</span>
                )}
              </td>
              <td>{s.points}</td>
              <td>
                {s.wins}-{s.losses}-{s.draws}
              </td>
              <td>{pct(s.omw)}</td>
              <td>{pct(s.oomw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.structure === 'swiss' && (
        <p className="muted small">Vitória vale 3 pontos, empate 1 e bye conta como vitória. Desempate: OMW e depois OOMW.</p>
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
