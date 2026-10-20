import type { EngineReading, GapLine, GapStage } from '../api';
import { type MessageKey, useT } from '../i18n';

// Peças da tela de Cobertura (perfil Dev) usadas também no editor do texto para o motor.

export const stageKey = (s: GapStage | undefined) => `admin.coverage.stage.${s ?? 'unknown'}` as MessageKey;

const STATUS: Record<EngineReading['status'], { cls: string; key: MessageKey }> = {
  scripted: { cls: 'cov-scripted', key: 'admin.coverage.statusScripted' },
  auto: { cls: 'cov-scripted', key: 'admin.coverage.statusAuto' },
  vanilla: { cls: 'cov-vanilla', key: 'admin.coverage.statusVanilla' },
  partial: { cls: 'cov-partial', key: 'admin.coverage.statusPartial' },
  manual: { cls: 'cov-manual', key: 'admin.coverage.statusManual' },
};

/** Situação da carta para o leitor (automática, parcial, manual…). */
export function StatusChip({ status }: { status: EngineReading['status'] }) {
  const t = useT();
  const s = STATUS[status];
  return <span className={`gap-chip ${s.cls}`}>{t(s.key)}</span>;
}

/** A linha da carta com o trecho onde o leitor parou destacado (quando ele aparece igual na linha). */
export function Line({ l }: { l: GapLine }) {
  const t = useT();
  const at = l.ok || !l.fragment ? -1 : l.line.toLowerCase().indexOf(l.fragment.toLowerCase());
  return (
    <li className={l.ok ? 'gap-line ok' : 'gap-line gap'}>
      <span className="gap-mark" title={t(l.ok ? 'admin.coverage.lineOk' : 'admin.coverage.lineGap')}>
        {l.ok ? '✓' : '✗'}
      </span>
      <span>
        {at < 0 ? (
          l.line
        ) : (
          <>
            {l.line.slice(0, at)}
            <mark>{l.line.slice(at, at + l.fragment!.length)}</mark>
            {l.line.slice(at + l.fragment!.length)}
          </>
        )}
        {!l.ok && (
          <span className="gap-where">
            {t('admin.coverage.stoppedAt', { stage: t(stageKey(l.stage)) })} <code>{l.fragment}</code>
          </span>
        )}
      </span>
    </li>
  );
}

export function Lines({ lines }: { lines: GapLine[] }) {
  return (
    <ul className="gap-lines">
      {lines.map((l, i) => (
        <Line key={i} l={l} />
      ))}
    </ul>
  );
}
