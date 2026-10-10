// Filtro de palavrões do chat da partida. Roda só no servidor: o texto censurado é o
// que chega aos navegadores (o original nunca sai da sala).
//
// A comparação é por palavra inteira, depois de normalizar: minúsculas, sem acentos,
// trocas comuns de letra por símbolo/número (p0rr@, m3rda), letras repetidas (merdaaa)
// e plural simples. Uma palavra soletrada com separadores (p.o.r.r.a, p o r r a) também
// é reconhecida. Palavras do dia a dia que só contêm um termo (ex.: "cuidado", "assistir")
// não são tocadas.

/** Termos censurados (português e inglês), já na forma normalizada. */
const TERMS = [
  // português
  'porra', 'caralho', 'merda', 'bosta', 'puta', 'puto', 'putinha', 'putinho', 'foda', 'fodase', 'foder', 'fodeu', 'fodido', 'fodida',
  'buceta', 'boceta', 'xoxota', 'xota', 'cu', 'cuzao', 'cuzinho', 'cuzona', 'viado', 'viadinho', 'arrombado', 'arrombada',
  'babaca', 'otario', 'otaria', 'escroto', 'escrota', 'cacete', 'punheta', 'punheteiro', 'boquete', 'siririca', 'pentelho',
  'piranha', 'vagabunda', 'vagabundo', 'desgracado', 'desgracada', 'retardado', 'retardada', 'crioulo', 'crioula', 'sapatao',
  'fdp', 'vsf', 'vtnc', 'pqp', 'krl', 'crl', 'tnc', 'tmnc',
  // inglês
  'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'asshole', 'ass', 'dick',
  'dickhead', 'cunt', 'pussy', 'cock', 'cocksucker', 'bastard', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag',
  'retard', 'retarded', 'wtf', 'stfu', 'piss', 'pissed', 'douche', 'douchebag', 'twat', 'wanker', 'bollocks', 'prick',
  'jackass', 'dumbass',
];

/** Símbolos e números que costumam substituir letras. */
const LEET: Record<string, string> = { '@': 'a', '4': 'a', '3': 'e', '€': 'e', '1': 'i', '!': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };

/** Letras repetidas viram uma só ("porrra" → "pora"), para comparar sem se importar com a repetição. */
const squeeze = (s: string) => s.replace(/(.)\1+/g, '$1');

const BAD = new Set(TERMS.map(squeeze));

/** Um caractere para a forma normalizada, ou '' se não é parte de uma palavra. */
function canon(ch: string): string {
  const lower = ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^[a-z]$/.test(lower)) return lower;
  return LEET[ch] ?? '';
}

/** A palavra normalizada é um termo censurado (aceita plural com "s")? */
function isBad(word: string): boolean {
  if (!word) return false;
  const w = squeeze(word);
  return BAD.has(w) || (w.endsWith('s') && BAD.has(w.slice(0, -1)));
}

interface Token {
  start: number;
  end: number;
  word: string;
}

/** Palavras do texto (trechos de letras/dígitos/símbolos de leet), com a posição no original. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let cur: Token | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const wordChar = /[\p{L}\p{N}]/u.test(ch) || ch in LEET;
    if (wordChar) {
      if (!cur) cur = { start: i, end: i + 1, word: '' };
      cur.end = i + 1;
      cur.word += canon(ch);
    } else if (cur) {
      tokens.push(cur);
      cur = null;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/** Substitui no texto os palavrões por asteriscos (um por caractere). */
export function censor(text: string): string {
  const tokens = tokenize(text);
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isBad(t.word)) {
      ranges.push([t.start, t.end]);
      continue;
    }
    // Soletrado com separadores: junta a sequência de "palavras" de uma letra.
    if (t.word.length === 1) {
      let j = i;
      let joined = t.word;
      while (j + 1 < tokens.length && tokens[j + 1].word.length === 1 && tokens[j + 1].start - tokens[j].end <= 2) {
        j++;
        joined += tokens[j].word;
      }
      if (j > i && isBad(joined)) {
        ranges.push([t.start, tokens[j].end]);
        i = j;
      }
    }
  }
  if (!ranges.length) return text;
  let out = '';
  let pos = 0;
  for (const [start, end] of ranges) {
    out += text.slice(pos, start) + '*'.repeat(end - start);
    pos = end;
  }
  return out + text.slice(pos);
}

/** O texto contém algum palavrão? */
export const hasProfanity = (text: string) => censor(text) !== text;
