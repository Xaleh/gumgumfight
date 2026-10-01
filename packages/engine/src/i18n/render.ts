// Texto em português gerado a partir dos passos que o motor executa.
//
// Para toda linha de efeito que o leitor automático entende, o texto em português é
// montado a partir da DSL (e não do inglês): fica completo, consistente e descreve
// exatamente o que o jogo vai fazer. Linhas não reconhecidas usam o tradutor por
// regras de frase (pt.ts).

import { effectLines, parseEffectLine, parseTriggerText } from '../cards/parser';
import { KEYWORD_ONLY } from '../cards/split';
import type {
  Ability,
  AbilityCost,
  CardCategory,
  CardData,
  CardFilter,
  Condition,
  Duration,
  EffectStep,
  GameEvent,
  Keyword,
  TargetRef,
  TargetSpec,
} from '../types';
import { translateToPt } from './pt';

const KW: Record<Keyword, string> = {
  rush: '[Rush]',
  blocker: '[Blocker]',
  doubleAttack: '[Double Attack]',
  banish: '[Banish]',
  rushCharacter: '[Rush: Character]',
};

const TIMING: Record<string, string> = {
  activateMain: '[Ativar: Principal]',
  onPlay: '[Ao Jogar]',
  whenAttacking: '[Ao Atacar]',
  onKO: '[Ao ser Nocauteado]',
  onBlock: '[Ao Bloquear]',
  endOfTurn: '[Fim do Seu Turno]',
  main: '[Principal]',
  counter: '[Counter]',
  onOpponentAttack: '[No Ataque do Oponente]',
};

