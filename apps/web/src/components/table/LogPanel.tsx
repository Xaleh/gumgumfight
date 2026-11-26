// O histórico da partida: as linhas no idioma da interface, a pesquisa e os nomes de carta que abrem a carta.

import { type CardDef, type GameState } from '@gumgum/engine';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT, useTryT } from '../../i18n';
import { logText } from '../../game/engineText';
import { type LogNames, logCardNames, resolveLogCard } from '../../game/logCards';
import { useSettings } from '../../settings';
import { CardHoverPreview } from '../CardInfo';
import { Icon } from '../Icons';
import { useMediaQuery } from './shared';

/** Texto sem acentos e em minúsculas, para a pesquisa do histórico achar "lider" em "Líder". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Histórico da partida. `fresh`: no replay, as linhas da ação atual (desta em diante) ficam destacadas.
 * Os nomes de cartas viram links: toque/clique abre a carta ampliada (`onCardZoom`); com mouse, passar por cima mostra a carta ao lado.
 *
 * `onSearching`: o histórico ganha a lupa, no canto. Aberta, um campo filtra as linhas pelo texto (sem diferenciar
 * maiúsculas nem acentos), mantendo a linha do turno de cada uma, e a mesa é avisada enquanto a pesquisa está
 * aberta (os atalhos de teclado param).
 */
export function LogPanel({
  state,
  fresh,
  onCardZoom,
  onSearching,
}: {
  state: GameState;
  fresh?: number | null;
  onCardZoom?: (def: CardDef) => void;
  onSearching?: (on: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [hover, setHover] = useState<{ def: CardDef; anchor: HTMLElement } | null>(null);
  const names = useMemo(() => logCardNames(state.defs), [state.defs]);
  const t = useT();
  const tryT = useTryT();
  const { shortcuts } = useSettings();
  /** A pesquisa: `null` = lupa fechada. */
  const [query, setQuery] = useState<string | null>(null);
  const searching = query !== null;
  useEffect(() => {
    if (!searching || !onSearching) return;
    onSearching(true);
    return () => onSearching(false);
  }, [searching, onSearching]);
  const needle = fold(query?.trim() ?? '');
  const { lines, found } = useMemo(() => {
    const all = state.log.map((e, i) => ({ e, i, text: logText(tryT, e) }));
    if (!needle) return { lines: all, found: all.length };
    const lines: typeof all = [];
    let found = 0;
    /** A linha "— Turno N —" das linhas achadas depois dela entra junto, para dar o contexto. */
    let turn: (typeof all)[number] | null = null;
    for (const line of all) {
      const hit = fold(line.text).includes(needle);
      if (line.e.text.startsWith('—') && !hit) {
        turn = line;
        continue;
      }
      if (!hit) continue;
      if (turn && !line.e.text.startsWith('—')) lines.push(turn);
      turn = null;
      lines.push(line);
      found++;
    }
    return { lines, found };
  }, [state.log, needle, tryT]);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [state.log.length, needle]);
  return (
    <>
        <div className="log" ref={ref} onScroll={() => setHover(null)}>
          {onSearching && (
            <div className={['log-search', searching ? 'open' : ''].join(' ')}>
              {searching ? (
                <>
                  <div className="log-search-row">
                    <Icon name="search" size={16} />
                    <input
                      type="search"
                      value={query}
                      autoFocus
                      placeholder={t('game.logSearchPlaceholder')}
                      aria-label={t('game.logSearch')}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return;
                        // O Esc fecha só a pesquisa (não a carta aberta nem a folha do histórico).
                        e.stopPropagation();
                        setQuery(null);
                      }}
                    />
                    {needle && <span className="log-search-count">{found > 0 ? t('game.logSearchCount', { n: found }) : t('game.logSearchNone')}</span>}
                    <button type="button" className="log-search-btn" onClick={() => setQuery(null)} aria-label={t('game.logSearchClose')} title={t('game.logSearchClose')}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  {shortcuts && <small className="log-search-note">{t('game.logSearchShortcuts')}</small>}
                </>
              ) : (
                <button type="button" className="log-search-btn" onClick={() => setQuery('')} aria-label={t('game.logSearch')} title={t('game.logSearch')}>
                  <Icon name="search" size={15} />
                </button>
              )}
            </div>
          )}
          {lines.map(({ e, i, text }) => (
            <div
              key={i}
              className={[
                'log-line',
                e.player === null ? '' : `p${e.player}`,
                e.text.startsWith('—') ? 'turn' : '',
                fresh != null && i >= fresh ? 'fresh' : '',
              ].join(' ')}
            >
              <LogText
                text={text}
                names={names}
                onCard={(name, nth) => {
                  const def = resolveLogCard(state, names, e, name, nth);
                  if (!def) return;
                  setHover(null);
                  onCardZoom?.(def);
                }}
                onHover={
                  canHover
                    ? (name, nth, el) => {
                        const def = el && resolveLogCard(state, names, e, name, nth);
                        setHover(def && el ? { def, anchor: el } : null);
                      }
                    : undefined
                }
              />
            </div>
          ))}
        </div>
        {/* No body: o painel lateral tem backdrop-filter, que prenderia um elemento fixo dentro dele. */}
        {canHover && hover && createPortal(<CardHoverPreview card={hover.def} anchor={hover.anchor} />, document.body)}
    </>
  );
}

/** Linha do histórico com os nomes de carta como botões. */
function LogText({
  text,
  names,
  onCard,
  onHover,
}: {
  text: string;
  names: LogNames;
  /** `nth`: quantas vezes o mesmo nome já apareceu antes na linha (0 = a primeira). */
  onCard: (name: string, nth: number) => void;
  onHover?: (name: string, nth: number, el: HTMLElement | null) => void;
}) {
  if (!names.regex) return <>{text}</>;
  const out: ReactNode[] = [];
  const seen = new Map<string, number>();
  let last = 0;
  for (const m of text.matchAll(names.regex)) {
    const start = (m.index ?? 0) + m[1].length;
    const name = m[2];
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <button
        key={start}
        type="button"
        className="log-card"
        onClick={() => onCard(name, nth)}
        onMouseEnter={onHover ? (e) => onHover(name, nth, e.currentTarget) : undefined}
        onMouseLeave={onHover ? () => onHover(name, nth, null) : undefined}
      >
        {name}
      </button>,
    );
    last = start + name.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
