// Texto em português gerado a partir dos passos que o motor executa.
//
// Para toda linha de efeito que o leitor automático entende, o texto em português é
// montado a partir da DSL (e não do inglês): fica completo, consistente e descreve
// exatamente o que o jogo vai fazer. Linhas não reconhecidas usam o tradutor por
// regras de frase (pt.ts).

import { cleanEffectText, effectLines, parseBody, parseEffectLine, parseTriggerText } from '../cards/parser';
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
  unblockable: '[Unblockable]',
};

const TIMING: Record<string, string> = {
  activateMain: '[Ativar: Principal]',
  onPlay: '[Ao Jogar]',
  whenAttacking: '[Ao Atacar]',
  onKO: '[Ao ser Nocauteado]',
  onBlock: '[Ao Bloquear]',
  endOfTurn: '[Fim do Seu Turno]',
  endOfOpponentTurn: '[Fim do Turno do Oponente]',
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
/** Ferramentas de análise: o que ficou sem descrição. */
export const unknownSeen: Record<string, number> = {};
const unknown = (what: string): never => {
  unknownSeen[what] = (unknownSeen[what] ?? 0) + 1;
  throw new Unknown(what);
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Primeira letra minúscula, sem mexer em "DON!!" e nos nomes entre colchetes. */
const lowerFirst = (t: string) => (/^(DON!!|\[)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
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

/** "de" + artigo/demonstrativo contraídos ("do seu Líder", "deste Personagem"). */
function de(t: string): string {
  return `de ${t}`.replace(/^de o /, 'do ').replace(/^de a /, 'da ').replace(/^de este /, 'deste ').replace(/^de esta /, 'desta ').replace(/^de essa /, 'dessa ').replace(/^de esse /, 'desse ');
}

/** Preposição "a" + alvo, com a contração ("a o seu Líder" → "ao seu Líder"). */
function a(t: string): string {
  return `a ${t}`.replace(/^a o /, 'ao ').replace(/^a os /, 'aos ');
}

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
  if (f.hasAllTypes?.length) out.push(`com os tipos ${f.hasAllTypes.map((t) => `{${t}}`).join(' e ')}`);
  if (f.withoutKeyword) out.push(`sem ${KW[f.withoutKeyword]}`);
  if (f.either) {
    const part = (p: Partial<TargetSpec>) =>
      [
        p.kinds ? noun(p.kinds, false) : '',
        p.rested ? 'virado' : '',
        p.name ? `[${p.name}]` : '',
        p.hasAnyType?.length ? `do tipo ${types(p.hasAnyType)}` : '',
        ...limits({ ...p, either: undefined, typeIncludes: p.typeIncludes, hasTrigger: p.hasTrigger } as CardFilter & Partial<TargetSpec>, false),
      ]
        .filter(Boolean)
        .join(' ');
    out.push(`(${f.either.map(part).join(' ou ')})`);
  }
  if (f.attribute && !f.orName) out.push(`do atributo ${f.attribute}`);
  if (f.attribute && f.orName) out.push(`que seja [${f.orName}] ou tenha o atributo ${f.attribute}`);
  if (f.orAttribute) out.push(`ou do atributo ${f.orAttribute}`);
  if (f.orName && !f.attribute) out.push(`ou [${f.orName}]`);
  if (f.maxCostOppDon) out.push('com custo igual ou menor ao número de DON!! no campo do oponente');
  if (f.leaderOnlyNamed) out.push(`(o Líder só se for [${f.leaderOnlyNamed}])`);
  if (f.withoutTiming) out.push(f.withoutTiming === 'onPlay' ? 'sem efeito [Ao Jogar]' : 'sem efeito [Ao Atacar]');
  if (f.maxCostDon) out.push('com custo igual ou menor ao número de DON!! no seu campo');
  if (f.distinctNames) out.push('com nomes diferentes');
  if (f.minDon) out.push(f.minDon === 1 ? 'com DON!! anexado' : `com ${f.minDon} ou mais DON!! anexados`);
  if (f.excludeSelf) out.push(many ? 'exceto esta carta' : 'que não seja esta carta');
  if (f.excludeName) out.push(`exceto [${f.excludeName}]`);
  if ('totalMaxPower' in f && f.totalMaxPower !== undefined) out.push(`com poder somado de ${f.totalMaxPower} ou menos`);
  if ('totalMaxCost' in f && f.totalMaxCost !== undefined) out.push(`com custo somado de ${f.totalMaxCost} ou menos`);
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
    case 'character+stage':
      return many ? 'Personagens ou Stages' : 'Personagem ou Stage';
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
  // "your opponent's Characters with a total cost of 4 or less": sem quantidade (o leitor usa 99
  // como "quantas quiser"); o número não pode aparecer no texto.
  const anyNumber = !spec.all && spec.upTo >= 99;
  const adj: string[] = [];
  if (spec.rested === true) adj.push(many ? 'virados' : 'virado');
  if (spec.rested === false) adj.push(many ? 'ativos' : 'ativo');
  if (spec.color) adj.push(COLOR_M[spec.color][many ? 1 : 0]);
  if (spec.keyword) adj.push(`com ${KW[spec.keyword]}`);
  if (spec.hasAnyType?.length) adj.push(`do tipo ${types(spec.hasAnyType)}`);
  let head: string;
  if (spec.name || spec.names) {
    const n = spec.names ? spec.names.map((x) => `[${x}]`).join(' ou ') : `[${spec.name}]`;
    head = spec.all
      ? `todas as suas cartas ${n}`
      : anyNumber
        ? spec.side === 'own'
          ? `cartas suas ${n}`
          : `cartas ${n}${spec.side === 'opponent' ? ' do oponente' : ''}`
        : spec.side === 'own'
          ? `até ${spec.upTo} ${plural(spec.upTo, 'carta sua', 'cartas suas')} ${n}`
          : `até ${spec.upTo} ${n}`;
    return [head, ...adj, ...limits(spec, many)].join(' ');
  }
  const nn = noun(spec.kinds, many || spec.side === 'own');
  if (spec.side === 'own') {
    head = spec.all ? `todos os seus ${nn}` : anyNumber ? `${noun(spec.kinds, true)} seus` : `até ${spec.upTo} dos seus ${noun(spec.kinds, true)}`;
    const adjOwn = adj.map((a) => (a === 'virado' ? 'virados' : a === 'ativo' ? 'ativos' : a));
    return [head, ...adjOwn, ...limits(spec, true)].join(' ');
  }
  const who = spec.side === 'opponent' ? 'do oponente' : '';
  head = spec.all ? `todos os ${noun(spec.kinds, true)}` : anyNumber ? noun(spec.kinds, true) : `até ${spec.upTo} ${noun(spec.kinds, many)}`;
  return [head, ...adj, who, ...limits(spec, many)].filter(Boolean).join(' ');
}

/** Cartas fora do campo ("até 1 Personagem do tipo {X} com custo 3 ou menos"). */
function filter(f: CardFilter, n: number, upTo = true): string {
  if (f.either?.length) {
    const parts = f.either.map((x) => filter(x, n, false).replace(/^\d+ /, ''));
    return `${upTo ? `até ${n}` : String(n)} ${parts.join(' ou ')}`;
  }
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
          : f.name || f.names
            ? ''
            : cards(n).replace(/^\d+ /, '');
  const fem = !f.category && !f.name && !f.names;
  // "Play up to 1 each of [Sabo], [Portgas.D.Ace], and [Monkey.D.Luffy]": um de cada nome.
  if (f.names && f.names.length > 1 && f.distinctNames && n === f.names.length) {
    const each = f.names.map((x) => `até 1 [${x}]`).join(', ').replace(/, (até 1 \[[^\]]+\])$/, ' e $1');
    const { distinctNames: _d, names: _n, ...rest } = f;
    return [each, ...limits(rest, false)].join(' ');
  }
  const parts: string[] = [upTo ? `até ${n}` : String(n)];
  if (f.name) parts.push(`[${f.name}]`);
  if (f.names) parts.push(f.names.map((x) => `[${x}]`).join(', ').replace(/, (\[[^\]]+\])$/, ' ou $1'));
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
        out.push(c.maxCharacters === c.minCharacters ? `você tiver ${c.minCharacters} Personagens` : `você tiver ${c.minCharacters} ou mais Personagens`);
        break;
      case 'maxCharacters':
        if (c.minCharacters !== c.maxCharacters) out.push(`você tiver ${c.maxCharacters} ou menos Personagens`);
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
      case 'leaderTypeIncludes':
        out.push(`o seu Líder tiver um tipo que inclua "${c.leaderTypeIncludes}"`);
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
        if (c.opponentLifeMin === c.opponentLifeMax) out.push(`o oponente tiver ${c.opponentLifeMax} ${plural(c.opponentLifeMax!, 'carta', 'cartas')} de Vida`);
        else out.push(`o oponente tiver ${c.opponentLifeMax} ou menos cartas de Vida`);
        break;
      case 'opponentLifeMin':
        if (c.opponentLifeMin !== c.opponentLifeMax) out.push(`o oponente tiver ${c.opponentLifeMin} ou mais cartas de Vida`);
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
        out.push(c.haveCharacterOnly ? `você tiver um Personagem [${c.haveCharacterNamed}]` : `você tiver [${c.haveCharacterNamed}]`);
        break;
      case 'noOtherNamed':
        out.push(`você não tiver outro Personagem [${c.noOtherNamed}]${c.noOtherNamedBaseCost !== undefined ? ` com custo base ${c.noOtherNamedBaseCost}` : ''}`);
        break;
      case 'noOtherNamedBaseCost':
        break;
      case 'opponentCharacterMinPower':
        out.push(`o oponente tiver um Personagem com ${c.opponentCharacterMinPower} ou mais de poder`);
        break;
      case 'opponentCharacterMinCost':
        out.push(`o oponente tiver um Personagem com custo ${c.opponentCharacterMinCost} ou mais`);
        break;
      case 'onlyTypedCharacters':
        out.push(`os únicos Personagens no seu campo forem do tipo {${c.onlyTypedCharacters}}`);
        break;
      case 'ownTypedCharacterMinPower':
        out.push(`você tiver um Personagem do tipo {${c.ownTypedCharacterMinPower!.type}} com ${c.ownTypedCharacterMinPower!.power} de poder ou mais`);
        break;
      case 'totalCharacterCostMin':
        out.push(`o custo total dos seus Personagens for ${c.totalCharacterCostMin} ou mais`);
        break;
      case 'activatedEventMinCost':
        out.push(`você tiver ativado neste turno um Evento com custo base ${c.activatedEventMinCost} ou mais`);
        break;
      case 'leaderAttribute':
        out.push(`o seu Líder tiver o atributo ${c.leaderAttribute}`);
        break;
      case 'haveNamed':
        if (c.haveNamedBasePower !== undefined) {
          out.push(`você tiver os Personagens ${c.haveNamed!.map((n) => `[${n}]`).join(' e ')} com ${c.haveNamedBasePower} de poder base`);
          break;
        }
        out.push(`você tiver ${c.haveNamed!.map((n) => `[${n}]`).join(' e ')}`);
        break;
      case 'revealedHasChosenCost':
        out.push('a carta revelada tiver o custo escolhido');
        break;
      case 'ownMatchingMax': {
        const t = target({ ...c.ownMatchingMax!.spec, side: 'own', upTo: 2 }, ctx).replace(/^até \d+ dos seus /, '');
        out.push(`você tiver ${c.ownMatchingMax!.count} ou menos ${t}`);
        break;
      }
      case 'anyCharacterMinPower':
        out.push(`houver um Personagem com ${c.anyCharacterMinPower} de poder ou mais`);
        break;
      case 'not': {
        const inner = c.not!;
        const mm = inner.opponentMatching ?? inner.ownMatching;
        // "If your opponent has 2 or less Characters" vira not(3 ou mais): escreve "2 ou menos".
        if (mm && Object.keys(inner).length === 1 && mm.count > 1) {
          out.push(condition(inner, ctx).replace(`${mm.count} ou mais`, `${mm.count - 1} ou menos`));
          break;
        }
        const text = condition(inner, ctx);
        // A negação vai depois do sujeito: "o oponente não tiver …", "este Personagem não estiver …".
        const m = text.match(/^(você|o oponente|o seu Líder|este (?:Personagem|Líder|Stage|Evento)|esta carta|houver) /i);
        out.push(m ? (m[1] === 'houver' ? `não ${text}` : `${m[1]} não ${text.slice(m[0].length)}`) : `não ${text}`);
        break;
      }
      case 'selfBattledCharacter':
        out.push(`${ctx.self} tiver batalhado com um Personagem do oponente neste turno`);
        break;
      case 'maxActiveDon':
        out.push(`você tiver ${c.maxActiveDon} ou menos DON!! ativos`);
        break;
      case 'faceUpLifeMin':
        out.push('você tiver uma carta de Vida virada para cima');
        break;
      case 'leaderMonocolor':
        out.push('o seu Líder for de uma só cor');
        break;
      case 'leaderActive':
        out.push('o seu Líder estiver ativo');
        break;
      case 'anyCharacterNamed':
        out.push(`houver um Personagem [${c.anyCharacterNamed}]`);
        break;
      case 'onlyTypeIncludes':
        out.push(`você só tiver Personagens com um tipo que inclua "${c.onlyTypeIncludes}"`);
        break;
      case 'onlyCharactersWithoutCounter':
        out.push('você só tiver Personagens sem Counter');
        break;
      case 'allDonRested':
        out.push('todos os seus DON!! estiverem virados');
        break;
      case 'deficit': {
        const d = c.deficit!;
        const what = d.what === 'don' ? 'DON!! no seu campo' : d.what === 'hand' ? 'cartas na sua mão' : 'Personagens';
        out.push(`você tiver pelo menos ${d.n} ${what} a menos que o oponente`);
        break;
      }
      case 'trashHasNames':
        out.push(`você tiver ${c.trashHasNames!.map((n) => `[${n}]`).join(' e ')} no descarte`);
        break;
      case 'anyCharacterMinBasePower':
        out.push(`houver um Personagem com ${c.anyCharacterMinBasePower} de poder base ou mais`);
        break;
      case 'opponentCharacterKOThisTurn':
        out.push('um Personagem do oponente tiver sido nocauteado neste turno');
        break;
      case 'distinctTyped':
        out.push(`você tiver ${c.distinctTyped!.count} Personagens do tipo {${c.distinctTyped!.type}} com nomes diferentes`);
        break;
      case 'haveNamedBasePower':
      case 'haveCharacterOnly':
        break;
      case 'chosenCostEqualsDon':
        out.push('o custo do Personagem escolhido for igual ao número de DON!! anexados a ele');
        break;
      case 'attackerCharacter':
        if (!c.attackerAttribute) out.push('quem ataca for um Personagem');
        break;
      case 'attackerAttribute':
        out.push(`o Personagem atacante tiver o atributo ${c.attackerAttribute}`);
        break;
      case 'handTrashedThisTurn':
        out.push('uma carta da sua mão tiver sido descartada por um efeito neste turno');
        break;
      case 'opponentRestedCardsMin':
        out.push(`o oponente tiver ${c.opponentRestedCardsMin} ou mais cartas viradas`);
        break;
      case 'ownRestedCardsMin':
        out.push(`você tiver ${c.ownRestedCardsMin} ou mais cartas viradas`);
        break;
      case 'leaderNames':
        out.push(`o seu Líder for ${c.leaderNames!.map((n) => `[${n}]`).join(' ou ')}`);
        break;
      case 'selfActive':
        out.push(`${ctx.self} estiver ativo`);
        break;
      case 'leaderColor':
        out.push(`as cores do seu Líder incluírem ${COLOR_M[c.leaderColor!]?.[0] ?? c.leaderColor}`);
        break;
      case 'leaderMaxPower':
        out.push(`o seu Líder tiver ${c.leaderMaxPower} ou menos de poder`);
        break;
      case 'leaderMinPower':
        out.push(`o seu Líder tiver ${c.leaderMinPower} ou mais de poder`);
        break;
      case 'opponentLeaderMinPower':
        out.push(`o Líder do oponente tiver ${c.opponentLeaderMinPower} ou mais de poder`);
        break;
      case 'totalLifeMin':
        out.push(`você e o oponente tiverem, juntos, ${c.totalLifeMin} ou mais cartas de Vida`);
        break;
      case 'opponentMaxDonOnField':
        out.push(`o oponente tiver ${c.opponentMaxDonOnField} ou menos DON!! no campo`);
        break;
      case 'leaderNameIncludes':
        out.push(`o nome do seu Líder incluir "${c.leaderNameIncludes}"`);
        break;
      case 'fewerCharacters':
        out.push('você tiver menos Personagens que o oponente');
        break;
      case 'anyCharactersWithCost':
        out.push(`houver ${c.anyCharactersWithCost!.count} ou mais Personagens com custo ${c.anyCharactersWithCost!.cost} ou mais`);
        break;
      case 'minRestedDon':
        out.push(`você tiver ${c.minRestedDon} ou mais DON!! virados`);
        break;
      case 'ownMatching':
      case 'opponentMatching': {
        const mm = (key === 'ownMatching' ? c.ownMatching : c.opponentMatching)!;
        const who = key === 'ownMatching' ? 'você tiver' : 'o oponente tiver';
        if (mm.count === 1) {
          const one = target({ ...mm.spec, side: 'own', upTo: 1 }, ctx)
            .replace(/^até 1 dos seus Personagens/, 'um Personagem')
            .replace(/^até 1 dos seus Líderes ou Personagens/, 'um Líder ou Personagem')
            .replace(/^até 1 carta sua/, 'uma carta')
            .replace(/^até 1 /, 'um ');
          out.push(`${who} ${one}`);
        } else {
          const t = target({ ...mm.spec, side: 'own', upTo: mm.count }, ctx).replace(/^até \d+ dos seus /, '').replace(/^até \d+ /, '');
          out.push(`${who} ${mm.count} ou mais ${t}`);
        }
        break;
      }
      case 'charactersWithCost':
        out.push(`você tiver ${c.charactersWithCost!.count} ou mais Personagens com custo ${c.charactersWithCost!.cost} ou mais`);
        break;
      case 'attackingLeader':
        out.push('o alvo for o Líder do oponente');
        break;
      case 'lifeHandMax':
        out.push(`você tiver ${c.lifeHandMax} ou menos cartas somando Vida e mão`);
        break;
      case 'minTurn':
        out.push('for o seu segundo turno ou depois');
        break;
      case 'opponentLeaderAttribute':
        out.push(`o Líder do oponente tiver o atributo ${c.opponentLeaderAttribute}`);
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
      case 'minTypedCharacters': {
        const mt = c.minTypedCharacters!;
        out.push(`você tiver ${mt.count} ou mais Personagens do tipo ${types(mt.types ?? [mt.type])}`);
        break;
      }
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
      return e.min && e.min > 1
        ? `${e.min} ou mais DON!! do seu campo voltarem ao seu deck de DON!!`
        : `um DON!! do seu campo voltar ao seu deck de DON!!${e.byYourEffect ? ' por um efeito seu' : ''}`;
    case 'donGiven':
      return 'este Líder ou 1 dos seus Personagens receber um DON!!';
    case 'damageTaken':
      return 'você receber dano';
    case 'restedByEffect':
      return 'um Personagem for virado por um efeito seu';
    case 'lifeZero':
      return 'o número das suas cartas de Vida chegar a 0';
    case 'lifeRemoved':
      return e.whose === 'any'
        ? 'uma carta for removida das suas cartas de Vida ou das do oponente'
        : e.whose === 'own'
          ? 'uma carta for removida das suas cartas de Vida'
          : 'uma carta for removida das cartas de Vida do oponente';
    case 'handTrashedByEffect':
      return e.sourceType ? `uma carta for descartada da sua mão pelo efeito de uma carta sua do tipo {${e.sourceType}}` : 'uma carta for descartada da sua mão por um efeito';
    case 'anyOf':
      return e.events.map((x) => event(x, ctx)).join(' ou ');
    case 'characterPlayed': {
      const what = e.filter ? filter(e.filter, 1, false).replace(/^1 /, 'um ') : 'um Personagem';
      if (e.from === 'trash') return `${what} for jogado do seu descarte`;
      if (e.byEffect) return e.who === 'self' ? `você jogar ${what} usando o efeito de um Personagem` : `o oponente jogar ${what} usando o efeito de um Personagem`;
      const hand = e.fromHand ? (e.who === 'self' ? ' da sua mão' : ' da mão dele') : '';
      return e.who === 'self' ? `você jogar ${what}${hand}` : `o oponente jogar ${what}${hand}`;
    }
    case 'characterRemoved': {
      const who =
        e.whose === 'any'
          ? 'um Personagem'
          : e.whose === 'opponent'
            ? 'um Personagem do oponente'
            : e.filter
              ? `um Personagem seu ${filter(e.filter, 1, false).replace(/^1 Personagem ?/, '')}`.trim()
              : 'um Personagem seu';
      const by = e.by === 'self' ? 'por um efeito seu' : e.by === 'opponent' ? 'por um efeito do oponente' : 'por um efeito';
      return `${who} for removido do campo ${by}${e.orKO ? ' ou for nocauteado' : ''}`;
    }
    case 'characterKO':
      if (e.filter) return `um Personagem seu ${filter(e.filter, 1, false).replace(/^1 Personagem ?/, '')} for nocauteado`.replace(/  +/g, ' ');
      return e.whose === 'any' ? 'um Personagem for nocauteado' : e.whose === 'own' ? 'um Personagem seu for nocauteado' : 'um Personagem do oponente for nocauteado';
    case 'eventActivated':
      return e.who === 'self' ? 'você ativar um Evento' : 'o oponente ativar um Evento';
    case 'blockerActivated':
      return e.who === 'self' ? 'você ativar um [Blocker]' : 'o oponente ativar um [Blocker]';
    case 'selfRested':
      return `${ctx.self} for virado${e.byCharacter ? ' pelo efeito de um Personagem do oponente' : e.byOpponent ? ' por um efeito do oponente' : ''}`;
    case 'attackDamage':
      return `o ataque de ${ctx.self} causar dano à Vida do oponente`;
    case 'battleKO':
      return `${ctx.self} batalhar e nocautear um Personagem do oponente`;
    case 'triggerActivated':
      return e.who === 'opponent' ? 'o oponente ativar um [Trigger]' : 'um [Trigger] for ativado';
    case 'drawByEffect':
      return 'você comprar uma carta fora da sua Fase de Compra';
    case 'damageDealt':
      return 'você causar dano à Vida do oponente';
    case 'leaderBattle':
      // Sem filtro é o próprio Líder ("When this Leader attacks or is attacked", OP03-001).
      if (!e.filter) return 'este Líder atacar ou for atacado';
      return `o seu Líder ${filter(e.filter, 1, false).replace(/^1 carta ?/, '')} atacar ou for atacado`.replace(/  +/g, ' ');
    case 'lifeToHand':
      return 'uma carta da sua Vida for para a sua mão';
    case 'returnedToHand':
      return 'um Personagem do oponente voltar à mão do dono por um efeito seu';
  }
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

function cost(c: AbilityCost, ctx: Ctx, verbal = false): string {
  const symbols: string[] = [];
  const parts: string[] = [];
  if (c.donMinusActive) {
    // "return 2 of your active DON!! cards to your DON!! deck": sem símbolo DON!! −X no texto oficial.
    if (c.restDon) (verbal ? parts : symbols).push(verbal ? `virar ${c.restDon} dos seus DON!!` : (CIRCLED[c.restDon - 1] ?? `(${c.restDon})`));
    parts.push(`devolver ${c.donMinus} dos seus DON!! ativos ao seu deck de DON!!`);
  } else if (verbal) {
    // No meio de uma frase ("você pode … em vez disso") os símbolos viram verbos.
    if (c.restDon) parts.push(`virar ${c.restDon} dos seus DON!!`);
    if (c.donMinus) parts.push(`devolver ${c.donMinus}${c.donMinusOpen ? ' ou mais' : ''} DON!! do seu campo ao seu deck de DON!!`);
  } else {
    if (c.restDon) symbols.push(CIRCLED[c.restDon - 1] ?? `(${c.restDon})`);
    if (c.donMinus) symbols.push(`DON!! −${c.donMinus}${c.donMinusOpen ? ' ou mais' : ''}`);
  }
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
  if (c.koSelf) parts.push(`nocautear ${ctx.self}`);
  if (c.leaderPowerMinus) parts.push(`dar −${c.leaderPowerMinus} de poder ao seu Líder${c.leaderPowerMinusActive ? ' ativo' : ''} durante este turno`);
  if (c.giveDon) parts.push(`dar ${c.giveDon.count} DON!! ativo a ${target(c.giveDon.spec, ctx)}`);
  if (c.returnGivenDon) parts.push(`devolver ${c.returnGivenDon} DON!! anexados às suas cartas para a área de custo, virados`);
  if (c.victimPowerMinus) parts.push(`dar −${c.victimPowerMinus} de poder a esse Personagem durante este turno`);
  if (c.ownToLife) parts.push(`colocar ${target({ ...c.ownToLife.spec, upTo: c.ownToLife.count }, ctx).replace(/^até /, '')} no topo da sua Vida, com a face para cima`);
  if (c.either) {
    parts.push(
      c.either
        .map((x) => (x.restDon && Object.keys(x).length === 1 ? `virar ${x.restDon} DON!!` : cost(x, ctx).replace(/^Você pode /, '').replace(/:$/, '')))
        .join(' ou '),
    );
  }
  if (c.ownToBottom) parts.push(`colocar ${target({ ...c.ownToBottom.spec, upTo: c.ownToBottom.count }, ctx).replace(/^até /, '')} no fundo do deck do dono`);
  if (c.selfToBottom) parts.push(`colocar ${ctx.self} no fundo do deck do dono`);
  if (c.trashSelf) parts.push(`descartar ${ctx.self}${c.selfMinCost !== undefined ? ` (com custo ${c.selfMinCost} ou mais)` : ''}`);
  if (c.restOpponentChars) parts.push(`virar ${c.restOpponentChars} ${plural(c.restOpponentChars, 'Personagem', 'Personagens')} do oponente`);
  if (c.selfPowerMinus) parts.push(`dar −${c.selfPowerMinus} de poder a ${ctx.self} durante este turno`);
  if (c.trashToDeck) parts.push(`devolver ${cards(c.trashToDeck)} do seu descarte ao deck e embaralhá-lo`);
  if (c.playFromHand) parts.push(`jogar ${filter(c.playFromHand, 1, false)} da sua mão`);
  if (c.giveOppDon) parts.push(`dar ${c.giveOppDon} DON!! ${plural(c.giveOppDon, 'virado', 'virados')} do oponente a 1 Personagem dele`);
  if (c.handToTop) parts.push(`colocar ${cards(c.handToTop)} da sua mão no topo do deck`);
  if (c.victimToLife) parts.push('colocar essa carta no topo da sua Vida, com a face para baixo');
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
      if (s.per) {
        const per = target({ ...s.per, all: false, upTo: 1 }, ctx).replace(/^até 1 /, '');
        return `Para cada ${per} no seu campo, dê ${s.amount < 0 ? '−' : '+'}${Math.abs(s.amount)} de poder a ${target(s.target, ctx)} ${dur(s.duration)}.`;
      }
      if (s.amount < 0) return `Dê −${-s.amount} de poder a ${target(s.target, ctx)} ${dur(s.duration)}.`;
      return `${cap(target(s.target, ctx))} recebe +${s.amount} de poder ${dur(s.duration)}.`;
    case 'cost':
      // "Set the cost of … to 0": o leitor representa como −99.
      if (s.amount <= -99) return `O custo de ${target(s.target, ctx)} passa a ser 0 ${dur(s.duration)}.`;
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
        : typeof s.target === 'object' && (s.target.all || s.target.upTo > 1)
          ? `Dê ${qty(s.count)} DON!! ${plural(s.count, 'virado', 'virados')} a cada um ${target(s.target, ctx).replace(/^todos os /, 'dos ').replace(/^até /, 'de até ')}.`
          : `Dê ${qty(s.count)} DON!! ${plural(s.count, 'virado', 'virados')} ${a(target(s.target, ctx))}.`;
    case 'draw':
      return s.upTo ? `Compre até ${cards(s.count)}.` : `Compre ${cards(s.count)}.`;
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
      if (s.count >= 99) return 'Deixe todos os seus DON!! ativos.';
      return `Deixe ${qty(s.count)} dos seus DON!! ${plural(s.count, 'ativo', 'ativos')}.`;
    case 'search': {
      const verb = s.play ? 'jogue' : 'revele';
      const tail = s.play ? '' : s.toLife ? ` e coloque-a no topo da sua Vida${s.lifeFaceDown ? '' : ', com a face para cima'}` : ' e adicione à sua mão';
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
      return `Jogue ${filter(s.filter, s.upTo)} ${from}${s.notColorOfLast ? ' de uma cor diferente da do Personagem devolvido' : ''}${s.rested ? ', virado' : ''}.`;
    }
    case 'shuffleDeck':
      return 'Embaralhe o seu deck.';
    case 'arrangeTop':
      return s.topOnly
        ? `Olhe as ${s.look} cartas do topo do seu deck e devolva-as ao topo do deck, em qualquer ordem.`
        : `Olhe as ${s.look} cartas do topo do seu deck e devolva-as ao topo ou ao fundo do deck, em qualquer ordem.`;
    case 'trashLife':
      return `Descarte ${qty(s.count)} ${plural(s.count, 'carta', 'cartas')} do topo da Vida ${s.side === 'own' ? 'sua' : 'do oponente'}.`;
    case 'gainKeyword':
      return `${cap(target(s.target, ctx))} ganha ${KW[s.keyword]} ${dur(s.duration)}.`;
    case 'cannotBeKO': {
      const many = typeof s.target === 'object' && s.target.all;
      return `${cap(target(s.target, ctx))} ${many ? 'não podem ser nocauteados' : 'não pode ser nocauteado'}${s.inBattle ? ' em batalha' : s.byEffect === 'opponent' ? ' por efeitos do oponente' : s.byEffect ? ' por efeitos' : ''} ${dur(s.duration)}.`;
    }
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
      return `Coloque ${s.filter ? filter(s.filter, s.upTo) : `${qty(s.upTo)} ${plural(s.upTo, 'carta', 'cartas')}`} ${s.trashOnly ? 'do seu descarte' : `da sua mão${s.fromTrash ? ' ou do seu descarte' : ''}`} no ${s.choose ? 'topo ou no fundo' : 'topo'} da sua Vida${s.faceUp ? ', com a face para cima' : ''}.`;
    case 'fieldToLife':
      return `Coloque ${target(s.target, ctx)} no ${s.choose ? 'topo ou no fundo' : 'topo'} da Vida do dono${s.faceUp ? ', com a face para cima' : ''}.`;
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
    case 'koSelf':
      return `Nocauteie ${ctx.self}.`;
    case 'moveGivenDon':
      return `Passe até ${s.count} DON!! já anexados às suas cartas para ${target(s.target, ctx)}.`;
    case 'handPlayOrLife':
      return `Escolha até ${filter(s.filter, 1, false)} ${s.from === 'trash' ? 'do seu descarte' : 'da sua mão'} e jogue-a ou coloque-a no topo da sua Vida, com a face para cima.`;
    case 'negateOnPlay':
      return `Os efeitos [Ao Jogar] ${s.who === 'opponent' ? 'do oponente' : 'seus'} ficam anulados ${dur(s.duration)}.`;
    case 'cannotAttackCharacters':
      return `${cap(ctx.self)} não pode atacar Personagens do oponente com custo base ${s.maxBaseCost} ou menos ${dur(s.duration)}.`;
    case 'drawEventCount':
      return s.returned ? 'Compre tantas cartas quanto as devolvidas ao deck.' : 'Compre tantas cartas quanto as descartadas.';
    case 'restDonForPower':
      return `Você pode virar quantos DON!! quiser. Para cada DON!! virado assim, ${target(s.target, ctx)} recebe +${s.power} de poder durante esta batalha.`;
    case 'payEither':
      return '';
    case 'swapBasePower':
      if (s.withLeader) return `Escolha 1 Personagem e troque o poder base dele com o do seu Líder ${dur(s.duration)}.`;
      return `Escolha 2 ${target({ ...s.spec, upTo: 2 }, ctx).replace(/^até 2 /, '')} e troque o poder base deles ${dur(s.duration)}.`;
    case 'trashFaceUpLife':
      return 'Descarte todas as suas cartas de Vida viradas para cima.';
    case 'lifeToTrash':
      return `Descarte ${cards(s.count)} do ${s.choose ? 'topo ou do fundo' : 'topo'} da sua Vida.`;
    case 'revealedToTopOrBottom':
      return 'Coloque a carta revelada no topo ou no fundo do seu deck.';
    case 'lifeOneToDeckTop':
      return 'Olhe todas as suas cartas de Vida; coloque 1 no topo do seu deck e devolva o resto à Vida na ordem que quiser.';
    case 'cannotBlock':
      return `${cap(target(s.target, ctx))} não pode ativar [Blocker] ${dur(s.duration)}.`;
    case 'returnGivenDon':
      return `Devolva ${s.count} DON!! anexados às suas cartas para a área de custo, virados.`;
    case 'lastToDeckTop':
      return 'Coloque a carta revelada no topo do seu deck.';
    case 'opponentTrashToBottom':
      return s.chooser === 'self'
        ? `Coloque até ${cards(s.count)} do descarte do oponente no fundo do deck dele.`
        : `O oponente coloca ${cards(s.count)} do descarte dele no fundo do deck dele, na ordem que quiser.`;
    case 'arrangeLife':
      return `Olhe todas as cartas de Vida ${s.whose === 'own' ? 'suas' : 'do oponente'} e devolva-as na ordem que quiser.`;
    case 'restDonOrCharacter':
      if (s.skipRefresh) return 'Até 1 carta virada do oponente (DON!! incluídos) não fica ativa na próxima Fase de Renovação do oponente.';
      // "Rest up to 1 of your opponent's cards": qualquer carta, DON!! incluídos.
      if (s.spec.kinds.length === 3) return 'Vire até 1 carta do oponente (DON!! incluídos).';
      return `Vire até 1 DON!! do oponente ou ${target({ ...s.spec, side: 'opponent', upTo: 1 }, ctx)}.`;
    case 'chooseCost':
      return 'Escolha um custo.';
    case 'revealOpponentTop':
      return 'Revele a carta do topo do deck do oponente.';
    case 'giveActiveDon':
      return `Dê ${qty(s.count)} DON!! ${plural(s.count, 'ativo', 'ativos')} a ${target(s.target, ctx)}.`;
    case 'ownToBottom':
      return `Coloque ${target({ ...s.spec, upTo: s.count }, ctx).replace(/^até /, '')} no fundo do deck do dono.`;
    case 'negate':
      return `Anule o efeito de ${target(s.target, ctx)} ${dur(s.duration)}.`;
    case 'restrict': {
      const opp = Boolean(s.opponent);
      const own = opp ? 'dele' : 'seus';
      const txt: Record<string, string> = {
        noPlayCharacters: s.minCost !== undefined ? `jogar Personagens com custo base ${s.minCost} ou mais` : 'jogar Personagens',
        noPlayFromHand: `jogar cartas da ${opp ? 'mão dele' : 'sua mão'}`,
        noLifeToHand: `colocar cartas de Vida na mão com os ${opp ? 'próprios efeitos dele' : `${own} próprios efeitos`}`,
        noAttackLeader: opp ? 'atacar o seu Líder' : 'atacar um Líder',
        noDrawByEffect: `comprar cartas com os ${opp ? 'próprios efeitos dele' : `${own} próprios efeitos`}`,
        noSetDonActiveByCharacter: 'deixar DON!! ativos com efeitos de Personagens',
        noBlocker: 'ativar [Blocker]',
      };
      const when = s.duration === 'nextOpponentTurn' ? dur('nextOpponentTurn') : 'neste turno';
      return `${opp ? 'O seu oponente' : 'Você'} não pode ${txt[s.kind]} ${when}.`;
    }
    case 'nextPlayDiscount':
      return `Na próxima vez que você jogar ${filter(s.filter, 1, false).replace(/^1 (?=carta)/, 'uma ').replace(/^1 /, 'um ')} da sua mão neste turno, o custo será reduzido em ${s.amount}.`;
    case 'basePower':
      return s.copy
        ? `O poder base ${de(target(s.target, ctx))} passa a ser igual ao poder ${s.copy === 'chosen' ? 'da carta escolhida' : s.copy === 'attacker' ? 'do Líder ou Personagem atacante do oponente' : 'do Líder do oponente'} ${dur(s.duration)}.`
        : `O poder base ${de(target(s.target, ctx))} passa a ser ${s.amount} ${dur(s.duration)}.`;
    case 'setPowerZero':
      return `Deixe o poder ${de(target(s.target, ctx))} em 0 ${dur(s.duration)}.`;
    case 'revealLifeTop':
      return 'Revele a carta do topo da sua Vida.';
    case 'activateEventFromHand':
      return `Ative até 1 ${filter(s.filter, 1, false).replace(/^1 /, '')} da sua mão.`;
    case 'trashAnyForPower': {
      const what = s.categories
        ? s.categories.map((k) => ({ event: 'Eventos', stage: 'Palcos', character: 'Personagens' })[k]).join(' ou ')
        : filter(s.filter ?? {}, 2, false).replace(/^2 /, '');
      const who = !s.target || s.target === 'self' ? cap(ctx.self) : cap(target(s.target, ctx));
      const during = s.duration === 'battle' ? 'esta batalha' : 'este turno';
      return `Você pode descartar quantos ${what} quiser da sua mão. ${who} recebe +${s.power} de poder durante ${during} para cada carta descartada.`;
    }
    case 'redirectAttack':
      if (s.toChosen) return 'Mude o alvo do ataque para o Personagem escolhido.';
      return s.noLeader
        ? `Mude o alvo do ataque para ${target({ ...s.spec, upTo: 1 }, ctx)}.`
        : `Mude o alvo do ataque para o seu Líder ou para ${target({ ...s.spec, upTo: 1 }, ctx)}.`;
    case 'handToDeck':
      return `Coloque ${cards(s.count)} da sua mão no ${s.where === 'top' ? 'topo' : s.where === 'bottom' ? 'fundo' : 'topo ou no fundo'} do seu deck.`;
    case 'lookOpponentTop':
      return 'Olhe a carta do topo do deck do oponente.';
    case 'revealedToBottom':
      return 'Coloque a carta revelada no fundo do seu deck.';
    case 'skipRefresh':
      return s.target === 'self'
        ? `${cap(ctx.self)} não fica ativo na sua próxima Fase de Renovação.`
        : s.target === 'chosen'
          ? 'Essa carta não fica ativa na sua próxima Fase de Renovação.'
          : `${cap(target(s.target, ctx))} não fica ativo na próxima Fase de Renovação do oponente.`;
    case 'handToDeckBottom':
      return `Coloque ${cards(s.count)} da sua mão no fundo do seu deck, na ordem que quiser.`;
    case 'opponentChoosesOwn':
      return `O oponente escolhe ${target({ ...s.spec, side: 'own', upTo: s.count }, ctx).replace(/^até /, '').replace(/ dos seus /, ' dos próprios ')} e ${s.action === 'hand' ? 'devolve à mão do dono' : 'coloca no fundo do deck do dono'}.`;
    case 'trashSelf':
      return `Descarte ${ctx.self}.`;
    case 'lifeFace':
      return s.count >= 99
        ? `Vire todas as suas cartas de Vida com a face para ${s.up ? 'cima' : 'baixo'}.`
        : `Vire ${cards(s.count)} do topo da sua Vida com a face para ${s.up ? 'cima' : 'baixo'}.`;
    case 'takeDamage':
      return s.opponent ? `Cause ${s.count} de dano ao oponente.` : `Você recebe ${s.count} de dano.`;
    case 'handAllToDeck':
      if (s.bottom) return 'Coloque todas as cartas da sua mão no fundo do seu deck, na ordem que quiser.';
      return s.who === 'self'
        ? 'Devolva todas as cartas da sua mão ao deck e embaralhe o seu deck.'
        : 'O oponente devolve todas as cartas da mão ao deck e embaralha o deck.';
    case 'opponentDraws':
      return `O oponente compra ${cards(s.count)}.`;
    case 'trashHand':
      return 'Descarte todas as cartas da sua mão.';
    case 'trashHandUntil':
      return s.both
        ? `Você e o oponente descartam cartas da mão até cada um ficar com ${cards(s.count)}.`
        : `Descarte cartas da sua mão até ficar com ${cards(s.count)} na mão.`;
    case 'lifeTrashUntil':
      return `Descarte cartas do topo da sua Vida até ficar com ${cards(s.count)} de Vida.`;
    case 'trashOwn':
      return `Descarte ${target({ ...s.spec, upTo: s.count }, ctx).replace(/^até /, '')}.`;
    case 'delayed':
      return `${s.when === 'battle' ? 'No fim desta batalha' : 'No fim deste turno'}: ${steps(s.steps, ctx)}`;
    case 'drawPerMatching':
      return `Compre 1 carta para cada ${target({ ...s.spec, all: false, upTo: 1 }, ctx).replace(/^até 1 dos seus /, 'um dos seus ').replace(/^até 1 /, '')}.`;
    case 'trashEventCount':
      return s.from === 'hand' ? 'Descarte o mesmo número de cartas da sua mão.' : 'Descarte do topo do seu deck o mesmo número de cartas que descartou da mão.';
    case 'opponentPicksFromHand':
      return `O oponente escolhe ${cards(s.count)} da sua mão; descarte ${plural(s.count, 'essa carta', 'essas cartas')}.`;
    case 'revealOpponentHand':
      return `Escolha ${cards(s.count)} da mão do oponente; o oponente ${plural(s.count, 'revela essa carta', 'revela essas cartas')}.`;
    case 'opponentLifeToBottom':
      return `Coloque até ${cards(s.count)} da Vida do oponente no fundo do deck do dono.`;
    case 'anyNumberForPower': {
      const who = cap(target(s.target, ctx));
      if (s.source === 'trash') {
        return `Coloque qualquer número de ${filter(s.filter ?? {}, 2, false).replace(/^2 /, '')} do seu descarte no fundo do deck, em qualquer ordem. ${who} recebe +${s.power} de poder ${dur(s.duration)} para cada ${s.every} cartas colocadas.`;
      }
      const what = target({ ...s.spec!, upTo: 2 }, ctx).replace(/^até 2 /, '');
      return s.action === 'ko'
        ? `Você pode nocautear qualquer número ${what.startsWith('dos ') ? what : `de ${what}`}. ${who} recebe +${s.power} de poder ${dur(s.duration)} para cada Personagem nocauteado.`
        : `Você pode devolver à mão qualquer número ${what.startsWith('dos ') ? what : `de ${what}`}. ${who} recebe +${s.power} de poder ${dur(s.duration)} para cada Personagem devolvido.`;
    }
    case 'skipRefreshDon':
      if (s.atMainPhase) return `O oponente vira ${s.count} dos DON!! ativos dele no início da próxima Fase Principal dele.`;
      return `Até ${s.count} DON!! ${plural(s.count, 'virado', 'virados')} do oponente não ${plural(s.count, 'fica ativo', 'ficam ativos')} na próxima Fase de Renovação dele.`;
    case 'winGame':
      return 'Você vence a partida.';
    case 'extraTurn':
      return 'Jogue um turno extra depois deste.';
    case 'opponentMay': {
      const what =
        s.pay === 'lifeTrash' ? `descartar ${cards(s.count)} do topo da Vida dele` : s.pay === 'discard' ? `descartar ${cards(s.count)} da mão` : `devolver ${s.count} DON!! ativo(s) ao deck de DON!!`;
      return `O oponente pode ${what}. Se não fizer isso, ${steps(s.otherwise, ctx).replace(/^./, (c) => c.toLowerCase())}`;
    }
    case 'opponentPlays':
      return `O oponente joga ${filter(s.filter, s.upTo)} da mão dele.`;
    case 'opponentAddDon':
      return `O oponente pode adicionar ${s.count} DON!! do deck de DON!! dele, ${plural(s.count, 'ativo', 'ativos')}.`;
    case 'donMatchOpponent':
      return 'Devolva DON!! do seu campo ao deck de DON!! até ficar com o mesmo número de DON!! no campo que o oponente.';
    case 'powerPerDon':
      return `Dê −${-s.amount} de poder ${dur(s.duration)} a ${target(s.target, ctx)} para cada DON!! anexado a esse Personagem.`;
    case 'powerPerMatching':
      return `${cap(target(s.target, ctx))} recebe +${s.amount} de poder ${dur(s.duration)} para cada ${target({ ...s.spec, all: false, upTo: 1 }, ctx).replace(/^até 1 dos seus /, 'um dos seus ').replace(/^até 1 /, '')}.`;
    case 'powerPerRevealedCost':
      return `${cap(target(s.target, ctx))} recebe +${s.amount} de poder ${dur(s.duration)} para cada 1 de custo da carta revelada.`;
    case 'gainAttribute':
      return `${cap(target(s.target, ctx))} ganha o atributo ${s.attribute} ${dur(s.duration)}.`;
    case 'activateEventFromTrash':
      return `Ative o efeito [Principal] de até 1 ${filter(s.filter, 1, false).replace(/^1 /, '')} do seu descarte.`;
    case 'attackTax':
      if (s.target === 'chosen') return `Os Personagens escolhidos não podem atacar ${dur(s.duration)}, a menos que o oponente descarte ${cards(s.count)} da mão a cada ataque.`;
      return `${cap(target(s.target, ctx))} não pode atacar ${dur(s.duration)}, a menos que o oponente descarte ${cards(s.count)} da mão a cada ataque.`;
    case 'tempReplace':
      return `Se algum Personagem seu for nocauteado${s.by === 'battle' ? ' em batalha' : ''} durante este turno, você pode ${cost(s.cost, ctx).replace(/^Você pode /, '')} em vez disso.`;
    case 'replaceRest':
      return '';
    default:
      return unknown(`passo ${s.do}`);
  }
}

