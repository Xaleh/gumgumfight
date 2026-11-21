// Gera a lista de uma temporada do Cubo a partir do uso global das cartas (decklists dos torneios
// de One Piece na plataforma do Limitless TCG; veja draft/cube-source.ts) e grava em
// `data/cubes/<id>.json`. O arquivo é editável: troque cartas à mão se quiser.
//
//   npm run cube:build -- --id T1 --name "Temporada 1"
//   npm run cube:build -- --id T2 --name "Temporada 2" --per-quarter 8 --min-players 48
//   npm run cube:build -- --id T1 --dry-run        # mostra o resumo e não grava
//
// Opções: --per-quarter N (torneios por trimestre, os maiores; padrão 6), --min-players N (padrão 32),
// --cache PASTA (onde as decklists baixadas ficam guardadas; padrão: pasta temporária do sistema).
// As cartas vêm do banco local: rode `npm run cards:import -- --all` antes, senão a lista sai só
// com as coleções que o banco tem.

import { type CardData, CUBE_COLORS, cubeColor, DEFAULT_CUBE_SHAPE, pickCube } from '@gumgum/engine';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCards, openDb } from './db';
import { listTournaments, sampleTournaments, type TournamentDecks, tournamentDecks, usageByCard } from './draft/cube-source';
import type { CubeFile } from './draft/cubes';
import { DATA_DIR, fromUserCwd } from './paths';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const id = (arg('id') ?? '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(id)) throw new Error('Informe o id da temporada: --id T1 (letras e números, até 12).');
  const name = arg('name') ?? `Temporada ${id.replace(/\D/g, '') || id}`;
  const perQuarter = Number(arg('per-quarter') ?? 6);
  const minPlayers = Number(arg('min-players') ?? 32);
  const cacheDir = arg('cache') ? fromUserCwd(arg('cache')!) : join(tmpdir(), 'gumgum-cube-cache');
  const log = (msg: string) => console.log(msg);

  const cards = new Map((listCards(openDb()) as CardData[]).map((c) => [c.id, c]));
  console.log(`Cartas no banco: ${cards.size}`);

  const all = await listTournaments({ log });
  const sample = sampleTournaments(all, { perQuarter, minPlayers });
  console.log(`Torneios na plataforma: ${all.length} | na amostra: ${sample.length} (${perQuarter} por trimestre, ${minPlayers}+ jogadores)`);
  const decks: TournamentDecks[] = [];
  for (const [i, t] of sample.entries()) {
    decks.push(await tournamentDecks(t, { cacheDir, log }));
    if ((i + 1) % 10 === 0 || i + 1 === sample.length) console.log(`  ${i + 1}/${sample.length} torneios lidos`);
  }

  const { cards: usage, quarters } = usageByCard(decks);
  for (const q of quarters) console.log(`  ${q.quarter}: ${q.tournaments} torneios, ${q.decks} decks`);
  const picks = pickCube(new Map([...usage].map(([cardId, u]) => [cardId, u.usage])), cards);
  const unknown = [...usage.keys()].filter((cardId) => !cards.has(cardId)).length;
  if (unknown) console.log(`Cartas das decklists que o banco não tem: ${unknown}`);

  for (const color of CUBE_COLORS) {
    const mine = picks.filter((p) => p.color === color).map((p) => cards.get(p.id)!);
    const bands = DEFAULT_CUBE_SHAPE.bands.map((b, i) => mine.filter((c) => DEFAULT_CUBE_SHAPE.bands.findIndex((x) => (c.cost ?? 0) <= x.upTo) === i).length);
    const top = picks.filter((p) => p.color === color).slice(0, 5).map((p) => `${cards.get(p.id)!.name} ${(p.usage * 100).toFixed(0)}%`);
    console.log(
      `${color.padEnd(7)} ${String(mine.length).padStart(3)} cartas | custo 0-2: ${bands[0]}, 3-4: ${bands[1]}, 5-6: ${bands[2]}, 7+: ${bands[3]} | Eventos ${mine.filter((c) => c.category === 'event').length}, Stages ${mine.filter((c) => c.category === 'stage').length} | ${top.join(', ')}`,
    );
  }
  const short = CUBE_COLORS.filter((c) => picks.filter((p) => cubeColor(cards.get(p.id)!) === c).length < DEFAULT_CUBE_SHAPE.perColor);
  if (short.length) console.log(`Cores com menos de ${DEFAULT_CUBE_SHAPE.perColor} cartas: ${short.join(', ')}`);

  const dates = decks.map((d) => d.date.slice(0, 10)).sort();
  const file: CubeFile = {
    id,
    name,
    publishedAt: new Date().toISOString().slice(0, 10),
    source: {
      name: 'Limitless TCG (torneios online de One Piece)',
      url: 'https://play.limitlesstcg.com/tournaments/completed?game=OP',
      tournaments: decks.length,
      decks: decks.reduce((n, d) => n + d.decks.length, 0),
      from: dates[0] ?? '',
      to: dates[dates.length - 1] ?? '',
    },
    perColor: DEFAULT_CUBE_SHAPE.perColor,
    cards: picks.map((p) => ({ id: p.id, usage: Math.round(p.usage * 10000) / 10000, decks: usage.get(p.id)!.decks })),
  };
  console.log(`Cubo ${id} (${name}): ${file.cards.length} cartas, de ${file.source.decks} decks em ${file.source.tournaments} torneios (${file.source.from} a ${file.source.to}).`);
  if (process.argv.includes('--dry-run')) return console.log('--dry-run: nada gravado.');
  const dir = join(DATA_DIR, 'cubes');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${id.toLowerCase()}.json`);
  // Uma carta por linha, para o arquivo ser fácil de editar e de comparar.
  const body = JSON.stringify({ ...file, cards: [] }, null, 2).replace('"cards": []', `"cards": [\n${file.cards.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`);
  writeFileSync(out, `${body}\n`);
  console.log(`Gravado: ${out}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
