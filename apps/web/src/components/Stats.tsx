import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  api,
  type CardInfo,
  type CardStatsResponse,
  type PlayerProfile,
  type StatsMeta,
  type StatsOverview,
  type StatsQuery,
  type StatsSummary,
  type TrendResponse,
  type WinCount,
} from '../api';
import { type Locale, type Translate, useLocale, useT } from '../i18n';
import { fmtBerries, fmtNumber } from '../i18n/format';
import { LeaderArt } from './LeaderArt';

/** Abaixo disso, a taxa é mostrada esmaecida (amostra pequena). */
const MIN_GAMES = 10;
const FILTERS_KEY = 'gumgum.statsFilters';
const MIN_KEY = 'gumgum.statsMin';

type Tab = 'leaders' | 'matchups' | 'trend' | 'cards';

const rate = (w: WinCount) => (w.games ? w.wins / w.games : null);
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

function LeadersTable({ data, min, onPick }: { data: StatsOverview; min: number; onPick: (leader: string) => void }) {
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
            ? rate({ games: l.games - l.firstGames, wins: l.wins - l.firstWins })
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
              {th('lists', t('stats.colLists'), t('stats.colListsTitle'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.leader}
                className="clickable"
                onClick={() => onPick(l.leader)}
                title={t('stats.rowCardsTitle')}
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
                  <WinRate w={{ games: l.games - l.firstGames, wins: l.wins - l.firstWins }} />
                </td>
                <td>{l.lists}</td>
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
                    <WinRate w={{ games: m.games - m.firstGames, wins: m.wins - m.firstWins }} />
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

/** Diferença em pontos percentuais, com a mesma cor das taxas. */
function Delta({ d }: { d: number | null }) {
  const t = useT();
  if (d === null) return <>—</>;
  return (
    <span className="delta" style={{ background: rateColor(0.5 + d) }}>
      {t('stats.pp', { sign: d >= 0 ? '+' : '−', value: Math.abs(d * 100).toFixed(1) })}
    </span>
  );
}

/** Quem sobe e quem cai: participação e vitórias por semana. */
function Trend({ query, min, onPick }: { query: StatsQuery; min: number; onPick: (leader: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<TrendResponse | null>(null);
  const [weeks, setWeeks] = useState(6);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .trend(query, weeks)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [query, weeks]);

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
      <p className="muted small">{t('stats.trendFooter')}</p>
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
export function Stats({ onExit }: { onExit: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [meta, setMeta] = useState<StatsMeta | null>(null);
  const [filters, setFilters] = useState<StatsQuery>(loadFilters);
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
    } catch {
      /* sem armazenamento */
    }
  }, [filters, min]);

  // Visão geral (Líderes e matchups).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .stats(filters)
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
  }, [filters]);

  // Na aba de cartas, um Líder é obrigatório: o mais jogado com esses filtros.
  const cardsLeader = leader || overview?.leaders[0]?.leader || '';
  useEffect(() => {
    if (tab !== 'cards' || !cardsLeader) return;
    let cancelled = false;
    api
      .cardStats({ ...filters, leader: cardsLeader, deck: deck || undefined })
      .then((d) => !cancelled && setCards(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [tab, filters, cardsLeader, deck]);

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
            <div className="field">
              <label>{t('stats.filterQueue')}</label>
              <Seg
                value={filters.queue ?? ''}
                options={[['', t('stats.allFem')], ...(meta?.queues.map((q): [string, string] => [q.id, q.label]) ?? [])]}
                onChange={(queue) => set({ queue })}
              />
            </div>
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
              query={filters}
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
        <p className="muted small">{t('stats.footer', { n: MIN_GAMES })}</p>
      </div>
    </div>
  );
}