/** Passos em sequência; condições ("if") viram "Se …,"; "you may" vira "Você pode …". */
function steps(list: EffectStep[], ctx: Ctx): string {
  const out: string[] = [];
  const lower = lowerFirst;
  const noDot = (t: string) => t.replace(/\.$/, '');
  let sentences = 0; // frases de efeito já escritas (para o "Depois,")
  let ifDone = 0; // passos cobertos por um custo opcional no meio do efeito ("Se fizer isso, …")
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.do === 'payCost') {
      const scope = s.scope;
      const c = cost(s.cost, ctx);
      if (scope !== undefined && !c) {
        // "you may X": "Você pode X." (verbo no infinitivo)
        const inner = list.slice(i + 1, i + 1 + scope).map((x) => noDot(step(x, ctx)));
        const may = `você pode ${inner.map(toInfinitive).join(' e ')}.`;
        const text = s.if && Object.keys(s.if).length ? `se ${condition(s.if, ctx)}, ${may}` : may;
        out.push(sentences++ ? `Depois, ${text}` : cap(text));
        i += scope;
        continue;
      }
      if (scope !== undefined && c && i > 0) {
        // "Then, you may rest 1 of your DON!! cards. If you do, …" no meio do efeito.
        const only = Object.keys(s.cost);
        const what = only.length === 1 && s.cost.restDon ? `você pode virar ${s.cost.restDon} dos seus DON!!` : lower(c);
        out.push(sentences++ ? `Depois, ${what}.` : `${cap(what)}.`);
        ifDone = scope;
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
    let body: string;
    // "Rest up to a total of 2 of your opponent's Characters or DON!! cards": o leitor repete o passo.
    let run = 1;
    while (s.do === 'restDonOrCharacter' && group.length === 1 && i + run < list.length && JSON.stringify(list[i + run]) === JSON.stringify(s)) run++;
    if (run > 1) {
      i += run - 1;
      const { spec, skipRefresh } = s as Extract<EffectStep, { do: 'restDonOrCharacter' }>;
      body = skipRefresh
        ? `Até ${run} cartas viradas do oponente (DON!! incluídos) não ficam ativas na próxima Fase de Renovação do oponente`
        : spec.kinds.length === 3
          ? `Vire até ${run} cartas do oponente (DON!! incluídos)`
          : `Vire até ${run} ${target({ ...spec, side: 'opponent', upTo: run }, ctx).replace(/^até \d+ /, '').replace(/ do oponente$/, '')} ou DON!! do oponente, no total`;
    } else body = group.map((g, k) => (k ? lower(noDot(step(g, ctx))) : noDot(step(g, ctx)))).join(' e ');
    let text = key ? `Se ${condition(s.if!, ctx)}, ${lower(body)}.` : `${body}.`;
    if (ifDone > 0) {
      text = `Se fizer isso, ${lower(text)}`;
      sentences++;
    } else if (sentences++ && !/^(Olhe|Revele)/.test(text)) text = `Depois, ${lower(text)}`;
    ifDone = 0;
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
  cause: 'causar',
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

/** Frase estática "simples" (só `parts`): sem aura, regra especial nem texto próprio. */
function isSimpleStatic(a: Ability): boolean {
  return !a.rule && !a.aura && !a.battleVsAttribute && !a.noPlayByEffect && !a.selfHandCounter && !a.handCounter && !a.handCostAura && a.noRefreshMaxCost === undefined;
}

/** Trechos "recebe +N de poder", "ganha [Blocker]" … de uma frase estática simples. */
function staticParts(a: Ability, ctx: Ctx): string[] {
  const parts: string[] = [];
  if (a.staticPower) parts.push(a.staticPower > 0 ? `recebe +${a.staticPower} de poder` : `recebe −${-a.staticPower} de poder`);
  if (a.staticCost) parts.push(`recebe +${a.staticCost} de custo`);
  if (a.powerPer) {
    const what = {
      hand: 'carta na sua mão',
      restedDon: 'DON!! virado seu',
      trash: 'carta no seu descarte',
      trashEvents: 'Evento no seu descarte',
      distinctCharacters: 'Personagem seu com nome diferente',
    }[a.powerPer.what];
    const whatMany = {
      hand: 'cartas na sua mão',
      restedDon: 'DON!! virados seus',
      trash: 'cartas no seu descarte',
      trashEvents: 'Eventos no seu descarte',
      distinctCharacters: 'Personagens seus com nomes diferentes',
    }[a.powerPer.what];
    parts.push(`recebe +${a.powerPer.power} de poder para cada ${a.powerPer.every > 1 ? `${a.powerPer.every} ${whatMany}` : what}`);
  }
  if (a.staticKeyword) parts.push(`ganha ${KW[a.staticKeyword]}`);
  if (a.staticCanAttackActive) parts.push('também pode atacar Personagens ativos do oponente');
  if (a.staticNoRemoval) parts.push('não pode ser removido do campo por efeitos do oponente');
  if (a.handCost) parts.push(`custa ${-a.handCost} a menos na sua mão`);
  if (a.staticNoBattleKO) parts.push('não pode ser nocauteado em batalha');
  if (a.staticNoEffectKO) parts.push(a.staticNoEffectKO === 'opponent' ? 'não pode ser nocauteado por efeitos do oponente' : 'não pode ser nocauteado por efeitos');
  if (a.staticCannotAttack) parts.push('não pode atacar');
  if (a.noBattleKOVsAttribute) parts.push(`não pode ser nocauteado em batalha por ${a.noBattleKOVsAttributeCharacters ? 'Personagens' : 'Líderes ou Personagens'} de atributo ${a.noBattleKOVsAttribute}`);
  if (a.noBattleKOUnlessAttribute) parts.push(`não pode ser nocauteado em batalha por Personagens sem o atributo ${a.noBattleKOUnlessAttribute}`);
  if (a.noBattleKOByLeader) parts.push('não pode ser nocauteado em batalha por Líderes');
  if (a.costPer) parts.push(`recebe ${a.costPer.cost > 0 ? '+' : '−'}${Math.abs(a.costPer.cost)} de custo para cada ${a.costPer.every} cartas no seu descarte`);
  if (a.staticBasePower !== undefined) {
    parts.push(a.staticBasePower === 'leader' ? 'fica com o poder base igual ao poder base do seu Líder' : `fica com poder base ${a.staticBasePower}`);
  }
  if (a.staticTaunt) parts.push('é a única carta que o oponente pode atacar');
  if (a.noLeaderAttackOnPlayTurn) parts.push('não pode atacar um Líder no turno em que é jogado');
  if (a.noEffectKOUnlessAttribute) parts.push(`não pode ser nocauteado por efeitos de Personagens sem o atributo ${a.noEffectKOUnlessAttribute}`);
  if (a.noEffectKOByMaxBasePower !== undefined) {
    parts.push(`não pode ser nocauteado por efeitos de Personagens do oponente com ${a.noEffectKOByMaxBasePower} de poder base ou menos`);
  }
  if (a.staticNoRest) parts.push(`não pode ser virado por efeitos ${a.staticNoRest === 'leaderOrCharacter' ? 'de Líder e de Personagem do oponente' : 'do oponente'}`);
  return parts;
}

/** Várias frases estáticas seguidas com a mesma condição: "Se X, este Personagem ganha [Blocker] e recebe +3000 de poder." */
function staticGroup(group: Ability[], ctx: Ctx): string {
  if (group.length > 1 && group.every((a) => isSimpleStatic(a))) {
    const parts = group.flatMap((a) => staticParts(a, ctx));
    if (parts.length) {
      const text = `${cap(ctx.self)} ${parts.join(' e ')}.`;
      const cond = group[0].condition;
      return cond && Object.keys(cond).length ? `Se ${condition(cond, ctx)}, ${lowerFirst(text)}` : text;
    }
  }
  return group.map((a) => staticText(a, ctx)).join(' ');
}

function staticText(a: Ability, ctx: Ctx): string {
  const parts = staticParts(a, ctx);
  let special: string | null = null;
  if (a.noPlayByEffect) special = 'Esta carta não pode ser jogada da mão por efeitos.';
  if (a.selfHandCounter) special = `Esta carta na sua mão tem Counter +${a.selfHandCounter}.`;
  if (a.handCounter) {
    special = a.handCounter.set && a.handCounter.filter.category === 'stage' && Object.keys(a.handCounter.filter).length === 1
      ? `Todas as Stages na sua mão têm Counter +${a.handCounter.amount}.`
      : a.handCounter.set
      ? `O Counter das suas cartas na mão (${filter(a.handCounter.filter, 2, false).replace(/^2 /, '')}) passa a ser +${a.handCounter.amount}.`
      : `As suas cartas de Personagem na mão sem Counter têm Counter +${a.handCounter.amount}.`;
  }
  if (a.handCostAura) {
    special = `${cap(filter(a.handCostAura.filter, 2, false).replace(/^2 /, ''))} na sua mão custam ${-a.handCostAura.amount} a menos para jogar.`;
  }
  if (a.noRefreshMaxCost !== undefined) {
    special = `Todos os Personagens com custo ${a.noRefreshMaxCost} ou menos não ficam ativos nas Fases de Renovação suas e do oponente.`;
  }
  if (special && !parts.length && !a.aura) {
    return a.condition && Object.keys(a.condition).length ? `Se ${condition(a.condition, ctx)}, ${special.charAt(0).toLowerCase()}${special.slice(1)}` : special;
  }
  let text: string;
  if (a.rule) {
    const r = a.rule;
    switch (r.kind) {
      case 'donDeck':
        return `Pelas regras desta partida, o seu deck de DON!! tem ${r.size} cartas.`;
      case 'deckOutWin':
        return 'Quando o seu deck chegar a 0 cartas, você vence a partida em vez de perder, pelas regras.';
      case 'deckOutEndOfTurn':
        return 'Pelas regras desta partida, você não perde quando o seu deck fica com 0 cartas. Você perde no fim do turno em que o seu deck ficar com 0 cartas.';
      case 'donPhaseToLeader':
        return 'Se você tiver algum DON!! no seu campo, 1 DON!! colocado durante a sua Fase de DON!! é anexado ao seu Líder.';
      case 'playRested':
        return 'Os seus Personagens entram em campo virados.';
      case 'faceUpLifeToDeck':
        return 'As suas cartas de Vida viradas para cima vão para o fundo do deck em vez de irem para a mão, pelas regras.';
      case 'counterBonus':
        return `Os seus Personagens do tipo {${r.type}} sem Counter têm Counter +${r.amount}, pelas regras.`;
      case 'deckMaxCost':
        return `Pelas regras desta partida, você não pode incluir ${r.category === 'event' ? 'Eventos' : 'cartas'} com custo ${r.cost + 1} ou mais no seu deck.`;
      case 'deckOnlyType':
        return `Pelas regras desta partida, você só pode incluir cartas do tipo {${r.type}} no seu deck.`;
      case 'ownOnPlayNegated':
        return 'Os seus efeitos [Ao Jogar] são anulados.';
      case 'startStage':
        return `No início da partida, jogue até 1 Palco do tipo {${r.type}} do seu deck.`;
    }
  }
  if (a.battleVsAttribute) {
    text = `Quando ${ctx.self} batalhar com Personagens de atributo ${a.battleVsAttribute.attribute}, recebe +${a.battleVsAttribute.power} de poder durante este turno.`;
  } else if (a.aura) {
    const au = a.aura;
    const many = au.kinds.length > 1 ? 'Líderes e Personagens' : au.kinds[0] === 'leader' ? 'Líder' : 'Personagens';
    const leaderOnly = au.kinds.length === 1 && au.kinds[0] === 'leader';
    const whose = au.bothSides ? `todos os ${many}` : au.side === 'opponent' ? `todos os ${many} do oponente` : leaderOnly ? 'o seu Líder' : `os seus ${many}`;
    const extra = [
      au.rested === false ? 'ativos' : au.rested ? 'virados' : '',
      au.color ? COLOR_M[au.color][1] : '',
      au.minCost !== undefined && au.minCost === au.maxCost ? `com custo${au.baseCost ? ' base' : ''} ${au.minCost}` : '',
      au.maxCost !== undefined && au.minCost !== au.maxCost ? `com custo${au.baseCost ? ' base' : ''} ${au.maxCost} ou menos` : '',
      au.minPower !== undefined && au.minPower === au.maxPower ? `com ${au.minPower} de poder base` : '',
      au.minPower !== undefined && au.minPower !== au.maxPower ? `com ${au.minPower} de poder base ou mais` : '',
      au.maxPower !== undefined && au.minPower !== au.maxPower ? `com ${au.maxPower} de poder base ou menos` : '',
      au.excludeName ? `exceto [${au.excludeName}]` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const filt = [
      au.names?.length ? `chamados ${au.names.map((n) => `[${n}]`).join(' ou ')}` : '',
      au.hasAnyType?.length ? `do tipo ${types(au.hasAnyType)}` : '',
      au.typeIncludes ? `com um tipo que inclua "${au.typeIncludes}"` : '',
      au.minCost !== undefined && au.minCost !== au.maxCost ? `com custo${au.baseCost ? ' base' : ''} ${au.minCost} ou mais` : '',
      au.exactCosts ? `com custo ${au.exactCosts.join(' ou ')}` : '',
      au.hasTrigger ? 'com [Trigger]' : '',
      au.hasAllTypes?.length ? `com os tipos ${au.hasAllTypes.map((t) => `{${t}}`).join(' e ')}` : '',
      au.notTypeIncludes ? `sem um tipo que inclua "${au.notTypeIncludes}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const effect = au.basePower !== undefined
      ? `ficam com poder base ${au.basePower}`
      : au.negate
        ? 'têm os efeitos anulados'
        : au.cannotAttack
          ? 'não podem atacar'
          : au.noBattleKO
            ? 'não podem ser nocauteados em batalha'
            : au.noEffectKO
      ? `não podem ser nocauteados por efeitos${au.noEffectKO === 'opponent' ? ' do oponente' : ''}`
      : au.noRemoval
      ? `não podem ser removidos do campo por efeitos ${au.side === 'opponent' ? 'seus' : 'do oponente'}`
      : au.keyword === 'rushCharacter'
        ? 'podem atacar Personagens no turno em que forem jogados'
        : au.keyword
          ? `ganham ${KW[au.keyword]}`
          : au.cost !== undefined
            ? `recebem ${au.cost > 0 ? '+' : '−'}${Math.abs(au.cost)} de custo`
            : `recebem ${au.power >= 0 ? '+' : '−'}${Math.abs(au.power)} de poder`;
    const sing = leaderOnly ? effect.replace(/^recebem/, 'recebe').replace(/^ganham/, 'ganha').replace(/^ficam/, 'fica') : effect;
    const except = au.excludeSelf ? `, exceto ${ctx.self},` : '';
    text = `${cap([whose, extra, filt].filter(Boolean).join(' '))}${except} ${sing}.`;
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
  else if (a.timing === 'event') {
    const cond = a.condition && Object.keys(a.condition).length ? `se ${condition(a.condition, ctx)}, ` : '';
    body = `Quando ${event(a.event!, ctx)}, ${cond}${lowerFirst(steps(a.steps, ctx))}`;
  }
  else if (a.timing === 'replace' && a.replace?.event === 'damage') {
    const c = a.cost ? cost(a.cost, ctx, true).replace(/^Você pode /, '') : 'evitar isso';
    body = `Se você fosse sofrer dano, você pode ${c} em vez disso.`;
  } else if (a.timing === 'replace' && a.replace) {
    const r = a.replace;
    const who =
      r.who === 'self'
        ? ctx.self
        : target({ ...r.who, upTo: 1 }, ctx)
            .replace(/^até 1 dos seus Personagens/, 'um Personagem seu')
            .replace(/^até 1 carta sua (\[[^\]]+\])/, 'o seu $1');
    const what =
      r.event === 'ko' ? 'for nocauteado' : r.event === 'removal' ? 'for removido do campo' : r.event === 'rest' ? 'for virado' : 'for nocauteado ou removido do campo';
    const by =
      r.by === 'battle'
        ? ' em batalha'
        : r.by === 'effect'
          ? ' por um efeito'
          : r.by === 'opponentEffect'
            ? ' por um efeito do oponente'
            : r.by === 'opponent'
              ? ' pelo oponente'
              : '';
    const c = a.cost ? cost(a.cost, ctx, true).replace(/^Você pode /, '') : '';
    const extra = a.steps.length ? ` e ${lowerFirst(steps(a.steps, ctx)).replace(/\.$/, '')}` : '';
    const pre = a.condition && Object.keys(a.condition).length ? `${condition(a.condition, ctx)} e ` : '';
    body = `Se ${pre}${who} ${what}${by}, você pode ${c || 'evitar isso'}${extra} em vez disso.`;
  } else if (a.timing === 'startOfTurn') body = `Este efeito pode ser ativado no início do seu turno. ${steps(a.steps, ctx)}`;
  else if (a.timing === 'startOfOpponentTurn') body = `Este efeito pode ser ativado no início do turno do oponente. ${steps(a.steps, ctx)}`;
  else if (a.timing === 'startOfMainPhase') body = `Este efeito pode ser ativado no início da sua Fase Principal. ${steps(a.steps, ctx)}`;
  else if (a.timing === 'battlesCharacter') body = `Se ${ctx.self} batalhar com um Personagem do oponente, ${steps(a.steps, ctx).replace(/^./, (c) => c.toLowerCase())}`;
  else if (a.timing === 'onKO' && a.koBy) {
    body = `Quando ${ctx.self} for nocauteado por ${a.koBy === 'opponentEffect' ? 'um efeito do oponente' : 'um efeito'}, ${steps(a.steps, ctx).replace(/^./, (c) => c.toLowerCase())}`;
    return [...tags.filter((t) => t !== TIMING.onKO), body].join(' ');
  }
  else {
    // Condição de ativação de efeito disparado ("This effect can be activated when …", OP11-043): no
    // texto, o "Se …" do efeito (junto com o "If …" dos passos).
    if (a.condition && Object.keys(a.condition).length && !a.cost && a.timing !== 'activateMain') {
      const cond = a.condition;
      return ability({ ...a, condition: undefined, steps: a.steps.map((st) => ({ ...st, if: { ...cond, ...st.if } })) }, ctx);
    }
    const c = a.cost ? cost(a.cost, ctx) : '';
    const pre = a.condition && Object.keys(a.condition).length ? `Se ${condition(a.condition, ctx)}, ` : '';
    body = pre + (c ? `${pre ? c.charAt(0).toLowerCase() + c.slice(1) : c}: ` : '') + steps(a.steps, ctx);
  }
  return [...tags, body].join(' ');
}

/** Várias habilidades da mesma linha (ex.: "[On Play]/[When Attacking]"): mesmo corpo, marcações juntas. */
function line(abilities: Ability[], ctx: Ctx): string {
  // Várias frases estáticas da mesma linha: as marcações aparecem uma vez só; frases com a
  // mesma condição viram uma só; uma frase com marcação diferente ("and if it is your
  // opponent's turn, …") leva a própria marcação.
  if (abilities.length > 1 && abilities.every((a) => a.timing === 'static')) {
    const groups: Ability[][] = [];
    const keyOf = (a: Ability) => JSON.stringify([header(a), a.condition ?? null]);
    for (const a of abilities) {
      const last = groups[groups.length - 1];
      if (last && keyOf(last[0]) === keyOf(a)) last.push(a);
      else groups.push([a]);
    }
    const first = JSON.stringify(header(abilities[0]));
    if (groups.every((g) => JSON.stringify(header(g[0])) === first)) {
      return [...header(abilities[0]), ...groups.map((g) => staticGroup(g, ctx))].join(' ');
    }
    return groups.map((g) => [...header(g[0]), staticGroup(g, ctx)].join(' ')).join(' ');
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
/**
 * Linha que o leitor não entende inteira: as frases que ele entende são descritas a partir
 * dos passos e o resto (marcações, custo, frases desconhecidas) vai para o tradutor por regras.
 */
function mixedLine(raw: string, ctx: Ctx): { text: string; complete: boolean; parsed: number } {
  const head = raw.match(/^((?:\s*\[[^\]]*\]\s*\/?)*)/)![1];
  let rest = raw.slice(head.length).trim();
  let costPart = '';
  const colon = rest.indexOf(':');
  const firstStop = rest.search(/\.\s/);
  if (colon > 0 && (firstStop < 0 || colon < firstStop)) {
    costPart = rest.slice(0, colon + 1);
    rest = rest.slice(colon + 1).trim();
  }
  const pieces: string[] = [];
  let complete = true;
  let parsed = 0;
  const prefix = `${head}${costPart}`.trim();
  if (prefix) {
    const r = translateToPt(prefix);
    complete &&= r.complete;
    pieces.push(r.text);
  }
  const sentences = rest.split(/(?<=[a-z0-9)\]}'"]\.)\s+(?=[A-Z[])/).filter(Boolean);
  for (const sentence of sentences) {
    const then = /^Then,\s*/i.test(sentence);
    const body = sentence.replace(/^Then,\s*/i, '');
    let text: string | null = null;
    const st = parseBody(cleanEffectText(body.charAt(0).toUpperCase() + body.slice(1)));
    if (st?.length) {
      try {
        text = steps(st, ctx);
        parsed++;
      } catch (e) {
        if (!(e instanceof Unknown)) throw e;
      }
    }
    if (text === null) {
      const r = translateToPt(body);
      complete &&= r.complete;
      text = r.text;
    }
    pieces.push(then ? `Depois, ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
  }
  return { text: pieces.join(' ').replace(/\s+/g, ' ').trim(), complete, parsed };
}

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
    if (!r.complete && !KEYWORD_ONLY.test(l)) {
      const mixed = mixedLine(l, ctx);
      if (mixed.parsed) {
        complete &&= mixed.complete;
        return mixed.text;
      }
    }
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
