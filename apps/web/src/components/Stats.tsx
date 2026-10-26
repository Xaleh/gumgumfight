import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type CardInfo,
  type CardStatsResponse,
  type GlobalCompare,
  type GlobalMatchups,
  type GlobalQueue,
  type GlobalStats,
  type GlobalTrendResponse,
  type PlayerProfile,
  type SplitCount,
  type StatsMeta,
  type StatsOverview,
  type StatsQuery,
  type StatsSummary,
  type TrendResponse,
  type WinCount,
} from '../api';
import { type Locale, type Translate, useLocale, useT } from '../i18n';
import { useAuth } from '../auth';
import { fmtBerries, fmtDateTime, fmtNumber } from '../i18n/format';
import { Icon } from './Icons';
import { LeaderArt } from './LeaderArt';
import { SupportModal } from './Support';

/** Abaixo disso, a taxa é mostrada esmaecida (amostra pequena). */
const MIN_GAMES = 10;
const FILTERS_KEY = 'gumgum.statsFilters';
const MIN_KEY = 'gumgum.statsMin';
const SCOPE_KEY = 'gumgum.statsScope';
const QUEUE_KEY = 'gumgum.statsGlobalQueue';

/**
 * Geral: partidas casuais, treino contra o bot e salas privadas. Pro: ranqueada e torneios encerrados.
 * Global: as filas do TCG Matchmaking (meta global, baixado pelo servidor).
 */
type Scope = 'general' | 'pro' | 'global';

function loadScope(): Scope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v === 'pro' || v === 'global' ? v : 'general';
  } catch {
    return 'general';
  }
}

function loadQueue(): string {
  try {
    return localStorage.getItem(QUEUE_KEY) ?? '';
  } catch {
    return '';
  }
}

type Tab = 'leaders' | 'matchups' | 'trend' | 'cards';
type GlobalTab = 'leaders' | 'matchups' | 'trend' | 'compare';

const rate = (w: WinCount) => (w.games ? w.wins / w.games : null);

/** Como segundo: a contagem própria quando existe (meta global, onde só parte das partidas diz quem começou), senão o que não foi como primeiro. */
const secondOf = (w: WinCount & { firstGames: number; firstWins: number } & Partial<SplitCount>): WinCount =>
  w.secondGames !== undefined && w.secondWins !== undefined
    ? { games: w.secondGames, wins: w.secondWins }
    : { games: w.games - w.firstGames, wins: w.wins - w.firstWins };
const fmtPct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

/**
 * Troca cada `{token}` que sobrou na mensagem traduzida por um nó React (negrito, nome de carta),
 * mantendo a ordem das palavras do idioma. Os demais parâmetros já foram preenchidos por `t()`.
 */
