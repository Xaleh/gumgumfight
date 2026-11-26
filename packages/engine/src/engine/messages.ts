// Perguntas ao jogador (`pending.prompt`) e linhas do histórico: o texto em português e a chave para a interface traduzir.

import type { GameState, Msg, MsgParts, PlayerId, PromptParams } from '../types';

/**
 * Pergunta ao jogador: `text` é o português que vai em `pending.prompt` (inalterado: replays e
 * salas antigas dependem dele); `key` (`engine.*`) e `params` são a mesma frase para a interface
 * traduzir (ver `Pending` em types.ts).
 */
export interface Prompt {
  text: string;
  key: string;
  params?: PromptParams;
  /** Parâmetros que são texto traduzível (ver `Msg` em types.ts); em `params` eles vão em português. */
  parts?: MsgParts;
}

/** Monta um `Prompt`; `key` é o sufixo depois de `engine.`. */
export function pr(key: string, text: string, params?: PromptParams, parts?: MsgParts): Prompt {
  return { text, key: `engine.${key}`, ...(params ? { params } : {}), ...(parts ? { parts } : {}) };
}

/** Linha do histórico: o português de sempre (`text`) e a chave `log.<key>` com os parâmetros. */
export function lg(key: string, text: string, params?: PromptParams, parts?: MsgParts): Prompt {
  return { text, key: `log.${key}`, ...(params ? { params } : {}), ...(parts ? { parts } : {}) };
}

/** O `Msg` (chave, parâmetros e partes) de um `Prompt`, sem o texto. */
export function msgOf(p: Prompt): Msg {
  return { key: p.key, ...(p.params ? { params: p.params } : {}), ...(p.parts ? { parts: p.parts } : {}) };
}

/** Campos `prompt`, `promptKey`, `promptParams` e `promptParts` de um `pending`. */
export function promptOf(p: Prompt): { prompt: string; promptKey: string; promptParams?: PromptParams; promptParts?: MsgParts } {
  return { prompt: p.text, promptKey: p.key, ...(p.params ? { promptParams: p.params } : {}), ...(p.parts ? { promptParts: p.parts } : {}) };
}

/** `optionKeys` das opções ['Topo da Vida', 'Fundo da Vida'] e ['Topo do deck', 'Fundo do deck']. */
export const LIFE_TOP_BOTTOM = ['engine.optLifeTop', 'engine.optLifeBottom'];
export const DECK_TOP_BOTTOM = ['engine.optDeckTop', 'engine.optDeckBottom'];

/**
 * `uids`: cartas reveladas a todos na linha; `by`, quem as escolheu da própria mão ou deck. `cards`: as cartas
 * citadas pelo nome na linha, na ordem do texto (ver `LogEntry.cards`); as reveladas já contam, não precisam vir aqui.
 */
export function log(state: GameState, player: PlayerId | null, m: Prompt, reveal?: { uids?: string[]; by?: PlayerId; cards?: string[] }) {
  const revealed = reveal?.uids?.length ? { revealed: reveal.uids.map((u) => state.cards[u].cardId), ...(reveal.by !== undefined ? { revealedBy: reveal.by } : {}) } : {};
  const cards = reveal?.cards?.length ? { cards: reveal.cards.map((u) => state.cards[u].cardId) } : {};
  state.log.push({ turn: state.turn, player, text: m.text, ...msgOf(m), ...cards, ...revealed });
  // Carta da mão revelada: o oponente a lembra enquanto ela ficar na mão (`knownHand`).
  for (const u of reveal?.uids ?? []) {
    if (!state.players.some((ps) => ps.hand.includes(u))) continue;
    state.knownHand ??= [];
    if (!state.knownHand.includes(u)) state.knownHand.push(u);
  }
}

/**
 * Linha do log com cartas que só `player` vê; o oponente recebe `text` (no online). A chave e os
 * parâmetros seguem a mesma regra: os de `secret` (`secretKey`…) só chegam ao dono (view.ts).
 */
export function logSecret(state: GameState, player: PlayerId, m: Prompt, secret: Prompt, secretCards: string[] = []) {
  const s = msgOf(secret);
  state.log.push({
    turn: state.turn,
    player,
    text: m.text,
    ...msgOf(m),
    secret: secret.text,
    secretKey: s.key,
    ...(s.params ? { secretParams: s.params } : {}),
    ...(s.parts ? { secretParts: s.parts } : {}),
    ...(secretCards.length ? { secretCards: secretCards.map((u) => state.cards[u].cardId) } : {}),
  });
}
