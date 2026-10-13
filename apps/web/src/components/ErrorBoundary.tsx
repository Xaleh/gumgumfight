import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
  /** Título do aviso (ex.: "A mesa travou"). */
  title: string;
  /** Botão de saída (ex.: voltar ao menu). Sem ele, o aviso oferece recarregar a página. */
  onExit?: () => void;
  exitLabel?: string;
}

interface State {
  error: Error | null;
  /** Muda a cada nova tentativa: remonta os filhos do zero. */
  attempt: number;
}

/** Um erro seguido do outro em menos que isso não é refeito sozinho (evita repetir sem fim). */
const AUTO_RETRY_MS = 10_000;

/**
 * Erro durante a renderização: sem isto o React desmonta a página inteira e fica tudo
 * branco. Aqui o erro fica só nesta parte da tela. Na primeira vez, ela é montada de novo
 * sozinha (o estado da tela, como a carta escolhida, recomeça); se o erro voltar logo,
 * mostra o aviso com o botão de tentar de novo.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };
  private lastError = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na tela:', error, info.componentStack);
    const now = Date.now();
    const quick = now - this.lastError < AUTO_RETRY_MS;
    this.lastError = now;
    if (!quick) this.retry();
  }

  retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    const { error, attempt } = this.state;
    if (!error) return <Attempt key={attempt}>{this.props.children}</Attempt>;
    return (
      <div className="menu">
        <div className="menu-box">
          <section className="menu-card online-wait">
            <h2>{this.props.title}</h2>
            <p className="muted">{t('menu.errorHint')}</p>
            <p className="muted small">{error.message}</p>
            <div className="btn-row center">
              <button className="btn primary" onClick={this.retry}>
                {t('menu.errorRetry')}
              </button>
              {this.props.onExit ? (
                <button className="btn" onClick={this.props.onExit}>
                  {this.props.exitLabel ?? t('menu.errorBackToMenu')}
                </button>
              ) : (
                <button className="btn" onClick={() => location.reload()}>
                  {t('menu.errorReload')}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }
}

/** Só para a `key`: cada tentativa monta os filhos do zero. */
function Attempt({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
