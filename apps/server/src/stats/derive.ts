// Fatos de uma partida para as estatísticas, tirados de uma nova simulação do
// replay (seed + decks + ações). O motor é determinístico, então o servidor não
// confia no que o navegador diz sobre mão inicial, cartas jogadas ou vencedor:
// ele refaz a partida e lê tudo do próprio estado do jogo.

import { createHash } from 'node:crypto';
import { type Action, applyAction, type CardData, createGame, type DeckList, type GameState, type PlayerId } from '@gumgum/engine';

export interface ReplayInput {
  seed: number;
  /** Como veio na configuração da partida (omitido = sorteado pelo RNG). */
  firstPlayer?: PlayerId;
  decks: [DeckList, DeckList];
  actions: Action[];
}

export interface SeatFacts {
  leader: string;
  deckHash: string;
  wentFirst: boolean;
  won: boolean;
  /** Trocou a mão no início. */
  mulligan: boolean;
  /** Por carta (sem o Líder): cópias no deck, na mão mantida, vistas na mão e jogadas. */
  cards: Map<string, { copies: number; opening: number; drawn: number; played: number }>;
}

export interface MatchFacts {
  winner: PlayerId;
  turns: number;
  reason: string | null;
  firstPlayer: PlayerId;
  seats: [SeatFacts, SeatFacts];
}

const MAX_ACTIONS = 5000;

/** Identifica a lista exata (Líder + cartas), independente da ordem e do nome. */
export function deckHash(deck: Pick<DeckList, 'leader' | 'cards'>): string {
  const counts = new Map<string, number>();
  for (const c of deck.cards) counts.set(c.id, (counts.get(c.id) ?? 0) + c.count);
  const canon = [deck.leader, ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${n}x${id}`)].join('|');
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

/** Refaz a partida. Lança erro se o replay não for legal ou não terminar. */
export function deriveMatch(input: ReplayInput, cards: CardData[]): MatchFacts {
  let state = createGame({
    seed: input.seed,
    firstPlayer: input.firstPlayer,
    cards,
    players: [
      { name: 'A', deck: input.decks[0] },
      { name: 'B', deck: input.decks[1] },
    ],
  });
  const cardId = (s: GameState, uid: string) => s.cards[uid].cardId;
  const seen = [new Set<string>(), new Set<string>()];
  const opening: Array<string[] | null> = [null, null];
  const mulligan = [false, false];
  const played = [new Map<string, number>(), new Map<string, number>()];
  // A mão descartada no mulligan não conta como "vista": volta para o deck.
  const markHands = (s: GameState) => {
    for (const p of [0, 1] as const) {
      if (s.players[p].mulliganDone) for (const uid of s.players[p].hand) seen[p].add(uid);
    }
  };
  markHands(state);

  if (input.actions.length > MAX_ACTIONS) throw new Error('Replay longo demais.');
  for (const action of input.actions) {
    if (state.phase === 'gameover') throw new Error('Ações depois do fim da partida.');
    const before = state;
    state = applyAction(state, action);
    const p = action.player;
    if (action.type === 'mulligan') mulligan[p] = action.redraw;
    // Mão mantida: a mão de cada jogador logo depois do próprio mulligan.
    for (const q of [0, 1] as const) {
      if (!opening[q] && state.players[q].mulliganDone) opening[q] = [...state.players[q].hand];
    }
    if (action.type === 'playCard' || action.type === 'counter') {
      const id = cardId(before, action.uid);
      played[p].set(id, (played[p].get(id) ?? 0) + 1);
    }
    markHands(state);
  }
  if (state.phase !== 'gameover' || state.winner === null) throw new Error('O replay não chega ao fim da partida.');

  const seats = ([0, 1] as const).map((p): SeatFacts => {
    const deck = input.decks[p];
    const perCard: SeatFacts['cards'] = new Map();
    const row = (id: string) => {
      let r = perCard.get(id);
      if (!r) perCard.set(id, (r = { copies: 0, opening: 0, drawn: 0, played: 0 }));
      return r;
    };
    for (const c of deck.cards) row(c.id).copies += c.count;
    for (const uid of opening[p] ?? []) row(cardId(state, uid)).opening++;
    for (const uid of seen[p]) row(cardId(state, uid)).drawn++;
    for (const [id, n] of played[p]) if (perCard.has(id)) row(id).played += n;
    return {
      leader: deck.leader,
      deckHash: deckHash(deck),
      wentFirst: state.firstPlayer === p,
      won: state.winner === p,
      mulligan: mulligan[p],
      cards: perCard,
    };
  }) as [SeatFacts, SeatFacts];

  return { winner: state.winner, turns: state.turn, reason: state.winReason, firstPlayer: state.firstPlayer, seats };
}
