// Traço de uma partida gravada para o agente revisar (docs/plano-bot-time.md, seção 6): turno a turno, as
// jogadas do assento do bot por nome de carta, com a mão, os DON!! e a Vida dos dois lados no começo de cada
// turno dele. É o que o modelo compara com o guia.

import { type Action, applyAction, cardDef, createGame, type GameState, type PlayerId } from '@gumgum/engine';
import type { DB } from '../db';
import { loadReplay } from '../decisions/extract';

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
  for (const { config, actions } of loaded.attempts) {
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
