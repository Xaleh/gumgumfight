// Erros destinados ao jogador.
//
// Toda resposta de erro que o navegador mostra leva dois campos: `error`, o texto em
// português (logs e clientes antigos continuam a usá-lo), e `errorCode`, uma chave
// que o cliente traduz com `tryT('errors.' + errorCode, errorParams) ?? error`. As
// chaves ficam em apps/web/src/i18n/{pt-BR,en}.ts, seção `errors`. `code` continua
// sendo o status HTTP (ou o código da sala), por isso o campo novo chama `errorCode`.

export type ErrorParams = Record<string, string | number>;

export interface PlayerError {
  error: string;
  errorCode: string;
  errorParams?: ErrorParams;
}

/** Corpo de erro com a chave para o cliente traduzir e o texto em português. */
export function fail(errorCode: string, error: string, errorParams?: ErrorParams): PlayerError {
  return errorParams ? { error, errorCode, errorParams } : { error, errorCode };
}

/** O valor é um erro para o jogador (e não o resultado esperado)? */
export const isPlayerError = (v: unknown): v is PlayerError => typeof v === 'object' && v !== null && 'error' in v;
