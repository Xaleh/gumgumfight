// O booster na tela: a arte do produto (`public/boosters/<COLEÇÃO>.webp`) quando existe, senão um
// booster desenhado com a cor tirada do código da coleção. E a animação de abrir um booster: ele
// chega ao centro, estoura em luz, a embalagem rasga e as cartas voam para a mesa viradas para baixo,
// para o jogador virar (`BoosterOpening`).

import { type CardData, isBoosterSet, isCube, isRush } from '@gumgum/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio';
import { useT } from '../i18n';
import { StaticCard } from './CardView';

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

/**
 * Como a abertura termina:
 *  - `reveal`: as cartas voam para a mesa viradas para baixo e o jogador as vira (uma a uma, ou
 *    "Revelar tudo"), depois continua;
 *  - `auto`: o mesmo, mais rápido, e as cartas viram sozinhas (vários boosters em sequência);
 *  - `burst`: só o booster estourando e a pilha de cartas subindo (a rodada do Draft, e as animações suaves).
 */
export type OpeningMode = 'reveal' | 'auto' | 'burst';

/** Os tempos da abertura (ms, na velocidade 1): quando o booster estoura, quando as cartas saem da pilha, de quanto em quanto, e o voo de cada uma. */
const T = { burst: 1300, deal: 1900, step: 55, fly: 480, flip: 480, autoStep: 45, autoHold: 520 } as const;
const SPEED: Record<OpeningMode, number> = { reveal: 1, auto: 0.58, burst: 0.8 };

/** Faíscas do estouro: ângulo, alcance, tamanho, duração, atraso e cor, fixos por índice (sem sorteio, para o desenho não mudar a cada render). */
const SPARKS = Array.from({ length: 30 }, (_, i) => ({
  a: i * 12 + ((i * 37) % 11),
  r: 26 + ((i * 53) % 34),
  s: 4 + ((i * 7) % 6),
  d: 520 + ((i * 97) % 420),
  w: (i * 29) % 160,
  c: ['#fff6d6', '#ffd166', '#ff9f43', '#ff6bcb', '#9b8cff'][i % 5],
}));

/** Destaque de uma carta na abertura: SEC brilha em arco-íris; SR e Líder, em dourado. */
const tierOf = (card: CardData): '' | 'hit' | 'top' => (card.rarity === 'SEC' ? 'top' : card.category === 'leader' || card.rarity === 'SR' ? 'hit' : '');

