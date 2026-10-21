// Jogadas de uma partida para o Judge e o organizador: o que cada jogador fez, a pergunta que estava
// aberta (com as opções que havia) e o que ele escolheu, mais as linhas do log que a jogada gerou.
//
// A partida em andamento vem pronta do servidor (`api.tournaments.plays`, sem a seed); um jogo já
// gravado sai do replay, refeito aqui. Os dois chegam no mesmo formato (`JudgePlays`), e o texto de
// cada jogada é o mesmo dos "cliques do jogador" do replay (`describeReplayAction`).

import { applyAction, createGame, type GameState, type Pending, translateToPt } from '@gumgum/engine';
import type { JudgePlay, JudgePlays } from '../api';
import type { Locale } from '../i18n';
import { listText, logText, msgText, type TryT } from './engineText';
import { describeReplayAction, type ReplayCue } from './replayCue';
import type { GameSetup } from './useGame';

/** Jogadas de um jogo gravado (o replay completo, depois do fim), no formato da partida em andamento. */
export function playsFromSetup(setup: GameSetup): JudgePlays {
  let state = createGame(setup.config);
  const plays: JudgePlay[] = [];
  for (const [count, action] of (setup.script ?? []).entries()) {
    const before = state;
    try {
      state = applyAction(before, action);
    } catch {
      break;
    }
    plays.push({ count, turn: before.turn, player: action.player, action, pending: before.pending ?? null, lines: state.log.slice(before.log.length) });
  }
  return {
    actionCount: state.actionCount,
    names: [state.players[0].name, state.players[1].name],
    plays,
    pending: state.pending ?? null,
    cards: Object.fromEntries(Object.entries(state.cards).map(([uid, c]) => [uid, c.cardId])),
    defs: state.defs,
  };
}

/**
 * O pedaço do estado que a descrição de uma jogada lê (os nomes, as cartas citadas e a pergunta aberta):
 * a partida em andamento só manda isso, e não o estado inteiro.
 */
function citedState(data: JudgePlays, pending: Pending | null): GameState {
  const cards = Object.fromEntries(Object.entries(data.cards).map(([uid, cardId]) => [uid, { uid, cardId }]));
  return { players: data.names.map((name) => ({ name })), cards, defs: data.defs, pending } as unknown as GameState;
}

/** Nome de uma carta citada. */
export function citedName(data: JudgePlays, uid: string): string {
  const id = data.cards[uid];
  return (id && data.defs[id]?.name) || '?';
}

/** O que o jogador clicou ou escolheu nesta jogada, com as palavras dos botões e das cartas. */
export function describePlay(data: JudgePlays, play: JudgePlay, locale: Locale): ReplayCue {
  return describeReplayAction(citedState(data, play.pending), play.action, locale);
}

/** Texto da pergunta aberta no idioma da interface (null quando ela não tem texto: Counter, bloqueio…). */
export function askText(tryT: TryT, p: Pending): string | null {
  if (p.kind === 'manual') return p.text;
  if (p.kind !== 'selectTargets' && p.kind !== 'confirm' && p.kind !== 'option') return null;
  return msgText(tryT, p.promptKey, p.promptParams, p.promptParts) ?? (p.prompt || null);
}

/** Rótulo de uma opção de `option`, como o jogador o viu (a chave do motor, ou o texto da carta). */
export function optionText(tryT: TryT, p: Extract<Pending, { kind: 'option' }>, index: number, locale: Locale): string {
  const label = p.options[index] ?? '?';
  const parts = p.optionParts?.[index];
  return (
    (parts ? listText(tryT, parts) : undefined) ??
    tryT(p.optionKeys?.[index]) ??
    (!p.order && !p.don && locale === 'pt-BR' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label)
  );
}

/** As cartas que a pergunta oferecia (alvos, bloqueadores, Counters), para conferir se a escolhida estava entre elas. */
export function offered(p: Pending | null): string[] {
  if (!p) return [];
  return p.kind === 'selectTargets' || p.kind === 'block' || p.kind === 'counter' ? p.options : [];
}

/** Tudo o que a jogada mostra, em texto: para o filtro da lista ("Perospero", o nome do jogador…). */
export function playText(tryT: TryT, data: JudgePlays, play: JudgePlay, cue: ReplayCue): string {
  const ask = play.pending ? askText(tryT, play.pending) : null;
  return [data.names[play.player], cue.title, cue.sub, ask, ...offered(play.pending).map((u) => citedName(data, u)), ...play.lines.map((e) => logText(tryT, e))]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
