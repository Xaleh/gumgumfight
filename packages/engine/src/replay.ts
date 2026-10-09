// Compatibilidade de replays gravados por versões anteriores do motor.

import { applyAction, createGame } from './engine';
import type { Action, GameConfig, GameState } from './types';

/** Versão atual dos replays (`ReplayFile.version`). */
export const REPLAY_VERSION = 11;

/**
 * Configuração para refazer um replay da versão `version`: até a versão 8, a preparação antiga
 * (`GameConfig.legacySetup`: ordem da Vida e "at the start of the game", DV-24/25).
 */
export function replayConfig<T extends GameConfig>(config: T, version: number | undefined): T {
  return (version ?? 1) < 9 ? { ...config, legacySetup: true } : config;
}

/**
 * Replays de versões anteriores foram gravados quando o motor pulava sem ação etapas que hoje
 * sempre pedem uma: a etapa de Counter sem opções e a carta de Vida sem [Trigger] (versão 1);
 * a pergunta "pagar X?" sem como pagar e as escolhas na mão ou no deck sem opção (versão 2);
 * a escolha da ordem entre efeitos disparados juntos (versão 3) e a de quais DON!! devolver no
 * DON!! −X (versão 4), respondidas com a primeira opção (a ordem antiga: virados, ativos, dados).
 * Esta função insere as respostas implícitas para o roteiro antigo continuar válido. (Desde a
 * versão 4 os efeitos disparados resolvem em outra ordem (CR 8-6): um replay antigo com efeitos
 * encadeados pode tomar outro rumo. Da mesma forma, um [On K.O.] que ativava sem cumprir as
 * condições no campo ([DON!! xX], negação, [Once Per Turn]) hoje não ativa, e o [Once Per Turn] de
 * uma carta que saiu do campo e voltou no mesmo turno hoje pode ser usado de novo; não há decisão
 * nova a inserir, então a versão não mudou.) Até a versão 5, a escolha de alvos sem "up to" aceitava
 * 0 alvos; a gravada com menos alvos do que hoje é obrigatório (8-4-4-1) é completada com as
 * primeiras opções. Até a versão 6, só a primeira substituição aplicável ("… instead") era
 * oferecida, só contra remoção por efeito do oponente (fora `fieldToLife` e "your opponent
 * chooses") e uma vez por Personagem; a pergunta que o roteiro antigo não tem é recusada (o que
 * acontecia antes). Pagar uma vez hoje salva todos os Personagens removidos juntos, então um replay
 * antigo que pagou por cada um pode tomar outro rumo. Até a versão 7, "rest up to 1 of your
 * opponent's DON!! cards or Characters" virava o Personagem sem oferecer a substituição de rest
 * ("If this Character would be rested by your opponent's Character's effect, … instead"); a
 * pergunta também é recusada. (Também desde a versão 8, "cannot be K.O.'d by your opponent's
 * effects" não protege do K.O. pelo próprio efeito, o Personagem protegido não paga custo de K.O.
 * e o Stage protegido não é nocauteado: sem decisão nova, mas um replay antigo pode tomar outro rumo.
 * O mesmo vale para a carta do [Trigger], que hoje fica fora do descarte enquanto resolve, para
 * o Personagem posto na Vida "face-up" (`fieldToLife`), que hoje fica virado para cima, para o
 * Evento [Counter] com redução de custo na mão e para os efeitos de fim de batalha, que hoje
 * resolvem antes de expirar o "during this battle". A ação `counter` ganhou `target` opcional;
 * sem ele, o Counter vai para o atacado, como sempre.) Até a versão 8, a Vida inicial saía na ordem
 * inversa (a carta do topo do deck no topo da Vida) e o "at the start of the game" do Líder resolvia
 * na criação, sem escolha: esses replays precisam da configuração de `replayConfig`. (Desde a versão 9,
 * sem decisão nova e sem mudar a versão: o "at the start of your turn" resolve antes de devolver DON!!,
 * desvirar e comprar, e os "at the end of this turn" esperam também o que os [End of Your Turn]
 * dispararam e incluem os criados na própria End Phase (DV-28/29). Nenhuma carta da base tem efeito de
 * início de turno nem cria efeito adiado na End Phase; um replay antigo com essas combinações pode
 * tomar outro rumo.) Até a versão 9, "draw up to N cards" comprava as N sem perguntar; a pergunta
 * "comprar mais 1?" (4-5-4) é respondida com sim. (Também desde a versão 10, sem decisão nova:
 * "your opponent cannot …" e "until the end of your opponent's next turn" nas restrições a um
 * jogador, e a carta da mão posta na Vida por um efeito com exigência é revelada no log.) Até a versão 10
 * (auditoria das cartas, DV-40/42), estas escolhas não existiam e são respondidas como o motor fazia: "up to
 * N" nos passos de Vida e em "give up to N rested DON!!" (a quantidade máxima); "rest N of your cards"
 * (nenhum DON!!, só as cartas); "turn 1 card from the top or bottom of your Life cards" (o topo); "rest up to N
 * of your opponent's cards" (a carta do campo, se a próxima ação
 * gravada é uma escolha de alvo; senão "Nenhum"); "reveal 1 card … play up to 1", "you may deal 1 damage" e
 * "your opponent may add 1 DON!!" (sim). Uma escolha gravada com mais alvos do que hoje cabe fica com os primeiros, e uma resposta gravada
 * para uma pergunta que hoje não aparece (o efeito deixou de ser oferecido) é descartada; dali em diante
 * a partida pode tomar outro rumo.
 */
