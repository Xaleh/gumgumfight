import { type BotLevel, type BotPersonality, cardLegality, FORMATS, hasRanked, isFormat, PLAY_FORMATS, type PlayerId, playMode, type PlayMode, spoilerRule } from '@gumgum/engine';
import { type ReactNode, type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ActiveRoom,
  api,
  ApiError,
  canPlay,
  currentSpoilerSet,
  type DeckSummary,
  type FormatId,
  isTeam,
  modeLabel,
  type OnlineSeat,
  type QueueKind,
  type QueueLeader,
  type TournamentMine,
  type WatchTarget,
  whyNotPlayable,
  type YonkoSeatRef,
} from '../api';
import jollyRoger from '../assets/jolly-roger.svg';
import { useAuth } from '../auth';
import { buildSetup, setupFromReplayText } from '../game/setup';
import type { GameSetup } from '../game/useGame';
import { type MessageKey, useT } from '../i18n';
import { NICKNAME_EVENT, SettingsModal, useSettings } from '../settings';
import { type NavItem, TopBar } from './AppShell';
import { LiveNow, MetaBlock, TournamentBanner, TournamentsBlock, usePoll } from './HomeBlocks';
import { Icon, type IconName } from './Icons';
import { InstallBanner } from './Install';
import { LearnBanner } from './LearnBanner';
import { DailyBanner } from './DailyChallenge';
import { LeaderArt } from './LeaderArt';
import { DeckConfirm } from './DeckConfirm';
import { DeckPicker, RANDOM_DECK } from './DeckPicker';
import { useFavoriteToggle } from './DeckTile';
import { LeaderPicker, roomCodeFromUrl } from './OnlineMenu';
import { useAppQueue } from './QueueDock';
import { rememberRoomDeck } from '../roomDeck';
import { type FriendLink, FriendInvites, friendsBadge, FriendsSheet, type InviteOption, useFriends } from './Friends';
import { compactRules, savedDeckId, savedRules as savedYonkoRules, yonkoDeckOf } from './Yonko';
import { ReplayLoader } from './ReplayLoader';
import { SupportersList, SupportModal } from './Support';
import { SponsorsStrip } from './Tournaments';

/** Código de sala do link de convite (lido uma vez, ao carregar a página). */
const URL_ROOM_CODE = roomCodeFromUrl();

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

const LAST_DECKS = 'gumgum.lastDecks';
const LAST_FORMAT = 'gumgum.format';
const LAST_BOT_LEVEL = 'gumgum.botLevel';
const LAST_BOT_PERSONALITY = 'gumgum.botPersonality';
const LAST_PRIVATE_RULES = 'gumgum.privateRules';
const LAST_BOT_RULES = 'gumgum.botRules';

/**
 * Cartas das salas privadas e do treino contra o bot: só as lançadas, também os spoilers ou
 * Livre (vale tudo, inclusive as banidas). Com o formato escolhido, dá as cinco opções.
 */
type Rules = 'released' | 'spoilers' | 'free';

const RULES: ReadonlyArray<[Rules, MessageKey]> = [
  ['released', 'menu.rulesReleased'],
  ['spoilers', 'menu.rulesSpoilers'],
  ['free', 'menu.rulesFree'],
];

function savedRules(key: string): Rules {
  try {
    const v = localStorage.getItem(key);
    return v === 'spoilers' || v === 'free' ? v : 'released';
  } catch {
    return 'released';
  }
}

function saveRules(key: string, rules: Rules) {
  try {
    localStorage.setItem(key, rules);
  } catch {
    /* sem armazenamento local */
  }
}

function savedBotLevel(): BotLevel {
  try {
    const v = localStorage.getItem(LAST_BOT_LEVEL);
    return v === 'easy' || v === 'normal' || v === 'team' ? v : 'hard';
  } catch {
    return 'hard';
  }
}

/** As opções do estilo do bot: o valor, o rótulo e a explicação (aparece junto, na folha de opções do bot). */
const BOT_STYLE_OPTIONS = [
  ['balanced', 'menu.botBalanced', 'menu.botBalancedTitle'],
  ['aggressive', 'menu.botAggressive', 'menu.botAggressiveTitle'],
  ['control', 'menu.botControl', 'menu.botControlTitle'],
  ['cautious', 'menu.botCautious', 'menu.botCautiousTitle'],
] as const satisfies ReadonlyArray<readonly [BotPersonality, MessageKey, MessageKey]>;

