// O que fica na faixa central quando o jogador precisa decidir: o pedido de alvos de um efeito, desfazer, cancelar
// a ação e o botão de decisão (Blocker/Counter com o resultado previsto do ataque; confirmar a escolha de alvos).

import {
  type Action,
  cardDef,
  counterValue,
  type GameState,
  getPower,
  type Pending,
  type PlayerId,
  zoneOf,
} from '@gumgum/engine';
import { type ReactNode } from 'react';
import { type Translate, useT, useTryT } from '../../i18n';
import { CardView } from '../CardView';
import { orderText, promptText } from './shared';
import { useSkipGuard } from './Prompt';

/** Zonas cujas cartas não ficam à vista na mesa: a escolha entre elas abre um modal com as cartas. */
export const OFF_TABLE = ['deck', 'trash', 'life'];

/**
 * Escolha de alvos que dá para fazer tocando na mesa ou na mão: nenhuma carta mostrada de uma busca,
 * ao menos um alvo e todos fora do deck, do descarte e da Vida.
 */
export function targetsOnTable(state: GameState, pending: Extract<Pending, { kind: 'selectTargets' }>): boolean {
  if (pending.shown?.length || pending.options.length === 0) return false;
  return pending.options.every((u) => !OFF_TABLE.includes(zoneOf(state, u) ?? ''));
}

/**
 * Pedido de um efeito que escolhe alvos na mesa, no meio da faixa central: a carta de origem em
 * miniatura, o texto do pedido com o contador e, nos efeitos em que a ordem importa, a ordem marcada.
 */
export function TargetRequest({
  state,
  pending,
  picked,
  hint,
}: {
  state: GameState;
  pending: Extract<Pending, { kind: 'selectTargets' }>;
  picked: string[];
  /** Aviso curto embaixo do pedido (ex.: por que não dá mais para cancelar). */
  hint?: string | null;
}) {
  const t = useT();
  const tryT = useTryT();
  const prompt = promptText(tryT, pending);
  const source = state.cards[pending.source] ? cardDef(state, pending.source) : null;
  // O motor costuma começar o pedido com "Nome da carta: "; o nome vai para a linha de cima.
  const prefix = source ? `${source.name}: ` : '';
  const text = prefix && prompt.startsWith(prefix) ? prompt.slice(prefix.length) : prompt;
  const order = pending.ordered && picked.length > 0 ? orderText(t, state, picked) : null;
  return (
    <div className="target-request" title={prompt}>
      {source && (
        <div className="source-thumb">
          <CardView state={state} uid={pending.source} />
        </div>
      )}
      <div className="target-text">
        {source && <small>{source.name}</small>}
        <b>
          {text}
          {pending.max > 0 && ` ${t('game.countOf', { n: picked.length, max: pending.max })}`}
        </b>
        {order && <small className="target-order">{t('game.order', { order })}</small>}
        {hint && <small className="target-hint">{hint}</small>}
      </div>
    </div>
  );
}

/**
 * Botão grande de cancelar, no lugar de "Encerrar turno": sai do modo de ataque ou de DON!! marcados
 * (nada foi para o motor ainda), ou desfaz no motor a ação em andamento (`cancel`).
 */
/** Habilidade paga que já terminou: ainda dá para voltar atrás até a próxima jogada. */
export function UndoPill({ name, onUndo }: { name: string; onUndo: () => void }) {
  const t = useT();
  return (
    <button className="hint-pill undo-pill" onClick={onUndo} title={t('game.undoActionTitle')}>
      ↶ {t('game.undoPaid', { name })} <small>{t('game.undoPaidSub')}</small>
    </button>
  );
}

export function CancelButton({ sub, onClick, title }: { sub: string; onClick: () => void; title?: string }) {
  const t = useT();
  return (
    <button className="end-turn defense cancel" onClick={onClick} title={title ?? t('game.cancelBack')}>
      <b>{t('common.cancel')}</b>
      <small>{sub}</small>
    </button>
  );
}

