// Animações da mesa: as cartas voam de uma zona para outra a cada jogada.
//
// Funciona comparando dois estados seguidos da partida, sem depender da ação que
// os separou (assim vale igual para o bot, o replay e o online, onde só chega a
// visão do jogador). A cada estado novo:
//
// 1. Antes de o React trocar a mesa, mede onde cada carta estava (renderização).
// 2. Depois da troca, descobre quais cartas mudaram de zona. Cartas que o jogador
//    não vê (deck, mão do oponente online) não têm identidade: a diferença de
//    contagem entre as zonas diz de onde para onde elas foram.
// 3. Esconde a carta no destino e desenha uma cópia voando da origem até lá.
//    Jogar uma carta passa pelo centro da mesa (vitrine), como no oplaytcg.
//
// Também anima os DON!! (deck de DON!! → área de custo → cartas) e o impacto do
// dano no Líder. O tempo total fica em `holdMotion` para o bot esperar.

import { cardDef, type GameState, HIDDEN_CARD, type PlayerId } from '@gumgum/engine';
import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { holdMotion } from '../game/motion';
import { CardBack, CardView } from './CardView';

type Zone = 'deck' | 'hand' | 'life' | 'trash' | 'field';
interface Spot {
  player: PlayerId;
  zone: Zone;
}
/** Centro na tela e tamanho visível (sem a rotação) de uma carta. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Deitada (Vida, carta virada). */
  rot?: boolean;
  /** Mostra a frente da carta. */
  face?: boolean;
}
type Boxes = Map<string, Box>;

interface CardFlight {
  id: number;
  kind: 'card';
  state: GameState;
  uid: string | null;
  from: Box;
  to: Box;
  /** reveal: verso → frente; hide: frente → verso; back: só o verso; none: só a frente. */
  flip: 'none' | 'reveal' | 'hide' | 'back';
  /** Passa pelo centro da mesa, grande, antes de ir ao destino. */
  showcase?: Box;
  ko?: boolean;
  delay: number;
  duration: number;
  hide: Element | null;
}
interface DonFlight {
  id: number;
  kind: 'don';
  from: Box;
  to: Box;
  /** Vai para uma carta: some ao chegar (os anexados aparecem embaixo dela). */
  fade: boolean;
  delay: number;
  duration: number;
  hide: Element | null;
}
interface Burst {
  id: number;
  kind: 'burst';
  at: Box;
  tone: 'ko' | 'land' | 'hit';
  delay: number;
  duration: number;
}
type Item = CardFlight | DonFlight | Burst;

/** De onde para onde as cartas sem identidade costumam ir, em ordem de preferência. */
const PAIRS: [Zone, Zone][] = [
  ['deck', 'hand'],
  ['deck', 'life'],
  ['life', 'hand'],
  ['hand', 'field'],
  ['hand', 'trash'],
  ['field', 'trash'],
  ['life', 'trash'],
  ['deck', 'trash'],
  ['hand', 'deck'],
  ['field', 'hand'],
  ['field', 'deck'],
  ['deck', 'field'],
  ['trash', 'hand'],
  ['trash', 'field'],
  ['life', 'field'],
  ['hand', 'life'],
  ['field', 'life'],
  ['trash', 'deck'],
  ['deck', 'deck'],
];

/** Uma troca maior que isso (desfazer, ferramentas manuais) aparece sem animação. */
const MAX_MOVES = 16;
const MAX_DON = 12;

function spots(state: GameState): Map<string, Spot> {
  const m = new Map<string, Spot>();
  for (const ps of state.players) {
    const put = (uids: string[], zone: Zone) => {
      for (const u of uids) m.set(u, { player: ps.id, zone });
    };
    put(ps.deck, 'deck');
    put(ps.hand, 'hand');
    put(ps.life, 'life');
    put(ps.trash, 'trash');
    put(
      ps.characters.map((c) => c.uid),
      'field',
    );
    if (ps.stage) put([ps.stage.uid], 'field');
  }
  return m;
}

