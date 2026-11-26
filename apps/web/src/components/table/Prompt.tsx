// A janela da pergunta do motor (`state.pending`): confirmar, escolher cartas ou opções, a ordem dos efeitos, olhar
// cartas. "Ver a mesa" recolhe a janela para um balão (`PromptPill`).

import { type Action, cardDef, type GameState, type PlayerId, translateToPt, zoneOf } from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useT, useTryT } from '../../i18n';
import { listText } from '../../game/engineText';
import { cardText, useSettings } from '../../settings';
import { CardView, type Highlight } from '../CardView';
import { type KeyedOptions, orderText, promptText } from './shared';
import { OFF_TABLE } from './decisions';

// ------------------------------------------------------------------ prompts

/** Depois de a pergunta aparecer, o "Não escolher" não reage por este tempo (toque duplo vindo do botão anterior). */
const SKIP_GUARD_MS = 600;
/** Armado ("toque de novo"), o "Não escolher" desarma sozinho depois deste tempo. */
const SKIP_ARMED_MS = 3500;

/**
 * Proteção do "Não escolher" quando há cartas à escolha: no celular, o toque que respondeu a pergunta
 * anterior (ex.: "Ativar [Trigger]") caía no botão da pergunta seguinte e a escolha saía vazia sem querer.
 * O botão fica inerte nos primeiros instantes e o primeiro toque só arma ("Seguir sem escolher?"); o
 * segundo confirma. `reset`: muda quando a pergunta muda (desarma e reinicia a espera).
 */
export function useSkipGuard(reset: unknown): { armed: boolean; press: (skip: () => void) => void } {
  const [armed, setArmed] = useState(false);
  const shownAt = useRef(performance.now());
  useEffect(() => {
    shownAt.current = performance.now();
    setArmed(false);
  }, [reset]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), SKIP_ARMED_MS);
    return () => clearTimeout(id);
  }, [armed]);
  const press = useCallback(
    (skip: () => void) => {
      if (performance.now() - shownAt.current < SKIP_GUARD_MS) return;
      if (!armed) {
        setArmed(true);
        return;
      }
      skip();
    },
    [armed],
  );
  return { armed, press };
}

