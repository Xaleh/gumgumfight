// Sandbox de regras: editor de uma mesa livre (Líder, mão, Personagens, Stage, Vida, lixo, topo
// do deck e DON!! de cada lado). "Jogar" abre a mesa com a mesma pessoa jogando os dois lados
// (modo `sandbox` do useGame); "Copiar link" leva a situação inteira no endereço.
// As regras (montagem, limites, leitura do link) ficam no motor (`packages/engine/src/sandbox.ts`).

import {
  type CardData,
  type PlayerId,
  SANDBOX_LIMITS,
  type ScenarioCard,
  type SandboxIssue,
  type SandboxSide,
  type SandboxSpec,
  sandboxConfig,
  sandboxIssues,
} from '@gumgum/engine';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { matchesCardQuery, parseCardQuery } from '../cardSearch';
import { sandboxUrl } from '../game/sandboxLink';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useT } from '../i18n';
import { useSearchAliases } from './CardFilterBar';
import { StaticCard } from './CardView';
import { Icon } from './Icons';

/** Última mesa montada neste navegador (conveniência: reabrir o editor como estava). */
const STORAGE_KEY = 'gumgum.sandbox';

type ListZone = 'hand' | 'trash' | 'deckTop';
type Zone = 'leader' | 'characters' | 'stage' | ListZone;

/** Personagem ou Stage no editor (sempre na forma completa; o link guarda a compacta). */
type FieldCard = ScenarioCard;

/** A mesa no editor: Personagens e Stage na forma completa, Vida em número. */
interface EditorSide extends Omit<SandboxSide, 'characters' | 'stage' | 'life'> {
  characters: FieldCard[];
  stage: FieldCard | null;
  life: number;
}
interface EditorSpec {
  turn: number;
  active: PlayerId;
  sides: [EditorSide, EditorSide];
}

const MAX_RESULTS = 60;

function toEditor(spec: SandboxSpec, byId: Map<string, CardData>): EditorSpec {
  const side = (s: SandboxSide): EditorSide => ({
    ...s,
    characters: (s.characters ?? []).map((c) => (typeof c === 'string' ? { id: c } : { ...c })),
    stage: s.stage ? (typeof s.stage === 'string' ? { id: s.stage } : { ...s.stage }) : null,
    // Vida com as cartas exatas (só pelo link): o editor guarda só a quantidade.
    life: Array.isArray(s.life) ? s.life.length : (s.life ?? byId.get(s.leader.id)?.life ?? 5),
  });
  return { turn: spec.turn, active: spec.active, sides: [side(spec.sides[0]), side(spec.sides[1])] };
}

function toSpec(e: EditorSpec): SandboxSpec {
  const side = ({ characters, stage, life, ...rest }: EditorSide): SandboxSide => ({
    ...rest,
    characters,
    ...(stage ? { stage } : {}),
    life,
  });
  return { turn: e.turn, active: e.active, sides: [side(e.sides[0]), side(e.sides[1])] };
}

/** Mesa inicial: Luffy (ST01) contra Crocodile (ST03), ou os dois primeiros Líderes da base. */
function defaultSpec(cards: readonly CardData[]): SandboxSpec {
  const leaders = cards.filter((c) => c.category === 'leader');
  const pick = (id: string, i: number) => (leaders.some((c) => c.id === id) ? id : (leaders[i]?.id ?? id));
  return {
    turn: 3,
    active: 0,
    sides: [
      { leader: { id: pick('ST01-001', 0) }, donActive: 3 },
      { leader: { id: pick('ST03-001', 1) }, donActive: 2 },
    ],
  };
}

function storedSpec(): SandboxSpec | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SandboxSpec) : null;
  } catch {
    return null;
  }
}

