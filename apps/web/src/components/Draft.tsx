// Draft: o pod de 8. Na sala de espera, quem criou chama os amigos pelo código e começa quando
// quiser (os lugares vazios viram bots). No draft, cada um vê o booster que está na mão, fica com
// uma carta e o resto segue para o vizinho. O servidor guarda os boosters e manda só o que é de
// cada um; esta tela consulta o pod a cada segundo. No fim, as escolhas viram um deck selado e a
// montagem é a do Selado.

import { type CardData, type Color, isCube, needsManual, rushSets, SEALED_LEADER_ID } from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type DraftPod } from '../api';
import { type MessageKey, useT } from '../i18n';
import { poll } from '../poll';
import { cardText, useSettings } from '../settings';
import { BoosterOpening } from './BoosterPack';
import { CardHoverPreview, StaticCardZoom } from './CardInfo';
import { StaticCard } from './CardView';

const POLL_MS = 1000;
const COLORS: Array<{ id: Color; label: MessageKey }> = [
  { id: 'red', label: 'deck.color.red' },
  { id: 'green', label: 'deck.color.green' },
  { id: 'blue', label: 'deck.color.blue' },
  { id: 'purple', label: 'deck.color.purple' },
  { id: 'black', label: 'deck.color.black' },
  { id: 'yellow', label: 'deck.color.yellow' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Draft({ podId, onExit, onBuild }: { podId: string; onExit: () => void; onBuild: (poolId: string) => void }) {
  const t = useT();
  const { locale, animations } = useSettings();
  /** Rodada cujo booster está sendo aberto na tela (animações completas ligadas). */
  const [openingRound, setOpeningRound] = useState<number | null>(null);
  const openedRound = useRef<number | null>(null);
  const [pod, setPod] = useState<DraftPod | null>(null);
  const [cards, setCards] = useState<CardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  /** Momento em que o pod chegou do servidor: o relógio da escolha corre daqui. */
  const [at, setAt] = useState(() => Date.now());
  const [, setNow] = useState(0);
  const canHover = useMemo(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const [hovered, setHovered] = useState<{ card: CardData; anchor: HTMLElement } | null>(null);
  const [zoom, setZoom] = useState<CardData | null>(null);

  const take = useCallback((p: DraftPod) => {
    setPod(p);
    setAt(Date.now());
  }, []);
  useEffect(() => {
    api.cards().then(setCards).catch((e: unknown) => setError(errorText(e)));
  }, []);
  // Enquanto o pod espera ou drafta, consulta a cada segundo. É também o sinal de que o jogador está na tela.
  const live = !pod || pod.status !== 'done';
  useEffect(() => {
    if (!live || gone) return;
    return poll(
      () =>
        api.draft
          .pod(podId)
          .then(take)
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.status === 404) setGone(true);
            throw e;
          }),
      POLL_MS,
    );
  }, [podId, live, gone, take]);
  // O relógio anda entre uma consulta e outra.
  useEffect(() => {
    const timer = setInterval(() => setNow((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  // Booster novo na mão: a escolha anterior não vale mais.
  const packKey = pod?.pack?.join(',') ?? '';
  const lastPack = useRef(packKey);
  useEffect(() => {
    if (lastPack.current !== packKey) {
      lastPack.current = packKey;
      setChosen(null);
      setHovered(null);
    }
  }, [packKey]);

  // Booster novo e cheio na mão: é o da rodada que começou. Abre na tela uma vez por rodada.
  const freshRound = pod?.status === 'drafting' && pod.pack?.length === pod.packSize ? pod.round : null;
  useEffect(() => {
    if (freshRound === null || openedRound.current === freshRound) return;
    openedRound.current = freshRound;
    if (animations === 'full' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setOpeningRound(freshRound);
  }, [freshRound, animations]);

  const byId = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);
  const act = async (fn: () => Promise<DraftPod | void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) take(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (card: string) => act(() => api.draft.pick(podId, card));
  const leave = () => {
    if (pod?.status === 'drafting' && !window.confirm(t('draft.leaveConfirm'))) return;
    void api.draft.leave(podId).catch(() => undefined);
    onExit();
  };

  const header = (
    <header className="builder-header">
      <button className="btn small" onClick={pod?.status === 'done' ? onExit : leave}>
        {pod?.status === 'done' ? t('common.back') : t('draft.leave')}
      </button>
      <h2>{!pod ? t('draft.titlePlain') : isCube(pod.sets) ? t('sealed.cubeName') : t('draft.title', { sets: rushSets(pod.sets).join(' + ') })}</h2>
    </header>
  );

  if (gone) {
    return (
      <div className="sealed">
        {header}
        <div className="sealed-wrap">
          <p className="sealed-empty">{t('draft.gone')}</p>
          <div className="sealed-actions">
            <button type="button" className="btn" onClick={onExit}>
              {t('common.back')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!pod || !cards) {
    return (
      <div className="sealed">
        {header}
        <div className="sealed-wrap">{error ? <div className="error">{error}</div> : <p className="muted">{t('common.loading')}</p>}</div>
      </div>
    );
  }

  const me = pod.seats[pod.you];
  const picks = pod.picks.flat();
  const total = pod.rounds * pod.packSize;
  const strip = (
    <div className="draft-pod" role="list" aria-label={t('draft.podLabel')}>
      {Array.from({ length: pod.capacity }, (_, i) => {
        const s = pod.seats[i];
        const state = !s
          ? t('draft.seatEmpty')
          : pod.status === 'waiting'
            ? s.bot
              ? t('draft.seatBot')
              : t('draft.seatReady')
            : s.away
              ? t('draft.seatAway')
              : s.choosing
                ? t('draft.seatChoosing')
                : t('draft.seatWaiting');
        return (
          <div key={i} role="listitem" className={['draft-seat', s?.you ? 'me' : '', !s ? 'empty' : '', s && pod.status === 'drafting' && !s.choosing ? 'done' : ''].join(' ')}>
            <span className="draft-avatar">{s ? (s.bot ? '🤖' : s.name.slice(0, 1).toUpperCase()) : '+'}</span>
            <b>{s ? (s.you ? t('draft.you') : s.name) : '—'}</b>
            <small>{state}</small>
          </div>
        );
      })}
    </div>
  );

  // ------------------------------------------------------------ sala de espera
  if (pod.status === 'waiting') {
    const humans = pod.seats.length;
    return (
      <div className="sealed">
        {header}
        <div className="sealed-wrap">
          <section className="sealed-hero">
            <div className="hero-kicker">{t('draft.kicker')}</div>
            <h1 className="hero-title">{t('draft.waitingTitle')}</h1>
            <p className="hero-sub">{t('draft.waitingIntro', { seats: pod.capacity, rounds: pod.rounds, size: pod.packSize, total })}</p>
          </section>
          {error && <div className="error">{error}</div>}
          <section className="sealed-panel">
            <div className="section-head">
              <h3 className="sealed-h3">{t('draft.seats', { n: humans, max: pod.capacity })}</h3>
              <span className="draft-code">
                <small className="kicker">{t('draft.code')}</small>
                <b>{pod.code}</b>
              </span>
            </div>
            {strip}
            <p className="muted small">{t('draft.codeHint')}</p>
            <div className="sealed-open-row">
              {pod.host ? (
                <button type="button" className="mode-btn sealed-cta" onClick={() => void act(() => api.draft.start(podId))} disabled={busy}>
                  {humans < pod.capacity ? t('draft.startWithBots', { n: pod.capacity - humans }) : t('draft.start')}
                </button>
              ) : (
                <span className="muted">{t('draft.waitingHost', { name: pod.seats[0]?.name ?? '' })}</span>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ fim
  if (pod.status === 'done') {
    return (
      <div className="sealed">
        {header}
        <div className="sealed-wrap">
          <section className="sealed-hero">
            <div className="hero-kicker">{t('draft.kicker')}</div>
            <h1 className="hero-title">{t('draft.doneTitle')}</h1>
            <p className="hero-sub">{t('draft.doneIntro', { n: picks.length })}</p>
          </section>
          <section className="sealed-panel">
            <PickList picks={picks} byId={byId} onHover={(c, a) => setHovered(c && a ? { card: c, anchor: a } : null)} onZoom={setZoom} />
            <div className="sealed-open-row">
              <button type="button" className="mode-btn sealed-cta" onClick={() => pod.poolId && onBuild(pod.poolId)} disabled={!pod.poolId}>
                {t('sealed.toBuild')}
              </button>
            </div>
          </section>
        </div>
        {canHover && hovered && !zoom && <CardHoverPreview card={hovered.card} anchor={hovered.anchor} />}
        {zoom && <StaticCardZoom card={zoom} onClose={() => setZoom(null)} />}
      </div>
    );
  }

  // ------------------------------------------------------------ escolhendo
  const left = pod.timeLeft === null ? null : pod.timeLeft - (Date.now() - at);
  const picked = byId.get(chosen ?? '');
  const pickedText = picked ? cardText(picked, locale) : null;
  const leaders = picks.filter((id) => byId.get(id)?.category === 'leader');
  const colorCount = COLORS.map((c) => ({ ...c, n: picks.filter((id) => byId.get(id)?.category !== 'leader' && byId.get(id)?.colors.includes(c.id)).length }));
  const colorTotal = colorCount.reduce((n, c) => n + c.n, 0) || 1;
  return (
    <div className="sealed">
      {header}
      <div className="sealed-wrap draft-wrap">
        <div className="draft-status">
          <span className="home-chip">{t('draft.round', { n: pod.round, total: pod.rounds })}</span>
          <span className="home-chip">{t('draft.pick', { n: Math.min(pod.packSize, me.picked + 1), total: pod.packSize })}</span>
          {pod.packSet && rushSets(pod.sets).length > 1 && <span className="home-chip gold">{pod.packSet}</span>}
          <span className="sealed-spacer" />
          {left !== null && (
            <span className={['draft-timer', left < 10_000 ? 'low' : ''].join(' ')} aria-live="off" title={t('draft.timerTitle')}>
              {clock(left)}
            </span>
          )}
        </div>
        {strip}
        {error && <div className="error">{error}</div>}

        <div className="sealed-packs draft-grid">
          <section className="sealed-panel sealed-reveal">
            {pod.pack ? (
              <>
                <div className="section-head">
                  <h3 className="sealed-h3">{t('draft.choose')}</h3>
                  <span className="muted small">{t('draft.passHint', { n: pod.pack.length - 1, name: pod.passTo ?? '' })}</span>
                </div>
                <div className="card-grid sealed-grid draft-pack">
                  {pod.pack.map((id, i) => {
                    const card = byId.get(id);
                    if (!card) return null;
                    return (
                      <div key={`${id}-${i}`} className="grid-cell">
                        <StaticCard
                          card={card}
                          highlight={chosen === id ? 'selected' : null}
                          onClick={() => (chosen === id ? void pick(id) : setChosen(id))}
                          onHover={(c, a) => setHovered(c && a ? { card: c, anchor: a } : null)}
                          onLongPress={setZoom}
                          badge={
                            needsManual(card) ? (
                              <span className="manual-badge" title={t('deck.manualTitle')}>
                                ⚙
                              </span>
                            ) : undefined
                          }
                        />
                        <div className="grid-caption">{card.category === 'leader' ? t('deck.cat.leader') : (card.rarity ?? '')}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="draft-confirm">
                  <div className="draft-picked">
                    {picked ? (
                      <>
                        <b>{picked.name}</b>
                        {pickedText?.text && <span className="muted small">{pickedText.text}</span>}
                        {pickedText?.trigger && <span className="muted small">[Trigger] {pickedText.trigger}</span>}
                        {!pickedText?.text && !pickedText?.trigger && <span className="muted small">{t('draft.noText')}</span>}
                      </>
                    ) : (
                      <span className="muted">{canHover ? t('draft.pickHintMouse') : t('draft.pickHintTouch')}</span>
                    )}
                  </div>
                  <button type="button" className="mode-btn sealed-cta" onClick={() => chosen && void pick(chosen)} disabled={!chosen || busy}>
                    {picked ? t('draft.take', { name: picked.name }) : t('draft.takeNone')}
                  </button>
                </div>
              </>
            ) : (
              <p className="sealed-empty">{t('draft.waitingPack')}</p>
            )}
          </section>

          <aside className="sealed-side sealed-panel">
            <div>
              <div className="kicker">{t('draft.yourLeaders')}</div>
              <div className="sealed-leaders">
                {[...new Set(leaders), SEALED_LEADER_ID].map((id) => {
                  const card = byId.get(id);
                  return card ? (
                    <div key={id} className="grid-cell">
                      <StaticCard card={card} onHover={(c, a) => setHovered(c && a ? { card: c, anchor: a } : null)} onLongPress={setZoom} onClick={() => setZoom(card)} />
                      {id === SEALED_LEADER_ID && <div className="grid-caption">{t('sealed.always')}</div>}
                    </div>
                  ) : null;
                })}
              </div>
              <p className="muted small">{rushSets(pod.sets).length > 1 || isCube(pod.sets) ? t('draft.leaderHintAny') : t('draft.leaderHint')}</p>
            </div>
            <div>
              <div className="kicker">{t('draft.colors')}</div>
              <div className="draft-colors" aria-hidden="true">
                {colorCount.map((c) => (c.n ? <i key={c.id} className={`c-${c.id}`} style={{ width: `${(c.n / colorTotal) * 100}%` }} title={`${t(c.label)}: ${c.n}`} /> : null))}
              </div>
            </div>
          </aside>
        </div>

        <section className="sealed-panel">
          <div className="section-head">
            <h3 className="sealed-h3">{t('draft.yourPicks')}</h3>
            <span className="muted small">{t('draft.picksCount', { n: picks.length, total })}</span>
          </div>
          {picks.length ? <PickList picks={picks} byId={byId} onHover={(c, a) => setHovered(c && a ? { card: c, anchor: a } : null)} onZoom={setZoom} /> : <p className="muted small">{t('draft.noPicks')}</p>}
        </section>
      </div>
      {canHover && hovered && !zoom && <CardHoverPreview card={hovered.card} anchor={hovered.anchor} />}
      {zoom && <StaticCardZoom card={zoom} onClose={() => setZoom(null)} />}
      {openingRound !== null && (
        <BoosterOpening key={openingRound} set={pod.packSet ?? pod.sets} label={t('draft.round', { n: openingRound, total: pod.rounds })} fast onDone={() => setOpeningRound(null)} />
      )}
    </div>
  );
}

/** As cartas já escolhidas, pela cor e pelo custo. */
function PickList({
  picks,
  byId,
  onHover,
  onZoom,
}: {
  picks: string[];
  byId: ReadonlyMap<string, CardData>;
  onHover: (card: CardData | null, anchor?: HTMLElement) => void;
  onZoom: (card: CardData) => void;
}) {
  const order = (c: CardData) => (c.category === 'leader' ? -1 : COLORS.findIndex((x) => x.id === c.colors[0]));
  const sorted = picks
    .map((id) => byId.get(id))
    .filter((c): c is CardData => Boolean(c))
    .sort((a, b) => order(a) - order(b) || (a.cost ?? 0) - (b.cost ?? 0) || a.id.localeCompare(b.id));
  return (
    <div className="card-grid draft-picks">
      {sorted.map((c, i) => (
        <div key={`${c.id}-${i}`} className="grid-cell">
          <StaticCard card={c} onHover={onHover} onLongPress={onZoom} onClick={() => onZoom(c)} />
        </div>
      ))}
    </div>
  );
}
