import { useEffect, useRef, useState } from 'react';
import { api, type EngineReading, type EngineTextDetail } from '../api';
import { useLocale, useT } from '../i18n';
import { Lines, StatusChip } from './GapLines';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Espera depois da última tecla antes de pedir a prévia ao servidor. */
const PREVIEW_DELAY_MS = 350;

/** O que o leitor entendeu, contado como a tradução que sai dele. */
function Reading({ r }: { r: EngineReading }) {
  const t = useT();
  return (
    <>
      <Lines lines={r.lines} />
      {(r.pt.text || r.pt.trigger) && (
        <div className="et-pt">
          <span className="muted small">{t('admin.engineText.ptLabel')}</span>
          <p>{r.pt.text}</p>
          {r.pt.trigger && <p>[Trigger] {r.pt.trigger}</p>}
          {!r.pt.complete && <span className="muted small">{t('admin.engineText.ptPartial')}</span>}
        </div>
      )}
    </>
  );
}

/**
 * Texto para o motor de uma carta (perfil Dev): o texto oficial e o que o leitor faz com ele, o
 * texto novo com a prévia ao vivo, gravar, voltar ao oficial e o histórico.
 */
export function EngineTextEditor({ cardId, onClose, onChange }: { cardId: string; onClose: () => void; onChange?: (d: EngineTextDetail) => void }) {
  const t = useT();
  const locale = useLocale();
  const [detail, setDetail] = useState<EngineTextDetail | null>(null);
  const [text, setText] = useState('');
  const [trigger, setTrigger] = useState('');
  const [preview, setPreview] = useState<EngineReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const seq = useRef(0);

  const load = (d: EngineTextDetail) => {
    setDetail(d);
    setText(d.engineText?.text ?? d.card.text);
    setTrigger(d.engineText ? (d.engineText.trigger ?? '') : (d.card.trigger ?? ''));
    setPreview(null);
  };

  useEffect(() => {
    setDetail(null);
    setError(null);
    api
      .engineText(cardId)
      .then(load)
      .catch((e) => setError(errorText(e)));
  }, [cardId]);

  // Prévia ao vivo: a última resposta que chega é a do último texto pedido.
  useEffect(() => {
    if (!detail || detail.scripted || (!text.trim() && !trigger.trim())) return;
    const n = ++seq.current;
    const timer = setTimeout(() => {
      api
        .previewEngineText(cardId, text, trigger)
        .then((r) => n === seq.current && setPreview(r))
        .catch((e) => n === seq.current && setError(errorText(e)));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cardId, detail, text, trigger]);

  const run = (p: Promise<EngineTextDetail>) => {
    setBusy(true);
    setError(null);
    p.then((d) => {
      load(d);
      setSaved(true);
      onChange?.(d);
    })
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  if (error && !detail) return <div className="error">{error}</div>;
  if (!detail) return <div className="muted">{t('common.loading')}</div>;
  const { card } = detail;
  const same = text.trim() === card.text.trim() && trigger.trim() === (card.trigger ?? '').trim();
  const unchanged = detail.engineText
    ? text.trim() === detail.engineText.text && trigger.trim() === (detail.engineText.trigger ?? '')
    : same;
  const date = (iso: string) => new Date(iso).toLocaleString(locale);

  return (
    <section className="et-editor" aria-label={t('admin.engineText.title', { id: card.id })}>
      <header>
        <h3>{t('admin.engineText.title', { id: card.id })}</h3>
        <span>{card.name}</span>
        <button className="btn small gap-seen" onClick={onClose}>
          {t('admin.engineText.close')}
        </button>
      </header>
      <p className="muted small">{t('admin.engineText.intro')}</p>
      {detail.scripted && <div className="et-note">{t('admin.engineText.scripted')}</div>}
      {detail.stale && <div className="et-note et-warn">{t('admin.engineText.stale')}</div>}

      <div className="et-cols">
        <div>
          <h4>
            {t('admin.engineText.official')} <StatusChip status={detail.official.status} />
          </h4>
          <pre className="et-official">
            {card.text}
            {card.trigger ? `\n[Trigger] ${card.trigger}` : ''}
          </pre>
          <Reading r={detail.official} />
        </div>

        {!detail.scripted && (
          <div>
            <h4>
              {t('admin.engineText.engine')} {preview && <StatusChip status={preview.status} />}
            </h4>
            <label className="et-field">
              <span className="muted small">{t('admin.engineText.textLabel')}</span>
              <textarea value={text} rows={5} spellCheck={false} onChange={(e) => (setText(e.target.value), setSaved(false))} />
            </label>
            <label className="et-field">
              <span className="muted small">{t('admin.engineText.triggerLabel')}</span>
              <textarea value={trigger} rows={2} spellCheck={false} onChange={(e) => (setTrigger(e.target.value), setSaved(false))} />
            </label>
            {preview ? <Reading r={preview} /> : <div className="muted small">{t('admin.engineText.previewWaiting')}</div>}
            {error && <div className="error">{error}</div>}
            <div className="et-actions">
              <button className="btn small primary" disabled={busy || same || unchanged} onClick={() => run(api.saveEngineText(card.id, text, trigger))}>
                {t('admin.engineText.save')}
              </button>
              {detail.engineText && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => window.confirm(t('admin.engineText.removeConfirm')) && run(api.removeEngineText(card.id))}
                >
                  {t('admin.engineText.remove')}
                </button>
              )}
              {saved && <span className="muted small">{t('admin.engineText.saved')}</span>}
              {same && !detail.engineText && <span className="muted small">{t('admin.engineText.sameHint')}</span>}
            </div>
          </div>
        )}
      </div>

      {detail.history.length > 0 && (
        <details className="et-history">
          <summary>{t('admin.engineText.history', { n: detail.history.length })}</summary>
          <ul>
            {detail.history.map((h, i) => (
              <li key={i}>
                <span className="muted small">
                  {date(h.at)} · {h.authorName ?? '?'} · {t(h.action === 'set' ? 'admin.engineText.historySet' : 'admin.engineText.historyRemove')}
                </span>
                {h.text && <pre>{h.text + (h.trigger ? `\n[Trigger] ${h.trigger}` : '')}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
