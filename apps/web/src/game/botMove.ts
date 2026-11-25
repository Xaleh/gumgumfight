// A jogada do bot na partida do navegador: o mesmo cálculo roda no Web Worker (botWorker.ts) e, se ele
// não estiver disponível, na própria página (botClient.ts).

import {
  type Action,
  actionFromView,
  type BotExplanation,
  type BotLevel,
  type BotPersonality,
  chooseBotAction,
  chooseSimpleBotAction,
  type DeckGuess,
  type DeckProfile,
  type GameState,
  identityAliases,
  type PlayerId,
  viewFor,
} from '@gumgum/engine';

export interface BotRequest {
  state: GameState;
  player: PlayerId;
  level: BotLevel;
  /** Estilo do bot (agressivo, controle, conservador); o Bot do Time ignora. */
  personality?: BotPersonality;
  /** Bot do Time: o perfil do deck que o bot joga (pesos, papéis das cartas, mulligan). */
  profile?: DeckProfile;
  /** Bot do Time: devolve as explicações da jogada (painel do treinador). */
  explain?: boolean;
  /** O deck provável do Líder do oponente do bot (`/api/bot/hand-guess`): a mão provável dele sai daqui. */
  handGuess?: DeckGuess;
}

export interface BotMove {
  action: Action;
  /** As explicações da decisão, com as ações já nos uids reais (vazio sem `explain`). */
  explanations: BotExplanation[];
}

/**
 * Jogada do bot a partir da visão dele (como no servidor): ele não enxerga a mão nem o deck do humano.
 * Se a tradução de volta falhar (não deveria), o bot heurístico decide pelo estado completo para a
 * partida não travar.
 */
export function computeBotMove({ state, player, level, personality, profile, explain, handGuess }: BotRequest): BotMove {
  const aliases = identityAliases(state);
  const toReal = (a: Action): Action => {
    const r = actionFromView(state, aliases, a);
    return typeof r === 'string' ? a : r;
  };
  const explanations: BotExplanation[] = [];
  const team = level === 'team';
  const over = {
    ...(team && profile ? { profile } : {}),
    ...(!team && personality ? { personality } : {}),
    ...(handGuess && level !== 'easy' ? { handGuess } : {}),
    ...(team && explain
      ? {
          explain: (e: BotExplanation) =>
            explanations.push({ ...e, actions: e.actions.map(toReal), alternatives: e.alternatives.map((alt) => ({ ...alt, actions: alt.actions.map(toReal) })) }),
        }
      : {}),
  };
  const real = actionFromView(state, aliases, chooseBotAction(viewFor(state, player, aliases), player, level, Object.keys(over).length ? over : undefined));
  return { action: typeof real === 'string' ? chooseSimpleBotAction(state, player) : real, explanations };
}
