// Regras comuns dos chats de texto (o da partida, em room.ts, e o do lobby do torneio, em
// tournaments/chat.ts): o texto é limpo, tem tamanho máximo, passa pelo filtro de palavrões e
// cada pessoa tem um ritmo máximo de mensagens.

import { fail, type PlayerError } from '../errors';
import { censor } from './profanity';

/** Intervalo mínimo entre mensagens e teto por minuto, por pessoa. */
export const CHAT_MIN_INTERVAL_MS = 1500;
export const CHAT_PER_MINUTE = 10;

export type ChatText = { ok: true; text: string } | ({ ok: false; code: number } & PlayerError);

/**
 * O texto pronto para repassar: sem quebras de linha nem caracteres de controle, espaços
 * repetidos viram um só, no máximo `max` caracteres e com os palavrões censurados.
 */
export function chatText(text: unknown, max: number): ChatText {
  if (typeof text !== 'string') return { ok: false, code: 400, ...fail('invalidChatMessage', 'Mensagem inválida.') };
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, code: 400, ...fail('emptyChatMessage', 'Mensagem vazia.') };
  if (clean.length > max) return { ok: false, code: 400, ...fail('chatMessageTooLong', `A mensagem pode ter no máximo ${max} caracteres.`, { max }) };
  return { ok: true, text: censor(clean) };
}

/** Recusa por excesso de mensagens. */
export const chatTooFast = () => ({ ok: false as const, code: 429, ...fail('chatTooFast', 'Espere um pouco antes de mandar outra mensagem.') });

/**
 * Ritmo: dados os instantes das mensagens recentes de uma pessoa, devolve os do último minuto
 * e se ela pode mandar outra agora (o instante novo é anotado por quem chama, ao aceitar).
 */
export function chatPace(times: number[], now: number): { recent: number[]; allowed: boolean } {
  const recent = times.filter((t) => now - t < 60_000);
  const last = recent[recent.length - 1] ?? 0;
  return { recent, allowed: now - last >= CHAT_MIN_INTERVAL_MS && recent.length < CHAT_PER_MINUTE };
}
