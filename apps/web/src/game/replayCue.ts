// O que o jogador clicou ou escolheu, a partir de uma ação do replay.
//
// O replay não precisa gravar os cliques à parte: cada ação do roteiro já diz o que foi
// selecionado (a carta jogada, o atacante e o alvo, os alvos escolhidos, a opção e a resposta
// da pergunta). Este módulo traduz a ação de volta para o gesto, com as palavras dos botões e
// das cartas que o jogador viu, para a mesa mostrar o clique/seleção antes de aplicar a ação.

import { type Action, cardDef, type GameState, type ManualOp, type ManualZone, type PlayerId, translateToPt } from '@gumgum/engine';
import { type Locale, type MessageKey, type Params, translate } from '../i18n';
import { abilityText, abilityTitle } from './abilityText';

/** Um elemento da mesa que o jogador tocou: uma carta (mão, campo, descarte), um DON!! da fileira ou um DON!! anexado. */
export type CueTarget = { card: string } | { don: PlayerId } | { attached: string };

export interface ReplayCue {
  /** Quem agiu. */
  player: PlayerId;
  who: string;
  /** O que foi clicado ou escolhido, com as palavras dos botões e das cartas. */
  title: string;
  /** A pergunta respondida ou o contexto (ex.: o texto do pedido de alvos, o efeito ativado). */
  sub?: string;
  /** Elementos da mesa tocados, na ordem dos cliques. */
  targets: CueTarget[];
}

const ZONE_LABEL: Record<ManualZone, MessageKey> = {
  hand: 'replay.zoneHand',
  trash: 'replay.zoneTrash',
  deckTop: 'replay.zoneDeckTop',
  deckBottom: 'replay.zoneDeckBottom',
  life: 'replay.zoneLife',
  character: 'replay.zoneCharacter',
  stage: 'replay.zoneStage',
};

/** Texto de uma opção como o jogador a viu (o prompt traduz as opções em inglês quando a interface está em português). */
function optionLabel(label: string, locale: Locale, translate: boolean): string {
  return translate && locale === 'pt-BR' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label;
}

function manualLabel(op: ManualOp, name: (uid: string) => string, tr: (key: MessageKey, params?: Params) => string): { title: string; target?: string } {
  switch (op.op) {
    case 'draw':
      return { title: tr('replay.manualDraw', { n: op.count }) };
    case 'move':
      return { title: tr(op.rested ? 'replay.manualMoveRested' : 'replay.manualMove', { name: name(op.uid), zone: tr(ZONE_LABEL[op.to]) }), target: op.uid };
    case 'ko':
      return { title: tr('replay.manualKO', { name: name(op.uid) }), target: op.uid };
    case 'setRested':
      return { title: tr(op.rested ? 'replay.manualRest' : 'replay.manualUnrest', { name: name(op.uid) }), target: op.uid };
    case 'power':
      return { title: tr('replay.manualPower', { amount: `${op.amount >= 0 ? '+' : ''}${op.amount}`, name: name(op.uid) }), target: op.uid };
    case 'donFromDeck':
      return { title: tr(op.rested ? 'replay.manualDonFromDeckRested' : 'replay.manualDonFromDeck', { n: op.count }) };
    case 'donToDeck':
      return { title: tr('replay.manualDonToDeck', { n: op.count }) };
    case 'donGive':
      return { title: tr(op.from === 'rested' ? 'replay.manualDonGiveRested' : 'replay.manualDonGive', { name: name(op.uid) }), target: op.uid };
    case 'donSetState':
      return { title: tr(op.rested ? 'replay.manualDonRested' : 'replay.manualDonActive', { n: op.count }) };
    case 'shuffle':
      return { title: tr('replay.manualShuffle') };
    case 'peek':
      return { title: tr('replay.manualPeek', { n: op.count }) };
  }
}

/**
 * Descreve a ação `a` (a próxima do roteiro) como o clique/seleção do jogador sobre o estado `state`
 * (o estado em que ele agiu: é dele que vêm a pergunta pendente e os nomes das cartas).
 */
