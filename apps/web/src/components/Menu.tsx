import { type Action, type CardData, type DeckList, FORMATS, formatLabel, type PlayerId, REPLAY_VERSION, replayConfig, upgradeReplayActions } from '@gumgum/engine';
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
  type WatchTarget,
  whyNotPlayable,
} from '../api';
import jollyRoger from '../assets/jolly-roger.svg';
import { useAuth } from '../auth';
import type { GameMode, GameSetup, ReplayFile } from '../game/useGame';
import { NICKNAME_EVENT, SettingsModal } from '../settings';
import { type NavItem, TopBar } from './AppShell';
import { LiveNow, MetaBlock, TournamentsBlock, usePoll } from './HomeBlocks';
import { Icon, type IconName } from './Icons';
import { LeaderArt } from './LeaderArt';
import { QueueWait, roomCodeFromUrl, useQueue } from './OnlineMenu';

/** Código de sala do link de convite (lido uma vez, ao carregar a página). */
const URL_ROOM_CODE = roomCodeFromUrl();

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

async function buildSetup(
  mode: GameMode,
  deckIds: [string, string],
  names: [string, string],
  seed: number,
  format: FormatId,
  firstPlayer?: PlayerId,
  script?: Action[],
  /** Replay online: listas exatas da partida e a seed de 128 bits. */
  online?: { decks: [DeckList, DeckList]; seed128: number[] },
  /** Sem `firstPlayer`: o vencedor do sorteio escolhe se joga primeiro. */
  chooseFirst = firstPlayer === undefined,
  /** Versão do replay (as anteriores à atual ganham as respostas implícitas e, até a 8, a preparação antiga). */
  replayVersion?: number,
): Promise<GameSetup> {
  let a: { deck: DeckList; cards: CardData[] };
  let b: typeof a;
  if (online) {
    const all = await api.cards();
    const used = new Set(online.decks.flatMap((d) => [d.leader, ...d.cards.map((c) => c.id)]));
    const pool = all.filter((c) => used.has(c.id));
    a = { deck: online.decks[0], cards: pool };
    b = { deck: online.decks[1], cards: [] };
  } else {
    [a, b] = await Promise.all(deckIds.map((id) => api.deck(id)));
  }
  const cards = new Map<string, CardData>();
  for (const c of [...a.cards, ...b.cards]) cards.set(c.id, c);
  const setup: GameSetup = {
    mode,
    deckIds,
    format,
    script,
    config: {
      seed,
      ...(online ? { seed128: online.seed128 } : {}),
      firstPlayer,
      ...(chooseFirst && firstPlayer === undefined ? { chooseFirst: true } : {}),
      cards: [...cards.values()],
      players: [
        { name: names[0], deck: a.deck, isBot: false },
        { name: names[1], deck: b.deck, isBot: mode !== 'replay' },
      ],
    },
  };
  if (script && replayVersion !== undefined && replayVersion < REPLAY_VERSION) {
    setup.config = replayConfig(setup.config, replayVersion);
    setup.script = upgradeReplayActions(setup.config, script);
  }
  return setup;
}

