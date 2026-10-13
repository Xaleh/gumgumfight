// Barra superior do site: logo, seções, contador de conectados, tema e conta.
// No desktop as seções ficam na barra; abaixo de 1024 px elas vão para o menu ☰
// (gaveta lateral), junto com a conta e os atalhos de admin/dev.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ROLE_LABEL, TIER_LABEL } from '../api';
import { GoogleButton, useAuth } from '../auth';
import { LOCALES, useT } from '../i18n';
import { squarePicture } from '../picture';
import { LocaleSeg, useSettings } from '../settings';
import { Flag } from './Flags';
import { Icon, type IconName } from './Icons';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  /** Seção aberta agora. */
  current?: boolean;
}

/** Fecha com Esc (gaveta e menu da conta). */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
}

/** Etapas de aperto da barra, da mais leve à mais forte (ver `useSqueeze`). */
const SQUEEZE_STEPS = ['1', '2', '3', '4'] as const;

/**
 * Aperta a barra quando as seções não cabem ao lado do bloco da direita: esconde a palavra
 * "conectados" (1), o nome da conta (2), os ícones das seções (3) e, por fim, manda as seções
 * para o menu ☰ (4). A largura dos textos muda com o idioma e o nome da conta, então mede em vez
 * de usar um ponto de quebra fixo. Mede a cada render (o contador e o nome mudam), ao mudar a
 * largura da barra e quando as fontes terminam de carregar.
 */
function useSqueeze(innerRef: RefObject<HTMLDivElement>, navRef: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    fit();
  });
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    let lastWidth = inner.clientWidth;
    const ro = new ResizeObserver(() => {
      if (inner.clientWidth === lastWidth) return;
      lastWidth = inner.clientWidth;
      fit();
    });
    ro.observe(inner);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);

  function fit() {
    const inner = innerRef.current;
    const nav = navRef.current;
    if (!inner || !nav) return;
    const fits = () => nav.scrollWidth <= nav.clientWidth;
    delete inner.dataset.squeeze;
    for (const step of SQUEEZE_STEPS) {
      if (fits()) return;
      inner.dataset.squeeze = step;
    }
  }
}

function Avatar() {
  const { user } = useAuth();
  if (user?.picture) {
    return (
      <span className="avatar">
        <img src={user.picture} alt="" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return <span className="avatar">{user ? (user.name ?? user.email ?? '?').slice(0, 1).toUpperCase() : <Icon name="user" size={18} />}</span>;
}

/** Trocar a foto da conta: escolher uma imagem (recortada e reduzida aqui) ou voltar para a do Google. */
function usePictureChange() {
  const { changePicture } = useAuth();
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onFile = (file: File) =>
    run(async () => {
      const image = await squarePicture(file).catch(() => {
        throw new Error(t('account.photoUnreadable'));
      });
      await changePicture(image);
    });
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void onFile(file);
      }}
    />
  );
  return { busy, error, fileInput, pick: () => input.current?.click(), reset: () => run(() => changePicture(null)) };
}

/** Nome, perfil e login/saída da conta (no menu da conta e na gaveta). */
function AccountBlock() {
  const { ready, user, clientId, signIn } = useAuth();
  const t = useT();
  const picture = usePictureChange();
  if (!ready) return null;
  return (
    <div className="account-block">
      {user ? (
        <button
          type="button"
          className="avatar-edit"
          aria-label={t('account.changePhoto')}
          title={t('account.changePhoto')}
          disabled={picture.busy}
          onClick={picture.pick}
        >
          <Avatar />
          <span className="avatar-edit-badge">
            <Icon name="camera" size={12} stroke={2.4} />
          </span>
        </button>
      ) : (
        <Avatar />
      )}
      {user ? (
        <div className="account-who">
          <strong>
            {user.name ?? t('account.google')}
            {user.role !== 'player' && <span className={['role-tag', user.role].join(' ')}>{t(ROLE_LABEL[user.role])}</span>}
            {user.supporter && (
              <span className="supporter-tag" title={t('support.tagTitle')}>
                ❤ {TIER_LABEL[user.supporter.tier]}
              </span>
            )}
          </strong>
          {user.email && <span className="muted small">{user.email}</span>}
          {picture.fileInput}
          <div className="account-photo">
            {picture.busy ? (
              <span className="muted small">{t('account.photoSaving')}</span>
            ) : (
              <>
                <button type="button" className="account-photo-btn" onClick={picture.pick}>
                  {t('account.changePhoto')}
                </button>
                {user.customPicture && (
                  <button type="button" className="account-photo-btn" onClick={() => void picture.reset()}>
                    {t('account.googlePhoto')}
                  </button>
                )}
              </>
            )}
          </div>
          {picture.error && (
            <span className="account-photo-error small" role="alert">
              {picture.error}
            </span>
          )}
        </div>
      ) : clientId ? (
        <div className="account-who">
          <span className="muted small">{t('account.signInHint')}</span>
          <GoogleButton clientId={clientId} onCredential={signIn} />
        </div>
      ) : (
        <div className="account-who">
          <strong>{t('account.guest')}</strong>
          <span className="muted small">{t('account.loginOff')}</span>
        </div>
      )}
    </div>
  );
}

function NavButton({ item, onDone, className }: { item: NavItem; onDone?: () => void; className: string }) {
  return (
    <button
      type="button"
      className={[className, item.current ? 'on' : ''].join(' ')}
      aria-current={item.current ? 'page' : undefined}
      onClick={() => {
        onDone?.();
        item.onClick();
      }}
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
  );
}

