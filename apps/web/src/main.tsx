import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth';
import { AccessGate } from './components/AccessGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsProvider } from './settings';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <ErrorBoundary title="Algo deu errado">
          <AccessGate>
            <App />
          </AccessGate>
        </ErrorBoundary>
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
);
