// Chat do lobby do torneio: uma conversa só para o torneio inteiro, lida por quem abre o lobby e
// escrita pelos inscritos, pelos Judges e pelo organizador.
//
// As mensagens ficam no banco (`tournament_chat`), então sobrevivem a um reinício no meio do torneio.
// O texto segue as mesmas regras do chat da partida (online/chat-rules.ts): limpo, com tamanho máximo,
// palavrões censurados antes de gravar e um ritmo máximo por pessoa.
//
// O lobby consulta o chat de poucos em poucos segundos, por pessoa. Para isso não virar leitura no
// SQLite a cada consulta, a conversa de cada torneio (as últimas `LOBBY_CHAT_WINDOW` mensagens) fica
// pronta em memória com uma versão (`rev`), refeita só quando alguém escreve ou apaga.

import { randomBytes } from 'node:crypto';
import type { DB } from '../db';
import { fail, type PlayerError } from '../errors';
import { chatPace, chatText, chatTooFast } from '../online/chat-rules';
import type { Tournament } from './store';

/** Tamanho máximo de uma mensagem (o chat da partida usa 120; aqui cabem avisos do organizador). */
export const LOBBY_CHAT_MAX_LENGTH = 240;
/** Quantas mensagens o lobby mostra (as mais recentes). */
export const LOBBY_CHAT_WINDOW = 100;
/** Depois de encerrado o torneio, o chat ainda aceita mensagens por este tempo (o "gg" do fim). */
export const LOBBY_CHAT_AFTER_MS = 2 * 60 * 60_000;

export type LobbyChatRole = 'organizer' | 'judge' | 'player';

export interface LobbyChatMessage {
  id: number;
  userId: string;
  name: string;
  role: LobbyChatRole;
  text: string;
  at: string;
}

export interface LobbyChatFeed {
  /** Muda quando alguém escreve ou apaga (e a cada reinício do servidor). */
  rev: string;
  messages: LobbyChatMessage[];
}

type Row = { id: number; user_id: string; name: string; role: LobbyChatRole; text: string; sent_at: string };

/** O torneio tem chat no lobby? A Sala do Tempo é um treino de uma pessoa só contra o bot: não tem. */
export const hasLobbyChat = (t: Pick<Tournament, 'chamber'>): boolean => t.chamber === null;

/** O chat aceita mensagens agora: durante o torneio e por `LOBBY_CHAT_AFTER_MS` depois de encerrado. */
export function lobbyChatOpen(t: Pick<Tournament, 'status' | 'finishedAt'>, now: number): boolean {
  if (t.status !== 'finished') return true;
  // `finished_at` é gravado pelo SQLite em UTC, sem o fuso ("2026-01-02 03:04:05").
  const at = t.finishedAt ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t.finishedAt) ? t.finishedAt : `${t.finishedAt.replace(' ', 'T')}Z`) : NaN;
  return Number.isFinite(at) && now - at < LOBBY_CHAT_AFTER_MS;
}

export type LobbyChatResult = { ok: true } | ({ ok: false; code: number } & PlayerError);

export class LobbyChat {
  private readonly feeds = new Map<string, LobbyChatFeed>();
  /** Instantes das mensagens recentes de cada pessoa em cada torneio (ritmo). */
  private readonly times = new Map<string, number[]>();
  /** As versões levam um prefixo sorteado ao subir: a contagem recomeça a cada reinício sem repetir uma versão antiga. */
  private readonly boot = randomBytes(4).toString('hex');
  private n = 0;

  constructor(
    private readonly db: DB,
    private readonly now: () => number = Date.now,
  ) {}

  /** A conversa do torneio (as últimas mensagens, da mais antiga para a mais nova). */
  feed(tournamentId: string): LobbyChatFeed {
    const hit = this.feeds.get(tournamentId);
    if (hit) return hit;
    const rows = this.db
      .prepare('SELECT id, user_id, name, role, text, sent_at FROM tournament_chat WHERE tournament_id = ? AND removed_at IS NULL ORDER BY id DESC LIMIT ?')
      .all(tournamentId, LOBBY_CHAT_WINDOW) as Row[];
    const feed: LobbyChatFeed = {
      rev: `${this.boot}-${++this.n}`,
      messages: rows.reverse().map((r) => ({ id: r.id, userId: r.user_id, name: r.name, role: r.role, text: r.text, at: r.sent_at })),
    };
    // Torneios encerrados vão ficando para trás: ao passar do teto, o cache recomeça.
    if (this.feeds.size >= 200) this.feeds.clear();
    this.feeds.set(tournamentId, feed);
    return feed;
  }

  /** Mensagem nova de `author` (o papel e o direito de escrever são conferidos pela rota). */
  post(tournamentId: string, author: { userId: string; name: string; role: LobbyChatRole }, text: unknown): LobbyChatResult {
    const clean = chatText(text, LOBBY_CHAT_MAX_LENGTH);
    if (!clean.ok) return clean;
    const now = this.now();
    const key = `${tournamentId}:${author.userId}`;
    const pace = chatPace(this.times.get(key) ?? [], now);
    if (!pace.allowed) {
      this.times.set(key, pace.recent);
      return chatTooFast();
    }
    if (this.times.size >= 5000) this.times.clear();
    this.times.set(key, [...pace.recent, now]);
    this.db
      .prepare('INSERT INTO tournament_chat (tournament_id, user_id, name, role, text, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tournamentId, author.userId, author.name, author.role, clean.text, new Date(now).toISOString());
    this.feeds.delete(tournamentId);
    return { ok: true };
  }

  /** De quem é a mensagem (null = não existe neste torneio ou já foi apagada). */
  authorOf(tournamentId: string, id: number): string | null {
    const row = this.db.prepare('SELECT user_id FROM tournament_chat WHERE tournament_id = ? AND id = ? AND removed_at IS NULL').get(tournamentId, id) as
      | { user_id: string }
      | undefined;
    return row?.user_id ?? null;
  }

  /** Apaga a mensagem do chat (ela continua na tabela, com quem apagou e quando). */
  remove(tournamentId: string, id: number, by: string): LobbyChatResult {
    const { changes } = this.db
      .prepare('UPDATE tournament_chat SET removed_at = ?, removed_by = ? WHERE tournament_id = ? AND id = ? AND removed_at IS NULL')
      .run(new Date(this.now()).toISOString(), by, tournamentId, id);
    if (!Number(changes)) return { ok: false, code: 404, ...fail('lobbyChatMessageNotFound', 'Mensagem não encontrada.') };
    this.feeds.delete(tournamentId);
    return { ok: true };
  }
}
