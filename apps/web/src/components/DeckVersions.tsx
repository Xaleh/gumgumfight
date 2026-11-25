// Versões do deck no construtor (roadmap C2): cada lista que o deck salvo já teve, o que entrou e saiu de uma
// para a outra e as partidas e a taxa de vitória de cada uma. Os números vêm do servidor
// (`GET /api/decks/:id/versions`, pelo hash da lista); restaurar só troca o rascunho, que fica para salvar.

import type { CardData } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { api, type DeckVersion } from '../api';
import { deckTime } from '../deckLibrary';
import { useLocale, useT } from '../i18n';
import { fmtDate } from '../i18n/format';

export function DeckVersionsPanel({
  deckId,
  refreshKey,
  byId,
  dirty,
  onRestore,
}: {
  deckId: string;
  /** Muda quando o deck é salvo: a lista de versões é buscada de novo. */
  refreshKey: string;
  byId: Map<string, CardData>;
  /** O rascunho tem mudanças não salvas (a versão "atual" é a salva). */
  dirty: boolean;
  onRestore: (v: DeckVersion) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<{ total: number; versions: DeckVersion[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api
      .deckVersions(deckId)
      .then((r) => live && setData(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deckId, refreshKey]);

  if (failed) return <div className="deck-versions muted small">{t('decks.versions.error')}</div>;
  if (!data) return <div className="deck-versions muted small">{t('decks.versions.loading')}</div>;

  const name = (id: string) => byId.get(id)?.name ?? id;
  const when = (v: DeckVersion) => {
    const ms = deckTime(v.savedAt ?? v.firstPlayedAt);
    return ms ? fmtDate(ms, locale) : '';
  };

  return (
    <div className="deck-versions">
      <p className="small muted">{t('decks.versions.intro')}</p>
      {dirty && <p className="small dv-note">{t('decks.versions.unsaved')}</p>}
      <ol className="dv-list">
        {data.versions.map((v) => {
          const { diff } = v;
          const first = v.number === 1;
          const changes = diff.added.length + diff.removed.length + (diff.leader ? 1 : 0);
          return (
            <li key={v.hash} className={['dv-item', v.current ? 'current' : ''].join(' ')}>
              <div className="dv-head">
                <b>{t('decks.versions.number', { n: v.number })}</b>
                {v.current && <span className="dv-badge">{t('decks.versions.current')}</span>}
                <span className="small muted">{when(v)}</span>
                {!v.current && (
                  <button type="button" className="btn small dv-restore" onClick={() => onRestore(v)}>
                    {t('decks.versions.restore')}
                  </button>
                )}
              </div>
              <div className="dv-stats small">
                {v.games ? (
                  <>
                    <b>{t('decks.versions.winRate', { pct: Math.round((v.winRate ?? 0) * 100) })}</b>
                    <span className="muted">
                      {t('decks.versions.record', { games: v.games, wins: v.wins, losses: v.losses })}
                      {v.draws ? ` · ${t('decks.versions.draws', { n: v.draws })}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="muted">{t('decks.versions.noGames')}</span>
                )}
              </div>
              {first ? (
                <div className="small muted">{t('decks.versions.first', { n: v.cards.reduce((s, c) => s + c.count, 0) })}</div>
              ) : changes === 0 ? null : (
                <ul className="dv-diff small">
                  {diff.leader && (
                    <li className="dv-leader">{t('decks.versions.leader', { before: name(diff.leader.before), after: name(diff.leader.after) })}</li>
                  )}
                  {diff.added.map((c) => (
                    <li key={`+${c.id}`} className="dv-in" title={c.id}>
                      +{c.delta} {name(c.id)} <span className="muted">({c.before}→{c.after})</span>
                    </li>
                  ))}
                  {diff.removed.map((c) => (
                    <li key={`-${c.id}`} className="dv-out" title={c.id}>
                      −{-c.delta} {name(c.id)} <span className="muted">({c.before}→{c.after})</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {data.total > data.versions.length && (
        <p className="small muted">{t('decks.versions.older', { n: data.total - data.versions.length })}</p>
      )}
    </div>
  );
}
