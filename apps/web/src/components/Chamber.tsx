// Sala do Tempo (docs/plano-sala-do-tempo.md): o formulário que abre a sala a partir de um evento
// (preset de data/chamber) e o painel do evento na página do torneio (distribuição dos Líderes, o deck
// que o bot joga por cada um e quantos virtuais há). As mesas e a classificação continuam na página
// do torneio, que marca os virtuais.

import { useEffect, useState } from 'react';
import { api, type ChamberInfo, type ChamberLeaderInfo, type ChamberPreset, modeLabel, type TournamentDetail } from '../api';
import { type Translate, useT } from '../i18n';
import { LeaderArt } from './LeaderArt';
import { phaseLower, phaseName, TOP_CUTS } from './Tournaments';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Fases da eliminatória que se podem escolher para a melhor de 3 / de 5 (vagas; 256 = toda a eliminatória). */
const PHASES = [256, 32, 16, 8, 4, 2];

/** "Piloto 17" no idioma da interface (o servidor grava o nome em português). */
export function virtualName(tr: Translate, p: { userId: string; name: string; virtual?: boolean }): string {
  if (!p.virtual) return p.name;
  const n = Number(p.userId.slice(2));
  return Number.isInteger(n) ? tr('chamber.pilot', { n }) : p.name;
}