/**
 * Botão grande de decisão, sempre no mesmo lugar (o de "Encerrar turno"):
 * - Blocker/Counter: "Não bloquear", "Não usar Counter", com o resultado previsto do ataque; pulsa
 *   quando nenhuma carta da mão muda o resultado.
 * - Escolha de alvos de efeito: "Confirmar (n/máx)" (desabilitado até atingir o mínimo), "Não escolher"
 *   quando nada foi marcado e nada é obrigatório, ou "Continuar"; pulsa quando a escolha já está completa.
 * Online, o relógio do jogador fica ao lado: o tempo corre aqui.
 */
export function DecisionButton({
  state,
  pending,
  picked,
  human,
  onDispatch,
  onCancel,
  clock,
  sheet,
}: {
  state: GameState;
  pending: Extract<Pending, { kind: 'block' | 'counter' | 'selectTargets' }>;
  /** Alvos já marcados (escolha de alvos) ou Counters marcados para usar de uma vez. */
  picked: string[];
  human: PlayerId;
  onDispatch: (a: Action) => void;
  /** A ação que pediu esta escolha ainda pode ser desfeita: botão Cancelar ao lado do de confirmar. */
  onCancel?: () => void;
  clock?: ReactNode;
  /** Dentro da folha da mão: botão largo. */
  sheet?: boolean;
}) {
  const t = useT();
  const tryT = useTryT();
  const skip = useSkipGuard(pending);
  const base =
    pending.kind === 'selectTargets' ? targetsDecision(t, promptText(tryT, pending), pending, picked) : defenseDecision(t, state, pending, picked);
  if (!base) return null;
  // "Não escolher" com cartas à escolha: armado, o botão pede o segundo toque (useSkipGuard).
  const d: Decision = base.skip && skip.armed ? { ...base, label: t('game.skipChoiceArmed'), sub: t('game.skipChoiceArmedSub') } : base;
  const act = () => {
    const run = () => {
      for (const a of [d.action(human)].flat()) onDispatch(a);
    };
    if (d.skip) skip.press(run);
    else run();
  };
  return (
    <div className={['defense-slot', sheet ? 'in-sheet' : ''].join(' ')}>
      {onCancel && pending.kind === 'selectTargets' && (
        <button className="end-turn defense cancel side" data-hotkey="cancel" onClick={onCancel} title={t('game.undoActionTitle')}>
          <b>{t('common.cancel')}</b>
          <small>{t('game.undoActionSub')}</small>
        </button>
      )}
      <button
        className={['end-turn', 'defense', d.pulse && !d.disabled ? 'pulse' : '', d.skip ? 'skip' : '', d.skip && skip.armed ? 'armed' : ''].join(' ')}
        data-hotkey="confirm"
        onClick={act}
        disabled={d.disabled}
        title={d.title}
      >
        <b>{d.label}</b>
        <small>{d.sub}</small>
      </button>
      {clock && <span className="defense-clock">{clock}</span>}
    </div>
  );
}

interface Decision {
  label: string;
  sub: string;
  title: string;
  /** Chama o olhar: não há mais o que fazer antes de concluir. */
  pulse: boolean;
  disabled?: boolean;
  /** Várias ações saem em sequência (os Counters marcados e o fim da etapa). */
  action: (player: PlayerId) => Action | Action[];
  /** "Não escolher" com cartas à escolha: protegido contra o toque sem querer (useSkipGuard). */
  skip?: true;
}

/**
 * Blocker/Counter: rótulo com o resultado previsto do ataque. Com Counters marcados, o botão usa todos
 * (o valor vai para o atacado) e já encerra a etapa, mostrando o resultado com eles somados.
 */
