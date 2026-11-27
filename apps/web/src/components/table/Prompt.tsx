// A janela da pergunta do motor (`state.pending`): confirmar, escolher cartas ou opções, a ordem dos efeitos, olhar
// cartas. "Ver a mesa" recolhe a janela para um balão (`PromptPill`). Numa batalha, a janela leva embaixo quem ataca
// quem (`PromptBackdrop`).

import { type Action, cardDef, type GameState, type PlayerId, translateToPt, zoneOf } from '@gumgum/engine';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useT, useTryT } from '../../i18n';
import { listText, msgText } from '../../game/engineText';
import { cardText, useSettings } from '../../settings';
import { CardView, type Highlight } from '../CardView';
import { type Keyed, type KeyedOptions, orderText, promptText, type TryT, useMediaQuery } from './shared';
import { battleClash } from './CenterBand';
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
  // No desktop a pergunta de sim ou não tem um desenho próprio, com a carta ao lado (o caso `confirm`, mais abaixo).
  const wide = useMediaQuery('(min-width: 1000px)');
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
  /** O fundo das janelas que podem abrir no meio de uma batalha: levam embaixo quem ataca quem. */
  const backdrop = { state, human };

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
          <PromptBackdrop {...backdrop}>
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
          </PromptBackdrop>
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
        <PromptBackdrop {...backdrop}>
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
        </PromptBackdrop>
      );
    }
    case 'option': {
      // Cartas que a pergunta mostra (ex.: o topo do deck do oponente): a carta inteira, e toque para ler.
      // Rótulos das opções: a chave do motor (`optionKeys`), quando há; senão o texto da carta (traduzido em pt-BR).
      const { optionKeys, optionParts } = pending as typeof pending & KeyedOptions;
      return (
        <PromptBackdrop {...backdrop}>
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
        </PromptBackdrop>
      );
    }
    case 'confirm': {
      // Sem como pagar o custo a pergunta abre mesmo assim (para o oponente não deduzir a mão),
      // só com "Não usar".
      const yes = !pending.cannot && (
        <button className="btn primary big" data-hotkey="confirm" onClick={() => onDispatch({ type: 'answer', player: human, yes: true })}>
          {/* "Pagar e usar" só quando há o que pagar: sem custo, a resposta é "Usar o efeito". */}
          {pending.drawUpTo ? t('game.drawOne') : hasCost(pending) ? t('game.payAndUse') : t('game.useEffect')}
        </button>
      );
      const no = (
        <button
          className={`btn big${pending.cannot ? ' primary' : ''}`}
          data-hotkey={pending.cannot ? 'confirm' : undefined}
          onClick={() => onDispatch({ type: 'answer', player: human, yes: false })}
        >
          {pending.drawUpTo ? t('game.stop') : t('game.dontUse')}
        </button>
      );
      if (wide) {
        const def = state.cards[pending.source] ? cardDef(state, pending.source) : null;
        const ask = askText(tryT, pending, def?.name);
        return (
          <PromptBackdrop className="modal-backdrop ask-backdrop" {...backdrop}>
            <div className={`modal-card ask c-${def?.colors[0] ?? 'red'}`}>
              <div className="ask-main">
                {def && (
                  <div className="ask-art">
                    <CardView state={state} uid={pending.source} onClick={() => props.onCard(pending.source)} />
                  </div>
                )}
                <div className="ask-body">
                  {def && <div className="ask-name">{def.name}</div>}
                  <h3>{ask.question}</h3>
                  {ask.cost && (
                    <p className="ask-cost">
                      <b>{t('card.cost')}</b>
                      {ask.cost}
                    </p>
                  )}
                  {pending.cannot && (
                    <p className="ask-cannot">
                      {ask.cannot && <b>{ask.cannot}</b>}
                      {t('game.opponentSeesQuestion')}
                    </p>
                  )}
                  {def && cardText(def, locale).text && <p className="ask-text">{cardText(def, locale).text}</p>}
                  <div className="ask-answers">
                    {yes}
                    {no}
                  </div>
                </div>
              </div>
              <div className="ask-foot">
                {peekButton}
                {hint}
                {cancel}
              </div>
            </div>
          </PromptBackdrop>
        );
      }
      return (
        <PromptBackdrop {...backdrop}>
          <div className="modal-card">
            <SourceLine state={state} uid={pending.source} />
            <h3>{prompt}</h3>
            {pending.cannot && <p className="muted small">{t('game.opponentSeesQuestion')}</p>}
            <div className="btn-row center">
              {yes}
              {no}
            </div>
            <div className="btn-row center">
              {peekButton}
              {cancel}
            </div>
            {hint}
          </div>
        </PromptBackdrop>
      );
    }
  }
}

