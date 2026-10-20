// Texto para o motor (perfil Dev, tela "Cobertura das cartas"): o Dev reescreve o texto de uma carta
// numa redação equivalente que o leitor automático entende, vê na hora o que o leitor faz com ela e
// grava sem deploy. Só o motor lê esse texto (`CardData.engineText`, aplicado em `listCards`/`getCards`);
// o texto exibido continua o oficial. Se o texto oficial mudar (errata, fonte nova), o texto para o
// motor deixa de valer até o Dev revisar (`stale`). Só resolve o que o leitor já sabe fazer.
//
//   GET    /api/dev/engine-texts              todos os textos para o motor, com a situação de cada um
//   GET    /api/dev/engine-texts/:id          a carta: texto oficial, texto para o motor, diagnósticos, histórico
//   POST   /api/dev/engine-texts/preview      {cardId, text, trigger}: o que o leitor faria (sem gravar)
//   PUT    /api/dev/engine-texts/:id          {text, trigger}: grava
//   DELETE /api/dev/engine-texts/:id          volta ao texto oficial

import { type CardData, forEngine, hasScript, translateCardPt } from '@gumgum/engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from './auth/store';
import { dataVersion } from './cache';
import { devGuard, diagnosis } from './card-gaps';
import {
  type DB,
  engineTextHistory,
  getCards,
  getEngineText,
  listEngineTexts,
  officialTextKey,
  recordCardGaps,
  removeEngineText,
  setEngineText,
} from './db';
import { fail } from './errors';

const MAX_TEXT = 3000;
const MAX_TRIGGER = 1000;

/** Sem o texto para o motor: a carta como o leitor a lê pelo texto oficial. */
const official = ({ engineText: _e, ...c }: CardData): CardData => c;

/** O que o leitor faz com a carta: situação, linha por linha, e a tradução que sai dela. */
function reading(card: CardData) {
  const d = diagnosis(card);
  const pt = translateCardPt(forEngine(card));
  return { status: d.status, lines: d.lines, pt };
}

/** Texto e [Trigger] limpos do pedido, ou o erro. */
function readBody(body: { text?: unknown; trigger?: unknown } | undefined): { text: string; trigger: string | null } | { error: string } {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const trigger = typeof body?.trigger === 'string' ? body.trigger.trim() : '';
  if (body?.trigger !== undefined && body.trigger !== null && typeof body.trigger !== 'string') return { error: 'trigger' };
  if (!text && !trigger) return { error: 'empty' };
  if (text.length > MAX_TEXT || trigger.length > MAX_TRIGGER) return { error: 'tooLong' };
  return { text, trigger: trigger || null };
}

const bodyError = (e: string) =>
  e === 'empty'
    ? fail('engineTextEmpty', 'Escreva o texto para o motor.')
    : e === 'tooLong'
      ? fail('engineTextTooLong', `Texto longo demais (até ${MAX_TEXT} caracteres; [Trigger] até ${MAX_TRIGGER}).`)
      : fail('engineTextInvalid', 'Texto inválido.');

export function registerEngineTextRoutes(app: FastifyInstance, { db, user }: { db: DB; user: (req: FastifyRequest) => User | null }) {
  const devOnly = devGuard(user);
  const cardOf = (id: string) => getCards(db, [id])[0] ?? null;

  /** Tudo que a tela de edição mostra de uma carta. */
  const detail = (card: CardData) => {
    const row = getEngineText(db, card.id);
    const base = official(card);
    return {
      card: { id: card.id, name: card.name, set: card.set ?? card.id.split('-')[0], category: card.category, text: card.text, trigger: card.trigger ?? null },
      scripted: hasScript(card.id),
      engineText: row && { text: row.text, trigger: row.trigger, authorName: row.authorName, updatedAt: row.updatedAt },
      /** O texto oficial mudou desde que o texto para o motor foi escrito: ele não vale até ser revisto. */
      stale: Boolean(row && row.baseKey !== officialTextKey(base)),
      official: reading(base),
      current: reading(card),
      history: engineTextHistory(db, card.id),
    };
  };

  app.get('/api/dev/engine-texts', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    const rows = listEngineTexts(db);
    const cards = new Map(getCards(db, rows.map((r) => r.cardId)).map((c) => [c.id, c]));
    return {
      texts: rows.map((r) => {
        const card = cards.get(r.cardId);
        return {
          cardId: r.cardId,
          name: card?.name ?? null,
          set: card ? (card.set ?? card.id.split('-')[0]) : null,
          /** A carta saiu da base (o texto fica guardado, sem efeito). */
          missing: !card,
          stale: Boolean(card && r.baseKey !== officialTextKey(official(card))),
          status: card ? diagnosis(card).status : null,
          officialStatus: card ? diagnosis(official(card)).status : null,
          authorName: r.authorName,
          updatedAt: r.updatedAt,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/dev/engine-texts/:id', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    const card = cardOf(req.params.id);
    if (!card) return reply.code(404).send(fail('cardNotFound', 'Carta não encontrada'));
    return detail(card);
  });

  app.post<{ Body: { cardId?: unknown; text?: unknown; trigger?: unknown } }>('/api/dev/engine-texts/preview', async (req, reply) => {
    if (!devOnly(req, reply)) return reply;
    const card = typeof req.body?.cardId === 'string' ? cardOf(req.body.cardId) : null;
    if (!card) return reply.code(404).send(fail('cardNotFound', 'Carta não encontrada'));
    const b = readBody(req.body);
    if ('error' in b) return reply.code(400).send(bodyError(b.error));
    return reading({ ...official(card), engineText: { text: b.text, ...(b.trigger ? { trigger: b.trigger } : {}) } });
  });

  app.put<{ Params: { id: string }; Body: { text?: unknown; trigger?: unknown } }>('/api/dev/engine-texts/:id', async (req, reply) => {
    const me = devOnly(req, reply);
    if (!me) return reply;
    const card = cardOf(req.params.id);
    if (!card) return reply.code(404).send(fail('cardNotFound', 'Carta não encontrada'));
    if (hasScript(card.id)) return reply.code(409).send(fail('engineTextScripted', 'A carta tem script escrito à mão: o texto para o motor não seria usado.'));
    const b = readBody(req.body);
    if ('error' in b) return reply.code(400).send(bodyError(b.error));
    const base = official(card);
    if (b.text === (base.text ?? '').trim() && (b.trigger ?? '') === (base.trigger ?? '').trim()) {
      return reply.code(400).send(fail('engineTextSameAsOfficial', 'O texto é igual ao oficial: não há o que trocar.'));
    }
    setEngineText(db, { cardId: card.id, text: b.text, trigger: b.trigger, baseKey: officialTextKey(base), author: { id: me.id, name: me.name } });
    recordCardGaps(db);
    dataVersion.bump();
    return detail(cardOf(card.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/dev/engine-texts/:id', async (req, reply) => {
    const me = devOnly(req, reply);
    if (!me) return reply;
    if (!removeEngineText(db, req.params.id, { id: me.id, name: me.name })) {
      return reply.code(404).send(fail('engineTextNotFound', 'A carta não tem texto para o motor.'));
    }
    recordCardGaps(db);
    dataVersion.bump();
    const card = cardOf(req.params.id);
    return card ? detail(card) : { removed: true };
  });
}
