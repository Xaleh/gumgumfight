import { type Action, cardDef, type GameState, HIDDEN_CARD, type PlayerId } from '@gumgum/engine';
import { useEffect, useRef } from 'react';
import { audio } from '../audio';

type Zone = 'deck' | 'hand' | 'life' | 'trash' | 'field';
interface Spot {
  player: PlayerId;
  zone: Zone;
}

/**
 * Para onde as cartas sem identidade (mão e deck do oponente, que trocam de uid ao mudar de
 * área) costumam ir, em ordem de preferência. Mesma heurística de `Motion.tsx`.
 */
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
];
/** Uma troca maior que isso (desfazer, ferramentas manuais, pulo no replay) fica em silêncio. */
const MAX_MOVES = 16;

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

interface Move {
  from: Spot;
  to: Spot;
  /** uid da carta no estado novo. */
  uid: string;
}

function moves(prev: GameState, next: GameState): Move[] {
  const a = spots(prev);
  const b = spots(next);
  const out: Move[] = [];
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
    else if (t.zone !== s.zone || t.player !== s.player) out.push({ from: s, to: t, uid });
  }
  for (const [uid, t] of b) if (!a.has(uid)) push(added, key(t), uid);
  for (const p of [0, 1] as PlayerId[]) {
    for (const [fz, tz] of PAIRS) {
      const r = removed.get(`${p}:${fz}`);
      const ad = added.get(`${p}:${tz}`);
      while (r?.length && ad?.length) {
        r.pop();
        out.push({ from: { player: p, zone: fz }, to: { player: p, zone: tz }, uid: ad.shift()! });
      }
    }
  }
  return out;
}

const fieldDon = (st: GameState) => st.players.reduce((n, p) => n + p.leader.don + p.characters.reduce((m, c) => m + c.don, 0), 0);
const known = (st: GameState, uid: string) => Boolean(st.cards[uid]) && st.cards[uid].cardId !== HIDDEN_CARD;

/** Mesmo som várias vezes na mesma jogada (5 cartas compradas): no máximo 3 toques, em cascata. */
function burst(name: 'draw' | 'play' | 'ko' | 'don', count: number, delay = 0) {
  for (let i = 0; i < Math.min(3, count); i++) audio.play(name, { delay: delay + i * 90 });
}

export interface MatchAudioOptions {
  /** Desligado nos pulos do replay e no replay acelerado (a mesa muda sem animação). */
  enabled: boolean;
  /** As animações estão ligadas: o impacto do ataque espera a carta atacante chegar ao centro. */
  animate: boolean;
  /** Velocidade das animações (1 = normal). */
  tempo: number;
  /** Lado do jogador (null = replay ou espectador). */
  human: PlayerId | null;
  /** Última ação aplicada (para a ativação de habilidade). */
  lastAction?: Action;
}

/**
 * Sons da partida, derivados da diferença entre o estado anterior e o novo (como as animações em
 * `Motion.tsx`): valem para a partida contra o bot, online, espectador e replay. A música da mesa
 * toca enquanto a partida dura; no fim toca a vinheta do resultado.
 */
