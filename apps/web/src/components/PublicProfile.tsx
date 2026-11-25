// Perfil público do jogador (roadmap E1), aberto por `/?perfil=<id>`: o cartaz WANTED, a recompensa,
// os Líderes mais jogados, as partidas recentes (com replay, quando liberado) e os decks escolhidos.
// Tudo vem pronto do servidor (`GET /api/profiles/:id`), que só manda o que o jogador deixou público.
// O dono vê a mesma página que os outros e, embaixo do cartaz, o painel "O que aparece".

import { formatDeckList, formatLabel, type FormatId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type DeckSummary, type ProfileSettings, type PublicProfile as Profile, type PublicProfileMatch } from '../api';
import type { DeckLink } from '../deeplink';
import { setupFromReplay } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { useLocale, useT } from '../i18n';
import { fmtBerries, fmtDate, fmtDateTime, fmtNumber } from '../i18n/format';
import { profileUrl } from '../profileLink';
import { LeaderArt } from './LeaderArt';
import { QUEUE_LABEL, tierName } from './Online';

/** Máximo de decks no perfil (o mesmo limite do servidor). */
const MAX_DECKS = 6;

const pct = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');

export function PublicProfile({
  id,
  onExit,
  onReplay,
  onOpenDeck,
}: {
  id: string;
  onExit: () => void;
  onReplay: (setup: GameSetup) => void;
  onOpenDeck: (link: DeckLink) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const load = () =>
    api.profiles.get(id).then(
      (p) => {
        setProfile(p);
        setMissing(false);
      },
      (e: unknown) => {
        if ((e as { status?: number })?.status === 404) setMissing(true);
        else fail(e);
      },
    );
  useEffect(() => {
    setProfile(null);
    void load();
  }, [id]);

  const copy = () => {
    const url = profileUrl(id);
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => window.prompt(t('profile.copyPrompt'), url),
    ) ?? window.prompt(t('profile.copyPrompt'), url);
  };
  const openReplay = (m: PublicProfileMatch) => {
    setError(null);
    api.profiles
      .replay(id, m.id)
      .then((r) => setupFromReplay(r as never))
      .then(onReplay, fail);
  };

  const card = (cardId: string) => profile?.cards[cardId];
  const leaderArt = (cardId: string, size?: 'small' | 'tiny') => {
    const c = card(cardId);
    return <LeaderArt name={c?.name ?? cardId} image={c?.imageUrl} colors={c?.colors} size={size} />;
  };
  const queueName = (q: string) => (q in QUEUE_LABEL ? t(QUEUE_LABEL[q as keyof typeof QUEUE_LABEL]) : q);

  return (
    <div className="coverage public-profile">
      <header className="builder-header">
        <button className="btn small" onClick={onExit}>
          {t('watch.menu')}
        </button>
        <h2>{t('profile.title')}</h2>
      </header>
      <div className="coverage-body">
        {error && <div className="error">{error}</div>}
        {missing && (
          <section className="menu-card">
            <p>{t('profile.notFound')}</p>
          </section>
        )}
        {!profile && !missing && !error && <p className="muted">{t('profile.loading')}</p>}
        {profile && (
          <>
            {profile.mine && profile.settings && !profile.settings.visible && <div className="notice">{t('profile.hiddenNotice')}</div>}
            <section className="menu-card stats-profile">
              <div className="poster">
                <span className="poster-wanted">{t('stats.wanted')}</span>
                <span className="poster-name static">{profile.name}</span>
                <span className="poster-bounty">{fmtBerries(profile.bounty, locale)}</span>
              </div>
              <div className="profile-info">
                <div className="tier-badge">{tierName(t, profile.tier)}</div>
                <p className="muted small">
                  {t('profile.rankedGames', { n: profile.rankedGames })} · {t('profile.since', { date: fmtDate(profile.since, locale) })}
                </p>
                {profile.record && (
                  <p className="muted small">
                    {t('profile.record', { games: fmtNumber(profile.record.games, locale), wins: fmtNumber(profile.record.wins, locale), pct: pct(profile.record.wins, profile.record.games) })}
                  </p>
                )}
                <div className="profile-actions">
                  <button className="btn small" onClick={copy}>
                    {copied ? t('profile.copied') : t('profile.copyLink')}
                  </button>
                </div>
              </div>
            </section>

            {profile.mine && profile.settings && <ProfileEditor settings={profile.settings} onSaved={load} />}

            {profile.leaders && (
              <section className="menu-card">
                <h3>{t('profile.leadersTitle')}</h3>
                {profile.leaders.length === 0 ? (
                  <p className="muted small">{t('profile.noGames')}</p>
                ) : (
                  <ul className="profile-leaders">
                    {profile.leaders.map((l) => (
                      <li key={l.leader}>
                        {leaderArt(l.leader, 'small')}
                        <span className="profile-leader-name">{card(l.leader)?.name ?? l.leader}</span>
                        <span className="muted small">
                          {t('profile.leaderLine', { games: l.games, pct: pct(l.wins, l.games) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {profile.matches && (
              <section className="menu-card">
                <h3>{t('profile.matchesTitle')}</h3>
                {profile.matches.length === 0 ? (
                  <p className="muted small">{t('profile.noGames')}</p>
                ) : (
                  <ul className="profile-matches">
                    {profile.matches.map((m) => (
                      <li key={m.id} className={m.draw ? 'draw' : m.won ? 'won' : 'lost'}>
                        <span className="profile-match-leaders">
                          {leaderArt(m.leader, 'tiny')}
                          <span className="muted small">vs</span>
                          {leaderArt(m.oppLeader, 'tiny')}
                        </span>
                        <span className="profile-match-info">
                          <b>{m.draw ? t('profile.draw') : m.won ? t('profile.win') : t('profile.loss')}</b>
                          <span className="muted small">
                            {[
                              card(m.oppLeader)?.name ?? m.oppLeader,
                              m.oppController === 'bot' ? t('profile.vsBot') : t('profile.vsPlayer'),
                              queueName(m.queue),
                              formatLabel(m.format as FormatId),
                              fmtDateTime(m.playedAt, locale),
                            ].join(' · ')}
                          </span>
                          {m.bountyDelta !== null && (
                            <span className={`small ${m.bountyDelta >= 0 ? 'gain' : 'drop'}`}>
                              {m.bountyDelta >= 0 ? '+' : '−'}
                              {fmtBerries(Math.abs(m.bountyDelta), locale)}
                            </span>
                          )}
                        </span>
                        {m.replay && (
                          <button className="btn small" onClick={() => openReplay(m)}>
                            {t('profile.watchReplay')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {profile.decks.length > 0 && (
              <section className="menu-card">
                <h3>{t('profile.decksTitle')}</h3>
                <ul className="profile-decks">
                  {profile.decks.map((d) => (
                    <li key={d.id}>
                      {leaderArt(d.leader, 'small')}
                      <span className="profile-deck-info">
                        <b>{d.name}</b>
                        <span className="muted small">
                          {card(d.leader)?.name ?? d.leader} · {t('profile.deckLine', { games: d.games, pct: pct(d.wins, d.games) })}
                        </span>
                      </span>
                      <button className="btn small" onClick={() => onOpenDeck({ text: formatDeckList(d), name: d.name })}>
                        {t('profile.openDeck')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Painel do dono: o que aparece no perfil e quais decks. */
function ProfileEditor({ settings, onSaved }: { settings: ProfileSettings; onSaved: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    api.decks().then((all) => setDecks(all.filter((d) => d.mine)), () => setDecks([]));
  }, []);

  const save = (next: ProfileSettings) => {
    setDraft(next);
    setBusy(true);
    setError(null);
    api.profiles
      .save(next)
      .then(onSaved, (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setDraft(settings);
      })
      .finally(() => setBusy(false));
  };
  const toggle = (key: 'visible' | 'leaders' | 'matches' | 'replays') => save({ ...draft, [key]: !draft[key] });
  const toggleDeck = (deckId: string) =>
    save({ ...draft, decks: draft.decks.includes(deckId) ? draft.decks.filter((d) => d !== deckId) : [...draft.decks, deckId] });

  const flags: Array<['visible' | 'leaders' | 'matches' | 'replays', string, string?]> = [
    ['visible', t('profile.optVisible'), t('profile.optVisibleHint')],
    ['leaders', t('profile.optLeaders')],
    ['matches', t('profile.optMatches')],
    ['replays', t('profile.optReplays'), t('profile.optReplaysHint')],
  ];
  return (
    <section className="menu-card profile-editor">
      <h3>{t('profile.editTitle')}</h3>
      <p className="muted small">{t('profile.editIntro')}</p>
      {error && <div className="error">{error}</div>}
      {flags.map(([key, label, hint]) => (
        <label key={key} className="check">
          <input type="checkbox" checked={draft[key]} disabled={busy || (key === 'replays' && !draft.matches)} onChange={() => toggle(key)} />
          <span>
            {label}
            {hint && <span className="muted small"> {hint}</span>}
          </span>
        </label>
      ))}
      <h4>{t('profile.decksPick', { max: MAX_DECKS })}</h4>
      {decks === null ? (
        <p className="muted small">{t('profile.loading')}</p>
      ) : decks.length === 0 ? (
        <p className="muted small">{t('profile.noDecks')}</p>
      ) : (
        <div className="profile-deck-picks">
          {decks.map((d) => {
            const on = draft.decks.includes(d.id);
            return (
              <label key={d.id} className="check">
                <input type="checkbox" checked={on} disabled={busy || (!on && draft.decks.length >= MAX_DECKS)} onChange={() => toggleDeck(d.id)} />
                <span>
                  {d.name} <span className="muted small">({d.leaderName ?? d.leader})</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
