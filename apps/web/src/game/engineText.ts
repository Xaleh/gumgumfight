// Textos que o motor manda com chave de tradução: linhas do histórico (`LogEntry.key`), perguntas
// (`promptKey`), motivo da vitória (`winReasonKey`) e opções compostas (`optionParts`).
//
// O motor manda sempre o texto em português e, ao lado, a chave e os parâmetros. Parâmetros que
// são, eles mesmos, texto traduzível (um custo, o motivo da vitória, a zona de destino…) vêm em
// `parts`: cada item é traduzido e os itens são juntados pelo separador `join` (padrão
// `log.listAnd`). Se alguma chave faltar no dicionário, vale o texto em português que veio junto.

import type { LogEntry, MsgList, MsgParts, PromptParams } from '@gumgum/engine';
import type { Params } from '../i18n';

/** `tryT` (ou `useTryT()`): tradução de uma chave que pode não existir. */
export type TryT = (key: string | undefined | null, params?: Params) => string | undefined;

/** Uma lista de peças traduzida e juntada; `undefined` se alguma peça não tiver tradução. */
export function listText(tryT: TryT, list: MsgList): string | undefined {
  const items = list.items.map((m) => msgText(tryT, m.key, m.params, m.parts));
  if (items.some((s) => s === undefined)) return undefined;
  return items.join(tryT(list.join ?? 'log.listAnd') ?? ', ');
}

/**
 * Tradução de uma chave do motor com parâmetros e partes. As partes que não se traduzem ficam com o
 * valor em português de `params`. `undefined` quando a chave não existe (use o texto que veio).
 */
export function msgText(tryT: TryT, key: string | undefined, params?: PromptParams, parts?: MsgParts): string | undefined {
  if (!key) return undefined;
  const all: Params = { ...params };
  for (const [name, list] of Object.entries(parts ?? {})) {
    const text = listText(tryT, list);
    if (text !== undefined) all[name] = text;
  }
  return tryT(key, all);
}

/** Linha do histórico no idioma da interface (com `secret`, o texto que o dono vê). */
export function logText(tryT: TryT, e: LogEntry): string {
  if (e.secret !== undefined) return msgText(tryT, e.secretKey, e.secretParams, e.secretParts) ?? e.secret;
  return msgText(tryT, e.key, e.params, e.parts) ?? e.text;
}

/** Motivo da vitória no idioma da interface. */
export function winReasonText(tryT: TryT, s: { winReason: string | null; winReasonKey?: string; winReasonParams?: PromptParams }): string | null {
  if (s.winReason === null) return null;
  return msgText(tryT, s.winReasonKey, s.winReasonParams) ?? s.winReason;
}
