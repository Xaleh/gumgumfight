// "Apps conectados" (em Configurações): tokens pessoais para apps parceiros e apps vinculados
// pelo OAuth. O token aparece uma vez só, logo depois de gerado; a lista nunca o mostra.

import { useCallback, useEffect, useState } from 'react';
import { api, type ConnectedToken, type TokenScope } from '../api';
import { useAuth } from '../auth';
import { type MessageKey, useLocale, useT } from '../i18n';

export const SCOPE_LABEL: Record<TokenScope, MessageKey> = {
  profile: 'settings.scope.profile',
  'decks:read': 'settings.scope.decks:read',
  'decks:write': 'settings.scope.decks:write',
  'matches:read': 'settings.scope.matches:read',
  'stats:read': 'settings.scope.stats:read',
};

/** Marcadas por padrão: tudo, menos escrever decks (o usuário marca de propósito). */
const DEFAULT_SCOPES: TokenScope[] = ['profile', 'decks:read', 'matches:read', 'stats:read'];
const MAX_TOKENS = 10;

export function ConnectedApps() {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const [data, setData] = useState<{ scopes: TokenScope[]; tokens: ConnectedToken[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<TokenScope>>(() => new Set(DEFAULT_SCOPES));
  const [busy, setBusy] = useState(false);
  /** Token recém-gerado: mostrado uma vez. */
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    if (!user) return;
    api.tokens
      .list()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  useEffect(() => {
    setData(null);
    setFresh(null);
    reload();
  }, [reload]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  const generate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api.tokens.create(name.trim(), [...scopes]);
      setFresh({ id: created.id, token: created.token });
      setCopied(false);
      setName('');
      setError(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (tk: ConnectedToken) => {
    if (!window.confirm(t('settings.tokenRevokeConfirm', { name: tk.name ?? tk.id }))) return;
    try {
      await api.tokens.revoke(tk.id);
      if (fresh?.id === tk.id) setFresh(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = () => {
    if (!fresh) return;
    navigator.clipboard
      ?.writeText(fresh.token)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  if (!user) return <p className="muted small apps-login">{t('settings.appsLogin')}</p>;
  const personal = data?.tokens.filter((x) => x.kind === 'personal').length ?? 0;
  return (
    <div className="apps-section">
      {fresh && (
        <div className="token-box" role="status">
          <div className="small">{t('settings.tokenOnce')}</div>
          <code className="token-text">{fresh.token}</code>
          <div className="token-actions">
            <button type="button" className="btn small primary" onClick={copy}>
              {copied ? t('deck.copied') : t('deck.copy')}
            </button>
            <button type="button" className="btn small" onClick={() => setFresh(null)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
      {data && data.tokens.length === 0 && !fresh && <p className="muted small">{t('settings.appsNone')}</p>}
      {data?.tokens.map((tk) => (
        <div key={tk.id} className="token-row">
          <div className="token-info">
            <b>{tk.name ?? tk.id}</b>
            <span className="muted small">
              {t(tk.kind === 'app' ? 'settings.tokenKindApp' : 'settings.tokenKindPersonal')} · {t('settings.tokenCreated', { date: fmtDate(tk.createdAt) })} ·{' '}
              {tk.lastUsedAt ? t('settings.tokenLastUsed', { date: fmtDate(tk.lastUsedAt) }) : t('settings.tokenNeverUsed')}
            </span>
            <span className="muted small">{tk.scopes.map((sc) => t(SCOPE_LABEL[sc])).join(' · ')}</span>
          </div>
          <button type="button" className="btn small danger" onClick={() => void revoke(tk)}>
            {t('settings.tokenRevoke')}
          </button>
        </div>
      ))}
      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <label className="sheet-label" htmlFor="token-name">
          {t('settings.tokenName')}
        </label>
        <input id="token-name" value={name} maxLength={40} placeholder={t('settings.tokenNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
        <div className="sheet-label">{t('settings.tokenScopes')}</div>
        {(data?.scopes ?? (Object.keys(SCOPE_LABEL) as TokenScope[])).map((sc) => (
          <label key={sc} className="check">
            <input
              type="checkbox"
              checked={sc === 'profile' || scopes.has(sc)}
              disabled={sc === 'profile'}
              onChange={(e) =>
                setScopes((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(sc);
                  else next.delete(sc);
                  return next;
                })
              }
            />
            {t(SCOPE_LABEL[sc])}
          </label>
        ))}
        <div className="token-actions">
          <button type="submit" className="btn small primary" disabled={!name.trim() || busy || personal >= MAX_TOKENS}>
            {busy ? t('settings.tokenGenerating') : t('settings.tokenGenerate')}
          </button>
          <span className="muted small">{t('settings.tokenLimit', { n: MAX_TOKENS })}</span>
        </div>
      </form>
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
