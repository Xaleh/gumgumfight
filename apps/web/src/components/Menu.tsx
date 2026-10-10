import { type BotLevel, FORMATS, formatLabel, type PlayerId } from '@gumgum/engine';
import { type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from 'react';
import {
  type ActiveRoom,
  api,
  ApiError,
  canPlay,
  deckGroups,
  type DeckSummary,
  type FormatId,
  type OnlineSeat,
  type QueueKind,
  type TournamentMine,
  type WatchTarget,
  whyNotPlayable,
} from '../api';
import jollyRoger from '../assets/jolly-roger.svg';
import { useAuth } from '../auth';
import { buildSetup, setupFromReplayText } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useT } from '../i18n';
import { NICKNAME_EVENT, SettingsModal } from '../settings';
import { type NavItem, TopBar } from './AppShell';
import { LiveNow, MetaBlock, TournamentBanner, TournamentsBlock, usePoll } from './HomeBlocks';
import { Icon, type IconName } from './Icons';
import { LeaderArt } from './LeaderArt';
import { QueueWait, roomCodeFromUrl, useQueue } from './OnlineMenu';
import { ReplayLoader } from './ReplayLoader';

/** Código de sala do link de convite (lido uma vez, ao carregar a página). */
const URL_ROOM_CODE = roomCodeFromUrl();

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

const LAST_DECKS = 'gumgum.lastDecks';
const LAST_FORMAT = 'gumgum.format';
const LAST_BOT_LEVEL = 'gumgum.botLevel';

function savedBotLevel(): BotLevel {
  try {
    const v = localStorage.getItem(LAST_BOT_LEVEL);
    return v === 'easy' || v === 'normal' ? v : 'hard';
  } catch {
    return 'hard';
  }
}

function savedFormat(): FormatId {
  try {
    return localStorage.getItem(LAST_FORMAT) === 'egb' ? 'egb' : 'standard';
  } catch {
    return 'standard';
  }
}

const RANDOM = 'random';

/** Arte do Líder do deck (ou o "?" do sorteio). */
function DeckArt({ deck, small }: { deck?: DeckSummary; small?: boolean }) {
  return (
    <LeaderArt
      name={deck ? (deck.leaderName ?? deck.name) : undefined}
      image={deck?.leaderImage}
      colors={deck?.colors}
      size={small ? 'small' : undefined}
    />
  );
}

