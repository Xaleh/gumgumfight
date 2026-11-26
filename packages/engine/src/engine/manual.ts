// Ferramentas manuais (efeitos ainda não automatizados).

import { shuffleInPlace } from '../rng';
import type { GameState, ManualOp, PlayerId } from '../types';
import { IllegalActionError, MAX_CHARACTERS } from './constants';
import { lg, log, logSecret } from './messages';
import { cardDef, locate, ownerOf } from './queries';
import { forgetCard, isIdle } from './options';
import { lockDon } from './apply';
import { pushAbilities } from './triggers';
import { koCharacter } from './removal';
import { detach, drawCards, returnDonAndEmit, zoneOf } from './zones';

/**
 * Quando o jogador pode usar as ferramentas manuais: ao resolver um efeito manual,
 * na etapa de Counter (efeitos contínuos do defensor) e livremente no próprio turno.
 */
export function manualAllowed(state: GameState, player: PlayerId): boolean {
  if (state.phase !== 'main') return false;
  const pending = state.pending;
  if (pending) return (pending.kind === 'manual' || pending.kind === 'counter') && pending.player === player;
  return isIdle(state) && state.activePlayer === player;
}

const ZONE_LABEL: Record<string, string> = {
  hand: 'a mão',
  trash: 'o descarte',
  deckTop: 'o topo do deck',
  deckBottom: 'o fundo do deck',
  life: 'a Vida',
  character: 'o campo',
  stage: 'o campo (Stage)',
};
const ZONE_FROM = { deck: 'do deck', hand: 'da mão', life: 'da Vida' } as const;