function savedBotPersonality(): BotPersonality {
  try {
    const v = localStorage.getItem(LAST_BOT_PERSONALITY);
    return v === 'aggressive' || v === 'control' || v === 'cautious' ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

function savedFormat(): FormatId {
  try {
    const saved = localStorage.getItem(LAST_FORMAT);
    return isFormat(saved) ? saved : 'standard';
  } catch {
    return 'standard';
  }
}

const RANDOM = RANDOM_DECK;

/** Modos que começam uma partida pelo menu (e pedem a confirmação do deck). */
type StartKind = 'ranked' | 'casual' | 'private' | 'join' | 'bot';

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

const FIRST_OPTIONS = [
  ['random', 'menu.firstRandom'],
  ['0', 'menu.you'],
  ['1', 'menu.botName'],
] as const satisfies ReadonlyArray<readonly ['random' | '0' | '1', MessageKey]>;

const BOT_LEVEL_LABEL: Record<BotLevel, MessageKey> = { easy: 'menu.botEasy', normal: 'menu.botNormal', hard: 'menu.botHard', team: 'menu.botTeam' };

/**
 * Opções do treino contra o bot (quem começa, nível e estilo), numa folha: no card "Contra o bot" fica só o resumo,
 * para ele não passar da altura dos outros modos.
 */
function BotOptions({
  first,
  onFirst,
  level,
  onLevel,
  team,
  personality,
  onPersonality,
  teamServer,
  onClose,
}: {
  first: 'random' | '0' | '1';
  onFirst: (first: 'random' | '0' | '1') => void;
  level: BotLevel;
  onLevel: (level: BotLevel) => void;
  /** Quem é do Time vê o nível Time (o Bot do Time). */
  team: boolean;
  personality: BotPersonality;
  onPersonality: (personality: BotPersonality) => void;
  /** O Bot do Time vai jogar no servidor (aviso embaixo do nível). */
  teamServer: boolean;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const levels: BotLevel[] = team ? ['easy', 'normal', 'hard', 'team'] : ['easy', 'normal', 'hard'];
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet bot-options" role="dialog" aria-modal="true" aria-labelledby="bot-options-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3 id="bot-options-title">{t('menu.botOptions')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="mode-field">
            <span className="mode-field-label" id="first-label">
              {t('menu.whoStarts')}
            </span>
            <div className="seg" role="group" aria-labelledby="first-label">
              {FIRST_OPTIONS.map(([v, label]) => (
                <button key={v} type="button" className={first === v ? 'on' : ''} aria-pressed={first === v} onClick={() => onFirst(v)}>
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          <div className="mode-field">
            <span className="mode-field-label" id="bot-level-label">
              {t('menu.botLevel')}
            </span>
            <div className="seg" role="group" aria-labelledby="bot-level-label">
              {levels.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={[level === v ? 'on' : '', v === 'team' ? 'team' : ''].join(' ')}
                  aria-pressed={level === v}
                  title={v === 'team' ? t('menu.botTeamTitle') : undefined}
                  onClick={() => onLevel(v)}
                >
                  {t(BOT_LEVEL_LABEL[v])}
                </button>
              ))}
            </div>
            {level === 'team' && teamServer && <p className="muted small mode-hint">{t('menu.botTeamServer')}</p>}
          </div>
          {/* O Bot do Time não tem estilo: o dele sai do perfil do deck. */}
          {level !== 'team' && (
            <div className="mode-field">
              <span className="mode-field-label" id="bot-style-label">
                {t('menu.botStyle')}
              </span>
              <div className="bot-styles" role="group" aria-labelledby="bot-style-label">
                {BOT_STYLE_OPTIONS.map(([v, label, hint]) => (
                  <button key={v} type="button" className={['bot-style', personality === v ? 'on' : ''].join(' ')} aria-pressed={personality === v} onClick={() => onPersonality(v)}>
                    <span className="bot-style-name">{t(label)}</span>
                    <span className="bot-style-hint">{t(hint)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="btn primary" onClick={onClose}>
            {t('common.ok')}
          </button>
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

/** Escolha das cartas da sala privada ou do treino contra o bot. */
function RulesField({ id, value, onChange }: { id: string; value: Rules; onChange: (rules: Rules) => void }) {
  const t = useT();
  const set = currentSpoilerSet();
  return (
    <div className="mode-field">
      <span className="mode-field-label" id={id}>
        {t('menu.rules')}
      </span>
      <div className="seg small rules-seg" role="group" aria-labelledby={id}>
        {RULES.map(([v, label]) => (
          <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
            {/* "+ EB05": com spoilers só vale a próxima coleção a ser lançada. */}
            {v === 'spoilers' && set ? t('menu.rulesSpoilerSet', { set }) : t(label)}
          </button>
        ))}
      </div>
      {/* Estatísticas só de Standard e EGB puros. */}
      {value !== 'released' && <span className="muted small">{t('menu.rulesNoStats')}</span>}
    </div>
  );
}

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
  onLearn,
  onSandbox,
  onDaily,
  onCoverage,
  onStats,
  onOnline,
  onWatch,
  onWatchRoom,
  onTournaments,
  onTournamentMatch,
  onAdmin,
  onTeamBot,
  onSealed,
  onDraft,
  onYonko,
  onYonkoOnline,
  dev = false,
  friendLink,
}: {
  onStart: (s: GameSetup) => void;
  onOnline: (s: OnlineSeat) => void;
  /** Construtor de decks (com `deckId`: já abre esse deck). */
  onBuildDecks: (deckId?: string) => void;
  /** Tutorial "Aprender a jogar". */
  onLearn: () => void;
  /** Sandbox de regras (mesa livre para testar cartas). */
  onSandbox: () => void;
  /** Desafio do dia. */
  onDaily: () => void;
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
  /** Tela "Bot do Time" (só para quem é do Time): decks do meta e caixa de correções. */
  onTeamBot?: () => void;
  /** Abre o Selado (boosters e deck de 40). */
  onSealed: () => void;
  /** Abre a entrada do Draft (pods de coleção, Pack Rush ou Cubo). */
  onDraft: () => void;
  /** Abre a sala do Yonko (mesa de todos contra todos); `code`: com o código de uma mesa já preenchido. */
  onYonko: (code?: string) => void;
  /** Vai para uma mesa online do Yonko (convite de amigo: a mesa que criei ou em que acabei de sentar). */
  onYonkoOnline: (seat: YonkoSeatRef) => void;
  /** Funções de desenvolvimento (só para Dev): opções de teste. */
  dev?: boolean;
  /** Endereço dos amigos (link para adicionar, aviso de pedido ou de convite): ver Friends.tsx. */
  friendLink?: FriendLink;
}) {
  const { user, config, notice: authNotice, error: authError } = useAuth();
  const supportOn = Boolean(config?.support);
  const t = useT();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);
  /** Erro de uma ação dos modos (fila, sala, bot). */
  const [actionError, setActionError] = useState<string | null>(null);
  const toggleFavorite = useFavoriteToggle(setDecks, setActionError);
  const [showSettings, setShowSettings] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  /** Folha "Amigos": o código já preenchido (link de amigo) e se veio por um link. */
  const [showFriends, setShowFriends] = useState<{ code?: string; linked?: boolean } | null>(null);
  /** Convite de amigo à espera dos decks carregarem para entrar na sala. */
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  /** O mesmo para o convite de uma mesa do Yonko. */
  const [pendingYonko, setPendingYonko] = useState<string | null>(null);
  const friends = useFriends(Boolean(user));
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  /** Folha com as opções do bot (quem começa, nível e estilo); no card fica só o resumo. */
  const [showBotOptions, setShowBotOptions] = useState(false);
  const closeBotOptions = useCallback(() => setShowBotOptions(false), []);
  const [savedLevel, setBotLevel] = useState<BotLevel>(savedBotLevel);
  /** O nível Time (o Bot do Time) só vale para quem é do Time; para os outros, o guardado vira "difícil". */
  const team = isTeam(user);
  const botLevel: BotLevel = savedLevel === 'team' && !team ? 'hard' : savedLevel;
  /** Estilo do bot (D3). O Bot do Time não tem: o estilo dele sai do perfil do deck. */
  const [botPersonality, setBotPersonality] = useState<BotPersonality>(savedBotPersonality);
  const personality: BotPersonality | undefined = botLevel === 'team' || botPersonality === 'balanced' ? undefined : botPersonality;
  const [format, setFormat] = useState<FormatId>(savedFormat);
  /** Coleções disponíveis no Selado (null: ainda não se sabe, ou o servidor é antigo). */
  const [sealedSets, setSealedSets] = useState<number | null>(null);
  useEffect(() => {
    api.sealed
      .sets()
      .then((r) => setSealedSets(r.sets.length))
      .catch(() => setSealedSets(null));
  }, []);
  const [privateRules, setPrivateRules] = useState<Rules>(() => savedRules(LAST_PRIVATE_RULES));
  const [botRules, setBotRules] = useState<Rules>(() => savedRules(LAST_BOT_RULES));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<null | 0 | 1>(null);
  /** Modo esperando a confirmação do deck. */
  const [confirming, setConfirming] = useState<StartKind | null>(null);
  const { confirmDeck } = useSettings();
  /** Casual: Líder do oponente escolhido (null = qualquer um) e a folha de escolha. */
  const [casualLeader, setCasualLeader] = useState<QueueLeader | null>(null);
  const [pickingLeader, setPickingLeader] = useState(false);
  // Trocar de formato desfaz a escolha de um Líder que não vale no formato novo.
  useEffect(() => {
    setCasualLeader((l) => (l && cardLegality(l.id, format, undefined, { category: 'leader' }) !== 'legal' ? null : l));
  }, [format]);
  const [code, setCode] = useState(URL_ROOM_CODE ?? '');
  const userId = user?.id;
  /** Dev: cartas que entraram com ⚙ e ainda não foram vistas (selo no item "Cobertura das cartas"). */
  const [newGaps, setNewGaps] = useState(0);
  const coverageOn = Boolean(onCoverage);
  useEffect(() => {
    if (!coverageOn) return;
    let cancelled = false;
    api
      .cardGapsNewCount()
      .then((r) => !cancelled && setNewGaps(r.newCount))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [coverageOn, userId]);
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
  /** Sala privada: liberar as mãos dos jogadores para quem transmite (streamer). */
  const [shareHands, setShareHands] = useState(false);
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
          // Os decks prontos do All Blue só são sugeridos nesse formato.
          const builtin = d.filter((x) => canPlay(x, format) && x.kind === 'builtin' && (format === 'allblue' || !x.allBlue)).map((x) => x.id);
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
  // A fila mora na raiz do app (acompanha o jogador pelas telas); a recusa do servidor aparece aqui, junto dos modos.
  const { queue, enqueue, error: queueError, clearError: clearQueueError } = useAppQueue();
  useEffect(() => {
    if (queueError === null) return;
    fail(queueError);
    clearQueueError();
  }, [queueError]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const startBot = async (mine: string) => {
    setLoading(true);
    setActionError(null);
    try {
      // Sem apelido: um nome que funcione nas frases do log, que são em terceira pessoa ("You kept their hand" não).
      const names: [string, string] = [nickname ?? t('menu.youName'), t('menu.botName')];
      const builtin = decks.filter((d) => playsIn(d, botMode) && d.kind === 'builtin' && (botMode.format === 'allblue' || !d.allBlue));
      // O Bot do Time sorteia entre os decks do meta, quando há algum que vale nas regras.
      const meta = botLevel === 'team' ? builtin.filter((d) => d.meta) : [];
      const pool = meta.length ? meta : builtin;
      if (deck1 === RANDOM && !pool.length) throw new Error(t('menu.noBuiltinDeck', { format: modeLabel(botMode) }));
      const opp = deck1 === RANDOM ? pool[Math.floor(Math.random() * pool.length)].id : deck1;
      const firstPlayer = first === 'random' ? undefined : (Number(first) as PlayerId);
      let notice: string | undefined;
      // O Bot do Time joga no servidor sempre que dá (o perfil do deck e o relógio maior ficam lá).
      if (broadcasting || (botLevel === 'team' && botRooms && user)) {
        try {
          onOnline(await api.online.botRoom(mine, opp, botMode, firstPlayer, botLevel === 'easy' ? undefined : botLevel, personality));
          return;
        } catch (e) {
          // Servidor lotado: o treino roda no navegador, sem transmissão.
          if (!(e instanceof ApiError && e.status === 503)) throw e;
          notice = t('menu.broadcastFull');
        }
      }
      try {
        localStorage.setItem(LAST_BOT_LEVEL, botLevel);
        localStorage.setItem(LAST_BOT_PERSONALITY, botPersonality);
      } catch {
        /* sem armazenamento local */
      }
      const setup = await buildSetup('bot', [mine, opp], names, seed, botMode.format, firstPlayer);
      // Bot do Time no navegador: o perfil do deck do bot (o do deck do meta, ou, num deck de jogador, o do deck do meta
      // com o mesmo Líder).
      const oppLeader = decks.find((d) => d.id === opp)?.leader;
      const botProfile = botLevel === 'team' ? ((await api.bot.profile(opp, oppLeader).catch(() => null))?.profile ?? undefined) : undefined;
      // O deck provável do Líder de quem joga (o que o meta joga com ele, sem as partidas da própria pessoa): o bot
      // deduz a mão do oponente por aqui. Sem rede ou sem deck provável, o bot joga com o modelo fixo.
      const myLeader = decks.find((d) => d.id === mine)?.leader;
      const botHandGuess = botLevel !== 'easy' && myLeader ? ((await api.bot.handGuess(myLeader).catch(() => null))?.guess ?? undefined) : undefined;
      onStart({
        ...setup,
        spoilers: botMode.spoilers,
        botLevel,
        ...(personality ? { botPersonality: personality } : {}),
        ...(botProfile ? { botProfile } : {}),
        ...(botHandGuess ? { botHandGuess } : {}),
        ...(notice ? { notice } : {}),
      });
    } catch (e) {
      fail(e);
      setLoading(false);
    }
  };

  /** Lê um replay baixado (.json) e monta a partida para assistir. */
  const loadReplay = async (file: File): Promise<GameSetup> => setupFromReplayText(await file.text());

  const d0 = decks.find((d) => d.id === deck0);
  const d1 = decks.find((d) => d.id === deck1);
  const fmt = modeLabel({ format });
  /**
   * Regras das salas privadas e do treino: o formato escolhido (com ou sem spoilers) ou o Livre.
   * Com spoilers, só vale a próxima coleção a ser lançada ("Standard + EB05").
   */
  const modeOf = (rules: Rules): PlayMode => {
    if (rules === 'free') return playMode('free', true);
    const set = rules === 'spoilers' ? currentSpoilerSet() : null;
    return { ...playMode(format, rules === 'spoilers'), ...(set ? { spoilerSet: set } : {}) };
  };
  const privateMode = modeOf(privateRules);
  const botMode = modeOf(botRules);
  /** Resumo das opções do bot no card: "Difícil · Controle" (o Bot do Time não tem estilo) e quem começa. */
  const botSummary = [t(BOT_LEVEL_LABEL[botLevel]), ...(botLevel === 'team' ? [] : [t(BOT_STYLE_OPTIONS.find(([v]) => v === botPersonality)![1])])].join(' · ');
  const firstSummary = t(FIRST_OPTIONS.find(([v]) => v === first)![1]);
  /** O deck é completo e vale nas regras. */
  function playsIn(d: DeckSummary | undefined, mode: PlayMode): d is DeckSummary {
    return Boolean(d && canPlay(d, mode.format, spoilerRule(mode)));
  }
  /** Os dois decks precisam valer nas regras do treino. */
  const botReady = playsIn(d0, botMode) && (deck1 === RANDOM || playsIn(d1, botMode));
  /** Deck para as filas (completo e permitido no formato). */
  const onlineDeck = d0 && canPlay(d0, format) ? d0 : undefined;
  /** Deck para a sala privada (vale nas regras escolhidas para ela). */
  const privateDeck = playsIn(d0, privateMode) ? d0 : undefined;
  const playing = active.find((r) => r.status === 'playing');
  const waiting = active.find((r) => r.status === 'waiting');
  const manualCards = d0?.unscripted ?? 0;
  const onlineBlocked = !onlineDeck || busy || Boolean(playing) || Boolean(queue);
  /** Na fila, os outros modos ficam desligados: a partida que chega tiraria o jogador do meio de outra. */
  const queueNote = queue ? t('wait.inQueueNote') : null;
  const onlineNote = !d0 ? t('menu.pickDeck') : !onlineDeck ? t('menu.deckNotValidIn', { format: fmt }) : playing ? t('menu.finishCurrent') : queueNote;
  const privateNote = !d0
    ? t('menu.pickDeck')
    : !privateDeck
      ? t('menu.deckNotValidIn', { format: modeLabel(privateMode) })
      : playing
        ? t('menu.finishCurrent')
        : queueNote;
  /** Cartas de spoiler (ainda não lançadas) no deck: a ranqueada só aceita cartas lançadas. */
  const spoilerCards = d0?.spoilers?.length ?? 0;
  const rankedNote =
    (!hasRanked(format) ? t('menu.rankedNotInFormat', { format: fmt }) : null) ??
    onlineNote ??
    (!user
      ? t('menu.rankedNeedsLogin')
      : spoilerCards > 0
        ? t('menu.rankedSpoilers', { n: spoilerCards })
        : manualCards > 0
          ? t('menu.rankedManualCards', { n: manualCards })
          : null);

  /** Por que o deck não vale no modo (null: vale). Quem entra numa sala joga nas regras de quem criou (conferidas no servidor). */
  const whyNotIn = (kind: StartKind, d: DeckSummary): string | null => {
    switch (kind) {
      case 'ranked':
        return (
          whyNotPlayable(d, format) ??
          (d.spoilers?.length ? t('menu.rankedSpoilers', { n: d.spoilers.length }) : d.unscripted ? t('menu.rankedManualCards', { n: d.unscripted }) : null)
        );
      case 'casual':
        return whyNotPlayable(d, format);
      case 'private':
        return whyNotPlayable(d, privateMode.format, spoilerRule(privateMode));
      case 'join':
        return d.valid ? null : whyNotPlayable(d, 'free');
      case 'bot':
        return whyNotPlayable(d, botMode.format, spoilerRule(botMode));
    }
  };
  /** Entra no modo com o deck. */
  const start = (kind: StartKind, deckId: string) => {
    switch (kind) {
      case 'ranked':
      case 'casual':
        return run(() => enqueue(deckId, format, kind, kind === 'casual' ? casualLeader : null));
      case 'private':
        return run(async () => {
          const r = await api.online.createRoom(deckId, privateMode, shareHands);
          rememberRoomDeck(r.roomId, deckId);
          onOnline({ roomId: r.roomId, token: r.token });
        });
      case 'join':
        // Quem entra joga no formato de quem criou a sala.
        return run(async () => onOnline(await api.online.joinRoom(code, deckId)));
      case 'bot':
        return startBot(deckId);
    }
  };
  /** Confirma o deck antes (se ligado nas configurações) ou entra direto com o equipado. */
  const ask = (kind: StartKind) => (confirmDeck ? setConfirming(kind) : void start(kind, deck0));

  /** Convite de amigo: entra direto na sala com o deck equipado (ou confirma o deck, se ligado nas configurações). */
  const joinInvite = (room: string) => {
    setCode(room);
    setShowFriends(null);
    if (confirmDeck || !d0?.valid) {
      if (d0?.valid) setConfirming('join');
      else privateCard.current?.scrollIntoView({ block: 'center' });
      return;
    }
    void run(async () => onOnline(await api.online.joinRoom(room, deck0)));
  };
  /** O deck que vai para a mesa do Yonko num convite: o da última mesa, ou o primeiro que servir. */
  const yonkoDeck = useMemo(() => yonkoDeckOf(decks, savedDeckId()), [decks]);
  /**
   * Convite para uma mesa do Yonko: senta direto com o deck do Yonko. Não passa pela confirmação do deck: a sala
   * de espera mostra o deck, deixa trocar, e a partida só começa depois do "Estou pronto".
   */
  const joinYonko = (table: string) => {
    setShowFriends(null);
    if (!yonkoDeck) return onYonko(table);
    void run(async () => onYonkoOnline(await api.yonko.join(table, yonkoDeck.id)));
  };
  /** Por que o botão Convidar está desligado (null: dá para convidar). */
  const inviteBlocked = playing ? t('menu.playingOnline') : null;
  /**
   * 1 contra 1: as regras da Sala privada como estão escolhidas nela e, depois, cada formato puro e o Livre.
   * O deck equipado precisa valer no formato.
   */
  const duelModes = [privateMode, ...PLAY_FORMATS.map((f) => playMode(f, false))].filter(
    (m, i, all) => all.findIndex((x) => x.format === m.format && x.spoilers === m.spoilers) === i,
  );
  const inviteOptions: InviteOption[] = [
    ...duelModes.map((m, i) => ({
      key: `duel:${i}`,
      group: 'duel' as const,
      label: modeLabel(m),
      deck: d0?.name,
      blocked: playsIn(d0, m) ? null : !d0 ? t('menu.pickDeck') : (whyNotPlayable(d0, m.format, spoilerRule(m))?.split('\n')[0] ?? t('menu.deckNotValidIn', { format: modeLabel(m) })),
    })),
    { key: 'yonko', group: 'yonko' as const, label: t('friends.inviteYonko'), deck: yonkoDeck?.name, blocked: yonkoDeck ? null : t('yonko.noDeck') },
  ];
  /**
   * Convidar um amigo no formato escolhido. 1 contra 1: sala privada com o deck equipado nas regras do formato.
   * Yonko: a mesa em que já espero (ou uma nova, com o deck e as regras da última vez). Depois, o aviso para ele.
   */
  const inviteFriend = async (friend: { id: string }, option: string) => {
    if (option === 'yonko') {
      if (!yonkoDeck) return;
      const open = (await api.yonko.active().catch(() => [])).find((a) => a.status === 'waiting');
      const seat = open ?? (await api.yonko.create(yonkoDeck.id, compactRules(savedYonkoRules())));
      // A mesa já existe: mesmo se o aviso falhar, a pessoa vai para ela (lá dá para chamar de novo).
      await api.friends.inviteYonko(friend.id, seat).catch(() => undefined);
      setShowFriends(null);
      onYonkoOnline(seat);
      return;
    }
    const mode = duelModes[Number(option.slice('duel:'.length))];
    if (!mode || !playsIn(d0, mode)) return;
    const r = await api.online.createRoom(d0.id, mode, false);
    rememberRoomDeck(r.roomId, d0.id);
    const seat = { roomId: r.roomId, token: r.token };
    // A sala já existe: mesmo se o aviso falhar, a pessoa vai para ela (o código continua lá para mandar).
    await api.friends.invite(friend.id, seat).catch(() => undefined);
    setShowFriends(null);
    onOnline(seat);
  };
  useEffect(() => {
    if (!friendLink) return;
    if (friendLink.open || friendLink.add) setShowFriends({ code: friendLink.add, linked: Boolean(friendLink.add) });
    if (friendLink.invite) setPendingInvite(friendLink.invite);
    if (friendLink.yonko) setPendingYonko(friendLink.yonko);
  }, [friendLink?.at]);
  useEffect(() => {
    if (!pendingInvite || !decks.length || !deck0) return;
    setPendingInvite(null);
    joinInvite(pendingInvite);
  }, [pendingInvite, decks.length, deck0]);
  useEffect(() => {
    if (!pendingYonko || !decks.length) return;
    setPendingYonko(null);
    joinYonko(pendingYonko);
  }, [pendingYonko, decks.length]);

  const queueLive = (kind: QueueKind) =>
    stats ? <Live>{t('menu.queueLive', { n: stats.playing[kind], q: stats.queue[kind][format] })}</Live> : <Live off>{t('menu.counting')}</Live>;
  const openTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'registration').length;
  const runningTournaments = (tournaments?.tournaments ?? []).filter((t) => t.status === 'running').length;
  const totalPlaying = stats ? Object.values(stats.playing).reduce((a, b) => a + b, 0) : null;
  const totalQueue = stats ? Object.values(stats.queue).reduce((a, q) => a + Object.values(q).reduce((x, y) => x + y, 0), 0) : null;

  const nav: NavItem[] = [
    { key: 'play', label: t('menu.navPlay'), icon: 'swords', current: true, onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
    { key: 'learn', label: t('menu.navLearn'), icon: 'learn', onClick: onLearn },
    { key: 'daily', label: t('daily.nav'), icon: 'star', onClick: onDaily },
    { key: 'builder', label: t('menu.navDecks'), icon: 'deck', onClick: () => onBuildDecks() },
    { key: 'tournaments', label: t('menu.navTournaments'), icon: 'crown', onClick: () => onTournaments() },
    {
      key: 'friends',
      label: friendsBadge(friends.data) ? t('friends.navCount', { n: friendsBadge(friends.data) }) : t('friends.nav'),
      icon: 'user',
      onClick: () => setShowFriends({}),
    },
    { key: 'watch', label: t('menu.navWatch'), icon: 'eye', onClick: onWatch },
    { key: 'stats', label: t('menu.navStats'), icon: 'chart', onClick: onStats },
  ];
  const extra: NavItem[] = [
    { key: 'settings', label: t('menu.navSettings'), icon: 'sliders', onClick: () => setShowSettings(true) },
    { key: 'replay', label: t('menu.navReplay'), icon: 'play', onClick: () => setShowReplay(true) },
    { key: 'sandbox', label: t('sandbox.nav'), icon: 'grid', onClick: onSandbox },
    ...(supportOn ? [{ key: 'support', label: t('support.nav'), icon: 'heart' as const, onClick: () => setShowSupport(true) }] : []),
    ...(onAdmin ? [{ key: 'admin', label: t('menu.navAdmin'), icon: 'shield' as const, onClick: onAdmin }] : []),
    ...(onTeamBot ? [{ key: 'teambot', label: t('menu.navTeamBot'), icon: 'bot' as const, onClick: onTeamBot }] : []),
    ...(onCoverage
      ? [{ key: 'coverage', label: newGaps ? t('menu.navCoverageNew', { n: newGaps }) : t('menu.navCoverage'), icon: 'check' as const, onClick: onCoverage }]
      : []),
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
              {supportOn && (
                <button type="button" className="hero-link home-support-pill" onClick={() => setShowSupport(true)} title={t('support.heroPillTitle')}>
                  {t('support.heroPill')}
                </button>
              )}
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
            onReady={(ready) =>
              api.tournaments.ready(myEntry.id, myEntry.match!.id, ready).then(() => setMyEntry({ ...myEntry, match: { ...myEntry.match!, ready } }))
            }
          />
        )}
        {!playing && friends.data && friends.data.invites.length > 0 && (
          <FriendInvites
            invites={friends.data.invites}
            onJoin={(i) => (i.kind === 'yonko' ? joinYonko(i.code) : joinInvite(i.code))}
            onDecline={(room) => void api.friends.declineInvite(room).then(friends.refresh, () => undefined)}
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

        <LearnBanner onLearn={onLearn} />
        <DailyBanner onOpen={onDaily} />
        <InstallBanner />

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
                {format === 'allblue' && <li className="home-chip">{t('menu.allBlueChip')}</li>}
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
            <button type="button" className="text-link" onClick={() => onBuildDecks()}>
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
              chips={[t('menu.chipGoogleLogin'), t('menu.chipReleasedOnly'), t('menu.chipNoManual')]}
              live={queueLive('ranked')}
              note={rankedNote}
              action={t('menu.findMatch')}
              disabled={onlineBlocked || Boolean(rankedNote)}
              onAction={() => ask('ranked')}
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
              onAction={() => ask('casual')}
            >
              <div className="mode-fields">
                <button type="button" className="pick-btn" onClick={() => setPickingLeader(true)} title={t('menu.pickLeaderHint')}>
                  <span>{interp(t('menu.opponent'), 'name', <strong>{casualLeader?.name ?? t('menu.anyLeader')}</strong>)}</span>
                  <Icon name="chevron" size={14} />
                </button>
              </div>
            </ModeCard>
            <ModeCard
              mode="private"
              cardRef={privateCard}
              color="blue-card"
              icon="key"
              kicker={t('menu.privateKicker')}
              title={t('menu.private')}
              badge={modeLabel(privateMode)}
              desc={t('menu.privateDesc')}
              live={stats ? <Live>{t('menu.privateLive', { n: stats.playing.private, w: stats.waiting })}</Live> : <Live off>{t('menu.counting')}</Live>}
              note={privateNote}
              action={t('menu.createRoom')}
              disabled={!privateDeck || busy || Boolean(playing) || Boolean(queue)}
              highlight={Boolean(URL_ROOM_CODE)}
              onAction={() => ask('private')}
            >
              <RulesField
                id="private-rules-label"
                value={privateRules}
                onChange={(r) => {
                  setPrivateRules(r);
                  saveRules(LAST_PRIVATE_RULES, r);
                }}
              />
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
                    disabled={!d0?.valid || busy || code.length !== 6 || Boolean(playing) || Boolean(queue)}
                    onClick={() => ask('join')}
                  >
                    {t('menu.joinRoom')}
                  </button>
                </div>
              </div>
              <label className="check" title={t('menu.shareHandsTitle')}>
                <input type="checkbox" checked={shareHands} onChange={(e) => setShareHands(e.target.checked)} />
                {t('menu.shareHands')}
              </label>
            </ModeCard>
            <ModeCard
              mode="bot"
              color="purple"
              icon="bot"
              kicker={t('menu.botKicker')}
              title={t('menu.vsBot')}
              badge={modeLabel(botMode)}
              desc={t('menu.botDesc')}
              live={(broadcasting || (botLevel === 'team' && botRooms && user)) && stats ? <Live>{t('menu.botLive', { n: stats.playing.bot })}</Live> : <Live off>{t('menu.botLocal')}</Live>}
              note={!d0 || botReady ? queueNote : t('menu.bothDecksValid', { format: modeLabel(botMode) })}
              action={loading ? t('common.loading') : t('menu.battle')}
              disabled={!botReady || loading || Boolean(queue)}
              onAction={() => ask('bot')}
            >
              <button type="button" className="mode-learn" onClick={onLearn}>
                <Icon name="learn" size={16} />
                {t('menu.learnLink')}
              </button>
              <div className="mode-fields">
                <button type="button" className="pick-btn" onClick={() => setPicking(1)} disabled={!decks.length}>
                  <span>{interp(t('menu.opponent'), 'name', <strong>{deck1 === RANDOM ? t('menu.randomDeck') : (d1?.name ?? t('menu.choose'))}</strong>)}</span>
                  <Icon name="chevron" size={14} />
                </button>
                <RulesField
                  id="bot-rules-label"
                  value={botRules}
                  onChange={(r) => {
                    setBotRules(r);
                    saveRules(LAST_BOT_RULES, r);
                  }}
                />
                <button
                  type="button"
                  className="pick-btn bot-summary"
                  onClick={() => setShowBotOptions(true)}
                  aria-haspopup="dialog"
                  // O nome diz o que o botão abre e o que está escolhido (sem ele, o leitor de tela só ouviria os valores).
                  aria-label={`${t('menu.botOptions')}: ${botSummary}, ${t('menu.firstSummary', { who: firstSummary })}`}
                  title={t('menu.botOptions')}
                >
                  <span className="bot-summary-lines">
                    <span>{interp(t('menu.botSummary'), 'value', <strong>{botSummary}</strong>)}</span>
                    <span className="bot-summary-sub">{interp(t('menu.firstSummary'), 'who', <strong>{firstSummary}</strong>)}</span>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
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

        <section className="home-section" aria-labelledby="home-special">
          <div className="section-head">
            <h2 className="home-h2" id="home-special">
              {t('sealed.special')}
            </h2>
            <span className="muted">{t('sealed.specialHint')}</span>
          </div>
          <div className="mode-grid special">
            <ModeCard
              mode="sealed"
              color="teal"
              icon="store"
              kicker={t('sealed.homeKicker')}
              title={t('sealed.title')}
              badge={t('sealed.homeBadge')}
              desc={t('sealed.homeDesc')}
              chips={[t('sealed.homeChipPacks'), t('sealed.homeChipDeck'), t('sealed.homeChipPlay')]}
              live={sealedSets === null ? null : <Live off={!sealedSets}>{t('sealed.homeLive', { n: sealedSets })}</Live>}
              action={t('sealed.homeAction')}
              onAction={onSealed}
              disabled={sealedSets === 0}
            />
            <ModeCard
              mode="draft"
              color="purple"
              icon="deck"
              kicker={t('sealed.homeKicker')}
              title={t('draft.titlePlain')}
              badge={t('draft.homeBadge')}
              desc={t('draft.homeDesc')}
              chips={[t('draft.homeChipPacks'), t('sealed.homeChipDeck'), t('draft.homeChipSource')]}
              live={sealedSets === null ? null : <Live off={!sealedSets}>{t('sealed.homeLive', { n: sealedSets })}</Live>}
              action={t('draft.homeAction')}
              onAction={onDraft}
              disabled={sealedSets === 0}
            />
            <ModeCard
              mode="yonko"
              color="red"
              icon="crown"
              kicker={t('yonko.homeKicker')}
              title={t('yonko.title')}
              badge={t('yonko.homeBadge')}
              desc={t('yonko.homeDesc')}
              chips={[t('yonko.homeChipPlayers'), t('yonko.homeChipDeck'), t('yonko.homeChipBots')]}
              live={null}
              action={t('yonko.homeAction')}
              onAction={() => onYonko()}
            />
          </div>
        </section>

        <div className="home-blocks">
          <LiveNow onWatch={onWatchRoom} onAll={onWatch} />
          <TournamentsBlock list={tournaments} onOpen={onTournaments} />
          <MetaBlock onStats={onStats} />
        </div>
        {supportOn && <SponsorsStrip placement="home" hideEmpty />}
      </main>

      <footer className="home-footer">
        <div className="home-wrap home-footer-inner">
          <div className="footer-brand">
            <img src="/brand/header-mark.svg" alt="" />
            <span>GumGum Fight</span>
          </div>
          <nav className="footer-links" aria-label={t('menu.footerNav')}>
            {[...nav.slice(1), ...extra.filter((e) => e.key === 'settings' || e.key === 'support')].map((item) => (
              <button key={item.key} type="button" className="text-link" onClick={item.onClick}>
                {item.label}
              </button>
            ))}
          </nav>
          {supportOn && <SupportersList compact />}
          <p className="disclaimer">{t('menu.disclaimer')}</p>
        </div>
      </footer>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
      {showFriends && (
        <FriendsSheet
          loggedIn={Boolean(user)}
          data={friends.data}
          failed={friends.failed}
          refresh={friends.refresh}
          initialCode={showFriends.code}
          linked={showFriends.linked}
          inviteOptions={inviteOptions}
          onInvite={inviteFriend}
          inviteBlocked={inviteBlocked}
          onClose={() => setShowFriends(null)}
        />
      )}
      {showBotOptions && (
        <BotOptions
          first={first}
          onFirst={setFirst}
          level={botLevel}
          onLevel={setBotLevel}
          team={team}
          personality={botPersonality}
          onPersonality={setBotPersonality}
          teamServer={botRooms && Boolean(user)}
          onClose={closeBotOptions}
        />
      )}
      {showTests && <TestOptions seed={seed} onSeed={setSeed} onClose={() => setShowTests(false)} />}
      {showReplay && <ReplayLoader load={loadReplay} onStart={onStart} onClose={() => setShowReplay(false)} />}

      {pickingLeader && (
        <LeaderPicker
          format={format}
          value={casualLeader?.id ?? null}
          onPick={(leader) => {
            setCasualLeader(leader);
            setPickingLeader(false);
          }}
          onClose={() => setPickingLeader(false)}
        />
      )}
      {confirming && (
        <DeckConfirm
          kicker={
            {
              ranked: `${t('menu.ranked')} · ${fmt}`,
              casual: `${t('menu.casual')} · ${fmt}`,
              private: `${t('menu.private')} · ${modeLabel(privateMode)}`,
              join: `${t('menu.private')} · ${code}`,
              bot: `${t('menu.vsBot')} · ${modeLabel(botMode)}`,
            }[confirming]
          }
          deckId={deck0}
          decks={decks}
          whyFor={(d) => whyNotIn(confirming, d)}
          confirmLabel={
            { ranked: t('menu.findMatch'), casual: t('menu.findMatch'), private: t('menu.createRoom'), join: t('menu.joinRoom'), bot: t('menu.battle') }[confirming]
          }
          opponent={confirming === 'bot' ? { deckId: deck1 === RANDOM ? undefined : deck1, label: deck1 === RANDOM ? t('menu.randomDeck') : (d1?.name ?? '') } : undefined}
          onConfirm={(id) => {
            setConfirming(null);
            setDeck0(id);
            void start(confirming, id);
          }}
          onCancel={() => setConfirming(null)}
          onFavorite={toggleFavorite}
        />
      )}
      {picking !== null && (
        <DeckPicker
          title={picking === 0 ? t('menu.equippedDeck') : t('menu.opponentDeck')}
          context={picking === 0 ? t('decks.context.equipped') : t('decks.context.bot', { rules: modeLabel(botMode) })}
          decks={decks}
          value={picking === 0 ? deck0 : deck1}
          // Deck equipado: qualquer deck completo (ele vale em modos diferentes, o Livre inclusive); cada modo confere as regras.
          canUse={(d) => (picking === 0 ? d.valid : canPlay(d, botMode.format, spoilerRule(botMode)))}
          whyNot={(d) => (picking === 0 ? whyNotPlayable(d, 'free') : whyNotPlayable(d, botMode.format, spoilerRule(botMode)))}
          allowRandom={picking === 1}
          onPick={(id) => {
            if (picking === 0) setDeck0(id);
            else setDeck1(id);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
          onFavorite={toggleFavorite}
          onEdit={(id) => onBuildDecks(id)}
        />
      )}
    </div>
  );
}
