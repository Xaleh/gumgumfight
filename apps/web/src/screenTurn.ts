// A tela virando como página: entrar numa seção a partir do menu (Aprender, Montar decks, Torneios,
// Estatísticas) e voltar dela. É a mesma dobra do gibi das lições (pageTurn.ts), curta e sem o dedo.
// No celular a tela inteira é a folha; em tela larga a tela é um livro aberto e só a metade direita vira.
//
// A dobra usa cópias paradas da tela (o que estava e, onde a folha cobre, o que vai ficar), numa camada
// por cima do app. Onde a folha só descobre a tela nova, não há cópia: aparece a tela de verdade, que
// continua carregando por baixo. Quem chama decide quando (App.tsx: só com as animações completas).

import { flushSync } from 'react-dom';
import { PageTurn } from './pageTurn';

/** Mesma largura em que o gibi das lições abre em duas páginas. */
const WIDE = 1000;
/** Duração da virada (ms): página única e livro aberto. */
const MS = { single: 460, spread: 520 };

let running: { turn: PageTurn; layer: HTMLElement; timer: number } | null = null;

function finish() {
  if (!running) return;
  clearTimeout(running.timer);
  running.turn.destroy();
  running.layer.remove();
  running = null;
}

const div = (cls: string, child?: HTMLElement) => {
  const d = document.createElement('div');
  d.className = cls;
  if (child) d.append(child);
  return d;
};

/**
 * Cópia do que está na tela agora, da coluna `x` até `x + w`. A cópia do app fica dentro de uma caixa do
 * tamanho da tela, rolada como a página: o que é fixo na tela continua no lugar e o que gruda no topo, também.
 */
function shot(x: number, w: number, W: number, H: number): HTMLElement {
  const app = document.getElementById('root')!.cloneNode(true) as HTMLElement;
  app.removeAttribute('id');
  app.className = 'screen-turn-app';
  const scroll = div('screen-turn-scroll', app);
  scroll.dataset.gibiScroll = String(window.scrollY);
  const view = div('screen-turn-view', scroll);
  Object.assign(view.style, { left: `${-x}px`, width: `${W}px`, height: `${H}px` });
  const frame = div('screen-turn-frame', view);
  Object.assign(frame.style, { width: `${w}px`, height: `${H}px` });
  return frame;
}

/** Dá para virar agora? Não com a aba escondida (a animação não andaria) nem com o sistema pedindo menos movimento. */
export function canTurnScreen() {
  return !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && Boolean(document.getElementById('root'));
}

/**
 * Faz `update` (que troca a tela) com a virada: `dir` 1 = para a frente (a tela de agora é a folha que sai),
 * −1 = para trás (a tela nova é a folha que volta). Chamar só de um clique: a troca é feita na hora.
 */
export function turnScreen(dir: 1 | -1, update: () => void) {
  finish();
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const spread = W >= WIDE;
  const pageW = spread ? W / 2 : W;
  const right = () => shot(spread ? pageW : 0, pageW, W, H);
  const left = () => (spread ? shot(0, pageW, W, H) : null);
  // A folha que vira é sempre a da tela de baixo: a de agora (para a frente) ou a nova (para trás).
  let sheets;
  if (dir > 0) {
    const before = { leaf: right(), left: left() };
    flushSync(update);
    sheets = { ...before, back: left(), under: null };
  } else {
    const before = { under: right(), back: left() };
    flushSync(update);
    sheets = { ...before, leaf: right(), left: null };
  }
  const layer = div('screen-turn');
  document.body.append(layer);
  const turn = new PageTurn(layer, { left: 0, top: 0, pageW, height: H, leafH: H, spread }, sheets, dir, H * 0.82, true);
  const ms = spread ? MS.spread : MS.single;
  // Se a animação não andar (aba escondida no meio do caminho), a camada sai do mesmo jeito.
  running = { turn, layer, timer: window.setTimeout(finish, ms + 600) };
  void turn.glide(true, true, ms).then(() => running?.turn === turn && finish());
}
