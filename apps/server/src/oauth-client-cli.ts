// Cadastro dos clientes OAuth (apps parceiros), sem tela:
//   npm run oauth:client -- list
//   npm run oauth:client -- add <id> "<nome>" --redirect <uri> [--redirect <uri>] [--scopes "decks:read decks:write"] [--webhook <url>]
//   npm run oauth:client -- secret <id>            # client_secret novo (o antigo deixa de valer)
//   npm run oauth:client -- webhook <id> <url|off>  # liga/desliga o webhook e gera o segredo dele
//   npm run oauth:client -- remove <id>            # apaga o cliente e revoga os tokens dele
// O client_secret e o webhook_secret aparecem uma vez só: passe-os ao parceiro por um canal seguro.

import './env';
import { openDb } from './db';
import { deleteClient, getClient, isClientId, listClients, parseScopes, rotateClientSecret, SCOPES, setClientWebhook, upsertClient } from './partners/store';

const args = process.argv.slice(2);
const cmd = args.shift();

const fail = (msg: string): never => {
  console.error(`Erro: ${msg}`);
  process.exit(1);
};
const option = (name: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1]) out.push(args[++i]);
  return out;
};
const positional = () => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const validUrl = (u: string) => /^https?:\/\//i.test(u);

const db = openDb();
const show = (id: string) => {
  const c = getClient(db, id);
  if (!c) return;
  console.log(`${c.id}: ${c.name}\n  redirect_uris: ${c.redirectUris.join(', ')}\n  scopes: ${c.scopes.join(' ')}\n  webhook: ${c.webhookUrl ?? '(desligado)'}`);
};

switch (cmd) {
  case 'list': {
    const all = listClients(db);
    if (!all.length) console.log('Nenhum cliente cadastrado.');
    for (const c of all) show(c.id);
    break;
  }
  case 'add': {
    const [id, name] = positional();
    if (!isClientId(id)) fail('id inválido (minúsculas, dígitos, - e _, até 40 caracteres).');
    if (!name) fail('informe o nome do app.');
    const redirectUris = option('redirect');
    if (!redirectUris.length || !redirectUris.every(validUrl)) fail('informe ao menos uma --redirect http(s)://…');
    const scopes = parseScopes(option('scopes')[0] ?? SCOPES.join(' '));
    const webhookUrl = option('webhook')[0] ?? null;
    if (webhookUrl && !validUrl(webhookUrl)) fail('--webhook precisa ser http(s)://…');
    const { secret } = upsertClient(db, { id, name, redirectUris, scopes, webhookUrl });
    const webhookSecret = webhookUrl ? setClientWebhook(db, id, webhookUrl) : null;
    show(id);
    console.log(`\nclient_secret (aparece só agora): ${secret}`);
    if (webhookSecret) console.log(`webhook_secret (aparece só agora): ${webhookSecret}`);
    break;
  }
  case 'secret': {
    const [id] = positional();
    const secret = id ? rotateClientSecret(db, id) : null;
    if (!secret) fail('cliente não encontrado.');
    console.log(`client_secret novo (aparece só agora): ${secret}`);
    break;
  }
  case 'webhook': {
    const [id, url] = positional();
    if (!id || !getClient(db, id)) fail('cliente não encontrado.');
    if (!url || (url !== 'off' && !validUrl(url))) fail('informe a URL do webhook ou "off".');
    const secret = setClientWebhook(db, id, url === 'off' ? null : url);
    show(id);
    if (secret) console.log(`\nwebhook_secret (aparece só agora): ${secret}`);
    break;
  }
  case 'remove': {
    const [id] = positional();
    if (!id || !deleteClient(db, id)) fail('cliente não encontrado.');
    console.log(`Cliente ${id} removido; os tokens dele foram revogados.`);
    break;
  }
  default:
    console.log('Uso: oauth-client-cli list | add <id> "<nome>" --redirect <uri> [--scopes "…"] [--webhook <url>] | secret <id> | webhook <id> <url|off> | remove <id>');
    process.exit(cmd ? 1 : 0);
}
