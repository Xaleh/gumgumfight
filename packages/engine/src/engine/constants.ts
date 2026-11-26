// Tamanhos e limites do jogo, o erro de ação ilegal e os tipos dos frames da pilha.

import type { FieldCard, Frame, PlayerId } from '../types';

export const MAX_CHARACTERS = 5;
export const DON_DECK_SIZE = 10;
export const DECK_SIZE = 50;
/** Deck do Selado (regra oficial dos eventos Sealed Battle). */
export const LIMITED_DECK_SIZE = 40;
export const HAND_SIZE = 5;

export class IllegalActionError extends Error {}

export type Located = { player: PlayerId; zone: 'leader' | 'character' | 'stage'; fc: FieldCard };
export type EffectFrame = Extract<Frame, { kind: 'effect' }>;
export type DamageFrame = Extract<Frame, { kind: 'damage' }>;
export type PlayFrame = Extract<Frame, { kind: 'play' }>;

/** `untilTurn` de um efeito cujo fim depende do turno de um jogador (ver `Expiry` em types.ts). */
export const FAR_TURN = 1_000_000_000;
