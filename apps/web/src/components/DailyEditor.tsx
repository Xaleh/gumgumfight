// Administração › Desafio do dia: a lista dos desafios (catálogo e Administração, com a posição na fila e os dias em
// que saíram) e o editor. No editor, o admin monta a mesa área por área com os decks escolhidos, vai para a mesa de
// verdade e grava jogando a solução (e, se quiser, uma linha errada). O servidor confere tudo de novo ao salvar.

import {
  type Action,
  buildChallenge,
  type CardData,
  type ChallengeSpec,
  type ChallengeStatus,
  type DeckList,
  type GameState,
  runChallenge,
} from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AdminDailyChallenge, type AdminDailyQueue, ApiError, api, type DeckSummary } from '../api';
import {
  addCard,
  attackOptions,
  DON_TOTAL,
  donUsed,
  boardKey,
  draftFromSpec,
  draftProblems,
  type EditorDraft,
  emptyDraft,
  type FieldDraft,
  forecastDays,
  MAX_CHARACTERS,
  removeCard,
  setDeck,
  type SideDraft,
  specOf,
  updateField,
  updateSide,
  usedCopies,
  type Zone,
  ZONES,
} from '../game/dailyEditor';
import { LOCALES, type MessageKey, useT } from '../i18n';
import { useSettings } from '../settings';
import { LessonTable, type TableGame } from './GameScreen';
import { Icon } from './Icons';

const noop = () => undefined;
const GOAL: Record<ChallengeSpec['goal'], MessageKey> = { lethal: 'daily.goal.lethal.title', survive: 'daily.goal.survive.title' };
const LEVEL: Record<1 | 2 | 3, MessageKey> = { 1: 'daily.level1', 2: 'daily.level2', 3: 'daily.level3' };
const ZONE_LABEL: Record<Zone, MessageKey> = {
  hand: 'daily.admin.zone.hand',
  characters: 'daily.admin.zone.characters',
  stage: 'daily.admin.zone.stage',
  life: 'daily.admin.zone.life',
  deckTop: 'daily.admin.zone.deckTop',
  trash: 'daily.admin.zone.trash',
};
const PROBLEM: Record<ReturnType<typeof draftProblems>[number], MessageKey> = {
  decks: 'daily.admin.problem.decks',
  don0: 'daily.admin.problem.don0',
  don1: 'daily.admin.problem.don1',
  attacks: 'daily.admin.problem.attacks',
};

// ------------------------------------------------------------------ lista

/** O que o editor abre: um desafio novo, um existente para editar (`id`) ou uma cópia (sem `id`). */
export interface EditorStart {
  id: string | null;
  spec: Omit<ChallengeSpec, 'id'>;
  solution: Action[] | null;
  wrong: Action[] | null;
  note: string;
}

