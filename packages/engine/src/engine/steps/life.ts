// Passos de efeito sobre a Vida: virar para cima e para baixo, olhar, arrumar, mandar para a mão, o trash ou o
// deck, pôr cartas na Vida e causar dano.

import type { EffectStep, GameState, PlayerState } from '../../types';
import type { EffectFrame } from '../constants';
import { lg, LIFE_TOP_BOTTOM, log, pr } from '../messages';
import { isMultiplayer, opponentOf } from '../table';
import { cardDef, locate, matchesFilter } from '../queries';
import { discardable, restricted } from '../options';
import { askCards, askOption, resolveTargets, upToCount } from '../effects';
import { removalBlocked, removeFromField } from '../removal';
import { faceDownLife, lifeEnds, lifeRemoved, lifeToHandCard, lifeTop, removeFrom, takeLife } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type LifeStep = Extract<EffectStep, {
  do:
    | 'trashLife' | 'lifeToTrash' | 'lifeFace' | 'arrangeLife' | 'opponentLifeToBottom' | 'takeDamage' | 'lifeTrashUntil'
    | 'trashFaceUpLife' | 'lifeOneToDeckTop' | 'revealLifeTop' | 'opponentLifeToHand' | 'lifeToHand' | 'handToLife' | 'fieldToLife'
    | 'peekLife' | 'addLifeFromDeck';
}>;

