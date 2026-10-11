// Convite para instalar o app na tela de início (PWA): no Chrome/Android, um botão que abre
// o pedido do navegador; no iPhone/iPad, o caminho pelo botão Compartilhar do Safari.

import { useState } from 'react';
import { useT } from '../i18n';
import { isTouchDevice, promptInstall, useInstallMode } from '../pwa';
import { Icon } from './Icons';

const DISMISSED = 'gumgum.installDismissed';
/** "Agora não" esconde o convite por este tempo. */
const DISMISS_MS = 30 * 24 * 3600_000;

function dismissedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED) ?? 0) < DISMISS_MS;
  } catch {
    return false;
  }
}

export function InstallButton({ className = 'btn small primary' }: { className?: string }) {
  const t = useT();
  return (
    <button type="button" className={className} onClick={() => void promptInstall()}>
      {t('install.button')}
    </button>
  );
}

/** Faixa do menu inicial (só em celular/tablet, fora do app instalado e se não foi dispensada há pouco). */
export function InstallBanner() {
  const t = useT();
  const mode = useInstallMode();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (hidden || !isTouchDevice() || (mode !== 'prompt' && mode !== 'ios')) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, String(Date.now()));
    } catch {
      /* vale só nesta visita */
    }
    setHidden(true);
  };
  const [before, after] = t('install.iosText').split('{share}');
  return (
    <div className="home-banner install-banner" role="region" aria-label={t('install.title')}>
      <span className="play-ico">
        <Icon name="phone" size={18} />
      </span>
      <div className="home-banner-text">
        <strong>{t('install.title')}</strong>
        {mode === 'ios' ? (
          <span>
            {before}
            <span className="install-share" aria-label={t('install.share')}>
              <Icon name="share" size={16} />
            </span>
            {after}
          </span>
        ) : (
          <span>{t('install.text')}</span>
        )}
      </div>
      <div className="install-actions">
        <button type="button" className="btn" onClick={dismiss}>
          {t('install.dismiss')}
        </button>
        {mode === 'prompt' && <InstallButton className="btn primary" />}
      </div>
    </div>
  );
}
