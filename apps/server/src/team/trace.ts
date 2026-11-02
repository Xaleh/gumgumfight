// Traço de uma partida gravada para o agente revisar (docs/plano-bot-time.md, seção 6): turno a turno, as
// jogadas do assento do bot por nome de carta, com a mão, os DON!! e a Vida dos dois lados no começo de cada
// turno dele. É o que o modelo compara com o guia.

import { type Action, applyAction, type CardData, cardDef, createGame, type DeckList, type GameConfig, type GameState, type PlayerId, REPLAY_VERSION, replayConfig, upgradeReplayActions } from '@gumgum/engine';
import { type DB, getCards } from '../db';
import { loadReplay } from '../decisions/extract';
import { pinEngineTexts } from '../online/room';

const name = (s: GameState, uid: string) => (s.cards[uid] ? cardDef(s, uid).name : '?');

/** Uma jogada por extenso ("Ataca Zoro (5000) com Luffy (6000)"). */
export function describePlay(s: GameState, a: Action): string | null {
  switch (a.type) {
    case 'playCard':
      return `baixa ${name(s, a.uid)}`;
    case 'activate':
      return `ativa ${name(s, a.uid)}`;
    case 'attachDon':
      return `anexa DON!! em ${name(s, a.target)}`;
    case 'attack':
      return `ataca ${name(s, a.target)} com ${name(s, a.attacker)}`;
    case 'counter':
      return `Counter com ${name(s, a.uid)}${a.target ? ` em ${name(s, a.target)}` : ''}`;
    case 'pass':
      return 'não usa Counter';
    case 'choose':
      return a.uids.length ? `escolhe ${a.uids.map((u) => name(s, u)).join(', ')}` : 'não escolhe nada';
    case 'answer':
      return a.yes ? 'responde sim' : 'responde não';
    case 'option':
      return `opção ${a.index + 1}`;
    case 'mulligan':
      return a.redraw ? 'troca a mão' : 'mantém a mão';
    case 'endTurn':
      return 'encerra o turno';
    default:
      return null;
  }
}

/** O traço do assento `seat` numa partida gravada (null se o replay não refaz). */
export function matchTrace(db: DB, matchId: number, seat: PlayerId): string | null {
  const loaded = loadReplay(db, matchId);
  if ('error' in loaded) return null;
  return buildTrace(loaded.attempts, seat);
}

/** O arquivo de replay que a tela baixa ("Baixar replay") e os parceiros recebem. */
export interface ReplayFileInput {
  seed: number;
  seed128?: number[];
  firstPlayer?: PlayerId;
  chooseFirst?: boolean;
  legacySetup?: boolean;
  version?: number;
  decks: [DeckList, DeckList];
  actions: Action[];
  names?: string[];
  engineTexts?: Record<string, never>;
}

/**
 * O traço a partir de um arquivo de replay (as cartas vêm do banco, que precisa tê-las): para revisar uma partida
 * fora do servidor, sem a chave do agente (`npm run bot:agent -- trace replay.json`).
 */
export function fileTrace(db: DB, file: ReplayFileInput, seat: PlayerId): string | null {
  if (!Array.isArray(file.decks) || file.decks.length !== 2 || !Array.isArray(file.actions)) return null;
  const ids = [...new Set(file.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]))];
  const cards = pinEngineTexts(getCards(db, ids) as CardData[], file.engineTexts as Parameters<typeof pinEngineTexts>[1]);
  const config: GameConfig = {
    seed: file.seed,
    seed128: file.seed128,
    firstPlayer: file.firstPlayer,
    chooseFirst: file.chooseFirst,
    legacySetup: file.legacySetup,
    cards,
    players: [
      { name: file.names?.[0] ?? 'A', deck: file.decks[0] },
      { name: file.names?.[1] ?? 'B', deck: file.decks[1] },
    ],
  };
  const version = file.version ?? (file.legacySetup ? 8 : REPLAY_VERSION);
  const attempts: Array<{ config: GameConfig; actions: Action[] }> = [];
  try {
    if (version < REPLAY_VERSION) {
      const c = replayConfig(config, version);
      attempts.push({ config: c, actions: upgradeReplayActions(c, file.actions) });
    } else {
      attempts.push({ config, actions: file.actions });
      if (file.version === undefined) attempts.push({ config, actions: upgradeReplayActions(config, file.actions) });
    }
  } catch {
    return null;
  }
  return buildTrace(attempts, seat);
}

function buildTrace(attempts: Array<{ config: GameConfig; actions: Action[] }>, seat: PlayerId): string | null {
  for (const { config, actions } of attempts) {
    try {
      let s = createGame(config);
      const lines: string[] = [];
      let turnShown = 0;
      for (const a of actions) {
        if (s.phase === 'gameover') break;
        if (a.player === seat) {
          const me = s.players[seat];
          const opp = s.players[seat === 0 ? 1 : 0];
          if (s.activePlayer === seat && s.turn !== turnShown && s.phase === 'main') {
            turnShown = s.turn;
            lines.push('');
            lines.push(`TURNO ${s.turn} (bot): Vida ${me.life.length} x ${opp.life.length} | DON!! ${me.donActive} | mão: ${me.hand.map((u) => name(s, u)).join(', ') || '(vazia)'} | campo: ${me.characters.map((c) => `${name(s, c.uid)}${c.rested ? ' (virado)' : ''}`).join(', ') || '(vazio)'} | campo dele: ${opp.characters.map((c) => `${name(s, c.uid)}${c.rested ? ' (virado)' : ''}`).join(', ') || '(vazio)'}`);
          }
          const text = describePlay(s, a);
          if (text) lines.push(`${s.activePlayer === seat ? '  ' : '  (turno do oponente) '}${text}`);
        }
        s = applyAction(s, a);
      }
      lines.push('');
      lines.push(s.phase === 'gameover' ? `FIM: ${s.winner === seat ? 'o bot venceu' : s.winner === null ? 'empate' : 'o bot perdeu'} no turno ${s.turn}` : 'FIM: partida não terminou');
      return lines.join('\n').trim();
    } catch {
      /* a próxima tentativa pode refazer */
    }
  }
  return null;
}
