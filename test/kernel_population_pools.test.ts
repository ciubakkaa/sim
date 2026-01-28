/**
 * Tests for population pools (kernel/population/pools.ts).
 * 
 * Tests cover:
 * - Pool state management (CRUD operations)
 * - Pool creation from cohorts and settlements
 * - Proportion utilities (normalization, validation)
 * - Pool metrics and tier calculations
 * - Population transfers
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type PopulationPool,
  type PoolState,
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
} from "../src/kernel/population/pools";

import type { Cohorts, SettlementSiteState } from "../src/sim/types";

// ============================================================================
// State Management Tests
// ============================================================================

describe("pool state management", () => {
  it("creates empty pool state", () => {
    const state = createEmptyPoolState();
    assert.deepStrictEqual(state, { pools: {} });
  });

  it("sets and gets a pool", () => {
    let state = createEmptyPoolState();
    const pool: PopulationPool = { siteId: "town-1", count: 100 };
    
    state = setPool(state, pool);
    
    const retrieved = getPool(state, "town-1");
    assert.deepStrictEqual(retrieved, pool);
  });

  it("returns undefined for nonexistent pool", () => {
    const state = createEmptyPoolState();
    assert.strictEqual(getPool(state, "nonexistent"), undefined);
  });

  it("removes a pool", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    state = setPool(state, { siteId: "town-2", count: 200 });
    
    state = removePool(state, "town-1");
    
    assert.strictEqual(getPool(state, "town-1"), undefined);
    assert.notStrictEqual(getPool(state, "town-2"), undefined);
  });

  it("adjusts pool count positively", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    
    state = adjustPoolCount(state, "town-1", 50);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 150);
  });

  it("adjusts pool count negatively", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    
    state = adjustPoolCount(state, "town-1", -30);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 70);
  });

  it("clamps negative adjustment to zero", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 50 });
    
    state = adjustPoolCount(state, "town-1", -100);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 0);
  });

  it("creates pool on positive adjustment if not exists", () => {
    let state = createEmptyPoolState();
    
    state = adjustPoolCount(state, "new-town", 75);
    
    assert.strictEqual(getPool(state, "new-town")?.count, 75);
  });

  it("does nothing on negative adjustment for nonexistent pool", () => {
    let state = createEmptyPoolState();
    
    state = adjustPoolCount(state, "nonexistent", -50);
    
    assert.strictEqual(getPool(state, "nonexistent"), undefined);
  });
});

// ============================================================================
// Pool Creation Tests
// ============================================================================

describe("pool creation from cohorts", () => {
  it("creates pool from cohorts with age tier", () => {
    const cohorts: Cohorts = { children: 100, adults: 300, elders: 100 };
    
    const pool = createPoolFromCohorts("town-1", cohorts);
    
    assert.strictEqual(pool.siteId, "town-1");
    assert.strictEqual(pool.count, 500);
    assert.ok(pool.ageTier);
    assert.strictEqual(pool.ageTier.children, 0.2);
    assert.strictEqual(pool.ageTier.adults, 0.6);
    assert.strictEqual(pool.ageTier.elders, 0.2);
  });

  it("handles empty cohorts", () => {
    const cohorts: Cohorts = { children: 0, adults: 0, elders: 0 };
    
    const pool = createPoolFromCohorts("town-1", cohorts);
    
    assert.strictEqual(pool.count, 0);
    assert.strictEqual(pool.ageTier, undefined);
  });

  it("creates pool from settlement with health tier", () => {
    const settlement = {
      id: "town-1",
      kind: "settlement",
      name: "Testville",
      culture: "human",
      cohorts: { children: 50, adults: 150, elders: 50 },
      sickness: 40,
      // Other required fields would be here
    } as SettlementSiteState;
    
    const pool = createPoolFromSettlement(settlement);
    
    assert.strictEqual(pool.count, 250);
    assert.ok(pool.healthTier);
    // sickness 40 → 40/200 = 0.2 sick
    assert.strictEqual(pool.healthTier.sick, 0.2);
    assert.strictEqual(pool.healthTier.healthy, 0.8);
  });

  it("caps health tier sick proportion at 0.5", () => {
    const settlement = {
      id: "town-1",
      kind: "settlement",
      name: "Plague Town",
      culture: "human",
      cohorts: { children: 10, adults: 40, elders: 10 },
      sickness: 100, // Max sickness
    } as SettlementSiteState;
    
    const pool = createPoolFromSettlement(settlement);
    
    assert.ok(pool.healthTier);
    assert.strictEqual(pool.healthTier.sick, 0.5);
    assert.strictEqual(pool.healthTier.healthy, 0.5);
  });
});

describe("pool initialization from world", () => {
  it("initializes pools from multiple settlements", () => {
    const sites = {
      "town-1": {
        id: "town-1",
        kind: "settlement",
        cohorts: { children: 100, adults: 200, elders: 50 },
        sickness: 20,
      },
      "town-2": {
        id: "town-2",
        kind: "settlement",
        cohorts: { children: 50, adults: 100, elders: 25 },
        sickness: 10,
      },
      "forest": {
        id: "forest",
        kind: "terrain",
      },
    };
    
    const state = initializePoolsFromWorld(sites as any);
    
    assert.strictEqual(Object.keys(state.pools).length, 2);
    assert.strictEqual(getPool(state, "town-1")?.count, 350);
    assert.strictEqual(getPool(state, "town-2")?.count, 175);
    assert.strictEqual(getPool(state, "forest"), undefined);
  });

  it("skips non-settlement sites", () => {
    const sites = {
      "wilderness": { id: "wilderness", kind: "terrain" },
      "hideout": { id: "hideout", kind: "hideout" },
    };
    
    const state = initializePoolsFromWorld(sites as any);
    
    assert.strictEqual(Object.keys(state.pools).length, 0);
  });
});

// ============================================================================
// Proportion Utilities Tests
// ============================================================================

describe("proportion utilities", () => {
  it("normalizes proportions that don't sum to 1", () => {
    const proportions = { a: 2, b: 3, c: 5 };
    
    const normalized = normalizeProportions(proportions);
    
    assert.strictEqual(normalized.a, 0.2);
    assert.strictEqual(normalized.b, 0.3);
    assert.strictEqual(normalized.c, 0.5);
  });

  it("returns original if already normalized", () => {
    const proportions = { a: 0.25, b: 0.25, c: 0.5 };
    
    const normalized = normalizeProportions(proportions);
    
    assert.strictEqual(normalized, proportions);
  });

  it("handles all-zero proportions by distributing evenly", () => {
    const proportions = { a: 0, b: 0, c: 0 };
    
    const normalized = normalizeProportions(proportions);
    
    const expected = 1 / 3;
    assert.ok(Math.abs(normalized.a - expected) < 0.0001);
    assert.ok(Math.abs(normalized.b - expected) < 0.0001);
    assert.ok(Math.abs(normalized.c - expected) < 0.0001);
  });

  it("validates correct proportions", () => {
    assert.strictEqual(validateProportions({ a: 0.5, b: 0.5 }), true);
    assert.strictEqual(validateProportions({ a: 0.33, b: 0.34, c: 0.33 }), true);
  });

  it("invalidates incorrect proportions", () => {
    assert.strictEqual(validateProportions({ a: 0.5, b: 0.6 }), false);
    assert.strictEqual(validateProportions({ a: 0.2, b: 0.2 }), false);
  });

  it("provides sensible default wealth tier", () => {
    const tier = defaultWealthTier();
    
    assert.strictEqual(validateProportions(tier), true);
    assert.ok(tier.poor > tier.middle);
    assert.ok(tier.middle > tier.wealthy);
  });

  it("provides sensible default health tier", () => {
    const tier = defaultHealthTier();
    
    assert.strictEqual(validateProportions(tier), true);
    assert.ok(tier.healthy > tier.sick);
  });
});

// ============================================================================
// Pool Metrics Tests
// ============================================================================

describe("pool metrics", () => {
  it("calculates total population across pools", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    state = setPool(state, { siteId: "town-2", count: 250 });
    state = setPool(state, { siteId: "town-3", count: 150 });
    
    assert.strictEqual(getTotalPopulation(state), 500);
  });

  it("returns zero for empty state", () => {
    const state = createEmptyPoolState();
    assert.strictEqual(getTotalPopulation(state), 0);
  });

  it("gets tier count for health", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 100,
      healthTier: { healthy: 0.8, sick: 0.2 },
    };
    
    assert.strictEqual(getPoolTierCount(pool, "health", "healthy"), 80);
    assert.strictEqual(getPoolTierCount(pool, "health", "sick"), 20);
  });

  it("gets tier count for wealth", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 1000,
      wealthTier: { poor: 0.6, middle: 0.3, wealthy: 0.1 },
    };
    
    assert.strictEqual(getPoolTierCount(pool, "wealth", "poor"), 600);
    assert.strictEqual(getPoolTierCount(pool, "wealth", "middle"), 300);
    assert.strictEqual(getPoolTierCount(pool, "wealth", "wealthy"), 100);
  });

  it("returns zero for missing tier", () => {
    const pool: PopulationPool = { siteId: "town-1", count: 100 };
    
    assert.strictEqual(getPoolTierCount(pool, "health", "healthy"), 0);
  });

  it("returns zero for undefined pool", () => {
    assert.strictEqual(getPoolTierCount(undefined, "health", "healthy"), 0);
  });

  it("converts pool to cohorts", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 500,
      ageTier: { children: 0.2, adults: 0.6, elders: 0.2 },
    };
    
    const cohorts = getPoolCohorts(pool);
    
    assert.ok(cohorts);
    assert.strictEqual(cohorts.children, 100);
    assert.strictEqual(cohorts.adults, 300);
    assert.strictEqual(cohorts.elders, 100);
  });

  it("returns null for pool without age tier", () => {
    const pool: PopulationPool = { siteId: "town-1", count: 100 };
    
    assert.strictEqual(getPoolCohorts(pool), null);
  });
});

// ============================================================================
// Pool Update Tests
// ============================================================================

describe("pool tier updates", () => {
  it("updates health tier with changes", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 100,
      healthTier: { healthy: 0.8, sick: 0.2 },
    };
    
    // 10 healthy become sick (disease outbreak)
    const updated = updatePoolTier(pool, "health", { healthy: -10, sick: 10 });
    
    assert.strictEqual(updated.count, 100); // Count unchanged
    assert.ok(updated.healthTier);
    assert.strictEqual(updated.healthTier.sick, 0.3);
    assert.strictEqual(updated.healthTier.healthy, 0.7);
  });

  it("handles population increase via tier update", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 100,
      ageTier: { children: 0.2, adults: 0.6, elders: 0.2 },
    };
    
    // 10 new children (births)
    const updated = updatePoolTier(pool, "age", { children: 10 });
    
    assert.strictEqual(updated.count, 110);
    assert.ok(updated.ageTier);
    // New proportions: children = 30/110, adults = 60/110, elders = 20/110
    assert.ok(Math.abs(updated.ageTier.children - 30 / 110) < 0.01);
  });

  it("handles population decrease via tier update", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 100,
      ageTier: { children: 0.2, adults: 0.6, elders: 0.2 },
    };
    
    // 10 elders die
    const updated = updatePoolTier(pool, "age", { elders: -10 });
    
    assert.strictEqual(updated.count, 90);
    assert.ok(updated.ageTier);
    // New proportions: children = 20/90, adults = 60/90, elders = 10/90
    assert.ok(Math.abs(updated.ageTier.elders - 10 / 90) < 0.01);
  });

  it("returns pool unchanged if tier missing", () => {
    const pool: PopulationPool = { siteId: "town-1", count: 100 };
    
    const updated = updatePoolTier(pool, "health", { healthy: -10 });
    
    assert.strictEqual(updated.count, 100);
    assert.strictEqual(updated.healthTier, undefined);
  });

  it("sets count to zero when all die", () => {
    const pool: PopulationPool = {
      siteId: "town-1",
      count: 50,
      ageTier: { children: 0.2, adults: 0.6, elders: 0.2 },
    };
    
    // Everyone dies
    const updated = updatePoolTier(pool, "age", { 
      children: -10, 
      adults: -30, 
      elders: -10 
    });
    
    assert.strictEqual(updated.count, 0);
  });
});

// ============================================================================
// Population Transfer Tests
// ============================================================================

describe("population transfers", () => {
  it("transfers population between existing pools", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    state = setPool(state, { siteId: "town-2", count: 50 });
    
    state = transferPopulation(state, "town-1", "town-2", 30);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 70);
    assert.strictEqual(getPool(state, "town-2")?.count, 80);
  });

  it("creates destination pool if not exists", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    
    state = transferPopulation(state, "town-1", "new-town", 25);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 75);
    assert.strictEqual(getPool(state, "new-town")?.count, 25);
  });

  it("caps transfer at source count", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 50 });
    state = setPool(state, { siteId: "town-2", count: 100 });
    
    state = transferPopulation(state, "town-1", "town-2", 100);
    
    assert.strictEqual(getPool(state, "town-1")?.count, 0);
    assert.strictEqual(getPool(state, "town-2")?.count, 150);
  });

  it("does nothing for zero or negative transfer", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-1", count: 100 });
    state = setPool(state, { siteId: "town-2", count: 50 });
    
    const state1 = transferPopulation(state, "town-1", "town-2", 0);
    const state2 = transferPopulation(state, "town-1", "town-2", -10);
    
    assert.strictEqual(getPool(state1, "town-1")?.count, 100);
    assert.strictEqual(getPool(state2, "town-1")?.count, 100);
  });

  it("does nothing if source pool missing", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { siteId: "town-2", count: 50 });
    
    state = transferPopulation(state, "nonexistent", "town-2", 30);
    
    assert.strictEqual(getPool(state, "town-2")?.count, 50);
  });

  it("copies tier data to new destination pool", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { 
      siteId: "town-1", 
      count: 100,
      healthTier: { healthy: 0.9, sick: 0.1 },
      wealthTier: { poor: 0.5, middle: 0.3, wealthy: 0.2 },
    });
    
    state = transferPopulation(state, "town-1", "new-town", 40);
    
    const newPool = getPool(state, "new-town");
    assert.ok(newPool);
    assert.ok(newPool.healthTier);
    assert.strictEqual(newPool.healthTier.healthy, 0.9);
    assert.ok(newPool.wealthTier);
    assert.strictEqual(newPool.wealthTier.poor, 0.5);
  });

  it("preserves existing destination tier data", () => {
    let state = createEmptyPoolState();
    state = setPool(state, { 
      siteId: "town-1", 
      count: 100,
      healthTier: { healthy: 0.9, sick: 0.1 },
    });
    state = setPool(state, { 
      siteId: "town-2", 
      count: 50,
      healthTier: { healthy: 0.7, sick: 0.3 },
    });
    
    state = transferPopulation(state, "town-1", "town-2", 30);
    
    // Destination keeps its own tier data (doesn't get overwritten)
    const destPool = getPool(state, "town-2");
    assert.ok(destPool?.healthTier);
    assert.strictEqual(destPool.healthTier.healthy, 0.7);
  });
});
