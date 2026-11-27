// Ilustrações das dicas de regra do cartão da espera (`WaitTips.tsx`): uma cena pequena por dica, desenhada aqui
// em SVG. São originais do GumGum Fight (cartas genéricas, sem arte da Bandai nem da Toei) e não têm texto que
// precise de tradução: só números e os termos do jogo que não se traduzem (DON!!, Rush).
//
// As cores são fixas, sobre um fundo creme: a ilustração é a mesma no tema claro e no escuro, como um adesivo.

import type { ReactNode } from 'react';
import type { RULE_TIPS } from '../waitTips';

export type RuleTipKey = (typeof RULE_TIPS)[number];

const INK = '#3d1a10';
const FACE = '#fbf3df';
const NAVY = '#1f2a5a';
const GOLD = '#f2b733';
const DANGER = '#e5484d';
const ACCENT = '#ee6f3c';
const OK = '#239062';

const TONE = { red: '#d23b2e', green: '#239062', blue: '#2f6db5', purple: '#7d3c98', yellow: '#d3a80d', black: '#2c2c34' } as const;
type Tone = keyof typeof TONE;

const TEXT = { fontFamily: 'inherit', fontWeight: 900, textAnchor: 'middle', dominantBaseline: 'central' } as const;

/** Uma carta pequena (proporção 1 × 1,4): a frente na cor `tone`, o verso (`back`) ou um DON!! (`don`). */
function Card({
  x,
  y,
  w = 20,
  tone = 'red',
  rot = 0,
  back,
  don,
  dim,
  children,
}: {
  x: number;
  y: number;
  w?: number;
  tone?: Tone;
  rot?: number;
  back?: boolean;
  don?: boolean;
  dim?: boolean;
  children?: ReactNode;
}) {
  const h = w * 1.4;
  const r = w * 0.12;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})`} opacity={dim ? 0.4 : 1}>
      {back ? (
        <>
          <rect width={w} height={h} rx={r} fill={NAVY} stroke={INK} strokeWidth={1.2} />
          <circle cx={w / 2} cy={h / 2} r={w * 0.27} fill="none" stroke={GOLD} strokeWidth={1.3} />
          <circle cx={w / 2} cy={h / 2} r={w * 0.09} fill={GOLD} />
        </>
      ) : don ? (
        <>
          <rect width={w} height={h} rx={r} fill="#fff" stroke={INK} strokeWidth={1.2} />
          <rect x={w * 0.1} y={h * 0.34} width={w * 0.8} height={h * 0.32} rx={1.6} fill={INK} />
          <text x={w / 2} y={h * 0.5} fontSize={w * 0.25} fill="#fff" {...TEXT}>
            DON!!
          </text>
        </>
      ) : (
        <>
          <rect width={w} height={h} rx={r} fill={FACE} stroke={TONE[tone]} strokeWidth={1.8} />
          <path d={`M0.9 ${h * 0.24}V${r}a${r - 0.9} ${r - 0.9} 0 0 1 ${r - 0.9} ${-(r - 0.9)}H${w - r}a${r - 0.9} ${r - 0.9} 0 0 1 ${r - 0.9} ${r - 0.9}V${h * 0.24}z`} fill={TONE[tone]} />
          <rect x={w * 0.16} y={h * 0.36} width={w * 0.68} height={1.6} rx={0.8} fill={INK} opacity={0.5} />
          <rect x={w * 0.16} y={h * 0.47} width={w * 0.42} height={1.4} rx={0.7} fill={INK} opacity={0.28} />
        </>
      )}
      {children}
    </g>
  );
}

/** Coração da Vida (`empty`: só o contorno). `s`: o lado da caixa. */
function Heart({ x, y, s, empty }: { x: number; y: number; s: number; empty?: boolean }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s / 24})`}
      d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.5 6.4 4.5c2.2 0 3.9 1.2 5.6 3.3 1.7-2.1 3.4-3.3 5.6-3.3 3.700 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"
      fill={empty ? 'none' : DANGER}
      stroke={empty ? DANGER : INK}
      strokeWidth={empty ? 2.4 : 1.4}
      strokeLinejoin="round"
    />
  );
}