// ------------------------------------------------------------------ medidas

function measure(el: Element, size?: HTMLElement | null): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const s = size ?? (el as HTMLElement);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: s.offsetWidth || r.width, h: s.offsetHeight || r.height };
}

function capture(root: Element | null): Boxes {
  const m: Boxes = new Map();
  if (!root) return m;
  root.querySelectorAll<HTMLElement>('.field-card [data-uid]').forEach((el) => {
    const b = measure(el);
    if (!b) return;
    const rested = el.classList.contains('rested');
    // Carta virada: rotate(90deg) scale(0.72) no CSS.
    m.set(`field:${el.dataset.uid}`, {
      ...b,
      ...(rested ? { w: b.w * 0.72, h: b.h * 0.72, rot: true } : {}),
      face: !el.classList.contains('back'),
    });
  });
  root.querySelectorAll<HTMLElement>('.pile [data-uid]').forEach((el) => {
    const b = measure(el);
    if (b) m.set(`trash:${el.dataset.uid}`, { ...b, face: true });
  });
  root.querySelectorAll<HTMLElement>('[data-hand-uid]').forEach((el) => {
    const b = measure(el);
    if (b) m.set(`hand:${el.dataset.handUid}`, { ...b, face: !el.querySelector('.card.back') });
  });
  root.querySelectorAll<HTMLElement>('[data-anchor]').forEach((el) => {
    const name = el.dataset.anchor!;
    let b: Box | null = null;
    if (name.startsWith('life-')) {
      const cards = el.querySelectorAll<HTMLElement>('.life-card');
      const top = cards[cards.length - 1];
      const r = measure(top ?? el);
      // As cartas de Vida ficam deitadas: a altura delas é a largura da carta.
      const w = top ? top.offsetHeight : el.offsetWidth * 0.7;
      if (r) b = { x: r.x, y: r.y, w, h: w * 1.396, rot: true };
    } else if (name.startsWith('hand-')) {
      const cards = el.querySelectorAll<HTMLElement>('.hand-card');
      const mid = cards[Math.floor(cards.length / 2)];
      const r = measure(mid ?? el);
      const w = mid?.offsetWidth || 60;
      if (r) b = { x: r.x, y: r.y, w, h: w * 1.396 };
    } else if (name === 'arena') {
      b = measure(el);
    } else if (name.startsWith('don-')) {
      el.querySelectorAll<HTMLElement>(':scope > .don-card').forEach((d, i) => {
        const db = measure(d);
        if (db) m.set(`don:${name.slice(4)}:${i}`, db);
      });
      b = measure(el);
    } else {
      const inner = el.querySelector<HTMLElement>('.card, .slot-empty, .don-card');
      b = measure(inner ?? el);
    }
    if (b) m.set(`anchor:${name}`, b);
  });
  return m;
}

// ------------------------------------------------------------------ plano

/** Elementos escondidos até a carta voadora pousar (contador: várias podem ir para o mesmo lugar). */
const hidden = new WeakMap<Element, number>();
function hideEl(el: Element | null) {
  if (!el) return;
  hidden.set(el, (hidden.get(el) ?? 0) + 1);
  el.setAttribute('data-motion-hide', '');
}
function showEl(el: Element | null) {
  if (!el) return;
  const n = (hidden.get(el) ?? 1) - 1;
  hidden.set(el, n);
  if (n <= 0) el.removeAttribute('data-motion-hide');
}

let nextId = 1;

interface Planned {
  item: Item;
  group: number;
  step: number;
}

