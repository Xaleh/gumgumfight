// O que acontece com a busca por oponente quando o jogador abre outra tela. A fila acompanha quem só navega
// e lê; onde se joga ou se edita algo, a partida que chega tiraria o jogador do meio (e o trabalho se perderia),
// então abrir essas telas pede para sair da fila.

/**
 * - `keep`: a fila continua (a busca fica minimizada na tela).
 * - `ask`: pergunta antes ("Sair da fila e abrir").
 * - `leave`: sai da fila sem perguntar (o jogador já entrou numa partida ou sala, e o servidor tirou o bilhete).
 */
export type QueuePolicy = 'keep' | 'ask' | 'leave';

/** Telas de navegar e ler: a home, estatísticas, perfis, as lições (a lista), torneios e partidas para assistir. */
const KEEP = new Set(['menu', 'stats', 'profile', 'learn', 'tournaments', 'watch-list', 'watch']);

/** Telas de uma partida ou sala do servidor. */
const LEAVE = new Set(['online', 'yonko-online']);

/** `replay`: a tela `game` está só mostrando um replay (não é uma partida contra o bot). */
export function queuePolicy(screen: string, replay = false): QueuePolicy {
  if (KEEP.has(screen) || (screen === 'game' && replay)) return 'keep';
  return LEAVE.has(screen) ? 'leave' : 'ask';
}

/** Telas de mesa (assistir e replay): a busca minimizada sobe para o alto, longe da mão e dos controles. */
export const queuePillOnTop = (screen: string) => screen === 'watch' || screen === 'game';
