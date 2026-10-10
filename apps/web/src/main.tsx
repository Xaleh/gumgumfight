import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadLocale, t } from './i18n';
import { initialLocale, SettingsProvider } from './settings';
import './styles.css';

// Dicionário do idioma salvo antes do primeiro render, para a tela não piscar em português.
// (Se o download falhar, começa em português e o I18nProvider tenta de novo.)
const locale = initialLocale();
loadLocale(locale)
  .catch(() => undefined)
  .then(() => {
    document.documentElement.lang = locale;
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <SettingsProvider>
          <AuthProvider>
            <ErrorBoundary title={t('app.error')}>
              <App />
            </ErrorBoundary>
          </AuthProvider>
        </SettingsProvider>
      </StrictMode>,
    );
  });