function plan(prev: GameState, next: GameState, before: Boxes, after: Boxes, root: Element, tempo: number): Item[] {
  // Desfazer volta o estado: só troca a mesa.
  if (next.log.length < prev.log.length) return [];
  const a = spots(prev);
  const b = spots(next);
  interface Move {
    from: Spot;
    to: Spot;
    src: string;
    dst: string;
  }
  const moves: Move[] = [];
  const removed = new Map<string, string[]>();
  const added = new Map<string, string[]>();
  const key = (s: Spot) => `${s.player}:${s.zone}`;
  const push = (m: Map<string, string[]>, k: string, uid: string) => {
    const l = m.get(k);
    if (l) l.push(uid);
    else m.set(k, [uid]);
  };
  for (const [uid, s] of a) {
    const t = b.get(uid);
    if (!t) push(removed, key(s), uid);
    else if (t.zone !== s.zone || t.player !== s.player) moves.push({ from: s, to: t, src: uid, dst: uid });
  }
  for (const [uid, t] of b) if (!a.has(uid)) push(added, key(t), uid);
  for (const p of [0, 1] as PlayerId[]) {
    for (const [fz, tz] of PAIRS) {
      const r = removed.get(`${p}:${fz}`);
      const ad = added.get(`${p}:${tz}`);
      while (r?.length && ad?.length) {
        moves.push({ from: { player: p, zone: fz }, to: { player: p, zone: tz }, src: r.pop()!, dst: ad.shift()! });
      }
    }
  }
  const out: Planned[] = [];
  if (moves.length <= MAX_MOVES) {
    const arena = after.get('anchor:arena');
    const anchor = (boxes: Boxes, s: Spot) => boxes.get(`anchor:${s.zone}-${s.player}`);
    const known = (st: GameState, uid: string) => Boolean(st.cards[uid]) && st.cards[uid].cardId !== HIDDEN_CARD;
    // Jogar uma carta (ou usar um evento/Counter) passa pela vitrine no centro da mesa.
    const showy = moves.filter(
      (m) =>
        (m.to.zone === 'field' && m.from.zone !== 'field') ||
        (m.from.zone === 'hand' &&
          m.to.zone === 'trash' &&
          known(next, m.dst) &&
          (cardDef(next, m.dst).category === 'event' || prev.pending?.kind === 'counter')),
    );
    const showcaseMove = showy.length === 1 && arena ? showy[0] : null;
    // Cartas de Vida novas: cada voo pousa numa delas (escondida até lá).
    const lifeSlots = ([0, 1] as PlayerId[]).map((p) => {
      const els = Array.from(root.querySelectorAll<HTMLElement>(`[data-anchor="life-${p}"] .life-card`));
      return { els: els.slice(Math.min(prev.players[p].life.length, els.length)), next: 0 };
    });
    for (const m of moves) {
      if (m.from.zone === 'deck' && m.to.zone === 'deck') continue;
      const from = before.get(`${m.from.zone}:${m.src}`) ?? anchor(before, m.from);
      let to = after.get(`${m.to.zone}:${m.dst}`) ?? anchor(after, m.to);
      let lifeEl: Element | null = null;
      if (m.to.zone === 'life') {
        const slot = lifeSlots[m.to.player];
        lifeEl = slot.els[slot.next++] ?? null;
        const lb = lifeEl && measure(lifeEl);
        if (lb && lifeEl) to = { x: lb.x, y: lb.y, w: (lifeEl as HTMLElement).offsetHeight, h: (lifeEl as HTMLElement).offsetHeight * 1.396, rot: true };
      }
      if (!from || !to) continue;
      const fromFace = Boolean(from.face) && known(prev, m.src);
      const toFace = Boolean(to.face) && known(next, m.dst);
      const flip = fromFace && toFace ? 'none' : toFace ? 'reveal' : fromFace ? 'hide' : 'back';
      const [st, uid] = toFace ? [next, m.dst] : fromFace ? [prev, m.src] : [next, null];
      const hideTarget = lifeEl ?? (after.has(`${m.to.zone}:${m.dst}`) ? findEl(root, m.to.zone, m.dst) : null);
      const ko = m.from.zone === 'field' && m.to.zone === 'trash';
      let showcase: Box | undefined;
      if (m === showcaseMove && arena) {
        const h = Math.min(arena.h * 0.56, 360);
        showcase = { x: arena.x, y: arena.y, w: h / 1.396, h };
      }
      const duration = (showcase ? 1300 : ko ? 620 : 540) * tempo;
      const group = m.from.zone === 'deck' && m.to.zone === 'life' ? 0 : m.from.zone === 'deck' && m.to.zone === 'hand' ? 2 : 1;
      out.push({
        item: { id: nextId++, kind: 'card', state: st, uid, from, to, flip, showcase, ko, delay: 0, duration, hide: hideTarget },
        group,
        step: group === 0 ? 120 : 95,
      });
      if (ko) out.push({ item: { id: nextId++, kind: 'burst', at: from, tone: 'ko', delay: 0, duration: 520 }, group, step: 0 });
    }
  }
  donPlan(prev, next, before, after, root, tempo, out);

  // Cada grupo começa depois do anterior; as cartas de um grupo saem uma após a outra.
  out.sort((x, y) => x.group - y.group);
  let t = 0;
  let last = -1;
  let end = 0;
  for (const p of out) {
    if (last !== -1 && p.group !== last) t += 140 * tempo;
    last = p.group;
    p.item.delay = t;
    t += p.step * tempo;
    end = Math.max(end, p.item.delay + p.item.duration);
  }
  // Pouso da vitrine: um brilho no lugar da carta.
  for (const p of out) {
    const it = p.item;
    if (it.kind === 'card' && it.showcase && it.to) {
      out.push({
        item: { id: nextId++, kind: 'burst', at: it.to, tone: 'land', delay: it.delay + it.duration * 0.96, duration: 480 },
        group: 9,
        step: 0,
      });
    }
  }
  const items = out.map((p) => p.item);
  for (const it of items) if (it.kind !== 'burst') hideEl(it.hide);
  items.push(...hits(prev, next, after, root));
  if (end > 0) holdMotion(end + 60);
  return items;
}