/** Etiqueta arredondada com um texto curto, centrada em (`x`, `y`). */
function Pill({ x, y, text, fill = INK, color = '#fff', size = 7 }: { x: number; y: number; text: string; fill?: string; color?: string; size?: number }) {
  const w = text.length * size * 0.62 + size;
  const h = size * 1.7;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={fill} stroke={INK} strokeWidth={1} />
      <text x={x} y={y + 0.3} fontSize={size} fill={color} {...TEXT}>
        {text}
      </text>
    </g>
  );
}

/** Número dentro de um círculo (a ordem de um passo, o turno). */
function Num({ x, y, n, r = 6, fill = INK }: { x: number; y: number; n: number; r?: number; fill?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} stroke="#fff" strokeWidth={1.4} />
      <text x={x} y={y + 0.3} fontSize={r * 1.25} fill="#fff" {...TEXT}>
        {n}
      </text>
    </g>
  );
}

/** Sinal de "não pode": círculo cortado (`veil`: clareia o que está atrás, para o sinal aparecer sobre uma carta escura). */
function No({ x, y, r, w = 2.6, veil }: { x: number; y: number; r: number; w?: number; veil?: boolean }) {
  const k = r * 0.707;
  return (
    <g fill="none" stroke={DANGER} strokeWidth={w} strokeLinecap="round">
      <circle cx={x} cy={y} r={r} fill={veil ? 'rgba(255,255,255,0.55)' : 'none'} />
      <path d={`M${x - k} ${y - k}L${x + k} ${y + k}`} />
    </g>
  );
}

