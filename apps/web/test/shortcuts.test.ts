import { describe, expect, it } from 'vitest';
import { type KeyPress, readShortcut } from '../src/game/shortcuts';

/** Uma tecla de letra num teclado QWERTY. */
const letter = (ch: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key: ch, code: `Key${ch.toUpperCase()}`, ...extra });

describe('atalhos de teclado da mesa', () => {
  it('Espaço encerra o turno, Enter confirma e Esc cancela', () => {
    expect(readShortcut({ key: ' ', code: 'Space' })).toEqual({ kind: 'endTurn' });
    expect(readShortcut({ key: 'Enter', code: 'Enter' })).toEqual({ kind: 'confirm' });
    expect(readShortcut({ key: 'Enter', code: 'NumpadEnter' })).toEqual({ kind: 'confirm' });
    expect(readShortcut({ key: 'Escape', code: 'Escape' })).toEqual({ kind: 'cancel' });
  });

  it('os números (0 = 10) valem também no teclado numérico', () => {
    expect(readShortcut({ key: '1', code: 'Digit1' })).toEqual({ kind: 'number', n: 1 });
    expect(readShortcut({ key: '9', code: 'Digit9' })).toEqual({ kind: 'number', n: 9 });
    expect(readShortcut({ key: '0', code: 'Digit0' })).toEqual({ kind: 'number', n: 10 });
    expect(readShortcut({ key: '4', code: 'Numpad4' })).toEqual({ kind: 'number', n: 4 });
  });

  it('Q W E R T são os Personagens da esquerda para a direita e L o Líder; com Shift, os do oponente', () => {
    expect(['q', 'w', 'e', 'r', 't'].map((ch) => readShortcut(letter(ch)))).toEqual(
      [0, 1, 2, 3, 4].map((slot) => ({ kind: 'card', slot, opponent: false })),
    );
    expect(readShortcut(letter('l'))).toEqual({ kind: 'card', slot: 'leader', opponent: false });
    expect(readShortcut(letter('W', { shiftKey: true }))).toEqual({ kind: 'card', slot: 1, opponent: true });
    expect(readShortcut(letter('L', { shiftKey: true }))).toEqual({ kind: 'card', slot: 'leader', opponent: true });
  });

  it('D e O abrem os descartes; A ataca, H usa a habilidade e X anexa todos os DON!!', () => {
    expect(readShortcut(letter('d'))).toEqual({ kind: 'trash', opponent: false });
    expect(readShortcut(letter('o'))).toEqual({ kind: 'trash', opponent: true });
    expect(readShortcut(letter('a'))).toEqual({ kind: 'attack' });
    expect(readShortcut(letter('h'))).toEqual({ kind: 'ability' });
    expect(readShortcut(letter('x'))).toEqual({ kind: 'attachAll' });
  });

  it('Caps Lock ligado não muda a tecla', () => {
    expect(readShortcut(letter('A'))).toEqual({ kind: 'attack' });
    expect(readShortcut(letter('Q'))).toEqual({ kind: 'card', slot: 0, opponent: false });
  });

  it('com Ctrl, Alt ou ⌘ a tecla é do navegador', () => {
    expect(readShortcut(letter('r', { ctrlKey: true }))).toBeNull();
    expect(readShortcut(letter('w', { metaKey: true }))).toBeNull();
    expect(readShortcut(letter('d', { altKey: true }))).toBeNull();
  });

  it('teclas sem atalho ficam de fora', () => {
    expect(readShortcut(letter('z'))).toBeNull();
    expect(readShortcut({ key: 'Tab', code: 'Tab' })).toBeNull();
    expect(readShortcut({ key: 'F5', code: 'F5' })).toBeNull();
    expect(readShortcut({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBeNull();
  });

  it('quando a tecla não escreve letra de A a Z nem número, vale a posição dela no teclado', () => {
    // AZERTY: a fileira dos números escreve "&é\"'(" sem Shift.
    expect(readShortcut({ key: '&', code: 'Digit1' })).toEqual({ kind: 'number', n: 1 });
    // Shift + número num QWERTY.
    expect(readShortcut({ key: '#', code: 'Digit3', shiftKey: true })).toEqual({ kind: 'number', n: 3 });
    // Teclado cirílico: a tecla do Q escreve "й".
    expect(readShortcut({ key: 'й', code: 'KeyQ' })).toEqual({ kind: 'card', slot: 0, opponent: false });
    // Onde a tecla escreve uma letra latina, vale a letra (AZERTY: a tecla física do Q escreve "a").
    expect(readShortcut({ key: 'a', code: 'KeyQ' })).toEqual({ kind: 'attack' });
  });
});
