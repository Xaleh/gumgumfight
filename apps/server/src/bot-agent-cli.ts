// Agente do Bot do Time fora da partida (docs/plano-bot-time.md, seção 6). Precisa de BOT_AGENT_API_KEY.
//
//   npm run bot:agent -w @gumgum/server -- profile <deck>            guia → rascunho do perfil (data/decks/meta/<deck>.profile.json)
//       --out <arquivo>   grava noutro lugar (padrão: ao lado do guia, sem sobrescrever um perfil que já existe sem --force)
//       --force           sobrescreve o perfil existente
//   npm run bot:agent -w @gumgum/server -- review <matchId> [--seat 0|1] [--deck <deck>]
//                                                                   traço da partida x guia → discrepâncias (markdown)
//   npm run bot:agent -w @gumgum/server -- explain <feedbackId>     uma frase para a marcação (a linha e os termos)
//
//   BOT_AGENT_API_KEY=... DB_PATH=/caminho/gumgum.db npm run bot:agent -w @gumgum/server -- profile op17-xebec

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckList } from '@gumgum/engine';
import { botAgentOptions } from './config';
import { getCards, openDb } from './db';
import { DB_PATH, fromUserCwd } from './paths';
import { draftProfile, explainLine, reviewMatch, sdkCompleter } from './team/agent';
import { MetaProfiles } from './team/profiles';
import { getFeedback } from './team/store';
import { matchTrace } from './team/trace';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [task, target] = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));

const agent = botAgentOptions();
if (!agent) {
  console.error('BOT_AGENT_API_KEY não definida: o agente está desligado.');
  process.exit(1);
}
const complete = sdkCompleter(agent);
const profiles = new MetaProfiles();

async function main() {
  if (task === 'profile' && target) {
    const dir = profiles.directory;
    const deckPath = join(dir, `${target}.json`);
    if (!existsSync(deckPath)) throw new Error(`deck ${target} não encontrado em ${dir}`);
    const guide = profiles.guide(target);
    if (!guide) throw new Error(`guia ${target}.md não encontrado em ${dir}`);
    const deck = JSON.parse(readFileSync(deckPath, 'utf8')) as DeckList;
    const db = openDb();
    const cards = getCards(db, [deck.leader, ...deck.cards.map((c) => c.id)]);
    console.log(`Banco: ${DB_PATH} | deck ${deck.name} (${cards.length} cartas conhecidas) | modelo ${agent!.model}`);
    const r = await draftProfile(complete, { deck, cards, guide });
    if ('error' in r) {
      console.error(`O modelo não devolveu um perfil válido: ${r.error}\n\n${r.raw}`);
      process.exit(2);
    }
    const out = opt('out') ? fromUserCwd(opt('out')!) : join(dir, `${target}.profile.json`);
    if (existsSync(out) && !args.includes('--force')) {
      console.log(JSON.stringify(r.profile, null, 2));
      console.log(`\n${out} já existe: rode com --force para sobrescrever, ou --out <arquivo>.`);
    } else {
      writeFileSync(out, JSON.stringify(r.profile, null, 2) + '\n');
      console.log(`Perfil gravado em ${out}`);
    }
    console.log('\nJustificativas:');
    for (const [k, v] of Object.entries(r.why)) console.log(`  ${k}: ${v}`);
    return;
  }
  if (task === 'review' && target) {
    const db = openDb();
    const matchId = Number(target);
    const seat = opt('seat') === '0' ? 0 : opt('seat') === '1' ? 1 : (db.prepare("SELECT seat FROM match_seats WHERE match_id = ? AND controller = 'bot'").get(matchId) as { seat: 0 | 1 } | undefined)?.seat;
    if (seat === undefined) throw new Error('a partida não tem assento do bot (use --seat)');
    const deckId = opt('deck') ?? (db.prepare('SELECT deck0, deck1 FROM matches WHERE id = ?').get(matchId) as { deck0: string | null; deck1: string | null } | undefined)?.[seat === 0 ? 'deck0' : 'deck1'] ?? null;
    const guide = deckId ? profiles.guide(deckId) : null;
    if (!guide) throw new Error(`sem guia para o deck ${deckId ?? '?'} (use --deck <deck do meta>)`);
    const trace = matchTrace(db, matchId, seat);
    if (!trace) throw new Error('o replay desta partida não refaz');
    console.log(await reviewMatch(complete, { guide, profile: deckId ? profiles.profile(deckId) : null, trace }));
    return;
  }
  if (task === 'explain' && target) {
    const db = openDb();
    const f = getFeedback(db, Number(target));
    if (!f || f.kind !== 'mark') throw new Error('marcação não encontrada');
    const line = JSON.stringify(f.botAction);
    console.log(await explainLine(complete, { line, score: 0, terms: [], alternatives: [] }));
    return;
  }
  console.error('uso: bot:agent profile <deck> | review <matchId> | explain <feedbackId>');
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
