// Passos de efeito sobre o deck e o trash: buscar, olhar e revelar o topo, arrumar, embaralhar, trashar do deck e
// tirar cartas do trash.

import { shuffleInPlace } from '../../rng';
import type { EffectStep, GameState, PlayerState } from '../../types';
import type { EffectFrame } from '../constants';
import { DECK_TOP_BOTTOM, lg, log, logSecret, pr, promptOf } from '../messages';
import { opponentOf } from '../table';
import { cardDef, matchesFilter } from '../queries';
import { markRevealed } from '../cancel';
import { askCards, askOption, playFree } from '../effects';
import { removeFrom } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type DeckStep = Extract<EffectStep, {
  do:
    | 'search' | 'tutor' | 'trashToDeckBottom' | 'revealTop' | 'revealedToHand' | 'opponentTrashToBottom' | 'revealOpponentTop'
    | 'revealedToTopOrBottom' | 'lastToDeckTop' | 'lookOpponentTop' | 'revealedToBottom' | 'millDeck' | 'fromTrashToHand'
    | 'shuffleDeck' | 'arrangeTop';
}>;

export function execDeckStep(state: GameState, frame: EffectFrame, step: DeckStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'search': {
      const top = ps.deck.slice(0, step.look);
      const options = top.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      // 1ª escolha (memo vazio): as cartas pegas. 2ª (resto no fundo, 2+ cartas): a ordem do fundo.
      if (!frame.memo) {
        if (!frame.choice) {
          if (!top.length) return true;
          // Mostra todas as cartas olhadas, mesmo sem opção válida: o jogador vê o que vai para o fundo.
          state.pending = {
            kind: 'selectTargets',
            player: frame.controller,
            options,
            min: 0,
            max: Math.min(step.upTo, options.length),
            ...promptOf(
              options.length
                ? pr(
                    step.play ? 'searchPlay' : step.toTrash ? 'searchTrash' : step.toLife ? 'searchToLife' : 'searchToHand',
                    `${srcName}: olhe as ${top.length} cartas do topo e escolha até ${step.upTo} para ${step.play ? 'jogar' : step.toTrash ? 'descartar' : step.toLife ? 'colocar no topo da Vida' : 'adicionar à mão'}.`,
                    { source: srcName, count: top.length, max: step.upTo },
                  )
                : pr('searchNone', `${srcName}: nenhuma das ${top.length} cartas do topo pode ser escolhida.`, { source: srcName, count: top.length }),
            ),
            intent: 'help',
            source: frame.source,
            shown: top,
            hidden: true,
          };
          return false;
        }
        frame.memo = frame.choice.filter((u) => options.includes(u));
        frame.choice = undefined;
        const rest = top.filter((u) => !frame.memo!.includes(u));
        if (step.rest === 'bottom' && rest.length > 1) {
          askCards(
            state,
            frame,
            rest,
            rest.length,
            pr('orderBottomCards', `${srcName}: escolha a ordem das cartas que vão para o fundo do deck (a primeira fica mais acima; a última, no fundo).`, { source: srcName }),
            { min: rest.length, ordered: true },
          );
          return false;
        }
      }
      const chosen = frame.memo.filter((u) => top.includes(u));
      let rest = top.filter((u) => !chosen.includes(u));
      if (frame.choice) {
        const order = frame.choice.filter((u) => rest.includes(u));
        rest = [...order, ...rest.filter((u) => !order.includes(u))];
      }
      for (const uid of top) removeFrom(ps.deck, uid);
      for (const uid of chosen) {
        if (step.toTrash) {
          ps.trash.push(uid);
          log(state, frame.controller, lg('trashesCard', `${ps.name} descarta ${cardDef(state, uid).name}.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
        } else if (step.toLife) {
          ps.life.push(uid);
          if (step.lifeFaceDown) log(state, frame.controller, lg('addsOneToLife', `${ps.name} coloca 1 carta no topo da Vida.`, { player: ps.name }));
          else {
            (ps.lifeFaceUp ??= []).push(uid);
            log(state, frame.controller, lg('addsToLifeFaceUp', `${ps.name} coloca ${cardDef(state, uid).name} no topo da Vida, virada para cima.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
          }
        } else if (step.play) {
          // "play up to 1 … Then, place the rest at the bottom": joga a carta (o resto vai para o fundo antes).
          ps.hand.push(uid);
          playFree(state, uid, step.rested, frame.source, true); // vem do deck (só passa pela mão)
        } else if (step.noReveal) {
          // "add up to 1 card to your hand" (sem "reveal", OP16-021): o oponente não vê a carta.
          ps.hand.push(uid);
          log(state, frame.controller, lg('addsOneToHand', `${ps.name} adiciona 1 carta à mão.`, { player: ps.name }));
        } else {
          ps.hand.push(uid);
          log(state, frame.controller, lg('revealsAddsToHand', `${ps.name} revela ${cardDef(state, uid).name} e adiciona à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { uids: [uid], by: ps.id });
        }
      }
      frame.searched = chosen.length;
      if (step.rest === 'bottom') {
        ps.deck.push(...rest);
        if (rest.length) log(state, frame.controller, lg('placesAtBottom', `${ps.name} coloca ${rest.length} carta(s) no fundo do deck.`, { player: ps.name, n: rest.length }));
      } else if (step.rest === 'trash') ps.trash.push(...rest);
      else if (rest.length) {
        // "place the rest at the top or bottom of the deck in any order": o jogador ordena em seguida.
        ps.deck.unshift(...rest);
        frame.steps.splice(frame.i + 1, 0, { do: 'arrangeTop', look: rest.length });
      }
      return true;
    }
    case 'tutor': {
      const options = ps.deck.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        // Abre mesmo sem carta válida: pular contaria ao oponente o que há no deck.
        if (!ps.deck.length) return true;
        askCards(state, frame, options, step.upTo, pr('chooseDeckCardsToHand', `${srcName}: escolha até ${step.upTo} carta(s) do deck para adicionar à mão.`, { source: srcName, n: step.upTo }), {
          hidden: 'do deck',
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.deck, uid);
        ps.hand.push(uid);
        log(state, frame.controller, lg('revealsFromDeckToHand', `${ps.name} revela ${cardDef(state, uid).name} do deck e adiciona à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { uids: [uid], by: ps.id });
      }
      return true;
    }
    case 'trashToDeckBottom': {
      const options = ps.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter));
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseTrashCardsToBottom', `${srcName}: escolha ${n} carta(s) do descarte para o fundo do deck.`, { source: srcName, n }), { min: n });
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, lg('trashToBottom', `${ps.name} coloca ${n} carta(s) do descarte no fundo do deck.`, { player: ps.name, n }));
      return true;
    }
    case 'revealTop': {
      const card = ps.deck[0];
      frame.last = card ? [card] : [];
      frame.revealed = frame.last;
      if (card) log(state, frame.controller, lg('revealsDeckTop', `${ps.name} revela ${cardDef(state, card).name} do topo do deck.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
      return true;
    }
    case 'revealedToHand': {
      const card = frame.last?.[0];
      if (card && ps.deck.includes(card) && (!step.filter || matchesFilter(cardDef(state, card), step.filter))) {
        removeFrom(ps.deck, card);
        ps.hand.push(card);
        log(state, frame.controller, lg('addsToHand', `${ps.name} adiciona ${cardDef(state, card).name} à mão.`, { player: ps.name, card: cardDef(state, card).name }), { cards: [card] });
      }
      return true;
    }
    case 'opponentTrashToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const pile = opp.trash.filter((u) => !step.filter || matchesFilter(cardDef(state, u), step.filter));
      const n = Math.min(step.count, pile.length);
      if (!n) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: step.chooser === 'self' ? frame.controller : opp.id,
          options: pile,
          min: step.upTo ? 0 : n,
          max: n,
          ...promptOf(
            pr(
              step.chooser === 'self' ? 'chooseOpponentTrashToBottom' : 'chooseOwnTrashToBottom',
              `${srcName}: escolha ${n} carta(s) do descarte ${step.chooser === 'self' ? 'do oponente' : 'seu'} para o fundo do deck.`,
              { source: srcName, n },
            ),
          ),
          intent: 'discard',
          source: frame.source,
          ordered: true,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.trash.includes(u))) {
        removeFrom(opp.trash, uid);
        opp.deck.push(uid);
      }
      log(state, opp.id, lg('oppTrashToBottom', `${frame.choice.length} carta(s) do descarte de ${opp.name} vão para o fundo do deck.`, { n: frame.choice.length, player: opp.name }));
      return true;
    }
    case 'revealOpponentTop': {
      const card = state.players[opponentOf(state, frame.controller)].deck[0];
      frame.last = card ? [card] : [];
      if (card) log(state, frame.controller, lg('revealsOppDeckTop', `${ps.name} revela ${cardDef(state, card).name} do topo do deck do oponente.`, { player: ps.name, card: cardDef(state, card).name }), { uids: [card] });
      return true;
    }
    case 'revealedToTopOrBottom': {
      const card = frame.revealed?.[0] ?? frame.last?.[0];
      if (!card || !ps.deck.includes(card)) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('revealedTopOrBottom', `${srcName}: ${cardDef(state, card).name} fica no topo ou vai para o fundo do deck?`, { source: srcName, card: cardDef(state, card).name }), ['Topo do deck', 'Fundo do deck'], DECK_TOP_BOTTOM);
        return false;
      }
      if (frame.choice[0] === '1') {
        removeFrom(ps.deck, card);
        ps.deck.push(card);
      }
      return true;
    }
    case 'lastToDeckTop': {
      for (const uid of (frame.last ?? []).filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.unshift(uid);
        logSecret(
          state,
          frame.controller,
          lg('handCardToDeckTop', `${ps.name} coloca 1 carta da mão no topo do deck.`, { player: ps.name }),
          lg('cardBackToDeckTop', `${cardDef(state, uid).name} volta ao topo do deck.`, { card: cardDef(state, uid).name }),
          [uid],
        );
      }
      return true;
    }
    case 'lookOpponentTop': {
      // A carta aparece inteira só para quem olha (`shown`); o oponente e os espectadores veem
      // apenas que uma carta do topo foi olhada. O histórico guarda o nome só para quem olhou.
      const opp = state.players[opponentOf(state, frame.controller)];
      const card = opp.deck[0];
      if (!card) return true;
      if (!frame.choice) {
        askOption(state, frame, frame.controller, pr('opponentDeckTopIs', `${srcName}: a carta do topo do deck do oponente é ${cardDef(state, card).name}.`, { source: srcName, card: cardDef(state, card).name }), ['OK'], ['common.ok'], undefined, [card]);
        return false;
      }
      logSecret(
        state,
        frame.controller,
        lg('looksOpponentDeckTop', `${ps.name} olha a carta do topo do deck de ${opp.name}.`, { player: ps.name, opponent: opp.name }),
        lg('looksOpponentDeckTopCard', `${ps.name} olha ${cardDef(state, card).name} no topo do deck de ${opp.name}.`, { player: ps.name, card: cardDef(state, card).name, opponent: opp.name }),
        [card],
      );
      return true;
    }
    case 'revealedToBottom': {
      const card = frame.revealed?.[0] ?? frame.last?.[0];
      if (card && ps.deck.includes(card)) {
        removeFrom(ps.deck, card);
        ps.deck.push(card);
      }
      return true;
    }
    case 'millDeck': {
      const n = Math.min(step.count, ps.deck.length);
      const milled = ps.deck.splice(0, n);
      ps.trash.push(...milled);
      // "If the trashed card has a cost of 6 or more"
      frame.last = milled;
      if (n) log(state, frame.controller, lg('millsDeck', `${ps.name} descarta ${n} carta(s) do topo do deck.`, { player: ps.name, n }));
      return true;
    }
    case 'fromTrashToHand': {
      const options = ps.trash.filter((u) => matchesFilter(cardDef(state, u), step.filter));
      if (!frame.choice) {
        if (!options.length) return true;
        askCards(state, frame, options, step.upTo, pr('chooseTrashCardsToHand', `${srcName}: escolha até ${step.upTo} carta(s) do descarte para a mão.`, { source: srcName, n: step.upTo }));
        return false;
      }
      for (const uid of frame.choice.filter((u) => options.includes(u))) {
        removeFrom(ps.trash, uid);
        ps.hand.push(uid);
        log(state, frame.controller, lg('trashToHand', `${ps.name} adiciona ${cardDef(state, uid).name} do descarte à mão.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'shuffleDeck':
      shuffleInPlace(state, ps.deck);
      log(state, frame.controller, lg('shuffles', `${ps.name} embaralha o deck.`, { player: ps.name }));
      return true;
    case 'arrangeTop': {
      // "Look at N cards from the top of your deck and place them at the top or bottom of your deck in any
      // order": todas vão para o topo ou todas para o fundo, sem dividir (Q&A OP01-073; CR 1-3-7). 1ª pergunta:
      // topo ou fundo, com as cartas à mostra; 2ª (com 2 ou mais cartas): a ordem. `memo` = [destino, ...cartas].
      if (!frame.memo) {
        const top = ps.deck.slice(0, step.look);
        if (!top.length) return true;
        let where: 'top' | 'bottom' = 'top';
        // "place them at the top of your deck in any order": só a ordem.
        if (!step.topOnly) {
          if (!frame.choice) {
            // Olhar o deck é informação ganha: a ação deixa de ser cancelável.
            markRevealed(state);
            askOption(
              state,
              frame,
              frame.controller,
              pr('arrangeTopOrBottom', `${srcName}: estas são as ${top.length} cartas do topo. Ficam no topo ou vão para o fundo do deck?`, {
                source: srcName,
                count: top.length,
              }),
              ['Topo do deck', 'Fundo do deck'],
              DECK_TOP_BOTTOM,
              undefined,
              top,
            );
            return false;
          }
          where = frame.choice[0] === '1' ? 'bottom' : 'top';
        }
        frame.memo = [where, ...top];
        frame.choice = undefined;
        if (top.length > 1) {
          askCards(
            state,
            frame,
            top,
            top.length,
            where === 'top'
              ? pr('arrangeTopOrder', `${srcName}: clique nas cartas na ordem em que ficarão no topo (a primeira fica por cima; as que não escolher mantêm a ordem).`, { source: srcName })
              : pr('arrangeBottomOrder', `${srcName}: clique nas cartas na ordem em que irão para o fundo (a última escolhida fica por baixo de tudo; as que não escolher mantêm a ordem).`, {
                  source: srcName,
                }),
            { ordered: true },
          );
          return false;
        }
      }
      const [where, ...cards] = frame.memo;
      const chosen = (frame.choice ?? []).filter((u) => cards.includes(u));
      const order = [...chosen, ...cards.filter((u) => !chosen.includes(u))];
      for (const uid of order) removeFrom(ps.deck, uid);
      if (where === 'bottom') {
        ps.deck.push(...order);
        log(state, frame.controller, lg('placesAtBottom', `${ps.name} coloca ${order.length} carta(s) no fundo do deck.`, { player: ps.name, n: order.length }));
      } else {
        ps.deck.unshift(...order);
        log(state, frame.controller, lg('returnsToDeckTop', `${ps.name} devolve ${order.length} carta(s) ao topo do deck.`, { player: ps.name, n: order.length }));
      }
      return true;
    }
  }
}
