/**
 * Kernel v0.1: Setting-agnostic simulation core.
 * 
 * Provides:
 * - Stable RNG (order-independent)
 * - Event bus with causality tracking
 * - Decision traces (separate stream)
 * - Module hook system
 * - Population pools + promotion
 */

// Core types
export * from "./kernelTypes";
export * from "./hooks";

// Hash utilities
export { stableHash, stableHashHex } from "./hash";

// Stable RNG
export { 
  stableRollId, 
  stableChance, 
  stableInt, 
  stableFloat,
  createStableRng,
  type StableRollParams,
} from "./stableRng";

// Events
export { EventBus } from "./events/eventBus";
export { stableEventId, type EventIdParams, type LocalEventIdParams, type GlobalEventIdParams } from "./events/stableId";
export { type KernelEvent, type EventFilter } from "./events/eventTypes";
export { computeSemanticDigest, type DigestableEvent } from "./events/digest";

// Traces
export { TraceLog } from "./traces/traceLog";
export { type DecisionTrace, type DecisionReason } from "./traces/traceTypes";

// Module system
export { ModuleRegistry, selectAction } from "./moduleRegistry";

// Population
export { 
  type PopulationPool, 
  type PoolState,
  type HealthTier,
  type WealthTier,
  type AgeTier,
  createEmptyPoolState,
  getPool,
  setPool,
  removePool,
  adjustPoolCount,
  createPoolFromCohorts,
  createPoolFromSettlement,
  initializePoolsFromWorld,
  normalizeProportions,
  validateProportions,
  defaultWealthTier,
  defaultHealthTier,
  getTotalPopulation,
  getPoolTierCount,
  getPoolCohorts,
  updatePoolTier,
  transferPopulation,
} from "./population/pools";

export {
  type RoleSlot,
  type TraineeState,
  type PromotionConfig,
  type PromotionState,
  type PromotionResult,
  type PromotionEvent,
  type CandidateSample,
  type CandidateSampleParams,
  DEFAULT_PROMOTION_CONFIG,
  ROLE_TRAIT_BIASES,
  ROLE_TO_CATEGORY,
  DEFAULT_ROLE_DISTRIBUTION,
  createEmptyPromotionState,
  initializeRoleSlotsFromWorld,
  getRolePriority,
  findVacancies,
  siteNeedsPromotion,
  getDeadEntityIds,
  sampleCandidate,
  createTrainee,
  advanceTraining,
  isTrainingComplete,
  assignMentor,
  findMentor,
  checkPromotions,
  applyGraduation,
} from "./population/promotion";
