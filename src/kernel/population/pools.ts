/**
 * Population pools model for unnamed background population.
 * 
 * Simple v0 implementation - just count + optional proportions.
 * Fancy distributions can come later.
 * 
 * Population pools represent the "background" inhabitants of a settlement
 * that don't have individual NPC records. They're tracked as aggregate
 * counts with optional demographic breakdowns.
 */

import type { SiteId, Cohorts, SettlementSiteState } from "../../sim/types";

/**
 * Health tier proportions (must sum to 1.0).
 */
export interface HealthTier {
  healthy: number;
  sick: number;
  [key: string]: number;  // Index signature for Record<string, number> compatibility
}

/**
 * Wealth tier proportions (must sum to 1.0).
 */
export interface WealthTier {
  poor: number;
  middle: number;
  wealthy: number;
  [key: string]: number;  // Index signature for Record<string, number> compatibility
}

/**
 * Age tier proportions derived from cohorts (must sum to 1.0).
 */
export interface AgeTier {
  children: number;
  adults: number;
  elders: number;
  [key: string]: number;  // Index signature for Record<string, number> compatibility
}

/**
 * A population pool representing unnamed background population at a site.
 * 
 * The count is the total number of individuals.
 * Optional proportion tiers allow sampling individuals with specific traits.
 */
export interface PopulationPool {
  siteId: SiteId;
  count: number;
  
  // Optional proportions for demographic sampling
  healthTier?: HealthTier;
  wealthTier?: WealthTier;
  ageTier?: AgeTier;
}

/**
 * State container for all population pools, indexed by site ID.
 */
export interface PoolState {
  pools: Record<SiteId, PopulationPool>;
}

// ============================================================================
// State Management
// ============================================================================

export function createEmptyPoolState(): PoolState {
  return { pools: {} };
}

export function getPool(state: PoolState, siteId: SiteId): PopulationPool | undefined {
  return state.pools[siteId];
}

export function setPool(state: PoolState, pool: PopulationPool): PoolState {
  return {
    ...state,
    pools: {
      ...state.pools,
      [pool.siteId]: pool,
    },
  };
}

export function removePool(state: PoolState, siteId: SiteId): PoolState {
  const { [siteId]: _, ...rest } = state.pools;
  return { pools: rest };
}

export function adjustPoolCount(state: PoolState, siteId: SiteId, delta: number): PoolState {
  const existing = state.pools[siteId];
  if (!existing) {
    if (delta <= 0) return state;
    return setPool(state, { siteId, count: delta });
  }
  
  const newCount = Math.max(0, existing.count + delta);
  return setPool(state, { ...existing, count: newCount });
}

// ============================================================================
// Pool Creation from Settlement Data
// ============================================================================

/**
 * Create a population pool from settlement cohorts.
 * Converts cohort counts into pool count + age tier proportions.
 */
export function createPoolFromCohorts(siteId: SiteId, cohorts: Cohorts): PopulationPool {
  const total = cohorts.children + cohorts.adults + cohorts.elders;
  
  if (total <= 0) {
    return { siteId, count: 0 };
  }
  
  return {
    siteId,
    count: total,
    ageTier: {
      children: cohorts.children / total,
      adults: cohorts.adults / total,
      elders: cohorts.elders / total,
    },
  };
}

/**
 * Create a population pool from a settlement's current state.
 * Includes age tier proportions and derives health tier from sickness level.
 */
export function createPoolFromSettlement(settlement: SettlementSiteState): PopulationPool {
  const pool = createPoolFromCohorts(settlement.id, settlement.cohorts);
  
  if (pool.count <= 0) {
    return pool;
  }
  
  // Derive health tier from settlement sickness (0-100)
  // sickness 0 = 95% healthy, sickness 100 = 50% healthy
  const sickProportion = Math.min(0.5, settlement.sickness / 200);
  pool.healthTier = {
    healthy: 1 - sickProportion,
    sick: sickProportion,
  };
  
  return pool;
}

/**
 * Initialize pool state from all settlements in a world.
 * Returns a new PoolState with pools for each settlement.
 */
export function initializePoolsFromWorld(
  sites: Record<SiteId, { kind: string; id: SiteId; cohorts?: Cohorts; sickness?: number }>
): PoolState {
  let state = createEmptyPoolState();
  
  for (const site of Object.values(sites)) {
    if (site.kind === "settlement" && site.cohorts) {
      const pool = createPoolFromCohorts(site.id, site.cohorts);
      
      // Add health tier if sickness data available
      if (pool.count > 0 && typeof site.sickness === "number") {
        const sickProportion = Math.min(0.5, site.sickness / 200);
        pool.healthTier = {
          healthy: 1 - sickProportion,
          sick: sickProportion,
        };
      }
      
      state = setPool(state, pool);
    }
  }
  
  return state;
}

// ============================================================================
// Proportion Utilities
// ============================================================================

/**
 * Normalize proportions to sum to 1.0.
 * Returns the original object if already normalized.
 */
export function normalizeProportions<T extends Record<string, number>>(proportions: T): T {
  const sum = Object.values(proportions).reduce((a, b) => a + b, 0);
  
  if (sum === 0) {
    // Distribute evenly if all zero
    const keys = Object.keys(proportions);
    const evenProportion = 1 / keys.length;
    return Object.fromEntries(keys.map(k => [k, evenProportion])) as T;
  }
  
  if (Math.abs(sum - 1) < 0.0001) {
    return proportions; // Already normalized
  }
  
  return Object.fromEntries(
    Object.entries(proportions).map(([k, v]) => [k, v / sum])
  ) as T;
}

