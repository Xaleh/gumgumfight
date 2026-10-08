import { type ReactNode, useEffect, useMemo, useState } from 'react';
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
import { LeaderArt } from './LeaderArt';

/** Abaixo disso, a taxa é mostrada esmaecida (amostra pequena). */
const MIN_GAMES = 10;
const FILTERS_KEY = 'gumgum.statsFilters';
const MIN_KEY = 'gumgum.statsMin';

type Tab = 'leaders' | 'matchups' | 'trend' | 'cards';

const beries = (n: number) => `฿ ${n.toLocaleString('pt-BR')}`;
const rate = (w: WinCount) => (w.games ? w.wins / w.games : null);
const fmtPct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

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

function WinRate({ w, compact }: { w: WinCount; compact?: boolean }) {
  const r = rate(w);
  const ci = wilson(w);
  const small = w.games < MIN_GAMES;
  const title = ci
    ? `${w.wins} vitórias em ${w.games} partidas (95%: ${fmtPct(ci[0])} a ${fmtPct(ci[1])})`
    : 'Sem partidas';
  return (
    <span className={['winrate', small ? 'small-sample' : ''].join(' ')} title={title}>
      <b>{fmtPct(r)}</b>
      {!compact && <span className="muted small"> {w.games}</span>}
    </span>
  );
}

function WinBar({ w }: { w: WinCount }) {
  const r = rate(w);
  const ci = wilson(w);
  return (
    <div className="wr-bar" title={ci ? `95%: ${fmtPct(ci[0])} a ${fmtPct(ci[1])}` : undefined}>
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
        <span className="poster-wanted">WANTED</span>
        {editing ? (
          <span className="poster-edit">
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn small primary" onClick={save}>
              Salvar
            </button>
          </span>
        ) : (
          <button
            className="poster-name"
            onClick={() => {
              setName(me?.name ?? '');
              setEditing(true);
            }}
            title="Trocar o nome"
          >
            {me?.name ?? 'Pirata sem nome'} ✎
          </button>
        )}
        <span className="poster-bounty">{beries(me?.bounty ?? 0)}</span>
      </div>
      <div className="profile-info">
        <div className="tier-badge">{tier?.label}</div>
        <p className="muted small">
          {tier && `Faixa ${beries(tier.min)}${tier.max === null ? ' ou mais' : ` a ${beries(tier.max)}`}.`}
          {next && ` Próximo tier: ${next.label} (${beries(next.min)}).`}
        </p>
        <p className="muted small">
          A recompensa sobe e desce nas partidas ranqueadas contra outros jogadores
          {me ? ` (${me.rankedGames} jogadas)` : ''}. Partidas contra o bot contam nas estatísticas como casuais.
        </p>
        {error && <div className="error">{error}</div>}
      </div>
    </section>
  );
}