export function applyManualOp(state: GameState, p: PlayerId, op: ManualOp) {
  const ps = state.players[p];
  const tag = '(manual)';
  lockDon(ps);
  const fieldCard = (uid: string) => {
    const loc = locate(state, uid);
    if (!loc) throw new IllegalActionError('A carta precisa estar em campo.');
    return loc;
  };

  switch (op.op) {
    case 'draw': {
      const n = Math.max(1, Math.min(10, Math.floor(op.count)));
      drawCards(state, p, n);
      log(state, p, lg('manualDraw', `${tag} ${ps.name} compra ${n} carta(s).`, { player: ps.name, n }));
      return;
    }
    case 'move': {
      if (!state.cards[op.uid]) throw new IllegalActionError('Carta inválida.');
      const owner = ownerOf(state, op.uid);
      const from = zoneOf(state, op.uid);
      const def = cardDef(state, op.uid);
      if (!from || from === 'leader') throw new IllegalActionError('Essa carta não pode ser movida.');
      if (owner !== p && !['character', 'stage', 'life'].includes(from)) {
        throw new IllegalActionError('Do oponente, só é possível mover cartas em campo ou da Vida.');
      }
      const os = state.players[owner];
      // Na etapa de Counter, uma carta da mão só sai como Counter (vai para o descarte):
      // jogá-la no campo ativaria o [Ao Jogar] no meio do ataque.
      if (state.pending?.kind === 'counter' && from === 'hand' && (op.to === 'character' || op.to === 'stage')) {
        throw new IllegalActionError('Na etapa de Counter, use a carta como Counter (ela vai para o descarte), não a jogue no campo.');
      }
      if (op.to === 'character') {
        if (def.category !== 'character') throw new IllegalActionError('Só Personagens vão para a área de personagens.');
        if (from !== 'character' && os.characters.length >= MAX_CHARACTERS) {
          throw new IllegalActionError('Área de personagens cheia: descarte um antes.');
        }
      }
      if (op.to === 'stage' && def.category !== 'stage') throw new IllegalActionError('Só Stages vão para a área de Stage.');
      detach(state, op.uid);
      switch (op.to) {
        case 'hand':
          os.hand.push(op.uid);
          break;
        case 'trash':
          os.trash.push(op.uid);
          break;
        case 'deckTop':
          os.deck.unshift(op.uid);
          break;
        case 'deckBottom':
          os.deck.push(op.uid);
          break;
        case 'life':
          os.life.push(op.uid);
          break;
        case 'character':
          forgetCard(state, op.uid);
          os.characters.push({ uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn });
          break;
        case 'stage':
          if (os.stage) {
            const old = os.stage.uid;
            detach(state, old);
            os.trash.push(old);
          }
          forgetCard(state, op.uid);
          os.stage = { uid: op.uid, rested: Boolean(op.rested), don: 0, playedOnTurn: state.turn };
          break;
      }
      // De uma zona escondida para outra: o oponente só fica sabendo que "uma carta" se moveu.
      const hiddenMove = ['deck', 'hand', 'life'].includes(from) && ['hand', 'deckTop', 'deckBottom', 'life'].includes(op.to);
      const of = owner !== p;
      const where = `vai para ${ZONE_LABEL[op.to]}${of ? ` de ${os.name}` : ''}.`;
      // A zona de destino é uma parte traduzível (`log.zone.*`); "de X" quando a carta é do oponente.
      const zone = { zone: { items: [{ key: `log.zone.${op.to}` }] } };
      const base = { zone: ZONE_LABEL[op.to], ...(of ? { player: os.name } : {}) };
      const shown = lg(of ? 'manualMoveOf' : 'manualMove', `${tag} ${def.name} ${where}`, { card: def.name, ...base }, zone);
      if (!hiddenMove) log(state, p, shown, { cards: [op.uid] });
      else if (of) log(state, p, lg('manualMoveHiddenOf', `${tag} Uma carta ${where}`, base, zone));
      else {
        const src = from as 'deck' | 'hand' | 'life';
        const fromKey = src === 'deck' ? 'manualMoveFromDeck' : src === 'hand' ? 'manualMoveFromHand' : 'manualMoveFromLife';
        logSecret(state, p, lg(fromKey, `${tag} Uma carta (${ZONE_FROM[src]}) ${where}`, base, zone), shown, [op.uid]);
      }
      if (op.to === 'character' || op.to === 'stage') pushAbilities(state, op.uid, 'onPlay');
      return;
    }
    case 'ko': {
      const loc = fieldCard(op.uid);
      if (loc.zone !== 'character') throw new IllegalActionError('Só Personagens podem ser nocauteados.');
      log(state, p, lg('manualKo', `${tag} K.O. em ${cardDef(state, op.uid).name}.`, { card: cardDef(state, op.uid).name }), { cards: [op.uid] });
      koCharacter(state, op.uid, { force: true });
      return;
    }
    case 'setRested': {
      const loc = fieldCard(op.uid);
      loc.fc.rested = op.rested;
      log(state, p, lg(op.rested ? 'manualRest' : 'manualSetActive', `${tag} ${cardDef(state, op.uid).name} fica ${op.rested ? 'virado' : 'ativo'}.`, { card: cardDef(state, op.uid).name }), { cards: [op.uid] });
      return;
    }
    case 'power': {
      fieldCard(op.uid);
      const duration = op.duration === 'battle' && !state.battle ? 'turn' : op.duration;
      state.modifiers.push({ uid: op.uid, kind: 'power', amount: op.amount, duration });
      const amount = `${op.amount > 0 ? '+' : ''}${op.amount}`;
      log(state, p, lg('manualPower', `${tag} ${cardDef(state, op.uid).name}: ${amount} de poder.`, { card: cardDef(state, op.uid).name, amount }), { cards: [op.uid] });
      return;
    }
    case 'donFromDeck': {
      const n = Math.min(Math.max(1, op.count), ps.donDeck);
      ps.donDeck -= n;
      if (op.rested) ps.donRested += n;
      else ps.donActive += n;
      log(state, p, lg(op.rested ? 'manualDonFromDeckRested' : 'manualDonFromDeck', `${tag} +${n} DON!! ${op.rested ? 'virado' : 'ativo'}.`, { n }));
      return;
    }
    case 'donToDeck': {
      returnDonAndEmit(state, ps, Math.max(1, op.count));
      log(state, p, lg('manualDonToDeck', `${tag} DON!! −${op.count}.`, { n: op.count }));
      return;
    }
    case 'donGive': {
      const loc = fieldCard(op.uid);
      if (loc.player !== p || loc.zone === 'stage') throw new IllegalActionError('Escolha seu Líder ou um Personagem seu.');
      if (op.from === 'active' ? ps.donActive < 1 : ps.donRested < 1) throw new IllegalActionError('Sem DON!! disponível.');
      if (op.from === 'active') ps.donActive--;
      else ps.donRested--;
      loc.fc.don++;
      log(
        state,
        p,
        lg(op.from === 'active' ? 'manualGiveActiveDon' : 'manualGiveRestedDon', `${tag} ${cardDef(state, op.uid).name} recebe 1 DON!! ${op.from === 'active' ? 'ativo' : 'virado'}.`, {
          card: cardDef(state, op.uid).name,
        }),
        { cards: [op.uid] },
      );
      return;
    }
    case 'donSetState': {
      const target = state.players[op.player];
      const n = Math.min(Math.max(1, op.count), op.rested ? target.donActive : target.donRested);
      if (op.rested) {
        target.donActive -= n;
        target.donRested += n;
      } else {
        target.donRested -= n;
        target.donActive += n;
      }
      log(state, p, lg(op.rested ? 'manualDonRest' : 'manualDonSetActive', `${tag} ${n} DON!! de ${target.name} fica ${op.rested ? 'virado' : 'ativo'}.`, { n, player: target.name }));
      return;
    }
    case 'shuffle':
      shuffleInPlace(state, ps.deck);
      log(state, p, lg('manualShuffle', `${tag} ${ps.name} embaralha o deck.`, { player: ps.name }));
      return;
    case 'peek': {
      const n = Math.min(Math.max(1, Math.floor(op.count) || 1), ps.deck.length);
      log(state, p, lg('manualPeek', `${tag} ${ps.name} olha ${n} carta(s) do topo do deck.`, { player: ps.name, n }));
      return;
    }
  }
}
