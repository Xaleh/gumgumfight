// O booster na tela: a arte do produto (`public/boosters/<COLEÇÃO>.webp`) quando existe, senão um
// booster desenhado com a cor tirada do código da coleção. E a animação de abrir um booster: ele
// treme, o topo rasga e as cartas sobem, antes de a tela revelar o que saiu.

import { isBoosterSet, isCube, isRush } from '@gumgum/engine';
import { useEffect, useRef, useState } from 'react';

/** A arte do booster de uma coleção (o arquivo pode não existir: `Booster` cai no desenho). */
export const boosterArt = (set: string) => `/boosters/${set.toUpperCase()}.webp`;

/** Coleções cuja arte falhou ao carregar nesta sessão: não tenta de novo a cada desenho. */
const missingArt = new Set<string>();

export function Booster({ set, small, big, state, draft }: { set: string; small?: boolean; big?: boolean; state?: 'open' | 'current'; draft?: boolean }) {
  // Coleções vizinhas com cores bem diferentes: o número da coleção anda de 47 em 47 graus.
  // O deck de Pack Rush (várias coleções) tem um booster próprio, dourado; o de Draft, roxo; o do Cubo, verde-água.
  const mixed = isRush(set);
  const cube = isCube(set);
  const hue = cube ? 168 : draft ? 280 : mixed ? 42 : (Number(set.replace(/\D/g, '')) * 47 + (set.startsWith('EB') ? 150 : set.startsWith('PRB') ? 270 : 190)) % 360;
  const wantsArt = !cube && !draft && !mixed && isBoosterSet(set);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [set]);
  const art = wantsArt && !failed && !missingArt.has(set);
  return (
    <span className={['sealed-pack', small ? 'small' : '', big ? 'big' : '', state ?? '', art ? 'art' : ''].join(' ')} style={{ ['--h' as string]: hue }} aria-hidden="true">
      <b>{cube ? 'CUBO' : draft ? 'DRAFT' : mixed ? 'RUSH' : set}</b>
      {art && (
        <img
          src={boosterArt(set)}
          alt=""
          draggable={false}
          onError={() => {
            missingArt.add(set);
            setFailed(true);
          }}
        />
      )}
    </span>
  );
}

/** Duração da animação de abrir (ms): a completa e a curta (vários boosters em sequência, ou o da rodada do Draft). */
export const OPENING_MS = { full: 1700, fast: 1000 } as const;

/**
 * Um booster sendo aberto, por cima da tela. Termina sozinho (`onDone`); clicar, tocar ou apertar
 * Esc, Enter ou Espaço pula (`onSkip`, ou `onDone` se não houver). Quem chama decide se mostra
 * (com as animações ligadas nas configurações) e se usa a versão curta (`fast`).
 */
export function BoosterOpening({ set, draft, label, fast, onDone, onSkip }: { set: string; draft?: boolean; label: string; fast?: boolean; onDone: () => void; onSkip?: () => void }) {
  const done = useRef(onDone);
  const skip = useRef(onSkip ?? onDone);
  done.current = onDone;
  skip.current = onSkip ?? onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), fast ? OPENING_MS.fast : OPENING_MS.full);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        skip.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', key);
    };
  }, [fast]);
  return (
    <div className={['pack-opening', fast ? 'fast' : ''].join(' ')} role="status" aria-label={label} onClick={() => skip.current()}>
      <div className="pack-opening-stage">
        <span className="pack-opening-glow" />
        <div className="pack-opening-cards">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>
        <div className="pack-opening-body">
          <Booster set={set} draft={draft} big />
        </div>
        <div className="pack-opening-top">
          <Booster set={set} draft={draft} big />
        </div>
      </div>
      <span className="pack-opening-label">{label}</span>
    </div>
  );
}
