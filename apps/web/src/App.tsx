import { useEffect, useState } from 'react';
import { api, isAdmin, isDev, isTeam, type OnlineSeat, seesHands, type WatchTarget, type YonkoSeatRef } from './api';
import { audio } from './audio';
import { useAuth } from './auth';
import { Admin } from './components/Admin';
import { Broadcast } from './components/Broadcast';
import { Coverage } from './components/Coverage';
import { DeckBuilder } from './components/DeckBuilder';
import { GameScreen, OnlineGameScreen, WatchGameScreen } from './components/GameScreen';
import { Learn } from './components/Learn';
import { DailyChallenge } from './components/DailyChallenge';
import { DAILY_PARAM } from './game/daily';
import { Lesson } from './components/Lesson';
import { Draft } from './components/Draft';
import { Menu } from './components/Menu';
import { Sandbox } from './components/Sandbox';
import { Sealed } from './components/Sealed';
import { OAuthConsent } from './components/OAuthConsent';
import { PublicProfile } from './components/PublicProfile';
import { ReplayEmbed } from './components/ReplayEmbed';
import { Stats } from './components/Stats';
import { TeamBot } from './components/TeamBot';
import { Tournaments } from './components/Tournaments';
import { Yonko } from './components/Yonko';
import { YonkoOnline } from './components/YonkoOnline';
import { LocalYonkoTable } from './components/YonkoTable';
import { Watch } from './components/Watch';
import { type FriendLink, friendLinkFrom } from './friendLink';
import { DECK_LINK_PARAMS, type DeckLink, parseDeckLink } from './deeplink';
import { isReplayPath } from './embed';
import { parseSandboxLink, SANDBOX_PARAM } from './game/sandboxLink';
import { PROFILE_PARAM, parseProfileParam } from './profileLink';
import { syncTutorialProgress } from './game/tutorial/progress';
import type { GameSetup } from './game/useGame';
import type { YonkoSetup } from './game/useYonkoGame';
import type { SandboxSpec } from '@gumgum/engine';
import { usePushSync, useWakeLock } from './pwa';
import { canTurnScreen, turnScreen } from './screenTurn';
import { useSettings } from './settings';

type Screen =
  /** `friendLink`: veio de um link de amigo ou de um aviso de pedido ou convite (Friends.tsx). */
  | { name: 'menu'; friendLink?: FriendLink }
  /** `link`: lista vinda de um deep link (`/?deck=`); `linkInvalid`: havia um link, mas sem lista legível. */
  /** `open`: id de um deck salvo para abrir direto no editor (vindo do seletor de deck). */
  | { name: 'builder'; link?: DeckLink; linkInvalid?: boolean; open?: string; yonko?: boolean; back?: Screen }
  | { name: 'coverage' }
  | { name: 'stats' }
  /** Perfil público de um jogador (`/?perfil=<id>`); `back`: tela para onde "Voltar" leva. */
  | { name: 'profile'; id: string; back?: Screen }
  | { name: 'admin' }
  | { name: 'team' }
  | { name: 'watch-list' }
  /** Tutorial "Aprender a jogar": a lista de lições e uma lição aberta. */
  | { name: 'learn' }
  | { name: 'lesson'; id: string }
  /** Sandbox de regras: o editor da mesa (`spec`: a do link ou a que voltou da mesa; `linkInvalid`: link ilegível). */
  | { name: 'sandbox'; spec?: SandboxSpec; linkInvalid?: boolean; from?: 'learn' }
  /** Desafio do dia (`/?desafio` abre direto). */
  | { name: 'daily' }
  /**
   * `tournament`: veio da página de um torneio (e volta para ela; `lobby`: para o lobby dele);
   * `home`: veio do "Ao vivo agora" do menu.
   */
  | { name: 'watch'; target: WatchTarget; tournament?: string; lobby?: boolean; home?: boolean }
  /** `lobby`: abre direto o lobby do torneio (chamado de Judge na notificação). */
  | { name: 'tournaments'; id?: string; lobby?: boolean }
  /** `back`: tela para onde "Voltar" leva (replay aberto da página de um torneio ou da administração). */
  | { name: 'game'; setup: GameSetup; key: number; back?: Screen }
  /** `sealed`: sala de Selado aberta pela tela do Selado (e volta para o deck dele). */
  | { name: 'online'; seat: OnlineSeat; tournament?: string; lobby?: boolean; sealed?: string }
  /** Selado (Pré-release): abrir boosters, montar o deck de 40 e jogar. `pool`: abre direto esse deck. */
  | { name: 'sealed'; pool?: string; hub?: 'sealed' | 'draft' }
  /** Pod de Draft: sala de espera, escolhas e, no fim, a ida para a montagem do deck (tela do Selado). */
  | { name: 'draft'; pod: string }
  /**
   * Yonko: a entrada (`again`: volta de uma mesa local com o mesmo deck; `code`: convite para uma mesa online),
   * a mesa local contra bots e a mesa online (sala de espera e partida).
   */
  | { name: 'yonko'; again?: YonkoSetup; code?: string }
  | { name: 'yonko-online'; seat: YonkoSeatRef }
  | { name: 'yonko-game'; setup: YonkoSetup; key: number };