function SummaryTiles({ s }: { s: StatsSummary }) {
  const tiles: Array<[string, ReactNode, string]> = [
    ['Partidas', s.games.toLocaleString('pt-BR'), `${s.players} jogadores`],
    ['Vitórias', fmtPct(rate(s)), `${s.wins} de ${s.games}`],
    ['Começando', fmtPct(rate(s.first)), `${s.first.games} partidas`],
    ['Como segundo', fmtPct(rate(s.second)), `${s.second.games} partidas`],
    ['Mantendo a mão', fmtPct(rate(s.keep)), `${s.keep.games} partidas`],
    ['Com mulligan', fmtPct(rate(s.mulligan)), `${s.mulligan.games} partidas`],
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
  const s = data.summary;
  if (!s.games) return null;
  const name = (id: string) => data.cards[id]?.name ?? id;
  const share = (games: number) => fmtPct(games / s.games);
  const established = data.leaders.filter((l) => l.games >= min);
  const top = data.leaders[0];
  const best = [...established].sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0))[0];
  const losing = established.filter((l) => l.games / s.games >= 0.05 && (rate(l) ?? 1) < 0.47);
  const items: ReactNode[] = [];
  items.push(
    <>
      <b>{name(top.leader)}</b> é o Líder mais jogado ({share(top.games)} das partidas), com {fmtPct(rate(top))} de
      vitórias.
    </>,
  );
  if (best && best.leader !== top.leader) {
    items.push(
      <>
        Melhor taxa de vitórias entre os Líderes com pelo menos {min} partidas: <b>{name(best.leader)}</b>,{' '}
        {fmtPct(rate(best))} (em {share(best.games)} das partidas).
      </>,
    );
  } else if (best) {
    items.push(
      <>Além de ser o mais jogado, ele também lidera em vitórias entre os Líderes com pelo menos {min} partidas.</>,
    );
  }
  if (losing.length) {
    items.push(
      <>Muito jogados, mas perdendo: {losing.map((l) => `${name(l.leader)} (${fmtPct(rate(l))})`).join(', ')}.</>,
    );
  }
  if (s.first.games && s.second.games) {
    items.push(
      <>
        Quem começa vence {fmtPct(rate(s.first))} das partidas; quem joga em segundo, {fmtPct(rate(s.second))}.
      </>,
    );
  }
  if (s.mulligan.games >= min) {
    items.push(
      <>
        Depois de um mulligan a taxa é {fmtPct(rate(s.mulligan))}, contra {fmtPct(rate(s.keep))} mantendo a mão.
      </>,
    );
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
  if (!data.leaders.length) return <p className="muted">Nenhuma partida com esses filtros.</p>;
  return (
    <>
      <MetaSummary data={data} min={min} />
      <div className="table-scroll">
        <table className="cov-table stat-table">
          <thead>
            <tr>
              <th>Líder</th>
              {th('games', 'Partidas')}
              {th('rate', 'Vitórias')}
              <th className="wr-col">Intervalo (95%)</th>
              {th('first', '1º', 'Vitórias começando a partida')}
              {th('second', '2º', 'Vitórias jogando em segundo')}
              {th('lists', 'Listas', 'Listas diferentes usadas')}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.leader}
                className="clickable"
                onClick={() => onPick(l.leader)}
                title="Ver as cartas deste Líder"
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
      {hidden > 0 && (
        <p className="muted small">
          {hidden} Líder(es) com menos de {min} partidas escondido(s). Mude o mínimo nos filtros para ver.
        </p>
      )}
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
  const byPair = useMemo(() => new Map(data.matchups.map((m) => [`${m.leader}|${m.oppLeader}`, m])), [data]);
  const name = (id: string) => data.cards[id]?.name ?? id;

  if (leader) {
    const all = data.matchups.filter((m) => m.leader === leader);
    const rows = all.filter((m) => m.games >= min).sort((a, b) => b.games - a.games);
    return (
      <>
        <button className="btn small" onClick={() => onLeader('')}>
          ← Tabela de todos os Líderes
        </button>
        <h3 className="stats-sub">
          <CardName id={leader} info={data.cards[leader]} /> contra cada Líder
        </h3>
        {!rows.length && <p className="muted">Nenhum matchup deste Líder com {min} partidas ou mais.</p>}
        <div className="table-scroll">
          <table className="cov-table stat-table">
            {rows.length > 0 && (
              <thead>
                <tr>
                  <th>Adversário</th>
                  <th>Vitórias</th>
                  <th className="wr-col">Intervalo (95%)</th>
                  <th title="Vitórias do Líder analisado quando ele começa">Começando</th>
                  <th title="Vitórias do Líder analisado jogando em segundo">Em segundo</th>
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
          <p className="muted small">
            {all.length - rows.length} adversário(s) com menos de {min} partidas escondido(s).
          </p>
        )}
      </>
    );
  }

  // Mesma ordem nas linhas e nas colunas (mais jogados primeiro), com o espelho na diagonal.
  const leaders = data.leaders.slice(0, MATRIX_SIZE).map((l) => l.leader);
  const opponents = leaders;
  if (!leaders.length) return <p className="muted">Nenhuma partida com esses filtros.</p>;
  return (
    <>
      <p className="muted small">
        Linha = Líder analisado, coluna = Líder adversário. A cor vai do laranja (perde mais) ao azul (vence mais),
        passando pelo cinza em 50%. Na diagonal (espelho), a taxa é de quem começou. Células com menos de {min} partidas
        mostram só a quantidade. Clique numa linha para ver todos os adversários daquele Líder.
      </p>
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
                          ? `${name(l)} x ${name(o)}: ${m.wins} vitórias em ${m.games}; começando: ${fmtPct(first)} em ${m.firstGames}`
                          : 'Sem partidas'
                      }
                    >
                      {m && enough ? (
                        <>
                          <b>{fmtPct(r)}</b>
                          <span className="muted small">{mirror ? `1º · ${m.games}` : m.games}</span>
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
  const w = 96;
  const h = 28;
  const pad = 3;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - (max ? (v / max) * (h - 2 * pad) : 0);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img">
      <title>{values.map((v, i) => `${labels[i]}: ${fmtPct(v)}`).join('\n')}</title>
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

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Diferença em pontos percentuais, com a mesma cor das taxas. */
function Delta({ d }: { d: number | null }) {
  if (d === null) return <>—</>;
  return (
    <span className="delta" style={{ background: rateColor(0.5 + d) }}>
      {d >= 0 ? '+' : '−'}
      {Math.abs(d * 100).toFixed(1)} pp
    </span>
  );
}

/** Quem sobe e quem cai: participação e vitórias por semana. */
function Trend({ query, min, onPick }: { query: StatsQuery; min: number; onPick: (leader: string) => void }) {
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
  if (!data || !table) return <p className="muted">Carregando…</p>;
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
  const pp = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pp`;

  return (
    <>
      <div className="stats-pickers">
        <label>
          Semanas
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[4, 6, 8, 12].map((w) => (
              <option key={w} value={w}>
                {w} semanas
              </option>
            ))}
          </select>
        </label>
      </div>
      {(risers.length > 0 || fallers.length > 0) && (
        <ul className="meta-summary">
          {risers.length > 0 && (
            <li>Subindo nesta semana: {risers.map((l) => `${name(l.leader)} (${pp(l.delta)})`).join(', ')}.</li>
          )}
          {fallers.length > 0 && (
            <li>Caindo: {fallers.map((l) => `${name(l.leader)} (${pp(l.delta)})`).join(', ')}.</li>
          )}
        </ul>
      )}
      {!table.leaders.length && <p className="muted">Nenhum Líder com {min} partidas ou mais nessas semanas.</p>}
      {table.leaders.length > 0 && (
        <div className="table-scroll">
          <table className="cov-table stat-table">
            <thead>
              <tr>
                <th>Líder</th>
                <th title="Participação nas partidas de cada semana">
                  Uso ({shortDate(data.weeks[0])} → {shortDate(data.weeks[n - 1])})
                </th>
                <th>Nesta semana</th>
                <th title="Variação da participação em relação à semana anterior">Δ uso</th>
                <th>Vitórias na semana</th>
                <th>Vitórias no período</th>
              </tr>
            </thead>
            <tbody>
              {table.leaders.map((l) => (
                <tr
                  key={l.leader}
                  className="clickable"
                  onClick={() => onPick(l.leader)}
                  title="Ver os matchups deste Líder"
                >
                  <td>
                    <CardName id={l.leader} info={data.cards[l.leader]} />
                  </td>
                  <td>
                    <Sparkline values={l.shares} max={table.max} labels={data.weeks.map(shortDate)} />
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
      <p className="muted small">
        Semanas começam na segunda-feira. O período dos filtros não vale aqui: a janela é a escolhida acima.
      </p>
    </>
  );
}

function CardsTable({ data, min }: { data: CardStatsResponse; min: number }) {
  type K = 'games' | 'rate' | 'lift' | 'opening' | 'drawn' | 'notDrawn' | 'iwd' | 'played' | 'perGame';
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
  if (!rows.length) return <p className="muted">Nenhuma carta com {min} partidas ou mais com esses filtros.</p>;
  return (
    <>
      <p className="muted small">
        <b>Lift</b>: vitórias com a carta no deck menos as vitórias do Líder em geral ({fmtPct(base)}); só aparece
        quando nem todas as listas usam a carta. <b>Mão inicial</b>: a carta estava na mão mantida após o mulligan.{' '}
        <b>Comprada</b>: passou pela mão em algum momento. <b>Δ comprada</b>: vitórias quando comprada menos vitórias
        quando não comprada; positivo indica que a carta ajuda quando aparece. Toque no cabeçalho para ordenar.
      </p>
      <div className="table-scroll">
        <table className="cov-table stat-table">
          <thead>
            <tr>
              <th>Carta</th>
              {th('games', 'No deck', 'Partidas com a carta no deck (média de cópias)')}
              {th('rate', 'Vitórias')}
              {th('lift', 'Lift', 'Vitórias com a carta no deck menos as vitórias do Líder em geral')}
              {th('opening', 'Mão inicial')}
              {th('drawn', 'Comprada')}
              {th('notDrawn', 'Não comprada')}
              {th('iwd', 'Δ comprada', 'Diferença de vitórias entre comprar e não comprar a carta')}
              {th('played', 'Jogada')}
              {th('perGame', 'Usos/partida', 'Vezes jogada (ou usada como Counter) por partida')}
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
                    <span className="muted small">×{c.avgCopies.toFixed(1)}</span>
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
          ← Menu
        </button>
        <h2>Estatísticas</h2>
        {loading && <span className="muted small">Atualizando…</span>}
      </header>
      <div className="coverage-body stats-body">
        {error && <div className="error">{error}</div>}
        {meta && <Profile me={meta.me} tiers={meta.tiers} onRename={(me) => setMeta({ ...meta, me })} />}

        <details className="menu-card stats-filters" open>
          <summary>Filtros</summary>
          <div className="filter-grid">
            <div className="field">
              <label>Formato</label>
              <Seg
                value={filters.format ?? ''}
                options={[['', 'Todos'], ...(meta?.formats.map((f): [string, string] => [f.id, f.label]) ?? [])]}
                onChange={(format) => set({ format })}
              />
            </div>
            <div className="field">
              <label>Partida</label>
              <Seg
                value={filters.queue ?? ''}
                options={[['', 'Todas'], ...(meta?.queues.map((q): [string, string] => [q.id, q.label]) ?? [])]}
                onChange={(queue) => set({ queue })}
              />
            </div>
            <div className="field">
              <label>Oponente</label>
              <Seg
                value={filters.opponent ?? ''}
                options={[
                  ['', 'Todos'],
                  ['bot', 'Bot'],
                  ['human', 'Jogador'],
                ]}
                onChange={(opponent) => set({ opponent })}
              />
            </div>
            <div className="field">
              <label>Ordem do turno</label>
              <Seg
                value={filters.first ?? ''}
                options={[
                  ['', 'Todas'],
                  ['first', 'Começando'],
                  ['second', 'Em segundo'],
                ]}
                onChange={(first) => set({ first })}
              />
            </div>
            <div className="field">
              <label>Período</label>
              <Seg
                value={filters.days ?? ''}
                options={[
                  ['', 'Tudo'],
                  ['7', '7 dias'],
                  ['30', '30 dias'],
                  ['90', '90 dias'],
                ]}
                onChange={(days) => set({ days })}
              />
            </div>
            <div className="field">
              <label>De quem</label>
              <Seg
                value={filters.mine ? 'mine' : 'all'}
                options={[
                  ['all', 'Todos os jogadores'],
                  ['mine', 'Só eu'],
                ]}
                onChange={(v) => set({ mine: v === 'mine', by: 'human' })}
              />
            </div>
            <div className="field">
              <label>Mínimo de partidas por linha</label>
              <Seg
                value={String(min)}
                options={[
                  ['1', 'Todas'],
                  ['10', '10'],
                  ['50', '50'],
                  ['100', '100'],
                ]}
                onChange={(v) => setMin(Number(v))}
              />
            </div>
            <div className="field tier-field">
              <label>Tiers (recompensa na hora da partida)</label>
              <div className="tier-chips">
                {meta?.tiers.map((t) => (
                  <button
                    key={t.id}
                    className={['chip', filters.tiers?.includes(t.id) ? 'on' : ''].join(' ')}
                    onClick={() => toggleTier(t.id)}
                    title={`${beries(t.min)}${t.max === null ? ' ou mais' : ` a ${beries(t.max)}`}`}
                  >
                    {t.label}
                  </button>
                ))}
                {!!filters.tiers?.length && (
                  <button className="btn small pill" onClick={() => set({ tiers: [] })}>
                    Todos
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
              ['leaders', 'Líderes'],
              ['matchups', 'Matchups'],
              ['trend', 'Tendência'],
              ['cards', 'Cartas'],
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
                  Líder
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
                        {info[l]?.name ?? l} ({l})
                      </option>
                    ))}
                  </select>
                </label>
                {myLists.length > 0 && (
                  <label>
                    Lista
                    <select value={deck} onChange={(e) => setDeck(e.target.value)}>
                      <option value="">Todas as listas</option>
                      {myLists.map((d) => (
                        <option key={d.hash} value={d.hash}>
                          {d.deckId ?? d.hash} · {d.games} partidas
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {!cardsLeader && <p className="muted">Nenhuma partida com esses filtros.</p>}
              {cardsLeader && cards && <CardsTable data={cards} min={min} />}
            </>
          )}
        </section>
        <p className="muted small">
          Cada partida é refeita pelo servidor a partir do replay antes de entrar nas estatísticas. Taxas com menos de{' '}
          {MIN_GAMES} partidas aparecem esmaecidas: passe o mouse para ver o intervalo de confiança.
        </p>
      </div>
    </div>
  );
}
