// Tela de consentimento do OAuth (`/oauth/authorize?…`): o app parceiro mandou o usuário para
// cá; o servidor já conferiu client_id e redirect_uri. Sem login, mostra o botão do Google e,
// depois, volta a esta mesma tela. "Permitir" gera o code e volta ao app.

import { useEffect, useState } from 'react';
import { api, errorMessage, type OAuthConsentInfo } from '../api';
import { GoogleButton, useAuth } from '../auth';
import { useT } from '../i18n';
import { SCOPE_LABEL } from './ConnectedApps';

type ConsentOk = Extract<OAuthConsentInfo, { client: unknown }>;
type ConsentError = Extract<OAuthConsentInfo, { redirect: unknown }>;
const isOk = (i: OAuthConsentInfo): i is ConsentOk => 'client' in i;

export function OAuthConsent({ query }: { query: string }) {
  const t = useT();
  const { ready, user, clientId, signIn } = useAuth();
  const [info, setInfo] = useState<OAuthConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const params = Object.fromEntries(new URLSearchParams(query));

  useEffect(() => {
    if (!ready) return;
    api.oauth
      .consent(query)
      .then((i) => {
        setInfo(i);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [query, ready, user?.id]);

  const decide = async (decision: 'allow' | 'deny') => {
    setLeaving(true);
    try {
      const { redirect } = await api.oauth.decide(params, decision);
      location.assign(redirect);
    } catch (e) {
      setLeaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ok: ConsentOk | null = info && isOk(info) ? info : null;
  const bad: ConsentError | null = info && !isOk(info) ? info : null;
  // Já autorizado com os mesmos scopes: pula a tela.
  useEffect(() => {
    if (ok?.already && user && !leaving) void decide('allow');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok?.already, user?.id]);

  const appName = ok?.client.name ?? '';
  return (
    <div className="oauth-page">
      <div className="sheet oauth-sheet" role="dialog" aria-label={t('oauth.title', { app: appName })}>
        <div className="sheet-head">
          <h3>{t('oauth.title', { app: appName })}</h3>
        </div>
        <div className="sheet-body">
          {!info && !error && <p className="muted small">{t('common.loading')}</p>}
          {error && (
            <p className="warn" role="alert">
              {t('oauth.error', { message: error })}
            </p>
          )}
          {bad && (
            <>
              <p className="warn" role="alert">
                {t('oauth.error', { message: errorMessage(bad, bad.error) })}
              </p>
              {bad.redirect && (
                <a className="btn small" href={bad.redirect}>
                  {t('oauth.back')}
                </a>
              )}
            </>
          )}
          {ok && (
            <>
              <p>{t('oauth.intro', { app: ok.client.name })}</p>
              <ul className="oauth-scopes">
                {ok.scopes.map((sc) => (
                  <li key={sc}>{t(SCOPE_LABEL[sc])}</li>
                ))}
              </ul>
              {user ? (
                leaving ? (
                  <p className="muted small">{t('oauth.working', { app: ok.client.name })}</p>
                ) : (
                  <div className="oauth-actions">
                    <button type="button" className="btn primary" onClick={() => void decide('allow')}>
                      {t('oauth.allow')}
                    </button>
                    <button type="button" className="btn" onClick={() => void decide('deny')}>
                      {t('oauth.cancel')}
                    </button>
                  </div>
                )
              ) : clientId ? (
                <div className="oauth-login">
                  <p className="muted small">{t('oauth.loginFirst')}</p>
                  <GoogleButton clientId={clientId} onCredential={signIn} />
                </div>
              ) : (
                <p className="muted small">{t('account.loginOff')}</p>
              )}
              <p className="muted small">{t('oauth.note')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