function defenseDecision(
  t: Translate,
  state: GameState,
  pending: Extract<Pending, { kind: 'block' | 'counter' }>,
  picked: string[] = [],
): Decision | null {
  const b = state.battle;
  if (!b) return null;
  const atk = getPower(state, b.attacker) ?? 0;
  const def = getPower(state, b.target) ?? 0;
  const hits = atk >= def;
  const need = atk - def + 1000;
  const counter = pending.kind === 'counter';
  const marked = counter ? picked.filter((u) => pending.options.includes(u)) : [];
  if (marked.length) {
    const amount = marked.reduce((sum, u) => sum + counterValue(state, u), 0);
    const total = def + amount;
    const result = atk >= total ? t('game.attackPasses') : t('game.defended');
    return {
      label: t('game.useCounters', { amount }),
      sub: t('game.resultSub', { result, atk, def: total }),
      title: t('game.useCountersTitle', { n: marked.length, result, atk, def: total }),
      pulse: atk < total,
      action: (player) => [...marked.map((uid): Action => ({ type: 'counter', player, uid })), { type: 'pass', player }],
    };
  }
  // Já houve Counter nesta batalha: o alvo carrega um bônus de poder "até o fim da batalha".
  const used = counter && state.modifiers.some((m) => m.uid === b.target && m.kind === 'power' && m.duration === 'battle');
  // Nada na mão muda o resultado: o ataque já falha, ou os Counters somados não chegam ao que falta
  // (eventos [Counter] podem ter efeitos além do valor, então contam como úteis).
  let useless = !hits;
  if (counter && hits) {
    const events = pending.options.some((u) => cardDef(state, u).category === 'event');
    const total = pending.options.reduce((sum, u) => sum + counterValue(state, u), 0);
    useless = !events && total < need;
  }
  // Sem carta de Counter na mão a etapa abre mesmo assim (senão o atacante saberia): só resta concluir.
  const none = counter && !pending.options.length;
  const label = !counter
    ? t('game.noBlock')
    : !hits || none
      ? t('game.finish')
      : used
        ? t('game.noMoreCounter')
        : t('game.noCounter');
  const result = hits ? t('game.attackPasses') : t('game.defended');
  return {
    label,
    sub: none && hits && !used ? t('game.noCounterInHandSub', { atk, def }) : t('game.resultSub', { result, atk, def }),
    title: !counter ? t('game.noBlockTitle', { result, atk, def }) : t('game.endCounterTitle', { result, atk, def }),
    pulse: useless,
    action: (player) => (counter ? { type: 'pass', player } : { type: 'choose', player, uids: [] }),
  };
}

/** Escolha de alvos de efeito: "Confirmar (n/máx)", "Não escolher" ou "Continuar", com o contador. */
function targetsDecision(t: Translate, prompt: string, pending: Extract<Pending, { kind: 'selectTargets' }>, picked: string[]): Decision {
  const n = picked.length;
  const { max } = pending;
  // O mínimo nunca passa do que há para escolher.
  const need = Math.min(pending.min, pending.options.length);
  if (max === 0) {
    return {
      label: t('game.continue'),
      sub: t('game.nothingToChoose'),
      title: prompt,
      pulse: true,
      action: (player) => ({ type: 'choose', player, uids: [] }),
    };
  }
  if (n === 0 && need === 0) {
    return {
      // Ordenação opcional ("clique na ordem …"): sem marcar nada, as cartas ficam como estão.
      label: pending.ordered ? t('game.keepOrder') : t('game.skipChoice'),
      sub: t('game.noneMarkedUpTo', { max }),
      title: t('game.promptSkip', { prompt }),
      pulse: false,
      action: (player) => ({ type: 'choose', player, uids: [] }),
      ...(pending.options.length ? { skip: true } : {}),
    };
  }
  const missing = need - n;
  return {
    label: t('game.confirmCount', { n, max }),
    sub: missing > 0 ? t('game.markMore', { n: missing }) : n < max ? t('game.canMarkMore') : t('game.choiceComplete'),
    title: prompt,
    pulse: n === max,
    disabled: missing > 0,
    action: (player) => ({ type: 'choose', player, uids: picked }),
  };
}
