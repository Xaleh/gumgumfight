// Trecho de replay para vídeo ou GIF ("jogada da semana", roadmap F2).
//
// O trecho sai para as redes, então cada quadro só leva o que um espectador vê: a visão de
// espectador (`viewFor(…, null)`) com `revealEnd: false`, até no fim de jogo (o replay tem as
// duas mãos e os dois decks; o vídeo não). Da mão, do deck e da Vida virada para baixo só vão as
// quantidades. A carta em destaque segue a regra da tela de transmissão (`highlightedCard`).

import { cardImage } from './art';
import { applyAction, cardDef, getPower } from './engine';
import { ReplayCursor } from './replay';
import type { Action, CardDef, FieldCard, GameState, PlayerId } from './types';
import { HIDDEN_CARD, identityAliases, viewFor } from './view';

export type HighlightKind = 'play' | 'counter' | 'activate';

/**
 * A carta que a ação pôs em evidência na tela de transmissão: a que entrou em jogo, foi usada no
 * Counter ou ativou um efeito. Null se a ação não mostra carta ou se a carta não está à vista em `state`
 * (o estado depois da ação, já na visão de quem assiste).
 */
export function highlightedCard(state: GameState, action: Action): { uid: string; player: PlayerId; kind: HighlightKind } | null {
  const hit =
    action.type === 'playCard'
      ? { uid: action.uid, kind: 'play' as const }
      : action.type === 'counter'
        ? { uid: action.uid, kind: 'counter' as const }
        : action.type === 'activate'
          ? { uid: action.uid, kind: 'activate' as const }
          : null;
  if (!hit || !state.cards[hit.uid] || cardDef(state, hit.uid).id === HIDDEN_CARD) return null;
  return { ...hit, player: action.player };
}

/** Uma carta à vista no quadro. */
export interface ClipCard {
  uid: string;
  cardId: string;
  name: string;
  category: CardDef['category'];
  colors: string[];
  /** Imagem (com a arte alternativa escolhida no deck), se a carta tem. */
  image?: string;
  /** Poder atual (em campo) ou impresso. */
  power?: number;
  rested?: boolean;
  /** DON!! anexados. */
  don?: number;
}

export interface ClipSide {
  name: string;
  leader: ClipCard;
  characters: ClipCard[];
  stage: ClipCard | null;
  /** Só as quantidades: o conteúdo da mão, do deck e da Vida virada para baixo não sai no vídeo. */
  hand: number;
  deck: number;
  life: number;
  /** Cartas de Vida viradas para cima (públicas). */
  lifeFaceUp: ClipCard[];
  donActive: number;
  donRested: number;
  donDeck: number;
  trash: number;
  /** Carta do topo do descarte. */
  trashTop: ClipCard | null;
}

export interface ClipFrame {
  /** Posição no roteiro do replay (quantas ações já foram aplicadas). */
  pos: number;
  turn: number;
  phase: GameState['phase'];
  activePlayer: PlayerId;
  winner: PlayerId | null;
  players: [ClipSide, ClipSide];
  /** Carta em destaque (a da ação que levou a este quadro). */
  highlight: { card: ClipCard; player: PlayerId; kind: HighlightKind } | null;
  /** Batalha em andamento: quem ataca e quem é atacado (uids das cartas em campo). */
  battle: { attacker: string; target: string } | null;
}

/** Visão de quem assiste: nada escondido, nem no fim (as listas não saem do replay pelo vídeo). */
export function spectatorView(state: GameState): GameState {
  return viewFor(state, null, identityAliases(state), [], { revealEnd: false });
}

function clipCard(view: GameState, uid: string, fc?: FieldCard): ClipCard {
  const def = cardDef(view, uid);
  const image = cardImage(view, uid);
  const power = fc ? getPower(view, uid) : def.power;
  return {
    uid,
    cardId: def.id,
    name: def.name,
    category: def.category,
    colors: def.colors,
    ...(image ? { image } : {}),
    ...(power !== undefined ? { power } : {}),
    ...(fc ? { rested: fc.rested, don: fc.don } : {}),
  };
}

/** O quadro do estado `state` (na posição `pos`), sem nada escondido. `action`: a que levou até ele. */
export function clipFrame(state: GameState, pos: number, action?: Action): ClipFrame {
  const view = spectatorView(state);
  const side = (p: PlayerId): ClipSide => {
    const ps = view.players[p];
    const top = ps.trash[ps.trash.length - 1];
    return {
      name: ps.name,
      leader: clipCard(view, ps.leader.uid, ps.leader),
      characters: ps.characters.map((c) => clipCard(view, c.uid, c)),
      stage: ps.stage ? clipCard(view, ps.stage.uid, ps.stage) : null,
      hand: ps.hand.length,
      deck: ps.deck.length,
      life: ps.life.length,
      lifeFaceUp: (ps.lifeFaceUp ?? []).filter((u) => cardDef(view, u).id !== HIDDEN_CARD).map((u) => clipCard(view, u)),
      donActive: ps.donActive,
      donRested: ps.donRested,
      donDeck: ps.donDeck,
      trash: ps.trash.length,
      trashTop: top ? clipCard(view, top) : null,
    };
  };
  const hit = action ? highlightedCard(view, action) : null;
  const b = view.battle;
  return {
    pos,
    turn: view.turn,
    phase: view.phase,
    activePlayer: view.activePlayer,
    winner: view.phase === 'gameover' ? view.winner : null,
    players: [side(0), side(1)],
    highlight: hit ? { card: clipCard(view, hit.uid), player: hit.player, kind: hit.kind } : null,
    battle: b && cardDef(view, b.attacker).id !== HIDDEN_CARD ? { attacker: b.attacker, target: b.target } : null,
  };
}

/** O que muda de um quadro para outro na tela (a posição no roteiro, não). */
const look = (f: ClipFrame) => JSON.stringify({ ...f, pos: 0 });

/**
 * Os quadros do trecho `from`…`to` do replay (posições do roteiro, `to` incluída): o primeiro é a
 * mesa na posição `from`, e cada ação seguinte gera um quadro. Ações que não mudam nada à vista
 * (escolhas escondidas, respostas sem efeito) não geram quadro novo. Para numa ação que o motor
 * recusa, como o replay.
 */
export function clipFrames(initial: GameState, actions: readonly Action[], from: number, to: number): ClipFrame[] {
  const cursor = new ReplayCursor(initial, actions);
  const start = Math.max(0, Math.min(Math.floor(from), Math.floor(to)));
  const end = Math.max(start, Math.min(Math.floor(to), actions.length));
  let state = cursor.seek(start);
  const frames: ClipFrame[] = [clipFrame(state, cursor.pos)];
  for (let i = cursor.pos; i < end; i++) {
    try {
      state = applyAction(state, actions[i]);
    } catch {
      break;
    }
    const f = clipFrame(state, i + 1, actions[i]);
    if (look(f) !== look(frames[frames.length - 1])) frames.push(f);
    if (state.phase === 'gameover') break;
  }
  return frames;
}
