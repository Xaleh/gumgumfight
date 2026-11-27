// Batalha (ataque, bloqueio, Counter, comparação de poder) e dano na Vida.

import type { GameState } from '../types';
import type { DamageFrame } from './constants';
import { lg, log } from './messages';
import { isMultiplayer, opponent, opponentsOf } from './table';
import { cardDef, getPower, hasKeyword, leaderRule, locate, ownerOf } from './queries';
import { conditionsMet } from './conditions';
import { blockerOptions, bystanderCounterOptions, counterOptions, restricted } from './options';
import { emit, pushAbilities, queueDelayed } from './triggers';
import { addModifier } from './effects';
import { koCharacter, offerDamageReplacement } from './removal';
import { cannotBeRested, lifeRemoved, lifeToHandCard, removeFrom } from './zones';
import { eliminate } from './defeat';

export function stepBattle(state: GameState) {
  const b = state.battle!;
  const attackerOwner = ownerOf(state, b.attacker);
  const defender = isMultiplayer(state) ? ownerOf(state, b.target) : opponent(attackerOwner);

  if (b.step !== 'end' && (!locate(state, b.attacker) || !locate(state, b.target))) {
    log(state, null, lg('battleEndsCardLeft', 'A batalha termina (uma das cartas saiu do campo).'));
    b.step = 'end';
  }

  switch (b.step) {
    case 'whenAttacking': {
      // Os [When Attacking] já dispararam na declaração do ataque e resolveram antes de chegar aqui.
      b.step = 'block';
      return;
    }

    case 'block': {
      b.step = 'counter';
      const options = blockerOptions(state, defender);
      // Um [Blocker] ativo que ficou de fora por um efeito na própria carta ("cannot be rested",
      // "cannot activate [Blocker]"): o histórico diz o motivo, senão parece que o jogo o ignorou.
      // (Restrições gerais, como "o oponente não pode usar [Blocker]", já têm a própria linha.)
      if (!b.noBlocker && !restricted(state, defender, 'noBlocker')) {
        for (const c of state.players[defender].characters) {
          if (c.rested || c.uid === b.target || options.includes(c.uid) || !hasKeyword(state, c.uid, 'blocker')) continue;
          if (cannotBeRested(state, c.uid)) log(state, defender, lg('cannotBlockCannotRest', `${cardDef(state, c.uid).name} não pode bloquear: não pode ser virada.`, { card: cardDef(state, c.uid).name }), { cards: [c.uid] });
          else if (state.modifiers.some((m) => m.uid === c.uid && m.kind === 'cannotBlock')) log(state, defender, lg('cannotBlock', `${cardDef(state, c.uid).name} não pode ativar [Blocker] agora.`, { card: cardDef(state, c.uid).name }), { cards: [c.uid] });
        }
      }
      if (options.length) state.pending = { kind: 'block', player: defender, options };
      return;
    }

    case 'counter': {
      // Mesa com mais de dois e `bystanderCounter` ligado: antes do defensor, os outros oponentes do
      // atacante podem usar Eventos [Counter] (não o valor de Counter das cartas, nem [Blocker]: isso é só
      // de quem foi atacado). A vez de cada um só abre se ele tem um Evento que pode pagar; o defensor
      // decide por último. Desligado (o padrão), só quem foi atacado usa Counter.
      if (isMultiplayer(state) && state.table?.bystanderCounter) {
        b.bystanders ??= opponentsOf(state, attackerOwner).filter((id) => id !== defender);
        while (b.bystanders.length) {
          const options = bystanderCounterOptions(state, b.bystanders[0]);
          if (options.length) {
            state.pending = { kind: 'counter', player: b.bystanders[0], options, bystander: true };
            return;
          }
          b.bystanders.shift();
        }
      }
      // A etapa abre mesmo sem Counter na mão (e mesmo quando o ataque já falha): se fosse
      // pulada, o atacante saberia que o defensor não tem Counter (ou veria a diferença de tempo).
      state.pending = { kind: 'counter', player: defender, options: counterOptions(state, defender) };
      return;
    }

    case 'damage': {
      b.step = 'end';
      if (locate(state, b.attacker)?.zone === 'character' && locate(state, b.target)?.zone === 'character') {
        b.fought = [b.attacker, b.target];
      }
      if (locate(state, b.target)?.zone === 'character') (state.battledCharacter ??= []).push(b.attacker);
      const ap = getPower(state, b.attacker);
      const tp = getPower(state, b.target);
      const target = locate(state, b.target)!;
      if (ap < tp) {
        log(state, null, lg('attackFails', `O ataque falha (${ap} contra ${tp}).`, { attack: ap, defense: tp }));
        return;
      }
      if (target.zone === 'leader') {
        const n = hasKeyword(state, b.attacker, 'doubleAttack') ? 2 : 1;
        log(
          state,
          null,
          lg(n > 1 ? 'attackHitsLeaderDouble' : 'attackHitsLeader', `O ataque acerta o líder (${ap} contra ${tp})${n > 1 ? ' — Double Attack!' : ''}.`, { attack: ap, defense: tp }),
        );
        const hadLife = state.players[defender].life.length > 0;
        state.stack.push({
          kind: 'damage',
          defender,
          remaining: n,
          banish: hasKeyword(state, b.attacker, 'banish'),
          attack: true,
        });
        // Disparado com o dano em andamento: resolve depois dele (8-6-2).
        if (hadLife) emit(state, { kind: 'attackDamage', player: attackerOwner, card: b.attacker });
      } else {
        koCharacter(state, b.target, { inBattle: true, by: b.attacker });
        if (!locate(state, b.target)) emit(state, { kind: 'battleKO', player: attackerOwner, card: b.attacker });
      }
      return;
    }

    case 'end': {
      // Fim da batalha (7-1-5): primeiro ativam os efeitos "at the end of this battle" e os de
      // "if this Character battles your opponent's Character" (7-1-5-2); eles resolvem com a batalha
      // ainda em curso (`state.battle`, Counters e outros "during this battle" valendo). Só depois
      // expiram os efeitos "during this battle" e a batalha termina (7-1-5-3/4).
      let queued = false;
      if (!b.endFired) {
        b.endFired = true;
        const fought = (b.fought ?? []).filter((uid) => locate(state, uid));
        for (const uid of fought) {
          // "the opponent's Character you battled with"
          const other = (b.fought ?? []).find((u) => u !== uid);
          // "When this Character battles "Strike" attribute Characters, this Character gains +3000 power during
          // this turn" (ST05-010): o bônus continua depois da batalha, até o fim do turno.
          for (const a of cardDef(state, uid).abilities) {
            const vs = a.battleVsAttribute;
            if (a.timing !== 'static' || !vs || !other || !conditionsMet(state, uid, a)) continue;
            if (cardDef(state, other).category === 'character' && cardDef(state, other).attributes?.includes(vs.attribute)) {
              addModifier(state, ownerOf(state, uid), { uid, kind: 'power', amount: vs.power, duration: 'turn' });
            }
          }
          for (const e of pushAbilities(state, uid, 'battlesCharacter')) {
            if (other) e.last = [other];
            queued = true;
          }
        }
      }
      // Também os "at the end of this battle" criados por esses mesmos efeitos.
      if (b.after?.length) {
        const after = b.after;
        delete b.after;
        queueDelayed(state, after);
        queued = true;
      }
      // Os efeitos disparados resolvem antes (fila 8-6); a batalha volta aqui depois deles.
      if (queued) return;
      state.modifiers = state.modifiers.filter((m) => m.duration !== 'battle');
      state.battle = null;
      state.stack.pop();
      return;
    }
  }
}

