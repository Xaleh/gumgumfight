// Homologação só para apoiadores (ACCESS=supporters no servidor): quem não tem o plano
// Tripulante ou acima vê esta tela no lugar do site.

import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api';
import { GoogleButton, useAuth } from '../auth';
import { useT } from '../i18n';

type Access = Awaited<ReturnType<typeof api.access>>;

export function AccessGate({ children }: { children: ReactNode }) {
  const { ready, user, clientId, config, signIn, signOut, error } = useAuth();
  const t = useT();
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
  if (!access) return <div className="access-gate muted">{t('access.checking')}</div>;

  const home = access.homeUrl;
  return (
    <div className="access-gate">
      <div className="access-card">
        <img src="/brand/header-mark.svg" alt="" width={56} height={56} />
        <h1>{t('access.title')}</h1>
        <p>{t('access.body')}</p>
        {access.reason === 'login' && (clientId ? <GoogleButton clientId={clientId} onCredential={signIn} /> : <p className="muted">{t('access.loginOff')}</p>)}
        {access.reason === 'denied' && <p className="muted small">{t('access.denied', { email: user?.email ?? '' })}</p>}
        {access.reason === 'unverified' && <p className="muted small">{t('access.unverified')}</p>}
        {error && <p className="error">{error}</p>}
        <div className="btn-row center">
          {home && (
            <a className="btn primary" href={home} rel="noopener">
              {t('access.goHome')}
            </a>
          )}
          {user && (
            <button className="btn" onClick={() => void signOut()}>
              {t('access.signOut')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
