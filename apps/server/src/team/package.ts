// Pacote do Bot do Time para o Claude: um markdown com os relatórios das partidas (as jogadas marcadas como
// erradas pelo Time) e, por deck do bot, o guia e o perfil atuais, mais o replay de cada partida. É o que se cola
// (ou anexa) numa conversa com o Claude no repositório para ele propor o perfil novo, sem a API do agente.

import type { DeckProfile } from '@gumgum/engine';
import type { ReportItem } from './store';

/** Nome do arquivo: o deck (ou "varios") e as partidas. */
export function packageName(reports: ReportItem[]): string {
  const decks = [...new Set(reports.map((r) => r.botDeck ?? 'sem-deck'))];
  const deck = decks.length === 1 ? decks[0] : 'varios-decks';
  const matches = reports.length === 1 ? `partida-${reports[0].matchId}` : `${reports.length}-partidas`;
  return `bot-do-time-${deck}-${matches}.md`.replace(/[^a-z0-9.-]+/gi, '-');
}

/** Bloco de código que não fecha antes do fim, mesmo que o conteúdo tenha ``` dentro. */
function fence(lang: string, body: string): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

export function buildPackage(
  reports: ReportItem[],
  deckFiles: (deckId: string) => { guide: string | null; profile: DeckProfile | null },
  replay: (matchId: number) => Record<string, unknown> | null,
): string {
  const out: string[] = [];
  const decks = [...new Set(reports.map((r) => r.botDeck).filter((d): d is string => Boolean(d)))];
  out.push('# Pacote do Bot do Time');
  out.push('');
  out.push(
    `Partidas: ${reports.map((r) => `#${r.matchId}`).join(', ')}. Decks do bot: ${decks.length ? decks.join(', ') : '(desconhecido)'}.`,
  );
  out.push('');
  out.push(
    'Pedido: com base nas jogadas que o Time marcou como erradas, no guia do deck e nos replays, proponha as mudanças no perfil ' +
      '(`data/decks/meta/<deck>.profile.json`) e, se o erro não for do deck, o conceito que falta na avaliação do bot.',
  );
  for (const r of reports) {
    out.push('');
    out.push('---');
    out.push('');
    // O relatório começa com um título "#": desce um nível para caber dentro do pacote.
    out.push(r.report.replace(/^(#+) /gm, '#$1 '));
  }
  for (const id of decks) {
    const { guide, profile } = deckFiles(id);
    out.push('');
    out.push('---');
    out.push('');
    out.push(`## Deck do bot: ${id}`);
    out.push('');
    out.push(`### Guia (\`data/decks/meta/${id}.md\`)`);
    out.push('');
    out.push(guide ? guide.replace(/^(#+) /gm, '###$1 ') : '(este deck ainda não tem guia)');
    out.push('');
    out.push(`### Perfil atual (\`data/decks/meta/${id}.profile.json\`)`);
    out.push('');
    out.push(profile ? fence('json', JSON.stringify(profile, null, 2)) : '(este deck ainda não tem perfil)');
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('## Replays');
  for (const r of reports) {
    const data = replay(r.matchId);
    out.push('');
    out.push(`### Partida #${r.matchId}`);
    out.push('');
    out.push(data ? fence('json', JSON.stringify(data)) : '(replay indisponível)');
  }
  out.push('');
  return out.join('\n');
}
