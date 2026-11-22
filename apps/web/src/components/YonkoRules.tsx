// Painel "Regras da mesa" do Yonko, comum à mesa local e à sala online: Vida extra, largada e recompensa por
// eliminação. O selo diz se a mesa está no manual do formato (docs/regras-yonko.md) ou em regra da casa.

import { type TableRules, YONKO_TABLE } from '@gumgum/engine';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

/** As regras do manual (sem recompensa por eliminação). */
export const MANUAL_RULES: TableRules = { ...YONKO_TABLE, eliminationDraw: 0 };

export const sameRules = (a: TableRules, b: TableRules) =>
  (a.extraLife ?? 0) === (b.extraLife ?? 0) && Boolean(a.curveChoice) === Boolean(b.curveChoice) && (a.eliminationDraw ?? 0) === (b.eliminationDraw ?? 0);

function Stepper({ value, min, max, onChange, label, plus, disabled }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string; plus?: boolean; disabled?: boolean }) {
  return (
    <span className="yk-step" role="group" aria-label={label}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label="−">
        −
      </button>
      <span className="v">{plus && value > 0 ? `+${value}` : value}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label="+">
        +
      </button>
    </span>
  );
}

function Option({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="yk-opt">
      <div className="t">
        {title}
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}

/** `editable`: quem pode mudar (na sala online, só quem criou a mesa). */
export function RulesPanel({ rules, editable, onChange, onBuildDecks }: { rules: TableRules; editable: boolean; onChange: (r: TableRules) => void; onBuildDecks: () => void }) {
  const t = useT();
  const manual = sameRules(rules, MANUAL_RULES);
  return (
    <section className="yk-panel">
      <div className="yk-panel-head">
        <h3>{t('yonko.rules')}</h3>
        <span className={['yk-chip', manual ? 'gold' : ''].join(' ')}>{manual ? t('yonko.rulesManual') : t('yonko.rulesHouse')}</span>
        {!manual && editable && (
          <button type="button" className="btn small" onClick={() => onChange(MANUAL_RULES)}>
            {t('yonko.rulesReset')}
          </button>
        )}
        {!editable && <span className="muted small">{t('yonko.rulesHostOnly')}</span>}
      </div>
      <Option title={t('yonko.ruleLife')} hint={t('yonko.ruleLifeHint')}>
        <Stepper plus label={t('yonko.ruleLife')} value={rules.extraLife ?? 0} min={0} max={4} disabled={!editable} onChange={(n) => onChange({ ...rules, extraLife: n })} />
      </Option>
      <Option title={t('yonko.ruleCurve')} hint={t('yonko.ruleCurveHint')}>
        <div className="seg small" role="group" aria-label={t('yonko.ruleCurve')}>
          <button type="button" disabled={!editable} className={rules.curveChoice ? 'on' : ''} aria-pressed={Boolean(rules.curveChoice)} onClick={() => onChange({ ...rules, curveChoice: true })}>
            {t('yonko.ruleCurveChoice')}
          </button>
          <button type="button" disabled={!editable} className={!rules.curveChoice ? 'on' : ''} aria-pressed={!rules.curveChoice} onClick={() => onChange({ ...rules, curveChoice: false })}>
            {t('yonko.ruleCurveNormal')}
          </button>
        </div>
      </Option>
      <Option title={t('yonko.ruleReward')} hint={t('yonko.ruleRewardHint')}>
        <Stepper label={t('yonko.ruleReward')} value={rules.eliminationDraw ?? 0} min={0} max={2} disabled={!editable} onChange={(n) => onChange({ ...rules, eliminationDraw: n })} />
      </Option>
      <Option title={t('yonko.ruleDeck')} hint={t('yonko.ruleDeckHint')}>
        <button type="button" className="btn small" onClick={onBuildDecks}>
          {t('yonko.buildDecks')}
        </button>
      </Option>
    </section>
  );
}