function findEl(root: Element, zone: Zone, uid: string): Element | null {
  const q = CSS.escape(uid);
  if (zone === 'hand') return root.querySelector(`[data-hand-uid="${q}"]`);
  if (zone === 'field') return root.querySelector(`.field-card [data-uid="${q}"]`);
  if (zone === 'trash') return root.querySelector(`.pile [data-uid="${q}"]`);
  return null;
}

/** DON!!: do deck de DON!! para a área de custo, da área para as cartas e de volta. */
function donPlan(prev: GameState, next: GameState, before: Boxes, after: Boxes, root: Element, tempo: number, out: Planned[]) {
  let count = 0;
  for (const p of [0, 1] as PlayerId[]) {
    const a = prev.players[p];
    const b = next.players[p];
    const attached = (ps: typeof a) => {
      const m = new Map<string, number>();
      for (const fc of [ps.leader, ...ps.characters, ...(ps.stage ? [ps.stage] : [])]) m.set(fc.uid, fc.don);
      return m;
    };
    const pa = attached(a);
    const pb = attached(b);
    const incs: string[] = [];
    const decs: string[] = [];
    for (const [uid, n] of pb) for (let i = (pa.get(uid) ?? 0); i < n; i++) incs.push(uid);
    for (const [uid, n] of pa) for (let i = (pb.get(uid) ?? 0); i < n; i++) decs.push(uid);
    const poolA = a.donActive + a.donRested;
    const poolB = b.donActive + b.donRested;
    let deckOut = Math.max(0, a.donDeck - b.donDeck);
    let deckIn = Math.max(0, b.donDeck - a.donDeck);
    let poolGain = Math.max(0, poolB - poolA + incs.length - decs.length);
    const deckBox = (boxes: Boxes) => boxes.get(`anchor:dondeck-${p}`);
    const poolEls = Array.from(root.querySelectorAll<HTMLElement>(`[data-anchor="don-${p}"] > .don-card`));
    let newSlot = 0;
    /** Os DON!! novos entram por último entre os ativos. */
    const poolDst = (): [Box | undefined, Element | null] => {
      const i = Math.max(0, b.donActive - 1 - newSlot++);
      return [after.get(`don:${p}:${i}`) ?? after.get(`anchor:don-${p}`), poolEls[i] ?? null];
    };
    let used = 0;
    const poolSrc = () => before.get(`don:${p}:${Math.max(0, a.donActive - 1 - used++)}`) ?? before.get(`anchor:don-${p}`);
    const cardBox = (boxes: Boxes, uid: string) => boxes.get(`field:${uid}`);
    const add = (from: Box | undefined, to: Box | undefined, hide: Element | null, group: number, fade = false) => {
      if (!from || !to || count >= MAX_DON) return;
      count++;
      out.push({ item: { id: nextId++, kind: 'don', from, to, fade, delay: 0, duration: 480 * tempo, hide }, group, step: 85 });
    };
    // Das cartas para a área de custo (Fase de Recuperação) ou para o deck de DON!!.
    for (const uid of decs) {
      if (poolGain > 0) {
        poolGain--;
        const [to, el] = poolDst();
        add(cardBox(before, uid), to, el, 1);
      } else if (deckIn > 0) {
        deckIn--;
        add(cardBox(before, uid), deckBox(after), null, 1, true);
      }
    }
    // Do deck de DON!!: primeiro para a área de custo, o resto direto para as cartas.
    const fromDeckToPool = Math.min(deckOut, poolGain);
    for (let i = 0; i < fromDeckToPool; i++) {
      const [to, el] = poolDst();
      add(deckBox(before), to, el, 3);
    }
    deckOut -= fromDeckToPool;
    for (const uid of incs) {
      if (deckOut > 0) {
        deckOut--;
        add(deckBox(before), cardBox(after, uid), null, 3, true);
      } else add(poolSrc(), cardBox(after, uid), null, 1, true);
    }
    // Da área de custo de volta ao deck de DON!! (custos DON!! −N).
    for (let i = 0; i < deckIn; i++) add(poolSrc(), deckBox(after), null, 1, true);
  }
}

