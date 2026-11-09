// Tempo das animações da mesa, calculado só pelo estado (sem a tela).
//
// A mesa anima cada jogada (apps/web/src/components/Motion.tsx): as cartas voam entre as zonas, os
// DON!! vão e voltam e um ataque, uma habilidade ou um [Trigger] param no centro. Enquanto isso roda,
// quem joga com as animações ligadas não consegue agir, e o relógio da partida online não pode cobrar
// esse tempo dele (seria vantagem jogar sem animação). Como o relógio é do servidor, ele precisa saber
// quanto dura a animação sem ver a tela: `motionHoldMs` refaz as mesmas contas do plano da animação
// (os mesmos tempos, grupos e limites), só a partir dos dois estados e da ação. A espera vale para os
// dois jogadores por igual, com ou sem animação, e não dá para alongar pelo cliente.
//
// Mantenha os tempos iguais aos de Motion.tsx (`plan`, `spotPlan`, `donPlan`): são a mesma animação.

import { cardDef } from './engine';
import type { Action, GameState, PlayerId } from './types';
import { HIDDEN_CARD } from './view';

export interface TriggerHit {
  /** Dono da carta (quem ativou o [Trigger]). */
  player: PlayerId;
  /** A carta no estado novo; null se ela não está à vista (voltou para a mão do oponente, o deck…). */
  uid: string | null;
}

/**
 * O [Trigger] ativado de `prev` para `next` (o último, se houver mais de um).
 *
 * Vem da linha do histórico (`log.triggerActivated`), que é pública: vale igual para o bot, o
 * replay e o online. Pelo estado da pilha não dá: o [Trigger] sem escolhas resolve inteiro na
 * mesma ação e o estado novo já não traz o efeito.
 */
export function freshTrigger(prev: GameState, next: GameState): TriggerHit | null {
  if (next.log.length <= prev.log.length) return null;
  let entry: GameState['log'][number] | undefined;
  for (let i = next.log.length - 1; i >= prev.log.length && !entry; i--) if (next.log[i].key === 'log.triggerActivated') entry = next.log[i];
  if (!entry || entry.player === null) return null;
  const player = entry.player;
  const name = entry.params?.card;
  // Antes da resposta a carta já saiu da Vida e não está em área nenhuma: no estado anterior ela
  // não aparece. Agora ela está fora das áreas (resolvendo) ou onde o efeito a deixou.
  const before = new Set<string>();
  for (const ps of prev.players) {
    for (const u of [...ps.hand, ...ps.trash, ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : [])]) before.add(u);
  }
  for (const u of prev.limbo ?? []) before.add(u);
  const ps = next.players[player];
  const pool = [...(next.limbo ?? []), ...[...ps.trash].reverse(), ...ps.characters.map((c) => c.uid), ...(ps.stage ? [ps.stage.uid] : []), ...ps.hand];
  const uid =
    pool.find((u) => !before.has(u) && next.cards[u] && next.cards[u].cardId !== HIDDEN_CARD && (name === undefined || cardDef(next, u).name === name)) ??
    null;
  return { player, uid };
}

type Zone = 'deck' | 'hand' | 'life' | 'trash' | 'field';
interface Spot {
  player: PlayerId;
  zone: Zone;
}

/** Pares origem → destino em que uma carta que sumiu de uma zona e outra que apareceu noutra são a mesma. */
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

/** Tempos (ms, com `tempo` = 1) da parada no centro da mesa: ida, parada e volta. */
export const MOTION_SPOT_MS = {
  trigger: { flyIn: 340, hold: 1000, back: 280 },
  attack: { flyIn: 260, hold: 450, back: 240 },
  ability: { flyIn: 260, hold: 950, back: 240 },
} as const;

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

const known = (st: GameState, uid: string) => Boolean(st.cards[uid]) && st.cards[uid].cardId !== HIDDEN_CARD;

/** A parada no centro da mesa desta jogada (como `spotPlan`): o que para e a carta do [Trigger], se for ele. */
function spotOf(prev: GameState, next: GameState, action: Action | undefined): { tone: keyof typeof MOTION_SPOT_MS; uid: string } | null {
  if (next.actionCount <= prev.actionCount) return null;
  const trig = freshTrigger(prev, next);
  if (trig?.uid) return { tone: 'trigger', uid: trig.uid };
  const b = prev.battle;
  if (b && b.step !== 'end' && known(prev, b.attacker) && prev.cards[b.target]) {
    const defender = prev.cards[b.target].owner;
    const wasLeader = prev.players[defender].leader.uid === b.target;
    const lifeLost = next.players[defender].life.length < prev.players[defender].life.length;
    const damage = (st: GameState) => st.stack.some((f) => f.kind === 'damage' && f.defender === defender);
    const koed = !wasLeader && spots(next).get(b.target)?.zone !== 'field';
    const over = !next.battle || next.battle.step === 'end';
    if (over && (lifeLost || (damage(next) && !damage(prev)) || koed || next.winner !== null)) return { tone: 'attack', uid: b.attacker };
  }
  if (action?.type === 'activate' && known(next, action.uid) && next.log.length > prev.log.length && cardDef(next, action.uid).abilities[action.ability]) {
    return { tone: 'ability', uid: action.uid };
  }
  return null;
}

/** Um item da animação, só com o que decide o tempo: a ordem (grupo), o passo até o próximo e a duração. */
interface Timed {
  group: number;
  step: number;
  duration: number;
}