export function execLifeStep(state: GameState, frame: EffectFrame, step: LifeStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'trashLife': {
      const target = state.players[step.side === 'own' ? frame.controller : opponentOf(state, frame.controller)];
      const n = upToCount(state, frame, step, target.life.length, pr('howManyLifeToTrash', `${srcName}: quantas cartas da Vida de ${target.name} descartar?`, { source: srcName, player: target.name }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) target.trash.push(takeLife(target));
      if (n) lifeRemoved(state, target.id);
      if (n) log(state, frame.controller, lg('lifeToTrash', `${n} carta(s) de Vida de ${target.name} vão para o descarte.`, { n, player: target.name }));
      return true;
    }
    case 'lifeToTrash': {
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, pr('trashLifeTopOrBottom', `${srcName}: descartar a carta do topo ou do fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) ps.trash.push(takeLife(ps, fromBottom));
      if (n) lifeRemoved(state, ps.id);
      log(state, frame.controller, lg('trashesLife', `${ps.name} descarta ${n} carta(s) da Vida.`, { player: ps.name, n }));
      return true;
    }
    case 'lifeFace': {
      ps.lifeFaceUp ??= [];
      if (step.topOrBottom) {
        // A carta do topo ou a do fundo da Vida (a que puder ser virada); com as duas, o jogador escolhe.
        const ends = lifeEnds(ps, step.up);
        if (!ends.length) return true;
        let uid = ends[0];
        if (ends.length > 1) {
          if (!frame.choice) {
            askOption(state, frame, frame.controller, pr('flipLifeTopOrBottom', `${srcName}: virar a carta do topo ou do fundo da Vida?`, { source: srcName }), ['Topo', 'Fundo'], ['engine.optTop', 'engine.optBottom']);
            return false;
          }
          uid = ends[Number(frame.choice[0])] ?? ends[0];
        }
        if (step.up) ps.lifeFaceUp.push(uid);
        else removeFrom(ps.lifeFaceUp, uid);
        const top = uid === ps.life[ps.life.length - 1];
        // Virada para cima, a carta fica pública (3-10-2-1): o log diz qual é.
        const card = cardDef(state, uid).name;
        log(
          state,
          frame.controller,
          step.up
            ? lg(
                `flipsLife${top ? 'Top' : 'Bottom'}UpCard`,
                `${ps.name} vira a carta do ${top ? 'topo' : 'fundo'} da Vida para cima: ${card}.`,
                { player: ps.name, card },
              )
            : lg(`flipsLife${top ? 'Top' : 'Bottom'}Down`, `${ps.name} vira a carta do ${top ? 'topo' : 'fundo'} da Vida para baixo.`, { player: ps.name }),
          step.up ? { cards: [uid] } : undefined,
        );
        return true;
      }
      const pool = step.fromTop
        ? lifeTop(ps, step.count, step.up)
        : step.up
          ? faceDownLife(ps)
          : [...ps.life].reverse().filter((u) => ps.lifeFaceUp!.includes(u));
      const flipped = pool.slice(0, step.count);
      for (const uid of flipped) {
        if (step.up) ps.lifeFaceUp.push(uid);
        else removeFrom(ps.lifeFaceUp, uid);
      }
      const n = flipped.length;
      if (step.up && n) {
        const cards = flipped.map((u) => cardDef(state, u).name).join(', ');
        log(state, frame.controller, lg('flipsLifeUpCards', `${ps.name} vira ${n} carta(s) de Vida para cima: ${cards}.`, { player: ps.name, n, cards }), { cards: flipped });
        return true;
      }
      log(
        state,
        frame.controller,
        lg(step.up ? 'flipsLifeUp' : 'flipsLifeDown', `${ps.name} vira ${n} carta(s) de Vida para ${step.up ? 'cima' : 'baixo'}.`, { player: ps.name, n }),
      );
      return true;
    }
    case 'arrangeLife': {
      const owner = step.whose === 'own' ? ps : state.players[opponentOf(state, frame.controller)];
      if (owner.life.length < 2) return true;
      if (!frame.choice) {
        // Do topo para o fundo, na ordem dos cliques.
        askCards(state, frame, [...owner.life].reverse(), owner.life.length, pr('arrangeLife', `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, { source: srcName }), {
          min: owner.life.length,
          ordered: true,
        });
        return false;
      }
      const order = frame.choice.filter((u) => owner.life.includes(u));
      if (order.length === owner.life.length) owner.life = [...order].reverse();
      log(state, frame.controller, lg('arrangesLife', `${ps.name} reorganiza as cartas de Vida de ${owner.name}.`, { player: ps.name, owner: owner.name }));
      return true;
    }
    case 'opponentLifeToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.life.length);
      for (let k = 0; k < n; k++) opp.deck.push(takeLife(opp));
      if (n) {
        lifeRemoved(state, opp.id);
        log(state, frame.controller, lg('oppLifeToBottom', `${n} carta(s) da Vida de ${opp.name} vão para o fundo do deck.`, { n, player: opp.name }));
      }
      return true;
    }
    case 'takeDamage':
      state.stack.push({
        kind: 'damage',
        defender: step.opponent ? opponentOf(state, frame.controller) : frame.controller,
        remaining: step.count,
        banish: false,
        ...(isMultiplayer(state) ? { by: frame.controller } : {}),
      });
      return true;
    case 'lifeTrashUntil': {
      const n = Math.max(0, ps.life.length - step.count);
      for (let k = 0; k < n; k++) ps.trash.push(takeLife(ps));
      if (n) {
        lifeRemoved(state, ps.id);
        log(state, frame.controller, lg('lifeToTrash', `${n} carta(s) de Vida de ${ps.name} vão para o descarte.`, { n, player: ps.name }));
      }
      return true;
    }
    case 'trashFaceUpLife': {
      const up = ps.life.filter((u) => ps.lifeFaceUp?.includes(u));
      for (const uid of up) {
        removeFrom(ps.life, uid);
        removeFrom(ps.lifeFaceUp!, uid);
        ps.trash.push(uid);
      }
      if (up.length) {
        log(state, frame.controller, lg('trashesFaceUpLife', `${ps.name} descarta ${up.length} carta(s) de Vida virada(s) para cima.`, { player: ps.name, n: up.length }));
        lifeRemoved(state, ps.id);
      }
      return true;
    }
    case 'lifeOneToDeckTop': {
      // "look at all your Life cards; place 1 at the top of your deck and place the rest back … in any order"
      if (!ps.life.length) return true;
      if (!frame.memo) {
        if (!frame.choice) {
          askCards(state, frame, [...ps.life].reverse(), 1, pr('chooseLifeToDeckTop', `${srcName}: escolha a carta de Vida que vai para o topo do deck.`, { source: srcName }), { min: 1 });
          return false;
        }
        const uid = frame.choice.find((u) => ps.life.includes(u));
        if (uid) {
          removeFrom(ps.life, uid);
          if (ps.lifeFaceUp?.includes(uid)) removeFrom(ps.lifeFaceUp, uid);
          ps.deck.unshift(uid);
          log(state, frame.controller, lg('lifeToDeckTop', `${ps.name} coloca 1 carta da Vida no topo do deck.`, { player: ps.name }));
          lifeRemoved(state, ps.id);
        }
        frame.memo = ['order'];
        frame.choice = undefined;
      }
      if (ps.life.length < 2) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.life].reverse(), ps.life.length, pr('arrangeLife', `${srcName}: ordene as cartas de Vida (a primeira escolhida fica no topo).`, { source: srcName }), { min: ps.life.length, ordered: true });
        return false;
      }
      const order = frame.choice.filter((u) => ps.life.includes(u));
      if (order.length === ps.life.length) ps.life = [...order].reverse();
      return true;
    }
    case 'revealLifeTop': {
      const card = ps.life[ps.life.length - 1];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, lg('revealsLifeTop', `${ps.name} revela ${cardDef(state, card).name} do topo da Vida.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
      return true;
    }
    case 'opponentLifeToHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = upToCount(state, frame, step, opp.life.length, pr('howManyOpponentLifeToHand', `${srcName}: quantas cartas da Vida de ${opp.name} vão para a mão dele?`, { source: srcName, player: opp.name }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) lifeToHandCard(state, opp.id, opp.life.pop()!);
      if (n) lifeRemoved(state, opp.id);
      if (n) log(state, frame.controller, lg('lifeToHand', `${opp.name} coloca ${n} carta(s) da Vida na mão.`, { player: opp.name, n }));
      return true;
    }
    case 'lifeToHand': {
      if (restricted(state, frame.controller, 'noLifeToHand')) return true;
      const n = Math.min(step.count, ps.life.length);
      if (n === 0) return true;
      if (step.choose && ps.life.length > 1 && !frame.choice) {
        askOption(state, frame, frame.controller, pr('lifeFromWhere', `${srcName}: de onde tirar a carta de Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
        return false;
      }
      const fromBottom = frame.choice?.[0] === '1';
      for (let i = 0; i < n; i++) lifeToHandCard(state, ps.id, fromBottom ? ps.life.shift()! : ps.life.pop()!);
      lifeRemoved(state, ps.id);
      log(
        state,
        frame.controller,
        lg(fromBottom ? 'lifeBottomToHand' : 'lifeTopToHand', `${ps.name} coloca ${n} carta(s) da Vida (${fromBottom ? 'fundo' : 'topo'}) na mão.`, { player: ps.name, n }),
      );
      return true;
    }
    case 'handToLife': {
      const options = [
        ...(step.trashOnly ? [] : discardable(state, frame.controller, step.filter)),
        ...(step.fromTrash || step.trashOnly ? ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter ?? {})) : []),
      ];
      // Com "top or bottom": primeiro as cartas (memo), depois a posição.
      let picked = frame.memo;
      if (!picked) {
        if (!frame.choice) {
          if (!options.length && (step.trashOnly || !ps.hand.length)) return true;
          askCards(state, frame, options, step.upTo, pr(step.choose ? 'chooseHandCardsToLife' : 'chooseHandCardsToLifeTop', `${srcName}: escolha até ${step.upTo} carta(s) da mão para ${step.choose ? 'a' : 'o topo da'} Vida.`, { source: srcName, n: step.upTo }), step.trashOnly ? {} : { hidden: 'da mão' });
          return false;
        }
        picked = frame.choice.filter((u) => options.includes(u));
        if (step.choose && picked.length) {
          frame.memo = picked;
          frame.choice = undefined;
          askOption(state, frame, frame.controller, pr('lifeTopOrBottom', `${srcName}: colocar no topo ou no fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
          return false;
        }
      }
      const bottom = Boolean(step.choose) && frame.choice?.[0] === '1';
      // Da mão para a Vida com uma exigência ("up to 1 {Supernovas} type Character card"): a carta é
      // revelada (11-2-1), como na busca do deck para a mão; sai no log público com o nome. Sem
      // exigência (qualquer carta) não há o que conferir e ela vai escondida, como a carta que vai
      // do deck para a Vida (Q&A de regras). Do descarte ou virada para cima, ela já é pública.
      const filtered = Object.keys(step.filter ?? {}).length > 0;
      const shown = picked.filter((uid) => filtered || step.faceUp || ps.trash.includes(uid));
      for (const uid of picked) {
        removeFrom(ps.hand, uid);
        removeFrom(ps.trash, uid);
        if (bottom) ps.life.unshift(uid);
        else ps.life.push(uid);
        if (step.faceUp) (ps.lifeFaceUp ??= []).push(uid);
      }
      if (picked.length) {
        const names = shown.length ? ` (${shown.map((u) => cardDef(state, u).name).join(', ')})` : '';
        const from = step.trashOnly ? 'do descarte' : step.fromTrash ? 'da mão ou do descarte' : 'da mão';
        const reveal = filtered && !step.trashOnly;
        // Chave: revela (com nomes) | com nomes | sem nomes, e topo/fundo; a origem é uma parte traduzível.
        const key = `${reveal ? 'revealsToLife' : names ? 'toLifeNamed' : 'toLife'}${bottom ? 'Bottom' : 'Top'}`;
        log(
          state,
          frame.controller,
          lg(
            key,
            `${ps.name} ${reveal ? 'revela e ' : ''}coloca ${picked.length} carta(s) ${from}${names} no ${bottom ? 'fundo' : 'topo'} da Vida.`,
            { player: ps.name, n: picked.length, from, ...(names ? { cards: shown.map((u) => cardDef(state, u).name).join(', ') } : {}) },
            { from: { items: [{ key: step.trashOnly ? 'log.fromTrash' : step.fromTrash ? 'log.fromHandOrTrash' : 'log.fromHand' }] } },
          ),
          reveal ? { uids: shown, by: ps.id } : { cards: shown },
        );
      }
      return true;
    }
    case 'fieldToLife': {
      // Com "top or bottom": primeiro o alvo (memo), depois a posição.
      let targets = frame.memo;
      if (!targets) {
        const t = resolveTargets(state, frame, step.target, 'help', pr('chooseCharacterToLife', `${srcName}: escolha um Personagem para a Vida.`, { source: srcName }));
        if (!t) return false;
        targets = t.filter((u) => locate(state, u)?.zone === 'character' && !removalBlocked(state, u, frame.controller));
        if (step.choose && targets.length) {
          frame.memo = targets;
          frame.choice = undefined;
          askOption(state, frame, frame.controller, pr('lifeTopOrBottom', `${srcName}: colocar no topo ou no fundo da Vida?`, { source: srcName }), ['Topo da Vida', 'Fundo da Vida'], LIFE_TOP_BOTTOM);
          return false;
        }
      }
      const bottom = Boolean(step.choose) && frame.choice?.[0] === '1';
      removeFromField(state, targets.filter((u) => locate(state, u)?.zone === 'character'), 'life', {
        byPlayer: frame.controller,
        by: frame.source,
        ...(bottom ? { bottom: true } : {}),
        ...(step.faceUp ? { faceUp: true } : {}),
      });
      return true;
    }
    case 'peekLife': {
      const opp = step.whose === 'own' ? ps : state.players[opponentOf(state, frame.controller)];
      // Etapa 1: de quem é a Vida (memo[0] = 'own' | 'opp').
      if (!frame.memo) {
        const sides = (step.whose === 'either' ? ['own', 'opp'] : [step.whose === 'own' ? 'own' : 'opp']).filter(
          (side) => (side === 'own' ? ps : opp).life.length > 0,
        );
        if (!sides.length) return true;
        if (!frame.choice) {
          const labels = sides.map((side) => (side === 'own' ? 'Olhar a sua Vida' : 'Olhar a Vida do oponente'));
          const labelKeys = sides.map((side) => (side === 'own' ? 'engine.optPeekOwnLife' : 'engine.optPeekOpponentLife'));
          askOption(state, frame, frame.controller, pr('peekWhichLife', `${srcName}: olhar a carta do topo de qual Vida?`, { source: srcName }), [...labels, 'Não olhar'], [
            ...labelKeys,
            'engine.optDontPeek',
          ]);
          frame.memo = ['pick', ...sides];
          return false;
        }
      }
      if (frame.memo?.[0] === 'pick') {
        const sides = frame.memo.slice(1);
        const side = sides[Number(frame.choice?.[0])];
        if (!side) return true; // "Não olhar"
        frame.memo = [side];
        frame.choice = undefined;
      }
      const side = frame.memo![0];
      const life = (side === 'own' ? ps : opp).life;
      if (!frame.choice) {
        const card = life[life.length - 1];
        askOption(
          state,
          frame,
          frame.controller,
          pr('lifeTopIsWhere', `${srcName}: a carta do topo é ${cardDef(state, card).name}. Onde deixar?`, { source: srcName, card: cardDef(state, card).name }),
          ['Manter no topo', 'Colocar no fundo'],
          ['engine.optKeepOnTop', 'engine.optPlaceAtBottom'],
        );
        return false;
      }
      if (frame.choice[0] === '1') life.unshift(life.pop()!);
      log(
        state,
        frame.controller,
        lg(
          `peeksLife${side === 'own' ? 'Own' : 'Opponent'}${frame.choice[0] === '1' ? 'Bottom' : 'Top'}`,
          `${ps.name} olha a carta do topo da Vida ${side === 'own' ? 'própria' : 'do oponente'} e a deixa no ${frame.choice[0] === '1' ? 'fundo' : 'topo'}.`,
          { player: ps.name },
        ),
      );
      return true;
    }
    case 'addLifeFromDeck': {
      const n = upToCount(state, frame, step, ps.deck.length, pr('howManyDeckToLife', `${srcName}: quantas cartas do topo do deck adicionar à Vida?`, { source: srcName }));
      if (n === null) return false;
      for (let i = 0; i < n; i++) ps.life.push(ps.deck.shift()!);
      if (n) log(state, frame.controller, lg('deckToLife', `${ps.name} adiciona ${n} carta(s) do deck à Vida.`, { player: ps.name, n }));
      return true;
    }
  }
}
