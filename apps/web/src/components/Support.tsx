// "Apoiar o projeto": Pix (QR + copia e cola), café avulso, planos mensais, a meta do
// mês e a lista de Apoiadores. Os links e a chave vêm do servidor (variáveis SUPPORT_*).

import { useEffect, useState } from 'react';
import { api, type SupportInfo, type SupporterTier, TIER_LABEL } from '../api';
import { useAuth } from '../auth';
import { Switch } from '../settings';
import { Icon } from './Icons';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: n % 1 ? 2 : 0 });

/** QR code em SVG (a biblioteca só é baixada quando o modal abre). */
function QrCode({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      if (alive) setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    });
    return () => {
      alive = false;
    };
  }, [text]);
  // SVG gerado localmente a partir do texto do Pix (sem conteúdo vindo de terceiros).
  return svg ? <div className="pix-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="pix-qr loading" />;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navegador sem permissão de área de transferência: seleciona o campo para copiar à mão.
      document.querySelector<HTMLTextAreaElement>('.pix-code')?.select();
      return;
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button className="btn small primary" onClick={copy}>
      {done ? 'Copiado!' : 'Copiar'}
    </button>
  );
}

function PixBox({ pix }: { pix: NonNullable<SupportInfo['pix']> }) {
  const [pick, setPick] = useState(0);
  const code = pix.codes[pick] ?? pix.codes[0];
  return (
    <section className="support-block">
      <h4>☕ Me pague um café pelo Pix</h4>
      <div className="seg small pix-amounts" role="group" aria-label="Valor">
        {pix.codes.map((c, i) => (
          <button key={i} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>
            {c.amount ? brl(c.amount) : 'Outro valor'}
          </button>
        ))}
      </div>
      <div className="pix-box">
        <QrCode text={code.code} label={`QR code do Pix${code.amount ? ` de ${brl(code.amount)}` : ''}`} />
        <div className="pix-side">
          <p className="muted small">
            Aponte a câmera do app do banco para o QR code, ou copie o código e cole em <b>Pix copia e cola</b>.
            {code.amount ? '' : ' Você escolhe o valor no app.'} O dinheiro vai para <b>{pix.name}</b>.
          </p>
          <textarea className="pix-code" readOnly value={code.code} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Pix copia e cola" />
          <CopyButton text={code.code} />
        </div>
      </div>
    </section>
  );
}

function Goal({ info }: { info: SupportInfo }) {
  if (!info.goal) return null;
  const pct = Math.min(100, Math.round((info.covered / info.goal) * 100));
  return (
    <div className="support-goal">
      <div className="support-goal-text">
        <span>
          Custo do servidor e domínios: <b>{brl(info.goal)}</b> por mês
        </span>
        <span className="muted small">
          {info.supporters ? `${info.supporters} ${info.supporters === 1 ? 'apoiador cobre' : 'apoiadores cobrem'} ${pct}%` : 'Seja o primeiro apoiador!'}
        </span>
      </div>
      <div className="support-goal-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Plans({ info, current }: { info: SupportInfo; current: SupporterTier | null }) {
  return (
    <section className="support-block">
      <h4>Apoio mensal</h4>
      <div className="support-plans">
        {info.tiers.map((t) => (
          <article key={t.id} className={['support-plan', `tier-${t.id}`, current === t.id ? 'current' : ''].join(' ')}>
            <header>
              <strong>{t.label}</strong>
              <span>
                {brl(t.price)}
                <small>/mês</small>
              </span>
            </header>
            <ul>
              {t.perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {current === t.id && <span className="support-plan-badge">Seu plano</span>}
          </article>
        ))}
      </div>
      {info.monthlyUrl && (
        <a className="btn primary support-cta" href={info.monthlyUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="heart" size={18} /> Assinar um plano
        </a>
      )}
      <p className="muted small">
        Assine com o <b>mesmo e-mail da sua conta Google</b> aqui do site: é assim que o plano chega na sua conta (em alguns minutos). Prefere pagar o plano por Pix? Faça o
        Pix do valor do plano e mande o comprovante para a equipe: o plano é liberado à mão.
      </p>
    </section>
  );
}

function MyPlan({ info }: { info: SupportInfo }) {
  const { refresh } = useAuth();
  const [visible, setVisible] = useState(info.me?.public ?? false);
  const tier = info.me?.tier;
  if (!info.me || !tier) return null;
  const toggle = async (on: boolean) => {
    setVisible(on);
    try {
      await api.support.setPublic(on);
      await refresh();
    } catch {
      setVisible(!on);
    }
  };
  return (
    <div className="support-mine">
      <p>
        Obrigado por apoiar! Você é <b>{TIER_LABEL[tier]}</b>
        {info.me.until ? ` até ${new Date(info.me.until).toLocaleDateString('pt-BR')}` : ''}.
      </p>
      <label className="support-mine-row">
        <span>Mostrar meu apelido na lista de Apoiadores</span>
        <Switch on={visible} label="Mostrar meu apelido na lista de Apoiadores" onChange={toggle} />
      </label>
    </div>
  );
}

export function SupportersList({ compact }: { compact?: boolean }) {
  const [list, setList] = useState<Array<{ name: string; tier: SupporterTier }> | null>(null);
  useEffect(() => {
    api.support
      .supporters()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  if (!list?.length) return null;
  return (
    <div className={['supporters-list', compact ? 'compact' : ''].join(' ')}>
      <span className="muted small">{compact ? 'Obrigado aos apoiadores:' : 'Apoiadores'}</span>
      <ul>
        {list.map((s) => (
          <li key={`${s.tier}-${s.name}`} className={`tier-${s.tier}`} title={TIER_LABEL[s.tier]}>
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SupportModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<SupportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.support
      .info()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet support-sheet" role="dialog" aria-modal="true" aria-label="Apoiar o projeto" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>❤️ Apoiar o projeto</h3>
          <button className="zoom-close static" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {error && <div className="error">{error}</div>}
          {!info && !error && <p className="muted">Carregando…</p>}
          {info && (
            <>
              <p className="support-intro">
                O GumGum Fight é feito por fãs e fica no ar com a ajuda de quem joga. O apoio paga o servidor e os domínios e ajuda a manter o desenvolvimento.
              </p>
              <Goal info={info} />
              <MyPlan info={info} />
              {info.pix && <PixBox pix={info.pix} />}
              {info.coffeeUrl && (
                <a className="btn support-cta" href={info.coffeeUrl} target="_blank" rel="noopener noreferrer">
                  ☕ Café com cartão ou PayPal
                </a>
              )}
              <Plans info={info} current={info.me?.tier ?? null} />
              <p className="support-fair muted small">
                <Icon name="check" size={16} /> Nenhum plano dá vantagem dentro da partida. Jogar, montar decks e entrar em torneios continua grátis para todo mundo.
              </p>
              <SupportersList />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
