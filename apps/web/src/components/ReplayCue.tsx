// Clique/seleção do jogador no replay: antes de cada ação do roteiro ser aplicada, a mesa mostra
// o que ele tocou (contorno nas cartas e nos DON!! envolvidos, na ordem dos cliques), um toque
// animado no momento em que a ação acontece e uma legenda com as palavras do botão ou da carta
// ("Luffy: Atacar Zoro com Nami", "Nami: Não usar Counter"). Quem audita ou assiste vê a
// decisão, e não só o resultado dela.
//
// Pausado (passo a passo), o contorno e a legenda ficam parados em "Próxima ação": dá para ver o
// que vai ser clicado antes de avançar com ▶|.

import type { PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { motionWait } from '../game/motion';
import type { CueTarget, ReplayCue as Cue } from '../game/replayCue';

interface Tap {
  id: number;
  x: number;
  y: number;
}
interface Pill {
  x: number;
  y: number;
  /** A legenda fica acima do ponto (senão, abaixo). */
  above: boolean;
  /** Sem elemento na mesa: a legenda fica do lado de quem agiu, sem a seta. */
  loose: boolean;
}

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/** O elemento da mesa que o jogador tocou (null se a carta não está à vista). */
function findTarget(mat: Element, t: CueTarget): HTMLElement | null {
  if ('card' in t) {
    const u = esc(t.card);
    return (
      mat.querySelector<HTMLElement>(`[data-hand-uid="${u}"] .card`) ??
      mat.querySelector<HTMLElement>(`.field-card .card[data-uid="${u}"]`) ??
      mat.querySelector<HTMLElement>(`.pile .card[data-uid="${u}"]`)
    );
  }
  if ('attached' in t) {
    const u = esc(t.attached);
    return mat.querySelector<HTMLElement>(`.attached-don[data-uid="${u}"]`) ?? mat.querySelector<HTMLElement>(`.field-card .card[data-uid="${u}"]`);
  }
  return mat.querySelector<HTMLElement>(`[data-anchor="don-${t.don}"] > .don-card:not(.rested)`);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Onde a legenda fica: junto do primeiro elemento tocado, ou do lado da mão de quem agiu. */
function placePill(root: Element, el: HTMLElement | null, player: PlayerId, bottom: PlayerId): Pill | null {
  const area = root.getBoundingClientRect();
  const midY = area.top + area.height / 2;
  const x = (cx: number) => clamp(cx - area.left, 180, Math.max(180, area.width - 180));
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) {
      const above = r.top + r.height / 2 > midY;
      return { x: x(r.left + r.width / 2), y: (above ? r.top - 10 : r.bottom + 10) - area.top, above, loose: false };
    }
  }
  const hand = root.querySelector(`.mat [data-anchor="hand-${player}"]`);
  const r = hand?.getBoundingClientRect();
  if (r && (r.width || r.height)) {
    const above = player === bottom;
    return { x: x(r.left + r.width / 2), y: (above ? r.top - 8 : r.bottom + 8) - area.top, above, loose: true };
  }
  return { x: area.width / 2, y: midY - area.top, above: false, loose: true };
}

let seq = 0;

export function ReplayCue({
  cue,
  pos,
  bottom,
  dueAt,
  playing,
  speed,
  animate,
}: {
  cue: Cue;
  /** Posição da ação no roteiro (0-based). */
  pos: number;
  /** Quem está embaixo na mesa. */
  bottom: PlayerId;
  /** Modo automático: quando (performance.now()) a ação será aplicada; null se nada está agendado. */
  dueAt: () => number | null;
  playing: boolean;
  speed: number;
  /** Animações ligadas: toque e pulso do contorno. Desligadas, só o contorno e a legenda. */
  animate: boolean;
}) {
  // Os toques sobrevivem à troca de ação (a onda termina já com a mesa nova); a legenda não.
  const [taps, setTaps] = useState<Tap[]>([]);
  const [pill, setPill] = useState<Pill | null>(null);

  useEffect(() => {
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    setPill(null);
    const root = document.querySelector('.board-col');
    const mat = root?.querySelector('.mat');
    if (!root || !mat) return;
    const els = cue.targets.map((t) => findTarget(mat, t));
    const marked = els.filter((e): e is HTMLElement => e !== null);
    marked.forEach((el, i) => {
      el.setAttribute('data-replay-pick', animate ? 'pulse' : 'still');
      if (marked.length > 1) el.setAttribute('data-replay-order', String(i + 1));
    });
    const show = () => setPill(placePill(root, els.find((e) => e) ?? null, cue.player, bottom));

    // Os efeitos dos filhos rodam antes do do pai: espera o useGame agendar a ação para saber quando ela cai.
    later(() => {
      // Cartas ainda voando (a jogada anterior): a legenda e o toque esperam elas pousarem.
      const lead = motionWait();
      later(show, lead);
      // As cartas da mão deslizam para o lugar (transição de 0,25 s): mede de novo depois.
      later(show, lead + 320);
      const due = playing ? dueAt() : null;
      if (due === null || !animate || !marked.length) return;
      // Tempo até a ação cair: o último toque termina perto desse instante (a onda dura 0,6 s).
      const left = Math.max(lead, due - performance.now());
      // Vários toques (DON!! e depois a carta; atacante e depois o alvo): espaçados dentro do tempo que há.
      const gap = marked.length > 1 ? Math.min(300, Math.max(120, (left - lead) / (marked.length + 0.5))) : 0;
      const first = Math.max(lead, left - 420 - (marked.length - 1) * gap);
      marked.forEach((el, i) => {
        later(() => {
          const r = el.getBoundingClientRect();
          const area = root.getBoundingClientRect();
          const id = ++seq;
          setTaps((t) => [...t, { id, x: r.left + r.width / 2 - area.left, y: r.top + r.height / 2 - area.top }]);
          el.setAttribute('data-replay-tap', '');
          later(() => el.removeAttribute('data-replay-tap'), 340);
          window.setTimeout(() => setTaps((t) => t.filter((x) => x.id !== id)), 700);
        }, first + i * gap);
      });
    }, 0);

    const onResize = () => show();
    window.addEventListener('resize', onResize);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
      for (const el of marked) {
        el.removeAttribute('data-replay-pick');
        el.removeAttribute('data-replay-order');
        el.removeAttribute('data-replay-tap');
      }
    };
  }, [cue, bottom, dueAt, playing, speed, animate]);

  return (
    <div className="replay-cue-layer" aria-hidden="true">
      {taps.map((t) => (
        <span key={t.id} className="replay-tap" style={{ left: t.x, top: t.y }}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M7 3.5v12.2l3-2.6 2.3 5.4 2.6-1.1-2.3-5.3 4.1-.4z" fill="#fff" stroke="#123" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
      ))}
      {pill && (
        <div className={['replay-cue-pill', pill.above ? 'above' : 'below', pill.loose ? 'loose' : ''].join(' ')} style={{ left: pill.x, top: pill.y }}>
          <small>{playing ? `Ação ${pos + 1}` : 'Próxima ação'}</small>
          <div>
            <b>{cue.who}</b>: {cue.title}
          </div>
          {cue.sub && <em>{cue.sub}</em>}
        </div>
      )}
    </div>
  );
}
