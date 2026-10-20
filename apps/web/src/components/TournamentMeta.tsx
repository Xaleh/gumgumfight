// Painel do meta dos torneios (aba "Meta" da lista de torneios): totais, último torneio
// e campeão, próximos torneios, Líderes em destaque, distribuição do meta, ranking de
// jogadores e torneios recentes. Os dados vêm de GET /api/tournaments/meta.

import { FORMATS } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type CardInfo, type FormatId, type TournamentMeta as Meta, tourFormatLabel } from '../api';
import { useLocale, useT } from '../i18n';
import { fmtDate, fmtDateTime, fmtNumber } from '../i18n/format';
import { LeaderArt } from './LeaderArt';

/** Períodos do filtro, em dias (0 = tudo). */
const PERIODS = [30, 90, 0] as const;
/** Líderes em destaque (cartões com arte). */
const FEATURED = 6;
/** Linhas da distribuição antes de "Outros". */
const DISTRIBUTION = 12;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const winRate = (w: number, l: number) => (w + l ? pct(w / (w + l)) : '—');

export default function TournamentMeta({ onOpen }: { onOpen: (id: string) => void }) {
  const tr = useT();
  const locale = useLocale();
  const [format, setFormat] = useState<FormatId | null>(null);
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    setData(null);
    api.tournaments
      .meta({ format: format ?? undefined, days: days || undefined })
      .then((d) => !stop && (setData(d), setError(null)))
      .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stop = true;
    };
  }, [format, days]);

  const card = (id: string): CardInfo | undefined => data?.cards[id];
  const art = (id: string, size?: 'small' | 'tiny') => <LeaderArt name={card(id)?.name ?? id} image={card(id)?.imageUrl} colors={card(id)?.colors} size={size} />;
  const entries = data?.leaders.reduce((n, l) => n + l.entries, 0) ?? 0;
  const shown = data?.leaders.slice(0, DISTRIBUTION) ?? [];
  const rest = data?.leaders.slice(DISTRIBUTION) ?? [];
  const top = shown[0]?.share ?? 1;

  return (
    <div className="tmeta">
      <div className="tmeta-filters">
        <div className="seg small">
          <button className={format === null ? 'on' : ''} onClick={() => setFormat(null)}>
            {tr('tmeta.formatAll')}
          </button>
          {FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)}>
              {tourFormatLabel({ format: f.id })}
            </button>
          ))}
        </div>
        <div className="seg small">
          {PERIODS.map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d ? tr('tmeta.days', { n: d }) : tr('tmeta.daysAll')}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">{tr('common.loading')}</p>}

      {data && (
        <>
          <div className="stat-tiles">
            {(
              [
                ['tmeta.tileEvents', data.totals.events],
                ['tmeta.tilePlayers', data.totals.players],
                ['tmeta.tileLeaders', data.totals.leaders],
                ['tmeta.tileMatches', data.totals.matches],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="stat-tile">
                <span className="muted small">{tr(label)}</span>
                <b>{fmtNumber(n, locale)}</b>
              </div>
            ))}
          </div>

          <div className="tmeta-grid">
            <section className="menu-card tmeta-latest">
              <h2>{tr('tmeta.latest')}</h2>
              {data.latest ? (
                <button className="tmeta-event big" onClick={() => onOpen(data.latest!.id)}>
                  {data.latest.champion ? art(data.latest.champion.leader) : <LeaderArt />}
                  <span className="tmeta-event-text">
                    <strong>{data.latest.name}</strong>
                    <span className="muted small">
                      {[
                        data.latest.finishedAt && fmtDate(data.latest.finishedAt, locale),
                        tourFormatLabel(data.latest),
                        tr('tour.playersCount', { n: data.latest.players }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {data.latest.champion && (
                      <span>
                        <span className="tour-badge gold">{tr('tour.badgeChampion')}</span> {data.latest.champion.name}
                        <span className="muted small"> · {card(data.latest.champion.leader)?.name ?? data.latest.champion.leader}</span>
                      </span>
                    )}
                  </span>
                </button>
              ) : (
                <p className="muted small">{tr('tmeta.empty')}</p>
              )}
            </section>

            <section className="menu-card tmeta-upcoming">
              <h2>{tr('tmeta.upcoming')}</h2>
              {data.upcoming.length === 0 && <p className="muted small">{tr('tmeta.noUpcoming')}</p>}
              {data.upcoming.map((u) => (
                <button key={u.id} className="tmeta-event" onClick={() => onOpen(u.id)}>
                  <span className="tmeta-event-text">
                    <strong>
                      {u.name}
                      {u.status === 'running' && <span className="tour-status running">{tr('tmeta.live')}</span>}
                    </strong>
                    <span className="muted small">
                      {[
                        u.startsAt && u.status === 'registration' ? fmtDateTime(u.startsAt, locale) : null,
                        tourFormatLabel(u),
                        u.maxPlayers ? tr('tour.playersOfMax', { n: u.players, max: u.maxPlayers }) : tr('tour.playersCount', { n: u.players }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {(u.official || u.prize) && (
                      <span className="tour-official-line">
                        {u.official && <span className="tour-badge official">{tr('tour.officialBadge')}</span>}
                        {u.prize && <span className="tour-prize">🏆 {u.prize}</span>}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </section>
          </div>

          {data.leaders.length > 0 && (
            <section className="menu-card">
              <h2>{tr('tmeta.topLeaders')}</h2>
              <div className="tmeta-leaders">
                {data.leaders.slice(0, FEATURED).map((l) => (
                  <div key={l.leader} className="tmeta-leader">
                    {art(l.leader, 'small')}
                    <span className="tmeta-event-text">
                      <strong>{card(l.leader)?.name ?? l.leader}</strong>
                      <span className="muted small">{l.leader}</span>
                    </span>
                    <span className="tmeta-leader-nums">
                      <b title={tr('tmeta.winRateTitle', { wins: l.wins, losses: l.losses })}>{winRate(l.wins, l.losses)}</b>
                      <span className="muted small">{tr('tmeta.leaderLine', { entries: l.entries, titles: l.titles })}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.leaders.length > 0 && (
            <section className="menu-card">
              <h2>{tr('tmeta.distribution')}</h2>
              <p className="muted small">{tr('tmeta.distributionNote', { n: entries })}</p>
              <ol className="tmeta-dist">
                {shown.map((l) => (
                  <li key={l.leader}>
                    {art(l.leader, 'tiny')}
                    <span className="tmeta-dist-name">
                      {card(l.leader)?.name ?? l.leader} <span className="muted small">{l.leader}</span>
                    </span>
                    <span className="tmeta-dist-bar">
                      <span style={{ width: `${(l.share / top) * 100}%`, ['--card-color' as string]: `var(--${cssColor(card(l.leader))})` }} />
                    </span>
                    <span className="tmeta-dist-num">
                      <b>{pct(l.share)}</b> <span className="muted small">{l.entries}</span>
                    </span>
                  </li>
                ))}
                {rest.length > 0 && (
                  <li className="muted">
                    <LeaderArt size="tiny" />
                    <span className="tmeta-dist-name">{tr('tmeta.others', { n: rest.length })}</span>
                    <span className="tmeta-dist-bar">
                      <span style={{ width: `${(rest.reduce((n, l) => n + l.share, 0) / top) * 100}%` }} />
                    </span>
                    <span className="tmeta-dist-num">
                      <b>{pct(rest.reduce((n, l) => n + l.share, 0))}</b> <span className="muted small">{rest.reduce((n, l) => n + l.entries, 0)}</span>
                    </span>
                  </li>
                )}
              </ol>
            </section>
          )}

          {data.players.length > 0 && (
            <section className="menu-card">
              <h2>{tr('tmeta.players')}</h2>
              <div className="table-scroll">
                <table className="cov-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{tr('tour.colPlayer')}</th>
                      <th>{tr('tmeta.colTitles')}</th>
                      <th>{tr('tour.colRecord')}</th>
                      <th>{tr('tmeta.colWinRate')}</th>
                      <th>{tr('tmeta.colEvents')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.players.map((p, i) => (
                      <tr key={`${p.name}:${i}`}>
                        <td>{i + 1}</td>
                        <td>
                          <span className="tmeta-player">
                            {art(p.leader, 'tiny')}
                            {p.name}
                          </span>
                        </td>
                        <td>{p.titles ? `🏆 ${p.titles}` : '—'}</td>
                        <td>
                          {p.wins}-{p.losses}
                        </td>
                        <td>{winRate(p.wins, p.losses)}</td>
                        <td>{p.events}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.recent.length > 0 && (
            <section className="menu-card">
              <h2>{tr('tmeta.recent')}</h2>
              <div className="tmeta-recent">
                {data.recent.map((e) => (
                  <button key={e.id} className="tmeta-event" onClick={() => onOpen(e.id)}>
                    {e.champion ? art(e.champion.leader, 'small') : <LeaderArt size="small" />}
                    <span className="tmeta-event-text">
                      <strong>{e.name}</strong>
                      <span className="muted small">
                        {[e.finishedAt && fmtDate(e.finishedAt, locale), tr('tour.playersCount', { n: e.players })].filter(Boolean).join(' · ')}
                      </span>
                      {e.champion && <span className="small">🏆 {e.champion.name}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <p className="muted small">{tr('tmeta.note')}</p>
        </>
      )}
    </div>
  );
}

/** Variável de cor da carta (a mesma regra do LeaderArt). */
const cssColor = (c?: CardInfo) => (c?.colors[0] === 'blue' ? 'blue-card' : (c?.colors[0] ?? 'red'));
