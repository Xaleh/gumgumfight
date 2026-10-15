// Artes alternativas (Parallel, Manga, promos…): a carta é a mesma, só muda a imagem.
//
// A escolha fica no deck (`DeckList.arts`, número da carta -> `CardArt.id`). Na partida, cada
// instância leva a URL da arte escolhida (`CardInstance.art`), e a visão de cada jogador só copia
// a arte das cartas que ele vê: a arte não revela nada da mão ou do deck do oponente.

import type { CardData, DeckList, GameState } from './types';

type ArtSource = Pick<CardData, 'imageUrl' | 'arts'>;
type Lookup = Map<string, ArtSource> | ((id: string) => ArtSource | undefined);

const lookup = (cards: Lookup, id: string) => (typeof cards === 'function' ? cards(id) : cards.get(id));

/** Imagem da carta com a arte `artId` (arte inexistente = a imagem normal; carta sem imagem = imagens desligadas). */
export function artImage(card: ArtSource, artId?: string): string | undefined {
  if (!card.imageUrl) return undefined;
  return (artId ? card.arts?.find((a) => a.id === artId)?.imageUrl : undefined) ?? card.imageUrl;
}

/** A carta com a imagem da arte escolhida (a mesma carta, se não muda nada). */
export function withArt<T extends CardData>(card: T, artId?: string): T {
  const url = artImage(card, artId);
  return url === card.imageUrl ? card : { ...card, imageUrl: url };
}

/** Imagem de uma carta da partida, com a arte escolhida no deck. */
export function cardImage(state: Pick<GameState, 'cards' | 'defs'>, uid: string): string | undefined {
  const inst = state.cards[uid];
  const def = inst ? state.defs[inst.cardId] : undefined;
  if (!def?.imageUrl) return undefined;
  return inst.art ?? def.imageUrl;
}

/** As cartas do deck (Líder e lista). */
const deckIds = (deck: Pick<DeckList, 'leader' | 'cards'>) => new Set([deck.leader, ...deck.cards.map((c) => c.id)]);

/**
 * Só as escolhas que valem: carta que está no deck e arte que a carta tem. Uma arte que sumiu
 * (carta reimportada) volta para a imagem normal sem impedir nada. Sem escolhas = `undefined`.
 */
export function cleanArts(deck: Pick<DeckList, 'leader' | 'cards' | 'arts'>, cards: Lookup): Record<string, string> | undefined {
  if (!deck.arts || typeof deck.arts !== 'object') return undefined;
  const ids = deckIds(deck);
  const out: Record<string, string> = {};
  for (const [id, art] of Object.entries(deck.arts)) {
    if (typeof art !== 'string' || !ids.has(id)) continue;
    if (lookup(cards, id)?.arts?.some((a) => a.id === art)) out[id] = art;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Cartas do deck que têm arte alternativa. */
export function cardsWithArts(deck: Pick<DeckList, 'leader' | 'cards'>, cards: Lookup): string[] {
  return [...deckIds(deck)].filter((id) => id && (lookup(cards, id)?.arts?.length ?? 0) > 0);
}

/**
 * A primeira arte alternativa de cada carta do deck que tem alguma (botão "aplicar artes" do
 * construtor). As escolhas que já existem ficam como estão.
 */
export function applyFirstArts(deck: Pick<DeckList, 'leader' | 'cards' | 'arts'>, cards: Lookup): Record<string, string> {
  const out: Record<string, string> = { ...cleanArts(deck, cards) };
  for (const id of cardsWithArts(deck, cards)) out[id] ??= lookup(cards, id)!.arts![0].id;
  return out;
}

/** Escolhas de arte vindas de fora (corpo de uma requisição, replay): só pares texto -> texto, sem exagero. */
export function parseArts(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [id, art] of Object.entries(v as Record<string, unknown>).slice(0, 61)) {
    if (typeof art === 'string' && art && art.length <= 200 && id.length <= 40) out[id] = art;
  }
  return Object.keys(out).length ? out : undefined;
}

// ------------------------------------------------------------------ imagens pelo mesmo domínio

/**
 * Origens das imagens aceitas pela rota `/card-img/` do servidor: prefixo público → endereço de
 * origem. Só estas (nada de proxy aberto). O navegador precisa da mesma tabela para reescrever
 * as URLs antes de desenhar cartas num canvas (ver `proxiedImageUrl`).
 */
export const CARD_IMAGE_ORIGINS: Record<string, string> = {
  optcgapi: 'https://optcgapi.com/media/',
  optcgleaks: 'https://images.optcgleaks.com/',
};

export const CARD_IMAGE_PREFIX = '/card-img/';

/** Caminho seguro: letras, números e `_ - . /`, sem `..` e com extensão de imagem. */
export const CARD_IMAGE_SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9_\-./]+\.(?:jpe?g|png|webp)$/i;

/**
 * URL da imagem pelo mesmo domínio do site (`/card-img/<origem>/<caminho>`), para o canvas poder
 * ser exportado (uma imagem de outro domínio sem CORS "contamina" o canvas). Null = origem
 * desconhecida: a carta é desenhada sem arte.
 */
export function proxiedImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const [key, base] of Object.entries(CARD_IMAGE_ORIGINS)) {
    if (!url.startsWith(base)) continue;
    const path = url.slice(base.length).split(/[?#]/)[0];
    return CARD_IMAGE_SAFE_PATH.test(path) ? `${CARD_IMAGE_PREFIX}${key}/${path}` : null;
  }
  return null;
}