/**
 * Quanto tempo (ms) a mesa fica animando a passagem de `prev` para `next` pela ação `action`; 0 se
 * nada se move. `tempo` é o multiplicador da velocidade (1 na partida online).
 */
export function motionHoldMs(prev: GameState, next: GameState, action?: Action, tempo = 1): number {
  // Desfazer volta o estado: só troca a mesa.
  if (next.log.length < prev.log.length) return 0;
  const spot = spotOf(prev, next, action);
  const spotMs = spot ? MOTION_SPOT_MS[spot.tone] : null;
  const spotDuration = spotMs ? (spotMs.flyIn + spotMs.hold + spotMs.back) * tempo : 0;
  // Com uma carta em destaque, o resto da mesa espera ela voltar ao lugar.
  const lead = spot ? spotDuration - 100 * tempo : 0;

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
  // A carta do [Trigger] em destaque faz o próprio caminho (da Vida ao destino).
  const own = spot?.tone === 'trigger' ? spot.uid : null;
  for (const [uid, t] of b) if (!a.has(uid) && uid !== own) push(added, key(t), uid);
  for (const p of [0, 1] as PlayerId[]) {
    for (const [fz, tz] of PAIRS) {
      const r = removed.get(`${p}:${fz}`);
      const ad = added.get(`${p}:${tz}`);
      while (r?.length && ad?.length) {
        moves.push({ from: { player: p, zone: fz }, to: { player: p, zone: tz }, src: r.pop()!, dst: ad.shift()! });
      }
    }
  }

  const out: Timed[] = [];
  if (moves.length <= MAX_MOVES) {
    // Jogar uma carta (ou usar um evento/Counter) passa pela vitrine no centro da mesa.
    const showy = moves.filter(
      (m) =>
        (m.to.zone === 'field' && m.from.zone !== 'field') ||
        (m.from.zone === 'hand' &&
          m.to.zone === 'trash' &&
          known(next, m.dst) &&
          (cardDef(next, m.dst).category === 'event' || prev.pending?.kind === 'counter')),
    );
    const showcase = showy.length === 1 ? showy[0] : null;
    for (const m of moves) {
      if (m.from.zone === 'deck' && m.to.zone === 'deck') continue;
      const ko = m.from.zone === 'field' && m.to.zone === 'trash';
      const duration = (m === showcase ? 750 : ko ? 400 : 340) * tempo;
      const toLife = m.from.zone === 'deck' && m.to.zone === 'life';
      // No fim do mulligan a Vida sai do deck depois da troca da mão (5-2-1-7); no resto do jogo, antes.
      const group = toLife ? (prev.phase === 'mulligan' ? 2.5 : 0) : m.from.zone === 'deck' && m.to.zone === 'hand' ? 2 : 1;
      out.push({ group, step: toLife ? 70 : 55, duration });
      if (ko) out.push({ group, step: 0, duration: 520 });
    }
  }
  donTimes(prev, next, tempo, out);

  // Cada grupo começa depois do anterior; as cartas de um grupo saem uma após a outra.
  out.sort((x, y) => x.group - y.group);
  let t = lead;
  let last = -1;
  let end = 0;
  for (const it of out) {
    if (last !== -1 && it.group !== last) t += 80 * tempo;
    last = it.group;
    end = Math.max(end, t + it.duration);
    t += it.step * tempo;
  }
  if (spot) end = Math.max(end, spotDuration + 200);
  return end > 0 ? end + 60 : 0;
}

/** DON!!: do deck de DON!! para a área de custo, da área para as cartas e de volta (como `donPlan`). */
function donTimes(prev: GameState, next: GameState, tempo: number, out: Timed[]) {
  let count = 0;
  const add = (group: number) => {
    if (count >= MAX_DON) return;
    count++;
    out.push({ group, step: 50, duration: 300 * tempo });
  };
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
    let incs = 0;
    let decs = 0;
    for (const [uid, n] of pb) incs += Math.max(0, n - (pa.get(uid) ?? 0));
    for (const [uid, n] of pa) decs += Math.max(0, n - (pb.get(uid) ?? 0));
    const poolA = a.donActive + a.donRested;
    const poolB = b.donActive + b.donRested;
    let deckOut = Math.max(0, a.donDeck - b.donDeck);
    let deckIn = Math.max(0, b.donDeck - a.donDeck);
    /** DON!! que chegam à área de custo (das cartas e do deck de DON!!). */
    let poolGain = Math.max(0, poolB - poolA + incs);
    // Das cartas para a área de custo (Fase de Recuperação) ou para o deck de DON!!.
    for (let i = 0; i < decs; i++) {
      if (poolGain > 0) {
        poolGain--;
        add(1);
      } else if (deckIn > 0) {
        deckIn--;
        add(1);
      }
    }
    // Do deck de DON!!: primeiro para a área de custo, o resto direto para as cartas.
    const fromDeckToPool = Math.min(deckOut, poolGain);
    for (let i = 0; i < fromDeckToPool; i++) add(3);
    deckOut -= fromDeckToPool;
    for (let i = 0; i < incs; i++) {
      if (deckOut > 0) {
        deckOut--;
        add(3);
      } else add(1);
    }
    // Da área de custo de volta ao deck de DON!! (custos DON!! −N).
    for (let i = 0; i < deckIn; i++) add(1);
  }
}
