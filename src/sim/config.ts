/**
 * Simulation configuration
 * Controls feature flags and tuning parameters
 */

// =============================================================================
// CONFIGURATION TYPE
// =============================================================================

/** Complete simulation configuration */
export type SimConfig = {
  /** Tuning parameters */
  tuning: TuningParams;

  /** Performance limits */
  limits: PerformanceLimits;

  /** Debug options */
  debug: DebugOptions;
};

/** Tuning parameters */
export type TuningParams = {
  // Memory
  memoryDecayRate: number;
  memoryVividnessThreshold: number;
  memoryImportanceThreshold: number;

  // Emotions
  emotionDecayPerHour: number;
  stressDecayPerHour: number;
  baseEmotionIntensity: number;

  // Relationships
  relationshipDecayPerDay: number;
  debtDecayPerDay: number;
  relationshipChangeFromEvent: number;

  // Goals
  goalPriorityFromMemory: number;
  goalAbandonThreshold: number;
  maxGoalsPerEntity: number;

  // Planning
  planReplanThreshold: number;
  planStepTimeoutMultiplier: number;

  // Rumors
  rumorSpreadChance: number;
  rumorMutationChance: number;
  rumorDecayPerDay: number;

  // Economy
  baseFoodPrice: number;
  priceFluctuationRange: number;
  workIncomeMultiplier: number;

  // Notability
  notabilityDecayPerDay: number;
  notabilityFromDeed: number;
};

/** Performance limits */
export type PerformanceLimits = {
  maxMemoriesPerEntity: number;
  maxRelationshipsPerEntity: number;
  maxActiveGoals: number;
  maxPlanSteps: number;
  maxRumorsInWorld: number;
  maxNarratives: number;
  maxSecretsInWorld: number;
  maxEntitiesPerTick: number;
};

/** Debug options */
export type DebugOptions = {
  logMemoryFormation: boolean;
  logGoalFormation: boolean;
  logPlanCreation: boolean;
  logRelationshipChanges: boolean;
  logFactionDecisions: boolean;
  logNarrativeDetection: boolean;
  verboseEvents: boolean;
};

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

/** Default tuning parameters */
export const defaultTuning: TuningParams = {
  // Memory
  memoryDecayRate: 0.1,
  memoryVividnessThreshold: 10,
  memoryImportanceThreshold: 50,

  // Emotions
  emotionDecayPerHour: 2,
  stressDecayPerHour: 1,
  baseEmotionIntensity: 50,

  // Relationships
  relationshipDecayPerDay: 0.5,
  debtDecayPerDay: 0.1,
  relationshipChangeFromEvent: 15,

  // Goals
  goalPriorityFromMemory: 50,
  goalAbandonThreshold: 10,
  maxGoalsPerEntity: 5,

  // Planning
  planReplanThreshold: 3,
  planStepTimeoutMultiplier: 2,

  // Rumors
  rumorSpreadChance: 0.15,
  rumorMutationChance: 0.1,
  rumorDecayPerDay: 0.5,

  // Economy
  baseFoodPrice: 5,
  priceFluctuationRange: 0.5,
  workIncomeMultiplier: 1.0,

  // Notability
  notabilityDecayPerDay: 0.5,
  notabilityFromDeed: 10,
};

/** Default performance limits */
export const defaultLimits: PerformanceLimits = {
  maxMemoriesPerEntity: 100,
  maxRelationshipsPerEntity: 50,
  maxActiveGoals: 5,
  maxPlanSteps: 10,
  maxRumorsInWorld: 500,
  maxNarratives: 20,
  maxSecretsInWorld: 200,
  maxEntitiesPerTick: 1000,
};

/** Default debug options */
export const defaultDebug: DebugOptions = {
  logMemoryFormation: false,
  logGoalFormation: false,
  logPlanCreation: false,
  logRelationshipChanges: false,
  logFactionDecisions: false,
  logNarrativeDetection: false,
  verboseEvents: false,
};

/** Default complete configuration */
export const defaultConfig: SimConfig = {
  tuning: defaultTuning,
  limits: defaultLimits,
  debug: defaultDebug,
};

// =============================================================================
// CONFIGURATION HELPERS
// =============================================================================

/** Config override type allowing partial nested objects */
export type SimConfigOverrides = {
  tuning?: Partial<TuningParams>;
  limits?: Partial<PerformanceLimits>;
  debug?: Partial<DebugOptions>;
};

/** Create config with custom overrides */
export function createConfig(overrides: SimConfigOverrides = {}): SimConfig {
  return {
    tuning: { ...defaultTuning, ...overrides.tuning },
    limits: { ...defaultLimits, ...overrides.limits },
    debug: { ...defaultDebug, ...overrides.debug },
  };
}

/** Create config for testing (faster decay, smaller limits) */
export function createTestConfig(): SimConfig {
  return createConfig({
    tuning: {
      ...defaultTuning,
      memoryDecayRate: 1.0,
      emotionDecayPerHour: 10,
      relationshipDecayPerDay: 5,
      rumorDecayPerDay: 2,
    },
    limits: {
      ...defaultLimits,
      maxMemoriesPerEntity: 20,
      maxRelationshipsPerEntity: 10,
      maxRumorsInWorld: 50,
    },
    debug: {
      ...defaultDebug,
      logMemoryFormation: true,
      logGoalFormation: true,
    },
  });
}

// =============================================================================
// GLOBAL CONFIG (mutable singleton)
// =============================================================================

let currentConfig: SimConfig = defaultConfig;

/** Get current configuration */
export function getConfig(): SimConfig {
  return currentConfig;
}

/** Set current configuration */
export function setConfig(config: SimConfig): void {
  currentConfig = config;
}

/** Reset to default configuration */
export function resetConfig(): void {
  currentConfig = defaultConfig;
}

