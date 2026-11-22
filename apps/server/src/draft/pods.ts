// Pods de Draft: 8 lugares, cada um abre um booster, fica com uma carta e passa o resto.
//
// O servidor é a autoridade. Os boosters de todas as rodadas são sorteados quando o draft começa
// e ficam só aqui: cada jogador recebe o booster que está na mão dele, as próprias escolhas e, dos
// outros, apenas quem já escolheu. Lugar vazio vira bot, que escolhe na hora. Quem deixa o tempo
// acabar tem a carta escolhida pelo servidor; depois de duas vezes seguidas, se a pessoa também
// não está com a tela aberta, o lugar passa a escolher sozinho (como um bot) até ela voltar. Cada mudança é gravada (`draft_pods`), então
// o draft continua depois de um deploy. No fim, as cartas de cada pessoa viram um deck selado
// (`sealed_pools`, `kind = 'draft'`) e os bots montam os deles, que servem de oponente no treino.

import { randomBytes, randomInt } from 'node:crypto';
import {
  autoBuildLimited,
  boosterCards,
  boosterSize,
  type CardData,
  createDraft,
  cubeKey,
  DRAFT_ROUNDS,
  DRAFT_SEATS,
  draftChoice,
  draftDone,
  draftPack,
  draftPassTo,
  draftPick,
  draftPicked,
  draftPickSeconds,
  draftPicks,
  type DraftState,
  type DeckList,
  isCube,
  openCubeBoosters,
  openDraftBoosters,
  poolCounts,
  RUSH_MAX_SETS,
  type RngHolder,
  rushKey,
  rushSets,
  SEALED_LEADER_ID,
  validateLimitedDeck,
} from '@gumgum/engine';
import { type DB, getCards, listCards } from '../db';
import { fail, type PlayerError } from '../errors';
import { createDraftPool, poolRules, sealedSets } from '../sealed/store';
import { cubeByKey, currentCube } from './cubes';

export type PodError = PlayerError & { code: number };
export const isPodError = (v: unknown): v is PodError => typeof v === 'object' && v !== null && 'errorCode' in v;

/** Pods ativos no servidor (esperando ou draftando). */
export const MAX_ACTIVE_PODS = 300;
/** Tempos esgotados seguidos até o lugar passar a escolher sozinho… */
const AWAY_AFTER_TIMEOUTS = 2;
/** …desde que a pessoa não consulte o pod há este tempo (quem está na tela, só devagar, continua escolhendo). */
const AWAY_UNSEEN_MS = 15_000;
/** Pod à espera sem começar: fecha depois disto. */
const WAITING_TTL_MS = 2 * 3_600_000;
/** Pod terminado: sai da memória depois disto (o banco guarda os decks dos bots por mais tempo). */
const DONE_TTL_MS = 6 * 3_600_000;
/** Linhas de pods terminados ficam no banco por este tempo (os decks dos bots, para o treino). */
const KEEP_DAYS = 14;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface PodSeat {
  /** Dono (conta ou navegador); null = bot. */
  ownerHash: string | null;
  name: string;
  /** Fim do prazo da escolha em andamento (ms desde a época). */
  deadline?: number | null;
  /** Tempos esgotados seguidos. */
  timeouts?: number;
  /** Última vez em que a pessoa consultou o pod ou escolheu. */
  seenAt?: number;
  /** Escolhendo sozinho (saiu ou deixou o tempo acabar duas vezes): volta ao normal quando a pessoa aparece. */
  away?: boolean;
  /** O deck selado criado no fim do draft. */
  poolId?: string;
}

interface PodData {
  id: string;
  code: string;
  /** Chave das coleções ("OP01" ou, no Pack Rush draft, "OP01+OP05"); no Draft Cubo, a do Cubo ("CUBE:T1"). */
  sets: string;
  hostHash: string;
  status: 'waiting' | 'drafting' | 'done';
  seats: PodSeat[];
  draft?: DraftState;
  /** Estado do acaso dos bots (o mesmo RNG do motor). */
  rng: number;
  createdAt: number;
  finishedAt?: number;
  /** Decks que os bots montaram com o que escolheram. */
  botDecks?: Array<Pick<DeckList, 'leader' | 'cards'>>;
}

