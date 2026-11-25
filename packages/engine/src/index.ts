export * from './types';
export * from './engine';
export * from './actions';
export { chooseBotAction as chooseSimpleBotAction } from './bot/simple';
export { BOT_LEVELS, type BotExplanation, type BotLevel, chooseBotAction, isBotLevel, LEVELS as BOT_LEVEL_OPTIONS, planAction, type PlannerOptions, plannerOptions, resetPlanner, sameAction, scoreDecision, type DecisionScore, type ScoredLine } from './bot/planner';
export {
  accuracyOf,
  ANALYSIS_LIMITS,
  ANALYSIS_VERSION,
  AnalysisError,
  type AnalysisOptions,
  type AnalysisSeverity,
  type AnalysisTag,
  analyzeReplay,
  decisionIndexes,
  type DecisionReview,
  isDecision,
  LOSS_CAP,
  type MatchAnalysis,
  type PlayerAnalysis,
  reviewDecision,
  severityOf,
  summarizeAnalysis,
} from './bot/analysis';
export { DEFAULT_WEIGHTS as BOT_WEIGHTS, type EvalTerms, evaluate, evaluateTerms, nextTurnPlay, type Weights as BotWeights } from './bot/evaluate';
export {
  ARCHETYPE_WEIGHTS,
  ARCHETYPES,
  type Archetype,
  CARD_ROLES,
  type CardRole,
  type DeckProfile,
  donInPlay,
  type HoldRule,
  keepHand,
  type MatchupRule,
  opponentLeader,
  type PlanStep,
  profileWeights,
  validateProfile,
} from './bot/profile';
export {
  automationStatus,
  buildCardDef,
  type CardDiagnosis,
  detectKeywords,
  diagnoseCard,
  forEngine,
  gapPattern,
  type GapStage,
  type LineDiagnosis,
  hasScript,
  manualAbilities,
  needsManual,
  parseCard,
  splitEffects,
  CARD_SCRIPTS,
  type AutomationStatus,
} from './cards';
export { translateToPt, type Translation } from './i18n/pt';
export { translateCardPt, type CardTranslation } from './i18n/render';
export * from './deck';
export * from './handtest';
export * from './formats';
export * from './sealed';
export * from './draft';
export * from './cube';
export type { RngHolder } from './rng';
export { normalizeTypeQuotes } from './text';
export * from './view';
export * from './art';
export * from './status';
export * from './replay';
export * from './clip';
export { createScenario, passiveAction, type ScenarioCard, type ScenarioSide, type ScenarioSpec } from './scenario';
export { applyErrata, errataFor, ERRATA, type Errata, fixCard } from './errata';
export { applySourceFixes, SOURCE_FIXES, SOURCE_TEXT_FIXES, type SourceFix } from './source-fixes';
export { freshTrigger, MOTION_SPOT_MS, motionHoldMs, type TriggerHit } from './motion';
