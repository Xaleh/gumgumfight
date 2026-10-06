// Sorteio inicial com dados 3D no estilo do dado oficial do One Piece Card Game
// (cubo vermelho brilhante, números brancos e a caveira dos Chapéus de Palha na
// face do 1): o jogador segura o dado com o dedo (ou o mouse),
// chacoalha e solta para jogá-lo na mesa. Depois vem a vez do oponente: o bot
// pega o dado, chacoalha e joga; no online, o dado dele rola quando ele joga (o
// servidor repassa o gesto). O vencedor só aparece depois que os dois param.
//
// O vencedor do sorteio já foi definido pelo motor (state.rollWinner, a partir da
// seed); os dados só mostram esse resultado: o valor de cada um é escolhido para
// que o vencedor tire o número maior. Depois, o vencedor escolhe se joga primeiro
// ou segundo (a escolha é uma ação do motor, gravada no replay).

import type { GameState, PlayerId } from '@gumgum/engine';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { DiceThrow } from '../game/useOnlineGame';
import { CardView } from './CardView';

/** Lado do dado em px (igual a `--die` em styles.css). */
const SIZE = 58;
const R = SIZE / 2;
/** Graus de giro por pixel rolado (dado rolando sem deslizar). */
const ROLL = 360 / (Math.PI * SIZE);
/** Rotação (x, y) do cubo que deixa cada face virada para cima (para a tela). */
const FACE: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
/** Ordem das faces no cubo (pares opostos somam 7, como no dado real). */
const FACES = [1, 6, 3, 4, 2, 5];

type DieStatus = 'idle' | 'held' | 'shaking' | 'rolling' | 'done';
/** Quem joga cada dado: o próprio jogador, o navegador (bot) ou o oponente pela rede. */
type Ctrl = 'user' | 'auto' | 'remote';
/** Sem notícia do oponente pela rede, o dado dele é jogado sozinho depois deste tempo. */
const REMOTE_WAIT_MS = 10_000;

interface Die {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Giro no ar (graus/s). */
  wz: number;
  value: number;
  state: 'idle' | 'held' | 'shaking' | 'rolling' | 'settling' | 'done';
  /** Onde o dado fica parado (o bot chacoalha em volta daqui). */
  home: { x: number; y: number };
  thrownAt?: number;
  shakeUntil?: number;
  settle?: { t: number; from: [number, number, number]; to: [number, number, number] };
}


