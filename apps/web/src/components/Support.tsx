// "Apoiar o projeto": o "Doe um Cafezim" (Pix com QR e copia e cola), o apoio mensal na
// Apoia.se (com "Já apoio: verificar"), a meta do mês e a lista de Apoiadores. A chave
// Pix e os links vêm do servidor (variáveis SUPPORT_*).

import { useEffect, useState } from 'react';
import { api, ApiError, type SupportInfo, type SupporterTier, TIER_LABEL } from '../api';
import { GoogleButton, useAuth } from '../auth';
import { type MessageKey, useLocale, useT } from '../i18n';
import { fmtDate } from '../i18n/format';
import { Switch } from '../settings';
import { Icon } from './Icons';

/** Benefícios de cada plano (os textos ficam no dicionário; o servidor manda o id e o preço). */
const PERKS: Record<SupporterTier, MessageKey[]> = {
  grumete: ['support.perk.grumete.1', 'support.perk.grumete.2'],
  tripulante: ['support.perk.tripulante.1', 'support.perk.tripulante.2', 'support.perk.tripulante.3', 'support.perk.tripulante.4'],
  capitao: ['support.perk.capitao.1', 'support.perk.capitao.2', 'support.perk.capitao.3'],
  almirante: ['support.perk.almirante.1', 'support.perk.almirante.2', 'support.perk.almirante.3'],
};
/** Torneios por mês e jogadores por torneio dos planos que organizam (iguais aos do servidor). */
const ORGANIZE = { n: 5, max: 64 };

function useBrl() {
  const locale = useLocale();
  return (n: number) => n.toLocaleString(locale, { style: 'currency', currency: 'BRL', maximumFractionDigits: n % 1 ? 2 : 0 });
}

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
  const t = useT();
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
      {done ? t('support.copied') : t('support.copy')}
    </button>
  );
}

/** "Doe um Cafezim": Pix direto, com valor sugerido ou livre. */
function Cafezim({ pix }: { pix: NonNullable<SupportInfo['pix']> }) {
  const t = useT();
  const brl = useBrl();
  const [pick, setPick] = useState(0);
  const code = pix.codes[pick] ?? pix.codes[0];
  return (
    <section className="support-block">
      <h4>{t('support.cafezimTitle')}</h4>
      <p className="muted small">{t('support.cafezimIntro')}</p>
      <div className="seg small pix-amounts" role="group" aria-label={t('support.pixAmounts')}>
        {pix.codes.map((c, i) => (
          <button key={i} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>
            {c.amount ? brl(c.amount) : t('support.pixOther')}
          </button>
        ))}
      </div>
      <div className="pix-box">
        <QrCode text={code.code} label={code.amount ? t('support.pixQrValue', { value: brl(code.amount) }) : t('support.pixQr')} />
        <div className="pix-side">
          <p className="muted small">
            {t('support.pixHelp')} {code.amount ? '' : t('support.pixAnyValue')} {t('support.pixReceiver', { name: pix.name })}
          </p>
          <textarea className="pix-code" readOnly value={code.code} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label={t('support.pixCode')} />
          <CopyButton text={code.code} />
        </div>
      </div>
    </section>
  );
}

