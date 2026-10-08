// Confere as traduções automáticas para português de toda a base de cartas.
//
//   npm run translations:check -w @gumgum/server                  # baixa as cartas da optcgapi
//   npm run translations:check -w @gumgum/server -- --file a.json # usa respostas salvas da API
//   npm run translations:check -w @gumgum/server -- --all         # lista todas as cartas, não só as suspeitas
//
// Para cada carta, traduz com `translateCardPt` (o mesmo que o servidor usa) e compara com o
// inglês. Mostra as traduções parciais e as suspeitas: número que aparece só de um lado (um "99"
// interno do leitor vazando, um limite perdido), nome de carta, tipo ou palavra-chave que sumiu,
// palavra em inglês que sobrou. A saída é a lista de trabalho para `data/translations/pt.json`
// e para corrigir `packages/engine/src/i18n/render.ts` / `pt.ts`.
// Rodar a cada coleção nova (docs/rules/manutencao.md).

import { readFileSync } from 'node:fs';
import { type CardData, fixCard, translateCardPt } from '@gumgum/engine';
import { fetchJson, knownTypes } from './card-import';
import { allEndpoints, DEFAULT_API_BASE, mapApiResponse, rowsOf, typeVocabulary } from './optcgapi';
import { fromUserCwd } from './paths';

interface TranslationIssue {
  id: string;
  name: string;
  en: string;
  pt: string;
  /** O que chamou atenção, em uma frase cada. */
  reasons: string[];
}

const TIMING_TAGS =
  /^(On Play|When Attacking|Activate: ?Main|Main|Trigger|Once Per Turn|On K\.O\.|Your Turn|Opponent's Turn|End of Your Turn|On Your Opponent's Attack|On Block|Counter|DON!! ?x\d+)$/i;
const KEYWORDS = new Set(['Blocker', 'Rush', 'Double Attack', 'Banish', 'Trigger', 'Rush: Character', 'Unblockable']);
const ENGLISH =
  /(?<!\p{L})(the|your|of|up to|gains?|with|cards?|opponent's|this|from|power|cost|less|more|during|may|you|then|character|characters|leader|rest|play|give|draw|trash|select|set|active|look|reveal|place|add|return|when|each|all|can|cannot|instead|activate|effect|hand|top|bottom|order|shuffle|than|type|owner|any|them|turn|have|has|not|their|that|battle|attack)(?!\p{L})/iu;

/**
 * Números do texto fora de lembretes entre parênteses e sem os sinais (+2000, −1). Ficam de fora
 * os que a tradução escreve de outro jeito: "DON!! 1" (a API perde o "−"; em português é "DON!! −1"),
 * "2000 power"/"1 cost" sem sinal (idem), "your 1 active Leader", "rest 3 of your DON!! cards" (③) e o 1.
 */
function numbers(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const clean = text
    .replace(/\([^()]*\)/g, '')
    .replace(/DON!! ?[-−–]?\d+/g, '')
    .replace(/(?<![+\-−–])\b\d+ (?:(?:base )?power|cost|de poder(?: base)?|de custo)\b/g, '')
    .replace(/\b\d+ (?:or (?:more|less) power|ou (?:mais|menos) de poder)\b/g, '')
    .replace(/\bcusta \d+ a menos\b/g, '')
    .replace(/your 1 active Leader/g, '')
    .replace(/(?:rest|return) \d+ (?:or more )?(?:of your )?(?:active )?DON!!/gi, '');
  for (const m of clean.matchAll(/(?<![\w+\-−–])\d+(?!\d)/g)) if (m[0] !== '1') out.set(m[0], (out.get(m[0]) ?? 0) + 1);
  return out;
}

/** Texto sem nomes de cartas, tipos e trechos citados, que ficam em inglês de propósito. */
function withoutNames(text: string): string {
  return text.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/"[^"]*"/g, '');
}

function tokens(text: string, re: RegExp): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(re)) out.set(m[0], (out.get(m[0]) ?? 0) + 1);
  return out;
}

function missing(en: Map<string, number>, pt: Map<string, number>): string[] {
  return [...en].filter(([k, n]) => (pt.get(k) ?? 0) < n).map(([k]) => k);
}

/** Motivos de suspeita de uma tradução (vazio quando nada chamou atenção). */
function translationIssues(card: Pick<CardData, 'id' | 'name' | 'category' | 'text' | 'trigger'>): TranslationIssue | null {
  const t = translateCardPt(card);
  const en = [card.text, card.trigger ? `[Trigger] ${card.trigger}` : ''].filter(Boolean).join('\n');
  const pt = [t.text, t.trigger ? `[Trigger] ${t.trigger}` : ''].filter(Boolean).join('\n');
  const reasons: string[] = [];
  if (!t.complete) reasons.push('tradução parcial (sobrou inglês)');
  else {
    const m = withoutNames(pt).match(ENGLISH);
    if (m) reasons.push(`palavra em inglês: "${m[0]}"`);
  }
  const numEn = numbers(en);
  const numPt = numbers(pt);
  const extra = missing(numPt, numEn);
  if (extra.length) reasons.push(`número só em português: ${extra.join(', ')}`);
  const lost = missing(numEn, numPt);
  if (lost.length) reasons.push(`número só em inglês: ${lost.join(', ')}`);
  const typesLost = missing(tokens(en, /\{[^}]+\}/g), tokens(pt, /\{[^}]+\}/g));
  if (typesLost.length) reasons.push(`tipo perdido: ${typesLost.join(', ')}`);
  const bracketsEn = tokens(en, /\[[^\]]+\]/g);
  const bracketsPt = tokens(pt, /\[[^\]]+\]/g);
  const namesLost = missing(bracketsEn, bracketsPt).filter((b) => {
    const inner = b.slice(1, -1);
    return KEYWORDS.has(inner) || (!TIMING_TAGS.test(inner) && !/^DON!!/i.test(inner));
  });
  if (namesLost.length) reasons.push(`nome ou palavra-chave perdida: ${namesLost.join(', ')}`);
  return reasons.length ? { id: card.id, name: card.name, en, pt, reasons } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const base = (process.env.CARD_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const files: string[] = [];
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') files.push(fromUserCwd(args[++i]));
    else if (args[i] === '--all') all = true;
  }
  const bodies = files.length
    ? files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown)
    : await Promise.all(allEndpoints(base).map(fetchJson));
  const rows = bodies.flatMap(rowsOf);
  const cards = mapApiResponse(rows, typeVocabulary(rows, knownTypes())).cards.map(fixCard);
  let total = 0;
  let partial = 0;
  const issues: TranslationIssue[] = [];
  for (const c of cards) {
    if (!c.text?.trim() && !c.trigger?.trim()) continue;
    total++;
    const issue = translationIssues(c);
    if (issue) {
      issues.push(issue);
      if (issue.reasons[0]?.startsWith('tradução parcial')) partial++;
    } else if (all) console.log(`${c.id} ${c.name}\n  EN: ${c.text}\n  PT: ${translateCardPt(c).text}\n`);
  }
  console.log(`Cartas com texto: ${total} | traduções parciais: ${partial} | suspeitas (inclui as parciais): ${issues.length}\n`);
  for (const i of issues) {
    console.log(`${i.id} ${i.name} — ${i.reasons.join('; ')}`);
    console.log(`  EN: ${i.en.replace(/\n/g, ' | ')}`);
    console.log(`  PT: ${i.pt.replace(/\n/g, ' | ')}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
