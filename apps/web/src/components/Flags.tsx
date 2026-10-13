// Bandeiras dos idiomas da interface, em SVG (3:2). Emoji de bandeira não aparece no Windows
// (Chrome/Edge mostram as letras "BR", "GB"…), por isso os desenhos ficam aqui, simplificados
// para ler bem com 20–24 px de largura.

import { useId } from 'react';
import type { Locale } from '../i18n';

const ART: Record<Locale, JSX.Element> = {
  'pt-BR': (
    <>
      <rect width="60" height="40" fill="#009c3b" />
      <path d="M30 4 56 20 30 36 4 20Z" fill="#ffdf00" />
      <circle cx="30" cy="20" r="10.5" fill="#002776" />
      <path d="M20.4 17.6c6.5-1.6 13.3 0 18.8 4.6" fill="none" stroke="#fff" strokeWidth="1.8" />
    </>
  ),
  en: (
    <>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#fff" strokeWidth="8" />
      <path d="M0 0 60 40M60 0 0 40" stroke="#c8102e" strokeWidth="3" />
      <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="13" />
      <path d="M30 0v40M0 20h60" stroke="#c8102e" strokeWidth="8" />
    </>
  ),
  es: (
    <>
      <rect width="60" height="40" fill="#aa151b" />
      <rect y="10" width="60" height="20" fill="#f1bf00" />
    </>
  ),
  ja: (
    <>
      <rect width="60" height="40" fill="#fff" />
      <circle cx="30" cy="20" r="12" fill="#bc002d" />
    </>
  ),
  fr: (
    <>
      <rect width="20" height="40" fill="#0055a4" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#ef4135" />
    </>
  ),
  de: (
    <>
      <rect width="60" height="13.4" fill="#000" />
      <rect y="13.3" width="60" height="13.4" fill="#d00" />
      <rect y="26.6" width="60" height="13.4" fill="#ffce00" />
    </>
  ),
};

/** Bandeira do idioma; `width` em px (altura = 2/3). Decorativa: o nome vai no botão em volta. */
export function Flag({ locale, width = 24, className }: { locale: Locale; width?: number; className?: string }) {
  const id = useId();
  return (
    <svg className={['flag', className ?? ''].join(' ').trim()} width={width} height={(width * 2) / 3} viewBox="0 0 60 40" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id}>
          <rect width="60" height="40" rx="6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{ART[locale]}</g>
      <rect width="60" height="40" rx="6" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
    </svg>
  );
}