const fmtDay = (day: string, locale: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/**
 * A aba: datas fixas, a fila (com ↑↓ entre os que ainda não saíram e o dia previsto de cada um) e os dias já
 * publicados com os números. O editor abre fora da página da Administração (a gravação usa a mesa em tela cheia).
 */
export function DailyAdminPanel({ onOpen }: { onOpen: (start: EditorStart | null) => void }) {
  const t = useT();
  const { locale } = useSettings();
  const [data, setData] = useState<AdminDailyQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pinDay, setPinDay] = useState<Record<string, string>>({});
  useEffect(() => {
    let stop = false;
    api.admin.daily
      .challenges()
      .then((r) => !stop && (setData(r), setError(null)))
      .catch((e: unknown) => !stop && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stop = true;
    };
  }, [attempt]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (c: AdminDailyChallenge, copy: boolean) =>
    run(async () => {
      const d = await api.admin.daily.challenge(c.id);
      onOpen({ id: copy ? null : d.id, spec: d.spec, solution: d.solution, wrong: d.wrong, note: copy ? '' : (d.note ?? '') });
    });

  const byId = new Map((data?.challenges ?? []).map((c) => [c.id, c]));
  const today = data?.today ?? '';
  const todayPublished = Boolean(data?.published.some((p) => p.day === today));
  const queue = (data?.queue ?? []).map((id) => byId.get(id)).filter((c): c is AdminDailyChallenge => Boolean(c));
  const fresh = queue.filter((c) => c.days.length === 0).map((c) => c.id);
  const forecast = data ? forecastDays(todayPublished ? nextDayOf(today) : today, queue.length, data.pinned.map((p) => p.day)) : [];
  const move = (id: string, delta: -1 | 1) => {
    const i = fresh.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fresh.length) return;
    const order = [...fresh];
    [order[i], order[j]] = [order[j], order[i]];
    void run(() => api.admin.daily.order(order));
  };

  const info = (c: AdminDailyChallenge) => (
    <div className="daily-admin-main">
      <strong>{c.leaders.map((l) => l.name).join(' × ')}</strong>
      <span className="muted small">
        {t(GOAL[c.goal])} · {t(LEVEL[c.level] ?? LEVEL[1])} · {c.source === 'catalog' ? `${t('daily.admin.fromCatalog')} (${c.id})` : t('daily.admin.fromAdmin')}
        {c.days.length ? ` · ${t('daily.admin.days', { days: c.days.slice(-3).join(', '), n: c.days.length })}` : ` · ${t('daily.admin.notYet')}`}
      </span>
      {c.note && <span className="small">{c.note}</span>}
    </div>
  );
  const actions = (c: AdminDailyChallenge) => {
    const editable = c.source === 'admin' && c.days.length === 0;
    return (
      <div className="daily-admin-actions">
        {editable && (
          <button type="button" className="btn small" disabled={busy} onClick={() => void open(c, false)}>
            {t('daily.admin.edit')}
          </button>
        )}
        <button type="button" className="btn small" disabled={busy} onClick={() => void open(c, true)}>
          {t('daily.admin.duplicate')}
        </button>
        {editable && (
          <button
            type="button"
            className="btn small"
            disabled={busy}
            aria-label={t('daily.admin.remove')}
            onClick={() => window.confirm(t('daily.admin.removeConfirm')) && void run(() => api.admin.daily.remove(c.id))}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    );
  };
  const pinForm = (c: AdminDailyChallenge) => (
    <form
      className="daily-admin-pin"
      onSubmit={(e) => {
        e.preventDefault();
        const day = pinDay[c.id];
        if (day) void run(() => api.admin.daily.pin(c.id, day));
      }}
    >
      <input
        type="date"
        min={today}
        value={pinDay[c.id] ?? ''}
        aria-label={t('daily.admin.pinDay')}
        onChange={(e) => setPinDay((p) => ({ ...p, [c.id]: e.target.value }))}
      />
      <button type="submit" className="btn small" disabled={busy || !pinDay[c.id]}>
        {t('daily.admin.pin')}
      </button>
    </form>
  );

  return (
    <section className="daily-admin">
      <p className="muted small">{t('daily.admin.hint')}</p>
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => onOpen(null)}>
          <Icon name="plus" size={16} />
          {t('daily.admin.new')}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {data === null && !error && <p className="muted">{t('common.loading')}</p>}

      {data && data.pinned.length > 0 && (
        <>
          <h3 className="daily-admin-title">{t('daily.admin.pinnedTitle')}</h3>
          <ol className="daily-admin-list">
            {data.pinned.map((p) => {
              const c = byId.get(p.challengeId);
              if (!c) return null;
              return (
                <li key={p.day} className="daily-admin-item">
                  <span className="daily-admin-date">{fmtDay(p.day, locale)}</span>
                  {info(c)}
                  <div className="daily-admin-actions">
                    <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => api.admin.daily.pin(c.id, null))}>
                      {t('daily.admin.unpin')}
                    </button>
                  </div>
                  {actions(c)}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {data && (
        <>
          <h3 className="daily-admin-title">{t('daily.admin.queueTitle')}</h3>
          <p className="muted small">{t('daily.admin.queueHint')}</p>
          <ol className="daily-admin-list">
            {queue.map((c, k) => {
              const i = fresh.indexOf(c.id);
              return (
                <li key={c.id} className="daily-admin-item">
                  <span className="daily-admin-pos" title={t('daily.admin.queuePos')}>
                    {k + 1}
                  </span>
                  <div className="daily-admin-col">
                    <span className="daily-admin-date small">{t('daily.admin.forecast', { day: fmtDay(forecast[k], locale) })}</span>
                    {info(c)}
                  </div>
                  {i >= 0 && (
                    <div className="daily-admin-move">
                      <button type="button" className="btn small" disabled={busy || i === 0} aria-label={t('daily.admin.up')} onClick={() => move(c.id, -1)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy || i === fresh.length - 1}
                        aria-label={t('daily.admin.down')}
                        onClick={() => move(c.id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                  {pinForm(c)}
                  {actions(c)}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {data && data.published.length > 0 && (
        <>
          <h3 className="daily-admin-title">{t('daily.admin.publishedTitle')}</h3>
          <div className="daily-admin-table" role="table" aria-label={t('daily.admin.publishedTitle')}>
            <div className="daily-admin-row head" role="row">
              <span role="columnheader">{t('daily.admin.col.day')}</span>
              <span role="columnheader">{t('daily.admin.col.challenge')}</span>
              <span role="columnheader">{t('daily.admin.col.opened')}</span>
              <span role="columnheader">{t('daily.admin.col.tried')}</span>
              <span role="columnheader">{t('daily.admin.col.solved')}</span>
              <span role="columnheader">{t('daily.admin.col.avg')}</span>
            </div>
            {data.published.map((p) => {
              const c = byId.get(p.challenge_id);
              return (
                <div key={p.day} className="daily-admin-row" role="row">
                  <span role="cell">
                    #{p.number} · {fmtDay(p.day, locale)}
                  </span>
                  <span role="cell">{c ? c.leaders.map((l) => l.name).join(' × ') : p.challenge_id}</span>
                  <span role="cell">{p.opened}</span>
                  <span role="cell">{p.players}</span>
                  <span role="cell">
                    {p.solvers}
                    {p.players > 0 ? ` (${Math.round((p.solvers / p.players) * 100)}%)` : ''}
                  </span>
                  <span role="cell">{p.avgAttempts ?? '—'}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const nextDayOf = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ editor

interface DeckData {
  deck: DeckList;
  cards: CardData[];
}

function useDeckData(id: string | null): DeckData | null {
  const [data, setData] = useState<DeckData | null>(null);
  useEffect(() => {
    let stop = false;
    setData(null);
    if (id)
      api
        .deck(id)
        .then((r) => !stop && setData({ deck: r.deck, cards: r.cards }))
        .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [id]);
  return data;
}

type Recording = { solution: Action[] | null; wrong: Action[] | null };

export function DailyEditor({ start, onClose, onSaved }: { start: EditorStart | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<EditorDraft>(() => (start ? draftFromSpec(start.spec, start.note) : emptyDraft()));
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [stage, setStage] = useState<'board' | 'record'>('board');
  const [rec, setRec] = useState<Recording>({ solution: start?.solution ?? null, wrong: start?.wrong ?? null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [allowManual, setAllowManual] = useState(false);
  useEffect(() => {
    api
      .decks()
      .then(setDecks)
      .catch(() => undefined);
  }, []);
  const mine = useDeckData(draft.sides[0].deckId);
  const theirs = useDeckData(draft.sides[1].deckId);

  // Mudou a mesa (ou o que o oponente faz): a gravação deixa de valer. Dificuldade, nota e mão revelada não mexem nela.
  const change = (next: EditorDraft) => {
    if (boardKey(next) !== boardKey(draft)) setRec({ solution: null, wrong: null });
    setDraft(next);
    setSaveError(null);
    setManual(null);
  };

  const spec = specOf(draft);
  const problems = draftProblems(draft);
  const config = useMemo(() => {
    if (!mine || !theirs) return null;
    const byId = new Map([...mine.cards, ...theirs.cards].map((c) => [c.id, c]));
    return { seed: draft.seed, cards: [...byId.values()], players: [{ name: mine.deck.name, deck: mine.deck }, { name: theirs.deck.name, deck: theirs.deck }] };
  }, [mine, theirs, draft.seed]);
  const built = useMemo((): { start: GameState } | { error: string } | null => {
    if (!spec || !config || problems.length) return null;
    try {
      return { start: buildChallenge(config, { ...spec, id: 'draft' }) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [spec && JSON.stringify(spec), config, problems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!spec || !rec.solution) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = { spec, solution: rec.solution, wrong: rec.wrong, note: draft.note || undefined, ...(allowManual ? { allowManual: true } : {}) };
      if (start?.id) await api.admin.daily.update(start.id, body);
      else await api.admin.daily.save(body);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.data.errorCode === 'challengeManualCards') {
        const params = e.data.errorParams as { cards?: string } | undefined;
        setManual(params?.cards ?? '');
      }
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (stage === 'record' && built && 'start' in built && spec) {
    return (
      <Recorder
        start={built.start}
        spec={{ ...spec, id: 'draft' }}
        rec={rec}
        onRecord={(kind, actions) => setRec((r) => ({ ...r, [kind]: actions }))}
        onBack={() => setStage('board')}
        onSave={() => void save()}
        saving={saving}
        saveError={saveError}
        manual={manual}
        allowManual={allowManual}
        setAllowManual={setAllowManual}
      />
    );
  }

  const deckOptions = (
    <>
      <option value="">{t('daily.admin.chooseDeck')}</option>
      {(
        [
          ['meta', decks.filter((d) => d.meta)],
          ['builtin', decks.filter((d) => d.kind === 'builtin' && !d.meta)],
          ['mine', decks.filter((d) => d.kind === 'user' && d.mine)],
        ] as const
      ).map(([g, ds]) =>
        ds.length ? (
          <optgroup key={g} label={t(`daily.admin.group.${g}` as MessageKey)}>
            {ds.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </>
  );

  const { attackers, targets } = attackOptions(draft);
  const nameOf = (id: string) => (id === 'leader' ? null : ([...(mine?.cards ?? []), ...(theirs?.cards ?? [])].find((c) => c.id === id)?.name ?? id));

  return (
    <div className="coverage admin">
      <header className="builder-header">
        <button className="btn small" onClick={onClose}>
          {t('common.back')}
        </button>
        <h2>{start?.id ? t('daily.admin.editTitle') : start ? t('daily.admin.duplicateTitle') : t('daily.admin.new')}</h2>
      </header>
      <section className="coverage-body daily-editor">

      <fieldset className="daily-editor-general">
        <label>
          {t('daily.admin.goal')}
          <select value={draft.goal} onChange={(e) => change({ ...draft, goal: e.target.value as EditorDraft['goal'] })}>
            <option value="lethal">{t(GOAL.lethal)}</option>
            <option value="survive">{t(GOAL.survive)}</option>
          </select>
        </label>
        <label>
          {t('daily.admin.level')}
          <select value={draft.level} onChange={(e) => change({ ...draft, level: Number(e.target.value) as 1 | 2 | 3 })}>
            {([1, 2, 3] as const).map((n) => (
              <option key={n} value={n}>
                {t(LEVEL[n])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('daily.admin.turn')}
          <input type="number" min={1} max={30} value={draft.turn} onChange={(e) => change({ ...draft, turn: clamp(e.target.value, 1, 30) })} />
        </label>
        <label>
          {t('daily.admin.seed')}
          <span className="daily-editor-seed">
            <input type="number" min={0} value={draft.seed} onChange={(e) => change({ ...draft, seed: clamp(e.target.value, 0, 2 ** 31 - 1) })} />
            <button type="button" className="btn small" title={t('daily.admin.reseed')} onClick={() => change({ ...draft, seed: Math.floor(Math.random() * 1_000_000) })}>
              🎲
            </button>
          </span>
        </label>
        {draft.goal === 'lethal' && (
          <label className="check">
            <input type="checkbox" checked={draft.revealHand} onChange={(e) => change({ ...draft, revealHand: e.target.checked })} />
            {t('daily.admin.revealHand')}
          </label>
        )}
        <label className="wide">
          {t('daily.admin.intro')}
          <textarea
            rows={2}
            maxLength={400}
            value={draft.intro['pt-BR'] ?? ''}
            placeholder={t('daily.admin.introPlaceholder')}
            onChange={(e) => setDraft({ ...draft, intro: { ...draft.intro, 'pt-BR': e.target.value } })}
          />
        </label>
        <details className="wide daily-editor-intro">
          <summary>{t('daily.admin.introTranslations')}</summary>
          {LOCALES.filter((l) => l.code !== 'pt-BR').map((l) => (
            <label key={l.code}>
              {l.name}
              <textarea
                rows={2}
                maxLength={400}
                value={draft.intro[l.code] ?? ''}
                onChange={(e) => setDraft({ ...draft, intro: { ...draft.intro, [l.code]: e.target.value } })}
              />
            </label>
          ))}
        </details>
        <label className="wide">
          {t('daily.admin.note')}
          <input type="text" maxLength={500} value={draft.note} placeholder={t('daily.admin.notePlaceholder')} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>
      </fieldset>

      {draft.goal === 'lethal' && (
        <fieldset className="daily-editor-defense">
          <legend>{t('daily.admin.defense')}</legend>
          <p className="muted small">{t('daily.admin.defenseHint')}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.defense.eventCounters}
              onChange={(e) => change({ ...draft, defense: { ...draft.defense, eventCounters: e.target.checked } })}
            />
            {t('daily.admin.eventCounters')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.defense.triggers} onChange={(e) => change({ ...draft, defense: { ...draft.defense, triggers: e.target.checked } })} />
            {t('daily.admin.triggers')}
          </label>
        </fieldset>
      )}

      <div className="daily-editor-sides">
        {([0, 1] as const).map((i) => (
          <SideEditor
            key={i}
            index={i}
            draft={draft}
            data={i === 0 ? mine : theirs}
            deckOptions={deckOptions}
            onChange={change}
          />
        ))}
      </div>

      {draft.goal === 'survive' && (
        <fieldset className="daily-editor-attacks">
          <legend>{t('daily.admin.attacks')}</legend>
          <p className="muted small">{t('daily.admin.attacksHint')}</p>
          {draft.attacks.map((a, k) => (
            <div key={k} className="daily-editor-attack">
              <span>{k + 1}.</span>
              <select value={a.attacker} onChange={(e) => change({ ...draft, attacks: draft.attacks.map((x, j) => (j === k ? { ...x, attacker: e.target.value } : x)) })}>
                {attackers.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id) ?? t('daily.theirLeader')}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select value={a.target} onChange={(e) => change({ ...draft, attacks: draft.attacks.map((x, j) => (j === k ? { ...x, target: e.target.value } : x)) })}>
                {targets.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id) ?? t('daily.yourLeader')}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small" aria-label={t('daily.admin.remove')} onClick={() => change({ ...draft, attacks: draft.attacks.filter((_, j) => j !== k) })}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => change({ ...draft, attacks: [...draft.attacks, { attacker: 'leader', target: 'leader' }] })}>
            <Icon name="plus" size={14} />
            {t('daily.admin.addAttack')}
          </button>
        </fieldset>
      )}

      <div className="daily-editor-footer">
        {problems.map((p) => (
          <p key={p} className="muted small">
            {t(PROBLEM[p], { max: DON_TOTAL })}
          </p>
        ))}
        {built && 'error' in built && <p className="error">{t('daily.admin.boardError', { why: built.error })}</p>}
        <button type="button" className="btn primary" disabled={!built || !('start' in built)} onClick={() => setStage('record')}>
          <Icon name="play" size={16} />
          {t('daily.admin.toTable')}
        </button>
      </div>
      </section>
    </div>
  );
}

const clamp = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));

function SideEditor({
  index,
  draft,
  data,
  deckOptions,
  onChange,
}: {
  index: 0 | 1;
  draft: EditorDraft;
  data: DeckData | null;
  deckOptions: ReactNode;
  onChange: (d: EditorDraft) => void;
}) {
  const t = useT();
  const side = draft.sides[index];
  const [pick, setPick] = useState('');
  const [zone, setZone] = useState<Zone>('hand');
  const byId = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const name = (id: string) => byId.get(id)?.name ?? id;
  const leader = data ? byId.get(data.deck.leader) : undefined;
  const pool = (data?.deck.cards ?? []).map((c) => ({ ...c, left: c.count - usedCopies(side, c.id), card: byId.get(c.id) }));
  const add = () => {
    if (!pick) return;
    onChange(addCard(draft, index, zone, pick));
  };
  const don = donUsed(side);

  const list = (z: Exclude<Zone, 'characters' | 'stage'>) =>
    side[z].length > 0 && (
      <div className="daily-editor-zone">
        <span className="daily-editor-zone-label">{t(ZONE_LABEL[z])}</span>
        <div className="daily-editor-chips">
          {side[z].map((id, k) => (
            <span key={k} className="daily-editor-chip">
              {name(id)}
              <button type="button" aria-label={t('daily.admin.remove')} onClick={() => onChange(removeCard(draft, index, z, k))}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    );
  const fieldRow = (c: FieldDraft, z: 'characters' | 'stage', k: number) => (
    <div key={`${z}-${k}`} className="daily-editor-field">
      <strong>{name(c.id)}</strong>
      <label className="check">
        <input type="checkbox" checked={c.rested} onChange={(e) => onChange(updateField(draft, index, z, k, { rested: e.target.checked }))} />
        {t('daily.admin.rested')}
      </label>
      {z === 'characters' && (
        <label className="check">
          <input type="checkbox" checked={c.fresh} onChange={(e) => onChange(updateField(draft, index, z, k, { fresh: e.target.checked }))} />
          {t('daily.admin.fresh')}
        </label>
      )}
      <label>
        DON!!
        <input type="number" min={0} max={10} value={c.don} onChange={(e) => onChange(updateField(draft, index, z, k, { don: clamp(e.target.value, 0, 10) }))} />
      </label>
      <button type="button" className="btn small" aria-label={t('daily.admin.remove')} onClick={() => onChange(removeCard(draft, index, z, k))}>
        ×
      </button>
    </div>
  );

  return (
    <fieldset className="daily-editor-side">
      <legend>{index === 0 ? t('daily.admin.sideSolver') : t('daily.admin.sideRival')}</legend>
      <label>
        {t('daily.admin.deck')}
        <select value={side.deckId ?? ''} onChange={(e) => onChange(setDeck(draft, index, e.target.value || null))}>
          {deckOptions}
        </select>
      </label>
      {side.deckId && !data && <p className="muted small">{t('common.loading')}</p>}
      {data && (
        <>
          <div className="daily-editor-field">
            <strong>
              {t('daily.admin.leader')}: {leader?.name ?? data.deck.leader}
            </strong>
            <label className="check">
              <input type="checkbox" checked={side.leader.rested} onChange={(e) => onChange(updateSide(draft, index, { leader: { ...side.leader, rested: e.target.checked } }))} />
              {t('daily.admin.rested')}
            </label>
            <label>
              DON!!
              <input type="number" min={0} max={10} value={side.leader.don} onChange={(e) => onChange(updateSide(draft, index, { leader: { ...side.leader, don: clamp(e.target.value, 0, 10) } }))} />
            </label>
          </div>

          <div className="daily-editor-add">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('daily.admin.card')}>
              <option value="">{t('daily.admin.card')}</option>
              {pool.map((c) => (
                <option key={c.id} value={c.id} disabled={c.left <= 0}>
                  {c.card?.name ?? c.id} ({c.id}
                  {c.card?.cost !== undefined ? ` · ${c.card.cost}` : ''}) ×{c.left}
                </option>
              ))}
            </select>
            <select value={zone} onChange={(e) => setZone(e.target.value as Zone)} aria-label={t('daily.admin.zone')}>
              {ZONES.map((z) => (
                <option key={z} value={z} disabled={z === 'characters' && side.characters.length >= MAX_CHARACTERS}>
                  {t(ZONE_LABEL[z])}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" disabled={!pick || (pool.find((c) => c.id === pick)?.left ?? 0) <= 0} onClick={add}>
              <Icon name="plus" size={14} />
              {t('daily.admin.add')}
            </button>
          </div>

          {side.characters.length > 0 && (
            <div className="daily-editor-zone">
              <span className="daily-editor-zone-label">{t(ZONE_LABEL.characters)}</span>
              {side.characters.map((c, k) => fieldRow(c, 'characters', k))}
            </div>
          )}
          {side.stage && (
            <div className="daily-editor-zone">
              <span className="daily-editor-zone-label">{t(ZONE_LABEL.stage)}</span>
              {fieldRow(side.stage, 'stage', 0)}
            </div>
          )}
          {list('hand')}
          {list('life')}
          {list('deckTop')}
          {list('trash')}

          <div className="daily-editor-numbers">
            {side.life.length === 0 && (
              <label>
                {t('daily.admin.lifeCount')}
                <input type="number" min={0} max={10} value={side.lifeCount} onChange={(e) => onChange(updateSide(draft, index, { lifeCount: clamp(e.target.value, 0, 10) }))} />
              </label>
            )}
            <label>
              {t('daily.admin.donActive')}
              <input type="number" min={0} max={10} value={side.donActive} onChange={(e) => onChange(updateSide(draft, index, { donActive: clamp(e.target.value, 0, 10) }))} />
            </label>
            <label>
              {t('daily.admin.donRested')}
              <input type="number" min={0} max={10} value={side.donRested} onChange={(e) => onChange(updateSide(draft, index, { donRested: clamp(e.target.value, 0, 10) }))} />
            </label>
            <span className={don > DON_TOTAL ? 'error small' : 'muted small'}>{t('daily.admin.donTotal', { n: don, max: DON_TOTAL })}</span>
          </div>
        </>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------------------ gravar jogando

function Recorder({
  start,
  spec,
  rec,
  onRecord,
  onBack,
  onSave,
  saving,
  saveError,
  manual,
  allowManual,
  setAllowManual,
}: {
  start: GameState;
  spec: ChallengeSpec;
  rec: Recording;
  onRecord: (kind: keyof Recording, actions: Action[]) => void;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  manual: string | null;
  allowManual: boolean;
  setAllowManual: (v: boolean) => void;
}) {
  const t = useT();
  const actionsRef = useRef<Action[]>([]);
  const [run, setRun] = useState(() => runChallenge(start, spec, []));
  const [error, setError] = useState<string | null>(null);
  // No celular o painel flutua sobre a mesa: começa recolhido, numa barra só, e a mesa cabe abaixo dela (`reserve`,
  // como no desafio do dia). Abre sozinho quando há o que fazer nele: a tentativa acabou ou o salvar pede atenção.
  const [collapsed, setCollapsed] = useState(() => !window.matchMedia('(min-width: 1000px)').matches);

  // O oponente responde pelas regras do desafio: refazer do começo dá a mesma mesa que o servidor vai montar.
  const replay = useCallback(
    (actions: Action[]) => {
      const r = runChallenge(start, spec, actions);
      if (r.error) {
        setError(r.error.message);
        return false;
      }
      actionsRef.current = actions;
      setRun(r);
      setError(null);
      return true;
    },
    [start, spec],
  );
  const dispatch = useCallback(
    (a: Action) => {
      if (a.type === 'concede') return onBack();
      if (run.status !== 'playing' && actionsRef.current.length) return;
      replay([...actionsRef.current, a]);
    },
    [replay, onBack, run.status],
  );
  const status: ChallengeStatus = run.status;
  useEffect(() => {
    if (status !== 'playing' || manual !== null || saveError) setCollapsed(false);
  }, [status, manual, saveError]);
  const game: TableGame = {
    state: run.state,
    dispatch,
    error,
    setError,
    human: 0,
    paused: false,
    setPaused: noop,
    speed: 1,
    setSpeed: noop,
    auto: false,
    setAuto: noop,
    undo: () => replay(actionsRef.current.slice(0, -1)),
    canUndo: actionsRef.current.length > 0,
    actions: () => actionsRef.current,
    downloadReplay: noop,
  };
  const panel = (
    <div className={['coach', 'daily-panel', collapsed ? 'collapsed' : ''].join(' ')} role="region" aria-label={t('daily.admin.record')}>
      <div className="coach-head">
        <span className="coach-avatar" aria-hidden="true">
          <Icon name="flask" size={22} />
        </span>
        <div className="coach-head-text">
          <span className="coach-kicker">{t('daily.admin.record')}</span>
        </div>
        <button type="button" className="coach-collapse" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={t('tutorial.collapse')}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <h3 className="coach-title">{t(GOAL[spec.goal])}</h3>
      <p className="coach-body small">{t('daily.admin.recordHint')}</p>
      <div className={['coach-do', status === 'playing' ? '' : 'wait'].join(' ')}>
        <Icon name={status === 'solved' ? 'check' : status === 'failed' ? 'close' : 'play'} size={18} />
        <span>{t(`daily.admin.status.${status}` as MessageKey, { n: actionsRef.current.length })}</span>
      </div>
      <div className="btn-row">
        <button type="button" className="btn small" disabled={status !== 'solved'} onClick={() => onRecord('solution', actionsRef.current)}>
          {t('daily.admin.useSolution')}
        </button>
        <button type="button" className="btn small" disabled={status !== 'failed'} onClick={() => onRecord('wrong', actionsRef.current)}>
          {t('daily.admin.useWrong')}
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            replay([]);
            // Tentativa nova no celular: o painel volta a ser a barra, com a mesa inteira à vista.
            if (!window.matchMedia('(min-width: 1000px)').matches) setCollapsed(true);
          }}
        >
          {t('daily.retry')}
        </button>
      </div>
      <ul className="daily-editor-recorded small">
        <li>{rec.solution ? `✅ ${t('daily.admin.solutionSaved', { n: rec.solution.length })}` : `⬜ ${t('daily.admin.solutionMissing')}`}</li>
        <li>{rec.wrong ? `✅ ${t('daily.admin.wrongSaved', { n: rec.wrong.length })}` : `⬜ ${t('daily.admin.wrongMissing')}`}</li>
      </ul>
      {manual !== null && (
        <div className="coach-fail" role="alert">
          <p>{t('daily.admin.manualCards', { cards: manual })}</p>
          <label className="check">
            <input type="checkbox" checked={allowManual} onChange={(e) => setAllowManual(e.target.checked)} />
            {t('daily.admin.allowManual')}
          </label>
        </div>
      )}
      {saveError && manual === null && <p className="error small">{saveError}</p>}
      <div className="coach-actions">
        <button type="button" className="btn" onClick={onBack}>
          {t('daily.admin.backToBoard')}
        </button>
        <button type="button" className="btn primary" disabled={!rec.solution || saving || (manual !== null && !allowManual)} onClick={onSave}>
          {saving ? t('common.saving') : t('daily.admin.save')}
        </button>
      </div>
    </div>
  );
  return <LessonTable game={game} onExit={onBack} tutorial={{ coach: panel, floatAt: 'top', reserve: true, exitLabel: t('daily.admin.backToBoard') }} />;
}
