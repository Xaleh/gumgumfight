// Login com conta Google (Google Identity Services). O botão entrega um ID token,
// que o servidor confere e troca por uma sessão em cookie httpOnly.

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { api, ROLE_LABEL, type User } from './api';

interface GsiButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  locale?: string;
  width?: number;
}

interface Gsi {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup'; auto_select?: boolean }): void;
      renderButton(el: HTMLElement, o: GsiButtonOptions): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: Gsi;
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise: Promise<Gsi> | null = null;

/** Carrega o script do Google uma vez só (e só quando o login está ligado no servidor). */
function loadGsi(): Promise<Gsi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  return (gsiPromise ??= new Promise<Gsi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google indisponível')));
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error('Não foi possível carregar o login do Google.'));
    };
    document.head.appendChild(s);
  }));
}

interface AuthCtx {
  /** Já sabemos se há sessão? */
  ready: boolean;
  user: User | null;
  /** Client ID do Google; null = login desligado no servidor. */
  clientId: string | null;
  /** Aviso depois do login (ex.: decks trazidos do navegador). */
  notice: string | null;
  error: string | null;
  signIn: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Relê a sessão no servidor (ex.: depois de mudar o próprio perfil). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // O servidor pode ainda estar subindo: tenta algumas vezes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = (attempt: number) =>
      Promise.all([api.config(), api.me()])
        .then(([config, me]) => {
          if (cancelled) return;
          setClientId(config.googleClientId);
          setUser(me.user);
          setReady(true);
        })
        .catch(() => {
          if (!cancelled && attempt < 15) timer = setTimeout(() => load(attempt + 1), 2000);
        });
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const signIn = async (credential: string) => {
    try {
      const r = await api.googleLogin(credential);
      setUser(r.user);
      setError(null);
      setNotice(
        r.claimedDecks
          ? `${r.claimedDecks === 1 ? '1 deck deste navegador foi' : `${r.claimedDecks} decks deste navegador foram`} para a sua conta.`
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const refresh = async () => {
    const me = await api.me();
    setUser(me.user);
  };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    window.google?.accounts.id.disableAutoSelect();
    setUser(null);
    setNotice(null);
  };

  return (
    <AuthContext.Provider value={{ ready, user, clientId, notice, error, signIn, signOut, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

/** Botão oficial "Fazer login com o Google". */
function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (c: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then((gsi) => {
        if (cancelled || !box.current) return;
        gsi.accounts.id.initialize({ client_id: clientId, ux_mode: 'popup', callback: (r) => handler.current(r.credential) });
        gsi.accounts.id.renderButton(box.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          locale: 'pt-BR',
          width: Math.min(320, box.current.clientWidth || 320),
        });
      })
      .catch((e) => !cancelled && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return failed ? <div className="muted small">{failed}</div> : <div ref={box} className="google-btn" />;
}

/** Faixa da conta no menu: botão de login ou foto, nome e "Sair". */
export function AccountBar() {
  const { ready, user, clientId, notice, error, signIn, signOut } = useAuth();
  if (!ready || !clientId) return null;
  return (
    <section className="menu-card account">
      {user ? (
        <div className="account-row">
          {user.picture ? (
            <img className="account-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="account-avatar">{(user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()}</span>
          )}
          <span className="account-who">
            <strong>
              {user.name ?? 'Conta Google'}
              {user.role !== 'player' && <span className={['role-tag', user.role].join(' ')}>{ROLE_LABEL[user.role]}</span>}
            </strong>
            {user.email && <span className="muted small">{user.email}</span>}
          </span>
          <button className="btn small" onClick={signOut}>
            Sair
          </button>
        </div>
      ) : (
        <div className="account-login">
          <p className="muted small">Entre com o Google para guardar seus decks e estatísticas na sua conta e usá-los em qualquer aparelho.</p>
          <GoogleButton clientId={clientId} onCredential={signIn} />
        </div>
      )}
      {notice && <p className="small account-notice">{notice}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
