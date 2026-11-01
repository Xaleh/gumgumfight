// O agente do Bot do Time (docs/plano-bot-time.md, seção 6): fora da partida, um modelo de linguagem faz o
// trabalho de escrita que o bot não faz.
//
// 1. `draftProfile`: o guia em prosa + a lista do deck + os textos das cartas → um rascunho de perfil
//    (`DeckProfile`, conferido por `validateProfile`) com a justificativa de cada campo, para o Time revisar.
// 2. `reviewMatch`: o perfil + o guia + o traço de uma partida gravada (as jogadas do bot, turno a turno, por nome
//    de carta) → a lista das jogadas que fogem do plano e o conceito genérico que parece faltar na avaliação.
// 3. `explainLine`: a explicação de uma jogada (termos da avaliação) → uma frase em português para o painel.
//
// O modelo entra pelo SDK oficial (`@anthropic-ai/sdk`) com a chave de BOT_AGENT_API_KEY; sem a chave, nada
// disto roda (a tela esconde os botões e o CLI avisa). Os testes passam um `complete` falso.

import Anthropic from '@anthropic-ai/sdk';
import { type CardData, type DeckList, type DeckProfile, validateProfile } from '@gumgum/engine';

export interface AgentOptions {
  apiKey: string;
  /** Modelo (padrão claude-opus-5-5). */
  model?: string;
}

/** Uma chamada ao modelo: instrução de sistema + pedido → texto. Os testes trocam por uma função falsa. */
export type Complete = (system: string, user: string, maxTokens?: number) => Promise<string>;

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** O `complete` de verdade, pelo SDK (streaming, para respostas longas não estourarem o tempo do pedido). */
export function sdkCompleter({ apiKey, model = DEFAULT_MODEL }: AgentOptions): Complete {
  const client = new Anthropic({ apiKey });
  return async (system, user, maxTokens = 16_000) => {
    const message = await client.messages
      .stream({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'high' },
      })
      .finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('O modelo recusou o pedido.');
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  };
}

/** Texto das cartas de um deck, uma por linha, para o modelo saber o que cada carta faz. */
export function cardLines(deck: DeckList, cards: CardData[]): string {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const line = (id: string, count?: number) => {
    const c = byId.get(id);
    if (!c) return `${id} (carta desconhecida)`;
    const bits = [c.category, c.cost !== undefined && c.cost !== null ? `custo ${c.cost}` : '', c.power ? `${c.power} de poder` : '', c.counter ? `Counter +${c.counter}` : '', c.types?.length ? `{${c.types.join('/')}}` : ''].filter(Boolean);
    return `${count ? `${count}x ` : ''}${id} ${c.name} [${bits.join(', ')}]: ${(c.text ?? '').replace(/\s+/g, ' ')}`;
  };
  return [`Líder: ${line(deck.leader)}`, ...deck.cards.map((e) => line(e.id, e.count))].join('\n');
}

const PROFILE_SYSTEM = `Você é um jogador competitivo de One Piece Card Game e ajuda a escrever o perfil de um deck para um bot de busca.
O bot simula as jogadas do turno e escolhe pela avaliação da posição; o perfil entra nessa avaliação como VALORES, nunca como regras.
Responda SÓ com um JSON (sem comentários, sem markdown) com dois campos: "profile" e "why".

"profile" segue este esquema:
{
  "id": string (o id do deck),
  "leader": string (número da carta do Líder),
  "archetype": "aggro" | "midrange" | "control" | "combo",
  "summary": string (uma frase: como o deck vence),
  "plan": [{ "don": número (2, 4, 6, 8, 10: os DON!! disponíveis no turno), "play": [números de carta da jogada prevista], "note": string }],
  "mulligan": { "keep": [números de carta que seguram a mão inicial], "minCheap": 0 a 5 (Personagens de custo <= 3 para segurar sem carta de keep; padrão 2) },
  "roles": { "<número da carta>": "engine" | "finisher" | "defense" | "fuel" | "removal" | "blocker" | "tech" },
  "hold": { "<número da carta>": { "untilDon": 1 a 10 } } (cartas a guardar na mão até ter esse DON!! em campo),
  "weights": {} (só se o guia pedir algo que os arquétipos não cobrem; chaves: handCard, handCounter, exposed, blocker, lifeOpp (lista de 6 números crescentes)...),
  "matchups": { "<número do Líder adversário>": { "counterCard": 0 a 1 (chance de uma carta escondida da mão dele ter Counter), "counterBig": 0 a 1, "note": string } },
  "notes": string
}
Papéis: engine = a carta que faz o deck andar (vale mais em campo); finisher = fecha a partida, guardada até o DON!! certo (use hold); defense = Counter ou Evento [Counter] que não se descarta; fuel = carta de descarte (vale menos na mão); removal/blocker/tech só documentam.
Use só números de carta que estão na lista. Seja fiel ao guia; o que o guia não diz, deixe de fora.

"why" é um objeto { "<campo>": "justificativa curta" } para o revisor.`;

