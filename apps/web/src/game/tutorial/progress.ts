// Progresso do tutorial: no navegador (`localStorage`, vale sem internet e sem login) e no
// servidor (conta Google ou, sem login, o navegador), sincronizados por união: uma lição
// concluída num lugar vale no outro. Com login, o progresso acompanha a conta entre aparelhos.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { LESSONS } from './lessons';

const KEY = 'gumgum.tutorial';
const EVENT = 'gumgum:tutorial';

interface Progress {
  done: string[];
  /** "Já sei jogar": o convite da home não aparece mais. */
  dismissed?: boolean;
}

const known = new Set(LESSONS.map((l) => l.id));

function read(): Progress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    return { done: Array.isArray(v?.done) ? v!.done.filter((id) => known.has(id)) : [], dismissed: Boolean(v?.dismissed) };
  } catch {
    return { done: [] };
  }
}

function write(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sem armazenamento: o progresso vale só até fechar a aba */
  }
  window.dispatchEvent(new Event(EVENT));
}

const completedAll = (done: string[]) => LESSONS.every((l) => done.includes(l.id));

/** Manda o progresso deste navegador para o servidor (sem esperar; falhas ficam para a próxima sincronização). */
function push(reset = false) {
  const p = read();
  void api.tutorial.saveProgress({ done: p.done, dismissed: Boolean(p.dismissed), completed: completedAll(p.done), reset }).catch(() => undefined);
}

/**
 * Junta o progresso do navegador com o do servidor e grava a união nos dois. Chamado ao abrir o
 * app e quando a conta muda (ao entrar, o progresso feito sem login vai para a conta).
 */
export async function syncTutorialProgress(): Promise<void> {
  try {
    const remote = await api.tutorial.progress();
    const local = read();
    const done = [...new Set([...local.done, ...remote.done.filter((id) => known.has(id))])];
    const dismissed = Boolean(local.dismissed) || remote.dismissed;
    if (done.length !== local.done.length || dismissed !== Boolean(local.dismissed)) write({ done, dismissed });
    const completed = completedAll(done);
    if (done.length !== remote.done.length || dismissed !== remote.dismissed || (completed && !remote.apprentice)) {
      await api.tutorial.saveProgress({ done, dismissed, completed });
    }
  } catch {
    /* sem servidor: fica o progresso do navegador */
  }
}

/** Progresso salvo e as ações sobre ele (todas as telas abertas acompanham as mudanças). */
export function useTutorialProgress() {
  const [p, setP] = useState(read);
  useEffect(() => {
    const sync = () => setP(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const complete = useCallback((id: string) => {
    const cur = read();
    if (cur.done.includes(id)) return;
    write({ ...cur, done: [...cur.done, id] });
    push();
  }, []);
  const dismiss = useCallback(() => {
    write({ ...read(), dismissed: true });
    push();
  }, []);
  const reset = useCallback(() => {
    write({ ...read(), done: [] });
    push(true);
  }, []);
  const next = LESSONS.find((l) => !p.done.includes(l.id)) ?? null;
  return { done: p.done, dismissed: Boolean(p.dismissed), next, completedAll: completedAll(p.done), complete, dismiss, reset };
}
