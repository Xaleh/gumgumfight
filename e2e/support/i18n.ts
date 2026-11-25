// Textos da interface nos testes: vêm do dicionário pt-BR do web, pela chave. Assim um texto
// mudado no dicionário não quebra o teste, e uma chave apagada quebra o typecheck.

import ptBR, { type MessageKey } from '../../apps/web/src/i18n/pt-BR';

type Params = Record<string, string | number>;

/** O texto da chave em pt-BR, com os parâmetros e o plural (`{n|# carta|# cartas}`) do `t()` do web. */
export function t(key: MessageKey, params: Params = {}): string {
  return (ptBR[key] as string).replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_, name: string, forms?: string) => {
    const value = params[name];
    if (forms === undefined) return value === undefined ? `{${name}}` : String(value);
    const [one, other = one] = forms.split('|');
    return (Number(value) === 1 ? one : other).replace('#', String(value));
  });
}

/** Nome acessível do texto: quebras de linha viram espaço, como o navegador calcula. */
export function label(key: MessageKey, params: Params = {}): string {
  return t(key, params).replace(/\s+/g, ' ').trim();
}
