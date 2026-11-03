// Web Worker do bot: a busca do bot (até 250 ms no `hard` e 600 ms no `team`, mais num celular) roda
// aqui, fora da página. Na página ela travava a tela justo quando as cartas começavam a voar.
// O plano guardado do bot (planner.ts) vive neste worker entre uma jogada e outra.

import { type BotRequest, computeBotMove } from './botMove';

export type WorkerRequest = BotRequest & { id: number };
export type WorkerReply = { id: number } & ({ ok: true; move: ReturnType<typeof computeBotMove> } | { ok: false; error: string });

// O tsconfig do web usa a lib DOM: aqui `self` é o escopo do worker.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};

scope.onmessage = (e) => {
  const { id, ...req } = e.data;
  try {
    scope.postMessage({ id, ok: true, move: computeBotMove(req) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
