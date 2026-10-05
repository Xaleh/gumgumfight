import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsProvider } from './settings';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <ErrorBoundary title="Algo deu errado">
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
);