/** O que um jogador vê do pod. */
export interface PodView {
  id: string;
  code: string;
  sets: string;
  status: PodData['status'];
  host: boolean;
  /** O lugar de quem pede. */
  you: number;
  seats: Array<{ name: string; bot: boolean; you: boolean; away: boolean; picked: number; choosing: boolean }>;
  capacity: number;
  rounds: number;
  /** Rodada em andamento (1 a `rounds`). */
  round: number;
  packSize: number;
  /** O booster na mão (null: esperando o vizinho, ou o draft não está em andamento). */
  pack: string[] | null;
  /** Coleção do booster desta rodada. */
  packSet: string | null;
  /** Milissegundos até a escolha automática (null: sem booster na mão). */
  timeLeft: number | null;
  /** Para quem os boosters vão nesta rodada (o nome do vizinho). */
  passTo: string | null;
  /** As cartas já escolhidas, por rodada. */
  picks: string[][];
  /** No fim: o deck selado com as escolhas. */
  poolId: string | null;
}

interface Deps {
  db: DB;
  now?: () => number;
}

export class DraftPods {
  private pods = new Map<string, PodData>();
  private codes = new Map<string, string>();
  /** Cartas dos boosters de cada pod (para os bots e para a escolha automática). */
  private catalogs = new Map<string, Map<string, CardData>>();
  private now: () => number;
  private db: DB;