export function Sandbox({
  initial,
  linkInvalid,
  onExit,
  onPlay,
}: {
  /** Mesa vinda do link ou da partida que voltou para o editor. */
  initial?: SandboxSpec;
  linkInvalid?: boolean;
  onExit: () => void;
  onPlay: (setup: GameSetup, spec: SandboxSpec) => void;
}) {
  const t = useT();
  const [cards, setCards] = useState<CardData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [edit, setEdit] = useState<EditorSpec | null>(null);
  const [picking, setPicking] = useState<{ side: PlayerId; zone: Zone } | null>(null);
  const [notice, setNotice] = useState<string | null>(linkInvalid ? t('sandbox.linkInvalid') : null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    api
      .cards()
      .then((list) => alive && setCards(list))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);

  // Monta o editor quando as cartas chegam: a mesa do link, a última montada ou a inicial.
  useEffect(() => {
    if (!cards || edit) return;
    setEdit(toEditor(initial ?? storedSpec() ?? defaultSpec(cards), byId));
  }, [cards, edit, initial, byId]);

  const spec = useMemo(() => (edit ? toSpec(edit) : null), [edit]);
  useEffect(() => {
    if (!spec) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(spec));
    } catch {
      /* sem armazenamento */
    }
  }, [spec]);
  const issues = useMemo(() => (spec && cards ? sandboxIssues(spec, cards) : []), [spec, cards]);

  const sideName = (p: PlayerId) => (p === 0 ? t('sandbox.sideA') : t('sandbox.sideB'));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const issueText = (i: SandboxIssue) =>
    t(`sandbox.issue.${i.code}` as MessageKey, {
      side: i.side !== undefined ? sideName(i.side) : '',
      card: i.card ? `${nameOf(i.card)} (${i.card})` : '',
      max: i.max,
    });

  if (!cards || !edit || !spec) {
    return (
      <div className="sandbox">
        <SandboxHeader onExit={onExit} />
        <div className="sandbox-wrap">
          {loadError ? (
            <div className="sandbox-status">
              <p>{t('sandbox.loadFailed', { why: loadError })}</p>
              <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                {t('sandbox.retry')}
              </button>
            </div>
          ) : (
            <p className="sandbox-status muted">{t('sandbox.loading')}</p>
          )}
        </div>
      </div>
    );
  }

  const updateSide = (p: PlayerId, f: (s: EditorSide) => EditorSide) =>
    setEdit((e) => (e ? { ...e, sides: (p === 0 ? [f(e.sides[0]), e.sides[1]] : [e.sides[0], f(e.sides[1])]) as [EditorSide, EditorSide] } : e));

  const add = (p: PlayerId, zone: Zone, id: string) => {
    updateSide(p, (s) => {
      if (zone === 'leader') {
        // Trocar o Líder leva a Vida para a impressa no novo Líder.
        return { ...s, leader: { ...s.leader, id }, life: byId.get(id)?.life ?? s.life };
      }
      if (zone === 'characters') return s.characters.length >= SANDBOX_LIMITS.characters ? s : { ...s, characters: [...s.characters, { id }] };
      if (zone === 'stage') return { ...s, stage: { id } };
      const list = s[zone] ?? [];
      return list.length >= SANDBOX_LIMITS.zone ? s : { ...s, [zone]: [...list, id] };
    });
    // Líder e Stage: uma carta só, o seletor fecha.
    if (zone === 'leader' || zone === 'stage' || (zone === 'characters' && edit.sides[p].characters.length + 1 >= SANDBOX_LIMITS.characters)) setPicking(null);
  };

  const play = () => {
    if (issues.length) return;
    const names: [string, string] = [sideName(0), sideName(1)];
    const config = sandboxConfig(spec, cards, names, Math.floor(Math.random() * 1_000_000));
    onPlay({ mode: 'sandbox', config, deckIds: ['sandbox', 'sandbox'], format: 'free', sandbox: spec, notice: t('sandbox.notice') }, spec);
  };

  const share = async () => {
    const url = sandboxUrl(spec, location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t('sandbox.linkCopied'));
    } catch {
      window.prompt(t('sandbox.copyPrompt'), url);
    }
  };

  const clear = () => {
    if (!window.confirm(t('sandbox.clearConfirm'))) return;
    setEdit(toEditor(defaultSpec(cards), byId));
    setNotice(null);
  };

  return (
    <div className="sandbox">
      <SandboxHeader onExit={onExit} />
      <div className="sandbox-wrap">
        <section className="sandbox-intro">
          <div className="hero-kicker">{t('sandbox.kicker')}</div>
          <p>{t('sandbox.intro')}</p>
        </section>
        {notice && (
          <p className="sandbox-notice" role="status">
            {notice}
          </p>
        )}

        <section className="sandbox-global">
          <label className="sandbox-field">
            <span>{t('sandbox.turn')}</span>
            <Stepper value={edit.turn} min={1} max={SANDBOX_LIMITS.turn} onChange={(turn) => setEdit({ ...edit, turn })} label={t('sandbox.turn')} />
          </label>
          <div className="sandbox-field">
            <span>{t('sandbox.activeSide')}</span>
            <div className="seg small">
              {([0, 1] as PlayerId[]).map((p) => (
                <button key={p} className={edit.active === p ? 'on' : ''} onClick={() => setEdit({ ...edit, active: p })}>
                  {sideName(p)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {([1, 0] as PlayerId[]).map((p) => (
          <SideEditor
            key={p}
            title={sideName(p)}
            active={edit.active === p}
            side={edit.sides[p]}
            byId={byId}
            onChange={(f) => updateSide(p, f)}
            onPick={(zone) => setPicking({ side: p, zone })}
          />
        ))}

        {issues.length > 0 && (
          <ul className="sandbox-issues" role="alert">
            {issues.map((i, n) => (
              <li key={n}>{issueText(i)}</li>
            ))}
          </ul>
        )}

        <div className="sandbox-actions">
          <button className="btn primary big" onClick={play} disabled={issues.length > 0}>
            <Icon name="play" size={18} /> {t('sandbox.play')}
          </button>
          <button className="btn" onClick={() => void share()}>
            <Icon name="share" size={16} /> {t('sandbox.copyLink')}
          </button>
          <button className="btn" onClick={clear}>
            <Icon name="trash" size={16} /> {t('sandbox.clear')}
          </button>
        </div>
      </div>

      {picking && (
        <CardPicker
          cards={cards}
          zone={picking.zone}
          title={t('sandbox.pickTitle', { side: sideName(picking.side), zone: zoneLabel(t, picking.zone) })}
          onPick={(id) => add(picking.side, picking.zone, id)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function SandboxHeader({ onExit }: { onExit: () => void }) {
  const t = useT();
  return (
    <header className="builder-header">
      <button className="btn small" onClick={onExit}>
        {t('common.back')}
      </button>
      <h2>{t('sandbox.title')}</h2>
    </header>
  );
}

function zoneLabel(t: ReturnType<typeof useT>, zone: Zone): string {
  switch (zone) {
    case 'leader':
      return t('board.area.leader');
    case 'characters':
      return t('board.area.character');
    case 'stage':
      return t('board.area.stage');
    case 'hand':
      return t('sandbox.hand');
    case 'trash':
      return t('board.area.trash');
    case 'deckTop':
      return t('sandbox.deckTop');
  }
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="sandbox-stepper" role="group" aria-label={label}>
      <button type="button" className="btn small" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label} −1`}>
        −
      </button>
      <span className="sandbox-stepper-value">{value}</span>
      <button type="button" className="btn small" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label} +1`}>
        +
      </button>
    </span>
  );
}

function SideEditor({
  title,
  active,
  side,
  byId,
  onChange,
  onPick,
}: {
  title: string;
  active: boolean;
  side: EditorSide;
  byId: Map<string, CardData>;
  onChange: (f: (s: EditorSide) => EditorSide) => void;
  onPick: (zone: Zone) => void;
}) {
  const t = useT();
  const leader = byId.get(side.leader.id);
  const setField = (i: number, patch: Partial<FieldCard>) =>
    onChange((s) => ({ ...s, characters: s.characters.map((c, n) => (n === i ? { ...c, ...patch } : c)) }));
  const list = (zone: ListZone, hint?: string) => {
    const ids = side[zone] ?? [];
    return (
      <div className="sandbox-zone">
        <div className="sandbox-zone-head">
          <h4>
            {zoneLabel(t, zone)} <span className="muted">({ids.length})</span>
          </h4>
          <button className="btn small" onClick={() => onPick(zone)} disabled={ids.length >= SANDBOX_LIMITS.zone}>
            <Icon name="plus" size={14} /> {t('sandbox.add')}
          </button>
        </div>
        {hint && <p className="muted small">{hint}</p>}
        {ids.length === 0 ? (
          <p className="muted small">{t('sandbox.empty')}</p>
        ) : (
          <div className="sandbox-row">
            {ids.map((id, i) => (
              <MiniCard key={`${id}-${i}`} card={byId.get(id)} id={id} onRemove={() => onChange((s) => ({ ...s, [zone]: (s[zone] ?? []).filter((_, n) => n !== i) }))} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={['sandbox-side', active ? 'active' : ''].join(' ')}>
      <h3>
        {title}
        {active && <span className="sandbox-turn-tag">{t('sandbox.yourTurnTag')}</span>}
      </h3>

      <div className="sandbox-top">
        <div className="sandbox-zone">
          <div className="sandbox-zone-head">
            <h4>{t('board.area.leader')}</h4>
            <button className="btn small" onClick={() => onPick('leader')}>
              {t('sandbox.change')}
            </button>
          </div>
          <div className="sandbox-row">
            <MiniCard card={leader} id={side.leader.id} rested={side.leader.rested}>
              <label className="check">
                <input type="checkbox" checked={Boolean(side.leader.rested)} onChange={(e) => onChange((s) => ({ ...s, leader: { ...s.leader, rested: e.target.checked } }))} />
                {t('sandbox.rested')}
              </label>
              <span className="sandbox-mini-field">
                {t('sandbox.donOnCard')}
                <Stepper
                  value={side.leader.don ?? 0}
                  min={0}
                  max={SANDBOX_LIMITS.donOnCard}
                  label={t('sandbox.donOnCard')}
                  onChange={(don) => onChange((s) => ({ ...s, leader: { ...s.leader, don } }))}
                />
              </span>
            </MiniCard>
          </div>
        </div>

        <div className="sandbox-zone sandbox-counts">
          <label className="sandbox-field">
            <span>{t('board.area.life')}</span>
            <Stepper value={side.life} min={0} max={SANDBOX_LIMITS.life} label={t('board.area.life')} onChange={(life) => onChange((s) => ({ ...s, life }))} />
          </label>
          <label className="sandbox-field">
            <span>{t('sandbox.donActive')}</span>
            <Stepper value={side.donActive ?? 0} min={0} max={10} label={t('sandbox.donActive')} onChange={(n) => onChange((s) => ({ ...s, donActive: n }))} />
          </label>
          <label className="sandbox-field">
            <span>{t('sandbox.donRested')}</span>
            <Stepper value={side.donRested ?? 0} min={0} max={10} label={t('sandbox.donRested')} onChange={(n) => onChange((s) => ({ ...s, donRested: n }))} />
          </label>
        </div>
      </div>

      <div className="sandbox-zone">
        <div className="sandbox-zone-head">
          <h4>
            {t('board.area.character')}{' '}
            <span className="muted">
              ({side.characters.length}/{SANDBOX_LIMITS.characters})
            </span>
          </h4>
          <button className="btn small" onClick={() => onPick('characters')} disabled={side.characters.length >= SANDBOX_LIMITS.characters}>
            <Icon name="plus" size={14} /> {t('sandbox.add')}
          </button>
        </div>
        {side.characters.length === 0 ? (
          <p className="muted small">{t('sandbox.empty')}</p>
        ) : (
          <div className="sandbox-row">
            {side.characters.map((c, i) => (
              <MiniCard
                key={`${c.id}-${i}`}
                card={byId.get(c.id)}
                id={c.id}
                rested={c.rested}
                onRemove={() => onChange((s) => ({ ...s, characters: s.characters.filter((_, n) => n !== i) }))}
              >
                <label className="check">
                  <input type="checkbox" checked={Boolean(c.rested)} onChange={(e) => setField(i, { rested: e.target.checked })} />
                  {t('sandbox.rested')}
                </label>
                <label className="check" title={t('sandbox.freshHint')}>
                  <input type="checkbox" checked={Boolean(c.fresh)} onChange={(e) => setField(i, { fresh: e.target.checked })} />
                  {t('sandbox.fresh')}
                </label>
                <span className="sandbox-mini-field">
                  {t('sandbox.donOnCard')}
                  <Stepper value={c.don ?? 0} min={0} max={SANDBOX_LIMITS.donOnCard} label={t('sandbox.donOnCard')} onChange={(don) => setField(i, { don })} />
                </span>
              </MiniCard>
            ))}
          </div>
        )}
      </div>

      <div className="sandbox-zone">
        <div className="sandbox-zone-head">
          <h4>{t('board.area.stage')}</h4>
          <button className="btn small" onClick={() => onPick('stage')}>
            {side.stage ? t('sandbox.change') : (
              <>
                <Icon name="plus" size={14} /> {t('sandbox.add')}
              </>
            )}
          </button>
        </div>
        {side.stage ? (
          <div className="sandbox-row">
            <MiniCard card={byId.get(side.stage.id)} id={side.stage.id} rested={side.stage.rested} onRemove={() => onChange((s) => ({ ...s, stage: null }))}>
              <label className="check">
                <input type="checkbox" checked={Boolean(side.stage.rested)} onChange={(e) => onChange((s) => (s.stage ? { ...s, stage: { ...s.stage, rested: e.target.checked } } : s))} />
                {t('sandbox.rested')}
              </label>
            </MiniCard>
          </div>
        ) : (
          <p className="muted small">{t('sandbox.empty')}</p>
        )}
      </div>

      {list('hand')}
      {list('trash')}
      {list('deckTop', t('sandbox.deckTopHint'))}
    </section>
  );
}

function MiniCard({
  card,
  id,
  rested,
  onRemove,
  children,
}: {
  card: CardData | undefined;
  id: string;
  rested?: boolean;
  onRemove?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className={['sandbox-mini', rested ? 'rested' : ''].join(' ')}>
      <div className="sandbox-mini-card">
        {card ? <StaticCard card={card} /> : <div className="card back sandbox-missing">{id}</div>}
        {onRemove && (
          <button className="sandbox-remove" onClick={onRemove} aria-label={t('sandbox.remove')} title={t('sandbox.remove')}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      <div className="sandbox-mini-name" title={card?.name ?? id}>
        {card?.name ?? id}
      </div>
      {children && <div className="sandbox-mini-controls">{children}</div>}
    </div>
  );
}

function CardPicker({
  cards,
  zone,
  title,
  onPick,
  onClose,
}: {
  cards: CardData[];
  zone: Zone;
  title: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const aliases = useSearchAliases();
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const pool = useMemo(
    () =>
      cards
        .filter((c) =>
          zone === 'leader' ? c.category === 'leader' : zone === 'characters' ? c.category === 'character' : zone === 'stage' ? c.category === 'stage' : c.category !== 'leader',
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
    [cards, zone],
  );
  const found = useMemo(() => {
    const q = parseCardQuery(query, aliases);
    return query.trim() ? pool.filter((c) => matchesCardQuery(c, q)) : pool;
  }, [pool, query, aliases]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop page-sheet" onClick={onClose}>
      <div className="modal-card sandbox-picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sandbox-picker-head">
          <h3>{title}</h3>
          <button className="btn small" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <input className="sandbox-search" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('sandbox.pickSearch')} aria-label={t('sandbox.pickSearch')} />
        {added && (
          <p className="muted small" role="status">
            {t('sandbox.added', { name: added })}
          </p>
        )}
        <div className="sandbox-picker-grid">
          {found.slice(0, MAX_RESULTS).map((c) => (
            <button
              key={c.id}
              className="sandbox-pick"
              onClick={() => {
                setAdded(c.name);
                onPick(c.id);
              }}
              title={`${c.name} (${c.id})`}
            >
              <StaticCard card={c} />
              <span className="sandbox-pick-id">{c.id}</span>
            </button>
          ))}
        </div>
        {found.length === 0 && <p className="muted">{t('sandbox.pickNone')}</p>}
        {found.length > MAX_RESULTS && <p className="muted small">{t('sandbox.pickMore', { n: MAX_RESULTS, total: found.length })}</p>}
      </div>
    </div>
  );
}
