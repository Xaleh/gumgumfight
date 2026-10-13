// Homologação só para apoiadores (ACCESS=supporters no servidor): quem não tem o plano
// Tripulante ou acima vê esta tela no lugar do site.

import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api';
import { GoogleButton, useAuth } from '../auth';

type Access = Awaited<ReturnType<typeof api.access>>;

export function AccessGate({ children }: { children: ReactNode }) {
  const { ready, user, clientId, config, signIn, signOut, error } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const gated = config?.access === 'supporters';

  useEffect(() => {
    if (!gated) return;
    let stop = false;
    api
      .access()
      .then((a) => !stop && setAccess(a))
      .catch(() => !stop && setAccess(null));
    return () => {
      stop = true;
    };
  }, [gated, user?.id]);

  if (!ready || !gated || access?.allowed) return <>{children}</>;
  if (!access) return <div className="access-gate muted">Verificando o acesso…</div>;

  const home = access.homeUrl;
  return (
    <div className="access-gate">
      <div className="access-card">
        <img src="/brand/header-mark.svg" alt="" width={56} height={56} />
        <h1>Ambiente dos apoiadores</h1>
        <p>
          Aqui as novidades do GumGum Fight chegam antes de todo mundo. O acesso é um benefício dos planos <b>Tripulante</b>, <b>Capitão</b> e{' '}
          <b>Almirante</b>.
        </p>
        {access.reason === 'login' && (clientId ? <GoogleButton clientId={clientId} onCredential={signIn} /> : <p className="muted">O login está desligado.</p>)}
        {access.reason === 'denied' && (
          <p className="muted small">
            Sua conta ({user?.email}) ainda não tem um plano que libera este ambiente. Se acabou de assinar, espere alguns minutos e recarregue a
            página.
          </p>
        )}
        {access.reason === 'unverified' && <p className="muted small">O Google não confirmou o e-mail desta conta: entre com outra conta.</p>}
        {error && <p className="error">{error}</p>}
        <div className="btn-row center">
          {home && (
            <a className="btn primary" href={home} rel="noopener">
              Ir para o site e ver os planos
            </a>
          )}
          {user && (
            <button className="btn" onClick={() => void signOut()}>
              Sair
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