  constructor(deps: Deps) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.load();
  }

  // ---------------------------------------------------------------- entrada

  /** Abre um pod: quem cria escolhe as coleções (uma, ou várias no Pack Rush draft) e ocupa o primeiro lugar. */
  create(ownerHash: string, name: string, sets: readonly string[], opts: { cube?: boolean } = {}): PodData | PodError {
    let key: string;
    if (opts.cube) {
      // Draft Cubo: sempre o Cubo publicado mais recente.
      const cube = currentCube(this.db);
      if (!cube) return { code: 400, ...fail('cubeUnavailable', 'O Cubo não está disponível neste servidor.') };
      key = cubeKey(cube.file.id);
    } else {
      key = rushKey(sets);
      const chosen = rushSets(key);
      const available = new Set(sealedSets(this.db).map((s) => s.set));
      if (!chosen.length || chosen.length > RUSH_MAX_SETS || chosen.some((s) => !available.has(s))) {
        return { code: 400, ...fail('sealedSetUnavailable', 'Essa coleção não está disponível no Selado.', { set: chosen.join(' + ') }) };
      }
    }
    const busy = this.busy(ownerHash);
    if (busy) return busy;
    if ([...this.pods.values()].filter((p) => p.status !== 'done').length >= MAX_ACTIVE_PODS) {
      return { code: 429, ...fail('draftServerFull', 'Há muitos drafts abertos agora. Tente de novo em alguns minutos.') };
    }
    const pod: PodData = {
      id: randomBytes(9).toString('base64url'),
      code: this.newCode(),
      sets: key,
      hostHash: ownerHash,
      status: 'waiting',
      seats: [{ ownerHash, name, seenAt: this.now() }],
      rng: randomInt(0, 0x7fff_ffff),
      createdAt: this.now(),
    };
    this.pods.set(pod.id, pod);
    this.codes.set(pod.code, pod.id);
    this.save(pod);
    return pod;
  }

  join(code: string, ownerHash: string, name: string): PodData | PodError {
    const pod = this.pods.get(this.codes.get(code.trim().toUpperCase()) ?? '');
    if (!pod) return { code: 404, ...fail('draftPodNotFound', 'Pod de Draft não encontrado.') };
    // Voltar ao próprio pod (em qualquer fase) é sempre permitido.
    if (pod.seats.some((s) => s.ownerHash === ownerHash)) return pod;
    if (pod.status !== 'waiting') return { code: 409, ...fail('draftPodStarted', 'Esse draft já começou.') };
    if (pod.seats.length >= DRAFT_SEATS) return { code: 409, ...fail('draftPodFull', 'Esse pod já está cheio.') };
    const busy = this.busy(ownerHash);
    if (busy) return busy;
    pod.seats.push({ ownerHash, name, seenAt: this.now() });
    this.save(pod);
    // Com os 8 lugares ocupados por pessoas, o draft começa sozinho.
    if (pod.seats.length === DRAFT_SEATS) this.begin(pod);
    return pod;
  }

  /** Quem está num pod à espera ou em andamento só entra em outro depois de sair deste. */
  private busy(ownerHash: string): PodError | null {
    const current = this.activeFor(ownerHash);
    return current ? { code: 409, ...fail('draftAlreadyInPod', 'Você já está num pod de Draft.', { code: current.code }), podId: current.id } as PodError : null;
  }

  /** O pod em que o jogador está (esperando ou draftando). */
  activeFor(ownerHash: string): PodData | null {
    for (const pod of this.pods.values()) if (pod.status !== 'done' && pod.seats.some((s) => s.ownerHash === ownerHash)) return pod;
    return null;
  }

  get(id: string): PodData | null {
    return this.pods.get(id) ?? null;
  }

  /**
   * Sai do pod. Na espera, o lugar fica livre (se era quem criou, o pod passa para o próximo, ou
   * fecha se não há mais ninguém). Com o draft em andamento, o lugar passa a escolher sozinho.
   */
  leave(pod: PodData, ownerHash: string) {
    const seat = pod.seats.findIndex((s) => s.ownerHash === ownerHash);
    if (seat < 0 || pod.status === 'done') return;
    if (pod.status === 'drafting') {
      pod.seats[seat].away = true;
      this.advance(pod);
      return;
    }
    pod.seats.splice(seat, 1);
    if (!pod.seats.length) return this.close(pod);
    if (pod.hostHash === ownerHash) pod.hostHash = pod.seats[0].ownerHash!;
    this.save(pod);
  }

  /** Quem criou começa quando quiser: os lugares vazios viram bots. */
  start(pod: PodData, ownerHash: string): PodError | null {
    if (pod.hostHash !== ownerHash) return { code: 403, ...fail('draftHostOnly', 'Só quem criou o pod começa o draft.') };
    if (pod.status !== 'waiting') return { code: 409, ...fail('draftPodStarted', 'Esse draft já começou.') };
    return this.begin(pod) ? null : { code: 400, ...fail('cubeUnavailable', 'O Cubo não está disponível neste servidor.') };
  }

  private begin(pod: PodData): boolean {
    for (let n = 1; pod.seats.length < DRAFT_SEATS; n++) pod.seats.push({ ownerHash: null, name: `Bot ${n}` });
    const seed = Array.from({ length: 4 }, () => randomInt(0, 0x1_0000_0000));
    if (isCube(pod.sets)) {
      // O Cubo foi conferido ao criar o pod; se saiu do ar nesse meio tempo, o pod não tem como começar.
      const cube = cubeByKey(this.db, pod.sets);
      if (!cube) {
        pod.seats = pod.seats.filter((s) => s.ownerHash !== null);
        return false;
      }
      pod.draft = createDraft(openCubeBoosters(cube.cards, seed, DRAFT_SEATS, DRAFT_ROUNDS, pod.sets));
    } else {
      const sources = rushSets(pod.sets).map((set) => ({ set, cards: boosterCards(listCards(this.db, set) as CardData[], set) }));
      pod.draft = createDraft(openDraftBoosters(sources, seed, DRAFT_SEATS, DRAFT_ROUNDS));
    }
    pod.status = 'drafting';
    this.advance(pod);
    return true;
  }

  // ---------------------------------------------------------------- escolhas

  pick(pod: PodData, ownerHash: string, cardId: unknown): PodError | null {
    const seat = pod.seats.findIndex((s) => s.ownerHash === ownerHash);
    if (seat < 0) return { code: 404, ...fail('draftPodNotFound', 'Pod de Draft não encontrado.') };
    if (pod.status !== 'drafting' || !pod.draft) return { code: 409, ...fail('draftNotPicking', 'Não há escolha em andamento.') };
    const pack = draftPack(pod.draft, seat);
    if (!pack || typeof cardId !== 'string' || !pack.includes(cardId)) {
      return { code: 400, ...fail('draftCardNotInPack', 'Essa carta não está no booster que está com você.') };
    }
    pod.draft = draftPick(pod.draft, seat, cardId);
    const s = pod.seats[seat];
    s.deadline = null;
    s.timeouts = 0;
    s.away = false;
    s.seenAt = this.now();
    this.advance(pod);
    return null;
  }

  /** O jogador apareceu (a tela do pod consultou o servidor): deixa de escolher sozinho. */
  touch(pod: PodData, ownerHash: string) {
    const s = pod.seats.find((x) => x.ownerHash === ownerHash);
    if (s) s.seenAt = this.now();
    if (!s?.away || pod.status !== 'drafting') return;
    s.away = false;
    s.timeouts = 0;
    this.advance(pod);
  }

  private catalog(pod: PodData): Map<string, CardData> {
    let c = this.catalogs.get(pod.id);
    if (!c && pod.draft) {
      const ids = new Set([...pod.draft.sealed.flat(2), ...pod.draft.queues.flat(2), ...pod.draft.picks.flat(2), SEALED_LEADER_ID]);
      c = new Map((getCards(this.db, [...ids]) as CardData[]).map((card) => [card.id, card]));
      this.catalogs.set(pod.id, c);
    }
    return c ?? new Map();
  }

  /** No Draft Cubo, o uso de cada carta (a nota dos bots no lugar da raridade). */
  private usage(pod: PodData): ReadonlyMap<string, number> | undefined {
    return isCube(pod.sets) ? cubeByKey(this.db, pod.sets)?.usage : undefined;
  }

  /**
   * Depois de cada mudança: bots e lugares ausentes escolhem na hora (enquanto houver booster na
   * mão de algum), quem recebeu booster ganha prazo, e o draft fecha quando as rodadas acabam.
   */
  private advance(pod: PodData) {
    if (!pod.draft) return;
    const cards = this.catalog(pod);
    const usage = this.usage(pod);
    const holder: RngHolder = { rng: pod.rng };
    for (let guard = 0; guard < 2000 && !draftDone(pod.draft); guard++) {
      const seat = pod.seats.findIndex((s, i) => (s.ownerHash === null || s.away) && draftPack(pod.draft!, i));
      if (seat < 0) break;
      const s = pod.seats[seat];
      // O bot varia um pouco; a escolha no lugar de uma pessoa ausente é a melhor carta, sem acaso.
      pod.draft = draftPick(pod.draft, seat, draftChoice(draftPack(pod.draft, seat)!, draftPicks(pod.draft, seat), cards, s.ownerHash === null ? holder : undefined, usage));
      s.deadline = null;
    }
    pod.rng = holder.rng;
    if (draftDone(pod.draft)) return this.finish(pod);
    const now = this.now();
    pod.seats.forEach((s, i) => {
      if (s.ownerHash === null) return;
      const pack = draftPack(pod.draft!, i);
      if (!pack) s.deadline = null;
      else if (!s.deadline) s.deadline = now + draftPickSeconds(pack.length) * 1000;
    });
    this.save(pod);
  }

  /** Prazos vencidos: o servidor escolhe pela pessoa. Chamado a cada segundo (e pelos testes). */
  tick() {
    const now = this.now();
    for (const pod of [...this.pods.values()]) {
      if (pod.status === 'waiting' && now - pod.createdAt > WAITING_TTL_MS) this.close(pod);
      else if (pod.status === 'done' && now - (pod.finishedAt ?? pod.createdAt) > DONE_TTL_MS) this.forget(pod);
      else if (pod.status === 'drafting' && pod.draft) {
        let changed = false;
        pod.seats.forEach((s, i) => {
          if (s.ownerHash === null || !s.deadline || s.deadline > now || !pod.draft) return;
          const pack = draftPack(pod.draft, i);
          if (!pack) return;
          pod.draft = draftPick(pod.draft, i, draftChoice(pack, draftPicks(pod.draft, i), this.catalog(pod), undefined, this.usage(pod)));
          s.deadline = null;
          s.timeouts = (s.timeouts ?? 0) + 1;
          if (s.timeouts >= AWAY_AFTER_TIMEOUTS && now - (s.seenAt ?? 0) > AWAY_UNSEEN_MS) s.away = true;
          changed = true;
        });
        if (changed) this.advance(pod);
      }
    }
  }

  private finish(pod: PodData) {
    const draft = pod.draft!;
    const cards = this.catalog(pod);
    const rules = poolRules({ set: pod.sets, podId: pod.id });
    pod.botDecks = [];
    pod.seats.forEach((s, i) => {
      s.deadline = null;
      if (s.ownerHash !== null) {
        s.poolId = createDraftPool(this.db, s.ownerHash, pod.sets, draft.picks[i], pod.id).id;
        return;
      }
      const pool = poolCounts(draft.picks[i]);
      const deck = autoBuildLimited(pool, cards);
      if (validateLimitedDeck({ id: 'sealed:bot', name: 'Draft', ...deck }, cards, pool, rules).valid) pod.botDecks!.push(deck);
    });
    pod.status = 'done';
    pod.finishedAt = this.now();
    // Os boosters já foram todos escolhidos: o estado do draft não precisa mais ficar guardado.
    pod.draft = { ...draft, sealed: [], queues: draft.queues.map(() => []) };
    this.catalogs.delete(pod.id);
    this.save(pod);
  }

  // ---------------------------------------------------------------- visão

  view(pod: PodData, ownerHash: string): PodView | null {
    const you = pod.seats.findIndex((s) => s.ownerHash === ownerHash);
    if (you < 0) return null;
    const d = pod.status === 'drafting' ? pod.draft : undefined;
    const pack = d ? draftPack(d, you) : null;
    const deadline = pod.seats[you].deadline;
    return {
      id: pod.id,
      code: pod.code,
      sets: pod.sets,
      status: pod.status,
      host: pod.hostHash === ownerHash,
      you,
      seats: pod.seats.map((s, i) => ({
        name: s.name,
        bot: s.ownerHash === null,
        you: i === you,
        away: Boolean(s.away),
        picked: d ? draftPicked(d, i) : 0,
        choosing: Boolean(d && draftPack(d, i)),
      })),
      capacity: DRAFT_SEATS,
      rounds: DRAFT_ROUNDS,
      round: Math.min(DRAFT_ROUNDS, (pod.draft?.round ?? 0) + 1),
      packSize: boosterSize(),
      pack,
      packSet: d ? (d.sets[d.round]?.[you] ?? null) : null,
      timeLeft: pack && deadline ? Math.max(0, deadline - this.now()) : null,
      passTo: d ? pod.seats[draftPassTo(d, you)].name : null,
      picks: pod.draft ? pod.draft.picks[you] : [],
      poolId: pod.seats[you].poolId ?? null,
    };
  }

  // ---------------------------------------------------------------- gravação

  private newCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (!this.codes.has(code)) return code;
    }
  }

  private save(pod: PodData) {
    this.db
      .prepare(
        `INSERT INTO draft_pods (id, code, status, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = datetime('now')`,
      )
      .run(pod.id, pod.code, pod.status, JSON.stringify(pod));
  }

  /** Fecha um pod que não chegou ao fim (some da memória e do banco). */
  private close(pod: PodData) {
    this.forget(pod);
    this.db.prepare('DELETE FROM draft_pods WHERE id = ?').run(pod.id);
  }

  private forget(pod: PodData) {
    this.pods.delete(pod.id);
    this.codes.delete(pod.code);
    this.catalogs.delete(pod.id);
  }

  /** Ao subir: os pods em andamento voltam com prazos novos (o tempo fora do ar não conta para ninguém). */
  private load() {
    this.db.prepare(`DELETE FROM draft_pods WHERE status = 'done' AND updated_at < datetime('now', '-${KEEP_DAYS} days')`).run();
    const rows = this.db.prepare("SELECT data FROM draft_pods WHERE status <> 'done'").all() as unknown as Array<{ data: string }>;
    for (const row of rows) {
      try {
        const pod = JSON.parse(row.data) as PodData;
        for (const s of pod.seats) {
          s.deadline = null;
          s.seenAt = this.now();
        }
        this.pods.set(pod.id, pod);
        this.codes.set(pod.code, pod.id);
        if (pod.status === 'drafting') this.advance(pod);
      } catch {
        /* linha ilegível: fica de fora */
      }
    }
  }
}