export type Confirm = Extract<NonNullable<GameState['pending']>, { kind: 'confirm' }>;

/** A pergunta cobra um custo? (O motor manda o custo nos parâmetros do texto: "Custo: …", "Pagar … para evitar?".) */
export function hasCost(pending: Confirm): boolean {
  const p = pending as Confirm & Keyed;
  return Boolean(p.promptParts?.cost) || p.promptParams?.cost !== undefined;
}

/**
 * O texto da pergunta de sim ou não em pedaços, para a janela do desktop: a pergunta sem o nome da carta na
 * frente (o nome e a carta já estão ao lado), o custo à parte no "usar o efeito?" e o aviso de que não dá
 * para pagar. Sem a chave do motor no dicionário, a pergunta fica como veio.
 */
export function askText(tryT: TryT, pending: Confirm, name: string | undefined): { question: string; cost?: string; cannot?: string } {
  const p = pending as Confirm & Keyed;
  let question = msgText(tryT, p.promptKey, p.promptParams, p.promptParts);
  if (question === undefined) return { question: pending.prompt };
  let cost: string | undefined;
  if (p.promptKey === 'engine.useEffectWithCost') {
    const plain = msgText(tryT, 'engine.useEffect', p.promptParams);
    const text = (p.promptParts?.cost && listText(tryT, p.promptParts.cost)) || String(p.promptParams?.cost ?? '');
    if (plain !== undefined && text) {
      question = plain;
      cost = capital(text);
    }
  }
  if (name && question.startsWith(`${name}: `)) question = capital(question.slice(name.length + 2));
  // "(Não dá para pagar o custo.)": na janela vai sem os parênteses, numa linha própria.
  const cannot = pending.cannot ? tryT('engine.cannotPayCost')?.replace(/^[(（]\s*|\s*[)）]$/g, '') : undefined;
  return { question, cost, cannot };
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * A batalha em curso, embaixo da janela da pergunta: quem ataca quem, de quem é cada carta e o poder de cada uma.
 * A janela cobre a mesa, e sem isto era preciso "Ver a mesa" só para saber qual ataque a pergunta interrompeu.
 * O que falta para defender (ou para acertar) aparece enquanto o poder ainda decide a batalha: depois do dano
 * (a carta da Vida, o [Trigger]) ficam só os dois lados.
 */
function PromptBattle({ state, human }: { state: GameState; human: PlayerId }) {
  const t = useT();
  const b = state.battle;
  if (!b || !state.cards[b.attacker] || !state.cards[b.target]) return null;
  const clash = battleClash(state, human, t);
  const undecided = b.step !== 'damage' && b.step !== 'end' && !state.stack.some((f) => f.kind === 'damage');
  const side = (uid: string, role: 'atk' | 'def', power: number) => {
    const owner = state.cards[uid].owner;
    const who = owner === human ? t('menu.you') : state.players[owner].name;
    return (
      <span className={`pb-side ${role}`}>
        <span className="source-thumb">
          <CardView state={state} uid={uid} />
        </span>
        <span className="pb-text">
          <small>{t(role === 'atk' ? 'game.promptAttacker' : 'game.promptTarget', { who })}</small>
          <em>{cardDef(state, uid).name}</em>
        </span>
        <b>{power}</b>
      </span>
    );
  };
  const label = t('log.attacks', { card: cardDef(state, b.attacker).name, power: clash.atk, target: cardDef(state, b.target).name, targetPower: clash.def });
  return (
    <div className="prompt-battle" role="group" aria-label={label}>
      {side(b.attacker, 'atk', clash.atk)}
      <span className="pb-vs" aria-hidden="true">
        ⚔
      </span>
      {side(b.target, 'def', clash.def)}
      {undecided && <span className={['pb-status', clash.hits ? 'hit' : 'safe'].join(' ')}>{clash.status}</span>}
    </div>
  );
}

/**
 * O fundo da janela da pergunta, com a janela e, embaixo dela, a batalha em curso (se há uma). `className`: as
 * classes do fundo (a mesa Yonko tem os seus).
 */
export function PromptBackdrop({
  className = 'modal-backdrop',
  state,
  human,
  children,
}: {
  className?: string;
  state: GameState;
  human: PlayerId;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="modal-stack">
        {children}
        <PromptBattle state={state} human={human} />
      </div>
    </div>
  );
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