/** Seta reta, com a ponta em (`x2`, `y2`). */
function Arrow({ x1, y1, x2, y2, color = INK, w = 2.4 }: { x1: number; y1: number; x2: number; y2: number; color?: string; w?: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = w * 2.2;
  const p = (da: number) => `${x2 - head * Math.cos(a + da)} ${y2 - head * Math.sin(a + da)}`;
  return (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x1} ${y1}L${x2} ${y2}`} />
      <path d={`M${p(0.55)}L${x2} ${y2}L${p(-0.55)}`} />
    </g>
  );
}

const SCENES: Record<RuleTipKey, ReactNode> = {
  // Quem começa: não compra, e 1 DON!! só.
  'wait.tip.firstTurn': (
    <>
      <Card x={11} y={21} w={22} back />
      <Card x={8} y={24} w={22} back />
      <No x={19} y={39.5} r={11} veil />
      <Card x={47} y={22} w={23} don rot={6} />
      <Pill x={59} y={64} text="×1" fill={GOLD} color={INK} size={8} />
    </>
  ),
  // Ninguém ataca no seu primeiro turno.
  'wait.tip.noFirstAttack': (
    <>
      <g stroke={INK} strokeWidth={4.2} strokeLinecap="round">
        <path d="M22 60L54 24" />
        <path d="M58 60L26 24" />
      </g>
      <g stroke={GOLD} strokeWidth={3.4} strokeLinecap="round">
        <path d="M21 46L33 57" />
        <path d="M59 46L47 57" />
      </g>
      <No x={40} y={42} r={25} w={4} />
      <Num x={63} y={17} n={1} r={9} fill={ACCENT} />
    </>
  ),
  // Sem [Rush], não ataca no turno em que entra.
  'wait.tip.rush': (
    <>
      <g stroke={ACCENT} strokeWidth={3.2} strokeLinecap="round">
        <path d="M9 26H27" />
        <path d="M5 37H25" />
        <path d="M11 48H27" />
      </g>
      <Card x={35} y={13} w={27} tone="red" rot={9} />
      <Pill x={49} y={65} text="Rush" fill={GOLD} color={INK} size={8} />
    </>
  ),
  // Só Personagem em repouso pode ser atacado.
  'wait.tip.rested': (
    <>
      <Card x={6} y={26} w={18} tone="purple" dim />
      <Card x={42} y={26} w={20} tone="blue" rot={90} />
      <g fill="none" stroke={DANGER} strokeWidth={2.6} strokeLinecap="round">
        <circle cx={52} cy={40} r={18} />
        <path d="M52 16v7M52 57v7M29 40h6M69 40h6" />
      </g>
    </>
  ),
  // Empate de poder: o ataque passa.
  'wait.tip.tie': (
    <>
      <Card x={7} y={9} w={23} tone="red" />
      <Card x={50} y={9} w={23} tone="green" />
      <Pill x={18.500} y={49} text="5000" size={6.4} />
      <Pill x={61.500} y={49} text="5000" size={6.4} />
      <g stroke={INK} strokeWidth={3} strokeLinecap="round">
        <path d="M35 22h10M35 29h10" />
      </g>
      <circle cx={40} cy={66} r={8.500} fill={OK} stroke="#fff" strokeWidth={1.6} />
      <path d="M35.6 66.2l3.1 3.1 5.8-6.200" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Primeiro o [Blocker], depois o Counter.
  'wait.tip.blockThenCounter': (
    <>
      <path transform="translate(5 22) scale(1.55)" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill={TONE.blue} stroke={INK} strokeWidth={1} strokeLinejoin="round" />
      <path d="M17.500 40.500l4.200 4.200 7.300-8.200" fill="none" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      <Arrow x1={40} y1={41} x2={47} y2={41} />
      <Pill x={62} y={41} text="+2000" fill={GOLD} color={INK} size={6.2} />
      <Num x={23.500} y={14} n={1} />
      <Num x={62} y={25} n={2} />
    </>
  ),
  // DON!! anexado: +1000 só no seu turno.
  'wait.tip.don': (
    <>
      <Card x={15} y={20} w={23} don rot={-13} />
      <Card x={36} y={13} w={26} tone="purple" />
      <Pill x={49} y={64} text="+1000" fill={GOLD} color={INK} size={7} />
    </>
  ),
  // Mulligan: devolve as 5 e compra outras 5.
  'wait.tip.mulligan': (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <Card key={i} x={9 + i * 11} y={13 + Math.abs(i - 2) * 2.500} w={15} back rot={(i - 2) * 9} />
      ))}
      <g fill="none" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 53a19 12 0 0 0 36 0" />
        <path d="M51.500 54.500L58 52.500l2 6.500" />
      </g>
    </>
  ),
  // 0 de Vida ainda não é derrota.
  'wait.tip.zeroLife': (
    <>
      <Card x={8} y={17} w={27} tone="red">
        <path d="M7.500 5.800l3 2.300 3-3.300 3 3.300 3-2.300-1 4H8.500z" fill={GOLD} />
      </Card>
      <Heart x={40} y={20} s={34} empty />
      <text x={57} y={37} fontSize={13} fill={INK} {...TEXT}>
        0
      </text>
    </>
  ),
  // Deck com 0 cartas: derrota.
  'wait.tip.deckOut': (
    <>
      <rect x={17} y={13} width={34} height={47.6} rx={4.5} fill="rgba(255,255,255,0.5)" stroke={INK} strokeWidth={2} strokeDasharray="5 4" />
      <text x={34} y={37} fontSize={22} fill={INK} {...TEXT}>
        0
      </text>
      <circle cx={57} cy={57} r={11} fill={DANGER} stroke="#fff" strokeWidth={1.8} />
      <path d="M52.500 52.500l9 9M61.500 52.500l-9 9" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" />
    </>
  ),
  // [Trigger]: a carta da Vida revelada.
  'wait.tip.trigger': (
    <>
      <Card x={7} y={24} w={21} back rot={-9} />
      <Arrow x1={33} y1={40} x2={41} y2={40} />
      <Card x={46} y={15} w={26} tone="yellow" />
      <path transform="translate(48.500 30) scale(0.88)" d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" fill={GOLD} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    </>
  ),
  // [Double Attack]: 2 de dano; [Banish]: a carta vai para o descarte.
  'wait.tip.doubleBanish': (
    <>
      <Heart x={8} y={11} s={31} />
      <Heart x={41} y={11} s={31} />
      <g stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M24 20l-3 5 5 3-3 6" />
        <path d="M57 20l-3 5 5 3-3 6" />
      </g>
      <Pill x={40} y={59} text="−2" size={10} />
    </>
  ),
  // No máximo 5 Personagens.
  'wait.tip.fiveCharacters': (
    <>
      {(['red', 'blue', 'green', 'purple', 'yellow'] as const).map((tone, i) => (
        <Card key={tone} x={5 + i * 14.400} y={11} w={12} tone={tone} />
      ))}
      <Card x={10} y={41} w={15} tone="black" />
      <Arrow x1={31} y1={52} x2={43} y2={52} color={DANGER} />
      <path transform="translate(47 39) scale(1.1)" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

/** A ilustração da dica (decorativa: o texto ao lado diz tudo). */
export function TipArt({ tip }: { tip: RuleTipKey }) {
  return (
    <svg className="tip-art" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <rect width={80} height={80} rx={14} fill="#f6e7c3" />
      {SCENES[tip]}
    </svg>
  );
}