export function describeReplayAction(state: GameState, a: Action, locale: Locale): ReplayCue {
  const tr = (key: MessageKey, params?: Params) => translate(locale, key, params);
  const who = state.players[a.player].name;
  const name = (uid: string) => (state.cards[uid] ? cardDef(state, uid).name : tr('replay.unknownCard'));
  const names = (uids: string[]) => uids.map(name).join(', ');
  const cards = (uids: string[]): CueTarget[] => uids.filter((u) => state.cards[u]).map((u) => ({ card: u }));
  const p = state.pending;
  const cue = (title: string, targets: CueTarget[] = [], sub?: string): ReplayCue => ({ player: a.player, who, title, ...(sub ? { sub } : {}), targets });

  switch (a.type) {
    case 'mulligan':
      return cue(tr(a.redraw ? 'replay.mulliganRedraw' : 'replay.mulliganKeep'), [], tr('replay.openingHand'));
    case 'playCard': {
      const event = state.cards[a.uid] && cardDef(state, a.uid).category === 'event';
      return cue(tr(event ? 'replay.useCard' : 'replay.playCard', { name: name(a.uid) }), cards([a.uid]));
    }
    case 'attachDon':
      return cue(tr('replay.attachDon', { name: name(a.target) }), [{ don: a.player }, ...cards([a.target])]);
    case 'detachDon':
      return cue(tr('replay.detachDon', { name: name(a.target) }), state.cards[a.target] ? [{ attached: a.target }] : []);
    case 'cancel':
      return cue(tr('common.cancel'), [], tr('replay.cancelSub'));
    case 'activate': {
      if (!state.cards[a.uid]) return cue(tr('replay.activate'));
      const def = cardDef(state, a.uid);
      const ability = def.abilities[a.ability];
      return cue(tr('replay.activateCard', { name: name(a.uid), title: ability ? abilityTitle(ability, locale) : tr('replay.activateLower') }), cards([a.uid]), ability ? abilityText(def, a.ability, locale) : undefined);
    }
    case 'attack':
      return cue(tr('replay.attack', { target: name(a.target), attacker: name(a.attacker) }), cards([a.attacker, a.target]));
    case 'endTurn':
      return cue(tr('replay.endTurn'));
    case 'choose':
      if (p?.kind === 'block')
        return a.uids.length
          ? cue(tr('replay.blockWith', { names: names(a.uids) }), cards(a.uids), tr('replay.blockStep'))
          : cue(tr('replay.noBlock'), [], tr('replay.blockStep'));
      if (p?.kind === 'selectTargets') {
        if (p.max === 0) return cue(tr('replay.continue'), [], p.prompt);
        if (!a.uids.length) return cue(tr('replay.noChoice'), [], p.prompt);
        const list = p.ordered ? a.uids.map((u, i) => `${i + 1}. ${name(u)}`).join(' → ') : names(a.uids);
        return cue(tr('replay.choose', { list }), cards(a.uids), p.prompt);
      }
      return cue(a.uids.length ? tr('replay.choose', { list: names(a.uids) }) : tr('replay.noChoice'), cards(a.uids));
    case 'answer':
      if (p?.kind === 'chooseFirst') return cue(tr(a.yes ? 'replay.playFirst' : 'replay.playSecond'), [], tr('replay.wonRoll'));
      if (p?.kind === 'lifeCard') {
        const def = state.cards[p.card] ? cardDef(state, p.card) : null;
        const trigger = def?.abilities.some((x) => x.timing === 'trigger') ?? false;
        return cue(tr(a.yes ? 'replay.activateTrigger' : trigger ? 'replay.noTrigger' : 'replay.toHand'), [], tr('replay.lifeCard', { name: def?.name ?? '?' }));
      }
      if (p?.kind === 'confirm')
        return cue(tr(a.yes ? (p.drawUpTo ? 'replay.drawOne' : 'replay.payAndUse') : p.drawUpTo ? 'replay.stop' : 'replay.dontUse'), [], p.prompt);
      return cue(tr(a.yes ? 'common.yes' : 'common.no'));
    case 'counter':
      return cue(
        a.target ? tr('replay.counterWithOn', { name: name(a.uid), target: name(a.target) }) : tr('replay.counterWith', { name: name(a.uid) }),
        cards([a.uid, ...(a.target ? [a.target] : [])]),
        tr('replay.counterStep'),
      );
    case 'pass':
      if (p?.kind === 'counter') return cue(tr(p.options.length ? 'replay.noCounter' : 'replay.finish'), [], tr('replay.counterStep'));
      return cue(tr('replay.pass'));
    case 'concede':
      return cue(tr('replay.concede'));
    case 'timeout':
      return cue(tr(a.abandoned ? 'replay.abandoned' : 'replay.timeout'), [], tr('replay.byServer'));
    case 'manual': {
      const m = manualLabel(a.op, name, tr);
      return cue(tr('replay.manual', { title: m.title }), m.target ? cards([m.target]) : [], tr('replay.manualTool'));
    }
    case 'manualDone':
      return cue(tr('replay.continue'), [], p?.kind === 'manual' ? tr('replay.manualApplied', { name: name(p.source) }) : undefined);
    case 'option': {
      if (p?.kind !== 'option') return cue(tr('replay.optionN', { n: a.index + 1 }));
      const label = p.options[a.index];
      return cue(label !== undefined ? optionLabel(label, locale, !p.order && !p.don) : tr('replay.optionN', { n: a.index + 1 }), [], p.prompt);
    }
  }
}
