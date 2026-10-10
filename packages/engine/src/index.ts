export * from './types';
export * from './engine';
export * from './actions';
export { chooseBotAction as chooseSimpleBotAction } from './bot/simple';
export { BOT_LEVELS, type BotLevel, chooseBotAction, LEVELS as BOT_LEVEL_OPTIONS, planAction, type PlannerOptions, plannerOptions, resetPlanner } from './bot/planner';
export { DEFAULT_WEIGHTS as BOT_WEIGHTS, evaluate, type Weights as BotWeights } from './bot/evaluate';
export {
  automationStatus,
  buildCardDef,
  detectKeywords,
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
export * from './formats';
export { normalizeTypeQuotes } from './text';
export * from './view';
export * from './status';
export * from './replay';
export { applyErrata, errataFor, ERRATA, type Errata, fixCard } from './errata';
export { applySourceFixes, SOURCE_FIXES, SOURCE_TEXT_FIXES, type SourceFix } from './source-fixes';
