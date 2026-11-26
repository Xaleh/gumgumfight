// Criação da partida e preparação: quem começa, mãos iniciais, mulligans, largada (mesa de mais de dois) e Vida.

import { buildCardDef } from '../cards';
import { nextRandom, type RngHolder, seedRng128, shuffleInPlace } from '../rng';
import type { CardArt, CardDef, EffectStep, GameConfig, GameState, PlayerId, PlayerState } from '../types';
import { DECK_SIZE, DON_DECK_SIZE, HAND_SIZE, LIMITED_DECK_SIZE } from './constants';
import { lg, log, pr, promptOf } from './messages';
import { alivePlayers, isMultiplayer, MAX_PLAYERS, turnOrder, YONKO_DECK_SIZE } from './table';
import { cardDef, hasType, leaderRule } from './queries';
import { startTurn } from './turn';
import { pushEffect, run } from './stack';
import { drawCards, removeFrom } from './zones';

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2 || config.players.length > MAX_PLAYERS) {
    throw new Error(`Uma partida tem de 2 a ${MAX_PLAYERS} jogadores (vieram ${config.players.length}).`);
  }
  const multi = config.players.length > 2;
  // Só as cartas dos decks da partida entram no estado (que é copiado a cada ação).
  const used = new Set(config.players.flatMap((p) => [p.deck.leader, ...p.deck.cards.map((c) => c.id)]));
  const defs: Record<string, CardDef> = {};
  /** Artes de cada carta: a instância leva só a imagem escolhida, e a lista sai das definições (o estado é copiado a cada ação). */
  const arts = new Map<string, CardArt[]>();
  for (const c of config.cards) {
    if (!used.has(c.id)) continue;
    const def = buildCardDef(c);
    if (def.arts) {
      arts.set(c.id, def.arts);
      delete def.arts;
    }
    defs[c.id] = def;
  }

  const holder: RngHolder = { rng: config.seed | 0, ...(config.seed128 ? { rng128: seedRng128(config.seed128) } : {}) };
  const cards: GameState['cards'] = {};
  let counter = 0;
  const makeInstance = (cardId: string, owner: PlayerId, artId?: string) => {
    if (!defs[cardId]) throw new Error(`Carta desconhecida: ${cardId}`);
    const uid = `c${++counter}`;
    const art = artId ? arts.get(cardId)?.find((a) => a.id === artId)?.imageUrl : undefined;
    cards[uid] = { uid, cardId, owner, ...(art ? { art } : {}) };
    return uid;
  };

  const players = config.players.map((setup, idx) => {
    const id = idx as PlayerId;
    const leaderDef = defs[setup.deck.leader];
    if (!leaderDef || leaderDef.category !== 'leader') {
      throw new Error(`Líder inválido no deck ${setup.deck.name}`);
    }
    const leaderUid = makeInstance(setup.deck.leader, id, setup.deck.arts?.[setup.deck.leader]);
    const deck: string[] = [];
    for (const entry of setup.deck.cards) {
      for (let i = 0; i < entry.count; i++) deck.push(makeInstance(entry.id, id, setup.deck.arts?.[entry.id]));
    }
    // 50 no deck construído, 40 no Selado. Qual dos dois vale em cada partida é conferido antes
    // (`validateDeck`, `validateLimitedDeck`); aqui só se recusa o que não é nenhum deles.
    // Na mesa de Yonko, 60 (`validateYonkoDeck`); o motor também aceita ali os decks de 50.
    if (deck.length !== DECK_SIZE && deck.length !== LIMITED_DECK_SIZE && !(multi && deck.length === YONKO_DECK_SIZE)) {
      throw new Error(
        `O deck ${setup.deck.name} tem ${deck.length} cartas (precisa de ${multi ? `${YONKO_DECK_SIZE} no Yonko, ou de ${DECK_SIZE}` : `${DECK_SIZE}, ou de ${LIMITED_DECK_SIZE} no Selado`})`,
      );
    }
    shuffleInPlace(holder, deck);
    const p: PlayerState = {
      id,
      name: setup.name,
      isBot: Boolean(setup.isBot),
      leader: { uid: leaderUid, rested: false, don: 0, playedOnTurn: 0 },
      characters: [],
      stage: null,
      hand: [],
      deck,
      trash: [],
      life: [],
      donDeck: (leaderDef.abilities.find((a) => a.rule?.kind === 'donDeck')?.rule as { size: number } | undefined)?.size ?? DON_DECK_SIZE,
      donActive: 0,
      donRested: 0,
      mulliganDone: false,
    };
    return p;
  });

  // Mesa com mais de dois: o sorteio (o dado) decide quem começa, e a ordem segue os lugares.
  const firstPlayer: PlayerId =
    config.firstPlayer ??
    (multi ? Math.floor(nextRandom(holder) * players.length) : holder.rng128 ? (nextRandom(holder) < 0.5 ? 0 : 1) : holder.rng & 1 ? 0 : 1);
  if (!Number.isInteger(firstPlayer) || firstPlayer < 0 || firstPlayer >= players.length) throw new Error(`Primeiro jogador inválido: ${firstPlayer}`);
  // O vencedor do sorteio escolhe se joga primeiro ou segundo (só com dois jogadores).
  const choose = Boolean(config.chooseFirst) && config.firstPlayer === undefined && !multi;

  const state: GameState = {
    version: 1,
    seed: config.seed,
    rng: holder.rng,
    ...(holder.rng128 ? { rng128: holder.rng128 } : {}),
    turn: 0,
    firstPlayer,
    ...(choose ? { rollWinner: firstPlayer } : {}),
    activePlayer: firstPlayer,
    phase: 'mulligan',
    players,
    cards,
    defs,
    battle: null,
    stack: [],
    pending: { kind: choose ? 'chooseFirst' : 'mulligan', player: firstPlayer },
    modifiers: [],
    usedThisTurn: [],
    ...(multi ? { table: { ...(config.table ?? {}) }, eliminated: [], turnsTaken: players.map(() => 0) } : {}),
    winner: null,
    winReason: null,
    log: [],
    actionCount: 0,
  };

  if (config.legacySetup) {
    // Replays até a versão 8: o "at the start of the game" resolvia aqui, antes da escolha de quem
    // começa, com o primeiro Stage elegível do deck e sem embaralhar; a Vida saía na ordem antiga.
    state.legacySetup = true;
    for (const p of players) {
      const rule = leaderRule(state, p.id, 'startStage');
      const stage = rule && p.deck.find((u) => cardDef(state, u).category === 'stage' && hasType(cardDef(state, u), rule.type));
      if (stage) {
        removeFrom(p.deck, stage);
        p.stage = { uid: stage, rested: false, don: 0, playedOnTurn: 0 };
        log(state, p.id, lg('startsWithStage', `${p.name} começa com ${cardDef(state, stage).name} em campo.`, { player: p.name, card: cardDef(state, stage).name }), { cards: [stage] });
      }
    }
  }
  if (multi) {
    // Mesa com mais de dois: quem começa já está decidido; a largada de cada um, as mãos e os mulligans
    // seguem em `continueSetup`.
    log(state, null, lg('goesFirst', `${players[firstPlayer].name} joga primeiro.`, { player: players[firstPlayer].name }));
    continueSetup(state);
    run(state);
    return state;
  }
  // Quem tem "at the start of the game" no Líder compra a mão só depois de resolvê-lo (5-2-1-5/6).
  for (const p of players) if (state.legacySetup || !leaderRule(state, p.id, 'startStage')) drawCards(state, p.id, HAND_SIZE);
  if (choose) log(state, null, lg('wonRoll', `${players[firstPlayer].name} venceu o sorteio e escolhe quem começa.`, { player: players[firstPlayer].name }));
  else {
    log(state, null, lg('goesFirst', `${players[firstPlayer].name} joga primeiro.`, { player: players[firstPlayer].name }));
    startOfGame(state);
  }
  return state;
}

