// Passos de efeito sobre os DON!!: dar, anexar, mover, virar, desvirar, pegar do deck de DON!! e devolver.

import type { DonSource, EffectStep, GameState, MsgList, PlayerId, PlayerState, TargetSpec } from '../../types';
import type { EffectFrame } from '../constants';
import { lg, log, msgOf, pr, promptOf } from '../messages';
import { fixedOpponent, isMultiplayer, opponentOf, opponentSides, opponentsOf } from '../table';
import { cardDef, locate, ownerOf } from '../queries';
import { restricted, targetCandidates, totalDonOnField } from '../options';
import { emit } from '../triggers';
import { addModifier, askCards, askOption, donTargetOpponent, resolveTargets, upToCount } from '../effects';
import { describeDonSource, donSources, restCard, summarizeDonSources, takeDon } from '../zones';

/** Os passos desta família (`execStep`, em ../exec-step.ts, manda cada um para cá). */
export type DonStep = Extract<EffectStep, {
  do:
    | 'giveRestedDon' | 'addDonFromDeck' | 'restOpponentDon' | 'setDonActive' | 'returnDonChoice' | 'returnDon' | 'restDonOrCharacter'
    | 'giveActiveDon' | 'moveGivenDon' | 'opponentAddDon' | 'donMatchOpponent' | 'returnGivenDon' | 'opponentReturnsDon';
}>;

