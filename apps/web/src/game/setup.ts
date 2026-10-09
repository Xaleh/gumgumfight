// Monta a configuração de uma partida (treino contra o bot ou replay) a partir dos decks
// e, no replay, do roteiro gravado. Usado pelo menu, pelo arquivo de replay baixado e
// pelos replays gravados no servidor (auditoria dos torneios e das ranqueadas).

import { type Action, type CardData, type DeckList, type PlayerId, REPLAY_VERSION, replayConfig, upgradeReplayActions } from '@gumgum/engine';
import { api, type FormatId } from '../api';
import type { GameMode, GameSetup, ReplayFile } from './useGame';

export async function buildSetup(
  mode: GameMode,
  deckIds: [string, string],
  names: [string, string],
  seed: number,
  format: FormatId,
  firstPlayer?: PlayerId,
  script?: Action[],
  /** Replay com as listas exatas da partida (e, online, a seed de 128 bits). */
  online?: { decks: [DeckList, DeckList]; seed128?: number[] },
  /** Sem `firstPlayer`: o vencedor do sorteio escolhe se joga primeiro. */
  chooseFirst = firstPlayer === undefined,
  /** Versão do replay (as anteriores à atual ganham as respostas implícitas e, até a 8, a preparação antiga). */
  replayVersion?: number,
): Promise<GameSetup> {
  let a: { deck: DeckList; cards: CardData[] };
  let b: typeof a;
  if (online) {
    const all = await api.cards();
    const used = new Set(online.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]));
    const pool = all.filter((c) => used.has(c.id));
    a = { deck: online.decks[0], cards: pool };
    b = { deck: online.decks[1], cards: [] };
  } else {
    const decks = Promise.all(deckIds.map((id) => api.deck(id)));
    [a, b] =
      mode === 'replay'
        ? await decks.catch((e: unknown) => {
            const why = e instanceof Error ? e.message : String(e);
            throw new Error(`Não foi possível abrir os decks deste replay (${why}). O deck pode ter sido apagado ou ser de outra conta.`);
          })
        : await decks;
  }
  const cards = new Map<string, CardData>();
  for (const c of [...a.cards, ...b.cards]) cards.set(c.id, c);
  const setup: GameSetup = {
    mode,
    deckIds,
    format,
    script,
    config: {
      seed,
      ...(online?.seed128 ? { seed128: online.seed128 } : {}),
      firstPlayer,
      ...(chooseFirst && firstPlayer === undefined ? { chooseFirst: true } : {}),
      cards: [...cards.values()],
      players: [
        { name: names[0], deck: a.deck, isBot: false },
        { name: names[1], deck: b.deck, isBot: mode !== 'replay' },
      ],
    },
  };
  if (script && replayVersion !== undefined && replayVersion < REPLAY_VERSION) {
    setup.config = replayConfig(setup.config, replayVersion);
    setup.script = upgradeReplayActions(setup.config, script);
  }
  return setup;
}

/** Partida em modo replay a partir do conteúdo de um arquivo de replay (ou do replay gravado no servidor). */
export function setupFromReplayText(text: string): Promise<GameSetup> {
  let r: ReplayFile;
  try {
    r = JSON.parse(text) as ReplayFile;
  } catch {
    throw new Error('O arquivo não é um replay do GumGum Fight (não é um JSON válido).');
  }
  return setupFromReplay(r);
}

export function setupFromReplay(r: ReplayFile): Promise<GameSetup> {
  if (r?.format !== 'gumgumfight-replay' || !Array.isArray(r.actions)) throw new Error('O arquivo não é um replay do GumGum Fight.');
  if ((r.version ?? 1) > REPLAY_VERSION) {
    throw new Error('Este replay foi gravado por uma versão mais nova do jogo. Recarregue a página e tente de novo.');
  }
  // Com as listas no arquivo (partidas online e replays baixados desde o card 73), os decks não precisam existir.
  const lists = r.decks ? { decks: r.decks, seed128: r.seed128 } : undefined;
  // Com a escolha do vencedor, o primeiro jogador sai da própria ação gravada.
  const first = r.chooseFirst ? undefined : r.firstPlayer;
  const names = r.names ?? ['Jogador 1', 'Jogador 2'];
  return buildSetup('replay', r.deckIds, names, r.seed, 'standard', first, r.actions, lists, Boolean(r.chooseFirst), r.version ?? 1);
}