export function Prompt(props: {
  /** Ainda não aparece (sorteio inicial na tela). */
  hidden?: boolean;
  state: GameState;
  human: PlayerId | null;
  picked: string[];
  onDispatch: (a: Action) => void;
  /** Desfaz no motor a ação que abriu esta escolha (só enquanto o motor permite). */
  onCancel?: () => void;
  /** Por que não dá mais para cancelar (ex.: carta revelada). */
  cancelHint?: string | null;
  /** "Confirmar ações" desligado: a escolha completa sai no toque (ver `quickChoice`). */
  quick?: boolean;
  onCard: (uid: string) => void;
  highlight: (uid: string) => Highlight;
}) {
  const { state, human, picked, onDispatch, onCancel, cancelHint } = props;
  const { locale } = useSettings();
  const t = useT();
  const tryT = useTryT();
  const pending = state.pending;
  // "Ver a mesa": a janela da pergunta recolhe para um balão no topo, para olhar o campo e a mão antes de
  // responder (ex.: usar ou não um efeito quando o oponente ataca). Volta sozinha quando a situação muda.
  const [peek, setPeek] = useState(false);
  useEffect(() => setPeek(false), [pending]);
  // A espera do "Não escolher" conta de quando a pergunta aparece de fato (depois das animações, `hidden`).
  const skip = useSkipGuard(props.hidden ? null : pending);
  if (props.hidden || state.phase === 'gameover' || !pending || human === null || pending.player !== human) return null;
  const peekButton = (
    <button className="btn peek" data-hotkey="peek" onClick={() => setPeek(true)} title={t('game.peekTitle')}>
      {t('game.peek')}
    </button>
  );
  /** Texto da pergunta no idioma da interface (chave do motor) ou o que veio do motor. */
  const prompt = 'prompt' in pending ? promptText(tryT, pending) : '';
  if (peek && (pending.kind === 'confirm' || pending.kind === 'option' || pending.kind === 'selectTargets' || pending.kind === 'lifeCard')) {
    const title = pending.kind === 'lifeCard' ? t('game.lifeCardTitle', { name: cardDef(state, pending.card).name }) : prompt;
    return (
      <PromptPill title={title} subtitle={t('game.peekSub')}>
        <div className="btn-row center">
          <button className="btn primary" data-hotkey="confirm peek" onClick={() => setPeek(false)}>
            {t('game.backToQuestion')}
          </button>
        </div>
      </PromptPill>
    );
  }
  /** Botão de desfazer a ação (quando o motor permite) ou o motivo de não dar mais. */
  const cancel = onCancel ? (
    <button className="btn cancel" data-hotkey="cancel" onClick={onCancel} title={t('game.undoActionTitle')}>
      {t('common.cancel')}
    </button>
  ) : null;
  const hint = !onCancel && cancelHint ? <p className="muted small cancel-hint">{t('game.sentence', { text: cancelHint })}</p> : null;

  switch (pending.kind) {
    case 'chooseFirst':
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">{t('game.rollKicker')}</div>
            <h2>{t('game.wonRoll')}</h2>
            <p className="muted">{t('game.firstOrSecond')}</p>
            <p className="muted small">{t('game.firstOrSecondHint')}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                {t('game.playFirst')}
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}>
                {t('game.playSecond')}
              </button>
            </div>
          </div>
        </div>
      );
    case 'mulligan': {
      const first = state.firstPlayer === human;
      return (
        <div className="modal-backdrop">
          <div className="modal-card mulligan">
            <div className="modal-kicker">
              {first ? t('game.youWillPlayFirst') : t('game.willPlayFirst', { name: state.players[state.firstPlayer].name })}
            </div>
            <h2>{t('game.openingHand')}</h2>
            <div className="mulligan-hand">
              {state.players[human].hand.map((uid, i) => (
                <div key={uid} className="deal" style={{ animationDelay: `${i * 70}ms` }}>
                  <CardView state={state} uid={uid} onClick={() => props.onCard(uid)} />
                </div>
              ))}
            </div>
            <p className="muted small">{t('game.mulliganHint')}</p>
            <div className="btn-row center">
              <button className="btn primary big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: false })}>
                {t('game.keepHand')}
              </button>
              <button className="btn big" onClick={() => onDispatch({ type: 'mulligan', player: human, redraw: true })}>
                {t('game.redrawHand')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    case 'selectTargets': {
      // Opções fora da mesa (topo do deck, descarte, Vida) aparecem dentro do prompt.
      // Numa busca, todas as cartas olhadas aparecem; as que não podem ser escolhidas ficam apagadas.
      const shown = pending.shown?.length ? pending.shown : null;
      const offBoard = shown ?? pending.options.filter((u) => OFF_TABLE.includes(zoneOf(state, u) ?? ''));
      const blocked = shown ? shown.filter((u) => !pending.options.includes(u)).length : 0;
      // "Não escolher" numa linha própria, à esquerda e acima: longe do "Confirmar" (embaixo, à direita, na
      // zona do polegar), para o toque sem querer não sair como escolha vazia.
      // Numa escolha ordenada (pôr as cartas de volta), "Manter a ordem" é a resposta comum: sem a proteção.
      const skipRow = pending.max > 0 && pending.min === 0 && (
        <div className="btn-row skip-row">
          {pending.ordered ? (
            <button className="btn" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
              {t('game.keepOrder')}
            </button>
          ) : (
            <button
              className={['btn', 'skip', skip.armed ? 'armed' : ''].join(' ')}
              onClick={() => skip.press(() => onDispatch({ type: 'choose', player: human, uids: [] }))}
            >
              {skip.armed ? t('game.skipChoiceArmed') : t('game.skipChoice')}
              {skip.armed && <small>{t('game.skipChoiceArmedSub')}</small>}
            </button>
          )}
        </div>
      );
      const confirm = (
        <>
          {skipRow}
          <div className="btn-row">
            {peekButton}
            {cancel}
            {pending.max === 0 ? (
              <button className="btn primary" data-hotkey="confirm" onClick={() => onDispatch({ type: 'choose', player: human, uids: [] })}>
                {t('game.continue')}
              </button>
            ) : (
              <button
                className="btn primary"
                data-hotkey="confirm"
                // Sem nada marcado, "Confirmar" seria outro jeito de seguir sem escolher: só o "Não escolher" faz isso.
                disabled={picked.length < pending.min || (picked.length === 0 && pending.options.length > 0)}
                onClick={() => onDispatch({ type: 'choose', player: human, uids: picked })}
              >
                {pending.max > 1 ? t('game.confirmCount', { n: picked.length, max: pending.max }) : t('game.confirm')}
              </button>
            )}
          </div>
        </>
      );
      const order = pending.ordered && picked.length > 0 && (
        <p className="muted small">{t('game.order', { order: orderText(t, state, picked) })}</p>
      );
      const options = (
        <div className="prompt-options">
          {offBoard.map((uid) => (
            <CardView key={uid} state={state} uid={uid} highlight={props.highlight(uid)} onClick={() => props.onCard(uid)} />
          ))}
        </div>
      );
      if (shown || offBoard.length === pending.options.length) {
        return (
          <div className="modal-backdrop">
            <div className="modal-card">
              <SourceLine state={state} uid={pending.source} />
              <h3>{prompt}</h3>
              <p className="muted small">
                {pending.max > 0 && offBoard.length > 1 && `${t('game.optionsCount', { n: offBoard.length })} `}
                {pending.max === 0
                  ? offBoard.length
                    ? t('game.tapToRead')
                    : t('game.opponentSeesChoice')
                  : pending.ordered
                    ? t('game.tapInOrder')
                    : pending.max === 1
                      ? t(props.quick ? 'game.tapOneQuick' : 'game.tapOneConfirm')
                      : t('game.tapToChoose')}
                {blocked > 0 && ` ${t('game.dimmedUnavailable')}`}
              </p>
              {options}
              {order}
              {confirm}
              {hint}
            </div>
          </div>
        );
      }
      // Alvos todos na mesa ou na mão: o pedido fica na faixa central (TargetRequest) e o botão de
      // confirmar no lugar de "Encerrar turno" (DecisionButton), como no Counter.
      if (offBoard.length === 0) return null;
      // Mistura de alvos na mesa e fora dela: o balão mostra as cartas de fora.
      return (
        <PromptPill title={prompt} subtitle={t('game.tapHighlightedCount', { n: picked.length, max: pending.max })}>
          {options}
          {order}
          {confirm}
          {hint}
        </PromptPill>
      );
    }
    case 'block':
    case 'counter':
      // Blocker e Counter: o botão de concluir fica na faixa central (DecisionButton), junto do
      // confronto de poder e perto da mão; a dica de uso fica logo acima do leque.
      return null;
    case 'manual': {
      // Efeito ainda não automatizado (⚙): o jogo só avisa e segue sem aplicá-lo.
      const text = locale === 'pt-BR' ? translateToPt(pending.text).text : pending.text;
      const name = cardDef(state, pending.source).name;
      return (
        <PromptPill title={t('game.manualTitle', { name })} subtitle={t('game.manualSub', { text })} clamp>
          <div className="btn-row">
            {cancel}
            <button className="btn primary" data-hotkey="confirm" onClick={() => onDispatch({ type: 'manualDone', player: human })}>
              {t('game.continue')}
            </button>
          </div>
        </PromptPill>
      );
    }
    case 'lifeCard': {
      // Toda carta que sai da Vida passa por aqui, com ou sem [Trigger]: o oponente só vê que uma
      // carta da Vida está sendo olhada, e não pode saber qual dos dois casos é.
      const def = cardDef(state, pending.card);
      const trigger = def.abilities.some((a) => a.timing === 'trigger') ? cardText(def, locale).trigger : null;
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-kicker">{trigger ? t('game.triggerRevealed') : t('game.lifeCard')}</div>
            <div className="modal-feature">
              <CardView state={state} uid={pending.card} />
            </div>
            <h3>{def.name}</h3>
            {trigger ? (
              <p className="effect trigger">{trigger}</p>
            ) : (
              <p className="muted small">{t('game.noTriggerHint')}</p>
            )}
            <div className="btn-row center">
              {trigger && (
                <button className="btn primary big" data-hotkey="confirm" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  {t('game.activateTrigger')}
                </button>
              )}
              <button
                className={`btn big${trigger ? '' : ' primary'}`}
                data-hotkey={trigger ? undefined : 'confirm'}
                onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}
              >
                {trigger ? (
                  <>
                    {t('game.noActivate')} <small>{t('game.goesToHand')}</small>
                  </>
                ) : (
                  t('game.putInHand')
                )}
              </button>
            </div>
            {trigger && <div className="btn-row center">{peekButton}</div>}
          </div>
        </div>
      );
    }
    case 'option': {
      // Cartas que a pergunta mostra (ex.: o topo do deck do oponente): a carta inteira, e toque para ler.
      // Rótulos das opções: a chave do motor (`optionKeys`), quando há; senão o texto da carta (traduzido em pt-BR).
      const { optionKeys, optionParts } = pending as typeof pending & KeyedOptions;
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            {pending.shown?.length ? (
              <div className={`modal-feature${pending.shown.length > 1 ? ' several' : ''}`}>
                {pending.shown.map((uid) => (
                  <CardView key={uid} state={state} uid={uid} onClick={() => props.onCard(uid)} />
                ))}
              </div>
            ) : null}
            <h3>{prompt}</h3>
            {pending.shown?.length ? <p className="muted small">{t('game.tapCardToRead')}</p> : null}
            <div className="btn-col">
              {pending.options.map((label, index) => (
                <button
                  key={index}
                  className={`btn${index === 0 ? ' primary' : ''}`}
                  data-hotkey="option"
                  onClick={() => onDispatch({ type: 'option', player: human, index })}
                >
                  {(optionParts?.[index] ? listText(tryT, optionParts[index]!) : undefined) ??
                    tryT(optionKeys?.[index]) ??
                    (!pending.order && !pending.don && locale === 'pt-BR' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label)
                      ? translateToPt(label).text
                      : label)}
                </button>
              ))}
            </div>
            <div className="btn-row center">
              {peekButton}
              {cancel}
            </div>
            {hint}
          </div>
        </div>
      );
    }
    case 'confirm':
      // Sem como pagar o custo a pergunta abre mesmo assim (para o oponente não deduzir a mão),
      // só com "Não usar".
      return (
        <div className="modal-backdrop">
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{prompt}</h3>
            {pending.cannot && <p className="muted small">{t('game.opponentSeesQuestion')}</p>}
            <div className="btn-row center">
              {!pending.cannot && (
                <button className="btn primary big" data-hotkey="confirm" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
                  {pending.drawUpTo ? t('game.drawOne') : t('game.payAndUse')}
                </button>
              )}
              <button
                className={`btn big${pending.cannot ? ' primary' : ''}`}
                data-hotkey={pending.cannot ? 'confirm' : undefined}
                onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}
              >
                {pending.drawUpTo ? t('game.stop') : t('game.dontUse')}
              </button>
            </div>
            <div className="btn-row center">
              {peekButton}
              {cancel}
            </div>
            {hint}
          </div>
        </div>
      );
  }
}

function SourceLine({ state, uid }: { state: GameState; uid: string }) {
  if (!state.cards[uid]) return null;
  return (
    <div className="source-line">
      <div className="source-thumb">
        <CardView state={state} uid={uid} />
      </div>
      <span>{cardDef(state, uid).name}</span>
    </div>
  );
}

function PromptPill({
  title,
  subtitle,
  clamp,
  children,
}: {
  title: string;
  subtitle?: string;
  clamp?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="prompt-pill">
      <div className="prompt-title">{title}</div>
      {subtitle && (
        <p className={['prompt-sub', clamp && !open ? 'clamp' : ''].join(' ')} onClick={() => setOpen((o) => !o)}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}
