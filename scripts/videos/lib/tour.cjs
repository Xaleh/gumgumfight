// Torneio de demonstração: usuários e sessões direto no banco local, o resto pela API.
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes } = require('node:crypto');
const API = 'http://localhost:3001';
const DB = process.env.DB_PATH ?? require('path').resolve(__dirname, '../../../apps/server/var/gumgum.db');

function mkUser(db, key, role) {
  const id = `u-demo-${key}`;
  const tok = randomBytes(32).toString('base64url');
  db.prepare(`INSERT OR IGNORE INTO users (id,google_sub,email,name,email_verified,role) VALUES (?,?,?,?,1,?)`).run(id, `demo-sub-${key}`, `${key}@demo.test`, key, role);
  db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role, id);
  db.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+60 days'))`).run(createHash('sha256').update(tok).digest('hex'), id);
  return { id, tok };
}

async function call(tok, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { cookie: `gg_session=${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return data;
}

const PLAYERS = [
  ['ZoroSemRumo', 'st32-zoro'], ['NamiNavegadora', 'st13-ace'], ['LawDoNorte', 'st10-law'], ['SanjiChef', 'st23-shanks'],
  ['Usopp4ever', 'st21-luffy'], ['RobinArqueologa', 'st34-katakuri'], ['FrankySuper', 'st33-kuzan'], ['BrookYohoho', 'st26-luffy'],
];

/**
 * Torneio com 8 inscritos. `checkIn`: começa em 20 min, com o check-in já aberto. `me`: cria também uma
 * conta ainda não inscrita (o jogador que aparece no vídeo), com esse apelido.
 */
async function setup({ name = 'Copa GumGum', checkIn = false, me = null } = {}) {
  const db = new DatabaseSync(DB);
  const org = mkUser(db, 'organizador', 'organizer');
  const players = PLAYERS.map(([n, deck], i) => ({ name: n, deck, ...mkUser(db, `p${i}`, 'player') }));
  const mine = me ? mkUser(db, 'eu', 'player') : null;
  if (mine) db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run('Capitão Gum', 'capitao.gum@exemplo.com', mine.id);
  db.close();
  if (mine) {
    await call(mine.tok, 'PUT', '/api/players/me', { name: me });
    // um deck salvo na conta, para a aba "Meus decks"
    const src = await call(mine.tok, 'GET', '/api/decks/st23-shanks');
    mine.deck = await call(mine.tok, 'POST', '/api/decks', { name: 'Shanks do Capitão', leader: src.deck.leader, cards: src.deck.cards });
  }
  await call(org.tok, 'PUT', '/api/players/me', { name: 'Organizador' });
  for (const p of players) await call(p.tok, 'PUT', '/api/players/me', { name: p.name });
  const t = await call(org.tok, 'POST', '/api/tournaments', {
    name, format: 'free', structure: 'swiss', rounds: 3, swissBestOf: 1, checkIn,
    startsAt: new Date(Date.now() + (checkIn ? 20 : 10) * 60e3).toISOString(), autoStart: false, toleranceMin: checkIn ? 10 : 60,
  });
  const id = t.id ?? t.tournament?.id;
  for (const p of players) await call(p.tok, 'POST', `/api/tournaments/${id}/register`, { deckId: p.deck });
  return { id, org, players, me: mine };
}

module.exports = { setup, call, API };

if (require.main === module) {
  setup().then((r) => console.log(JSON.stringify({ id: r.id, org: r.org.id }))).catch((e) => { console.error(e); process.exit(1); });
}