/**
 * Efeitos "at the start of the game" do Líder (5-2-1-5), depois de decidido quem começa: primeiro
 * os de quem joga primeiro (Q&A OP13-079 Imu), depois os do outro. "Play up to 1 {X} type Stage
 * card from your deck" é uma busca: o dono escolhe qual Stage jogar (ou nenhum) e embaralha o deck
 * (5-2-1-5-2). Quem tem o efeito compra a mão inicial depois dele (frame `startGame`, 5-2-1-6).
 */
export function startOfGame(state: GameState) {
  if (state.legacySetup) return;
  const order = turnOrder(state, state.firstPlayer);
  const effects = order.flatMap((p) => {
    const rule = leaderRule(state, p, 'startStage');
    if (!rule) return [];
    const steps: EffectStep[] = [
      { do: 'playFrom', from: 'deck', upTo: 1, filter: { category: 'stage', hasAnyType: [rule.type] } },
      { do: 'shuffleDeck' },
    ];
    return [{ player: p, steps }];
  });
  if (!effects.length) return;
  state.pending = null;
  state.stack.push({ kind: 'startGame' });
  // Empilhados ao contrário: o de quem joga primeiro resolve primeiro.
  for (const e of effects.reverse()) pushEffect(state, state.players[e.player].leader.uid, e.player, e.steps);
  run(state);
}

