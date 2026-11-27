// Passos de efeito sobre a mão: comprar, descartar, revelar e devolver cartas da mão ao deck.

import { nextRandom, shuffleInPlace } from '../../rng';
import type { EffectStep, GameState, PlayerState } from '../../types';
import type { EffectFrame } from '../constants';
import { DECK_TOP_BOTTOM, lg, log, pr, promptOf } from '../messages';
import { opponentOf } from '../table';
import { cardDef } from '../queries';
import { discardable, restricted, targetCandidates } from '../options';
import { emit } from '../triggers';
import { askCards, askOption, markHandTrashed } from '../effects';
import { drawCards, removeFrom } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type HandStep = Extract<EffectStep, {
  do:
    | 'draw' | 'trashFromHand' | 'opponentDiscards' | 'trashRandomFromOpponentHand' | 'revealFromHand' | 'drawPerMatching'
    | 'trashEventCount' | 'opponentPicksFromHand' | 'revealOpponentHand' | 'handAllToDeck' | 'opponentDraws' | 'trashHand'
    | 'trashHandUntil' | 'drawEventCount' | 'handToDeck' | 'opponentHandToBottom' | 'handToDeckBottom' | 'drawUntil';
}>;

export function execHandStep(state: GameState, frame: EffectFrame, step: HandStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'draw': {
      if (restricted(state, frame.controller, 'noDrawByEffect')) return true;
      if (!step.upTo) {
        drawCards(state, frame.controller, step.count);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${step.count} carta(s).`, { player: ps.name, n: step.count }));
        emit(state, { kind: 'drawByEffect', player: frame.controller });
        return true;
      }
      // "Draw up to N cards" (4-5-4): uma por vez; antes de cada uma o jogador pode parar
      // (memo[0] = quantas já comprou). O oponente vê só a pergunta, sem o texto.
      let drawn = Number(frame.memo?.[0] ?? 0);
      let stop = false;
      if (frame.choice) {
        if (frame.choice[0] === 'yes') {
          drawCards(state, frame.controller, 1);
          drawn++;
        } else stop = true;
        frame.choice = undefined;
      }
      if (!stop && drawn < step.count && ps.deck.length) {
        frame.memo = [String(drawn)];
        state.pending = {
          kind: 'confirm',
          player: frame.controller,
          source: frame.source,
          ...promptOf(pr(drawn ? 'drawUpToMore' : 'drawUpToFirst', `${srcName}: comprar ${drawn ? 'mais ' : ''}1 carta? (${drawn} de até ${step.count})`, { source: srcName, drawn, max: step.count })),
          drawUpTo: true,
        };
        return false;
      }
      frame.memo = undefined;
      log(
        state,
        frame.controller,
        drawn ? lg('draws', `${ps.name} compra ${drawn} carta(s).`, { player: ps.name, n: drawn }) : lg('drawsNone', `${ps.name} não compra cartas.`, { player: ps.name }),
      );
      if (drawn) emit(state, { kind: 'drawByEffect', player: frame.controller });
      return true;
    }
    case 'trashFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      // Mão vazia é público; "nenhuma carta da mão serve" (filtro) não é: a escolha abre mesmo assim.
      if (n === 0 && (!ps.hand.length || frame.choice)) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseHandCardsToTrash', `${srcName}: escolha ${n} carta(s) da mão para descartar.`, { source: srcName, n }), {
          min: step.upTo ? 0 : n,
          intent: 'discard',
          hidden: 'da mão',
        });
        return false;
      }
      const trashed = frame.choice.filter((u) => options.includes(u));
      for (const uid of trashed) {
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        log(state, frame.controller, lg('trashesCard', `${ps.name} descarta ${cardDef(state, uid).name}.`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      frame.eventCount = trashed.length;
      frame.trashed = trashed;
      if (trashed.length) {
        markHandTrashed(state, frame.controller);
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: trashed.length });
      }
      return true;
    }
    case 'opponentDiscards': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          ...promptOf(pr('chooseOwnHandCardsToTrash', `${srcName}: escolha ${n} carta(s) da sua mão para descartar.`, { source: srcName, n })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        markHandTrashed(state, opp.id);
        log(state, opp.id, lg('trashesCard', `${opp.name} descarta ${cardDef(state, uid).name}.`, { player: opp.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'trashRandomFromOpponentHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      for (let i = 0; i < step.count && opp.hand.length; i++) {
        const uid = opp.hand[Math.floor(nextRandom(state) * opp.hand.length)];
        removeFrom(opp.hand, uid);
        opp.trash.push(uid);
        markHandTrashed(state, opp.id);
        log(state, frame.controller, lg('trashesRandom', `${opp.name} descarta ${cardDef(state, uid).name} (escolhida ao acaso).`, { player: opp.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'revealFromHand': {
      const options = discardable(state, frame.controller, step.filter);
      const n = Math.min(step.count, options.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, options, n, pr('chooseHandCardsToReveal', `${srcName}: escolha ${n} carta(s) da mão para revelar.`, { source: srcName, n }), { min: n });
        return false;
      }
      log(state, frame.controller, lg('reveals', `${ps.name} revela ${frame.choice.map((u) => cardDef(state, u).name).join(', ')}.`, { player: ps.name, cards: frame.choice.map((u) => cardDef(state, u).name).join(', ') }), { uids: frame.choice, by: ps.id });
      frame.last = frame.choice.filter((u) => options.includes(u));
      return true;
    }
    case 'drawPerMatching': {
      const n = targetCandidates(state, frame.controller, frame.source, step.spec).length;
      frame.eventCount = 0;
      if (!n || restricted(state, frame.controller, 'noDrawByEffect')) return true;
      const before = ps.hand.length;
      drawCards(state, frame.controller, n);
      frame.eventCount = ps.hand.length - before;
      log(state, frame.controller, lg('draws', `${ps.name} compra ${frame.eventCount} carta(s).`, { player: ps.name, n: frame.eventCount }));
      emit(state, { kind: 'drawByEffect', player: frame.controller });
      return true;
    }
    case 'trashEventCount': {
      const n = frame.eventCount ?? 0;
      if (!n) return true;
      if (step.from === 'deck') {
        const k = Math.min(n, ps.deck.length);
        ps.trash.push(...ps.deck.splice(0, k));
        if (k) log(state, frame.controller, lg('millsDeck', `${ps.name} descarta ${k} carta(s) do topo do deck.`, { player: ps.name, n: k }));
        return true;
      }
      frame.steps.splice(frame.i + 1, 0, { do: 'trashFromHand', count: n });
      return true;
    }
    case 'opponentPicksFromHand': {
      // O oponente escolhe com as cartas viradas para baixo: equivale a uma escolha ao acaso.
      const n = Math.min(step.count, ps.hand.length);
      for (let k = 0; k < n; k++) {
        const uid = ps.hand[Math.floor(nextRandom(state) * ps.hand.length)];
        removeFrom(ps.hand, uid);
        ps.trash.push(uid);
        markHandTrashed(state, ps.id);
        log(state, frame.controller, lg('trashesChosenByOpponent', `${ps.name} descarta ${cardDef(state, uid).name} (escolhida pelo oponente).`, { player: ps.name, card: cardDef(state, uid).name }), { cards: [uid] });
      }
      return true;
    }
    case 'revealOpponentHand': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const picked: string[] = [];
      const pool = [...opp.hand];
      for (let k = 0; k < step.count && pool.length; k++) picked.push(pool.splice(Math.floor(nextRandom(state) * pool.length), 1)[0]);
      frame.last = picked;
      frame.revealed = picked;
      if (step.vs !== undefined) frame.lastOf = { cards: { ...frame.lastOf?.cards, [opp.id]: picked }, tail: picked };
      if (picked.length) log(state, frame.controller, lg('reveals', `${opp.name} revela ${picked.map((u) => cardDef(state, u).name).join(', ')}.`, { player: opp.name, cards: picked.map((u) => cardDef(state, u).name).join(', ') }), { uids: picked });
      return true;
    }
    case 'handAllToDeck': {
      const who = step.who === 'self' ? ps : state.players[opponentOf(state, frame.controller)];
      const n = who.hand.length;
      who.deck.push(...who.hand.splice(0));
      frame.eventCount = n;
      // "at the bottom of your deck in any order": vão para o fundo na ordem da mão, sem embaralhar
      // (como o "place the rest at the bottom of your deck in any order" das buscas).
      if (step.bottom) {
        log(state, frame.controller, lg('handToBottom', `${who.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: who.name, n }));
        return true;
      }
      shuffleInPlace(state, who.deck);
      log(state, frame.controller, lg('handToDeckShuffle', `${who.name} devolve ${n} carta(s) da mão ao deck e embaralha.`, { player: who.name, n }));
      return true;
    }
    case 'opponentDraws': {
      const o = state.players[opponentOf(state, frame.controller)];
      drawCards(state, o.id, step.count);
      log(state, frame.controller, lg('draws', `${o.name} compra ${step.count} carta(s).`, { player: o.name, n: step.count }));
      return true;
    }
    case 'trashHand': {
      const n = ps.hand.length;
      ps.trash.push(...ps.hand.splice(0));
      if (n) {
        markHandTrashed(state, ps.id);
        log(state, frame.controller, lg('trashesWholeHand', `${ps.name} descarta toda a mão (${n} carta(s)).`, { player: ps.name, n }));
        emit(state, { kind: 'handTrashedByEffect', player: frame.controller, card: frame.source, count: n });
      }
      return true;
    }
    case 'trashHandUntil': {
      const who = step.both ? [frame.controller, opponentOf(state, frame.controller)] : [frame.controller];
      const memo = frame.memo ?? [];
      // Um jogador por vez: memo guarda quem já descartou.
      const next = who.find((p) => !memo.includes(String(p)) && state.players[p].hand.length > step.count);
      if (next === undefined) return true;
      const pl = state.players[next];
      if (!frame.choice) {
        const n = pl.hand.length - step.count;
        state.pending = {
          kind: 'selectTargets',
          player: next,
          options: [...pl.hand],
          min: n,
          max: n,
          ...promptOf(pr('trashHandUntil', `${srcName}: descarte ${n} carta(s) até ficar com ${step.count} na mão.`, { source: srcName, n, max: step.count })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      const trashed = frame.choice.filter((u) => pl.hand.includes(u)).slice(0, pl.hand.length - step.count);
      for (const uid of trashed) {
        removeFrom(pl.hand, uid);
        pl.trash.push(uid);
      }
      log(state, next, lg('trashesCards', `${pl.name} descarta ${trashed.length} carta(s).`, { player: pl.name, n: trashed.length }));
      if (trashed.length) markHandTrashed(state, next);
      if (trashed.length && next === frame.controller) emit(state, { kind: 'handTrashedByEffect', player: next, card: frame.source, count: trashed.length });
      frame.memo = [...memo, String(next)];
      frame.choice = undefined;
      return !who.some((p) => !frame.memo!.includes(String(p)) && state.players[p].hand.length > step.count);
    }
    case 'drawEventCount': {
      const n = frame.eventCount ?? 0;
      if (n && !restricted(state, frame.controller, 'noDrawByEffect')) {
        drawCards(state, frame.controller, n);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${n} carta(s).`, { player: ps.name, n }));
      }
      return true;
    }
    case 'handToDeck': {
      if (!frame.memo) {
        const n = Math.min(step.count, ps.hand.length);
        if (!n) return true;
        if (!frame.choice) {
          askCards(state, frame, [...ps.hand], n, pr('chooseHandCardsToDeck', `${srcName}: escolha ${n} carta(s) da mão para colocar no deck.`, { source: srcName, n }), { min: n, intent: 'discard' });
          return false;
        }
        frame.memo = frame.choice.filter((u) => ps.hand.includes(u)).slice(0, n);
        frame.choice = undefined;
      }
      let where = step.where;
      if (where === 'choose') {
        if (!frame.choice) {
          askOption(state, frame, frame.controller, pr('deckTopOrBottom', `${srcName}: colocar no topo ou no fundo do deck?`, { source: srcName }), ['Topo do deck', 'Fundo do deck'], DECK_TOP_BOTTOM);
          return false;
        }
        where = frame.choice[0] === '0' ? 'top' : 'bottom';
      }
      for (const uid of frame.memo) {
        removeFrom(ps.hand, uid);
        if (where === 'top') ps.deck.unshift(uid);
        else ps.deck.push(uid);
      }
      log(
        state,
        frame.controller,
        lg(where === 'top' ? 'handToDeckTop' : 'handToBottom', `${ps.name} coloca ${frame.memo.length} carta(s) da mão no ${where === 'top' ? 'topo' : 'fundo'} do deck.`, {
          player: ps.name,
          n: frame.memo.length,
        }),
      );
      frame.memo = undefined;
      return true;
    }
    case 'opponentHandToBottom': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        state.pending = {
          kind: 'selectTargets',
          player: opp.id,
          options: [...opp.hand],
          min: n,
          max: n,
          ...promptOf(pr('chooseOwnHandCardsToBottom', `${srcName}: escolha ${n} carta(s) da sua mão para o fundo do deck.`, { source: srcName, n })),
          intent: 'discard',
          source: frame.source,
        };
        return false;
      }
      for (const uid of frame.choice.filter((u) => opp.hand.includes(u))) {
        removeFrom(opp.hand, uid);
        opp.deck.push(uid);
      }
      log(state, opp.id, lg('handToBottom', `${opp.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: opp.name, n }));
      return true;
    }
    case 'handToDeckBottom': {
      const n = Math.min(step.count, ps.hand.length);
      if (n === 0) return true;
      if (!frame.choice) {
        askCards(state, frame, [...ps.hand], n, pr('chooseHandCardsToBottom', `${srcName}: escolha ${n} carta(s) da mão para o fundo do deck.`, { source: srcName, n }), {
          min: n,
          intent: 'discard',
        });
        return false;
      }
      for (const uid of frame.choice.filter((u) => ps.hand.includes(u))) {
        removeFrom(ps.hand, uid);
        ps.deck.push(uid);
      }
      log(state, frame.controller, lg('handToBottom', `${ps.name} coloca ${n} carta(s) da mão no fundo do deck.`, { player: ps.name, n }));
      return true;
    }
    case 'drawUntil': {
      const n = Math.max(0, step.count - ps.hand.length);
      if (n) {
        drawCards(state, frame.controller, n);
        log(state, frame.controller, lg('draws', `${ps.name} compra ${n} carta(s).`, { player: ps.name, n }));
      }
      return true;
    }
  }
}
