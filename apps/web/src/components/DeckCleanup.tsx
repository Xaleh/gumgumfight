// Limpeza de decks (Admin e Dev): cópias idênticas, rascunhos abandonados e decks sem uso.
// Cada grupo de cópias mantém o original (o deck pronto ou o mais jogado); o resto vem marcado
// para apagar, e quem limpa pode desmarcar antes de apagar.

import { DECK_SIZE } from '@gumgum/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type DeckCleanup, type DeckCleanupKind, type DeckCleanupRow } from '../api';
import { deckTime } from '../deckLibrary';
import { useLocale, useT } from '../i18n';
import { fmtAgo, fmtNumber } from '../i18n/format';
import { cardColorVar } from './DeckTile';
import { DeckViewer } from './DeckViewer';

const KINDS: DeckCleanupKind[] = ['dupes', 'drafts', 'idle'];

export function DeckCleanupPanel() {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState<DeckCleanupKind>('dupes');
  const [data, setData] = useState<DeckCleanup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Desmarcados pela pessoa (o padrão é apagar tudo o que não é "manter"). */
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(
    (k: DeckCleanupKind) =>
      api.deckCleanup(k).then(
        (d) => {
          setData(d);
          setError(null);
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [],
  );
  useEffect(() => {
    setData(null);
    setKept(new Set());
    void load(kind);
  }, [kind, load]);

  const rows = useMemo(() => data?.groups.flatMap((g) => g.rows.filter((r) => !r.keep)) ?? [], [data]);
  const selected = rows.filter((r) => !kept.has(r.id)).map((r) => r.id);

  const remove = async () => {
    if (!selected.length || !window.confirm(t('decks.cleanup.confirm', { n: selected.length }))) return;
    setBusy(true);
    try {
      const { deleted } = await api.deleteDecks(selected);
      setNotice(t('decks.cleanup.deleted', { n: deleted }));
      setKept(new Set());
      await load(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const owner = (r: DeckCleanupRow) =>
    r.owner === 'account'
      ? r.ownerName
        ? t('decks.cleanup.owner.account', { name: r.ownerName })
        : t('decks.cleanup.owner.accountUnnamed')
      : r.owner === 'browser'
        ? t('decks.cleanup.owner.browser')
        : t('decks.cleanup.owner.builtin');
  const rules = data?.rules;

  return (
    <div className="dk-cleanup">
      {data && (
        <div className="dk-cleanup-stats">
          <div className="dk-stat">
            <span>{t('decks.cleanup.userDecks')}</span>
            <b>{fmtNumber(data.userDecks, locale)}</b>
          </div>
        </div>
      )}
      <div className="dk-tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {t(`decks.cleanup.kind.${k}`, { n: data?.counts[k] ?? '…', days: rules?.idleDays ?? 90 })}
          </button>
        ))}
      </div>
      {rules && (
        <p className="muted small">
          {kind === 'dupes'
            ? t('decks.cleanup.hint.dupes')
            : kind === 'drafts'
              ? t('decks.cleanup.hint.drafts', { cards: rules.draftMaxCards, days: rules.draftDays })
              : t('decks.cleanup.hint.idle', { days: rules.idleDays })}
        </p>
      )}
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {!data && !error && <p className="muted">{t('common.loading')}</p>}
      {data && !data.groups.length && <p className="dk-empty muted">{t('decks.cleanup.empty')}</p>}

      {data?.groups.map((g, gi) => (
        <section key={`${g.leader}-${gi}`} className="dk-cleanup-group">
          {kind === 'dupes' && (
            <div className="dk-cleanup-head">
              <span className="dk-cleanup-color" style={{ background: cardColorVar(g.colors[0]) }} aria-hidden="true" />
              <div>
                <b>{g.rows[0]?.name}</b>
                <div className="muted small">
                  {g.leaderName ?? g.leader} · {t('decks.cleanup.group', { n: g.rows.length })}
                </div>
              </div>
              <button type="button" className="dk-link" onClick={() => setViewing(g.rows[0].id)}>
                {t('decks.viewList')}
              </button>
            </div>
          )}
          {g.rows.map((r) => {
            const on = !r.keep && !kept.has(r.id);
            return (
              <label key={r.id} className={['dk-cleanup-row', r.keep ? 'keep' : ''].join(' ')}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={r.keep}
                  onChange={() =>
                    setKept((k) => {
                      const next = new Set(k);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
                <span className="dk-cleanup-name">{r.name}</span>
                <span className="muted small">{owner(r)}</span>
                <span className="muted small">{t('decks.cleanup.size', { size: r.size, max: DECK_SIZE })}</span>
                <span className="muted small">{r.games ? t('decks.meta.games', { n: r.games }) : t('decks.cleanup.never')}</span>
                <span className="muted small">{t('decks.meta.edited', { ago: fmtAgo(deckTime(r.updatedAt), locale) })}</span>
                <span className={['dk-chip', on ? 'bad' : 'ok'].join(' ')}>{on ? t('decks.cleanup.delete') : t('decks.cleanup.keep')}</span>
                {kind !== 'dupes' && (
                  <button
                    type="button"
                    className="dk-link small"
                    onClick={(e) => {
                      e.preventDefault();
                      setViewing(r.id);
                    }}
                  >
                    {t('decks.viewList')}
                  </button>
                )}
              </label>
            );
          })}
        </section>
      ))}

      {rows.length > 0 && (
        <div className="dk-cleanup-bar">
          <span>{t('decks.cleanup.selected', { n: selected.length })}</span>
          <button type="button" className="btn small" onClick={() => setKept(selected.length ? new Set(rows.map((r) => r.id)) : new Set())}>
            {selected.length ? t('decks.cleanup.selectNone') : t('decks.cleanup.selectAll')}
          </button>
          <button type="button" className="btn small danger" disabled={busy || !selected.length} onClick={() => void remove()}>
            {t('decks.cleanup.deleteSelected')}
          </button>
        </div>
      )}
      {viewing && <DeckViewer deckId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