/** Fim dos efeitos "at the start of the game": quem ainda não tem mão compra 5 e começa o mulligan. */
export function finishStartOfGame(state: GameState) {
  for (const p of alivePlayers(state)) if (!p.hand.length && !p.mulliganDone) drawCards(state, p.id, HAND_SIZE);
  state.pending = { kind: 'mulligan', player: state.firstPlayer };
  // Mesa com mais de dois: quem começaria pode ter saído durante os efeitos de início.
  if (isMultiplayer(state)) continueSetup(state);
}


/**
 * Próximo passo da preparação. Com dois jogadores: os mulligans, a Vida e o primeiro turno. Na mesa com
 * mais de dois, pelo manual do formato: antes das mãos, cada um na ordem dos turnos escolhe a própria
 * largada (`curve`); depois as mãos iniciais (e os "at the start of the game"), os mulligans na ordem, a
 * Vida de cada um e o primeiro turno.
 */
export function continueSetup(state: GameState) {
  state.pending = null;
  const order = turnOrder(state, state.firstPlayer);
  if (!order.length) return;
  if (isMultiplayer(state)) {
    if (state.table?.curveChoice) {
      const curve = (state.curve ??= state.players.map(() => null));
      const next = order.find((id) => curve[id] === null);
      if (next !== undefined) {
        const name = state.players[next].name;
        state.pending = {
          kind: 'option',
          player: next,
          source: state.players[next].leader.uid,
          ...promptOf(pr('startCurve', `${name}: escolha a sua largada.`, { player: name })),
          options: ['1 DON!! no primeiro turno e comprar 1 carta (1, 3, 5, 7, 9, 10)', '2 DON!! no primeiro turno, sem comprar (2, 4, 6, 8, 10)'],
          optionKeys: ['engine.optCurveOdd', 'engine.optCurveEven'],
          curve: true,
        };
        return;
      }
    }
    if (!state.dealt) {
      state.dealt = true;
      // Quem tem "at the start of the game" no Líder compra a mão só depois de resolvê-lo (5-2-1-5/6).
      for (const p of alivePlayers(state)) if (!leaderRule(state, p.id, 'startStage')) drawCards(state, p.id, HAND_SIZE);
      startOfGame(state);
      // Os efeitos de início resolvem primeiro; `finishStartOfGame` volta aqui.
      if (state.stack.length) return;
    }
  }
  const mulligan = order.find((id) => !state.players[id].mulliganDone);
  if (mulligan !== undefined) {
    state.pending = { kind: 'mulligan', player: mulligan };
    return;
  }
  const extraLife = isMultiplayer(state) ? Math.max(0, state.table?.extraLife ?? 0) : 0;
  for (const pl of alivePlayers(state)) {
    const life = (cardDef(state, pl.leader.uid).life ?? 5) + extraLife;
    // A carta do topo do deck fica por baixo da pilha de Vida (5-2-1-7): o topo da Vida é o
    // fim do array. (Replays até a versão 8 punham a Vida na ordem inversa.)
    for (let i = 0; i < life; i++) {
      if (state.legacySetup) pl.life.unshift(pl.deck.shift()!);
      else pl.life.push(pl.deck.shift()!);
    }
  }
  state.turn = 1;
  state.activePlayer = order[0];
  startTurn(state);
}

/** A largada escolhida: ímpar = 1 DON!! no primeiro turno e a compra; par = 2 DON!! sem comprar. */
export function chooseCurve(state: GameState, p: PlayerId, curve: 'odd' | 'even') {
  const ps = state.players[p];
  (state.curve ??= state.players.map(() => null))[p] = curve;
  log(
    state,
    p,
    curve === 'odd'
      ? lg('startCurveOdd', `${ps.name} escolhe 1 DON!! no primeiro turno e comprar 1 carta.`, { player: ps.name })
      : lg('startCurveEven', `${ps.name} escolhe 2 DON!! no primeiro turno, sem comprar.`, { player: ps.name }),
  );
}