function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!(m[1] in nodes)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<Fragment key={m.index}>{nodes[m[1]]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Intervalo de Wilson (95%): quanto a taxa ainda pode variar com essa amostra. */
function wilson({ wins, games }: WinCount): [number, number] | null {
  if (!games) return null;
  const z = 1.96;
  const p = wins / games;
  const den = 1 + (z * z) / games;
  const mid = (p + (z * z) / (2 * games)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** Cor divergente: abaixo de 50% laranja, acima azul, cinza no meio. */
function rateColor(r: number | null): string | undefined {
  if (r === null) return undefined;
  const d = Math.max(-1, Math.min(1, (r - 0.5) / 0.25));
  const alpha = 0.12 + Math.abs(d) * 0.55;
  return d >= 0 ? `rgba(47, 125, 246, ${alpha})` : `rgba(232, 89, 12, ${alpha})`;
}

function loadMin(): number {
  try {
    return Number(localStorage.getItem(MIN_KEY) ?? 10) || 1;
  } catch {
    return 10;
  }
}

function loadFilters(): StatsQuery {
  try {
    // `by` fica sempre em `human`: o filtro de simulações bot x bot não existe mais na tela.
    return { ...(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') as StatsQuery), by: 'human' };
  } catch {
    return { by: 'human' };
  }
}

/** Amostra das Estatísticas Pro para quem não tem o plano: o top 3 aberto e o resto com cadeado. */
function ProTeaser({ format, onSupport }: { format?: string; onSupport: (() => void) | null }) {
  const t = useT();
  const { user } = useAuth();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.statsTeaser>> | null>(null);
  useEffect(() => {
    api
      .statsTeaser(format)
      .then(setData)
      .catch(() => setData(null));
  }, [format]);
  return (
    <section className="menu-card stats-panel pro-teaser">
      <h3>
        <Icon name="lock" size={18} /> {t('stats.proTitle')}
      </h3>
      <p>{t('stats.proBody')}</p>
      {data && data.total > 0 && (
        <>
          <p className="muted small">{t('stats.proSample', { n: data.total, leaders: data.leaders })}</p>
          <table className="stats-table">
            <tbody>
              {data.top.map((l, i) => (
                <tr key={l.leader}>
                  <td className="muted">{t('stats.proRank', { n: i + 1 })}</td>
                  <td>
                    <CardName id={l.leader} info={data.cards[l.leader]} />
                  </td>
                  <td className="num">{((l.games / data.total) * 100).toFixed(1)}%</td>
                  <td className="num">
                    <WinRate w={l} compact />
                  </td>
                </tr>
              ))}
              {[0, 1, 2].map((i) => (
                <tr key={`locked-${i}`} className="locked-row" aria-hidden="true">
                  <td className="muted">{t('stats.proRank', { n: i + 4 })}</td>
                  <td>
                    <span className="locked-bar" />
                  </td>
                  <td className="num">
                    <Icon name="lock" size={14} />
                  </td>
                  <td className="num">
                    <Icon name="lock" size={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data && data.total === 0 && <p className="muted small">{t('stats.proEmpty')}</p>}
      <div className="btn-row">
        {onSupport && (
          <button className="btn primary" onClick={onSupport}>
            <Icon name="heart" size={18} /> {t('stats.proSupport')}
          </button>
        )}
      </div>
      {!user && <p className="muted small">{t('stats.proLogin')}</p>}
      <p className="muted small">{t('stats.proMine')}</p>
    </section>
  );
}

/** Faixa de recompensa de um tier: "฿ 0 a ฿ 999" ou "฿ 10.000 ou mais". */
function tierSpan(t: Translate, locale: Locale, tier: { min: number; max: number | null }): string {
  return tier.max === null
    ? t('stats.tierOpen', { min: fmtBerries(tier.min, locale) })
    : t('stats.tierSpan', { min: fmtBerries(tier.min, locale), max: fmtBerries(tier.max, locale) });
}

function WinRate({ w, compact }: { w: WinCount; compact?: boolean }) {
  const t = useT();
  const r = rate(w);
  const ci = wilson(w);
  const small = w.games < MIN_GAMES;
  const title = ci
    ? t('stats.winRateTitle', { wins: w.wins, games: w.games, lo: fmtPct(ci[0]), hi: fmtPct(ci[1]) })
    : t('stats.noGames');
  return (
    <span className={['winrate', small ? 'small-sample' : ''].join(' ')} title={title}>
      <b>{fmtPct(r)}</b>
      {!compact && <span className="muted small"> {w.games}</span>}
    </span>
  );
}

function WinBar({ w }: { w: WinCount }) {
  const t = useT();
  const r = rate(w);
  const ci = wilson(w);
  return (
    <div className="wr-bar" title={ci ? t('stats.ciTitle', { lo: fmtPct(ci[0]), hi: fmtPct(ci[1]) }) : undefined}>
      <span className="wr-mid" />
      {ci && <span className="wr-ci" style={{ left: `${ci[0] * 100}%`, width: `${(ci[1] - ci[0]) * 100}%` }} />}
      {r !== null && <span className="wr-dot" style={{ left: `${r * 100}%` }} />}
    </div>
  );
}

function CardName({ id, info }: { id: string; info?: CardInfo }) {
  return (
    <span className="stat-card" title={id}>
      <LeaderArt name={info?.name ?? id} image={info?.imageUrl} colors={info?.colors} size="tiny" />
      <span className="stat-card-name">
        {info?.name ?? id}
        <span className="muted small"> {id}</span>
      </span>
    </span>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg small">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Tabela ordenável por coluna. */
function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<{ key: K; desc: boolean }>({ key: initial, desc: true });
  const th = (key: K, label: string, title?: string) => (
    <th
      className={['sortable', sort.key === key ? 'on' : ''].join(' ')}
      title={title}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  );
  const apply = <R,>(rows: R[], value: (r: R, k: K) => number | null) =>
    [...rows].sort((a, b) => {
      const va = value(a, sort.key) ?? -1;
      const vb = value(b, sort.key) ?? -1;
      return sort.desc ? vb - va : va - vb;
    });
  return { th, apply };
}

function Profile({
  me,
  tiers,
  onRename,
}: {
  me: PlayerProfile | null;
  tiers: StatsMeta['tiers'];
  onRename: (p: PlayerProfile) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const tier = tiers.find((t) => t.id === me?.tier) ?? tiers[0];
  const next = tiers[tiers.indexOf(tier) + 1];
  const save = async () => {
    try {
      onRename(await api.rename(name));
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="menu-card stats-profile">
      <div className="poster">
        <span className="poster-wanted">{t('stats.wanted')}</span>
        {editing ? (
          <span className="poster-edit">
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn small primary" onClick={save}>
              {t('common.save')}
            </button>
          </span>
        ) : (
          <button
            className="poster-name"
            onClick={() => {
              setName(me?.name ?? '');
              setEditing(true);
            }}
            title={t('stats.renameTitle')}
          >
            {me?.name ?? t('stats.unnamedPirate')} ✎
          </button>
        )}
        <span className="poster-bounty">{fmtBerries(me?.bounty ?? 0, locale)}</span>
      </div>
      <div className="profile-info">
        <div className="tier-badge">{tier?.label}</div>
        <p className="muted small">
          {[
            tier && t('stats.tierRange', { range: tierSpan(t, locale, tier) }),
            next && t('stats.nextTier', { label: next.label, min: fmtBerries(next.min, locale) }),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
        <p className="muted small">{me ? t('stats.bountyHintPlayed', { n: me.rankedGames }) : t('stats.bountyHint')}</p>
        {error && <div className="error">{error}</div>}
      </div>
    </section>
  );
}

function SummaryTiles({ s }: { s: StatsSummary }) {
  const t = useT();
  const locale = useLocale();
  const games = (n: number) => t('stats.gamesCount', { n });
  const tiles: Array<[string, ReactNode, string]> = [
    [t('stats.tileGames'), fmtNumber(s.games, locale), t('stats.tilePlayers', { n: s.players })],
    [t('stats.tileWins'), fmtPct(rate(s)), t('stats.tileWinsOf', { wins: fmtNumber(s.wins, locale), games: fmtNumber(s.games, locale) })],
    [t('stats.first'), fmtPct(rate(s.first)), games(s.first.games)],
    [t('stats.tileSecond'), fmtPct(rate(s.second)), games(s.second.games)],
    [t('stats.tileKeep'), fmtPct(rate(s.keep)), games(s.keep.games)],
    [t('stats.tileMulligan'), fmtPct(rate(s.mulligan)), games(s.mulligan.games)],
  ];
  return (
    <div className="stat-tiles">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="stat-tile">
          <span className="muted small">{label}</span>
          <b>{value}</b>
          <span className="muted small">{sub}</span>
        </div>
      ))}
    </div>
  );
}

/** Resumo do meta em frases, como o do Duels.ink. */
function MetaSummary({ data, min }: { data: StatsOverview; min: number }) {
  const t = useT();
  const s = data.summary;
  if (!s.games) return null;
  const name = (id: string) => data.cards[id]?.name ?? id;
  const share = (games: number) => fmtPct(games / s.games);
  const established = data.leaders.filter((l) => l.games >= min);
  const top = data.leaders[0];
  const best = [...established].sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0))[0];
  const losing = established.filter((l) => l.games / s.games >= 0.05 && (rate(l) ?? 1) < 0.47);
  const items: ReactNode[] = [];
  // `{leader}` fica de fora dos parâmetros para `rich()` encaixar o nome em negrito.
  items.push(
    <>{rich(t('stats.metaTop', { share: share(top.games), rate: fmtPct(rate(top)) }), { leader: <b>{name(top.leader)}</b> })}</>,
  );
  if (best && best.leader !== top.leader) {
    items.push(
      <>
        {rich(t('stats.metaBest', { min, rate: fmtPct(rate(best)), share: share(best.games) }), {
          leader: <b>{name(best.leader)}</b>,
        })}
      </>,
    );
  } else if (best) {
    items.push(<>{t('stats.metaBestSame', { min })}</>);
  }
  if (losing.length) {
    items.push(
      <>
        {t('stats.metaLosing', {
          list: losing.map((l) => t('stats.nameValue', { name: name(l.leader), value: fmtPct(rate(l)) })).join(t('stats.listSep')),
        })}
      </>,
    );
  }
  if (s.first.games && s.second.games) {
    items.push(<>{t('stats.metaFirstSecond', { first: fmtPct(rate(s.first)), second: fmtPct(rate(s.second)) })}</>);
  }
  if (s.mulligan.games >= min) {
    items.push(<>{t('stats.metaMulligan', { mulligan: fmtPct(rate(s.mulligan)), keep: fmtPct(rate(s.keep)) })}</>);
  }
  return (
    <ul className="meta-summary">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function LeadersTable({
  data,
  min,
  onPick,
  lists = true,
  rowTitle,
}: {
  data: StatsOverview;
  min: number;
  onPick: (leader: string) => void;
  /** Coluna de listas (o meta global não tem). */
  lists?: boolean;
  rowTitle?: string;
}) {
  type K = 'games' | 'rate' | 'first' | 'second' | 'lists';
  const t = useT();
  const { th, apply } = useSort<K>('games');
  const total = data.leaders.reduce((s, l) => s + l.games, 0);
  const shown = data.leaders.filter((l) => l.games >= min);
  const hidden = data.leaders.length - shown.length;
  const rows = apply(shown, (l, k) =>
    k === 'games'
      ? l.games
      : k === 'rate'
        ? rate(l)
        : k === 'first'
          ? rate({ games: l.firstGames, wins: l.firstWins })
          : k === 'second'
            ? rate(secondOf(l))
            : l.lists,
  );
  if (!data.leaders.length) return <p className="muted">{t('stats.noGamesFilters')}</p>;
  return (
    <>
      <MetaSummary data={data} min={min} />
      <div className="table-scroll">
        <table className="cov-table stat-table">
          <thead>
            <tr>
              <th>{t('stats.leader')}</th>
              {th('games', t('stats.colGames'))}
              {th('rate', t('stats.colWins'))}
              <th className="wr-col">{t('stats.colInterval')}</th>
              {th('first', t('stats.colFirstShort'), t('stats.colFirstTitle'))}
              {th('second', t('stats.colSecondShort'), t('stats.colSecondTitle'))}
              {lists && th('lists', t('stats.colLists'), t('stats.colListsTitle'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.leader}
                className="clickable"
                onClick={() => onPick(l.leader)}
                title={rowTitle ?? t('stats.rowCardsTitle')}
              >
                <td>
                  <CardName id={l.leader} info={data.cards[l.leader]} />
                </td>
                <td>
                  {l.games} <span className="muted small">({fmtPct(l.games / total)})</span>
                </td>
                <td>
                  <WinRate w={l} compact />
                </td>
                <td className="wr-col">
                  <WinBar w={l} />
                </td>
                <td>
                  <WinRate w={{ games: l.firstGames, wins: l.firstWins }} />
                </td>
                <td>
                  <WinRate w={secondOf(l)} />
                </td>
                {lists && <td>{l.lists}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <p className="muted small">{t('stats.hiddenLeaders', { n: hidden, min })}</p>}
    </>
  );
}

const MATRIX_SIZE = 10;

function Matchups({
  data,
  leader,
  min,
  onLeader,
}: {
  data: StatsOverview;
  leader: string;
  min: number;
  onLeader: (l: string) => void;
}) {
  const t = useT();
  const byPair = useMemo(() => new Map(data.matchups.map((m) => [`${m.leader}|${m.oppLeader}`, m])), [data]);
  const name = (id: string) => data.cards[id]?.name ?? id;

  if (leader) {
    const all = data.matchups.filter((m) => m.leader === leader);
    const rows = all.filter((m) => m.games >= min).sort((a, b) => b.games - a.games);
    return (
      <>
        <button className="btn small" onClick={() => onLeader('')}>
          {t('stats.backToMatrix')}
        </button>
        <h3 className="stats-sub">
          {rich(t('stats.vsEachLeader'), { leader: <CardName id={leader} info={data.cards[leader]} /> })}
        </h3>
        {!rows.length && <p className="muted">{t('stats.noMatchups', { min })}</p>}
        <div className="table-scroll">
          <table className="cov-table stat-table">
            {rows.length > 0 && (
              <thead>
                <tr>
                  <th>{t('stats.colOpponent')}</th>
                  <th>{t('stats.colWins')}</th>
                  <th className="wr-col">{t('stats.colInterval')}</th>
                  <th title={t('stats.colFirstMatchupTitle')}>{t('stats.first')}</th>
                  <th title={t('stats.colSecondMatchupTitle')}>{t('stats.second')}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((m) => (
                <tr key={m.oppLeader}>
                  <td>
                    <CardName id={m.oppLeader} info={data.cards[m.oppLeader]} />
                  </td>
                  <td>
                    <WinRate w={m} />
                  </td>
                  <td className="wr-col">
                    <WinBar w={m} />
                  </td>
                  <td>
                    <WinRate w={{ games: m.firstGames, wins: m.firstWins }} />
                  </td>
                  <td>
                    <WinRate w={secondOf(m)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {all.length > rows.length && (
          <p className="muted small">{t('stats.hiddenOpponents', { n: all.length - rows.length, min })}</p>
        )}
      </>
    );
  }

  // Mesma ordem nas linhas e nas colunas (mais jogados primeiro), com o espelho na diagonal.
  const leaders = data.leaders.slice(0, MATRIX_SIZE).map((l) => l.leader);
  const opponents = leaders;
  if (!leaders.length) return <p className="muted">{t('stats.noGamesFilters')}</p>;
  return (
    <>
      <p className="muted small">{t('stats.matrixHint', { min })}</p>
      <div className="table-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              {opponents.map((o) => (
                <th key={o} title={name(o)}>
                  <CardName id={o} info={data.cards[o]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaders.map((l) => (
              <tr key={l}>
                <th className="clickable" onClick={() => onLeader(l)}>
                  <CardName id={l} info={data.cards[l]} />
                </th>
                {opponents.map((o) => {
                  const m = byPair.get(`${l}|${o}`);
                  const mirror = l === o;
                  // No espelho, as duas perspectivas somam 50%: mostra a vantagem de quem começa.
                  const w = m && (mirror ? { games: m.firstGames, wins: m.firstWins } : m);
                  const r = w ? rate(w) : null;
                  const enough = !!m && m.games >= min;
                  const first = m ? rate({ games: m.firstGames, wins: m.firstWins }) : null;
                  return (
                    <td
                      key={o}
                      className={[mirror ? 'mirror' : '', m && m.games < MIN_GAMES ? 'small-sample' : ''].join(' ')}
                      style={{ background: enough ? rateColor(r) : undefined }}
                      title={
                        m
                          ? t('stats.cellTitle', {
                              a: name(l),
                              b: name(o),
                              wins: m.wins,
                              games: m.games,
                              rate: fmtPct(first),
                              firstGames: m.firstGames,
                            })
                          : t('stats.noGames')
                      }
                    >
                      {m && enough ? (
                        <>
                          <b>{fmtPct(r)}</b>
                          <span className="muted small">{mirror ? t('stats.mirrorGames', { n: m.games }) : m.games}</span>
                        </>
                      ) : m ? (
                        <span className="muted small">{m.games}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Linha da participação semanal (escala comum a todos os Líderes). */
function Sparkline({ values, max, labels }: { values: number[]; max: number; labels: string[] }) {
  const t = useT();
  const w = 96;
  const h = 28;
  const pad = 3;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - (max ? (v / max) * (h - 2 * pad) : 0);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img">
      <title>{values.map((v, i) => t('stats.sparkPoint', { label: labels[i], value: fmtPct(v) })).join('\n')}</title>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--blue)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last)} cy={y(values[last])} r="3" fill="var(--blue)" stroke="var(--panel)" strokeWidth="1.5" />
    </svg>
  );
}

/** Dia/mês de uma semana (`YYYY-MM-DD`) no idioma em vigor; a data é montada local para não mudar o dia pelo fuso. */
const shortDate = (iso: string, locale: Locale) =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
  });

/** Diferença em pontos percentuais, com a mesma cor das taxas (`scale` realça diferenças pequenas, como as de participação). */
function Delta({ d, scale = 1 }: { d: number | null; scale?: number }) {
  const t = useT();
  if (d === null) return <>—</>;
  return (
    <span className="delta" style={{ background: rateColor(0.5 + d * scale) }}>
      {t('stats.pp', { sign: d >= 0 ? '+' : '−', value: Math.abs(d * 100).toFixed(1) })}
    </span>
  );
}

/** Quem sobe e quem cai: participação e vitórias por semana. `load` busca as últimas N semanas (daqui ou do meta global). */
function Trend({
  load,
  min,
  onPick,
  empty,
  footer,
}: {
  load: (weeks: number) => Promise<TrendResponse>;
  min: number;
  onPick: (leader: string) => void;
  /** Texto quando não há semana nenhuma (meta global ainda coletando). */
  empty?: (data: TrendResponse) => ReactNode;
  footer?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<TrendResponse | null>(null);
  const [weeks, setWeeks] = useState(6);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    load(weeks)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [load, weeks]);

  const table = useMemo(() => {
    if (!data) return null;
    const totals = data.weeks.map((wk) => data.rows.filter((r) => r.week === wk).reduce((s, r) => s + r.games, 0));
    const leaders = [...new Set(data.rows.map((r) => r.leader))].map((leader) => {
      const perWeek = data.weeks.map(
        (wk) => data.rows.find((r) => r.week === wk && r.leader === leader) ?? { games: 0, wins: 0 },
      );
      const shares = perWeek.map((r, i) => (totals[i] ? r.games / totals[i] : 0));
      const games = perWeek.reduce((s, r) => s + r.games, 0);
      const wins = perWeek.reduce((s, r) => s + r.wins, 0);
      const n = shares.length;
      return { leader, perWeek, shares, games, wins, delta: shares[n - 1] - shares[n - 2] };
    });
    const max = Math.max(0, ...leaders.flatMap((l) => l.shares));
    return {
      totals,
      leaders: leaders
        .filter((l) => l.games >= min)
        .sort((a, b) => b.shares[b.shares.length - 1] - a.shares[a.shares.length - 1] || b.games - a.games),
      max,
    };
  }, [data, min]);

  if (error) return <div className="error">{error}</div>;
  if (!data || !table) return <p className="muted">{t('common.loading')}</p>;
  if (!data.weeks.length && empty) return <p className="muted">{empty(data)}</p>;
  const n = data.weeks.length;
  const name = (id: string) => data.cards[id]?.name ?? id;
  const movers = [...table.leaders]
    .filter((l) => table.totals[n - 1] && table.totals[n - 2])
    .sort((a, b) => b.delta - a.delta);
  const risers = movers.filter((l) => l.delta > 0.005).slice(0, 3);
  const fallers = movers
    .filter((l) => l.delta < -0.005)
    .reverse()
    .slice(0, 3);
  const pp = (d: number) => t('stats.pp', { sign: d >= 0 ? '+' : '−', value: Math.abs(d * 100).toFixed(1) });
  const movedList = (list: typeof movers) =>
    list.map((l) => t('stats.nameValue', { name: name(l.leader), value: pp(l.delta) })).join(t('stats.listSep'));

  return (
    <>
      <div className="stats-pickers">
        <label>
          {t('stats.weeks')}
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[4, 6, 8, 12].map((w) => (
              <option key={w} value={w}>
                {t('stats.weeksCount', { n: w })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(risers.length > 0 || fallers.length > 0) && (
        <ul className="meta-summary">
          {risers.length > 0 && <li>{t('stats.risers', { list: movedList(risers) })}</li>}
          {fallers.length > 0 && <li>{t('stats.fallers', { list: movedList(fallers) })}</li>}
        </ul>
      )}
      {!table.leaders.length && <p className="muted">{t('stats.noTrend', { min })}</p>}
      {table.leaders.length > 0 && (
        <div className="table-scroll">
          <table className="cov-table stat-table">
            <thead>
              <tr>
                <th>{t('stats.leader')}</th>
                <th title={t('stats.colUsageTitle')}>
                  {t('stats.colUsage', { from: shortDate(data.weeks[0], locale), to: shortDate(data.weeks[n - 1], locale) })}
                </th>
                <th>{t('stats.colThisWeek')}</th>
                <th title={t('stats.colUsageDeltaTitle')}>{t('stats.colUsageDelta')}</th>
                <th>{t('stats.colWinsWeek')}</th>
                <th>{t('stats.colWinsPeriod')}</th>
              </tr>
            </thead>
            <tbody>
              {table.leaders.map((l) => (
                <tr
                  key={l.leader}
                  className="clickable"
                  onClick={() => onPick(l.leader)}
                  title={t('stats.rowMatchupsTitle')}
                >
                  <td>
                    <CardName id={l.leader} info={data.cards[l.leader]} />
                  </td>
                  <td>
                    <Sparkline values={l.shares} max={table.max} labels={data.weeks.map((wk) => shortDate(wk, locale))} />
                  </td>
                  <td>
                    {fmtPct(l.shares[n - 1])} <span className="muted small">{l.perWeek[n - 1].games}</span>
                  </td>
                  <td>
                    {table.totals[n - 2] ? (
                      <span className="delta" style={{ background: rateColor(0.5 + l.delta * 2) }}>
                        {pp(l.delta)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <WinRate w={l.perWeek[n - 1]} />
                  </td>
                  <td>
                    <WinRate w={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{footer ?? t('stats.trendFooter')}</p>
    </>
  );
}

function CardsTable({ data, min }: { data: CardStatsResponse; min: number }) {
  type K = 'games' | 'rate' | 'lift' | 'opening' | 'drawn' | 'notDrawn' | 'iwd' | 'played' | 'perGame';
  const t = useT();
  const { th, apply } = useSort<K>('games');
  const total = data.summary.games;
  const base = rate(data.summary);
  /** Vitórias com a carta no deck menos as vitórias do Líder em geral. */
  const lift = (c: WinCount) => {
    const r = rate(c);
    return r === null || base === null ? null : r - base;
  };
  const iwd = (c: CardStatsResponse['rows'][number]) => {
    const d = rate({ games: c.drawnGames, wins: c.drawnWins });
    const n = rate({ games: c.notDrawnGames, wins: c.notDrawnWins });
    return d === null || n === null ? null : d - n;
  };
  const shown = data.rows.filter((c) => c.games >= min);
  const rows = apply(shown, (c, k) => {
    switch (k) {
      case 'games':
        return c.games;
      case 'rate':
        return rate(c);
      case 'lift':
        return lift(c);
      case 'opening':
        return rate({ games: c.openingGames, wins: c.openingWins });
      case 'drawn':
        return rate({ games: c.drawnGames, wins: c.drawnWins });
      case 'notDrawn':
        return rate({ games: c.notDrawnGames, wins: c.notDrawnWins });
      case 'iwd':
        return iwd(c);
      case 'played':
        return rate({ games: c.playedGames, wins: c.playedWins });
      case 'perGame':
        return c.games ? c.timesPlayed / c.games : null;
    }
  });
  if (!rows.length) return <p className="muted">{t('stats.noCards', { min })}</p>;
  return (
    <>
      <p className="muted small">
        {rich(t('stats.cardsHint', { base: fmtPct(base) }), {
          lift: <b>{t('stats.colLift')}</b>,
          opening: <b>{t('stats.colOpening')}</b>,
          drawn: <b>{t('stats.colDrawn')}</b>,
          iwd: <b>{t('stats.colIwd')}</b>,
        })}
      </p>
      <div className="table-scroll">
        <table className="cov-table stat-table">
          <thead>
            <tr>
              <th>{t('stats.colCard')}</th>
              {th('games', t('stats.colInDeck'), t('stats.colInDeckTitle'))}
              {th('rate', t('stats.colWins'))}
              {th('lift', t('stats.colLift'), t('stats.colLiftTitle'))}
              {th('opening', t('stats.colOpening'))}
              {th('drawn', t('stats.colDrawn'))}
              {th('notDrawn', t('stats.colNotDrawn'))}
              {th('iwd', t('stats.colIwd'), t('stats.colIwdTitle'))}
              {th('played', t('stats.colPlayed'))}
              {th('perGame', t('stats.colPerGame'), t('stats.colPerGameTitle'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const delta = iwd(c);
              return (
                <tr key={c.cardId}>
                  <td>
                    <CardName id={c.cardId} info={data.cards[c.cardId]} />
                  </td>
                  <td>
                    {fmtPct(total ? c.games / total : null)}{' '}
                    <span className="muted small">{t('stats.copies', { n: c.avgCopies.toFixed(1) })}</span>
                  </td>
                  <td>
                    <WinRate w={c} />
                  </td>
                  <td>{c.games < total ? <Delta d={lift(c)} /> : <span className="muted">—</span>}</td>
                  <td>
                    <WinRate w={{ games: c.openingGames, wins: c.openingWins }} />
                  </td>
                  <td>
                    <WinRate w={{ games: c.drawnGames, wins: c.drawnWins }} />
                  </td>
                  <td>
                    <WinRate w={{ games: c.notDrawnGames, wins: c.notDrawnWins }} />
                  </td>
                  <td className={Math.min(c.drawnGames, c.notDrawnGames) < MIN_GAMES ? 'small-sample' : ''}>
                    <Delta d={delta} />
                  </td>
                  <td>
                    <WinRate w={{ games: c.playedGames, wins: c.playedWins }} />
                  </td>
                  <td>{c.games ? (c.timesPlayed / c.games).toFixed(2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Estatísticas de vitórias por Líder, matchup e carta, com filtros. */

/** Resumo da fila do meta global: partidas, Líderes e a vantagem de quem começa (só nas partidas em que se sabe quem começou). */
function GlobalTiles({ data }: { data: StatsOverview }) {
  const t = useT();
  const locale = useLocale();
  const s = data.summary;
  const games = (n: number) => t('stats.gamesCount', { n });
  const tiles: Array<[string, ReactNode, string]> = [
    [t('stats.tileMatches'), fmtNumber(s.matches, locale), t('stats.tileLeadersCount', { n: data.leaders.length })],
    [t('stats.first'), fmtPct(rate(s.first)), games(s.first.games)],
    [t('stats.tileSecond'), fmtPct(rate(s.second)), games(s.second.games)],
  ];
  return (
    <div className="stat-tiles">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="stat-tile">
          <span className="muted small">{label}</span>
          <b>{value}</b>
          <span className="muted small">{sub}</span>
        </div>
      ))}
    </div>
  );
}

/** O mesmo Líder aqui e lá: participação (por lado da partida) e vitórias, com a diferença em pontos. */
function CompareTable({
  queue,
  format,
  formatLabel,
  min,
  hereLabel,
}: {
  queue: string;
  format: string;
  formatLabel: string;
  min: number;
  /** Qual recorte daqui entra na comparação (Geral, Pro ou tudo). */
  hereLabel: string;
}) {
  type K = 'here' | 'global' | 'rateHere' | 'rateGlobal' | 'dShare' | 'dRate';
  const t = useT();
  const { th, apply } = useSort<K>('global');
  const [data, setData] = useState<GlobalCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .globalCompare(queue, format)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [queue, format]);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">{t('common.loading')}</p>;
  const share = (w: WinCount | null, total: number) => (w && total ? w.games / total : null);
  const rows = apply(
    data.rows
      .filter((r) => (r.here?.games ?? 0) >= min || (r.global?.games ?? 0) >= min)
      .map((r) => {
        const sh = share(r.here, data.here.games);
        const sg = share(r.global, data.global.games);
        const rh = r.here ? rate(r.here) : null;
        const rg = r.global ? rate(r.global) : null;
        return { ...r, sh, sg, rh, rg, dShare: sh !== null && sg !== null ? sh - sg : null, dRate: rh !== null && rg !== null ? rh - rg : null };
      }),
    (r, k) => (k === 'here' ? r.sh : k === 'global' ? r.sg : k === 'rateHere' ? r.rh : k === 'rateGlobal' ? r.rg : k === 'dShare' ? r.dShare : r.dRate),
  );
  const usage = (s: number | null, w: WinCount | null) =>
    s === null || !w ? (
      '—'
    ) : (
      <>
        {fmtPct(s)} <span className="muted small">{w.games}</span>
      </>
    );
  return (
    <>
      <p className="muted small">
        {t('stats.compareIntro', { format: formatLabel, here: data.here.games, scope: hereLabel, global: data.global.games, queue: data.queue.name })}
      </p>
      {!rows.length && <p className="muted">{t('stats.noCompare', { min })}</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="cov-table stat-table">
            <thead>
              <tr>
                <th>{t('stats.leader')}</th>
                {th('here', t('stats.colShareHere'))}
                {th('global', t('stats.colShareGlobal'))}
                {th('dShare', t('stats.colDelta'), t('stats.colDeltaTitle'))}
                {th('rateHere', t('stats.colRateHere'))}
                {th('rateGlobal', t('stats.colRateGlobal'))}
                {th('dRate', t('stats.colDelta'), t('stats.colDeltaTitle'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.leader}>
                  <td>
                    <CardName id={r.leader} info={data.cards[r.leader]} />
                  </td>
                  <td>{usage(r.sh, r.here)}</td>
                  <td>{usage(r.sg, r.global)}</td>
                  <td>
                    <Delta d={r.dShare} scale={2} />
                  </td>
                  <td>{r.here ? <WinRate w={r.here} /> : '—'}</td>
                  <td>{r.global ? <WinRate w={r.global} /> : '—'}</td>
                  <td>
                    <Delta d={r.dRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{t('stats.compareFooter', { n: min })}</p>
    </>
  );
}

/** Escopo Global: as filas do TCG Matchmaking, com Líderes, matchups, tendência e a comparação com as partidas daqui. */
function GlobalPanel({
  meta,
  formats,
  min,
  onMin,
  hereLabel,
}: {
  meta: NonNullable<StatsMeta['global']>;
  formats: StatsMeta['formats'];
  min: number;
  onMin: (n: number) => void;
  hereLabel: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [queue, setQueue] = useState(loadQueue);
  const [tab, setTab] = useState<GlobalTab>('leaders');
  const [leader, setLeader] = useState('');
  const [data, setData] = useState<GlobalStats | null>(null);
  /** Matchups do Líder em foco (a resposta principal só traz a matriz dos mais jogados). */
  const [detail, setDetail] = useState<GlobalMatchups | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_KEY, queue);
    } catch {
      /* sem armazenamento */
    }
  }, [queue]);

  useEffect(() => {
    let cancelled = false;
    api
      .globalStats(queue || undefined)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        // Sem fila escolhida (ou fila que sumiu), o servidor manda a primeira: fica com ela.
        if (d.queue && d.queue.key !== queue) setQueue(d.queue.key);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [queue]);

  const queues = data?.queues.length ? data.queues : meta.queues;
  const current: GlobalQueue | null = data?.queue ?? queues.find((q) => q.key === queue) ?? queues[0] ?? null;
  const key = current?.key ?? '';

  useEffect(() => {
    if (!leader || !key) return;
    let cancelled = false;
    api
      .globalMatchups(key, leader)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [key, leader]);

  const overview: StatsOverview | null =
    data?.queue && data.summary ? { summary: data.summary, leaders: data.leaders, matchups: data.matchups, cards: data.cards } : null;
  const detailReady = !leader || (detail?.leader === leader && detail.queue?.key === key);
  /** A visão geral com os matchups do Líder em foco no lugar dos da matriz. */
  const withDetail: StatsOverview | null =
    overview && leader && detailReady && detail
      ? { ...overview, matchups: [...overview.matchups.filter((m) => m.leader !== leader), ...detail.matchups], cards: { ...overview.cards, ...detail.cards } }
      : overview;
  const loadTrend = useCallback((w: number) => api.globalTrend(key, w), [key]);
  const tabs: Array<[GlobalTab, string]> = [
    ['leaders', t('stats.tabLeaders')],
    ['matchups', t('stats.tabMatchups')],
    ['trend', t('stats.tabTrend')],
    ...(current?.format ? [['compare', t('stats.tabCompare')] as [GlobalTab, string]] : []),
  ];
  const shown: GlobalTab = tab === 'compare' && !current?.format ? 'leaders' : tab;
  const toMatchups = (l: string) => {
    setLeader(l);
    setTab('matchups');
  };

  return (
    <>
      <details className="menu-card stats-filters" open>
        <summary>{t('stats.filters')}</summary>
        <div className="filter-grid">
          <div className="field">
            <label>{t('stats.filterGlobalQueue')}</label>
            <div className="stats-pickers">
              <select
                value={key}
                onChange={(e) => {
                  setQueue(e.target.value);
                  setLeader('');
                }}
              >
                {queues.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>{t('stats.filterMin')}</label>
            <Seg
              value={String(min)}
              options={[
                ['1', t('stats.allFem')],
                ['10', '10'],
                ['50', '50'],
                ['100', '100'],
              ]}
              onChange={(v) => onMin(Number(v))}
            />
          </div>
        </div>
      </details>
      <p className="muted small">
        {t('stats.globalIntro')}
        {current?.minBounty ? ` ${t('stats.globalMinBounty', { n: current.minBounty })}` : ''}
      </p>
      {error && <div className="error">{error}</div>}
      {overview && <GlobalTiles data={overview} />}
      <div className="seg stats-tabs">
        {tabs.map(([v, label]) => (
          <button key={v} className={shown === v ? 'on' : ''} onClick={() => setTab(v)}>
            {label}
          </button>
        ))}
      </div>
      <section className="menu-card stats-panel">
        {!data && !error && <p className="muted">{t('common.loading')}</p>}
        {data && !data.queue && <p className="muted">{t('stats.globalCollecting')}</p>}
        {overview && shown === 'leaders' && <LeadersTable data={overview} min={min} lists={false} rowTitle={t('stats.rowMatchupsTitle')} onPick={toMatchups} />}
        {overview && shown === 'matchups' && !detailReady && <p className="muted">{t('common.loading')}</p>}
        {withDetail && shown === 'matchups' && detailReady && <Matchups data={withDetail} leader={leader} min={min} onLeader={setLeader} />}
        {key && shown === 'trend' && (
          <Trend
            load={loadTrend}
            min={min}
            onPick={toMatchups}
            empty={(d) => {
              const since = (d as GlobalTrendResponse).since;
              return t('stats.globalTrendCollecting', { since: since ? shortDate(since, locale) : '—' });
            }}
            footer={t('stats.globalTrendFooter')}
          />
        )}
        {current?.format && shown === 'compare' && (
          <CompareTable
            queue={current.key}
            format={current.format}
            formatLabel={formats.find((f) => f.id === current.format)?.label ?? current.format}
            min={min}
            hereLabel={hereLabel}
          />
        )}
      </section>
      {current && (
        <p className="muted small">
          {t('stats.globalUpdated', { queue: current.name, date: fmtDateTime(current.lastModified ?? current.fetchedAt, locale) })} {t('stats.globalCredit')}
        </p>
      )}
    </>
  );
}

export function Stats({ onExit }: { onExit: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [meta, setMeta] = useState<StatsMeta | null>(null);
  const [filters, setFilters] = useState<StatsQuery>(loadFilters);
  const { config } = useAuth();
  const [scopePick, setScope] = useState<Scope>(loadScope);
  const [showSupport, setShowSupport] = useState(false);
  /** Piso de partidas para mostrar uma linha (como o mínimo de exibição do Duels.ink). */
  const [min, setMin] = useState(loadMin);
  const [tab, setTab] = useState<Tab>('leaders');
  /** Líder em foco (matchups e cartas). */
  const [leader, setLeader] = useState('');
  const [deck, setDeck] = useState('');
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [cards, setCards] = useState<CardStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .statsMeta()
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
      localStorage.setItem(MIN_KEY, String(min));
      localStorage.setItem(SCOPE_KEY, scopePick);
    } catch {
      /* sem armazenamento */
    }
  }, [filters, min, scopePick]);

  /** Sem a separação no servidor (apoio desligado), tudo é uma coisa só. */
  const gated = meta?.proGate ?? false;
  /** Meta global ligado no servidor (antes de `meta` chegar, vale a escolha guardada, para as estatísticas daqui não piscarem). */
  const globalOn = meta ? !!meta.global : scopePick === 'global';
  const scope: Scope = scopePick === 'global' ? (globalOn ? 'global' : gated ? 'general' : 'pro') : gated ? scopePick : 'pro';
  const isGlobal = scope === 'global';
  /** Aba Pro sem o plano: mostra só a amostra. */
  const locked = gated && scope === 'pro' && !meta?.pro;
  /** Na aba Geral (fora de "Só eu"), só partidas casuais e sem filtro por faixa. */
  const general = scope === 'general' && !filters.mine;
  const query = useMemo<StatsQuery>(() => (general ? { ...filters, queue: 'casual', tiers: undefined } : filters), [filters, general]);

  // Visão geral (Líderes e matchups).
  useEffect(() => {
    if (locked || isGlobal) return;
    let cancelled = false;
    setLoading(true);
    api
      .stats(query)
      .then((d) => {
        if (cancelled) return;
        setOverview(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, locked, isGlobal]);

  // Na aba de cartas, um Líder é obrigatório: o mais jogado com esses filtros.
  const cardsLeader = leader || overview?.leaders[0]?.leader || '';
  useEffect(() => {
    if (tab !== 'cards' || !cardsLeader || locked || isGlobal) return;
    let cancelled = false;
    api
      .cardStats({ ...query, leader: cardsLeader, deck: deck || undefined })
      .then((d) => !cancelled && setCards(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [tab, query, cardsLeader, deck, locked, isGlobal]);

  const loadTrend = useCallback((w: number) => api.trend(query, w), [query]);
  const set = (patch: Partial<StatsQuery>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleTier = (id: string) =>
    set({
      tiers: filters.tiers?.includes(id) ? filters.tiers.filter((t) => t !== id) : [...(filters.tiers ?? []), id],
    });

  const leaderOptions = overview?.leaders.map((l) => l.leader) ?? [];
  const info = { ...meta?.cards, ...overview?.cards };
  const myLists = meta?.myDecks.filter((d) => d.leader === cardsLeader) ?? [];

  return (
    <div className="coverage stats-page">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('stats.backMenu')}
        </button>
        <h2>{t('stats.title')}</h2>
        {loading && <span className="muted small">{t('stats.updating')}</span>}
      </header>
      <div className="coverage-body stats-body">
        {error && <div className="error">{error}</div>}
        {meta && <Profile me={meta.me} tiers={meta.tiers} onRename={(me) => setMeta({ ...meta, me })} />}

        {(gated || globalOn) && (
          <div className="seg stats-scope" role="tablist" aria-label={t('stats.scopeLabel')}>
            {gated ? (
              <>
                <button role="tab" aria-selected={scope === 'general'} className={scope === 'general' ? 'on' : ''} onClick={() => setScope('general')}>
                  {t('stats.scopeGeneral')}
                  <small>{t('stats.scopeGeneralSub')}</small>
                </button>
                <button role="tab" aria-selected={scope === 'pro'} className={scope === 'pro' ? 'on' : ''} onClick={() => setScope('pro')}>
                  <span className="stats-scope-label">
                    {meta?.pro ? '★' : <Icon name="lock" size={14} />} {t('stats.scopePro')}
                  </span>
                  <small>{t('stats.scopeProSub')}</small>
                </button>
              </>
            ) : (
              <button role="tab" aria-selected={!isGlobal} className={!isGlobal ? 'on' : ''} onClick={() => setScope('pro')}>
                {t('stats.scopeLocal')}
                <small>{t('stats.scopeLocalSub')}</small>
              </button>
            )}
            {globalOn && (
              <button role="tab" aria-selected={isGlobal} className={isGlobal ? 'on' : ''} onClick={() => setScope('global')}>
                <span className="stats-scope-label">🌍 {t('stats.scopeGlobal')}</span>
                <small>{t('stats.scopeGlobalSub')}</small>
              </button>
            )}
          </div>
        )}

        {locked && <ProTeaser format={filters.format} onSupport={config?.support ? () => setShowSupport(true) : null} />}
        {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}

        {!locked && !isGlobal && (
          <>
            <details className="menu-card stats-filters" open>
              <summary>{t('stats.filters')}</summary>
              <div className="filter-grid">
                <div className="field">
                  <label>{t('stats.filterFormat')}</label>
                  <Seg
                    value={filters.format ?? ''}
                    options={[['', t('stats.all')], ...(meta?.formats.map((f): [string, string] => [f.id, f.label]) ?? [])]}
                    onChange={(format) => set({ format })}
                  />
                </div>
                {!general && (
                  <div className="field">
                    <label>{t('stats.filterQueue')}</label>
                    <Seg
                      value={filters.queue ?? ''}
                      options={[['', t('stats.allFem')], ...(meta?.queues.map((q): [string, string] => [q.id, q.label]) ?? [])]}
                      onChange={(queue) => set({ queue })}
                    />
                  </div>
                )}
                <div className="field">
                  <label>{t('stats.filterOpponent')}</label>
                  <Seg
                    value={filters.opponent ?? ''}
                    options={[
                      ['', t('stats.all')],
                      ['bot', t('stats.opponentBot')],
                      ['human', t('stats.opponentHuman')],
                    ]}
                    onChange={(opponent) => set({ opponent })}
                  />
                </div>
                <div className="field">
                  <label>{t('stats.filterTurnOrder')}</label>
                  <Seg
                    value={filters.first ?? ''}
                    options={[
                      ['', t('stats.allFem')],
                      ['first', t('stats.first')],
                      ['second', t('stats.second')],
                    ]}
                    onChange={(first) => set({ first })}
                  />
                </div>
                <div className="field">
                  <label>{t('stats.filterPeriod')}</label>
                  <Seg
                    value={filters.days ?? ''}
                    options={[
                      ['', t('stats.allTime')],
                      ['7', t('stats.days', { n: 7 })],
                      ['30', t('stats.days', { n: 30 })],
                      ['90', t('stats.days', { n: 90 })],
                    ]}
                    onChange={(days) => set({ days })}
                  />
                </div>
                <div className="field">
                  <label>{t('stats.filterWhose')}</label>
                  <Seg
                    value={filters.mine ? 'mine' : 'all'}
                    options={[
                      ['all', t('stats.allPlayers')],
                      ['mine', t('stats.onlyMe')],
                    ]}
                    onChange={(v) => set({ mine: v === 'mine', by: 'human' })}
                  />
                </div>
                <div className="field">
                  <label>{t('stats.filterMin')}</label>
                  <Seg
                    value={String(min)}
                    options={[
                      ['1', t('stats.allFem')],
                      ['10', '10'],
                      ['50', '50'],
                      ['100', '100'],
                    ]}
                    onChange={(v) => setMin(Number(v))}
                  />
                </div>
                {!general && (
                  <div className="field tier-field">
                    <label>{t('stats.filterTiers')}</label>
                    <div className="tier-chips">
                      {meta?.tiers.map((tier) => (
                        <button
                          key={tier.id}
                          className={['chip', filters.tiers?.includes(tier.id) ? 'on' : ''].join(' ')}
                          onClick={() => toggleTier(tier.id)}
                          title={tierSpan(t, locale, tier)}
                        >
                          {tier.label}
                        </button>
                      ))}
                      {!!filters.tiers?.length && (
                        <button className="btn small pill" onClick={() => set({ tiers: [] })}>
                          {t('stats.all')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </details>

            {overview && <SummaryTiles s={overview.summary} />}

            <div className="seg stats-tabs">
              {(
                [
                  ['leaders', t('stats.tabLeaders')],
                  ['matchups', t('stats.tabMatchups')],
                  ['trend', t('stats.tabTrend')],
                  ['cards', t('stats.tabCards')],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>
                  {label}
                </button>
              ))}
            </div>

            <section className="menu-card stats-panel">
              {overview && tab === 'leaders' && (
                <LeadersTable
                  data={overview}
                  min={min}
                  onPick={(l) => {
                    setLeader(l);
                    setDeck('');
                    setTab('cards');
                  }}
                />
              )}
              {overview && tab === 'matchups' && (
                <Matchups data={overview} leader={leader} min={min} onLeader={setLeader} />
              )}
              {tab === 'trend' && (
                <Trend
                  load={loadTrend}
                  min={min}
                  onPick={(l) => {
                    setLeader(l);
                    setTab('matchups');
                  }}
                />
              )}
              {tab === 'cards' && (
                <>
                  <div className="stats-pickers">
                    <label>
                      {t('stats.leader')}
                      <select
                        value={cardsLeader}
                        onChange={(e) => {
                          setLeader(e.target.value);
                          setDeck('');
                        }}
                      >
                        {!leaderOptions.includes(cardsLeader) && cardsLeader && (
                          <option value={cardsLeader}>{info[cardsLeader]?.name ?? cardsLeader}</option>
                        )}
                        {leaderOptions.map((l) => (
                          <option key={l} value={l}>
                            {t('stats.nameId', { name: info[l]?.name ?? l, id: l })}
                          </option>
                        ))}
                      </select>
                    </label>
                    {myLists.length > 0 && (
                      <label>
                        {t('stats.list')}
                        <select value={deck} onChange={(e) => setDeck(e.target.value)}>
                          <option value="">{t('stats.allLists')}</option>
                          {myLists.map((d) => (
                            <option key={d.hash} value={d.hash}>
                              {t('stats.listOption', { name: d.deckId ?? d.hash, n: d.games })}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {!cardsLeader && <p className="muted">{t('stats.noGamesFilters')}</p>}
                  {cardsLeader && cards && <CardsTable data={cards} min={min} />}
                </>
              )}
            </section>
            <p className="muted small">
              {t('stats.footer', { n: MIN_GAMES })}
              {scope === 'pro' && ` ${t('stats.proFooter')}`}
            </p>
          </>
        )}

        {isGlobal && meta?.global && (
          <GlobalPanel
            meta={meta.global}
            formats={meta.formats}
            min={min}
            onMin={setMin}
            hereLabel={gated ? (meta.pro ? t('stats.scopePro') : t('stats.scopeGeneral')) : t('stats.scopeLocal')}
          />
        )}
      </div>
    </div>
  );
}
