import { type Action, type CardData, type DeckList, FORMATS, formatLabel, type PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { type ActiveRoom, api, canPlay, deckGroups, type DeckSummary, type FormatId, type OnlineSeat, whyNotPlayable } from '../api';
import { AccountBar, useAuth } from '../auth';
import type { GameMode, GameSetup, ReplayFile } from '../game/useGame';
import { SettingsControls } from '../settings';
import { LeaderArt } from './LeaderArt';
import { OnlineMenu, roomCodeFromUrl } from './OnlineMenu';

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
  return {
    mode,
    deckIds,
    format,
    script,
    config: {
      seed,
      ...(online ? { seed128: online.seed128 } : {}),
      firstPlayer,
      cards: [...cards.values()],
      players: [
        { name: names[0], deck: a.deck, isBot: mode === 'demo' },
        { name: names[1], deck: b.deck, isBot: mode !== 'replay' },
      ],
    },
  };
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

function DeckPick({
  who,
  deck,
  random,
  format,
  onClick,
}: {
  who: string;
  deck?: DeckSummary;
  random?: boolean;
  format: FormatId;
  onClick: () => void;
}) {
  return (
    <button className="deck-pick" onClick={onClick}>
      <span className="who">{who}</span>
      <DeckArt deck={random ? undefined : deck} />
      <span className="name">{random ? 'Aleatório' : (deck?.name ?? 'Escolher deck')}</span>
      {!random && <FormatWarning deck={deck} format={format} />}
      {!random && <DeckWarning deck={deck} />}
    </button>
  );
}

/** Aviso de deck que não vale no formato escolhido (cartas banidas ou rotacionadas). */
function FormatWarning({ deck, format }: { deck?: DeckSummary; format: FormatId }) {
  if (!deck?.valid || canPlay(deck, format)) return null;
  return (
    <div className="small deck-warning bad" title={whyNotPlayable(deck, format) ?? undefined}>
      🚫 Não permitido no {formatLabel(format)}
    </div>
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
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
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

function DeckWarning({ deck }: { deck?: DeckSummary }) {
  if (!deck || !deck.unscripted) return null;
  return (
    <div className="muted small deck-warning" title="Essas cartas entram no jogo, mas sem o efeito">
      ⚙ {deck.unscripted} sem efeito automático
    </div>
  );
}

export function Menu({
  onStart,
  onBuildDecks,
  onCoverage,
  onStats,
  onOnline,
  onWatch,
  onTournaments,
  onAdmin,
}: {
  onStart: (s: GameSetup) => void;
  onOnline: (s: OnlineSeat) => void;
  onBuildDecks: () => void;
  onCoverage: () => void;
  onStats: () => void;
  /** Lista de partidas online para assistir (modo espectador). */
  onWatch: () => void;
  onTournaments: () => void;
  /** Perfis das contas (só para admin). */
  onAdmin?: () => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Exclude<GameMode, 'replay'> | 'online'>(URL_ROOM_CODE ? 'online' : 'bot');
  const [deck0, setDeck0] = useState('');
  const [deck1, setDeck1] = useState('');
  const [seed, setSeed] = useState(randomSeed());
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  const [format, setFormat] = useState<FormatId>(savedFormat);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<null | 0 | 1>(null);
  const userId = useAuth().user?.id;
  /** Treino contra o bot no servidor (fase de testes do modo espectador): a partida pode ser assistida. */
  const [botRooms, setBotRooms] = useState(false);
  const [onServer, setOnServer] = useState(false);
  /** Partida online (ou treino contra o bot do servidor) ainda em andamento: atalho para voltar. */
  const [resume, setResume] = useState<ActiveRoom | null>(null);
  useEffect(() => {
    api.online
      .active()
      .then((rooms) => setResume(rooms.find((r) => r.status === 'playing') ?? null))
      .catch(() => undefined);
  }, [userId]);
  useEffect(() => {
    api.online
      .config()
      .then((c) => setBotRooms(c.botRooms))
      .catch(() => undefined);
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

  const start = async () => {
    setLoading(true);
    try {
      localStorage.setItem(LAST_DECKS, JSON.stringify([deck0, deck1]));
      localStorage.setItem(LAST_FORMAT, format);
    } catch {
      /* sem armazenamento */
    }
    try {
      const names: [string, string] = mode === 'demo' ? ['Bot A', 'Bot B'] : ['Você', 'Bot'];
      const pool = decks.filter((d) => canPlay(d, format) && d.kind === 'builtin');
      if (deck1 === RANDOM && !pool.length) throw new Error(`Nenhum deck pronto é permitido no ${formatLabel(format)}.`);
      const opp = deck1 === RANDOM ? pool[Math.floor(Math.random() * pool.length)].id : deck1;
      if (mode === 'online') return;
      if (mode === 'bot' && botRooms && onServer) {
        onOnline(await api.online.botRoom(deck0, opp, format));
        return;
      }
      onStart(await buildSetup(mode, [deck0, opp], names, seed, format, first === 'random' ? undefined : (Number(first) as PlayerId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const loadReplay = async (file: File) => {
    try {
      const r = JSON.parse(await file.text()) as ReplayFile;
      if (r.format !== 'gumgumfight-replay') throw new Error('Arquivo não é um replay do GumGum Fight.');
      const online = r.seed128 && r.decks ? { seed128: r.seed128, decks: r.decks } : undefined;
      onStart(await buildSetup('replay', r.deckIds, r.names, r.seed, 'standard', r.firstPlayer, r.actions, online));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const d0 = decks.find((d) => d.id === deck0);
  const d1 = decks.find((d) => d.id === deck1);
  /** Os dois decks precisam valer no formato escolhido. */
  const ready = Boolean(d0 && canPlay(d0, format) && (deck1 === RANDOM || (d1 && canPlay(d1, format))));

  return (
    <div className="menu">
      <div className="menu-box">
        <header className="menu-hero">
          <h1 className="logo">
            GumGum <span>Fight</span>
          </h1>
          <p className="tagline">One Piece Card Game no navegador</p>
        </header>

        {error && <div className="error">{error}</div>}

        <AccountBar />

        {resume && mode !== 'online' && (
          <div className="online-active">
            <span>
              {resume.queue === 'bot'
                ? 'Você tem um treino contra o bot em andamento.'
                : resume.queue === 'tournament'
                  ? 'Você tem uma partida de torneio em andamento.'
                  : 'Você tem uma partida online em andamento.'}
            </span>
            <button className="btn primary" onClick={() => onOnline(resume)}>
              Voltar à partida
            </button>
          </div>
        )}

        <section className="menu-card">
          <div className="seg">
            <button className={mode === 'bot' ? 'on' : ''} onClick={() => setMode('bot')}>
              Contra o bot
            </button>
            <button className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>
              Bot x Bot
            </button>
            <button className={mode === 'online' ? 'on' : ''} onClick={() => setMode('online')}>
              Online
            </button>
          </div>

          {mode === 'online' ? (
            <>
              <div className="matchup single">
                <DeckPick who="Seu deck" deck={d0} format={format} onClick={() => setPicking(0)} />
              </div>
              <div className="field">
                <label>Formato</label>
                <div className="seg small">
                  {FORMATS.map((f) => (
                    <button key={f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <OnlineMenu
                deck={d0?.valid ? d0 : undefined}
                formatProblem={d0?.valid && !canPlay(d0, format) ? `Este deck não é permitido no ${formatLabel(format)}.` : null}
                format={format}
                initialCode={URL_ROOM_CODE}
                onEnter={(s) => {
                  try {
                    localStorage.setItem(LAST_DECKS, JSON.stringify([deck0, deck1]));
                    localStorage.setItem(LAST_FORMAT, format);
                  } catch {
                    /* sem armazenamento */
                  }
                  onOnline(s);
                }}
              />
            </>
          ) : (
          <>
          <div className="matchup">
            <DeckPick who={mode === 'demo' ? 'Bot A' : 'Seu deck'} deck={d0} format={format} onClick={() => setPicking(0)} />
            <span className="vs-badge">VS</span>
            <DeckPick
              who={mode === 'demo' ? 'Bot B' : 'Oponente'}
              deck={d1}
              random={deck1 === RANDOM}
              format={format}
              onClick={() => setPicking(1)}
            />
          </div>

          <div className="field">
            <label>Quem começa</label>
            <div className="seg small">
              {(
                [
                  ['random', 'Sorteio'],
                  ['0', mode === 'demo' ? 'Bot A' : 'Você'],
                  ['1', mode === 'demo' ? 'Bot B' : 'Bot'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={first === v ? 'on' : ''} onClick={() => setFirst(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Formato</label>
            <div className="seg small">
              {FORMATS.map((f) => (
                <button key={f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {format === 'standard' ? (
              <p className="muted small">Sem cartas banidas nem cartas com o bloco ① (rotacionadas), salvo as exceções oficiais.</p>
            ) : (
              <p className="muted small">Todas as cartas lançadas, menos as banidas.</p>
            )}
          </div>

          {mode === 'bot' && botRooms && (
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={onServer} onChange={(e) => setOnServer(e.target.checked)} /> Jogar no servidor (outras
                pessoas podem assistir)
              </label>
              {onServer && (
                <p className="muted small">
                  Modo de teste do espectador: o bot joga no servidor e a partida aparece em "Assistir partidas". Tem relógio como
                  as partidas online; desfazer, pausa e "Auto" não ficam disponíveis.
                </p>
              )}
            </div>
          )}

          <button className="btn primary battle-btn" disabled={!ready || loading} onClick={start}>
            {loading ? 'Carregando…' : 'Batalhar!'}
          </button>
          </>
          )}
        </section>

        <div className="menu-links">
          <button className="btn" onClick={onWatch}>
            <span className="ico">👁</span>
            Assistir partidas
          </button>
          <button className="btn" onClick={onTournaments}>
            <span className="ico">🏆</span>
            Torneios
          </button>
          {onAdmin && (
            <button className="btn" onClick={onAdmin}>
              <span className="ico">🛡</span>
              Perfis das contas
            </button>
          )}
          <button className="btn" onClick={onBuildDecks}>
            <span className="ico">🃏</span>
            Montar decks
          </button>
          <button className="btn" onClick={onStats}>
            <span className="ico">📈</span>
            Estatísticas
          </button>
          <button className="btn" onClick={onCoverage}>
            <span className="ico">📊</span>
            Cobertura das cartas
          </button>
        </div>

        <section className="menu-card">
          <h2>Configurações</h2>
          <SettingsControls />
        </section>

        <details className="menu-card advanced">
          <summary>Opções de teste</summary>
          <div className="field">
            <label>Seed do embaralhamento</label>
            <div className="seed">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              <button className="btn small" onClick={() => setSeed(randomSeed())} title="Sortear outra">
                🎲
              </button>
            </div>
            <p className="muted small">
              Número que define a ordem dos decks e o sorteio de quem começa. A mesma seed com as mesmas jogadas repete a
              partida exatamente, o que é útil para reproduzir um problema. Para jogar normalmente, ignore este campo.
            </p>
          </div>
          <label className="replay-load">
            Carregar um replay (.json baixado durante uma partida)
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && loadReplay(e.target.files[0])} />
          </label>
        </details>

        <p className="disclaimer">
          Projeto de fã, sem fins lucrativos e sem vínculo com a Bandai, Toei Animation ou Shueisha. As traduções para
          português são automáticas e não oficiais.
        </p>
      </div>

      {picking !== null && (
        <DeckPicker
          title={picking === 0 ? (mode === 'demo' ? 'Deck do Bot A' : 'Seu deck') : mode === 'demo' ? 'Deck do Bot B' : 'Deck do oponente'}
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