const COLOR_M: Record<string, [string, string]> = {
  red: ['vermelho', 'vermelhos'],
  green: ['verde', 'verdes'],
  blue: ['azul', 'azuis'],
  purple: ['roxo', 'roxos'],
  black: ['preto', 'pretos'],
  yellow: ['amarelo', 'amarelos'],
};
const COLOR_F: Record<string, [string, string]> = {
  red: ['vermelha', 'vermelhas'],
  green: ['verde', 'verdes'],
  blue: ['azul', 'azuis'],
  purple: ['roxa', 'roxas'],
  black: ['preta', 'pretas'],
  yellow: ['amarela', 'amarelas'],
};
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** Sinaliza que algo não tem descrição: a linha cai na tradução por regras. */
class Unknown extends Error {}
const unknown = (what: string): never => {
  throw new Unknown(what);
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const types = (list: string[]) => list.map((t) => `{${t}}`).join(' ou ');
const cards = (n: number) => `${n} ${plural(n, 'carta', 'cartas')}`;

interface Ctx {
  /** Como a própria carta é chamada ("este Personagem", "este Líder"...). */
  self: string;
}

function selfName(category: CardCategory): string {
  return category === 'character' ? 'este Personagem' : category === 'leader' ? 'este Líder' : category === 'stage' ? 'este Stage' : 'esta carta';
}

// ---------------------------------------------------------------------------
// Durações, alvos e filtros
// ---------------------------------------------------------------------------

function dur(d: Duration): string {
  switch (d) {
    case 'turn':
      return 'durante este turno';
    case 'battle':
      return 'durante esta batalha';
    case 'nextOpponentTurn':
      return 'até o fim do próximo turno do oponente';
    case 'untilYourNextTurn':
      return 'até o início do seu próximo turno';
    case 'endOfYourNextTurn':
      return 'até o fim do seu próximo turno';
  }
}

/** Restrições comuns a alvos e filtros ("com custo 3 ou menos", "exceto [X]"...). */
function limits(f: CardFilter & Partial<TargetSpec>, many: boolean): string[] {
  const out: string[] = [];
  const base = f.base ? ' base' : '';
  if (f.minCost !== undefined && f.minCost === f.maxCost) out.push(`com custo${base} ${f.minCost}`);
  else {
    if (f.maxCost !== undefined) out.push(`com custo${base} ${f.maxCost} ou menos`);
    if (f.minCost !== undefined) out.push(`com custo${base} ${f.minCost} ou mais`);
  }
  if (f.maxCostDynamic) {
    const what =
      f.maxCostDynamic === 'opponentLife'
        ? 'ao número de cartas de Vida do oponente'
        : f.maxCostDynamic === 'ownLife'
          ? 'ao número das suas cartas de Vida'
          : 'ao total de cartas de Vida suas e do oponente';
    out.push(`com custo igual ou menor ${what}`);
  }
  if (f.minPower !== undefined && f.minPower === f.maxPower) out.push(`com ${f.minPower} de poder${base}`);
  else {
    if (f.maxPower !== undefined) out.push(`com ${f.maxPower} de poder${base} ou menos`);
    if (f.minPower !== undefined) out.push(`com ${f.minPower} de poder${base} ou mais`);
  }
  if (f.typeIncludes) out.push(`com um tipo que inclua "${f.typeIncludes}"`);
  if (f.noEffect) out.push('sem efeito');
  if (f.hasTrigger) out.push('com [Trigger]');
  if (f.excludeSelf) out.push(many ? 'exceto esta carta' : 'que não seja esta carta');
  if (f.excludeName) out.push(`exceto [${f.excludeName}]`);
  return out;
}

function noun(kinds: TargetSpec['kinds'], many: boolean): string {
  const k = [...kinds].sort().join('+');
  switch (k) {
    case 'character':
      return many ? 'Personagens' : 'Personagem';
    case 'leader':
      return many ? 'Líderes' : 'Líder';
    case 'character+leader':
      return many ? 'Líderes ou Personagens' : 'Líder ou Personagem';
    case 'stage':
      return many ? 'Stages' : 'Stage';
    case 'leader+stage':
      return many ? 'Líderes ou Stages' : 'Líder ou Stage';
    case 'character+leader+stage':
      return many ? 'cartas' : 'carta';
    default:
      return unknown(`kinds ${k}`);
  }
}

function target(ref: TargetRef, ctx: Ctx): string {
  if (ref === 'self') return ctx.self;
  if (ref === 'ownLeader') return 'o seu Líder';
  if (ref === 'chosen') return 'essa carta';
  if (ref === 'battleTarget') return 'a carta atacada';
  const spec = ref;
  const many = spec.all || spec.upTo > 1;
  const adj: string[] = [];
  if (spec.rested === true) adj.push(many ? 'virados' : 'virado');
  if (spec.rested === false) adj.push(many ? 'ativos' : 'ativo');
  if (spec.color) adj.push(COLOR_M[spec.color][many ? 1 : 0]);
  if (spec.keyword) adj.push(`com ${KW[spec.keyword]}`);
  if (spec.hasAnyType?.length) adj.push(`do tipo ${types(spec.hasAnyType)}`);
  let head: string;
  if (spec.name) {
    const n = `[${spec.name}]`;
    head = spec.all
      ? `todas as suas cartas ${n}`
      : spec.side === 'own'
        ? `até ${spec.upTo} ${plural(spec.upTo, 'carta sua', 'cartas suas')} ${n}`
        : `até ${spec.upTo} ${n}`;
    return [head, ...adj, ...limits(spec, many)].join(' ');
  }
  const nn = noun(spec.kinds, many || spec.side === 'own');
  if (spec.side === 'own') {
    head = spec.all ? `todos os seus ${nn}` : `até ${spec.upTo} dos seus ${noun(spec.kinds, true)}`;
    const adjOwn = adj.map((a) => (a === 'virado' ? 'virados' : a === 'ativo' ? 'ativos' : a));
    return [head, ...adjOwn, ...limits(spec, true)].join(' ');
  }
  const who = spec.side === 'opponent' ? 'do oponente' : '';
  head = spec.all ? `todos os ${noun(spec.kinds, true)}` : `até ${spec.upTo} ${noun(spec.kinds, many)}`;
  return [head, ...adj, who, ...limits(spec, many)].filter(Boolean).join(' ');
}

/** Cartas fora do campo ("até 1 Personagem do tipo {X} com custo 3 ou menos"). */
function filter(f: CardFilter, n: number, upTo = true): string {
  const many = n > 1;
  const nounText =
    f.category === 'character'
      ? many
        ? 'Personagens'
        : 'Personagem'
      : f.category === 'event'
        ? many
          ? 'Eventos'
          : 'Evento'
        : f.category === 'stage'
          ? many
            ? 'Stages'
            : 'Stage'
          : f.name
            ? ''
            : cards(n).replace(/^\d+ /, '');
  const fem = !f.category && !f.name;
  const parts: string[] = [upTo ? `até ${n}` : String(n)];
  if (f.name) parts.push(`[${f.name}]`);
  if (nounText) parts.push(nounText);
  if (f.color) parts.push((fem ? COLOR_F : COLOR_M)[f.color][many ? 1 : 0]);
  if (f.hasAnyType?.length) parts.push(`do tipo ${types(f.hasAnyType)}`);
  parts.push(...limits(f, many));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Condições e acontecimentos
// ---------------------------------------------------------------------------

function condition(c: Condition, ctx: Ctx): string {
  const out: string[] = [];
  const range = (min: number | undefined, max: number | undefined, what: string) => {
    if (min !== undefined && min === max) out.push(`você tiver ${min} ${what}`);
    else {
      if (min !== undefined) out.push(`você tiver ${min} ou mais ${what}`);
      if (max !== undefined) out.push(`você tiver ${max} ou menos ${what}`);
    }
  };
  for (const key of Object.keys(c) as Array<keyof Condition>) {
    switch (key) {
      case 'minCharacters':
        out.push(`você tiver ${c.minCharacters} ou mais Personagens`);
        break;
      case 'maxCharacters':
        out.push(`você tiver ${c.maxCharacters} ou menos Personagens`);
        break;
      case 'selfRested':
        out.push(`${ctx.self} estiver virado`);
        break;
      case 'minDonOnField':
      case 'maxDonOnField':
        if (key === 'minDonOnField' || c.minDonOnField === undefined) range(c.minDonOnField, c.maxDonOnField, 'DON!! no seu campo');
        break;
      case 'handMin':
      case 'handMax':
        if (key === 'handMin' || c.handMin === undefined) range(c.handMin, c.handMax, 'cartas na mão');
        break;
      case 'lifeMin':
      case 'lifeMax':
        if (key === 'lifeMin' || c.lifeMin === undefined) range(c.lifeMin, c.lifeMax, 'cartas de Vida');
        break;
      case 'leaderHasType':
        out.push(`o seu Líder tiver o tipo {${c.leaderHasType}}`);
        break;
      case 'leaderHasAnyType':
        out.push(`o seu Líder tiver o tipo ${types(c.leaderHasAnyType!)}`);
        break;
      case 'leaderName':
        out.push(`o seu Líder for [${c.leaderName}]`);
        break;
      case 'leaderMulticolor':
        out.push('o seu Líder for multicolorido');
        break;
      case 'leaderTypeOrName':
        out.push(`o seu Líder tiver o tipo {${c.leaderTypeOrName!.type}} ou for [${c.leaderTypeOrName!.name}]`);
        break;
      case 'opponentMoreDon':
        out.push('o oponente tiver mais DON!! no campo do que você');
        break;
      case 'donLeqOpponent':
        out.push('você tiver no campo um número de DON!! igual ou menor que o do oponente');
        break;
      case 'opponentMinDonOnField':
        out.push(`o oponente tiver ${c.opponentMinDonOnField} ou mais DON!! no campo`);
        break;
      case 'opponentLifeMax':
        out.push(`o oponente tiver ${c.opponentLifeMax} ou menos cartas de Vida`);
        break;
      case 'opponentLifeMin':
        out.push(`o oponente tiver ${c.opponentLifeMin} ou mais cartas de Vida`);
        break;
      case 'totalLifeMax':
        out.push(`você e o oponente tiverem, juntos, ${c.totalLifeMax} ou menos cartas de Vida`);
        break;
      case 'lifeLessThanOpponent':
        out.push('você tiver menos cartas de Vida que o oponente');
        break;
      case 'lifeLeqOpponent':
        out.push('você tiver um número de cartas de Vida igual ou menor que o do oponente');
        break;
      case 'anyCharacterCost': {
        const r = c.anyCharacterCost!;
        out.push(
          `houver um Personagem com custo ${r.min !== undefined && r.min === r.max ? r.min : r.min !== undefined ? `${r.min} ou mais` : `${r.max} ou menos`}`,
        );
        break;
      }
      case 'noCharacterNamed':
        out.push(`você não tiver [${c.noCharacterNamed}]`);
        break;
      case 'haveCharacterNamed':
        out.push(`você tiver [${c.haveCharacterNamed}]`);
        break;
      case 'noOtherNamed':
        out.push(`você não tiver outro Personagem [${c.noOtherNamed}]`);
        break;
      case 'opponentCharacterMinPower':
        out.push(`o oponente tiver um Personagem com ${c.opponentCharacterMinPower} ou mais de poder`);
        break;
      case 'opponentCharacterMinCost':
        out.push(`o oponente tiver um Personagem com custo ${c.opponentCharacterMinCost} ou mais`);
        break;
      case 'anyOf':
        out.push(c.anyOf!.map((x) => condition(x, ctx)).join(' ou '));
        break;
      case 'ownCharacterMinBasePower':
        out.push(`você tiver um Personagem com ${c.ownCharacterMinBasePower} de poder base ou mais`);
        break;
      case 'ownCharacterMinCost':
        out.push(`você tiver um Personagem com custo ${c.ownCharacterMinCost} ou mais`);
        break;
      case 'ownCharacterMinPower':
        out.push(`você tiver um Personagem com ${c.ownCharacterMinPower} ou mais de poder`);
        break;
      case 'ownTypedCharacterMinCost':
        out.push(`você tiver um Personagem do tipo {${c.ownTypedCharacterMinCost!.type}} com custo ${c.ownTypedCharacterMinCost!.cost} ou mais`);
        break;
      case 'trashMin':
        out.push(`você tiver ${c.trashMin} ou mais cartas no descarte`);
        break;
      case 'trashEventsMin':
        out.push(`você tiver ${c.trashEventsMin} ou mais Eventos no descarte`);
        break;
      case 'deckMax':
        out.push(`você tiver ${c.deckMax} ou menos cartas no deck`);
        break;
      case 'opponentHandMin':
        out.push(`o oponente tiver ${c.opponentHandMin} ou mais cartas na mão`);
        break;
      case 'selfMinPower':
        out.push(`${ctx.self} tiver ${c.selfMinPower} ou mais de poder`);
        break;
      case 'anyDonGiven':
        out.push('você tiver algum DON!! anexado');
        break;
      case 'selfPlayedThisTurn':
        out.push(`${ctx.self} tiver sido jogado neste turno`);
        break;
      case 'minTypedCharacters':
        out.push(`você tiver ${c.minTypedCharacters!.count} ou mais Personagens do tipo {${c.minTypedCharacters!.type}}`);
        break;
      case 'minRestedTyped': {
        const r = c.minRestedTyped!;
        out.push(`você tiver ${r.count} ou mais Personagens virados${r.types ? ` do tipo ${types(r.types)}` : ''}`);
        break;
      }
      case 'minRestedCharacters':
        out.push(`você tiver ${c.minRestedCharacters} ou mais Personagens virados`);
        break;
      case 'opponentMinRestedCharacters':
        out.push(`o oponente tiver ${c.opponentMinRestedCharacters} ou mais Personagens virados`);
        break;
      case 'minGivenDon':
        out.push(`você tiver ${c.minGivenDon} ou mais DON!! anexados no total`);
        break;
      case 'opponentAnyDonGiven':
        out.push('o oponente tiver algum DON!! anexado');
        break;
      case 'minActiveDon':
        out.push(`você tiver ${c.minActiveDon} ou mais DON!! ativos`);
        break;
      case 'lastDone':
        out.push('fizer isso');
        break;
      case 'chosenMatches':
        out.push(`essa carta for ${filter(c.chosenMatches!, 1, false).replace(/^1 (?=carta)/, 'uma ').replace(/^1 /, 'um ')}`);
        break;
      default:
        unknown(`condição ${key}`);
    }
  }
  return out.join(' e ');
}

function event(e: GameEvent, ctx: Ctx): string {
  switch (e.kind) {
    case 'donReturned':
      return 'um DON!! do seu campo voltar ao seu deck de DON!!';
    case 'characterKO':
      return e.whose === 'any' ? 'um Personagem for nocauteado' : e.whose === 'own' ? 'um Personagem seu for nocauteado' : 'um Personagem do oponente for nocauteado';
    case 'eventActivated':
      return e.who === 'self' ? 'você ativar um Evento' : 'o oponente ativar um Evento';
    case 'blockerActivated':
      return e.who === 'self' ? 'você ativar um [Blocker]' : 'o oponente ativar um [Blocker]';
    case 'selfRested':
      return `${ctx.self} for virado`;
    case 'attackDamage':
      return `o ataque de ${ctx.self} causar dano à Vida do oponente`;
    case 'battleKO':
      return `${ctx.self} batalhar e nocautear um Personagem do oponente`;
  }
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

function cost(c: AbilityCost, ctx: Ctx): string {
  const symbols: string[] = [];
  if (c.restDon) symbols.push(CIRCLED[c.restDon - 1] ?? `(${c.restDon})`);
  if (c.donMinus) symbols.push(`DON!! −${c.donMinus}`);
  const parts: string[] = [];
  if (c.restSelf) parts.push(`virar ${ctx.self}`);
  if (c.trashFromHand) {
    const what = c.trashFilter ? filter(c.trashFilter, c.trashFromHand, false) : cards(c.trashFromHand);
    parts.push(`descartar ${what} da sua mão`);
  }
  if (c.handToBottom) parts.push(`colocar ${cards(c.handToBottom)} da sua mão no fundo do deck`);
  if (c.restCharacters) parts.push(`virar ${c.restCharacters} dos seus Personagens`);
  if (c.restOwn) parts.push(`virar ${target({ ...c.restOwn.spec, upTo: c.restOwn.count }, ctx).replace(/^até /, '')}`);
  if (c.returnOwn) parts.push(`devolver ${target({ ...c.returnOwn.spec, upTo: c.returnOwn.count }, ctx).replace(/^até /, '')} à mão do dono`);
  if (c.koOwn) parts.push(`nocautear ${target({ ...c.koOwn.spec, upTo: c.koOwn.count }, ctx).replace(/^até /, '')}`);
  if (c.trashOwn) parts.push(`descartar ${target({ ...c.trashOwn.spec, upTo: c.trashOwn.count }, ctx).replace(/^até /, '')}`);
  if (c.lifeToHand) parts.push(`colocar ${cards(c.lifeToHand)} do ${c.lifeChoice ? 'topo ou do fundo' : 'topo'} da sua Vida na mão`);
  if (c.lifeToTrash) parts.push(`descartar ${cards(c.lifeToTrash.count)} do ${c.lifeToTrash.choose ? 'topo ou do fundo' : 'topo'} da sua Vida`);
  if (c.lifeFace) parts.push(`virar ${cards(c.lifeFace.count)} do topo da sua Vida com a face para ${c.lifeFace.up ? 'cima' : 'baixo'}`);
  if (c.mill) parts.push(`descartar ${cards(c.mill)} do topo do seu deck`);
  if (c.trashToBottom) {
    const what = c.trashToBottom.filter ? filter(c.trashToBottom.filter, c.trashToBottom.count, false) : cards(c.trashToBottom.count);
    parts.push(`colocar ${what} do seu descarte no fundo do deck`);
  }
  if (c.reveal) parts.push(`revelar ${c.reveal.filter ? filter(c.reveal.filter, c.reveal.count, false) : cards(c.reveal.count)} da sua mão`);
  if (c.returnSelf) parts.push(`devolver ${ctx.self} à mão do dono`);
  if (c.selfToBottom) parts.push(`colocar ${ctx.self} no fundo do deck do dono`);
  if (c.trashSelf) parts.push(`descartar ${ctx.self}`);
  const text = parts.length ? `Você pode ${parts.join(' e ')}` : '';
  return [...symbols, text].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------

const qty = (n: number) => (n === 1 ? 'até 1' : `até ${n}`);

function step(s: EffectStep, ctx: Ctx): string {
  switch (s.do) {
    case 'power':
      if (s.amount < 0) return `Dê −${-s.amount} de poder a ${target(s.target, ctx)} ${dur(s.duration)}.`;
      return `${cap(target(s.target, ctx))} recebe +${s.amount} de poder ${dur(s.duration)}.`;
    case 'cost':
      if (s.amount < 0) return `Dê −${-s.amount} de custo a ${target(s.target, ctx)} ${dur(s.duration)}.`;
      return `${cap(target(s.target, ctx))} recebe +${s.amount} de custo ${dur(s.duration)}.`;
    case 'ko':
      return `Nocauteie (K.O.) ${target(s.target, ctx)}.`;
    case 'rest':
      return `Vire ${target(s.target, ctx)}.`;
    case 'setActive':
      return `Deixe ${target(s.target, ctx)} ativo.`;
    case 'giveRestedDon':
      return s.fromOpponent
        ? `Dê ${qty(s.count)} DON!! ${plural(s.count, 'virado', 'virados')} do seu oponente a ${target(s.target, ctx)}.`
        : `Dê ${qty(s.count)} DON!! ${plural(s.count, 'virado', 'virados')} a ${target(s.target, ctx)}.`;
    case 'draw':
      return `Compre ${cards(s.count)}.`;
    case 'drawUntil':
      return `Compre cartas até ficar com ${s.count} cartas na mão.`;
    case 'addDonFromDeck':
      return `Adicione ${qty(s.count)} DON!! do seu deck de DON!! ${s.rested ? plural(s.count, 'virado', 'virados') : plural(s.count, 'ativo', 'ativos')}.`;
    case 'restOpponentDon':
      return `Vire ${qty(s.count)} DON!! do oponente.`;
    case 'returnToHand':
      return `Devolva ${target(s.target, ctx)} à mão do dono.`;
    case 'toDeckBottom':
      return `Coloque ${target(s.target, ctx)} no fundo do deck do dono.`;
    case 'trashTarget':
      return `Coloque ${target(s.target, ctx)} no descarte.`;
    case 'noBlockerThisBattle':
      if (s.minPower !== undefined) return `O oponente não pode ativar [Blocker] de Personagens com ${s.minPower} ou mais de poder durante esta batalha.`;
      if (s.maxPower !== undefined) return `O oponente não pode ativar [Blocker] de Personagens com ${s.maxPower} ou menos de poder durante esta batalha.`;
      if (s.maxCost !== undefined) return `O oponente não pode ativar [Blocker] de Personagens com custo ${s.maxCost} ou menos durante esta batalha.`;
      return 'O oponente não pode ativar [Blocker] durante esta batalha.';
    case 'noBlockerWhenAttacking':
      return `O oponente não pode ativar [Blocker] quando ${target(s.target, ctx)} atacar durante este turno.`;
    case 'useMainEffect':
      return 'Ative o efeito [Principal] desta carta.';
    case 'useCounterEffect':
      return 'Ative o efeito [Counter] desta carta.';
    case 'useOwnEffect':
      return `Ative o efeito ${TIMING[s.timing]} desta carta.`;
    case 'playThis':
      return s.rested ? 'Jogue esta carta virada.' : 'Jogue esta carta.';
    case 'addThisToHand':
      return 'Adicione esta carta à sua mão.';
    case 'trashFromHand': {
      const what = s.filter ? filter(s.filter, s.count, false) : cards(s.count);
      return `Descarte ${s.upTo ? `até ${what}` : what} da sua mão.`;
    }
    case 'setDonActive':
      return `Deixe ${qty(s.count)} dos seus DON!! ${plural(s.count, 'ativo', 'ativos')}.`;
    case 'search': {
      const verb = s.play ? 'jogue' : 'revele';
      const tail = s.play ? '' : ' e adicione à sua mão';
      const rest =
        s.rest === 'bottom'
          ? 'Depois, coloque o resto no fundo do seu deck em qualquer ordem.'
          : s.rest === 'trash'
            ? 'Depois, descarte o resto.'
            : 'Depois, coloque o resto no topo ou no fundo do deck, em qualquer ordem.';
      return `Olhe as ${s.look} cartas do topo do seu deck; ${verb} ${filter(s.filter, s.upTo)}${tail}. ${rest}`;
    }
    case 'tutor':
      return `Revele ${filter(s.filter, s.upTo)} do seu deck e adicione à sua mão. Embaralhe o seu deck.`;
    case 'fromTrashToHand':
      return `Adicione ${filter(s.filter, s.upTo)} do seu descarte à sua mão.`;
    case 'playFrom': {
      const from = s.from === 'deck' ? 'do seu deck' : s.from === 'hand' ? 'da sua mão' : s.from === 'trash' ? 'do seu descarte' : 'da sua mão ou do descarte';
      return `Jogue ${filter(s.filter, s.upTo)} ${from}${s.rested ? ', virado' : ''}.`;
    }
    case 'shuffleDeck':
      return 'Embaralhe o seu deck.';
    case 'arrangeTop':
      return `Olhe as ${s.look} cartas do topo do seu deck e devolva-as ao topo ou ao fundo do deck, em qualquer ordem.`;
    case 'trashLife':
      return `Descarte ${qty(s.count)} ${plural(s.count, 'carta', 'cartas')} do topo da Vida ${s.side === 'own' ? 'sua' : 'do oponente'}.`;
    case 'gainKeyword':
      return `${cap(target(s.target, ctx))} ganha ${KW[s.keyword]} ${dur(s.duration)}.`;
    case 'cannotBeKO':
      return `${cap(target(s.target, ctx))} não pode ser nocauteado${s.inBattle ? ' em batalha' : ''} ${dur(s.duration)}.`;
    case 'cannotAttack':
      return `${cap(target(s.target, ctx))} não pode atacar ${dur(s.duration)}.`;
    case 'canAttackActive':
      return `${cap(target(s.target, ctx))} também pode atacar Personagens ativos ${dur(s.duration)}.`;
    case 'cannotBeRested':
      return `${cap(target(s.target, ctx))} não pode ser virado ${dur(s.duration)}.`;
    case 'select':
      return `Escolha ${target(s.target, ctx)}.`;
    case 'millDeck':
      return `Descarte ${cards(s.count)} do topo do seu deck.`;
    case 'opponentDiscards':
      return `O oponente escolhe ${cards(s.count)} da própria mão e ${plural(s.count, 'a descarta', 'as descarta')}.`;
    case 'opponentHandToBottom':
      return `O oponente coloca ${cards(s.count)} da própria mão no fundo do deck.`;
    case 'opponentReturnsDon':
      return `O oponente devolve ${s.count} DON!! do campo ao deck de DON!!.`;
    case 'opponentLifeToHand':
      return `Coloque ${qty(s.count)} ${plural(s.count, 'carta', 'cartas')} do topo da Vida do oponente na mão do dono.`;
    case 'trashRandomFromOpponentHand':
      return `Descarte ${cards(s.count)} da mão do oponente (ao acaso).`;
    case 'addLifeFromDeck':
      return `Adicione ${qty(s.count)} ${plural(s.count, 'carta', 'cartas')} do topo do seu deck ao topo da sua Vida.`;
    case 'lifeToHand':
      return `Coloque ${cards(s.count)} do ${s.choose ? 'topo ou do fundo' : 'topo'} da sua Vida na mão.`;
    case 'handToLife':
      return `Coloque ${s.filter ? filter(s.filter, s.upTo) : `${qty(s.upTo)} ${plural(s.upTo, 'carta', 'cartas')}`} da sua mão no topo da sua Vida.`;
    case 'fieldToLife':
      return `Coloque ${target(s.target, ctx)} no ${s.choose ? 'topo ou no fundo' : 'topo'} da Vida do dono.`;
    case 'peekLife':
      return `Olhe até 1 carta do topo ${s.whose === 'either' ? 'da sua Vida ou da Vida do oponente' : s.whose === 'own' ? 'da sua Vida' : 'da Vida do oponente'} e coloque-a no topo ou no fundo dessa Vida.`;
    case 'chooseOne':
      return `${s.chooser === 'self' ? 'Escolha um' : 'O oponente escolhe um'}: ${s.options.map((o) => `• ${steps(o, ctx)}`).join(' ')}`;
    case 'revealTop':
      return 'Revele 1 carta do topo do seu deck.';
    case 'playRevealed':
      return `Jogue essa carta${s.filter ? ` se for ${filter(s.filter, 1, false).replace(/^1 (?=carta)/, 'uma ').replace(/^1 /, 'um ')}` : ''}${s.rested ? ', virada' : ''}.`;
    case 'revealedToHand':
      return `Se for ${s.filter ? filter(s.filter, 1, false).replace(/^1 (?=carta)/, 'uma ').replace(/^1 /, 'um ') : 'uma carta'}, adicione-a à sua mão.`;
    case 'lookOpponentTop':
      return 'Olhe a carta do topo do deck do oponente.';
    case 'revealedToBottom':
      return 'Coloque a carta revelada no fundo do seu deck.';
    case 'skipRefresh':
      return `${cap(target(s.target, ctx))} não fica ativo na próxima Fase de Renovação do oponente.`;
    case 'delayed':
      return `No fim deste turno: ${steps(s.steps, ctx)}`;
    default:
      return unknown(`passo ${s.do}`);
  }
}

/** Passos em sequência; condições ("if") viram "Se …,"; "you may" vira "Você pode …". */
function steps(list: EffectStep[], ctx: Ctx): string {
  const out: string[] = [];
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const noDot = (t: string) => t.replace(/\.$/, '');
  let sentences = 0; // frases de efeito já escritas (para o "Depois,")
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.do === 'payCost') {
      const scope = s.scope;
      const c = cost(s.cost, ctx);
      if (scope !== undefined && !c) {
        // "you may X": "Você pode X." (verbo no infinitivo)
        const inner = list.slice(i + 1, i + 1 + scope).map((x) => noDot(step(x, ctx)));
        const text = `você pode ${inner.map(toInfinitive).join(' e ')}.`;
        out.push(sentences++ ? `Depois, ${text}` : cap(text));
        i += scope;
        continue;
      }
      out.push(`${c || 'Você pode usar este efeito'}:`);
      continue;
    }
    // Passos seguidos com a mesma condição: "Se X, compre 2 cartas e descarte 1 carta."
    const key = s.if && Object.keys(s.if).length ? JSON.stringify(s.if) : null;
    const group: EffectStep[] = [s];
    while (key && i + 1 < list.length && list[i + 1].do !== 'payCost' && JSON.stringify(list[i + 1].if ?? null) === key) {
      group.push(list[++i]);
    }
    const body = group.map((g, k) => (k ? lower(noDot(step(g, ctx))) : noDot(step(g, ctx)))).join(' e ');
    let text = key ? `Se ${condition(s.if!, ctx)}, ${lower(body)}.` : `${body}.`;
    if (sentences++ && !/^(Olhe|Revele)/.test(text)) text = `Depois, ${lower(text)}`;
    out.push(text);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const INF: Record<string, string> = {
  dê: 'dar',
  nocauteie: 'nocautear',
  vire: 'virar',
  deixe: 'deixar',
  compre: 'comprar',
  adicione: 'adicionar',
  devolva: 'devolver',
  coloque: 'colocar',
  descarte: 'descartar',
  jogue: 'jogar',
  olhe: 'olhar',
  revele: 'revelar',
  embaralhe: 'embaralhar',
  escolha: 'escolher',
  ative: 'ativar',
};
const toInfinitive = (t: string) => t.replace(/^(\S+)/, (w) => INF[w.toLowerCase()] ?? w.charAt(0).toLowerCase() + w.slice(1));

// ---------------------------------------------------------------------------
// Habilidades e cartas
// ---------------------------------------------------------------------------

function header(a: Ability): string[] {
  const tags: string[] = [];
  if (a.don) tags.push(`[DON!! x${a.don}]`);
  if (a.yourTurn) tags.push('[Seu Turno]');
  if (a.opponentsTurn) tags.push('[Turno do Oponente]');
  if (a.timing in TIMING) tags.push(TIMING[a.timing]);
  if (a.oncePerTurn) tags.push('[Uma Vez por Turno]');
  return tags;
}

function staticText(a: Ability, ctx: Ctx): string {
  const parts: string[] = [];
  if (a.staticPower) parts.push(a.staticPower > 0 ? `recebe +${a.staticPower} de poder` : `recebe −${-a.staticPower} de poder`);
  if (a.staticCost) parts.push(`recebe +${a.staticCost} de custo`);
  if (a.powerPer) {
    const what = { hand: 'carta na sua mão', restedDon: 'DON!! virado seu', trash: 'carta no seu descarte', trashEvents: 'Evento no seu descarte' }[a.powerPer.what];
    parts.push(`recebe +${a.powerPer.power} de poder para cada ${a.powerPer.every > 1 ? `${a.powerPer.every} × ` : ''}${what}`);
  }
  if (a.staticKeyword) parts.push(`ganha ${KW[a.staticKeyword]}`);
  if (a.staticCanAttackActive) parts.push('também pode atacar Personagens ativos do oponente');
  if (a.staticNoBattleKO) parts.push('não pode ser nocauteado em batalha');
  if (a.staticNoEffectKO) parts.push('não pode ser nocauteado por efeitos');
  if (a.staticCannotAttack) parts.push('não pode atacar');
  if (a.noBattleKOVsAttribute) parts.push(`não pode ser nocauteado em batalha por Personagens de atributo ${a.noBattleKOVsAttribute}`);
  if (a.noBattleKOByLeader) parts.push('não pode ser nocauteado em batalha por Líderes');
  let text: string;
  if (a.battleVsAttribute) {
    text = `Quando ${ctx.self} batalhar com Personagens de atributo ${a.battleVsAttribute.attribute}, recebe +${a.battleVsAttribute.power} de poder durante este turno.`;
  } else if (a.aura) {
    const au = a.aura;
    const many = au.kinds.length > 1 ? 'Líderes e Personagens' : au.kinds[0] === 'leader' ? 'Líder' : 'Personagens';
    const whose = au.side === 'opponent' ? `todos os ${many} do oponente` : `os seus ${many}`;
    const filt = [
      au.names?.length ? `chamados ${au.names.map((n) => `[${n}]`).join(' ou ')}` : '',
      au.hasAnyType?.length ? `do tipo ${types(au.hasAnyType)}` : '',
      au.typeIncludes ? `com um tipo que inclua "${au.typeIncludes}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const effect = au.cost !== undefined ? `${au.cost > 0 ? '+' : '−'}${Math.abs(au.cost)} de custo` : `+${au.power} de poder`;
    text = `${cap([whose, filt].filter(Boolean).join(' '))} recebem ${effect}.`;
  } else if (parts.length) {
    text = `${cap(ctx.self)} ${parts.join(' e ')}.`;
  } else {
    return unknown('estático');
  }
  return a.condition && Object.keys(a.condition).length ? `Se ${condition(a.condition, ctx)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function ability(a: Ability, ctx: Ctx): string {
  const tags = header(a);
  let body: string;
  if (a.timing === 'static') body = staticText(a, ctx);
  else if (a.timing === 'event') body = `Quando ${event(a.event!, ctx)}, ${steps(a.steps, ctx).replace(/^./, (c) => c.toLowerCase())}`;
  else if (a.timing === 'replace' && a.replace) {
    const r = a.replace;
    const who = r.who === 'self' ? ctx.self : target({ ...r.who, upTo: 1 }, ctx).replace(/^até 1 dos seus Personagens/, 'um Personagem seu');
    const what = r.event === 'ko' ? 'for nocauteado' : r.event === 'removal' ? 'for removido do campo' : 'for nocauteado ou removido do campo';
    const by = r.by === 'battle' ? ' em batalha' : r.by === 'effect' ? ' por um efeito' : r.by === 'opponentEffect' ? ' por um efeito do oponente' : '';
    const c = a.cost ? cost(a.cost, ctx).replace(/^Você pode /, '') : '';
    body = `Se ${who} ${what}${by}, você pode ${c} em vez disso.`;
  } else if (a.timing === 'battlesCharacter') body = `Se ${ctx.self} batalhar com um Personagem do oponente, ${steps(a.steps, ctx).replace(/^./, (c) => c.toLowerCase())}`;
  else {
    const c = a.cost ? cost(a.cost, ctx) : '';
    body = (c ? `${c}: ` : '') + steps(a.steps, ctx);
  }
  return [...tags, body].join(' ');
}

/** Várias habilidades da mesma linha (ex.: "[On Play]/[When Attacking]"): mesmo corpo, marcações juntas. */
function line(abilities: Ability[], ctx: Ctx): string {
  // Várias frases estáticas da mesma linha: as marcações aparecem uma vez só.
  if (abilities.length > 1 && abilities.every((a) => a.timing === 'static')) {
    return [...header(abilities[0]), ...abilities.map((a) => staticText(a, ctx))].join(' ');
  }
  if (abilities.length > 1 && abilities.every((a) => JSON.stringify(a.steps) === JSON.stringify(abilities[0].steps))) {
    const timings = abilities.map((a) => TIMING[a.timing]).join('/');
    const first = ability(abilities[0], ctx);
    return first.replace(TIMING[abilities[0].timing], timings);
  }
  return abilities.map((a) => ability(a, ctx)).join(' ');
}

export interface CardTranslation {
  text: string;
  trigger?: string;
  /** false quando sobrou trecho em inglês. */
  complete: boolean;
}

/**
 * Tradução de uma carta: cada linha que o leitor entende é descrita a partir dos passos;
 * as demais usam o tradutor por regras.
 */
export function translateCardPt(card: Pick<CardData, 'category' | 'text' | 'trigger'>): CardTranslation {
  const ctx: Ctx = { self: selfName(card.category) };
  let complete = true;
  const lines = effectLines(card.text ?? '').map((l) => {
    if (!KEYWORD_ONLY.test(l)) {
      const parsed = parseEffectLine(l, card.category);
      if (parsed?.length) {
        try {
          // Lembretes de palavra-chave no fim da linha original continuam (traduzidos).
          return line(parsed, ctx);
        } catch (e) {
          if (!(e instanceof Unknown)) throw e;
        }
      }
    }
    const r = translateToPt(l);
    complete &&= r.complete;
    return r.text;
  });
  let trigger: string | undefined;
  if (card.trigger?.trim()) {
    const parsed = parseTriggerText(card.trigger);
    trigger = undefined;
    if (parsed) {
      try {
        trigger = steps(parsed, ctx);
      } catch (e) {
        if (!(e instanceof Unknown)) throw e;
      }
    }
    if (trigger === undefined) {
      const r = translateToPt(card.trigger);
      complete &&= r.complete;
      trigger = r.text;
    }
  }
  return { text: lines.join('\n'), trigger, complete };
}