/** Rascunho do perfil a partir do guia; `error` quando o modelo não devolveu um perfil válido (com o texto bruto). */
export async function draftProfile(complete: Complete, input: { deck: DeckList; cards: CardData[]; guide: string }): Promise<{ profile: DeckProfile; why: Record<string, string>; raw: string } | { error: string; raw: string }> {
  const user = `Deck "${input.deck.name}" (id: ${input.deck.id})\n\nCARTAS:\n${cardLines(input.deck, input.cards)}\n\nGUIA:\n${input.guide}`;
  let raw = await complete(PROFILE_SYSTEM, user);
  let parsed = parseProfileAnswer(raw, input.deck.id);
  if ('error' in parsed) {
    // Uma segunda chance, com o motivo da recusa.
    raw = await complete(PROFILE_SYSTEM, `${user}\n\nA resposta anterior foi recusada: ${parsed.error}. Responda de novo, só o JSON.`);
    parsed = parseProfileAnswer(raw, input.deck.id);
  }
  return 'error' in parsed ? { error: parsed.error, raw } : { ...parsed, raw };
}

/** Lê o JSON da resposta (tolerando texto em volta) e confere o perfil. */
export function parseProfileAnswer(raw: string, deckId: string): { profile: DeckProfile; why: Record<string, string> } | { error: string } {
  const json = extractJson(raw);
  if (!json) return { error: 'a resposta não tem um JSON' };
  let body: { profile?: unknown; why?: unknown };
  try {
    body = JSON.parse(json) as { profile?: unknown; why?: unknown };
  } catch (e) {
    return { error: `JSON ilegível: ${e instanceof Error ? e.message : String(e)}` };
  }
  const candidate = body.profile && typeof body.profile === 'object' ? { ...(body.profile as object), id: deckId } : body.profile;
  const profile = validateProfile(candidate);
  if (typeof profile === 'string') return { error: `perfil inválido: ${profile}` };
  const why: Record<string, string> = {};
  if (body.why && typeof body.why === 'object') for (const [k, v] of Object.entries(body.why as Record<string, unknown>)) if (typeof v === 'string') why[k] = v.slice(0, 500);
  return { profile, why };
}

/** O primeiro objeto JSON do texto (a resposta pode vir com um cerca de markdown). */
export function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

const REVIEW_SYSTEM = `Você é um jogador competitivo de One Piece Card Game revisando as jogadas de um bot que joga um deck com guia.
Receberá o guia, o perfil (o que o bot sabe do deck) e o traço de uma partida: turno a turno, as jogadas do bot por nome de carta, com a mão e os DON!! dele.
Aponte as jogadas que fogem do plano do guia. Para cada uma: o turno, o que o bot fez, o que o guia pede e o CONCEITO GENÉRICO que parece faltar na avaliação do bot
(ex.: "guardar DON!! para o Evento [Counter]", "não baixar o finalizador sem alvo"), nunca uma regra só para este deck.
Responda em português, em markdown curto: uma lista com no máximo 8 itens, cada um com "Turno N:", "Fez:", "Guia:", "Conceito:". Se nada fugiu, diga isso em uma linha.`;

/** Revisão de uma partida: as discrepâncias entre o que o bot fez e o guia. */
export async function reviewMatch(complete: Complete, input: { guide: string; profile: DeckProfile | null; trace: string }): Promise<string> {
  const user = `GUIA:\n${input.guide}\n\nPERFIL:\n${input.profile ? JSON.stringify(input.profile) : '(sem perfil)'}\n\nTRAÇO DA PARTIDA:\n${input.trace}`;
  return (await complete(REVIEW_SYSTEM, user, 8_000)).trim();
}

const EXPLAIN_SYSTEM = `Você explica, em uma frase curta em português e em segunda pessoa do bot ("Ataquei o Líder porque…"), por que um bot de One Piece Card Game escolheu uma jogada.
Receberá a jogada, a nota e os termos da avaliação que mais mudaram (positivo = bom para o bot). Não invente motivos que os termos não mostram. Só a frase.`;

export async function explainLine(complete: Complete, input: { line: string; score: number; terms: Array<{ key: string; delta: number }>; alternatives: Array<{ line: string; score: number }> }): Promise<string> {
  const user = `Jogada: ${input.line}\nNota: ${input.score}\nTermos: ${input.terms.map((t) => `${t.key} ${t.delta > 0 ? '+' : ''}${t.delta}`).join(', ') || '(nenhum)'}\nAlternativas: ${input.alternatives.map((a) => `${a.line} (${a.score})`).join('; ') || '(nenhuma)'}`;
  return (await complete(EXPLAIN_SYSTEM, user, 400)).trim();
}
