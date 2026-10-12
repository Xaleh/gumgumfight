// Progresso do tutorial neste navegador (sem login): lições concluídas e o aviso da home.

import { useCallback, useEffect, useState } from 'react';
import { LESSONS } from './lessons';

const KEY = 'gumgum.tutorial';
const EVENT = 'gumgum:tutorial';

interface Progress {
  done: string[];
  /** "Já sei jogar": o convite da home não aparece mais. */
  dismissed?: boolean;
}

function read(): Progress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    const known = new Set(LESSONS.map((l) => l.id));
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
    if (!cur.done.includes(id)) write({ ...cur, done: [...cur.done, id] });
  }, []);
  const dismiss = useCallback(() => write({ ...read(), dismissed: true }), []);
  const reset = useCallback(() => write({ done: [] }), []);
  const next = LESSONS.find((l) => !p.done.includes(l.id)) ?? null;
  return { done: p.done, dismissed: Boolean(p.dismissed), next, complete, dismiss, reset };
}