const LAST_DECKS = 'gumgum.lastDecks';
const LAST_FORMAT = 'gumgum.format';

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
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body" ref={body}>
          {allowRandom && (
            <div className="picker-grid">
              <button className={['deck-pick', value === RANDOM ? 'on' : ''].join(' ')} onClick={() => onPick(RANDOM)}>
                <DeckArt small />
                <span className="name">Aleatório</span>
              </button>
            </div>
          )}
          {deckGroups(decks)
            .filter(([, list]) => list.length)
            .map(([label, list]) => (
              <div key={label} className="picker-group">
                <label className="sheet-label">{label}</label>
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
                      {d.valid && !canPlay(d, format) && <span className="muted small">🚫 {formatLabel(format)}</span>}
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

/** Opções de teste (só Dev): seed do embaralhamento e replay salvo. */
function TestOptions({
  seed,
  onSeed,
  onReplay,
  onClose,
}: {
  seed: number;
  onSeed: (n: number) => void;
  onReplay: (f: File) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>Opções de teste</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor="test-seed">Seed do embaralhamento</label>
            <div className="seed">
              <input id="test-seed" type="number" value={seed} onChange={(e) => onSeed(Number(e.target.value) || 0)} />
              <button className="btn small" onClick={() => onSeed(randomSeed())} title="Sortear outra">
                🎲
              </button>
            </div>
            <p className="muted small">
              Número que define a ordem dos decks e o sorteio de quem começa, nas partidas contra o bot. A mesma seed com as mesmas
              jogadas repete a partida exatamente, o que é útil para reproduzir um problema.
            </p>
          </div>
          <label className="replay-load">
            Carregar um replay (.json baixado durante uma partida)
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onReplay(e.target.files[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const fmtClock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Card de um modo de jogo: cor própria, contador ao vivo e botão de ação. */
function ModeCard({
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
  const id = `mode-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
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
  /** Perfis das contas (só para admin). */
  onAdmin?: () => void;
  /** Funções de desenvolvimento (só para Dev): opções de teste. */
  dev?: boolean;
}) {
  const { user, notice: authNotice, error: authError } = useAuth();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Erro de uma ação dos modos (fila, sala, bot). */
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
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
            setError('Conectando ao servidor…');
            timer = setTimeout(() => load(attempt + 1), 2000);
          } else {
            setError('Não foi possível conectar ao servidor. Veja as mensagens [server] no terminal do npm run dev.');
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
      const names: [string, string] = [nickname ?? 'Você', 'Bot'];
      const pool = decks.filter((d) => canPlay(d, format) && d.kind === 'builtin');
      if (deck1 === RANDOM && !pool.length) throw new Error(`Nenhum deck pronto é permitido no ${formatLabel(format)}.`);
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
          notice = 'A transmissão está lotada agora: este treino roda no seu navegador, sem espectadores.';
        }
      }
      const setup = await buildSetup('bot', [deck0, opp], names, seed, format, firstPlayer);
      onStart(notice ? { ...setup, notice } : setup);
    } catch (e) {
      fail(e);
      setLoading(false);
    }
  };

  const loadReplay = async (file: File) => {
    try {
      const r = JSON.parse(await file.text()) as ReplayFile;
      if (r.format !== 'gumgumfight-replay') throw new Error('Arquivo não é um replay do GumGum Fight.');
      const online = r.seed128 && r.decks ? { seed128: r.seed128, decks: r.decks } : undefined;
      // Com a escolha do vencedor, o primeiro jogador sai da própria ação gravada.
      const first = r.chooseFirst ? undefined : r.firstPlayer;
      onStart(await buildSetup('replay', r.deckIds, r.names, r.seed, 'standard', first, r.actions, online, Boolean(r.chooseFirst), r.version ?? 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
  const onlineNote = !d0 ? 'Escolha um deck.' : !onlineDeck ? `O deck equipado não vale no ${fmt}.` : playing ? 'Termine a partida em andamento primeiro.' : null;
  const rankedNote = onlineNote ?? (!user ? 'Entre com o Google para jogar a ranqueada.' : manualCards > 0 ? `O deck tem ${plural(manualCards, 'carta', 'cartas')} com efeito manual (⚙), que a ranqueada não permite.` : null);

  const enterQueue = (kind: QueueKind) => run(() => enqueue(onlineDeck!.id, format, kind));

  const queueLive = (kind: QueueKind) =>
    stats ? <Live>{`${plural(stats.playing[kind], 'partida', 'partidas')} · ${stats.queue[kind][format]} na fila`}</Live> : <Live off>Contando…</Live>;
  const openTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'registration').length;
  const runningTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'running').length;
  const totalPlaying = stats ? Object.values(stats.playing).reduce((a, b) => a + b, 0) : null;
  const totalQueue = stats ? Object.values(stats.queue).reduce((a, q) => a + Object.values(q).reduce((x, y) => x + y, 0), 0) : null;

  const nav: NavItem[] = [
    { key: 'play', label: 'Jogar', icon: 'swords', current: true, onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
    { key: 'builder', label: 'Montar decks', icon: 'deck', onClick: onBuildDecks },
    { key: 'tournaments', label: 'Torneios', icon: 'crown', onClick: () => onTournaments() },
    { key: 'watch', label: 'Assistir', icon: 'eye', onClick: onWatch },
    { key: 'stats', label: 'Estatísticas', icon: 'chart', onClick: onStats },
  ];
  const extra: NavItem[] = [
    { key: 'settings', label: 'Configurações', icon: 'sliders', onClick: () => setShowSettings(true) },
    ...(onAdmin ? [{ key: 'admin', label: 'Perfis das contas', icon: 'shield' as const, onClick: onAdmin }] : []),
    ...(onCoverage ? [{ key: 'coverage', label: 'Cobertura das cartas', icon: 'check' as const, onClick: onCoverage }] : []),
    ...(dev ? [{ key: 'tests', label: 'Opções de teste', icon: 'flask' as const, onClick: () => setShowTests(true) }] : []),
  ];

  return (
    <div className="home">
      <TopBar nav={nav} extra={extra} online={stats?.online ?? null} onHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />

      <section className="home-hero">
        <img className="home-watermark" src={jollyRoger} alt="" />
        <div className="home-wrap home-hero-inner">
          <div className="home-hero-text">
            <div className="hero-kicker">One Piece Card Game no navegador</div>
            <h1 className="hero-title">Escolha seu modo</h1>
            <p className="hero-sub">Toda partida usa o deck equipado. Escolha uma fila e entre num duelo 1 contra 1, ou treine contra o bot.</p>
            <div className="hero-links">
              <button type="button" className="hero-link" onClick={onStats}>
                <Icon name="trophy" size={18} />
                Minhas estatísticas
              </button>
              <button type="button" className="hero-link" onClick={onWatch}>
                <Icon name="eye" size={18} />
                Assistir partidas
              </button>
              <button type="button" className="hero-link nickname-link" onClick={() => setShowSettings(true)} title="Mudar o apelido (Configurações)">
                <Icon name="user" size={18} />
                {nickname ?? 'Apelido'}
                <small>✎</small>
              </button>
            </div>
          </div>
          <div className="hero-stats" role="status" aria-live="off">
            <div className="hero-stat">
              <b>{stats?.online ?? '–'}</b>
              <span>{stats?.online === 1 ? 'conectado' : 'conectados'}</span>
            </div>
            <div className="hero-stat">
              <b>{totalPlaying ?? '–'}</b>
              <span>{totalPlaying === 1 ? 'partida ao vivo' : 'partidas ao vivo'}</span>
            </div>
            <div className="hero-stat">
              <b>{totalQueue ?? '–'}</b>
              <span>na fila agora</span>
            </div>
          </div>
        </div>
      </section>

      <main className="home-wrap home-main">
        {error && <div className="error">{error}</div>}
        {authNotice && <div className="home-notice">{authNotice}</div>}
        {authError && <div className="error">{authError}</div>}

        {playing ? (
          <div className="home-banner" role="status">
            <span className="play-ico">
              <Icon name="play" size={16} />
            </span>
            <div className="home-banner-text">
              <strong>
                {playing.queue === 'bot'
                  ? 'Você tem um treino contra o bot em andamento.'
                  : playing.queue === 'tournament'
                    ? 'Você tem uma partida de torneio em andamento.'
                    : 'Você tem uma partida online em andamento.'}
              </strong>
              <span>Seu relógio pode estar correndo.</span>
            </div>
            <button type="button" className="btn primary" onClick={() => onOnline(playing)}>
              Voltar à partida
            </button>
          </div>
        ) : (
          waiting && (
            <div className="home-banner" role="status">
              <span className="play-ico">
                <Icon name="key" size={16} />
              </span>
              <div className="home-banner-text">
                <strong>
                  Sua sala <b>{waiting.code}</b> está esperando um oponente.
                </strong>
                <span>Envie o código ou o link para quem vai jogar com você.</span>
              </div>
              <button type="button" className="btn primary" onClick={() => onOnline(waiting)}>
                Abrir sala
              </button>
            </div>
          )
        )}

        <section className="deck-strip" aria-label="Deck equipado">
          <DeckArt deck={d0} />
          <div className="deck-strip-info">
            <div className="kicker">Deck equipado</div>
            <div className="deck-strip-name">{d0?.name ?? (decks.length ? 'Escolha um deck' : 'Carregando decks…')}</div>
            {d0 && (
              <ul className="home-chips">
                {d0.leaderName && <li className="home-chip">Líder: {d0.leaderName}</li>}
                {!d0.valid ? (
                  <li className="home-chip bad">{d0.size}/50 cartas: incompleto</li>
                ) : canPlay(d0, format) ? (
                  <li className="home-chip ok">
                    <Icon name="check" size={12} stroke={3} />
                    Válido no {fmt}
                  </li>
                ) : (
                  <li className="home-chip bad" title={whyNotPlayable(d0, format) ?? undefined}>
                    Não permitido no {fmt}
                  </li>
                )}
                {d0.unscripted > 0 && (
                  <li className="home-chip" title="Essas cartas entram no jogo, mas sem o efeito automático">
                    ⚙ {d0.unscripted} sem efeito automático
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="deck-strip-actions">
            <button type="button" className="deck-change" onClick={() => setPicking(0)} disabled={!decks.length}>
              Trocar deck
              <Icon name="chevron" size={16} />
            </button>
            <div className="seg format-seg" role="group" aria-label="Formato">
              {FORMATS.map((f) => (
                <button key={f.id} type="button" className={format === f.id ? 'on' : ''} aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <button type="button" className="text-link" onClick={onBuildDecks}>
              Montar decks
            </button>
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-modes">
          <div className="section-head">
            <h2 className="home-h2" id="home-modes">
              Modos de jogo
            </h2>
            <span className="muted">Contadores ao vivo, atualizados a cada 10 s</span>
          </div>
          {actionError && <div className="error">{actionError}</div>}
          <div className="mode-grid">
            <ModeCard
              color="red"
              icon="trophy"
              kicker="Competitivo"
              title="Ranqueada"
              badge={fmt}
              desc="Vale bounty. Você enfrenta quem está perto do seu nível."
              chips={['Login com Google', 'Sem efeitos manuais']}
              live={queueLive('ranked')}
              note={rankedNote}
              action="Buscar partida"
              disabled={onlineBlocked || Boolean(rankedNote)}
              onAction={() => enterQueue('ranked')}
            />
            <ModeCard
              color="green"
              icon="swords"
              kicker="Casual"
              title="Partida rápida"
              badge={fmt}
              desc="Sem bounty em jogo. Ideal para testar um deck novo."
              chips={['Qualquer deck válido', ...(timeBank ? [`Relógio de ${fmtClock(timeBank)}`] : [])]}
              live={queueLive('casual')}
              note={onlineNote}
              action="Buscar partida"
              disabled={onlineBlocked}
              onAction={() => enterQueue('casual')}
            />
            <ModeCard
              cardRef={privateCard}
              color="blue-card"
              icon="key"
              kicker="Com amigos"
              title="Sala privada"
              badge={fmt}
              desc="Crie uma sala e mande o código, ou entre na sala de um amigo."
              live={stats ? <Live>{`${plural(stats.playing.private, 'partida', 'partidas')} · ${plural(stats.waiting, 'sala esperando', 'salas esperando')}`}</Live> : <Live off>Contando…</Live>}
              note={onlineNote}
              action="Criar sala"
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
                <label htmlFor="room-code">Código da sala</label>
                <div className="code-row">
                  <input
                    id="room-code"
                    value={code}
                    maxLength={6}
                    placeholder="ABC123"
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
                    Entrar
                  </button>
                </div>
              </div>
            </ModeCard>
            <ModeCard
              color="purple"
              icon="bot"
              kicker="Treino"
              title="Contra o bot"
              badge={fmt}
              desc="Treine com qualquer deck, sem fila e sem pressa."
              live={broadcasting && stats ? <Live>{plural(stats.playing.bot, 'treino transmitido', 'treinos transmitidos')}</Live> : <Live off>Roda no seu navegador</Live>}
              note={!d0 || botReady ? null : `Os dois decks precisam valer no ${fmt}.`}
              action={loading ? 'Carregando…' : 'Batalhar!'}
              disabled={!botReady || loading}
              onAction={startBot}
            >
              <div className="mode-fields">
                <button type="button" className="pick-btn" onClick={() => setPicking(1)} disabled={!decks.length}>
                  <span>
                    Oponente: <strong>{deck1 === RANDOM ? 'Aleatório' : (d1?.name ?? 'Escolher')}</strong>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
                <div className="mode-field">
                  <span className="mode-field-label" id="first-label">
                    Quem começa
                  </span>
                  <div className="seg small" role="group" aria-labelledby="first-label">
                    {(
                      [
                        ['random', 'Sorteio'],
                        ['0', 'Você'],
                        ['1', 'Bot'],
                      ] as const
                    ).map(([v, label]) => (
                      <button key={v} type="button" className={first === v ? 'on' : ''} aria-pressed={first === v} onClick={() => setFirst(v)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {botRooms && (
                  <label className={['check', user ? '' : 'disabled'].join(' ')} title={user ? 'A partida aparece em "Assistir".' : undefined}>
                    <input type="checkbox" checked={broadcasting} disabled={!user} onChange={(e) => setBroadcast(e.target.checked)} />
                    {user ? 'Transmitir esta partida' : 'Transmitir: entre com o Google'}
                  </label>
                )}
              </div>
            </ModeCard>
            <ModeCard
              color="yellow"
              gold
              icon="crown"
              kicker="Eventos"
              title="Torneios"
              badge="Suíço e mata-mata"
              desc="Torneios da comunidade, com chave, rodadas e relógio."
              chips={['Inscrição com login', 'Melhor de 1 ou de 3']}
              live={tournaments ? <Live off={!openTournaments && !runningTournaments}>{`${plural(openTournaments, 'aberto', 'abertos')} · ${runningTournaments} em andamento`}</Live> : <Live off>Contando…</Live>}
              action="Ver torneios"
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
          <nav className="footer-links" aria-label="Rodapé">
            {[...nav.slice(1), extra[0]].map((item) => (
              <button key={item.key} type="button" className="text-link" onClick={item.onClick}>
                {item.label}
              </button>
            ))}
          </nav>
          <p className="disclaimer">
            Projeto de fã, sem fins lucrativos e sem vínculo com a Bandai, Toei Animation ou Shueisha. As traduções para português são
            automáticas e não oficiais.
          </p>
        </div>
      </footer>

      {queue && <QueueWait queue={queue} onCancel={cancel} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showTests && <TestOptions seed={seed} onSeed={setSeed} onReplay={loadReplay} onClose={() => setShowTests(false)} />}

      {picking !== null && (
        <DeckPicker
          title={picking === 0 ? 'Deck equipado' : 'Deck do oponente'}
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