export function useMatchAudio(state: GameState, opts: MatchAudioOptions) {
  const last = useRef<GameState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const prev = last.current;
    last.current = state;
    const { enabled, animate, tempo, human, lastAction } = optsRef.current;
    if (!prev || prev === state || !enabled) return;
    // Desfazer volta o estado: nada a tocar.
    if (state.log.length < prev.log.length) return;

    // Fim da partida: vinheta (a música para no efeito abaixo).
    if (state.phase === 'gameover' && prev.phase !== 'gameover') {
      const kind = state.winner === null ? 'draw' : human === null || state.winner === human ? 'win' : 'lose';
      audio.jingle(kind);
      return;
    }

    const all = moves(prev, state);
    if (all.length > MAX_MOVES) return;
    const sameBattle = Boolean(prev.battle && state.battle && prev.battle.attacker === state.battle.attacker && prev.battle.target === state.battle.target);
    const battleOver = Boolean(prev.battle) && (!state.battle || state.battle.step === 'end');
    const lifeLost = state.players.some((p, i) => p.life.length < prev.players[i].life.length);
    // Num ataque, a carta atacante voa até o centro antes do impacto (ver `spotPlan` em Motion).
    const impactAt = animate && prev.battle && battleOver ? 420 * tempo : 0;

    // Início da partida e mulligan: embaralhar.
    const dealt = prev.players.every((p) => p.hand.length === 0 && p.life.length === 0) && state.players.some((p) => p.hand.length > 0);
    // "Trocar mão": a mão inteira volta ao deck e outra é comprada ("Manter mão" não muda nada).
    const mulligan = state.players.some(
      (p, i) => p.mulliganDone && !prev.players[i].mulliganDone && p.hand.length > 0 && p.hand.every((uid) => !prev.players[i].hand.includes(uid)),
    );
    if (dealt || mulligan) {
      audio.play('shuffle');
      return;
    }

    let draws = 0;
    let plays = 0;
    let kos = 0;
    let counters = 0;
    let lifeDealt = 0;
    for (const m of all) {
      if (m.from.zone === 'deck' && m.to.zone === 'life') lifeDealt++;
      else if (m.to.zone === 'hand') draws++;
      else if (m.to.zone === 'field' && m.from.zone !== 'field') plays++;
      else if (m.from.zone === 'field' && m.to.zone === 'trash') kos++;
      else if (m.from.zone === 'hand' && m.to.zone === 'trash') {
        if (prev.battle?.step === 'counter' || prev.pending?.kind === 'counter') counters++;
        else if (known(state, m.uid) && cardDef(state, m.uid).category === 'event') plays++;
        else draws++; // descarte: a carta desliza
      } else if (m.from.zone === 'life' && m.to.zone === 'trash') {
        /* carta da Vida sem [Trigger] indo para o descarte: o dano já tocou */
      }
    }

    // As cartas de Vida postas no começo da partida: embaralhar; uma só (efeito): desliza.
    if (lifeDealt >= 4) audio.play('shuffle');
    else draws += lifeDealt;
    if (counters) audio.play('counter');
    if (plays) burst('play', plays);
    if (draws && !lifeLost) burst('draw', draws);

    // Batalha.
    if (state.battle && !sameBattle && state.battle.step !== 'end') audio.play('attack');
    if (sameBattle && state.battle!.blocked && !prev.battle!.blocked) audio.play('block');
    if (lifeLost) audio.play('hit', { delay: impactAt });
    if (kos) burst('ko', kos, impactAt);

    // [Trigger] revelado da Vida.
    if (state.stack.some((f) => f.kind === 'effect' && f.trigger) && !prev.stack.some((f) => f.kind === 'effect' && f.trigger)) audio.play('trigger');

    // Habilidade ativada pelo jogador.
    if (lastAction?.type === 'activate' && state.log.length > prev.log.length && known(state, lastAction.uid)) audio.play('ability');

    // DON!!: anexado (sobe) ou devolvido (desce), fora da troca de turno (o Refresh devolve todos).
    const turnChanged = state.activePlayer !== prev.activePlayer || state.turn !== prev.turn;
    const don = fieldDon(state) - fieldDon(prev);
    if (don > 0) burst('don', don);
    else if (don < 0 && !turnChanged && !kos) audio.play('don', { gain: 0.7 });

    // Troca de turno (e o primeiro turno, depois do mulligan).
    if (state.phase === 'main' && (turnChanged || prev.phase !== 'main')) audio.play('turn', { detune: 0 });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Música da mesa enquanto a partida dura; silêncio no fim (a vinheta toca no efeito acima).
  const over = state.phase === 'gameover';
  useEffect(() => {
    audio.music(over ? null : 'battle');
  }, [over]);
}
