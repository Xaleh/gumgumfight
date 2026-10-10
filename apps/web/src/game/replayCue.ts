// O que o jogador clicou ou escolheu, a partir de uma ação do replay.
//
// O replay não precisa gravar os cliques à parte: cada ação do roteiro já diz o que foi
// selecionado (a carta jogada, o atacante e o alvo, os alvos escolhidos, a opção e a resposta
// da pergunta). Este módulo traduz a ação de volta para o gesto, com as palavras dos botões e
// das cartas que o jogador viu, para a mesa mostrar o clique/seleção antes de aplicar a ação.

import { type Action, cardDef, type GameState, type ManualOp, type ManualZone, type PlayerId, translateToPt } from '@gumgum/engine';
import type { CardLang } from '../settings';
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

const ZONE_LABEL: Record<ManualZone, string> = {
  hand: 'a mão',
  trash: 'o descarte',
  deckTop: 'o topo do deck',
  deckBottom: 'o fundo do deck',
  life: 'a Vida',
  character: 'o campo',
  stage: 'a área de Stage',
};

/** Texto de uma opção como o jogador a viu (o prompt traduz as opções em inglês quando a interface está em português). */
function optionLabel(label: string, lang: CardLang, translate: boolean): string {
  return translate && lang === 'pt' && /[a-z]/.test(label) && !/[ãçéêíóú]/i.test(label) ? translateToPt(label).text : label;
}

function manualLabel(op: ManualOp, name: (uid: string) => string): { title: string; target?: string } {
  switch (op.op) {
    case 'draw':
      return { title: `Comprar ${op.count} carta${op.count === 1 ? '' : 's'}` };
    case 'move':
      return { title: `Mover ${name(op.uid)} para ${ZONE_LABEL[op.to]}${op.rested ? ' (virada)' : ''}`, target: op.uid };
    case 'ko':
      return { title: `Nocautear ${name(op.uid)}`, target: op.uid };
    case 'setRested':
      return { title: `${op.rested ? 'Virar' : 'Desvirar'} ${name(op.uid)}`, target: op.uid };
    case 'power':
      return { title: `${op.amount >= 0 ? '+' : ''}${op.amount} de poder em ${name(op.uid)}`, target: op.uid };
    case 'donFromDeck':
      return { title: `${op.count} DON!! do deck de DON!!${op.rested ? ' (virados)' : ''}` };
    case 'donToDeck':
      return { title: `${op.count} DON!! de volta ao deck de DON!!` };
    case 'donGive':
      return { title: `Dar 1 DON!! ${op.from === 'rested' ? 'virado ' : ''}a ${name(op.uid)}`, target: op.uid };
    case 'donSetState':
      return { title: `${op.count} DON!! ${op.rested ? 'virados' : 'ativos'}` };
    case 'shuffle':
      return { title: 'Embaralhar o deck' };
    case 'peek':
      return { title: `Olhar ${op.count} carta${op.count === 1 ? '' : 's'} do topo do deck` };
  }
}

/**
 * Descreve a ação `a` (a próxima do roteiro) como o clique/seleção do jogador sobre o estado `state`
 * (o estado em que ele agiu: é dele que vêm a pergunta pendente e os nomes das cartas).
 */