function DeckPicker({
  title,
  decks,
  value,
  format,
  allowRandom,
  onPick,
  onClose,
}: {
  title: string;
  decks: DeckSummary[];
  value: string;
  format: FormatId;
  allowRandom?: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  // Ao abrir, a folha mostra o deck já escolhido (a lista pode ser longa).
  useEffect(() => {
    const b = body.current;
    const on = b?.querySelector<HTMLElement>('.deck-pick.on');
    if (!b || !on) return;
    // Rola só a folha (não a página atrás dela), e só se o deck está fora da parte visível.
    const top = on.getBoundingClientRect().top - b.getBoundingClientRect().top;
    if (top + on.offsetHeight > b.clientHeight) b.scrollTop = top - (b.clientHeight - on.offsetHeight) / 2;
  }, []);
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body" ref={body}>
          {allowRandom && (
            <div className="picker-grid">
              <button className={['deck-pick', value === RANDOM ? 'on' : ''].join(' ')} onClick={() => onPick(RANDOM)}>
                <DeckArt small />
                <span className="name">{t('menu.randomDeck')}</span>
              </button>
            </div>
          )}
          {deckGroups(decks)
            .filter(([, list]) => list.length)
            .map(([label, list]) => (
              <div key={label} className="picker-group">
                <label className="sheet-label">{t(label)}</label>
                <div className="picker-grid">
                  {list.map((d) => (
                    <button
                      key={d.id}
                      className={['deck-pick', d.id === value ? 'on' : ''].join(' ')}
                      disabled={!canPlay(d, format)}
                      onClick={() => onPick(d.id)}
                      title={whyNotPlayable(d, format) ?? d.name}
                    >
                      <DeckArt deck={d} small />
                      <span className="name">{d.name}</span>
                      {!d.valid && <span className="muted small">{d.size}/50</span>}
                      {d.valid && !canPlay(d, format) && <span className="muted small">{t('menu.notAllowedShort', { format: formatLabel(format) })}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Opções de teste (só Dev): seed do embaralhamento. */
function TestOptions({ seed, onSeed, onClose }: { seed: number; onSeed: (n: number) => void; onClose: () => void }) {
  const t = useT();
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('menu.testOptions')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor="test-seed">{t('menu.testSeed')}</label>
            <div className="seed">
              <input id="test-seed" type="number" value={seed} onChange={(e) => onSeed(Number(e.target.value) || 0)} />
              <button className="btn small" onClick={() => onSeed(randomSeed())} title={t('menu.testSeedRerollTitle')}>
                🎲
              </button>
            </div>
            <p className="muted small">{t('menu.testSeedHint')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Frase traduzida com um pedaço em JSX: `msg` ainda com o `{param}` por preencher, cortado
 * no lugar do parâmetro e com `node` no meio (ex.: o código da sala em negrito).
 */
function interp(msg: string, param: string, node: ReactNode): ReactNode {
  const [before, after] = msg.split(`{${param}}`);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

const fmtClock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Card de um modo de jogo: cor própria, contador ao vivo e botão de ação. */
function ModeCard({
  mode,
  color,
  icon,
  kicker,
  title,
  badge,
  desc,
  chips,
  live,
  note,
  action,
  onAction,
  disabled,
  highlight,
  gold,
  children,
  cardRef,
}: {
  /** Nome fixo do modo (id do título, independente do idioma). */
  mode: string;
  /** Cor da carta (variável CSS). */
  color: string;
  icon: IconName;
  kicker: string;
  title: string;
  badge: string;
  desc: string;
  chips?: string[];
  /** Contador ao vivo (null = sem contador neste modo). */
  live: ReactNode | null;
  /** Por que o botão está travado (ou um aviso). */
  note?: string | null;
  action: string;
  onAction: () => void;
  disabled?: boolean;
  highlight?: boolean;
  gold?: boolean;
  children?: ReactNode;
  cardRef?: Ref<HTMLElement>;
}) {
  const id = `mode-${mode}`;
  return (
    <article
      ref={cardRef}
      className={['mode-card', highlight ? 'highlight' : '', gold ? 'gold' : ''].join(' ')}
      style={{ ['--mode' as string]: `var(--${color})` }}
      aria-labelledby={id}
    >
      <div className="mode-top">
        <span className="mode-icon">
          <Icon name={icon} size={24} />
        </span>
        <span className="mode-badge">{badge}</span>
      </div>
      <div>
        <div className="mode-kicker">{kicker}</div>
        <h3 className="mode-title" id={id}>
          {title}
        </h3>
      </div>
      <p className="mode-desc">{desc}</p>
      {chips && chips.length > 0 && (
        <ul className="home-chips">
          {chips.map((c) => (
            <li key={c} className="home-chip">
              {c}
            </li>
          ))}
        </ul>
      )}
      {children}
      <div className="mode-foot">
        {live !== null && <div className="mode-live">{live}</div>}
        {note && <p className="mode-note">{note}</p>}
        <button type="button" className="mode-btn" disabled={disabled} onClick={onAction}>
          {action}
        </button>
      </div>
    </article>
  );
}

function Live({ children, off }: { children: ReactNode; off?: boolean }) {
  return (
    <>
      <span className={['live-dot', off ? 'off' : ''].join(' ')} />
      <span>{children}</span>
    </>
  );
}

export function Menu({
  onStart,
  onBuildDecks,
  onCoverage,
  onStats,
  onOnline,
  onWatch,
  onWatchRoom,
  onTournaments,
  onTournamentMatch,
  onAdmin,
  dev = false,
}: {
  onStart: (s: GameSetup) => void;
  onOnline: (s: OnlineSeat) => void;
  onBuildDecks: () => void;
  /** Cobertura das cartas (só para Dev). */
  onCoverage?: () => void;
  onStats: () => void;
  /** Lista de partidas online para assistir (modo espectador). */
  onWatch: () => void;
  /** Assistir direto a uma partida da lista "Ao vivo agora". */
  onWatchRoom: (target: WatchTarget) => void;
  /** Torneios (com `id`: a página daquele torneio). */
  onTournaments: (id?: string) => void;
  /** Entra na sala da partida de torneio (atalho da tela inicial); ao sair, volta para o torneio. */
  onTournamentMatch: (seat: OnlineSeat, tournamentId: string) => void;
  /** Perfis das contas (só para admin). */
  onAdmin?: () => void;
  /** Funções de desenvolvimento (só para Dev): opções de teste. */
  dev?: boolean;
}) {
  const { user, notice: authNotice, error: authError } = useAuth();
  const t = useT();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);
  /** Erro de uma ação dos modos (fila, sala, bot). */
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  const [botLevel, setBotLevel] = useState<BotLevel>(savedBotLevel);
  const [format, setFormat] = useState<FormatId>(savedFormat);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<null | 0 | 1>(null);
  const [code, setCode] = useState(URL_ROOM_CODE ?? '');
  const userId = user?.id;
  /** Apelido do jogador (perfil deste navegador): nome nas partidas contra o bot e online. */
  const [nickname, setNickname] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .player()
      .then((p) => !cancelled && setNickname(p?.name ?? null))
      .catch(() => undefined);
    const onRename = (e: Event) => setNickname((e as CustomEvent<string>).detail);
    window.addEventListener(NICKNAME_EVENT, onRename);
    return () => {
      cancelled = true;
      window.removeEventListener(NICKNAME_EVENT, onRename);
    };
  }, [userId]);
  /** O servidor aceita transmitir o treino contra o bot (ele joga pelo bot e a partida aparece em "Assistir"). */
  const [botRooms, setBotRooms] = useState(false);
  const [timeBank, setTimeBank] = useState<number | null>(null);
  /** "Transmitir esta partida": só com login. */
  const [broadcast, setBroadcast] = useState(false);
  const broadcasting = botRooms && broadcast && Boolean(user);
  /** Partidas online (ou treino contra o bot do servidor) ainda abertas: atalho para voltar. */
  const [active, setActive] = useState<ActiveRoom[]>([]);
  const privateCard = useRef<HTMLElement>(null);

  const stats = usePoll(() => api.online.stats(), 10_000);
  const tournaments = usePoll(() => api.tournaments.list(), 60_000);
  /** Torneio em jogo agora (check-in aberto ou partida da rodada): atalho no alto da tela. */
  const mine = usePoll(() => (user ? api.tournaments.me() : Promise.resolve({ entries: [] })), 10_000);
  const [myEntry, setMyEntry] = useState<TournamentMine | null>(null);
  useEffect(() => setMyEntry(mine?.entries[0] ?? null), [mine]);

  const refreshActive = useCallback(() => {
    api.online
      .active()
      .then(setActive)
      .catch(() => undefined);
  }, []);
  useEffect(refreshActive, [userId, refreshActive]);
  useEffect(() => {
    api.online
      .config()
      .then((c) => {
        setBotRooms(c.botRooms);
        setTimeBank(c.timeBankMs);
      })
      .catch(() => undefined);
  }, []);

  // Link de convite: leva até a sala privada, com o código já preenchido.
  useEffect(() => {
    if (URL_ROOM_CODE) privateCard.current?.scrollIntoView({ block: 'center' });
  }, []);

  // O servidor pode ainda estar subindo: tenta de novo por até ~30s antes de desistir.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = (attempt: number) => {
      api
        .decks()
        .then((d) => {
          if (cancelled) return;
          setError(null);
          setDecks(d);
          // Recupera a última escolha (se ainda for válida).
          let last: string[] = [];
          try {
            last = JSON.parse(localStorage.getItem(LAST_DECKS) ?? '[]');
          } catch {
            /* sem armazenamento */
          }
          const valid = d.filter((x) => canPlay(x, format)).map((x) => x.id);
          const builtin = d.filter((x) => canPlay(x, format) && x.kind === 'builtin').map((x) => x.id);
          setDeck0(valid.includes(last[0]) ? last[0] : (builtin[0] ?? valid[0] ?? ''));
          setDeck1(last[1] === RANDOM || valid.includes(last[1]) ? last[1] : (builtin[1] ?? valid[1] ?? valid[0] ?? ''));
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 15) {
            setError('menu.connecting');
            timer = setTimeout(() => load(attempt + 1), 2000);
          } else {
            setError('menu.connectFailed');
          }
        });
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Entrar ou sair da conta muda quais decks são "meus".
  }, [userId]);

  // O deck equipado e o formato ficam salvos e valem para todos os modos.
  useEffect(() => {
    if (!deck0) return;
    try {
      localStorage.setItem(LAST_DECKS, JSON.stringify([deck0, deck1]));
      localStorage.setItem(LAST_FORMAT, format);
    } catch {
      /* sem armazenamento */
    }
  }, [deck0, deck1, format]);

  const fail = useCallback(
    (e: unknown) => {
      setActionError(e instanceof Error ? e.message : String(e));
      // Já está numa partida: mostra o atalho para voltar.
      if (e instanceof ApiError && e.data.roomId) refreshActive();
    },
    [refreshActive],
  );
  const { queue, enqueue, cancel } = useQueue(onOnline, fail);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const startBot = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const names: [string, string] = [nickname ?? t('menu.you'), t('menu.botName')];
      const pool = decks.filter((d) => canPlay(d, format) && d.kind === 'builtin');
      if (deck1 === RANDOM && !pool.length) throw new Error(t('menu.noBuiltinDeck', { format: formatLabel(format) }));
      const opp = deck1 === RANDOM ? pool[Math.floor(Math.random() * pool.length)].id : deck1;
      const firstPlayer = first === 'random' ? undefined : (Number(first) as PlayerId);
      let notice: string | undefined;
      if (broadcasting) {
        try {
          onOnline(await api.online.botRoom(deck0, opp, format, firstPlayer));
          return;
        } catch (e) {
          // Servidor lotado: o treino roda no navegador, sem transmissão.
          if (!(e instanceof ApiError && e.status === 503)) throw e;
          notice = t('menu.broadcastFull');
        }
      }
      try {
        localStorage.setItem(LAST_BOT_LEVEL, botLevel);
      } catch {
        /* sem armazenamento local */
      }
      const setup = await buildSetup('bot', [deck0, opp], names, seed, format, firstPlayer);
      onStart({ ...setup, botLevel, ...(notice ? { notice } : {}) });
    } catch (e) {
      fail(e);
      setLoading(false);
    }
  };

  /** Lê um replay baixado (.json) e monta a partida para assistir. */
  const loadReplay = async (file: File): Promise<GameSetup> => setupFromReplayText(await file.text());

  const d0 = decks.find((d) => d.id === deck0);
  const d1 = decks.find((d) => d.id === deck1);
  const fmt = formatLabel(format);
  /** Os dois decks precisam valer no formato escolhido. */
  const botReady = Boolean(d0 && canPlay(d0, format) && (deck1 === RANDOM || (d1 && canPlay(d1, format))));
  /** Deck para as partidas online (completo e permitido no formato). */
  const onlineDeck = d0 && canPlay(d0, format) ? d0 : undefined;
  const playing = active.find((r) => r.status === 'playing');
  const waiting = active.find((r) => r.status === 'waiting');
  const manualCards = d0?.unscripted ?? 0;
  const onlineBlocked = !onlineDeck || busy || Boolean(playing) || Boolean(queue);
  const onlineNote = !d0 ? t('menu.pickDeck') : !onlineDeck ? t('menu.deckNotValidIn', { format: fmt }) : playing ? t('menu.finishCurrent') : null;
  const rankedNote = onlineNote ?? (!user ? t('menu.rankedNeedsLogin') : manualCards > 0 ? t('menu.rankedManualCards', { n: manualCards }) : null);

  const enterQueue = (kind: QueueKind) => run(() => enqueue(onlineDeck!.id, format, kind));

  const queueLive = (kind: QueueKind) =>
    stats ? <Live>{t('menu.queueLive', { n: stats.playing[kind], q: stats.queue[kind][format] })}</Live> : <Live off>{t('menu.counting')}</Live>;
  const openTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'registration').length;
  const runningTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'running').length;
  const totalPlaying = stats ? Object.values(stats.playing).reduce((a, b) => a + b, 0) : null;
  const totalQueue = stats ? Object.values(stats.queue).reduce((a, q) => a + Object.values(q).reduce((x, y) => x + y, 0), 0) : null;

  const nav: NavItem[] = [
    { key: 'play', label: t('menu.navPlay'), icon: 'swords', current: true, onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
    { key: 'builder', label: t('menu.navDecks'), icon: 'deck', onClick: onBuildDecks },
    { key: 'tournaments', label: t('menu.navTournaments'), icon: 'crown', onClick: () => onTournaments() },
    { key: 'watch', label: t('menu.navWatch'), icon: 'eye', onClick: onWatch },
    { key: 'stats', label: t('menu.navStats'), icon: 'chart', onClick: onStats },
  ];
  const extra: NavItem[] = [
    { key: 'settings', label: t('menu.navSettings'), icon: 'sliders', onClick: () => setShowSettings(true) },
    { key: 'replay', label: t('menu.navReplay'), icon: 'play', onClick: () => setShowReplay(true) },
    ...(onAdmin ? [{ key: 'admin', label: t('menu.navAdmin'), icon: 'shield' as const, onClick: onAdmin }] : []),
    ...(onCoverage ? [{ key: 'coverage', label: t('menu.navCoverage'), icon: 'check' as const, onClick: onCoverage }] : []),
    ...(dev ? [{ key: 'tests', label: t('menu.testOptions'), icon: 'flask' as const, onClick: () => setShowTests(true) }] : []),
  ];

  return (
    <div className="home">
      <TopBar nav={nav} extra={extra} online={stats?.online ?? null} onHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />

      <section className="home-hero">
        <img className="home-watermark" src={jollyRoger} alt="" />
        <div className="home-wrap home-hero-inner">
          <div className="home-hero-text">
            <div className="hero-kicker">{t('menu.heroKicker')}</div>
            <h1 className="hero-title">{t('menu.heroTitle')}</h1>
            <p className="hero-sub">{t('menu.heroSub')}</p>
            <div className="hero-links">
              <button type="button" className="hero-link" onClick={onStats}>
                <Icon name="trophy" size={18} />
                {t('menu.myStats')}
              </button>
              <button type="button" className="hero-link" onClick={onWatch}>
                <Icon name="eye" size={18} />
                {t('menu.watchMatches')}
              </button>
              <button type="button" className="hero-link" onClick={() => setShowReplay(true)} title={t('menu.watchReplayTitle')}>
                <Icon name="play" size={18} />
                {t('menu.navReplay')}
              </button>
              <button type="button" className="hero-link nickname-link" onClick={() => setShowSettings(true)} title={t('menu.nicknameTitle')}>
                <Icon name="user" size={18} />
                {nickname ?? t('menu.nickname')}
                <small>✎</small>
              </button>
            </div>
          </div>
          <div className="hero-stats" role="status" aria-live="off">
            <div className="hero-stat">
              <b>{stats?.online ?? '–'}</b>
              <span>{t('menu.onlineWord', { n: stats?.online ?? 0 })}</span>
            </div>
            <div className="hero-stat">
              <b>{totalPlaying ?? '–'}</b>
              <span>{t('menu.liveMatchesWord', { n: totalPlaying ?? 0 })}</span>
            </div>
            <div className="hero-stat">
              <b>{totalQueue ?? '–'}</b>
              <span>{t('menu.inQueueNow')}</span>
            </div>
          </div>
        </div>
      </section>

      <main className="home-wrap home-main">
        {error && <div className="error">{t(error)}</div>}
        {authNotice && <div className="home-notice">{authNotice}</div>}
        {authError && <div className="error">{authError}</div>}

        {!playing && myEntry && (
          <TournamentBanner
            entry={myEntry}
            onOpen={() => onTournaments(myEntry.id)}
            onPlay={() => api.tournaments.play(myEntry.id, myEntry.match!.id).then((seat) => (onTournamentMatch(seat, myEntry.id), seat))}
            onCheckIn={() => api.tournaments.checkIn(myEntry.id).then(() => setMyEntry({ ...myEntry, checkedIn: true }))}
          />
        )}
        {playing ? (
          <div className="home-banner" role="status">
            <span className="play-ico">
              <Icon name="play" size={16} />
            </span>
            <div className="home-banner-text">
              <strong>
                {playing.queue === 'bot' ? t('menu.playingBot') : playing.queue === 'tournament' ? t('menu.playingTournament') : t('menu.playingOnline')}
              </strong>
              <span>{t('menu.clockRunning')}</span>
            </div>
            <button type="button" className="btn primary" onClick={() => onOnline(playing)}>
              {t('menu.backToMatch')}
            </button>
          </div>
        ) : (
          // A sala de torneio em espera já aparece no atalho do torneio.
          waiting &&
          !(waiting.queue === 'tournament' && myEntry) && (
            <div className="home-banner" role="status">
              <span className="play-ico">
                <Icon name="key" size={16} />
              </span>
              <div className="home-banner-text">
                <strong>{interp(t('menu.roomWaiting'), 'code', <b>{waiting.code}</b>)}</strong>
                <span>{t('menu.roomWaitingHint')}</span>
              </div>
              <button type="button" className="btn primary" onClick={() => onOnline(waiting)}>
                {t('menu.openRoom')}
              </button>
            </div>
          )
        )}

        <section className="deck-strip" aria-label={t('menu.equippedDeck')}>
          <DeckArt deck={d0} />
          <div className="deck-strip-info">
            <div className="kicker">{t('menu.equippedDeck')}</div>
            <div className="deck-strip-name">{d0?.name ?? (decks.length ? t('menu.chooseDeck') : t('menu.loadingDecks'))}</div>
            {d0 && (
              <ul className="home-chips">
                {d0.leaderName && <li className="home-chip">{t('menu.leaderChip', { name: d0.leaderName })}</li>}
                {!d0.valid ? (
                  <li className="home-chip bad">{t('menu.incompleteChip', { size: d0.size })}</li>
                ) : canPlay(d0, format) ? (
                  <li className="home-chip ok">
                    <Icon name="check" size={12} stroke={3} />
                    {t('menu.validIn', { format: fmt })}
                  </li>
                ) : (
                  <li className="home-chip bad" title={whyNotPlayable(d0, format) ?? undefined}>
                    {t('menu.notAllowedIn', { format: fmt })}
                  </li>
                )}
                {d0.unscripted > 0 && (
                  <li className="home-chip" title={t('menu.unscriptedTitle')}>
                    {t('menu.unscriptedChip', { n: d0.unscripted })}
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="deck-strip-actions">
            <button type="button" className="deck-change" onClick={() => setPicking(0)} disabled={!decks.length}>
              {t('menu.changeDeck')}
              <Icon name="chevron" size={16} />
            </button>
            <div className="seg format-seg" role="group" aria-label={t('menu.format')}>
              {FORMATS.map((f) => (
                <button key={f.id} type="button" className={format === f.id ? 'on' : ''} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <button type="button" className="text-link" onClick={onBuildDecks}>
              {t('menu.navDecks')}
            </button>
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-modes">
          <div className="section-head">
            <h2 className="home-h2" id="home-modes">
              {t('menu.modes')}
            </h2>
            <span className="muted">{t('menu.modesHint')}</span>
          </div>
          {actionError && <div className="error">{actionError}</div>}
          <div className="mode-grid">
            <ModeCard
              mode="ranked"
              color="red"
              icon="trophy"
              kicker={t('menu.rankedKicker')}
              title={t('menu.ranked')}
              badge={fmt}
              desc={t('menu.rankedDesc')}
              chips={[t('menu.chipGoogleLogin'), t('menu.chipNoManual')]}
              live={queueLive('ranked')}
              note={rankedNote}
              action={t('menu.findMatch')}
              disabled={onlineBlocked || Boolean(rankedNote)}
              onAction={() => enterQueue('ranked')}
            />
            <ModeCard
              mode="casual"
              color="green"
              icon="swords"
              kicker={t('menu.casualKicker')}
              title={t('menu.casual')}
              badge={fmt}
              desc={t('menu.casualDesc')}
              chips={[t('menu.chipAnyDeck'), ...(timeBank ? [t('menu.chipClock', { time: fmtClock(timeBank) })] : [])]}
              live={queueLive('casual')}
              note={onlineNote}
              action={t('menu.findMatch')}
              disabled={onlineBlocked}
              onAction={() => enterQueue('casual')}
            />
            <ModeCard
              mode="private"
              cardRef={privateCard}
              color="blue-card"
              icon="key"
              kicker={t('menu.privateKicker')}
              title={t('menu.private')}
              badge={fmt}
              desc={t('menu.privateDesc')}
              live={stats ? <Live>{t('menu.privateLive', { n: stats.playing.private, w: stats.waiting })}</Live> : <Live off>{t('menu.counting')}</Live>}
              note={onlineNote}
              action={t('menu.createRoom')}
              disabled={onlineBlocked}
              highlight={Boolean(URL_ROOM_CODE)}
              onAction={() =>
                run(async () => {
                  const r = await api.online.createRoom(onlineDeck!.id, format);
                  onOnline({ roomId: r.roomId, token: r.token });
                })
              }
            >
              <div className="mode-field">
                <label htmlFor="room-code">{t('menu.roomCode')}</label>
                <div className="code-row">
                  <input
                    id="room-code"
                    value={code}
                    maxLength={6}
                    placeholder={t('menu.roomCodePlaceholder')}
                    autoComplete="off"
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  />
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={!d0?.valid || busy || code.length !== 6 || Boolean(playing)}
                    onClick={() =>
                      run(async () => {
                        // Quem entra joga no formato de quem criou a sala.
                        onOnline(await api.online.joinRoom(code, d0!.id));
                      })
                    }
                  >
                    {t('menu.joinRoom')}
                  </button>
                </div>
              </div>
            </ModeCard>
            <ModeCard
              mode="bot"
              color="purple"
              icon="bot"
              kicker={t('menu.botKicker')}
              title={t('menu.vsBot')}
              badge={fmt}
              desc={t('menu.botDesc')}
              live={broadcasting && stats ? <Live>{t('menu.botLive', { n: stats.playing.bot })}</Live> : <Live off>{t('menu.botLocal')}</Live>}
              note={!d0 || botReady ? null : t('menu.bothDecksValid', { format: fmt })}
              action={loading ? t('common.loading') : t('menu.battle')}
              disabled={!botReady || loading}
              onAction={startBot}
            >
              <div className="mode-fields">
                <button type="button" className="pick-btn" onClick={() => setPicking(1)} disabled={!decks.length}>
                  <span>{interp(t('menu.opponent'), 'name', <strong>{deck1 === RANDOM ? t('menu.randomDeck') : (d1?.name ?? t('menu.choose'))}</strong>)}</span>
                  <Icon name="chevron" size={14} />
                </button>
                <div className="mode-field">
                  <span className="mode-field-label" id="first-label">
                    {t('menu.whoStarts')}
                  </span>
                  <div className="seg small" role="group" aria-labelledby="first-label">
                    {(
                      [
                        ['random', 'menu.firstRandom'],
                        ['0', 'menu.you'],
                        ['1', 'menu.botName'],
                      ] as const
                    ).map(([v, label]) => (
                      <button key={v} type="button" className={first === v ? 'on' : ''} aria-pressed={first === v} onClick={() => setFirst(v)}>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mode-field">
                  <span className="mode-field-label" id="bot-level-label">
                    {t('menu.botLevel')}
                  </span>
                  <div className="seg small" role="group" aria-labelledby="bot-level-label">
                    {(
                      [
                        ['easy', 'menu.botEasy'],
                        ['normal', 'menu.botNormal'],
                        ['hard', 'menu.botHard'],
                      ] as const
                    ).map(([v, label]) => (
                      <button key={v} type="button" className={botLevel === v ? 'on' : ''} aria-pressed={botLevel === v} onClick={() => setBotLevel(v)}>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
                {botRooms && (
                  <label className={['check', user ? '' : 'disabled'].join(' ')} title={user ? t('menu.broadcastTitle') : undefined}>
                    <input type="checkbox" checked={broadcasting} disabled={!user} onChange={(e) => setBroadcast(e.target.checked)} />
                    {user ? t('menu.broadcast') : t('menu.broadcastNeedsLogin')}
                  </label>
                )}
              </div>
            </ModeCard>
            <ModeCard
              mode="tournaments"
              color="yellow"
              gold
              icon="crown"
              kicker={t('menu.tourKicker')}
              title={t('menu.navTournaments')}
              badge={t('menu.tourBadge')}
              desc={t('menu.tourDesc')}
              chips={[t('menu.chipTourLogin'), t('menu.chipBestOf')]}
              live={tournaments ? <Live off={!openTournaments && !runningTournaments}>{t('menu.tourLive', { n: openTournaments, running: runningTournaments })}</Live> : <Live off>{t('menu.counting')}</Live>}
              action={t('menu.seeTournaments')}
              onAction={() => onTournaments()}
            />
          </div>
        </section>

        <div className="home-blocks">
          <LiveNow onWatch={onWatchRoom} onAll={onWatch} />
          <TournamentsBlock list={tournaments} onOpen={onTournaments} />
          <MetaBlock onStats={onStats} />
        </div>
      </main>

      <footer className="home-footer">
        <div className="home-wrap home-footer-inner">
          <div className="footer-brand">
            <img src="/brand/header-mark.svg" alt="" />
            <span>GumGum Fight</span>
          </div>
          <nav className="footer-links" aria-label={t('menu.footerNav')}>
            {[...nav.slice(1), extra[0]].map((item) => (
              <button key={item.key} type="button" className="text-link" onClick={item.onClick}>
                {item.label}
              </button>
            ))}
          </nav>
          <p className="disclaimer">{t('menu.disclaimer')}</p>
        </div>
      </footer>

      {queue && <QueueWait queue={queue} onCancel={cancel} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showTests && <TestOptions seed={seed} onSeed={setSeed} onClose={() => setShowTests(false)} />}
      {showReplay && <ReplayLoader load={loadReplay} onStart={onStart} onClose={() => setShowReplay(false)} />}

      {picking !== null && (
        <DeckPicker
          title={picking === 0 ? t('menu.equippedDeck') : t('menu.opponentDeck')}
          decks={decks}
          value={picking === 0 ? deck0 : deck1}
          format={format}
          allowRandom={picking === 1}
          onPick={(id) => {
            if (picking === 0) setDeck0(id);
            else setDeck1(id);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
