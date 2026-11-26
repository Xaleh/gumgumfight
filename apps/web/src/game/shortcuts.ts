// Atalhos de teclado da mesa (opção "Atalhos de teclado", desligada por padrão): que tecla vira que atalho e
// quando o teclado é da mesa. O que cada atalho faz fica em `components/table/useTableShortcuts.ts` (`onShortcut`); a lista para
// quem joga, em `components/ShortcutsHelp.tsx`.

import { useEffect, useRef } from 'react';

/** Personagens em campo, da esquerda para a direita (as teclas ficam lado a lado no teclado). */
export const CHARACTER_KEYS = ['q', 'w', 'e', 'r', 't'] as const;

export type Shortcut =
  /** Espaço: encerra o turno. */
  | { kind: 'endTurn' }
  /** Enter: o botão de confirmar que está na tela. */
  | { kind: 'confirm' }
  /** Esc: fecha o que está aberto, sai do modo de ataque ou de DON!! e desfaz a ação em andamento. */
  | { kind: 'cancel' }
  /** 1 a 9 e 0 (= 10): marca essa quantidade de DON!! ativos; numa pergunta com uma lista de opções, escolhe a opção. */
  | { kind: 'number'; n: number }
  /** Q W E R T (o Personagem dessa posição) e L (o Líder); com Shift, a carta do oponente. */
  | { kind: 'card'; slot: number | 'leader'; opponent: boolean }
  /** D: o seu descarte; O: o do oponente. */
  | { kind: 'trash'; opponent: boolean }
  /** A: ataca com a carta escolhida. */
  | { kind: 'attack' }
  /** H: usa a habilidade da carta escolhida. */
  | { kind: 'ability' }
  /** X: anexa todos os DON!! ativos. */
  | { kind: 'attachAll' }
  /** M: "Ver a mesa" numa pergunta que tem esse botão (recolhe a pergunta); de novo, volta à pergunta. */
  | { kind: 'peek' };

/** O que os atalhos leem de um `KeyboardEvent`. */
export interface KeyPress {
  key: string;
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * A letra ou o número da tecla. Vale o que o teclado escreve (`key`); quando isso não é uma letra de A a Z nem
 * um número (os números do AZERTY sem Shift, um teclado cirílico ou japonês, o Shift nos números), vale a
 * posição da tecla no teclado (`code`).
 */
function character(e: KeyPress): string {
  const typed = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (/^[a-z0-9]$/.test(typed)) return typed;
  const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d))$/.exec(e.code);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').toLowerCase();
}

/** O atalho de uma tecla, ou `null` quando ela não é atalho (com Ctrl, Alt ou ⌘ a tecla é do navegador). */
export function readShortcut(e: KeyPress): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Escape') return { kind: 'cancel' };
  if (e.key === 'Enter') return { kind: 'confirm' };
  if (e.key === ' ' || e.code === 'Space') return { kind: 'endTurn' };
  const ch = character(e);
  if (!ch) return null;
  if (ch >= '0' && ch <= '9') return { kind: 'number', n: ch === '0' ? 10 : Number(ch) };
  const opponent = Boolean(e.shiftKey);
  const slot = (CHARACTER_KEYS as readonly string[]).indexOf(ch);
  if (slot >= 0) return { kind: 'card', slot, opponent };
  switch (ch) {
    case 'l':
      return { kind: 'card', slot: 'leader', opponent };
    case 'd':
      return { kind: 'trash', opponent: false };
    case 'o':
      return { kind: 'trash', opponent: true };
    case 'a':
      return { kind: 'attack' };
    case 'h':
      return { kind: 'ability' };
    case 'x':
      return { kind: 'attachAll' };
    case 'm':
      return { kind: 'peek' };
    default:
      return null;
  }
}

/** A pessoa está escrevendo (chat, apelido, relato): a tecla é do campo de texto. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  // Caixas de marcar e botões de opção não recebem texto.
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type);
}

/**
 * A pessoa anda pela tela com Tab: aí Enter e Espaço apertam o botão ou link em foco, como em qualquer página.
 * Depois de um clique do mouse o foco também fica no botão clicado, e aí as teclas são atalhos. O
 * `:focus-visible` não separa os dois casos (passa a valer assim que uma tecla é apertada), então a conta é
 * feita aqui: vale o Tab apertado depois do último clique ou toque.
 */
let tabbing = false;
let watching = false;
function watchTab() {
  if (watching) return;
  watching = true;
  window.addEventListener('pointerdown', () => (tabbing = false), true);
  window.addEventListener('keydown', (e) => e.key === 'Tab' && (tabbing = true), true);
}

function focusedControl(target: EventTarget | null): boolean {
  return tabbing && target instanceof HTMLElement && target.matches('button, a[href], input, summary, [role="button"], [tabindex]');
}

/**
 * Liga os atalhos enquanto `active`. `onShortcut` devolve `true` quando o atalho fez algo.
 *
 * `press`: Enter e Espaço são da mesa (há alguém jogando). Aí eles nunca apertam o botão em que o mouse clicou
 * por último: sem isso, um Enter sem nada a confirmar repetia o último clique (por exemplo "Encerrar turno").
 * Sem `press` (replay, quem assiste), essas duas teclas ficam como estão.
 */
export function useShortcuts(active: boolean, press: boolean, onShortcut: (s: Shortcut) => boolean) {
  const handler = useRef(onShortcut);
  handler.current = onShortcut;
  useEffect(watchTab, []);
  useEffect(() => {
    if (!active) return;
    // O botão em foco é apertado pelo Espaço só ao soltar a tecla: a soltura das teclas tratadas também é segurada.
    const held = new Set<string>();
    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const s = readShortcut(e);
      if (!s || typing(e.target)) return;
      const pressKey = s.kind === 'confirm' || s.kind === 'endTurn';
      if (pressKey) {
        if (!press || focusedControl(e.target)) return;
        e.preventDefault();
        held.add(e.code);
      }
      // Tecla segurada: o atalho vale uma vez só.
      if (e.repeat) return;
      if (handler.current(s) && s.kind !== 'cancel') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (held.delete(e.code)) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [active, press]);
}