/** Dano: o Líder treme e brilha quando a Vida diminui. */
function hits(prev: GameState, next: GameState, after: Boxes, root: Element): Item[] {
  const out: Item[] = [];
  for (const p of [0, 1] as PlayerId[]) {
    if (next.players[p].life.length >= prev.players[p].life.length) continue;
    const uid = next.players[p].leader.uid;
    const box = after.get(`field:${uid}`);
    const el = root.querySelector(`.field-card [data-uid="${CSS.escape(uid)}"]`);
    if (el) {
      el.removeAttribute('data-motion-hit');
      void (el as HTMLElement).offsetWidth; // recomeça a animação
      el.setAttribute('data-motion-hit', '');
      setTimeout(() => el.removeAttribute('data-motion-hit'), 700);
    }
    if (box) out.push({ id: nextId++, kind: 'burst', at: box, tone: 'hit', delay: 0, duration: 600 });
  }
  return out;
}

// ------------------------------------------------------------------ hook e camada

/**
 * Anima a mesa entre um estado e o seguinte. Chame no componente que desenha a
 * mesa (antes dela) e coloque `layer` dentro dele.
 */
export function useBoardMotion(state: GameState, { enabled, tempo }: { enabled: boolean; tempo: number }): ReactNode {
  const [items, setItems] = useState<Item[]>([]);
  const last = useRef<GameState | null>(null);
  const transition = useRef<{ prev: GameState; next: GameState; boxes: Boxes } | null>(null);

  // Ainda na renderização: o DOM mostra o estado anterior. Mede onde cada carta está.
  if (last.current !== state) {
    if (last.current && enabled) transition.current = { prev: last.current, next: state, boxes: capture(document.querySelector('.mat')) };
    else transition.current = null;
    last.current = state;
  }

  useLayoutEffect(() => {
    const t = transition.current;
    transition.current = null;
    const root = document.querySelector('.mat');
    if (!t || t.next !== state || !root) return;
    const planned = plan(t.prev, t.next, t.boxes, capture(root), root, tempo);
    if (planned.length) setItems((cur) => [...cur, ...planned]);
  }, [state, tempo]);

  const done = useCallback((id: number) => setItems((cur) => cur.filter((i) => i.id !== id)), []);

  if (!items.length) return null;
  return (
    <div className="motion-layer" aria-hidden="true">
      {items.map((it) =>
        it.kind === 'card' ? (
          <CardFlightView key={it.id} f={it} onDone={done} />
        ) : it.kind === 'don' ? (
          <DonFlightView key={it.id} f={it} onDone={done} />
        ) : (
          <BurstView key={it.id} b={it} onDone={done} />
        ),
      )}
    </div>
  );
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** transform que leva um elemento de tamanho `base` (preso em 0,0) até a caixa `b`. */
function place(b: Box, base: { w: number; h: number }, opts: { lift?: number; tilt?: number; grow?: number } = {}) {
  const s = (b.w / base.w) * (opts.grow ?? 1);
  const rot = (b.rot ? 90 : 0) + (opts.tilt ?? 0);
  return `translate(${(b.x - base.w / 2).toFixed(1)}px, ${(b.y - base.h / 2 - (opts.lift ?? 0)).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
}

function midBox(a: Box, b: Box): Box {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2, h: (a.h + b.h) / 2, rot: a.rot && b.rot };
}

const EASE = 'cubic-bezier(.25,.8,.3,1)';

/** Para a animação sem dar o voo por terminado (o StrictMode monta os efeitos duas vezes). */
function stop(anim: Animation) {
  anim.onfinish = null;
  anim.oncancel = null;
  anim.cancel();
}

function CardFlightView({ f, onDone }: { f: CardFlight; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const base = f.showcase ?? f.to;

  useLayoutEffect(() => {
    const el = ref.current;
    const inn = inner.current;
    const finish = () => {
      showEl(f.hide);
      onDone(f.id);
    };
    if (!el || !inn || typeof el.animate !== 'function') {
      finish();
      return;
    }
    const dist = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
    const tilt = (f.id % 2 ? 1 : -1) * Math.min(10, 3 + dist / 80);
    let frames: Keyframe[];
    if (f.showcase) {
      const sc = f.showcase;
      frames = [
        { transform: place(f.from, base), offset: 0, easing: EASE },
        { transform: place(sc, base, { grow: 1.04 }), offset: 0.26, easing: 'ease-out' },
        { transform: place(sc, base), offset: 0.34 },
        { transform: place(sc, base), offset: 0.7, easing: 'cubic-bezier(.55,0,.35,1)' },
        { transform: place(f.to, base), offset: 1 },
      ];
    } else {
      const mid = midBox(f.from, f.to);
      frames = [
        { transform: place(f.from, base), offset: 0, easing: 'ease-in-out' },
        { transform: place(mid, base, { lift: Math.min(46, 12 + dist * 0.08), tilt, grow: 1.12 }), offset: 0.5, easing: 'ease-in-out' },
        { transform: place(f.to, base), offset: 1 },
      ];
      if (f.ko) {
        frames = [
          { transform: place(f.from, base, { grow: 1.12 }), filter: 'brightness(1.8) saturate(0.4)', offset: 0, easing: 'ease-out' },
          { transform: place(f.from, base, { grow: 1.05, tilt: -tilt }), filter: 'brightness(1.3) saturate(0.6)', offset: 0.22, easing: 'ease-in' },
          { transform: place(f.to, base, { tilt }), filter: 'brightness(0.9) saturate(0.7)', offset: 1 },
        ];
      }
    }
    const anim = el.animate(frames, { duration: f.duration, delay: f.delay, fill: 'both' });
    // Virar a carta: no centro da vitrine ou no meio do voo.
    const [f0, f1] = f.showcase ? [0.3, 0.46] : [0.2, 0.7];
    const persp = 'perspective(900px)';
    let flipAnim: Animation | null = null;
    if (f.flip === 'reveal' || f.flip === 'hide') {
      const [s, e] = f.flip === 'reveal' ? [180, 0] : [0, 180];
      flipAnim = inn.animate(
        [
          { transform: `${persp} rotateY(${s}deg)`, offset: 0 },
          { transform: `${persp} rotateY(${s}deg)`, offset: f0, easing: 'ease-in-out' },
          { transform: `${persp} rotateY(${e}deg)`, offset: f1 },
          { transform: `${persp} rotateY(${e}deg)`, offset: 1 },
        ],
        { duration: f.duration, delay: f.delay, fill: 'both' },
      );
    }
    anim.onfinish = finish;
    anim.oncancel = finish;
    return () => {
      stop(anim);
      flipAnim?.cancel();
    };
    // Cada voo roda uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flipped = f.flip === 'back' || f.flip === 'reveal';
  return (
    <div
      ref={ref}
      className={['flight', f.showcase ? 'showcase' : '', f.ko ? 'ko' : ''].join(' ')}
      style={vars({ width: `${base.w}px`, height: `${base.h}px`, '--cw': `${base.w}px`, '--hcw': `${base.w}px` })}
    >
      <div ref={inner} className="flight-inner" style={{ transform: `perspective(900px) rotateY(${flipped ? 180 : 0}deg)` }}>
        {f.uid && f.flip !== 'back' && (
          <div className="flight-face front">
            <CardView state={f.state} uid={f.uid} eager />
          </div>
        )}
        <div className="flight-face back">
          <CardBack />
        </div>
      </div>
    </div>
  );
}

function DonFlightView({ f, onDone }: { f: DonFlight; onDone: (id: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const finish = () => {
      showEl(f.hide);
      onDone(f.id);
    };
    if (!el || typeof el.animate !== 'function') {
      finish();
      return;
    }
    const base = f.from;
    // Para uma carta: chega do tamanho de um DON!! e some sobre ela.
    const to = f.fade ? { ...f.to, w: base.w, h: base.h, rot: false } : f.to;
    const dist = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
    const anim = el.animate(
      [
        { transform: place(f.from, base), offset: 0, easing: 'ease-out' },
        { transform: place(midBox(f.from, to), base, { lift: Math.min(40, 10 + dist * 0.1), tilt: 14, grow: 1.35 }), offset: 0.45, easing: 'ease-in' },
        { transform: place(to, base), opacity: 1, offset: 0.9 },
        { transform: place(to, base, { grow: f.fade ? 0.6 : 1 }), opacity: f.fade ? 0 : 1, offset: 1 },
      ],
      { duration: f.duration, delay: f.delay, fill: 'both' },
    );
    anim.onfinish = finish;
    anim.oncancel = finish;
    return () => stop(anim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span ref={ref} className="don-card flight-don" style={vars({ '--dw': `${f.from.w}px`, width: `${f.from.w}px`, height: `${f.from.h}px` })} />;
}

function BurstView({ b, onDone }: { b: Burst; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onDone(b.id);
      return;
    }
    const anim = el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.95 },
        { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 0 },
      ],
      { duration: b.duration, delay: b.delay, fill: 'both', easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    anim.onfinish = () => onDone(b.id);
    anim.oncancel = () => onDone(b.id);
    return () => stop(anim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const size = Math.max(b.at.w, b.at.h) * 1.5;
  return <div ref={ref} className={['burst', b.tone].join(' ')} style={{ left: b.at.x, top: b.at.y, width: size, height: size }} />;
}