/**
 * Validate that proportions sum to approximately 1.0.
 */
export function validateProportions(proportions: Record<string, number>): boolean {
  const sum = Object.values(proportions).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < 0.01;
}

/**
 * Create default wealth tier proportions.
 * Typical medieval distribution: more poor, fewer wealthy.
 */
export function defaultWealthTier(): WealthTier {
  return {
    poor: 0.6,
    middle: 0.3,
    wealthy: 0.1,
  };
}

/**
 * Create default health tier proportions.
 * Most people are healthy.
 */
export function defaultHealthTier(): HealthTier {
  return {
    healthy: 0.85,
    sick: 0.15,
  };
}

// ============================================================================
// Pool Metrics
// ============================================================================

/**
 * Get total population across all pools.
 */
export function getTotalPopulation(state: PoolState): number {
  return Object.values(state.pools).reduce((sum, pool) => sum + pool.count, 0);
}

/**
 * Get count of a specific tier category from a pool.
 * Returns 0 if the tier or pool doesn't exist.
 */
export function getPoolTierCount(
  pool: PopulationPool | undefined,
  tier: "health" | "wealth" | "age",
  category: string
): number {
  if (!pool || pool.count === 0) return 0;
  
  let proportions: Record<string, number> | undefined;
  
  switch (tier) {
    case "health":
      proportions = pool.healthTier;
      break;
    case "wealth":
      proportions = pool.wealthTier;
      break;
    case "age":
      proportions = pool.ageTier;
      break;
  }
  
  if (!proportions || !(category in proportions)) {
    return 0;
  }
  
  return Math.round(pool.count * proportions[category]);
}

/**
 * Get cohort breakdown from a pool's age tier.
 * Returns null if age tier is not defined.
 */
export function getPoolCohorts(pool: PopulationPool): Cohorts | null {
  if (!pool.ageTier || pool.count === 0) {
    return null;
  }
  
  return {
    children: Math.round(pool.count * pool.ageTier.children),
    adults: Math.round(pool.count * pool.ageTier.adults),
    elders: Math.round(pool.count * pool.ageTier.elders),
  };
}

// ============================================================================
// Pool Updates for Demographics
// ============================================================================

/**
 * Update pool proportions when demographics change.
 * Recalculates proportions based on absolute changes.
 * 
 * @param pool - The pool to update
 * @param tier - Which tier to update
 * @param changes - Absolute count changes per category (can be negative)
 */
export function updatePoolTier<T extends "health" | "wealth" | "age">(
  pool: PopulationPool,
  tier: T,
  changes: T extends "health" ? Partial<HealthTier> : T extends "wealth" ? Partial<WealthTier> : Partial<AgeTier>
): PopulationPool {
  const tierKey = `${tier}Tier` as const;
  const existingTier = pool[tierKey as keyof PopulationPool] as Record<string, number> | undefined;
  
  if (!existingTier) {
    return pool;
  }
  
  // Convert proportions to absolute counts
  const counts: Record<string, number> = {};
  for (const [key, proportion] of Object.entries(existingTier)) {
    counts[key] = Math.round(pool.count * proportion);
  }
  
  // Apply changes
  let totalDelta = 0;
  for (const [key, delta] of Object.entries(changes)) {
    if (typeof delta === "number") {
      counts[key] = Math.max(0, (counts[key] || 0) + delta);
      totalDelta += delta;
    }
  }
  
  // Calculate new total and proportions
  const newCount = Math.max(0, pool.count + totalDelta);
  
  if (newCount === 0) {
    return { ...pool, count: 0 };
  }
  
  const newProportions = Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, v / newCount])
  );
  
  return {
    ...pool,
    count: newCount,
    [tierKey]: normalizeProportions(newProportions),
  };
}

/**
 * Transfer population between pools.
 * Optionally transfer specific tier proportions.
 */
export function transferPopulation(
  state: PoolState,
  fromSiteId: SiteId,
  toSiteId: SiteId,
  count: number
): PoolState {
  const fromPool = state.pools[fromSiteId];
  const toPool = state.pools[toSiteId];
  
  if (!fromPool || count <= 0) {
    return state;
  }
  
  const actualCount = Math.min(count, fromPool.count);
  
  if (actualCount === 0) {
    return state;
  }
  
  // Update source pool
  const newFromPool: PopulationPool = {
    ...fromPool,
    count: fromPool.count - actualCount,
  };
  
  // Update destination pool (create if needed)
  const newToPool: PopulationPool = toPool
    ? { ...toPool, count: toPool.count + actualCount }
    : { siteId: toSiteId, count: actualCount };
  
  // If source has tier data and destination doesn't, copy proportions
  if (!newToPool.healthTier && fromPool.healthTier) {
    newToPool.healthTier = { ...fromPool.healthTier };
  }
  if (!newToPool.wealthTier && fromPool.wealthTier) {
    newToPool.wealthTier = { ...fromPool.wealthTier };
  }
  if (!newToPool.ageTier && fromPool.ageTier) {
    newToPool.ageTier = { ...fromPool.ageTier };
  }
  
  return {
    pools: {
      ...state.pools,
      [fromSiteId]: newFromPool,
      [toSiteId]: newToPool,
    },
  };
}
