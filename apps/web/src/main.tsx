import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth';
import { AccessGate } from './components/AccessGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isReplayPath, parseReplayEmbed } from './embed';
import { loadLocale, t } from './i18n';
import { registerServiceWorker } from './pwa';
import { initialLocale, SettingsProvider } from './settings';
import './styles.css';

// Replay embutido (`/replay/<id>`, num iframe de parceiro): sem service worker (ele baixaria o app
// inteiro para o cache dentro do site do parceiro) e no idioma do link (`lang=`), se houver.
const replayPage = isReplayPath(location.pathname);
if (!replayPage) registerServiceWorker();
const linkLocale = replayPage ? parseReplayEmbed(location.pathname, location.search)?.lang : undefined;

// Dicionário do idioma salvo antes do primeiro render, para a tela não piscar em português.
// (Se o download falhar, começa em português e o I18nProvider tenta de novo.)
const locale = linkLocale ?? initialLocale();
loadLocale(locale)
  .catch(() => undefined)
  .then(() => {
    document.documentElement.lang = locale;
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <SettingsProvider locale={linkLocale}>
          <AuthProvider>
            <ErrorBoundary title={t('app.error')}>
              <AccessGate>
                <App />
              </AccessGate>
            </ErrorBoundary>
          </AuthProvider>
        </SettingsProvider>
      </StrictMode>,
    );
  });