export function execDonStep(state: GameState, frame: EffectFrame, step: DonStep, ps: PlayerState, srcName: string): boolean {
  switch (step.do) {
    case 'giveRestedDon': {
      // O oponente só entra quando o DON!! sai da área de custo dele (ou do dono da carta escolhida).
      const multi = isMultiplayer(state) && (step.fromOpponent || step.fromOwner) && fixedOpponent(state, frame.controller) === undefined;
      const poolOf = (g: PlayerState) => g.donRested + (step.anyState ? g.donActive : 0);
      // Mesa com mais de dois: o alvo pode ser de qualquer oponente e o DON!! sai de quem o controla; "o
      // oponente", nas contas de antes da escolha, é quem tem mais DON!! para dar.
      const opp =
        step.fromOpponent || step.fromOwner
          ? multi
            ? opponentsOf(state, frame.controller).map((o) => state.players[o]).reduce((a, x) => (poolOf(x) > poolOf(a) ? x : a))
            : state.players[opponentOf(state, frame.controller)]
          : ps;
      // "from its owner's cost area" (OP15-023): o DON!! sai da área de custo do dono da carta escolhida.
      const giverOf = (uid: string): PlayerState =>
        step.fromOwner || (multi && ownerOf(state, uid) !== frame.controller) ? state.players[ownerOf(state, uid)] : step.fromOpponent ? opp : ps;
      const prompt = step.anyState ? 'DON!!' : 'DON!! virado(s)';
      const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
      let t: string[];
      let qty = step.count;
      /** Quantos dos DON!! dados saem virados (o resto, ativos); só com `anyState` e os dois estados disponíveis. */
      let fromRested: number | undefined;
      const stage = frame.memo?.[0];
      if (frame.memo && (stage === 'qty' || stage?.startsWith('state:'))) {
        t = frame.memo.slice(1);
        if (stage === 'qty') {
          qty = Math.min(step.count, poolOf(giverOf(t[0]))) - Number(frame.choice?.[0] ?? 0);
        } else {
          qty = Number(stage.slice('state:'.length));
          const g = giverOf(t[0]);
          fromRested = Math.min(qty, g.donRested) - Number(frame.choice?.[0] ?? 0);
        }
        frame.choice = undefined;
        frame.memo = undefined;
      } else {
        let spec = step.target;
        if (step.fromOwner && typeof spec === 'object') {
          // Só quem tem DON!! na área de custo pode receber; sem DON!! de nenhum lado, nada acontece.
          const sides = (['own', 'opponent'] as const).filter((side) => poolOf(side === 'own' ? ps : opp) > 0);
          if (!sides.length) return true;
          if (sides.length === 1) spec = { ...spec, side: sides[0] };
        } else if (poolOf(step.fromOpponent ? opp : ps) === 0) return true;
        const chosen = resolveTargets(
          state,
          frame,
          spec,
          step.fromOpponent ? 'harm' : 'help',
          pr(step.anyState ? 'chooseDonReceiver' : 'chooseRestedDonReceiver', `${srcName}: escolha quem recebe ${prompt}.`, { source: srcName, n: step.count }),
        );
        if (!chosen) return false;
        t = chosen;
        // "Give up to 2 rested DON!! cards to …" (OP05-008): com um alvo só, o jogador escolhe quantos (do máximo para 1).
        const max = t.length ? Math.min(step.count, poolOf(giverOf(t[0]))) : 0;
        if (t.length === 1 && max > 1) {
          frame.memo = ['qty', ...t];
          askOption(
            state,
            frame,
            frame.controller,
            pr('howManyDonToGive', `${srcName}: quantos DON!! dar a ${cardDef(state, t[0]).name}?`, { source: srcName, target: cardDef(state, t[0]).name }),
            Array.from({ length: max }, (_, i) => String(max - i)),
          );
          return false;
        }
      }
      // Virado ou ativo ("from its owner's cost area" aceita DON!! ativo, Q&A OP15): quem ativa escolhe
      // quantos saem virados, do máximo de virados para o mínimo.
      if (step.anyState && fromRested === undefined && t.length === 1) {
        const g = giverOf(t[0]);
        const n = Math.min(qty, poolOf(g));
        const kMax = Math.min(n, g.donRested);
        const kMin = Math.max(0, n - g.donActive);
        if (kMax > kMin) {
          const label = (k: number) =>
            n === 1 ? (k ? 'DON!! virado' : 'DON!! ativo') : `${k} ${pl(k, 'virado', 'virados')} e ${n - k} ${pl(n - k, 'ativo', 'ativos')}`;
          frame.memo = [`state:${qty}`, ...t];
          // Com 1 DON!!, as opções são fixas (virado/ativo); com mais, cada opção traz dois números e fica como está.
          askOption(
            state,
            frame,
            frame.controller,
            pr(
              n === 1 ? 'giveDonRestedOrActive' : 'giveDonHowManyRested',
              `${srcName}: dar ${n === 1 ? 'um DON!! virado ou ativo' : 'quantos DON!! virados (o resto ativos)'} de ${g.name} a ${cardDef(state, t[0]).name}?`,
              { source: srcName, owner: g.name, target: cardDef(state, t[0]).name },
            ),
            Array.from({ length: kMax - kMin + 1 }, (_, i) => label(kMax - i)),
            n === 1 ? Array.from({ length: kMax - kMin + 1 }, (_, i) => (kMax - i ? 'engine.optRestedDon' : 'engine.optActiveDon')) : undefined,
          );
          return false;
        }
      }
      for (const uid of t) {
        const loc = locate(state, uid);
        const giver = giverOf(uid);
        const n = Math.min(qty, poolOf(giver));
        if (loc && n > 0) {
          const rested = fromRested === undefined ? Math.min(n, giver.donRested) : Math.min(fromRested, giver.donRested, n);
          giver.donRested -= rested;
          giver.donActive -= n - rested;
          loc.fc.don += n;
          emit(state, { kind: 'donGiven', player: loc.player, card: uid });
          const state_ = step.anyState ? ` (${rested} ${pl(rested, 'virado', 'virados')}, ${n - rested} ${pl(n - rested, 'ativo', 'ativos')})` : '';
          const text = `${cardDef(state, uid).name} recebe ${n} DON!!${state_} da área de custo de ${giver.name}.`;
          const params = { card: cardDef(state, uid).name, n, player: giver.name };
          log(state, frame.controller, step.anyState ? lg('receivesDonMixed', text, { ...params, rested, active: n - rested }) : lg('receivesDon', text, params));
        }
      }
      return true;
    }
    case 'addDonFromDeck': {
      const n = Math.min(step.count, ps.donDeck);
      ps.donDeck -= n;
      if (step.rested) ps.donRested += n;
      else ps.donActive += n;
      return true;
    }
    case 'restOpponentDon': {
      if (isMultiplayer(state) && fixedOpponent(state, frame.controller) === undefined) {
        // "Rest up to N of your opponent's DON!! cards": cada DON!! é um alvo, de qualquer oponente.
        const done = Number(frame.choice ? (frame.memo?.[frame.memo.length - 1] ?? 0) : (frame.memo?.[0] === 'restN' ? frame.memo[1] : 0));
        let left = step.count - done;
        let n = done;
        while (left > 0) {
          const id = donTargetOpponent(
            state,
            frame,
            opponentSides(state, frame.controller).filter((o) => state.players[o].donActive > 0),
            pr('whoseDonToRest', `${srcName}: virar 1 DON!! ativo de qual oponente?`, { source: srcName }),
          );
          if (id === undefined) {
            // Guarda quantos já foram virados no fim da memória da pergunta.
            frame.memo!.push(String(n));
            return false;
          }
          if (id === null) break;
          const o = state.players[id];
          o.donActive--;
          o.donRested++;
          log(state, frame.controller, lg('donRested', `1 DON!! de ${o.name} é virado.`, { n: 1, player: o.name }));
          n++;
          left--;
        }
        return true;
      }
      const o = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, o.donActive);
      o.donActive -= n;
      o.donRested += n;
      if (n) log(state, frame.controller, lg('donRested', `${n} DON!! de ${o.name} é virado.`, { n, player: o.name }));
      return true;
    }
    case 'setDonActive': {
      if (restricted(state, frame.controller, 'noSetDonActiveByCharacter') && cardDef(state, frame.source).category === 'character') return true;
      const n = upToCount(state, frame, step, ps.donRested, pr('howManyDonToSetActive', `${srcName}: quantos DON!! deixar ativos?`, { source: srcName }));
      if (n === null) return false;
      ps.donRested -= n;
      ps.donActive += n;
      if (n) log(state, frame.controller, lg('donSetActive', `${n} DON!! de ${ps.name} fica(m) ativo(s).`, { n, player: ps.name }));
      return true;
    }
    case 'returnDonChoice': {
      const max = totalDonOnField(ps);
      if (max > step.min && !frame.choice) {
        askOption(
          state,
          frame,
          frame.controller,
          pr('howManyDonToReturn', `${srcName}: quantos DON!! devolver ao deck de DON!!?`, { source: srcName }),
          Array.from({ length: max - step.min + 1 }, (_, i) => `${step.min + i} DON!!`),
        );
        return false;
      }
      const n = Math.min(max, step.min + (frame.choice ? Number(frame.choice[0]) : 0));
      frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: n });
      return true;
    }
    case 'returnDon': {
      const owner = step.opponent ? state.players[opponentOf(state, frame.controller)] : ps;
      const picked = (frame.memo ?? []) as DonSource[];
      if (frame.choice) {
        const src = donSources(owner)[Number(frame.choice[0])];
        if (src) {
          takeDon(owner, src);
          picked.push(src);
        }
        frame.choice = undefined;
      }
      while (picked.length < step.count) {
        // "return N of your active DON!! cards": só os ativos da área de custo (sem escolha).
        const sources = step.activeOnly ? (owner.donActive ? (['active'] as DonSource[]) : []) : donSources(owner);
        if (!sources.length) break;
        // Só pergunta quando a escolha muda alguma coisa: há mais de uma origem e sobra DON!! no campo.
        if (sources.length > 1 && totalDonOnField(owner) > step.count - picked.length) {
          frame.memo = picked;
          state.pending = {
            kind: 'option',
            player: owner.id,
            source: frame.source,
            ...promptOf(
              pr('chooseDonToReturn', `${srcName}: escolha o ${picked.length + 1}º de ${step.count} DON!! a devolver ao deck de DON!!.`, {
                source: srcName,
                index: picked.length + 1,
                count: step.count,
              }),
            ),
            // As opções trazem contagens e nomes de carta; a interface as monta por `don`.
            options: sources.map((src) => describeDonSource(state, owner, src)),
            don: sources,
          };
          return false;
        }
        takeDon(owner, sources[0]);
        picked.push(sources[0]);
      }
      if (picked.length) {
        emit(state, { kind: 'donReturned', player: owner.id, count: picked.length, byPlayer: frame.controller });
        const from = summarizeDonSources(state, picked);
        log(
          state,
          frame.controller,
          lg(
            'returnsDon',
            `${owner.name} devolve ${picked.length} DON!! ao deck de DON!! (${from.map((p) => p.text).join(', ')}).`,
            { player: owner.name, n: picked.length, from: from.map((p) => p.text).join(', ') },
            { from: { items: from.map(msgOf), join: 'log.listComma' } },
          ),
        );
      }
      return true;
    }
    case 'restDonOrCharacter': {
      const skip = Boolean(step.skipRefresh);
      // skipRefresh: só cartas viradas que ainda não vão ficar viradas; DON!! virados que ainda não vão ficar.
      const skippedDon = (id: PlayerId) => (state.donSkipRefresh ?? []).filter((d) => d.player === id).reduce((n, d) => n + d.count, 0);
      const hasDon = (id: PlayerId) => (skip ? state.players[id].donRested > skippedDon(id) : state.players[id].donActive > 0);
      // Mesa com mais de dois: "1 of your opponent's DON!! cards or Characters" é um alvo de qualquer oponente;
      // cada oponente com DON!! que sirva vira uma opção.
      const many = isMultiplayer(state) && fixedOpponent(state, frame.controller) === undefined;
      const donOwners = (many ? opponentSides(state, frame.controller) : [opponentOf(state, frame.controller)]).filter(hasDon);
      const opp = state.players[donOwners[0] ?? opponentOf(state, frame.controller)];
      const donAvailable = donOwners.length > 0;
      const spec: TargetSpec = { ...step.spec, side: 'opponent', upTo: 1 };
      const chars = targetCandidates(state, frame.controller, frame.source, spec).filter((u) =>
        skip ? !state.modifiers.some((m) => m.uid === u && m.kind === 'skipRefresh') : !locate(state, u)?.fc.rested,
      );
      const onlyChars = spec.kinds.every((k) => k === 'character');
      const cardLabel = onlyChars ? 'um Personagem do oponente' : 'uma carta do oponente (Líder, Personagem ou Stage)';
      if (!frame.memo && many && donOwners.length > 1) {
        if (!chars.length && !donAvailable) return true;
        // Uma opção de DON!! por oponente ("Virar 1 DON!! ativo de Fulano").
        const name = (id: PlayerId) => state.players[id].name;
        const donText = (id: PlayerId) => (skip ? `1 DON!! virado de ${name(id)}` : `Virar 1 DON!! ativo de ${name(id)}`);
        const donPart = (id: PlayerId): MsgList => ({ items: [{ key: skip ? 'engine.optSkipRefreshDonOf' : 'engine.optRestDonOf', params: { player: name(id) } }] });
        const charText = skip
          ? onlyChars
            ? 'Um Personagem virado do oponente'
            : 'Uma carta virada do oponente (Líder, Personagem ou Stage)'
          : `Virar ${cardLabel}`;
        const charKey = skip ? (onlyChars ? 'engine.optSkipRefreshCharacter' : 'engine.optSkipRefreshCard') : onlyChars ? 'engine.optRestOpponentCharacter' : 'engine.optRestOpponentCard';
        askOption(
          state,
          frame,
          frame.controller,
          skip
            ? pr('whatSkipsRefresh', `${srcName}: o que não desvira na próxima Renovação do oponente?`, { source: srcName })
            : pr('whatToRest', `${srcName}: o que virar?`, { source: srcName }),
          [...donOwners.map(donText), ...(chars.length ? [charText] : []), 'Nenhum'],
          [...donOwners.map(() => null), ...(chars.length ? [charKey] : []), 'engine.optNone'],
          [...donOwners.map(donPart), ...(chars.length ? [null] : []), null],
        );
        frame.memo = ['pick', ...donOwners.map((id) => `don:${id}`), ...(chars.length ? ['char'] : [])];
        return false;
      }
      if (!frame.memo) {
        if (!donAvailable && !chars.length) return true;
        if (!frame.choice) {
          const opts = skip
            ? [
                ...(donAvailable ? ['1 DON!! virado do oponente'] : []),
                ...(chars.length ? [onlyChars ? 'Um Personagem virado do oponente' : 'Uma carta virada do oponente (Líder, Personagem ou Stage)'] : []),
                'Nenhum',
              ]
            : [...(donAvailable ? ['Virar 1 DON!! ativo do oponente'] : []), ...(chars.length ? [`Virar ${cardLabel}`] : []), 'Nenhum'];
          const optKeys = skip
            ? [
                ...(donAvailable ? ['engine.optSkipRefreshDon'] : []),
                ...(chars.length ? [onlyChars ? 'engine.optSkipRefreshCharacter' : 'engine.optSkipRefreshCard'] : []),
                'engine.optNone',
              ]
            : [...(donAvailable ? ['engine.optRestOpponentDon'] : []), ...(chars.length ? [onlyChars ? 'engine.optRestOpponentCharacter' : 'engine.optRestOpponentCard'] : []), 'engine.optNone'];
          askOption(
            state,
            frame,
            frame.controller,
            skip
              ? pr('whatSkipsRefresh', `${srcName}: o que não desvira na próxima Renovação do oponente?`, { source: srcName })
              : pr('whatToRest', `${srcName}: o que virar?`, { source: srcName }),
            opts,
            optKeys,
          );
          frame.memo = ['pick', ...(donAvailable ? [many ? `don:${opp.id}` : 'don'] : []), ...(chars.length ? ['char'] : [])];
          return false;
        }
      }
      if (frame.memo?.[0] === 'pick') {
        const raw = frame.memo[1 + Number(frame.choice?.[0])];
        frame.choice = undefined;
        // 'don' (o único oponente) ou 'don:<lugar>' (mesa com mais de dois).
        const pick = raw?.startsWith('don:') ? 'don' : raw;
        const opp = raw?.startsWith('don:') ? state.players[Number(raw.slice(4))] : state.players[opponentOf(state, frame.controller)];
        if (pick === 'don') {
          if (skip) {
            (state.donSkipRefresh ??= []).push({ player: opp.id, count: 1 });
            log(state, frame.controller, lg('donSkipsRefresh', `1 DON!! de ${opp.name} não fica ativo na próxima Renovação.`, { n: 1, player: opp.name }));
          } else {
            opp.donActive--;
            opp.donRested++;
            log(state, frame.controller, lg('donRested', `1 DON!! de ${opp.name} é virado.`, { n: 1, player: opp.name }));
          }
          return true;
        }
        if (pick !== 'char') return true;
        frame.memo = ['char'];
      }
      if (skip) {
        const t = resolveTargets(state, frame, spec, 'harm', pr('chooseSkipRefreshCard', `${srcName}: escolha a carta que não desvira no próximo turno.`, { source: srcName }));
        if (!t) return false;
        for (const uid of t) addModifier(state, frame.controller, { uid, kind: 'skipRefresh', amount: 0, duration: 'nextOpponentTurn' });
        return true;
      }
      const t = resolveTargets(state, frame, spec, 'harm', pr(onlyChars ? 'chooseCharacterToRest' : 'chooseCardToRest', `${srcName}: escolha ${onlyChars ? 'o Personagem' : 'a carta'} a virar.`, { source: srcName }));
      if (!t) return false;
      // Virado por efeito: valem "cannot be rested by your opponent's effects", a substituição de rest e restedByEffect.
      for (const uid of t) restCard(state, uid, frame.controller, frame.source);
      return true;
    }
    case 'giveActiveDon': {
      const t = resolveTargets(state, frame, step.target, 'help', pr('chooseActiveDonReceiver', `${srcName}: escolha quem recebe DON!! ativo(s).`, { source: srcName, n: step.count }));
      if (!t) return false;
      for (const uid of t) {
        const loc = locate(state, uid);
        const n = Math.min(step.count, ps.donActive);
        if (loc && n) {
          ps.donActive -= n;
          loc.fc.don += n;
          emit(state, { kind: 'donGiven', player: loc.player, card: uid });
        }
      }
      return true;
    }
    case 'moveGivenDon': {
      // 1º: quem recebe; 2º: de quais cartas saem os DON!! anexados.
      if (!frame.memo) {
        const t = resolveTargets(state, frame, step.target, 'help', pr('chooseAttachedDonReceiver', `${srcName}: escolha quem recebe os DON!! anexados.`, { source: srcName }));
        if (!t) return false;
        if (!t.length) return true;
        frame.memo = [t[0]];
        frame.choice = undefined;
      }
      const dest = frame.memo[0];
      const sources = [ps.leader, ...ps.characters].filter((c) => c.uid !== dest && c.don > 0).map((c) => c.uid);
      if (!sources.length || !locate(state, dest)) return true;
      if (!frame.choice) {
        askCards(state, frame, sources, Math.min(step.count, sources.length), pr('chooseDonSources', `${srcName}: escolha de quais cartas saem os DON!! (até ${step.count} no total).`, { source: srcName, max: step.count }));
        return false;
      }
      let left = step.count;
      for (const uid of frame.choice.filter((u) => sources.includes(u))) {
        const from = locate(state, uid)!.fc;
        const share = frame.choice.length === 1 ? left : 1;
        const n = Math.min(share, from.don, left);
        from.don -= n;
        locate(state, dest)!.fc.don += n;
        left -= n;
      }
      if (left < step.count) {
        log(state, frame.controller, lg('receivesAttachedDon', `${cardDef(state, dest).name} recebe ${step.count - left} DON!! anexado(s).`, { card: cardDef(state, dest).name, n: step.count - left }), { cards: [dest] });
        emit(state, { kind: 'donGiven', player: frame.controller, card: dest });
      }
      return true;
    }
    case 'opponentAddDon': {
      const opp = state.players[opponentOf(state, frame.controller)];
      const n = Math.min(step.count, opp.donDeck);
      // "your opponent may add …": quem decide é o oponente.
      if (step.may && n > 0) {
        if (!frame.choice) {
          state.pending = {
            kind: 'confirm',
            player: opp.id,
            source: frame.source,
            ...promptOf(pr('opponentMayAddDon', `${srcName}: adicionar ${n} DON!! ativo(s) do seu deck de DON!!?`, { source: srcName, n })),
          };
          return false;
        }
        if (!frame.choice.length) {
          log(state, opp.id, lg('declinesAddDon', `${opp.name} não adiciona DON!!.`, { player: opp.name }));
          return true;
        }
      }
      opp.donDeck -= n;
      opp.donActive += n;
      if (n) log(state, frame.controller, lg('addsActiveDon', `${opp.name} adiciona ${n} DON!! ativo(s).`, { player: opp.name, n }));
      return true;
    }
    case 'donMatchOpponent': {
      // "until you have the same number of DON!! cards on your field as your opponent": com mais de dois, basta
      // um oponente (regra 10 do manual): vale o que tem mais DON!! (o que obriga a devolver menos).
      const extra = totalDonOnField(ps) - Math.max(...opponentSides(state, frame.controller).map((o) => totalDonOnField(state.players[o])));
      if (extra > 0) frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: extra });
      return true;
    }
    case 'returnGivenDon': {
      let left = step.count;
      const holders = [ps.leader, ...ps.characters].filter((c) => c.don > 0).sort((a, b) => b.don - a.don);
      for (const fc of holders) {
        const n = Math.min(fc.don, left);
        fc.don -= n;
        ps.donRested += n;
        left -= n;
        if (!left) break;
      }
      log(state, frame.controller, lg('returnsAttachedDon', `${ps.name} devolve ${step.count - left} DON!! anexado(s) à área de custo.`, { player: ps.name, n: step.count - left }));
      return true;
    }
    case 'opponentReturnsDon': {
      const opp = state.players[opponentOf(state, frame.controller)];
      if (step.activeOnly) {
        const k = Math.min(step.count, opp.donActive);
        opp.donActive -= k;
        opp.donDeck += k;
        if (k) emit(state, { kind: 'donReturned', player: opp.id, count: k, byPlayer: frame.controller });
        return true;
      }
      // O oponente escolhe quais dos seus DON!! devolver.
      const n = Math.min(step.count, totalDonOnField(opp));
      if (n) frame.steps.splice(frame.i + 1, 0, { do: 'returnDon', count: n, opponent: true });
      return true;
    }
  }
}
