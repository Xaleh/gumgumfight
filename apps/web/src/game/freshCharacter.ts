// Personagem que acabou de entrar em campo: no turno em que entra ele não ataca, a não ser com [Rush].

import { type GameState, hasKeyword, locate } from '@gumgum/engine';

/**
 * O Personagem em pé de quem está jogando o turno entrou em campo neste turno e não pode atacar nele: não tem
 * [Rush] nem [Rush: Character] (impressos ou dados por um efeito). A mesa o mostra apagado no turno do oponente,
 * para dar para ver de relance quais Personagens dele ainda podem vir para cima.
 *
 * Só olha a mesa, sem depender de de quem é a jogada agora: vale igual no meio de um ataque ou de um efeito.
 */
export function enteredWithoutRush(state: GameState, uid: string): boolean {
  if (state.phase !== 'main') return false;
  const at = locate(state, uid);
  if (!at || at.zone !== 'character' || at.player !== state.activePlayer || at.fc.rested) return false;
  return at.fc.playedOnTurn === state.turn && !hasKeyword(state, uid, 'rush') && !hasKeyword(state, uid, 'rushCharacter');
}