export function stepDamage(state: GameState, frame: DamageFrame) {
  // Dano num jogador que já saiu da mesa (o oponente de um efeito ainda em resolução): nada acontece.
  if (state.players[frame.defender].out) {
    state.stack.pop();
    return;
  }
  if (frame.remaining <= 0) {
    state.stack.pop();
    // Reações ao dano só depois que ele (e os [Trigger]) termina.
    if (frame.lost) {
      emit(state, { kind: 'damageTaken', player: frame.defender });
      // "When you deal damage": só para quem causou o dano (quem atacou, ou quem usou o efeito). Numa mesa de mais
      // de dois, os outros oponentes do defensor não causaram nada.
      const dealer = frame.attack && state.battle && state.cards[state.battle.attacker] ? ownerOf(state, state.battle.attacker) : frame.by;
      emit(state, { kind: 'damageDealt', player: frame.defender, ...(dealer !== undefined ? { byPlayer: dealer } : {}) });
      // "When your number of Life cards becomes 0" já aconteceu quando a carta saiu, ainda que um
      // [Trigger] tenha devolvido Vida depois: o efeito dispara agora, depois dos [Trigger].
      lifeRemoved(state, frame.defender, frame.zero);
    }
    return;
  }
  // "If you would take damage, you may … instead": oferecida uma vez, antes da primeira Vida (e da derrota).
  if (!frame.replaceAsked && !frame.lost) {
    frame.replaceAsked = true;
    if (offerDamageReplacement(state, frame.defender)) return;
  }
  const ps = state.players[frame.defender];
  if (ps.life.length === 0) {
    // Ataque: vence só quem encontra 0 de Vida no momento em que o dano é determinado (7-1-4-1-1-1).
    // Com [Double Attack] contra 1 de Vida, o 1º ponto tira a última Vida e o 2º não faz nada
    // (Q&A de regras: "can I win the game by using a [Double Attack]? No, you cannot.").
    // Dano de efeito segue 1-2-1-1-1 ponto a ponto: o Líder que leva dano com 0 de Vida perde.
    if (frame.attack && frame.lost) {
      frame.remaining--;
      log(state, frame.defender, lg('noLifeLeft', `${ps.name} não tem mais Vida: o dano restante do ataque não tem efeito.`, { player: ps.name }));
      return;
    }
    const reason = lg('winLeaderDamage', `O líder de ${ps.name} recebeu dano sem cartas de Vida.`, { player: ps.name });
    // O golpe final é de quem atacou, ou de quem usou o efeito que causou o dano.
    const by = frame.attack && state.battle ? ownerOf(state, state.battle.attacker) : frame.by;
    eliminate(state, [frame.defender], () => reason, reason, by);
    return;
  }
  const card = ps.life.pop()!;
  frame.remaining--;
  frame.lost = (frame.lost ?? 0) + 1;
  if (ps.life.length === 0) frame.zero = true;
  log(state, frame.defender, lg('losesLife', `${ps.name} perde 1 Vida (${ps.life.length} restante(s)).`, { player: ps.name, n: ps.life.length }));
  if (frame.banish) {
    if (ps.lifeFaceUp?.includes(card)) removeFrom(ps.lifeFaceUp, card);
    ps.trash.push(card);
    log(state, frame.defender, lg('banish', `[Banish] A carta de Vida vai para o descarte.`));
    return;
  }
  if (ps.lifeFaceUp?.includes(card) && leaderRule(state, ps.id, 'faceUpLifeToDeck')) {
    lifeToHandCard(state, ps.id, card);
    return;
  }
  // O dono sempre olha a carta antes de ela ir para a mão, tenha ela [Trigger] ou não: se a
  // pergunta só aparecesse com [Trigger], o oponente saberia (pela pausa) o que saiu da Vida.
  frame.lifeCard = card;
  state.pending = { kind: 'lifeCard', player: frame.defender, card };
}