/** Partida online aberta nesta aba: ao recarregar a página, volta direto para ela. */
const OPEN_MATCH = 'gumgum.openMatch';

function savedScreen(): Screen {
  try {
    const s = JSON.parse(sessionStorage.getItem(OPEN_MATCH) ?? 'null') as Screen | null;
    const tournament = s && 'tournament' in s && typeof s.tournament === 'string' ? s.tournament : undefined;
    const lobby = s && tournament && 'lobby' in s && s.lobby === true ? { lobby: true } : {};
    if (s?.name === 'online' && typeof s.seat?.roomId === 'string' && typeof s.seat.token === 'string') {
      return { name: 'online', seat: { roomId: s.seat.roomId, token: s.seat.token }, tournament, ...lobby };
    }
    if (s?.name === 'yonko-online' && typeof s.seat?.id === 'string' && typeof s.seat.token === 'string') {
      return { name: 'yonko-online', seat: { id: s.seat.id, code: String(s.seat.code ?? ''), token: s.seat.token } };
    }
    if (s?.name === 'watch' && typeof s.target?.roomId === 'string') {
      return { name: 'watch', target: { roomId: s.target.roomId, hands: Boolean(s.target.hands), ...(s.target.judge ? { judge: true } : {}) }, tournament, ...lobby };
    }
  } catch {
    /* sem armazenamento */
  }
  return { name: 'menu' };
}

/** Parâmetros dos endereços abertos pelas notificações: a partida online e a página do torneio. */
const ROOM_PARAM = 'partida';
const TOURNAMENT_PARAM = 'torneio';
/** Tela de transmissão (fonte do OBS): `/?transmissao=<chave do streamer>`. */
const BROADCAST_PARAM = 'transmissao';

/** Tela de consentimento do OAuth dos apps parceiros (o servidor responde o index.html neste caminho). */
const OAUTH_PATH = '/oauth/authorize';

export function App() {
  const [broadcastKey] = useState(() => new URL(location.href).searchParams.get(BROADCAST_PARAM));
  const [oauthQuery] = useState(() => (location.pathname === OAUTH_PATH ? location.search.replace(/^\?/, '') : null));
  const [replayPage] = useState(() => isReplayPath(location.pathname));
  if (oauthQuery !== null) return <OAuthConsent query={oauthQuery} />;
  // Replay embutido em apps parceiros (`/replay/<id>?t=`): só a mesa, em modo replay.
  if (replayPage) return <ReplayEmbed />;
  return broadcastKey ? <Broadcast broadcastKey={broadcastKey} /> : <MainApp />;
}

