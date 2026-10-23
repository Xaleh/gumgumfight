// Consulta periódica ao servidor sem acúmulo de pedidos.
//
// Por que não setInterval: durante uma queda do servidor, cada tique empilhava mais um pedido
// pendente no navegador (o anterior ainda esperava conexão). Na volta, todos saíam de uma vez
// pela mesma conexão HTTP/2 e estouravam o limite de conexões por IP do Nginx (429) justamente
// na hora em que o site voltava. Aqui a próxima consulta só é agendada quando a anterior termina.

/** Opções de `poll`. */
export type PollOptions = {
  /** Consulta já ao começar (padrão) ou só depois do primeiro intervalo. */
  immediate?: boolean;
  /** Teto do espaçamento quando falha, em múltiplos de `ms` (padrão 8: com 5 s vai até 40 s). */
  max?: number;
};

/**
 * Chama `run` agora e, a cada vez que ela termina, de novo `ms` depois. Nunca duas em andamento.
 * Quando `run` rejeita, a próxima vem depois do intervalo normal e, a cada falha seguida, o
 * espaçamento dobra (até `max` × `ms`); volta ao normal no primeiro sucesso. Com a aba escondida
 * nada é pedido; ao voltar a aparecer, consulta na hora. Devolve a função que para tudo (para o
 * cleanup do useEffect).
 */
export function poll(run: () => Promise<unknown>, ms: number, opts: PollOptions = {}): () => void {
  const max = opts.max ?? 8;
  let stopped = false;
  let busy = false;
  let wait = ms;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
  };
  const tick = () => {
    if (stopped || busy) return;
    if (hidden()) return schedule(ms);
    clearTimeout(timer);
    busy = true;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(run());
    } catch (e) {
      result = Promise.reject(e);
    }
    let delay = ms;
    result
      .then(
        () => {
          wait = ms;
        },
        () => {
          delay = wait;
          wait = Math.min(wait * 2, ms * max);
        },
      )
      .then(() => {
        busy = false;
        if (!stopped) schedule(delay);
      });
  };
  const onVisible = () => {
    if (!hidden()) tick();
  };

  if (opts.immediate ?? true) tick();
  else schedule(ms);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

const hidden = () => typeof document !== 'undefined' && document.hidden;