export function describeReplayAction(state: GameState, a: Action, lang: CardLang): ReplayCue {
  const who = state.players[a.player].name;
  const name = (uid: string) => (state.cards[uid] ? cardDef(state, uid).name : 'carta desconhecida');
  const names = (uids: string[]) => uids.map(name).join(', ');
  const cards = (uids: string[]): CueTarget[] => uids.filter((u) => state.cards[u]).map((u) => ({ card: u }));
  const p = state.pending;
  const cue = (title: string, targets: CueTarget[] = [], sub?: string): ReplayCue => ({ player: a.player, who, title, ...(sub ? { sub } : {}), targets });

  switch (a.type) {
    case 'mulligan':
      return cue(a.redraw ? 'Trocar mão' : 'Manter mão', [], 'Mão inicial');
    case 'playCard': {
      const event = state.cards[a.uid] && cardDef(state, a.uid).category === 'event';
      return cue(`${event ? 'Usar' : 'Jogar'} ${name(a.uid)}`, cards([a.uid]));
    }
    case 'attachDon':
      return cue(`Anexar 1 DON!! em ${name(a.target)}`, [{ don: a.player }, ...cards([a.target])]);
    case 'detachDon':
      return cue(`Devolver 1 DON!! de ${name(a.target)} à área de custo`, state.cards[a.target] ? [{ attached: a.target }] : []);
    case 'cancel':
      return cue('Cancelar', [], 'desfaz a ação em andamento');
    case 'activate': {
      if (!state.cards[a.uid]) return cue('Ativar efeito');
      const def = cardDef(state, a.uid);
      const ability = def.abilities[a.ability];
      return cue(`${name(a.uid)}: ${ability ? abilityTitle(ability, lang) : 'ativar efeito'}`, cards([a.uid]), ability ? abilityText(def, a.ability, lang) : undefined);
    }
    case 'attack':
      return cue(`Atacar ${name(a.target)} com ${name(a.attacker)}`, cards([a.attacker, a.target]));
    case 'endTurn':
      return cue('Encerrar turno');
    case 'choose':
      if (p?.kind === 'block') return a.uids.length ? cue(`Bloquear com ${names(a.uids)}`, cards(a.uids), 'Etapa de Bloqueio') : cue('Não bloquear', [], 'Etapa de Bloqueio');
      if (p?.kind === 'selectTargets') {
        if (p.max === 0) return cue('Continuar', [], p.prompt);
        if (!a.uids.length) return cue('Não escolher', [], p.prompt);
        const list = p.ordered ? a.uids.map((u, i) => `${i + 1}. ${name(u)}`).join(' → ') : names(a.uids);
        return cue(`Escolher ${list}`, cards(a.uids), p.prompt);
      }
      return cue(a.uids.length ? `Escolher ${names(a.uids)}` : 'Não escolher', cards(a.uids));
    case 'answer':
      if (p?.kind === 'chooseFirst') return cue(a.yes ? 'Jogar primeiro' : 'Jogar segundo', [], 'Venceu o sorteio');
      if (p?.kind === 'lifeCard') {
        const def = state.cards[p.card] ? cardDef(state, p.card) : null;
        const trigger = def?.abilities.some((x) => x.timing === 'trigger') ?? false;
        return cue(a.yes ? 'Ativar [Trigger]' : trigger ? 'Não ativar (vai para a mão)' : 'Colocar na mão', [], `Carta da Vida: ${def?.name ?? '?'}`);
      }
      if (p?.kind === 'confirm') return cue(a.yes ? (p.drawUpTo ? 'Comprar 1 carta' : 'Pagar e usar') : p.drawUpTo ? 'Parar' : 'Não usar', [], p.prompt);
      return cue(a.yes ? 'Sim' : 'Não');
    case 'counter':
      return cue(`Counter com ${name(a.uid)}${a.target ? ` em ${name(a.target)}` : ''}`, cards([a.uid, ...(a.target ? [a.target] : [])]), 'Etapa de Counter');
    case 'pass':
      if (p?.kind === 'counter') return cue(p.options.length ? 'Não usar Counter' : 'Concluir', [], 'Etapa de Counter');
      return cue('Passar');
    case 'concede':
      return cue('Desistir da partida');
    case 'timeout':
      return cue(a.abandoned ? 'Abandonou a partida' : 'Ficou sem tempo', [], 'registrado pelo servidor');
    case 'manual': {
      const m = manualLabel(a.op, name);
      return cue(`⚙ ${m.title}`, m.target ? cards([m.target]) : [], 'ferramenta manual');
    }
    case 'manualDone':
      return cue('Continuar', [], p?.kind === 'manual' ? `⚙ ${name(p.source)}: efeito aplicado à mão` : undefined);
    case 'option': {
      if (p?.kind !== 'option') return cue(`Opção ${a.index + 1}`);
      const label = p.options[a.index];
      return cue(label !== undefined ? optionLabel(label, lang, !p.order && !p.don) : `Opção ${a.index + 1}`, [], p.prompt);
    }
  }
}