export function upgradeReplayActions(config: GameConfig, actions: Action[]): Action[] {
  let state = createGame(config);
  const out: Action[] = [];
  /** Resposta implícita à decisão pendente, a menos que `next` (a próxima ação gravada) já seja ela. */
  const implicit = (next?: Action): Action | null => {
    const p = state.pending;
    if (!p || state.phase === 'gameover') return null;
    if (p.kind === 'counter' && !p.options.length) {
      return next?.type === 'pass' && next.player === p.player ? null : { type: 'pass', player: p.player };
    }
    if (p.kind === 'lifeCard' && !state.defs[state.cards[p.card].cardId].abilities.some((a) => a.timing === 'trigger')) {
      return next?.type === 'answer' && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    if (p.kind === 'confirm' && p.cannot) {
      return next?.type === 'answer' && !next.yes && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    if (p.kind === 'confirm' && p.drawUpTo) {
      return next?.type === 'answer' && next.player === p.player ? null : { type: 'answer', player: p.player, yes: true };
    }
    if (p.kind === 'confirm' && replacementAsked()) {
      return next?.type === 'answer' && next.player === p.player ? null : { type: 'answer', player: p.player, yes: false };
    }
    if (p.kind === 'option' && (p.order || p.don)) {
      return next?.type === 'option' && next.player === p.player ? null : { type: 'option', player: p.player, index: 0 };
    }
    if (p.kind === 'selectTargets' && p.hidden && !p.options.length) {
      return next?.type === 'choose' && !next.uids.length && next.player === p.player ? null : { type: 'choose', player: p.player, uids: [] };
    }
    // Versão 10: escolhas novas da auditoria das cartas.
    const current = currentStep();
    if (p.kind === 'option' && !(next?.type === 'option' && next.player === p.player)) {
      if (current && ['trashLife', 'opponentLifeToHand', 'addLifeFromDeck', 'giveRestedDon', 'lifeFace'].includes(current.do)) return { type: 'option', player: p.player, index: 0 };
      if (current?.do === 'restOwn') return { type: 'option', player: p.player, index: p.options.length - 1 };
      if (current?.do === 'restDonOrCharacter') {
        const card = p.options.findIndex((o) => !/DON!!|Nenhum/.test(o));
        return { type: 'option', player: p.player, index: next?.type === 'choose' && card >= 0 ? card : p.options.length - 1 };
      }
    }
    if (p.kind === 'confirm' && !(next?.type === 'answer' && next.player === p.player)) {
      const frame = state.stack[state.stack.length - 1];
      const after = frame?.kind === 'effect' ? frame.steps[frame.i + 1] : undefined;
      if (current?.do === 'playRevealed' || current?.do === 'opponentAddDon' || (current?.do === 'payCost' && after?.do === 'takeDamage')) {
        return { type: 'answer', player: p.player, yes: true };
      }
    }
    return null;
  };
  const currentStep = () => {
    const frame = state.stack[state.stack.length - 1];
    return frame?.kind === 'effect' ? frame.steps[frame.i] : undefined;
  };
  /** A ação gravada responde à decisão aberta agora? (senão é de uma pergunta que deixou de existir) */
  const fits = (a: Action): boolean => {
    const p = state.pending;
    if (a.type === 'answer') return p?.kind === 'confirm' || p?.kind === 'lifeCard' || p?.kind === 'chooseFirst';
    if (a.type === 'option') return p?.kind === 'option';
    if (a.type === 'choose') return p?.kind === 'selectTargets' || p?.kind === 'block';
    return true;
  };
  /** A pergunta aberta é a de uma substituição contra remoção ou rest (passo `replaceRemoval`/`replaceRest`)? */
  const replacementAsked = () => {
    const frame = state.stack[state.stack.length - 1];
    const step = frame?.kind === 'effect' ? frame.steps[frame.i]?.do : undefined;
    return step === 'replaceRemoval' || step === 'replaceRest';
  };
  const step = (a: Action) => {
    state = applyAction(state, a);
    out.push(a);
  };
  /**
   * Escolha gravada com menos alvos do que o mínimo atual: antes de a escolha sem "up to" passar a
   * ser obrigatória (8-4-4-1), dava para escolher 0. Completa com as primeiras opções para o
   * replay continuar carregando (dali em diante a partida pode tomar outro rumo).
   */
  const completed = (a: Action): Action => {
    const p = state.pending;
    if (p?.kind === 'selectTargets' && a.type === 'choose' && a.player === p.player && a.uids.length > p.max) return { ...a, uids: a.uids.slice(0, p.max) };
    if (p?.kind !== 'selectTargets' || a.type !== 'choose' || a.player !== p.player || a.uids.length >= p.min) return a;
    const uids = [...a.uids];
    for (const u of p.options) if (uids.length < p.min && !uids.includes(u)) uids.push(u);
    return { ...a, uids };
  };
  for (const a of actions) {
    for (let i = implicit(a); i; i = implicit(a)) step(i);
    if (state.phase === 'gameover') break;
    if (!fits(a)) continue;
    step(completed(a));
  }
  for (let i = implicit(); i; i = implicit()) step(i);
  return out;
}

/**
 * Navega por um replay (o roteiro já convertido por `upgradeReplayActions`): vai para qualquer posição,
 * para frente ou para trás. Guarda o estado a cada `ReplayCursor.EVERY` ações e, para voltar, refaz a
 * partida a partir do estado guardado mais próximo (o motor é puro e determinístico).
 */
export class ReplayCursor {
  /** De quantas em quantas ações o estado fica guardado. */
  static readonly EVERY = 20;
  private readonly saved = new Map<number, GameState>();
  /** Quantas ações do roteiro já foram aplicadas. */
  pos = 0;
  state: GameState;
  /** Estado antes da última ação aplicada (posição `pos - 1`); null no início. */
  previous: GameState | null = null;
  /** Primeira ação que o motor recusou: o replay para antes dela. */
  failed: { index: number; message: string } | null = null;

  constructor(
    initial: GameState,
    readonly actions: readonly Action[],
  ) {
    this.state = initial;
    this.saved.set(0, initial);
  }

  /** Última posição que dá para alcançar (o fim do roteiro ou a ação recusada). */
  get end(): number {
    return this.failed ? this.failed.index : this.actions.length;
  }

  /** Vai para a posição `target` (limitada a 0…`end`) e devolve o estado ali. */
  seek(target: number): GameState {
    let n = Math.max(0, Math.min(Math.floor(target), this.end));
    if (n === this.pos) return this.state;
    let from = this.pos;
    let s = this.state;
    // Para trás, ou para frente além de um estado já guardado: começa do guardado mais próximo antes
    // de `n` (estritamente antes, para refazer ao menos a última ação e saber o estado anterior).
    let base = n === 0 ? 0 : n - 1 - ((n - 1) % ReplayCursor.EVERY);
    while (base > 0 && !this.saved.has(base)) base -= ReplayCursor.EVERY;
    if (n < from || base > from) {
      from = base;
      s = this.saved.get(base)!;
    }
    let prev: GameState | null = null;
    for (let i = from; i < n; i++) {
      const before = s;
      try {
        s = applyAction(s, this.actions[i]);
      } catch (e) {
        this.failed = { index: i, message: e instanceof Error ? e.message : String(e) };
        n = i;
        break;
      }
      prev = before;
      if ((i + 1) % ReplayCursor.EVERY === 0) this.saved.set(i + 1, s);
    }
    if (n === this.pos) return this.state;
    this.pos = n;
    this.state = s;
    this.previous = prev;
    return s;
  }
}