function Goal({ info }: { info: SupportInfo }) {
  const t = useT();
  const brl = useBrl();
  if (!info.goal) return null;
  const pct = Math.min(100, Math.round((info.covered / info.goal) * 100));
  return (
    <div className="support-goal">
      <div className="support-goal-text">
        <span>
          {t('support.goalLabel')} <b>{brl(info.goal)}</b>
        </span>
        <span className="muted small">{info.supporters ? t('support.goalCovered', { n: info.supporters, pct }) : t('support.goalFirst')}</span>
      </div>
      <div className="support-goal-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "Já apoio: verificar": consulta a Apoia.se pelo e-mail da conta e mostra o resultado. */
function VerifyApoiase() {
  const t = useT();
  const locale = useLocale();
  const { user, clientId, signIn, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user) {
    return (
      <div className="support-verify">
        <p className="muted small">{t('support.loginToReceive')}</p>
        {clientId && <GoogleButton clientId={clientId} onCredential={signIn} />}
      </div>
    );
  }
  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.support.verifyApoiase();
      if (r.tier) setMsg({ ok: true, text: t('support.verifyOk', { tier: TIER_LABEL[r.tier], date: r.until ? fmtDate(r.until, locale) : '—' }) });
      else if (r.isBacker && !r.isPaidThisMonth) setMsg({ ok: false, text: t('support.verifyNotPaid') });
      else if (r.isBacker) setMsg({ ok: false, text: t('support.verifyLow') });
      else setMsg({ ok: false, text: t('support.verifyNone', { email: user.email ?? '' }) });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="support-verify">
      <button className="btn small" disabled={busy} onClick={check}>
        {busy ? t('support.verifying') : t('support.verify')}
      </button>
      {msg && <p className={['small', msg.ok ? 'support-ok' : 'muted'].join(' ')}>{msg.text}</p>}
    </div>
  );
}

function Plans({ info, current }: { info: SupportInfo; current: SupporterTier | null }) {
  const t = useT();
  const brl = useBrl();
  return (
    <section className="support-block">
      <h4>{t('support.monthlyTitle')}</h4>
      <div className="support-plans">
        {info.tiers.map((tier) => (
          <article key={tier.id} className={['support-plan', `tier-${tier.id}`, current === tier.id ? 'current' : ''].join(' ')}>
            <header>
              <strong>{TIER_LABEL[tier.id]}</strong>
              <span>
                {brl(tier.price)}
                <small>{t('support.perMonth')}</small>
              </span>
            </header>
            <ul>
              {PERKS[tier.id].map((k) => (
                <li key={k}>{t(k, ORGANIZE)}</li>
              ))}
            </ul>
            {current === tier.id && <span className="support-plan-badge">{t('support.yourPlan')}</span>}
          </article>
        ))}
      </div>
      {info.monthlyUrl && (
        <a className="btn primary support-cta" href={info.monthlyUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="heart" size={18} /> {t('support.subscribe')}
        </a>
      )}
      <p className="muted small">{t('support.monthlyHelp')}</p>
      {info.apoiase && <VerifyApoiase />}
      {info.pix && <p className="muted small">{t('support.pixPlanHelp')}</p>}
    </section>
  );
}

function MyPlan({ info }: { info: SupportInfo }) {
  const t = useT();
  const locale = useLocale();
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
        {info.me.until
          ? t('support.thanksUntil', { tier: TIER_LABEL[tier], date: fmtDate(info.me.until, locale) })
          : t('support.thanks', { tier: TIER_LABEL[tier] })}
      </p>
      <label className="support-mine-row">
        <span>{t('support.showInList')}</span>
        <Switch on={visible} label={t('support.showInList')} onChange={toggle} />
      </label>
    </div>
  );
}

export function SupportersList({ compact }: { compact?: boolean }) {
  const t = useT();
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
      <span className="muted small">{compact ? t('support.thanksList') : t('support.supportersTitle')}</span>
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
  const t = useT();
  const [info, setInfo] = useState<SupportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  useEffect(() => {
    api.support
      .info()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user?.supporter?.tier]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet support-sheet" role="dialog" aria-modal="true" aria-label={t('support.nav')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('support.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {error && <div className="error">{error}</div>}
          {!info && !error && <p className="muted">{t('common.loading')}</p>}
          {info && (
            <>
              <p className="support-intro">{t('support.intro')}</p>
              <Goal info={info} />
              <MyPlan info={info} />
              {info.pix && <Cafezim pix={info.pix} />}
              {info.coffeeUrl && (
                <a className="btn support-cta" href={info.coffeeUrl} target="_blank" rel="noopener noreferrer">
                  {t('support.cardDonation')}
                </a>
              )}
              <Plans info={info} current={info.me?.tier ?? null} />
              <p className="support-fair muted small">
                <Icon name="check" size={16} /> {t('support.fair')}
              </p>
              <SupportersList />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