const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function DiceRoll({
  state,
  human,
  remote,
  onResult,
  onChoose,
  onDone,
}: {
  state: GameState;
  /** null: ninguém joga (espectador, bot x bot): os dados são lançados sozinhos. */
  human: PlayerId | null;
  /** Partida online: lançamentos de cada assento e envio do seu. */
  remote?: { throws: [DiceThrow | null, DiceThrow | null]; send: (vx: number, vy: number) => void };
  /** Os dois dados pararam (o bot pode fazer a escolha dele). */
  onResult: () => void;
  /** O jogador venceu e escolheu: true = jogar primeiro. */
  onChoose: (first: boolean) => void;
  onDone: () => void;
}) {
  const me: PlayerId = human ?? 0;
  const opp = (me === 0 ? 1 : 0) as PlayerId;
  /** Assento de cada dado: o de baixo é o seu (ou o do jogador 0, para o espectador). */
  const seats: [PlayerId, PlayerId] = [me, opp];
  const winner = state.rollWinner ?? state.firstPlayer;
  /** O vencedor ainda não escolheu se joga primeiro ou segundo. */
  const choosing = state.pending?.kind === 'chooseFirst';
  const iWon = human !== null && winner === human;
  const isBot = (p: PlayerId) => state.players[p].isBot;
  const [ctrl] = useState<[Ctrl, Ctrl]>(() => [
    human !== null ? 'user' : remote && !isBot(me) ? 'remote' : 'auto',
    remote && !isBot(opp) ? 'remote' : 'auto',
  ]);
  // O vencedor tira o maior número (sem empate). Os números saem do que os dois
  // jogadores têm igual (seed e apelidos das cartas da partida), para todo mundo ver os mesmos.
  const values = useMemo(() => {
    let h = 2166136261;
    for (const ch of `${state.seed}:${state.players[0].leader.uid}:${state.players[1].leader.uid}:${winner}`) {
      h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    }
    const hi = 2 + (h % 5);
    const lo = 1 + ((h >>> 8) % (hi - 1));
    return { [winner]: hi, [winner === 0 ? 1 : 0]: lo } as Record<PlayerId, number>;
    // Fixos durante o sorteio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner]);

  const [status, setStatusState] = useState<[DieStatus, DieStatus]>(['idle', 'idle']);
  const statusRef = useRef(status);
  const setStatus = (i: number, s: DieStatus) => {
    if (statusRef.current[i] === s) return;
    const next = [...statusRef.current] as [DieStatus, DieStatus];
    next[i] = s;
    statusRef.current = next;
    setStatusState(next);
  };
  const result = status[0] === 'done' && status[1] === 'done';
  const tray = useRef<HTMLDivElement>(null);
  const dieEls = useRef<(HTMLDivElement | null)[]>([null, null]);
  const dice = useRef<[Die, Die] | null>(null);
  const samples = useRef<{ x: number; y: number; t: number }[]>([]);
  const raf = useRef(0);
  const running = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const size = () => {
    const el = tray.current;
    return { W: el?.clientWidth ?? 320, H: el?.clientHeight ?? 190 };
  };

  // Posição inicial: o seu dado embaixo, o do oponente em cima.
  useEffect(() => {
    const { W, H } = size();
    const make = (p: PlayerId, x: number, y: number): Die => ({
      x,
      y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: rand(-25, 25),
      ry: rand(-25, 25),
      rz: rand(-30, 30),
      wz: 0,
      value: values[p],
      state: 'idle',
      home: { x, y },
    });
    dice.current = [make(me, W * 0.4, H * 0.74), make(opp, W * 0.6, H * 0.26)];
    draw();
    // O dado de baixo sem jogador na tela: sozinho, ou esperando o jogador pela rede.
    if (ctrl[0] === 'user') return undefined;
    const t = setTimeout(() => shake(0), ctrl[0] === 'auto' ? 700 : REMOTE_WAIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A vez do oponente: depois que o seu dado para (ou sozinho, se ele não jogar).
  useEffect(() => {
    if (status[0] !== 'done' || status[1] !== 'idle') return;
    const t = setTimeout(() => shake(1), ctrl[1] === 'auto' ? 450 : REMOTE_WAIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Lançamentos vindos da rede. Na tela, o oponente fica em cima: o gesto dele é espelhado.
  const throws = remote?.throws;
  useEffect(() => {
    if (!throws || !dice.current) return;
    const { W, H } = size();
    for (const i of [0, 1]) {
      const t = throws[seats[i]];
      if (ctrl[i] !== 'remote' || !t || !['idle', 'shaking'].includes(dice.current[i].state)) continue;
      const k = i === 1 ? -1 : 1;
      launch(i, k * t.vx * W, k * t.vy * H);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throws]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  useEffect(() => {
    if (result) resultRef.current();
  }, [result]);

  // Depois da escolha, segue sozinho em pouco tempo.
  useEffect(() => {
    if (!result || choosing) return;
    const t = setTimeout(() => doneRef.current(), 2400);
    return () => clearTimeout(t);
  }, [result, choosing]);

  function draw() {
    const ds = dice.current;
    if (!ds) return;
    ds.forEach((d, i) => {
      const el = dieEls.current[i];
      if (!el) return;
      el.style.transform = `translate(${(d.x - R).toFixed(1)}px, ${(d.y - R).toFixed(1)}px)`;
      const cube = el.querySelector<HTMLElement>('.die-cube');
      const shadow = el.querySelector<HTMLElement>('.die-shadow');
      const lift = Math.max(0, d.z);
      if (cube) {
        cube.style.transform = `translateY(${(-lift * 0.55).toFixed(1)}px) scale(${(1 + lift / 260).toFixed(3)}) rotateZ(${d.rz.toFixed(1)}deg) rotateX(${d.rx.toFixed(1)}deg) rotateY(${d.ry.toFixed(1)}deg)`;
      }
      if (shadow) {
        shadow.style.transform = `translate(${(lift * 0.18).toFixed(1)}px, ${(lift * 0.25).toFixed(1)}px) scale(${(1 - lift / 320).toFixed(3)})`;
        shadow.style.opacity = String(Math.max(0.25, 0.55 - lift / 400));
      }
    });
  }

  const nearest = (cur: number, target: number) => target + Math.round((cur - target) / 360) * 360;

  function step(dt: number, now: number) {
    const ds = dice.current!;
    const { W, H } = size();
    const lo = R + 9;
    ds.forEach((d, i) => {
      if (d.state === 'shaking') {
        // O bot (ou quem demorou) pega o dado e chacoalha antes de jogar.
        const t = now / 1000;
        d.z = 24 + Math.sin(t * 17) * 5;
        d.x = d.home.x + Math.sin(t * 22) * 10;
        d.y = d.home.y + Math.cos(t * 27) * 6;
        d.rx += 820 * dt;
        d.ry -= 640 * dt;
        d.rz += 260 * dt;
        if (now >= (d.shakeUntil ?? 0)) launch(i, rand(-300, 300), (i === 0 ? -1 : 1) * rand(700, 950));
        return;
      }
      if (d.state === 'rolling') {
        // Segurança: depois de alguns segundos, assenta à força.
        if (now - (d.thrownAt ?? now) > 2800) {
          d.vx = d.vy = d.vz = 0;
          d.z = 0;
        }
        d.vz -= 1700 * dt;
        d.z += d.vz * dt;
        if (d.z <= 0) {
          d.z = 0;
          if (Math.abs(d.vz) > 140) {
            d.vz = -d.vz * 0.42;
            d.vx *= 0.86;
            d.vy *= 0.86;
            d.wz = rand(-1, 1) * Math.hypot(d.vx, d.vy) * 0.6;
            navigator.vibrate?.(6);
          } else d.vz = 0;
        }
        const ground = d.z <= 0.5;
        const k = Math.exp(-(ground ? 3.8 : 0.35) * dt);
        d.vx *= k;
        d.vy *= k;
        // Atrito da mesa: freia de vez no fim, sem o dado ficar deslizando devagar.
        const sp = Math.hypot(d.vx, d.vy);
        if (ground && sp > 0) {
          const f = Math.max(0, sp - 700 * dt) / sp;
          d.vx *= f;
          d.vy *= f;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < lo || d.x > W - lo) {
          d.x = Math.max(lo, Math.min(W - lo, d.x));
          d.vx = -d.vx * 0.62;
          navigator.vibrate?.(8);
        }
        if (d.y < lo || d.y > H - lo) {
          d.y = Math.max(lo, Math.min(H - lo, d.y));
          d.vy = -d.vy * 0.62;
          navigator.vibrate?.(8);
        }
        // Rolando na mesa: gira conforme anda; no ar, gira solto.
        d.rx -= d.vy * dt * ROLL;
        d.ry += d.vx * dt * ROLL;
        d.rz += d.wz * dt;
        d.wz *= Math.exp(-(ground ? 5 : 1) * dt);
        if (ground && d.vz === 0 && Math.hypot(d.vx, d.vy) < 70) {
          const [tx, ty] = FACE[d.value];
          d.state = 'settling';
          d.settle = {
            t: 0,
            from: [d.rx, d.ry, d.rz],
            to: [nearest(d.rx, tx), nearest(d.ry, ty), nearest(d.rz, Math.round(d.rz / 90) * 90 + rand(-12, 12))],
          };
        }
      } else if (d.state === 'settling' && d.settle) {
        const s = d.settle;
        s.t = Math.min(1, s.t + dt / 0.42);
        // Assenta com um pequeno balanço no fim.
        const e = 1 - Math.pow(1 - s.t, 3) + Math.sin(s.t * Math.PI) * 0.06;
        d.rx = s.from[0] + (s.to[0] - s.from[0]) * e;
        d.ry = s.from[1] + (s.to[1] - s.from[1]) * e;
        d.rz = s.from[2] + (s.to[2] - s.from[2]) * e;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= 0.85;
        d.vy *= 0.85;
        if (s.t >= 1) {
          [d.rx, d.ry, d.rz] = s.to;
          d.state = 'done';
          d.home = { x: d.x, y: d.y };
          setStatus(i, 'done');
        }
      }
    });
    // Um dado bate no outro.
    const [a, b] = ds;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const loose = (d: Die) => d.state === 'rolling' || d.state === 'done';
    if (dist < SIZE * 1.05 && a.z < SIZE && b.z < SIZE && loose(a) && loose(b) && (a.state === 'rolling' || b.state === 'rolling')) {
      const nx = dx / dist;
      const ny = dy / dist;
      // O dado parado não sai do lugar: o que está rolando é que bate e volta.
      const wa = a.state === 'rolling' ? (b.state === 'rolling' ? 0.5 : 1) : 0;
      const push = SIZE * 1.05 - dist;
      a.x -= nx * push * wa;
      a.y -= ny * push * wa;
      b.x += nx * push * (1 - wa);
      b.y += ny * push * (1 - wa);
      const va = a.vx * nx + a.vy * ny;
      const vb = b.vx * nx + b.vy * ny;
      if (va - vb > 0) {
        const j = (va - vb) * 0.85;
        if (a.state === 'rolling') {
          a.vx -= j * nx * (b.state === 'rolling' ? 1 : 2);
          a.vy -= j * ny * (b.state === 'rolling' ? 1 : 2);
        }
        if (b.state === 'rolling') {
          b.vx += j * nx * (a.state === 'rolling' ? 1 : 2);
          b.vy += j * ny * (a.state === 'rolling' ? 1 : 2);
        }
      }
    }
  }

  /** Roda a física enquanto algum dado estiver sendo chacoalhado ou rolando. */
  function ensureLoop() {
    if (running.current) return;
    running.current = true;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      step(dt, now);
      draw();
      if (dice.current!.some((d) => d.state === 'shaking' || d.state === 'rolling' || d.state === 'settling')) {
        raf.current = requestAnimationFrame(tick);
      } else running.current = false;
    };
    raf.current = requestAnimationFrame(tick);
  }

  /** Joga o dado `i` com a velocidade dada (px/s na mesa desta tela). */
  function launch(i: number, vx: number, vy: number) {
    const d = dice.current?.[i];
    if (!d || !['idle', 'held', 'shaking'].includes(d.state)) return;
    let speed = Math.hypot(vx, vy);
    if (speed < 160) {
      // Só um toque: joga para o meio da mesa.
      vx = rand(-260, 260);
      vy = (i === 0 ? -1 : 1) * rand(750, 950);
      speed = Math.hypot(vx, vy);
    }
    const max = 1800;
    const min = 420;
    const k = speed > max ? max / speed : speed < min ? min / speed : 1;
    Object.assign(d, {
      vx: vx * k,
      vy: vy * k,
      vz: 300 + Math.min(speed, max) * 0.18,
      z: Math.max(d.z, 10),
      wz: rand(-500, 500),
      state: 'rolling',
      thrownAt: performance.now(),
    });
    setStatus(i, 'rolling');
    // O seu lançamento vai para o oponente (em frações da mesa, que muda de tamanho entre telas).
    if (i === 0 && ctrl[0] === 'user') {
      const { W, H } = size();
      remote?.send(d.vx / W, d.vy / H);
    }
    ensureLoop();
  }

  function shake(i: number) {
    const d = dice.current?.[i];
    if (!d || d.state !== 'idle') return;
    d.state = 'shaking';
    d.shakeUntil = performance.now() + 850;
    setStatus(i, 'shaking');
    ensureLoop();
  }

  const skip = () => {
    // Pulando sem jogar: o oponente ainda vê um dado rolar do seu lado.
    if (ctrl[0] === 'user' && statusRef.current[0] === 'idle') remote?.send(rand(-0.6, 0.6), -rand(2.4, 3));
    onDone();
  };

  // ------------------------------------------------------------ gesto: segurar, chacoalhar e soltar

  const local = (e: ReactPointerEvent) => {
    const r = tray.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ctrl[0] !== 'user' || statusRef.current[0] !== 'idle' || !dice.current) return;
    e.preventDefault();
    tray.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    samples.current = [{ ...p, t: performance.now() }];
    const d = dice.current[0];
    d.state = 'held';
    d.z = 30;
    moveHeld(p.x, p.y);
    setStatus(0, 'held');
  };

  const moveHeld = (x: number, y: number) => {
    const d = dice.current?.[0];
    if (!d) return;
    const { W, H } = size();
    const nx = Math.max(R, Math.min(W - R, x));
    const ny = Math.max(R, Math.min(H - R, y));
    // Chacoalhando na mão: o dado gira conforme o dedo anda.
    d.rx -= (ny - d.y) * ROLL * 1.4;
    d.ry += (nx - d.x) * ROLL * 1.4;
    d.rz += (nx - d.x) * 0.6;
    d.x = nx;
    d.y = ny;
    d.z = 30 + Math.sin(performance.now() / 70) * 4;
    draw();
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (statusRef.current[0] !== 'held') return;
    const p = local(e);
    const now = performance.now();
    samples.current.push({ ...p, t: now });
    samples.current = samples.current.filter((s) => now - s.t < 90);
    moveHeld(p.x, p.y);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (statusRef.current[0] !== 'held') return;
    const p = local(e);
    const now = performance.now();
    const s = samples.current.find((x) => now - x.t < 90) ?? samples.current[0];
    const dt = Math.max(0.016, (now - (s?.t ?? now)) / 1000);
    const vx = s ? (p.x - s.x) / dt : 0;
    const vy = s ? (p.y - s.y) / dt : 0;
    launch(0, vx, vy);
  };

  const name = (p: PlayerId) => (human !== null && p === human ? 'Você' : state.players[p].name);
  const first = state.firstPlayer;
  const banner = !result
    ? null
    : choosing
      ? iWon
        ? 'Você venceu!'
        : `${state.players[winner].name} venceu!`
      : human !== null && first === human
        ? 'Você começa!'
        : `${state.players[first].name} começa!`;

  /** Texto sobre a vez de cada dado. */
  const turnHint = (i: number): string | null => {
    const n = state.players[seats[i]].name;
    switch (status[i]) {
      case 'idle':
        if (ctrl[i] === 'user') {
          // O oponente jogou antes (online): agora é a sua vez.
          const o = state.players[seats[1]].name;
          if (status[1] === 'done') return `${o} tirou ${values[seats[1]]}. Sua vez: segure o dado e jogue!`;
          if (status[1] === 'rolling') return `${o} jogou! Agora é a sua vez.`;
          return 'Segure o dado, chacoalhe e solte para jogar';
        }
        if (ctrl[i] === 'remote') return `Aguardando ${n} jogar o dado…`;
        return i === 1 && status[0] !== 'done' ? null : `Vez de ${n}…`;
      case 'held':
        return 'Solte para jogar!';
      case 'shaking':
        return `${n} está chacoalhando o dado…`;
      case 'rolling':
        return ctrl[i] === 'user' ? 'Rolando…' : `${n} jogou!`;
      default:
        return null;
    }
  };
  const hint = result
    ? choosing
      ? iWon
        ? 'Você escolhe: quer jogar primeiro ou segundo?'
        : `${state.players[winner].name} está escolhendo quem começa…`
      : `${name(winner)} escolheu jogar ${first === winner ? 'primeiro' : 'segundo'}.`
    : status[0] === 'done' || (status[1] !== 'idle' && status[0] !== 'held' && ctrl[0] !== 'user')
      ? turnHint(1)
      : (turnHint(0) ?? turnHint(1));

  const side = (i: number) => {
    const p = seats[i];
    return (
      <div className={['dice-player', result && p === winner ? 'winner' : '', result && p !== winner ? 'loser' : ''].join(' ')}>
        <div className="dice-leader">
          <CardView state={state} uid={state.players[p].leader.uid} />
        </div>
        <div className="dice-name">{name(p)}</div>
        <div className={['dice-value', status[i] === 'done' ? 'shown' : ''].join(' ')}>{status[i] === 'done' ? values[p] : '–'}</div>
      </div>
    );
  };

  const busy = ctrl[0] !== 'user' || (status[0] !== 'idle' && status[0] !== 'held');
  return (
    <div className="modal-backdrop dice-backdrop">
      <div className="modal-card dice-card">
        <div className="modal-kicker">Sorteio inicial</div>
        <div className="dice-versus">
          {side(0)}
          <span className="dice-vs">VS</span>
          {side(1)}
        </div>
        <div
          ref={tray}
          className={['dice-tray', status[0] === 'held' ? 'is-held' : '', busy ? 'is-busy' : ''].join(' ')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {seats.map((p, i) => (
            <div
              key={p}
              ref={(el) => (dieEls.current[i] = el)}
              className={['die', i === 0 ? 'mine' : 'theirs', result && p === winner ? 'winner' : ''].join(' ')}
            >
              <div className="die-shadow" />
              <div className="die-cube">
                {/* Miolo: preenche as quinas arredondadas do cubo com a cor do dado. */}
                <div className="die-core">
                  {FACES.map((v) => (
                    <div key={v} className={`die-side f${v}`} />
                  ))}
                </div>
                {FACES.map((v) => (
                  <div key={v} className={`die-side die-face f${v}`}>
                    {v === 1 ? <span className="die-skull" role="img" aria-label="1" /> : <span className={`die-num${v === 6 ? ' six' : ''}`}>{v}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {ctrl[0] === 'user' && status[0] === 'idle' && <div className="dice-hand" aria-hidden="true">☝</div>}
          {banner && <div className="dice-result">{banner}</div>}
        </div>
        <p className="dice-hint muted small">{hint || ' '}</p>
        <div className="btn-row center">
          {result && choosing && iWon ? (
            <>
              <button className="btn primary big" onClick={() => onChoose(true)}>
                Jogar primeiro
              </button>
              <button className="btn big" onClick={() => onChoose(false)}>
                Jogar segundo
              </button>
            </>
          ) : result ? (
            <button className="btn primary big" onClick={onDone}>
              Continuar
            </button>
          ) : (
            <>
              {ctrl[0] === 'user' && (
                <button className="btn primary" disabled={status[0] !== 'idle'} onClick={() => launch(0, 0, 0)}>
                  🎲 Jogar dados
                </button>
              )}
              <button className="btn" onClick={skip}>
                Pular
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
