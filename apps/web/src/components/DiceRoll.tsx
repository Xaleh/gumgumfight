// Sorteio inicial com dados 3D: o jogador segura o dado com o dedo (ou o mouse),
// chacoalha e solta para jogá-lo na mesa; o do oponente é jogado junto.
//
// O vencedor do sorteio já foi definido pelo motor (state.rollWinner, a partir da
// seed); os dados só mostram esse resultado: o valor de cada um é escolhido para
// que o vencedor tire o número maior. Depois, o vencedor escolhe se joga primeiro
// ou segundo (a escolha é uma ação do motor, gravada no replay).

import type { GameState, PlayerId } from '@gumgum/engine';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CardView } from './CardView';

const SIZE = 52;
const R = SIZE / 2;
/** Graus de giro por pixel rolado (dado rolando sem deslizar). */
const ROLL = 360 / (Math.PI * SIZE);
/** Rotação (x, y) do cubo que deixa cada face virada para cima (para a tela). */
const FACE: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
/** Casas da grade 3×3 com pinta, por valor. */
const PIPS: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

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
  state: 'idle' | 'held' | 'rolling' | 'settling' | 'done';
  settle?: { t: number; from: [number, number, number]; to: [number, number, number] };
}

type Phase = 'ready' | 'held' | 'rolling' | 'result';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function DiceRoll({
  state,
  human,
  onResult,
  onChoose,
  onDone,
}: {
  state: GameState;
  /** null: ninguém joga (espectador, bot x bot): os dados são lançados sozinhos. */
  human: PlayerId | null;
  /** Os dados pararam (o bot pode fazer a escolha dele). */
  onResult: () => void;
  /** O jogador venceu e escolheu: true = jogar primeiro. */
  onChoose: (first: boolean) => void;
  onDone: () => void;
}) {
  const me: PlayerId = human ?? 0;
  const opp = (me === 0 ? 1 : 0) as PlayerId;
  const winner = state.rollWinner ?? state.firstPlayer;
  /** O vencedor ainda não escolheu se joga primeiro ou segundo. */
  const choosing = state.pending?.kind === 'chooseFirst';
  const iWon = human !== null && winner === human;
  // O vencedor tira o maior número (sem empate).
  const values = useMemo(() => {
    const hi = 2 + Math.floor(Math.random() * 5);
    const lo = 1 + Math.floor(Math.random() * (hi - 1));
    return { [winner]: hi, [winner === 0 ? 1 : 0]: lo } as Record<PlayerId, number>;
  }, [winner]);

  const [phase, setPhase] = useState<Phase>('ready');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const tray = useRef<HTMLDivElement>(null);
  const dieEls = useRef<(HTMLDivElement | null)[]>([null, null]);
  const dice = useRef<[Die, Die] | null>(null);
  const samples = useRef<{ x: number; y: number; t: number }[]>([]);
  const raf = useRef(0);
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
    });
    dice.current = [make(me, W * 0.4, H * 0.74), make(opp, W * 0.6, H * 0.26)];
    draw();
    // Sem jogador: lança sozinho.
    if (human === null) {
      const t = setTimeout(() => throwDice(rand(-250, 250), -rand(700, 1000)), 700);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  useEffect(() => {
    if (phase === 'result') resultRef.current();
  }, [phase]);

  // Depois da escolha, segue sozinho em pouco tempo.
  useEffect(() => {
    if (phase !== 'result' || choosing) return;
    const t = setTimeout(() => doneRef.current(), 2400);
    return () => clearTimeout(t);
  }, [phase, choosing]);

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

  function step(dt: number) {
    const ds = dice.current!;
    const { W, H } = size();
    const lo = R + 9;
    for (const d of ds) {
      if (d.state === 'rolling') {
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
        }
      }
    }
    // Um dado bate no outro.
    const [a, b] = ds;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < SIZE * 1.05 && a.z < SIZE && b.z < SIZE && a.state === 'rolling' && b.state === 'rolling') {
      const nx = dx / dist;
      const ny = dy / dist;
      const push = (SIZE * 1.05 - dist) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const va = a.vx * nx + a.vy * ny;
      const vb = b.vx * nx + b.vy * ny;
      if (va - vb > 0) {
        const j = (va - vb) * 0.85;
        a.vx -= j * nx;
        a.vy -= j * ny;
        b.vx += j * nx;
        b.vy += j * ny;
      }
    }
  }

  function loop(started: number) {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const ds = dice.current!;
      // Segurança: depois de alguns segundos, assenta à força.
      if (now - started > 2800) {
        for (const d of ds) if (d.state === 'rolling') {
          d.vx = d.vy = d.vz = 0;
          d.z = 0;
        }
      }
      step(dt);
      draw();
      if (ds.every((d) => d.state === 'done')) {
        setPhase('result');
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  /** Lança os dois dados: o seu com a velocidade do gesto; o do oponente, de cima para baixo. */
  function throwDice(vx: number, vy: number) {
    const ds = dice.current;
    if (!ds || phaseRef.current === 'rolling' || phaseRef.current === 'result') return;
    const [mine, theirs] = ds;
    let speed = Math.hypot(vx, vy);
    if (speed < 160) {
      // Só um toque: joga para cima, para o meio da mesa.
      vx = rand(-260, 260);
      vy = -rand(750, 950);
      speed = Math.hypot(vx, vy);
    }
    const max = 1800;
    const min = 420;
    const k = speed > max ? max / speed : speed < min ? min / speed : 1;
    Object.assign(mine, { vx: vx * k, vy: vy * k, vz: 300 + Math.min(speed, max) * 0.18, z: Math.max(mine.z, 10), wz: rand(-500, 500), state: 'rolling' });
    Object.assign(theirs, {
      vx: rand(-320, 320),
      vy: rand(650, 950),
      vz: rand(380, 520),
      z: 12,
      wz: rand(-500, 500),
      state: 'rolling',
    });
    setPhase('rolling');
    cancelAnimationFrame(raf.current);
    loop(performance.now());
  }

  // ------------------------------------------------------------ gesto: segurar, chacoalhar e soltar

  const local = (e: ReactPointerEvent) => {
    const r = tray.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (human === null || phase !== 'ready' || !dice.current) return;
    e.preventDefault();
    tray.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    samples.current = [{ ...p, t: performance.now() }];
    const d = dice.current[0];
    d.state = 'held';
    d.z = 30;
    moveHeld(p.x, p.y);
    setPhase('held');
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
    if (phaseRef.current !== 'held') return;
    const p = local(e);
    const now = performance.now();
    samples.current.push({ ...p, t: now });
    samples.current = samples.current.filter((s) => now - s.t < 90);
    moveHeld(p.x, p.y);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'held') return;
    const p = local(e);
    const now = performance.now();
    const s = samples.current.find((x) => now - x.t < 90) ?? samples.current[0];
    const dt = Math.max(0.016, (now - (s?.t ?? now)) / 1000);
    const vx = s ? (p.x - s.x) / dt : 0;
    const vy = s ? (p.y - s.y) / dt : 0;
    throwDice(vx, vy);
  };

  const name = (p: PlayerId) => (human !== null && p === human ? 'Você' : state.players[p].name);
  const first = state.firstPlayer;
  const result =
    phase !== 'result'
      ? null
      : choosing
        ? iWon
          ? 'Você venceu!'
          : `${state.players[winner].name} venceu!`
        : human !== null && first === human
          ? 'Você começa!'
          : `${state.players[first].name} começa!`;

  const hint =
    phase === 'result'
      ? choosing
        ? iWon
          ? 'Você escolhe: quer jogar primeiro ou segundo?'
          : `${state.players[winner].name} está escolhendo quem começa…`
        : `${name(winner)} escolheu jogar ${first === winner ? 'primeiro' : 'segundo'}.`
      : human === null
      ? 'Sorteando quem começa…'
      : phase === 'ready'
        ? 'Segure o dado, chacoalhe e solte para jogar'
        : phase === 'held'
          ? 'Solte para jogar!'
          : phase === 'rolling'
            ? 'Rolando…'
            : '';

  const side = (p: PlayerId) => (
    <div className={['dice-player', phase === 'result' && p === winner ? 'winner' : '', phase === 'result' && p !== winner ? 'loser' : ''].join(' ')}>
      <div className="dice-leader">
        <CardView state={state} uid={state.players[p].leader.uid} />
      </div>
      <div className="dice-name">{name(p)}</div>
      <div className="dice-value">{phase === 'result' ? values[p] : '–'}</div>
    </div>
  );

  return (
    <div className="modal-backdrop dice-backdrop">
      <div className="modal-card dice-card">
        <div className="modal-kicker">Sorteio inicial</div>
        <div className="dice-versus">
          {side(me)}
          <span className="dice-vs">VS</span>
          {side(opp)}
        </div>
        <div
          ref={tray}
          className={['dice-tray', `is-${phase}`, human === null ? 'auto' : ''].join(' ')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {[me, opp].map((p, i) => (
            <div
              key={p}
              ref={(el) => (dieEls.current[i] = el)}
              className={['die', i === 0 ? 'mine' : 'theirs', phase === 'result' && p === winner ? 'winner' : ''].join(' ')}
            >
              <div className="die-shadow" />
              <div className="die-cube">
                {[1, 6, 3, 4, 2, 5].map((v) => (
                  <div key={v} className={`die-face f${v}`}>
                    {PIPS[v].map((c) => (
                      <span key={c} className="pip" style={{ gridArea: `${Math.ceil(c / 3)} / ${((c - 1) % 3) + 1}` }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {phase === 'ready' && human !== null && <div className="dice-hand" aria-hidden="true">☝</div>}
          {result && <div className="dice-result">{result}</div>}
        </div>
        <p className="dice-hint muted small">{hint || ' '}</p>
        <div className="btn-row center">
          {phase === 'result' && choosing && iWon ? (
            <>
              <button className="btn primary big" onClick={() => onChoose(true)}>
                Jogar primeiro
              </button>
              <button className="btn big" onClick={() => onChoose(false)}>
                Jogar segundo
              </button>
            </>
          ) : phase === 'result' ? (
            <button className="btn primary big" onClick={onDone}>
              Continuar
            </button>
          ) : (
            <>
              {human !== null && (
                <button className="btn primary" disabled={phase !== 'ready'} onClick={() => throwDice(0, 0)}>
                  🎲 Jogar dados
                </button>
              )}
              <button className="btn" onClick={onDone}>
                Pular
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