function ThemeButton({ className, withLabel }: { className: string; withLabel?: boolean }) {
  const { resolvedTheme, update } = useSettings();
  const t = useT();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'dark' ? 'topbar.themeDark' : 'topbar.themeLight');
  return (
    <button type="button" className={className} aria-label={withLabel ? undefined : label} title={label} onClick={() => update({ theme: next })}>
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={18} />
      {withLabel && label}
    </button>
  );
}

/**
 * Idioma na barra superior: botão com a bandeira atual que abre as seis bandeiras (mesmo padrão do
 * menu da conta). Na gaveta ☰ as bandeiras aparecem direto (`LocaleSeg`).
 */
function LocaleButton({ className }: { className: string }) {
  const { locale } = useSettings();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const name = LOCALES.find((l) => l.code === locale)?.name ?? locale;
  const label = `${t('topbar.language')}: ${name}`;
  return (
    <div className={['locale-wrap', className].join(' ')} ref={ref}>
      <button type="button" className="icon-btn locale-btn" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Flag locale={locale} width={24} />
      </button>
      {open && (
        <div className="locale-pop">
          <LocaleSeg onChange={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SignOutButton({ className, onDone }: { className: string; onDone?: () => void }) {
  const { user, signOut } = useAuth();
  const t = useT();
  if (!user) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onDone?.();
        void signOut();
      }}
    >
      <Icon name="logout" size={18} />
      {t('topbar.signOut')}
    </button>
  );
}

export function TopBar({
  nav,
  extra,
  online,
  onHome,
}: {
  /** Seções principais (na barra no desktop; na gaveta no celular). */
  nav: NavItem[];
  /** Configurações e atalhos de admin/dev (no menu da conta e na gaveta). */
  extra: NavItem[];
  /** Pessoas conectadas agora (null = ainda sem número). */
  online: number | null;
  onHome: () => void;
}) {
  const { user, clientId } = useAuth();
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useSqueeze(innerRef, navRef);
  useEscape(drawer, () => setDrawer(false));
  useEscape(account, () => setAccount(false));

  // Menu da conta: fecha ao clicar fora.
  useEffect(() => {
    if (!account) return;
    const onDown = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccount(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [account]);

  // Gaveta aberta: a página atrás não rola.
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  const onlineLabel = online === null ? t('topbar.counting') : t('topbar.online', { n: online });

  return (
    <header className="topbar">
      <div className="home-wrap topbar-inner" ref={innerRef}>
        <button type="button" className="topbar-logo" onClick={onHome} aria-label={t('topbar.home')}>
          <picture>
            <source media="(max-width: 480px)" srcSet="/brand/header-mark.svg" />
            <img src="/brand/header-logo-dark-bg.svg" alt="" />
          </picture>
        </button>

        <nav className="topbar-nav" ref={navRef} aria-label={t('topbar.nav')}>
          {nav.map((item) => (
            <NavButton key={item.key} item={item} className="topbar-link" />
          ))}
        </nav>

        <div className="topbar-right">
          <div className="live-pill" role="status" aria-label={onlineLabel} title={onlineLabel}>
            <span className={['live-dot', online === null ? 'off' : ''].join(' ')} />
            <span>{online ?? '–'}</span>
            <span className="live-pill-label">{t('topbar.onlineWord', { n: online ?? 0 })}</span>
          </div>
          <LocaleButton className="desktop-only" />
          <ThemeButton className="icon-btn desktop-only" />
          <div className="account-wrap desktop-only" ref={accountRef}>
            <button
              type="button"
              className="account-btn"
              aria-haspopup="true"
              aria-expanded={account}
              onClick={() => setAccount((v) => !v)}
            >
              <Avatar />
              <span className="account-btn-name">{user ? (user.name?.split(' ')[0] ?? t('topbar.account')) : clientId ? t('topbar.signIn') : t('topbar.account')}</span>
              <Icon name="chevron" size={16} />
            </button>
            {account && (
              <div className="account-pop">
                <AccountBlock />
                <div className="nav-list">
                  {extra.map((item) => (
                    <NavButton key={item.key} item={item} className="nav-item" onDone={() => setAccount(false)} />
                  ))}
                  <SignOutButton className="nav-item" onDone={() => setAccount(false)} />
                </div>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn menu-toggle" aria-label={t('topbar.openMenu')} aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" size={22} stroke={2.2} />
          </button>
        </div>
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <nav className="drawer" aria-label={t('topbar.menu')}>
            <div className="drawer-head">
              <img src="/brand/header-mark.svg" alt="" />
              <span>{t('topbar.menu')}</span>
              <button type="button" className="icon-btn" aria-label={t('topbar.closeMenu')} autoFocus onClick={() => setDrawer(false)}>
                <Icon name="close" />
              </button>
            </div>
            <AccountBlock />
            <div className="nav-list">
              {nav.map((item) => (
                <NavButton key={item.key} item={item} className="nav-item" onDone={() => setDrawer(false)} />
              ))}
            </div>
            {extra.length > 0 && (
              <div className="nav-list">
                {extra.map((item) => (
                  <NavButton key={item.key} item={item} className="nav-item" onDone={() => setDrawer(false)} />
                ))}
              </div>
            )}
            <div className="drawer-locale">
              <LocaleSeg flagWidth={28} />
            </div>
            <div className="drawer-foot">
              <ThemeButton className="pill-btn" withLabel />
              <SignOutButton className="pill-btn" onDone={() => setDrawer(false)} />
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