/** Formulário "Nova Sala do Tempo": escolhe o evento e ajusta tamanho, rodadas e top cut. */
export function ChamberForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (t: TournamentDetail) => void }) {
  const tr = useT();
  const [data, setData] = useState<{ presets: ChamberPreset[]; botRooms: boolean; minPlayers: number; maxPlayers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>('');
  const [name, setName] = useState('');
  const [players, setPlayers] = useState<number | null>(null);
  const [rounds, setRounds] = useState<number | null | undefined>(undefined);
  const [topCut, setTopCut] = useState<number | null | undefined>(undefined);
  const [bo3From, setBo3From] = useState<number | null | undefined>(undefined);
  const [bo5From, setBo5From] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stop = false;
    api.tournaments
      .chamberPresets()
      .then((d) => {
        if (stop) return;
        setData(d);
        if (d.presets[0]) setPresetId(d.presets[0].id);
      })
      .catch((e) => !stop && setError(errorText(e)));
    return () => {
      stop = true;
    };
  }, []);

  const preset = data?.presets.find((p) => p.id === presetId) ?? null;
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const size = players ?? preset?.players ?? 0;
  const roundsValue = rounds === undefined ? preset?.rounds ?? null : rounds;
  const cutValue = topCut === undefined ? preset?.topCut ?? null : topCut;
  const bo3Value = bo3From === undefined ? preset?.bo3From ?? null : bo3From;
  const bo5Value = bo5From === undefined ? preset?.bo5From ?? null : bo5From;

  const save = async () => {
    if (!preset) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await api.tournaments.createChamber({
          preset: preset.id,
          ...(name.trim() ? { name: name.trim() } : {}),
          players: size,
          rounds: roundsValue,
          topCut: cutValue,
          bo3From: cutValue === null ? null : bo3Value,
          bo5From: cutValue === null ? null : bo5Value,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="coverage tournaments">
      <header className="builder-header">
        <button className="btn small" onClick={onCancel}>
          {tr('tour.back')}
        </button>
        <h2>{tr('chamber.newTitle')}</h2>
      </header>
      <div className="coverage-body">
        <section className="menu-card tour-form chamber-form">
          <p className="small chamber-intro">{tr('chamber.intro')}</p>
          {error && <div className="error">{error}</div>}
          {data && !data.botRooms && <div className="error">{tr('chamber.botRoomsOff')}</div>}
          {data === null && !error && <p className="muted">{tr('common.loading')}</p>}
          {data && !data.presets.length && <p className="muted">{tr('chamber.noPresets')}</p>}
          {data && data.presets.length > 0 && (
            <>
              <div className="field">
                <label>{tr('chamber.event')}</label>
                <div className="seg small chamber-presets">
                  {data.presets.map((p) => (
                    <button
                      key={p.id}
                      className={presetId === p.id ? 'on' : ''}
                      onClick={() => {
                        setPresetId(p.id);
                        setPlayers(null);
                        setRounds(undefined);
                        setTopCut(undefined);
                        setBo3From(undefined);
                        setBo5From(undefined);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <p className="muted small">{tr('chamber.eventHelp')}</p>
              </div>
              {preset && (
                <>
                  {preset.description && <p className="small">{preset.description}</p>}
                  <p className="muted small">{modeLabel(preset)}</p>
                  <div className="field">
                    <label htmlFor="chamber-name">{tr('chamber.nameLabel')}</label>
                    <input id="chamber-name" className="admin-search" value={name} maxLength={80} placeholder={preset.name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="tour-form-row">
                    <div className="field">
                      <label htmlFor="chamber-players">{tr('chamber.players')}</label>
                      <input
                        id="chamber-players"
                        className="admin-search"
                        type="number"
                        min={data.minPlayers}
                        max={data.maxPlayers}
                        value={size || ''}
                        onChange={(e) => setPlayers(num(e.target.value) ?? 0)}
                      />
                      <p className="muted small">{tr('chamber.playersHelp', { min: data.minPlayers, max: data.maxPlayers })}</p>
                    </div>
                    <div className="field">
                      <label htmlFor="chamber-rounds">{tr('chamber.rounds')}</label>
                      <input
                        id="chamber-rounds"
                        className="admin-search"
                        type="number"
                        min={1}
                        max={15}
                        placeholder={tr('tour.auto')}
                        value={roundsValue ?? ''}
                        onChange={(e) => setRounds(num(e.target.value))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="chamber-cut">{tr('tour.topCut')}</label>
                      <select id="chamber-cut" className="admin-search" value={cutValue ?? ''} onChange={(e) => setTopCut(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">{tr('tour.noTopCut')}</option>
                        {TOP_CUTS.map((n) => (
                          <option key={n} value={n}>
                            {tr('tour.topCutOption', { n, phase: phaseLower(tr, n) })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {cutValue !== null && (
                    <div className="tour-form-row">
                      <div className="field">
                        <label htmlFor="chamber-bo3">{tr('tour.bo3From')}</label>
                        <select id="chamber-bo3" className="admin-search" value={bo3Value ?? ''} onChange={(e) => setBo3From(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">{tr('tour.never')}</option>
                          {PHASES.filter((n) => n <= cutValue).map((n) => (
                            <option key={n} value={n}>
                              {n >= 256 ? tr('tour.phase.all') : phaseName(tr, n)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="chamber-bo5">{tr('tour.bo5From')}</label>
                        <select id="chamber-bo5" className="admin-search" value={bo5Value ?? ''} onChange={(e) => setBo5From(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">{tr('tour.never')}</option>
                          {PHASES.filter((n) => n <= cutValue).map((n) => (
                            <option key={n} value={n}>
                              {n >= 256 ? tr('tour.phase.all') : phaseName(tr, n)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                  <Distribution leaders={preset.leaders} others={preset.others} size={size} />
                  <div className="btn-row">
                    <button className="btn primary" disabled={saving || !data.botRooms || size < data.minPlayers || size > data.maxPlayers} onClick={() => void save()}>
                      {tr('chamber.create')}
                    </button>
                    <button className="btn" disabled={saving} onClick={onCancel}>
                      {tr('common.cancel')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** A distribuição dos Líderes do evento: barra por Líder, a fatia, o deck que o bot joga e (depois do início) quantos virtuais. */
function Distribution({ leaders, others, size, counts }: { leaders: ChamberLeaderInfo[]; others: number; size: number; counts?: boolean }) {
  const tr = useT();
  const covered = leaders.reduce((s, l) => s + (l.deckId ? l.share : 0), 0);
  const rest = Math.max(0, 1 - covered);
  const max = Math.max(rest, ...leaders.map((l) => l.share), 0.01);
  return (
    <div className="chamber-dist">
      <h3>{tr('chamber.distribution')}</h3>
      <p className="muted small">{tr('chamber.distributionHelp')}</p>
      <ul className="chamber-leaders">
        {leaders.map((l) => (
          <li key={l.leader} className={l.deckId ? '' : 'uncovered'}>
            <LeaderArt name={l.leaderName ?? l.leader} image={l.leaderImage ?? null} colors={l.colors} size="small" />
            <div className="chamber-leader-body">
              <div className="chamber-leader-head">
                <b>{l.leaderName ?? l.leader}</b>
                <span className="chamber-share">
                  {pct(l.share)}
                  {size > 0 && <span className="muted small"> · {counts ? (l.count ?? 0) : Math.round(l.share * size)}</span>}
                </span>
              </div>
              <div className="chamber-bar">
                <span style={{ width: `${(l.share / max) * 100}%` }} />
              </div>
              <span className="muted small">
                {l.deckId ? (
                  <>
                    {l.deckName ?? l.deckId} <span className={['tour-badge', l.meta ? 'gold' : ''].join(' ')}>{tr(l.meta ? 'chamber.metaDeck' : 'chamber.starterDeck')}</span>
                  </>
                ) : (
                  tr('chamber.noDeck')
                )}
              </span>
            </div>
          </li>
        ))}
        {rest > 0.0005 && (
          <li className="others">
            <LeaderArt size="small" />
            <div className="chamber-leader-body">
              <div className="chamber-leader-head">
                <b>{tr('chamber.others')}</b>
                <span className="chamber-share">
                  {pct(rest)}
                  {size > 0 && !counts && <span className="muted small"> · {Math.round(rest * size)}</span>}
                </span>
              </div>
              <div className="chamber-bar">
                <span className="others" style={{ width: `${(rest / max) * 100}%` }} />
              </div>
              <span className="muted small">{tr('chamber.othersShare', { pct: pct(rest).replace('%', ''), n: others })}</span>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Painel "Sala do Tempo" na página do torneio: o evento, a distribuição e os virtuais que entraram. */
export function ChamberPanel({ t, chamber }: { t: TournamentDetail; chamber: ChamberInfo }) {
  const tr = useT();
  const humans = t.players.length;
  const size = chamber.size ?? humans + chamber.virtuals;
  return (
    <section className="menu-card chamber-panel">
      <h2>⏳ {tr('chamber.title')}</h2>
      <p className="small">
        {tr('chamber.event')}: <b>{chamber.presetName}</b>
      </p>
      {chamber.presetMissing && <div className="error">{tr('chamber.presetMissing')}</div>}
      {!chamber.botRooms && <div className="error">{tr('chamber.botRoomsOff')}</div>}
      {t.status === 'registration' ? (
        <p className="muted small">{tr('chamber.startHint', { n: Math.max(0, size - humans) })}</p>
      ) : (
        <p className="muted small">{tr('chamber.virtualsLine', { humans, virtuals: chamber.virtuals, total: humans + chamber.virtuals })}</p>
      )}
      <details className="chamber-details" open={t.status === 'registration'}>
        <summary className="small">{tr('chamber.distribution')}</summary>
        <Distribution leaders={chamber.leaders} others={chamber.otherDecks} size={size} counts={t.status !== 'registration'} />

        {chamber.others.length > 0 && (
          <p className="muted small">
            {tr('chamber.othersDrawn')}: {chamber.others.map((o) => `${o.leaderName ?? o.leader} (${o.count})`).join(', ')}
          </p>
        )}
      </details>
      {t.status === 'registration' && <p className="muted small chamber-intro">{tr('chamber.intro')}</p>}
    </section>
  );
}