/** Colunas, tamanho das cartas e espaço entre elas para a mesa caber na tela. */
function useTable(n: number) {
  const calc = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw < 720;
    const gap = narrow ? 8 : 14;
    const fit = (wanted: number) => {
      const cols = Math.max(1, Math.min(n || 1, wanted));
      const rows = Math.ceil((n || 1) / cols);
      const width = (Math.min(vw - 32, 1180) - gap * (cols - 1)) / cols;
      const height = (vh - (narrow ? 210 : 240) - gap * (rows - 1)) / rows / 1.396;
      return { cols, rows, gap, cw: Math.floor(Math.max(44, Math.min(width, height, 190))) };
    };
    // No celular, 3 ou 4 colunas: a que deixar as cartas maiores na tela.
    return (narrow ? [3, 4] : [6]).map(fit).sort((a, b) => b.cw - a.cw)[0];
  };
  const [table, setTable] = useState(calc);
  useEffect(() => {
    const on = () => setTable(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return table;
}

/**
 * Um booster sendo aberto, por cima da tela: ele chega ao centro com um brilho, treme, estoura em
 * raios de luz enquanto a embalagem rasga, a pilha de cartas sobe e as cartas voam para a mesa
 * viradas para baixo (as de destaque já brilhando). `onDone` fecha; "Pular" ou Esc chamam `onSkip`
 * (ou `onDone`). Quem chama decide se mostra (animações ligadas nas configurações) e o modo.
 */
export function BoosterOpening({
  set,
  draft,
  label,
  cards = [],
  mode,
  quick,
  onDone,
  onSkip,
}: {
  set: string;
  draft?: boolean;
  label: string;
  /** As cartas do booster, na ordem (sem elas, a abertura é só o estouro). */
  cards?: readonly CardData[];
  mode: OpeningMode;
  /** Ainda mais curta (animações suaves). */
  quick?: boolean;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const t = useT();
  const withCards = mode !== 'burst' && cards.length > 0;
  const k = quick ? 0.65 : SPEED[mode];
  const [phase, setPhase] = useState<'cine' | 'reveal'>('cine');
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set());
  const table = useTable(cards.length);
  const done = useRef(onDone);
  const skip = useRef(onSkip ?? onDone);
  done.current = onDone;
  skip.current = onSkip ?? onDone;
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const canHover = useMemo(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);

  // A linha do tempo: o som do booster, o estouro, as cartas saindo e a hora de o jogador virar.
  useEffect(() => {
    audio.play('shuffle');
    later(T.burst * k, () => audio.play('trigger'));
    if (withCards) {
      for (let i = 0; i < Math.min(cards.length, 5); i++) later((T.deal + i * T.step * 2.4) * k, () => audio.play('draw'));
      later((T.deal + (cards.length - 1) * T.step + T.fly + 60) * k, () => setPhase('reveal'));
    } else later((T.burst + 760) * k, () => done.current());
    // A abertura é montada uma vez por booster (`key`): a linha do tempo não recomeça.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = (i: number, quiet = false) => {
    setShown((s) => (s.has(i) ? s : new Set(s).add(i)));
    const tier = cards[i] ? tierOf(cards[i]) : '';
    if (tier) audio.play('ability');
    else if (!quiet) audio.play('play');
  };
  const revealAll = () => {
    let n = 0;
    cards.forEach((_, i) => {
      if (shown.has(i)) return;
      later(n * T.autoStep, () => reveal(i, n % 2 === 1));
      n++;
    });
    return n;
  };
  const allShown = shown.size >= cards.length;
  // Vários boosters em sequência: as cartas viram sozinhas e a abertura segue para o próximo.
  useEffect(() => {
    if (phase !== 'reveal' || mode !== 'auto') return;
    const n = revealAll();
    later(n * T.autoStep + T.flip + T.autoHold, () => done.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode]);

  const primary = () => {
    if (phase === 'reveal' && mode === 'reveal') {
      if (allShown) done.current();
      else revealAll();
    } else skip.current();
  };
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        skip.current();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        primaryRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const style = { ['--k' as string]: k, ['--cw' as string]: `${table.cw}px`, ['--gap' as string]: `${table.gap}px` };
  return (
    <div
      className={['po', `po-${mode}`, phase === 'reveal' ? 'po-revealing' : ''].join(' ')}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={mode === 'burst' ? () => skip.current() : undefined}
    >
      <div className="po-title">{label}</div>
      <div className="po-stage">
        <span className="po-rays" />
        <span className="po-rays po-rays-2" />
        <span className="po-ring" />
        <span className="po-flash" />
        <div className="po-anchor po-sparks" aria-hidden="true">
          {SPARKS.map((p, i) => (
            <i key={i} style={{ ['--a' as string]: `${p.a}deg`, ['--r' as string]: `${p.r}vmin`, ['--s' as string]: `${p.s}px`, ['--d' as string]: `${p.d}ms`, ['--w' as string]: `${p.w}ms`, ['--c' as string]: p.c }} />
          ))}
        </div>
        <div className="po-anchor" aria-hidden="true">
          <div className="po-pack">
            <div className="po-pack-inner">
              <div className="po-half po-left">
                <Booster set={set} draft={draft} big />
              </div>
              <div className="po-half po-right">
                <Booster set={set} draft={draft} big />
              </div>
              <span className="po-glint" />
            </div>
          </div>
        </div>
        <div className="po-anchor" aria-hidden="true">
          <div className="po-stack">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ ['--i' as string]: i }} />
            ))}
          </div>
        </div>
        {withCards && (
          <div className="po-anchor po-table">
            {cards.map((card, i) => {
              const row = Math.floor(i / table.cols);
              const inRow = Math.min(table.cols, cards.length - row * table.cols);
              const tier = tierOf(card);
              const up = shown.has(i);
              const flip = () => phase === 'reveal' && !up && reveal(i);
              return (
                <div
                  key={`${card.id}-${i}`}
                  className={['po-card', tier, up ? 'shown' : ''].join(' ')}
                  style={{ ['--x' as string]: (i % table.cols) - (inRow - 1) / 2, ['--y' as string]: row - (table.rows - 1) / 2, ['--i' as string]: i }}
                  role="button"
                  tabIndex={phase === 'reveal' && !up ? 0 : -1}
                  aria-label={up ? card.name : t('sealed.openFaceDown', { n: i + 1 })}
                  onClick={flip}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    flip();
                  }}
                >
                  <span className="po-flipper">
                    <span className="po-back" />
                    <span className="po-face">
                      <StaticCard card={card} />
                    </span>
                  </span>
                  {up && tier && <span className="po-tag">{card.category === 'leader' ? t('card.cat.leader') : card.rarity}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="po-actions">
        {phase === 'reveal' && mode === 'reveal' && (
          <>
            {!allShown && <span className="po-hint">{canHover ? t('sealed.openHintMouse') : t('sealed.openHintTouch')}</span>}
            <button type="button" className="mode-btn sealed-cta" onClick={primary}>
              {allShown ? t('sealed.openContinue') : t('sealed.openRevealAll')}
            </button>
          </>
        )}
        {mode !== 'burst' && (phase === 'cine' || mode === 'auto') && (
          <button
            type="button"
            className="btn po-skip"
            onClick={(e) => {
              e.stopPropagation();
              skip.current();
            }}
          >
            {t('sealed.openSkip')}
          </button>
        )}
      </div>
    </div>
  );
}