function MainApp() {
  const [screen, setScreen] = useState<Screen>(savedScreen);
  useEffect(() => {
    try {
      if (screen.name === 'online' || screen.name === 'watch' || screen.name === 'yonko-online') sessionStorage.setItem(OPEN_MATCH, JSON.stringify(screen));
      else sessionStorage.removeItem(OPEN_MATCH);
    } catch {
      /* sem armazenamento */
    }
  }, [screen]);
  // Música do menu em toda tela fora da mesa (a mesa troca para a música da partida ao abrir).
  const inMatch =
    screen.name === 'game' || screen.name === 'online' || screen.name === 'watch' || screen.name === 'lesson' || screen.name === 'daily' || screen.name === 'yonko-game' || screen.name === 'yonko-online';
  useEffect(() => {
    if (!inMatch) audio.music('menu');
  }, [inMatch]);
  const settings = useSettings();
  const user = useAuth().user;
  const role = user?.role;
  // Progresso do tutorial: junta navegador e servidor ao abrir e quando a conta muda.
  useEffect(() => {
    void syncTutorialProgress();
  }, [user?.id]);
  // Na mesa (jogando, assistindo ou vendo um replay), a tela do celular não apaga.
  useWakeLock(inMatch && settings.keepAwake);
  usePushSync({
    serverKey: settings.pushKey,
    enabled: settings.notify,
    prefs: { locale: settings.locale, matches: settings.notifyMatches, tournaments: settings.notifyTournaments, friends: settings.notifyFriends },
    userId: user?.id ?? null,
    onRevoked: () => settings.update({ notify: false }),
  });

  // Toque numa notificação: abre a partida online (se ainda estiver aberta) ou a página do
  // torneio. Com o app fechado, o endereço chega na URL; com ele aberto, numa mensagem do service worker.
  useEffect(() => {
    const open = (href: string) => {
      const url = new URL(href, location.origin);
      const room = url.searchParams.get(ROOM_PARAM);
      const tournament = url.searchParams.get(TOURNAMENT_PARAM);
      if (room) {
        api.online
          .active()
          .then((rooms) => {
            const r = rooms.find((x) => x.roomId === room);
            if (r) setScreen((s) => (s.name === 'online' && s.seat.roomId === r.roomId ? s : { name: 'online', seat: { roomId: r.roomId, token: r.token } }));
          })
          .catch(() => undefined);
      } else if (tournament) setScreen({ name: 'tournaments', id: tournament, lobby: url.searchParams.get('lobby') === '1' });
      // Amigos: link para adicionar, aviso de pedido e convite para a sala de um amigo (no meio de uma partida online, fica nela).
      const friendLink = friendLinkFrom(url);
      if (friendLink) setScreen((s) => (s.name === 'online' ? s : { name: 'menu', friendLink }));
    };
    const here = new URL(location.href);
    if (here.searchParams.has(ROOM_PARAM) || here.searchParams.has(TOURNAMENT_PARAM) || friendLinkFrom(new URL(here.href))) {
      open(here.href);
      friendLinkFrom(here);
      here.searchParams.delete(ROOM_PARAM);
      here.searchParams.delete(TOURNAMENT_PARAM);
      here.searchParams.delete('lobby');
      history.replaceState(null, '', here.toString());
    }
    // Convite para uma mesa do Yonko (`/?yonko=CODE`): abre a entrada do Yonko com o código preenchido.
    const yonkoCode = here.searchParams.get('yonko');
    if (yonkoCode) {
      setScreen({ name: 'yonko', code: yonkoCode.slice(0, 6).toUpperCase() });
      here.searchParams.delete('yonko');
      history.replaceState(null, '', here.toString());
    }
    // Desafio do dia (`/?desafio`, o link do resultado compartilhado).
    if (here.searchParams.has(DAILY_PARAM)) {
      setScreen({ name: 'daily' });
      here.searchParams.delete(DAILY_PARAM);
      history.replaceState(null, '', here.toString());
    }
    // Perfil público (`/?perfil=<id>`): abre a página do jogador.
    if (here.searchParams.has(PROFILE_PARAM)) {
      const profile = parseProfileParam(here.searchParams);
      if (profile) setScreen({ name: 'profile', id: profile });
      here.searchParams.delete(PROFILE_PARAM);
      history.replaceState(null, '', here.toString());
    }
    // Deep link do construtor (`/?deck=<lista>&name=&format=`): abre o construtor preenchido, sem salvar nada.
    if (here.searchParams.has('deck')) {
      const { link, invalid } = parseDeckLink(here.searchParams);
      setScreen({ name: 'builder', ...(link ? { link } : {}), ...(invalid ? { linkInvalid: true } : {}) });
      for (const p of DECK_LINK_PARAMS) here.searchParams.delete(p);
      history.replaceState(null, '', here.toString());
    }
    // Link do Sandbox de regras (`/?sandbox=<mesa>`): abre o editor com a mesa, sem jogar nada sozinho.
    if (here.searchParams.has(SANDBOX_PARAM)) {
      const { spec, invalid } = parseSandboxLink(here.searchParams);
      setScreen({ name: 'sandbox', ...(spec ? { spec } : {}), ...(invalid ? { linkInvalid: true } : {}) });
      here.searchParams.delete(SANDBOX_PARAM);
      history.replaceState(null, '', here.toString());
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'gumgum:open' && typeof e.data.url === 'string') open(e.data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  const dev = isDev(role);
  /**
   * Entrar numa seção a partir do menu (`dir` 1) e voltar dela (−1): a tela vira como página (screenTurn.ts).
   * Só com as animações completas; com as suaves e as desligadas a tela troca na hora, como as outras.
   */
  const flip = (dir: 1 | -1, next: Screen) => (settings.animations === 'full' && canTurnScreen() ? turnScreen(dir, () => setScreen(next)) : setScreen(next));
  if (screen.name === 'builder') {
    return (
      <DeckBuilder
        onExit={() => (screen.back ? setScreen(screen.back) : flip(-1, { name: 'menu' }))}
        link={screen.link}
        linkInvalid={screen.linkInvalid}
        openId={screen.open}
        startYonko={screen.yonko}
      />
    );
  }
  if (screen.name === 'daily') return <DailyChallenge onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'learn') {
    return (
      <Learn
        onExit={() => flip(-1, { name: 'menu' })}
        onLesson={(id) => setScreen({ name: 'lesson', id })}
        onSandbox={() => setScreen({ name: 'sandbox', from: 'learn' })}
      />
    );
  }
  if (screen.name === 'sandbox') {
    const back: Screen = screen.from === 'learn' ? { name: 'learn' } : { name: 'menu' };
    return (
      <Sandbox
        initial={screen.spec}
        linkInvalid={screen.linkInvalid}
        onExit={() => setScreen(back)}
        onPlay={(setup, spec) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'sandbox', spec, from: screen.from } })}
      />
    );
  }
  if (screen.name === 'lesson') {
    return (
      <Lesson
        key={screen.id}
        id={screen.id}
        onHub={() => setScreen({ name: 'learn' })}
        onLesson={(id) => setScreen({ name: 'lesson', id })}
        onBuildDecks={() => setScreen({ name: 'builder' })}
      />
    );
  }
  if (screen.name === 'coverage' && dev) return <Coverage onExit={() => setScreen({ name: 'menu' })} />;
  if (screen.name === 'stats') {
    return (
      <Stats
        onExit={() => flip(-1, { name: 'menu' })}
        onOpenDeck={(link) => setScreen({ name: 'builder', link })}
        onProfile={(id) => setScreen({ name: 'profile', id, back: { name: 'stats' } })}
      />
    );
  }
  if (screen.name === 'profile') {
    return (
      <PublicProfile
        key={screen.id}
        id={screen.id}
        onExit={() => setScreen(screen.back ?? { name: 'menu' })}
        onReplay={(setup) => setScreen({ name: 'game', setup, key: Date.now(), back: screen })}
        onOpenDeck={(link) => setScreen({ name: 'builder', link, back: screen })}
      />
    );
  }
  if (screen.name === 'admin' && isAdmin(role)) {
    return (
      <Admin
        onExit={() => setScreen({ name: 'menu' })}
        onReplay={(setup) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'admin' } })}
      />
    );
  }
  if (screen.name === 'team' && isTeam(user)) {
    return (
      <TeamBot
        admin={isAdmin(role)}
        onExit={() => setScreen({ name: 'menu' })}
        onReplay={(setup) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'team' } })}
      />
    );
  }
  if (screen.name === 'tournaments') {
    return (
      <Tournaments
        key={`${screen.id ?? ''}:${screen.lobby ? 'lobby' : ''}`}
        initialId={screen.id}
        initialLobby={screen.lobby}
        onExit={() => flip(-1, { name: 'menu' })}
        onPlay={(seat, tournament, lobby) => setScreen({ name: 'online', seat, tournament, ...(lobby ? { lobby } : {}) })}
        onWatch={(target, tournament, lobby) => setScreen({ name: 'watch', target, tournament, ...(lobby ? { lobby } : {}) })}
        onReplay={(setup, tournament) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'tournaments', id: tournament } })}
      />
    );
  }
  if (screen.name === 'watch-list') {
    return <Watch onExit={() => setScreen({ name: 'menu' })} onWatch={(target) => setScreen({ name: 'watch', target })} />;
  }
  if (screen.name === 'watch') {
    return (
      <WatchGameScreen
        key={screen.target.roomId}
        target={screen.target}
        canHands={seesHands(role)}
        exitTo={screen.tournament ? 'tournament' : screen.home ? 'menu' : 'back'}
        onExit={() =>
          setScreen(
            screen.tournament ? { name: 'tournaments', id: screen.tournament, lobby: screen.lobby } : screen.home ? { name: 'menu' } : { name: 'watch-list' },
          )
        }
        onSwitch={(target) => setScreen({ ...screen, target })}
      />
    );
  }
  if (screen.name === 'online') {
    return (
      <OnlineGameScreen
        key={screen.seat.roomId}
        seat={screen.seat}
        onExit={() =>
          setScreen(
            screen.tournament ? { name: 'tournaments', id: screen.tournament, lobby: screen.lobby } : screen.sealed ? { name: 'sealed', pool: screen.sealed } : { name: 'menu' },
          )
        }
        onSwitch={(seat) => setScreen({ ...screen, seat })}
      />
    );
  }
  if (screen.name === 'sealed') {
    return (
      <Sealed
        key={screen.pool ?? `hub-${screen.hub ?? 'sealed'}`}
        openId={screen.pool}
        hub={screen.hub}
        onExit={() => setScreen({ name: 'menu' })}
        onStart={(setup, pool) => setScreen({ name: 'game', setup, key: Date.now(), back: { name: 'sealed', pool } })}
        onOnline={(seat, pool) => setScreen({ name: 'online', seat, sealed: pool })}
        onDraft={(pod) => setScreen({ name: 'draft', pod })}
      />
    );
  }
  if (screen.name === 'draft') {
    return <Draft key={screen.pod} podId={screen.pod} onExit={() => setScreen({ name: 'sealed', hub: 'draft' })} onBuild={(pool) => setScreen({ name: 'sealed', pool })} />;
  }
  if (screen.name === 'yonko') {
    return (
      <Yonko
        again={screen.again}
        code={screen.code}
        onOnline={(seat) => setScreen({ name: 'yonko-online', seat })}
        onExit={() => setScreen({ name: 'menu' })}
        onBuildDecks={() => setScreen({ name: 'builder', yonko: true, back: { name: 'yonko' } })}
        onStart={(setup) => setScreen({ name: 'yonko-game', setup, key: Date.now() })}
      />
    );
  }
  if (screen.name === 'yonko-online') {
    return (
      <YonkoOnline
        key={screen.seat.id}
        seat={screen.seat}
        onExit={() => setScreen({ name: 'yonko' })}
        onBuildDecks={() => setScreen({ name: 'builder', yonko: true, back: { name: 'yonko-online', seat: screen.seat } })}
      />
    );
  }
  if (screen.name === 'yonko-game') {
    const { setup } = screen;
    return <LocalYonkoTable key={screen.key} setup={setup} onExit={() => setScreen({ name: 'yonko' })} onRematch={() => setScreen({ name: 'yonko', again: setup })} />;
  }
  if (screen.name === 'game') {
    const { setup } = screen;
    return (
      <GameScreen
        key={screen.key}
        setup={setup}
        onExit={() => setScreen(screen.back ?? { name: 'menu' })}
        onRematch={
          setup.mode === 'replay'
            ? undefined
            : (next) =>
                setScreen({
                  name: 'game',
                  key: Date.now(),
                  setup: next ?? { ...setup, notice: undefined, config: { ...setup.config, seed: Math.floor(Math.random() * 1_000_000) } },
                })
        }
      />
    );
  }
  return (
    <Menu
      onStart={(setup) => setScreen({ name: 'game', setup, key: Date.now() })}
      onBuildDecks={(id) => flip(1, { name: 'builder', ...(id ? { open: id } : {}) })}
      onLearn={() => flip(1, { name: 'learn' })}
      onSandbox={() => setScreen({ name: 'sandbox' })}
      onDaily={() => setScreen({ name: 'daily' })}
      onCoverage={dev ? () => setScreen({ name: 'coverage' }) : undefined}
      onStats={() => flip(1, { name: 'stats' })}
      onOnline={(seat) => setScreen({ name: 'online', seat })}
      onWatch={() => setScreen({ name: 'watch-list' })}
      onWatchRoom={(target) => setScreen({ name: 'watch', target, home: true })}
      onTournaments={(id) => flip(1, { name: 'tournaments', id })}
      onTournamentMatch={(seat, tournament) => setScreen({ name: 'online', seat, tournament })}
      onAdmin={isAdmin(role) ? () => setScreen({ name: 'admin' }) : undefined}
      onTeamBot={isTeam(user) ? () => setScreen({ name: 'team' }) : undefined}
      onSealed={() => setScreen({ name: 'sealed', hub: 'sealed' })}
      onDraft={() => setScreen({ name: 'sealed', hub: 'draft' })}
      onYonko={() => setScreen({ name: 'yonko' })}
      dev={dev}
      friendLink={screen.name === 'menu' ? screen.friendLink : undefined}
    />
  );
}
