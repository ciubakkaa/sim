/**
 * Tests for the kernel's StableRoll API.
 * 
 * The StableRoll API provides order-independent RNG for deterministic simulations.
 * Roll outcomes depend on semantic parameters (tick, siteId, agentId, purpose),
 * not on the order of RNG calls.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { 
  stableRollId, 
  stableChance, 
  stableInt, 
  stableFloat,
  createStableRng,
  type StableRollParams,
} from "../src/kernel/stableRng";
import { stableHash, stableHashHex } from "../src/kernel/hash";

describe("stableHash", () => {
  it("produces consistent hashes for the same input", () => {
    const hash1 = stableHash(["test", 123, "value"]);
    const hash2 = stableHash(["test", 123, "value"]);
    assert.equal(hash1, hash2);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = stableHash(["test", 123]);
    const hash2 = stableHash(["test", 124]);
    assert.notEqual(hash1, hash2);
  });

  it("handles undefined values by filtering them", () => {
    const hash1 = stableHash(["test", undefined, 123]);
    const hash2 = stableHash(["test", 123]);
    assert.equal(hash1, hash2);
  });

  it("produces 32-bit unsigned integers", () => {
    const hash = stableHash(["any", "input", "here"]);
    assert.ok(hash >= 0);
    assert.ok(hash <= 0xffffffff);
    assert.equal(hash, hash >>> 0); // unsigned
  });

  it("has good distribution (avalanche property)", () => {
    // Small input change should cause large hash change
    const hash1 = stableHash(["input1"]);
    const hash2 = stableHash(["input2"]);
    
    // Count differing bits
    const xor = hash1 ^ hash2;
    let differentBits = 0;
    for (let i = 0; i < 32; i++) {
      if (xor & (1 << i)) differentBits++;
    }
    
    // Expect roughly half the bits to differ (avalanche)
    // Allow range of 8-24 bits to account for randomness
    assert.ok(differentBits >= 8, `Expected at least 8 bits to differ, got ${differentBits}`);
    assert.ok(differentBits <= 24, `Expected at most 24 bits to differ, got ${differentBits}`);
  });

  it("produces hex string of correct length", () => {
    const hex = stableHashHex(["test", 123]);
    assert.equal(hex.length, 8);
    assert.ok(/^[0-9a-f]{8}$/.test(hex));
  });
});

describe("stableRollId", () => {
  it("generates consistent IDs for the same parameters", () => {
    const params: StableRollParams = {
      tick: 100,
      siteId: "village1",
      agentId: "npc:1",
      purpose: "combat.hit",
    };
    
    const id1 = stableRollId(params);
    const id2 = stableRollId(params);
    assert.equal(id1, id2);
  });

  it("generates different IDs for different ticks", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", purpose: "test" });
    const id2 = stableRollId({ tick: 101, siteId: "village1", purpose: "test" });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different sites", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", purpose: "test" });
    const id2 = stableRollId({ tick: 100, siteId: "village2", purpose: "test" });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different purposes", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", purpose: "combat.hit" });
    const id2 = stableRollId({ tick: 100, siteId: "village1", purpose: "combat.damage" });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different agents", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", agentId: "npc:1", purpose: "test" });
    const id2 = stableRollId({ tick: 100, siteId: "village1", agentId: "npc:2", purpose: "test" });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different targets", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", targetId: "npc:1", purpose: "test" });
    const id2 = stableRollId({ tick: 100, siteId: "village1", targetId: "npc:2", purpose: "test" });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different action kinds", () => {
    const id1 = stableRollId({ tick: 100, siteId: "village1", actionKind: "steal", purpose: "test" });
    const id2 = stableRollId({ tick: 100, siteId: "village1", actionKind: "assault", purpose: "test" });
    assert.notEqual(id1, id2);
  });
});

describe("stableChance", () => {
  it("returns deterministic results for the same rollId", () => {
    const seed = 12345;
    const rollId = "test-roll-1";
    
    const result1 = stableChance(seed, rollId, 0.5);
    const result2 = stableChance(seed, rollId, 0.5);
    assert.equal(result1, result2);
  });

  it("returns different results for different rollIds", () => {
    const seed = 12345;
    
    // With enough different rollIds, we should see both true and false
    const results = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
      results.add(stableChance(seed, `roll-${i}`, 0.5));
    }
    
    assert.ok(results.has(true), "Expected some true results");
    assert.ok(results.has(false), "Expected some false results");
  });

  it("returns different results for different seeds", () => {
    const rollId = "test-roll";
    
    // With different seeds, we should see variation
    const results = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
      results.add(stableChance(i, rollId, 0.5));
    }
    
    assert.ok(results.has(true), "Expected some true results");
    assert.ok(results.has(false), "Expected some false results");
  });

  it("always returns false for p=0", () => {
    for (let i = 0; i < 100; i++) {
      assert.equal(stableChance(i, `roll-${i}`, 0), false);
    }
  });

  it("always returns true for p=1", () => {
    for (let i = 0; i < 100; i++) {
      assert.equal(stableChance(i, `roll-${i}`, 1), true);
    }
  });

  it("respects probability distribution approximately", () => {
    const seed = 42;
    const trials = 10000;
    const p = 0.3;
    
    let successes = 0;
    for (let i = 0; i < trials; i++) {
      if (stableChance(seed, `trial-${i}`, p)) {
        successes++;
      }
    }
    
    const observed = successes / trials;
    // Allow 5% deviation from expected
    assert.ok(observed > p - 0.05, `Expected ~${p}, got ${observed}`);
    assert.ok(observed < p + 0.05, `Expected ~${p}, got ${observed}`);
  });

  it("is order-independent (key feature)", () => {
    const seed = 12345;
    
    // Simulate calling in different orders
    const resultsOrder1 = {
      a: stableChance(seed, "roll-a", 0.5),
      b: stableChance(seed, "roll-b", 0.5),
      c: stableChance(seed, "roll-c", 0.5),
    };
    
    // Different call order
    const resultsOrder2 = {
      c: stableChance(seed, "roll-c", 0.5),
      a: stableChance(seed, "roll-a", 0.5),
      b: stableChance(seed, "roll-b", 0.5),
    };
    
    assert.deepEqual(resultsOrder1, resultsOrder2);
  });
});

describe("stableInt", () => {
  it("returns deterministic results for the same rollId", () => {
    const seed = 12345;
    const rollId = "test-roll";
    
    const result1 = stableInt(seed, rollId, 1, 100);
    const result2 = stableInt(seed, rollId, 1, 100);
    assert.equal(result1, result2);
  });

  it("returns values within the specified range (inclusive)", () => {
    const seed = 42;
    const min = 10;
    const max = 20;
    
    for (let i = 0; i < 1000; i++) {
      const result = stableInt(seed, `roll-${i}`, min, max);
      assert.ok(result >= min, `${result} < ${min}`);
      assert.ok(result <= max, `${result} > ${max}`);
    }
  });

  it("produces reasonable distribution across range", () => {
    const seed = 42;
    const min = 1;
    const max = 10;
    const counts = new Map<number, number>();
    const trials = 10000;
    
    for (let i = 0; i < trials; i++) {
      const result = stableInt(seed, `roll-${i}`, min, max);
      counts.set(result, (counts.get(result) || 0) + 1);
    }
    
    // All values should appear
    for (let v = min; v <= max; v++) {
      const count = counts.get(v) || 0;
      const expected = trials / (max - min + 1);
      // Allow 30% deviation
      assert.ok(count > expected * 0.7, `Value ${v} appeared ${count} times, expected ~${expected}`);
      assert.ok(count < expected * 1.3, `Value ${v} appeared ${count} times, expected ~${expected}`);
    }
  });

  it("is order-independent", () => {
    const seed = 12345;
    
    const resultsOrder1 = {
      a: stableInt(seed, "roll-a", 1, 100),
      b: stableInt(seed, "roll-b", 1, 100),
      c: stableInt(seed, "roll-c", 1, 100),
    };
    
    const resultsOrder2 = {
      c: stableInt(seed, "roll-c", 1, 100),
      a: stableInt(seed, "roll-a", 1, 100),
      b: stableInt(seed, "roll-b", 1, 100),
    };
    
    assert.deepEqual(resultsOrder1, resultsOrder2);
  });
});

describe("stableFloat", () => {
  it("returns deterministic results for the same rollId", () => {
    const seed = 12345;
    const rollId = "test-roll";
    
    const result1 = stableFloat(seed, rollId, 0, 1);
    const result2 = stableFloat(seed, rollId, 0, 1);
    assert.equal(result1, result2);
  });

  it("returns values within the specified range", () => {
    const seed = 42;
    const min = 5.5;
    const max = 10.5;
    
    for (let i = 0; i < 1000; i++) {
      const result = stableFloat(seed, `roll-${i}`, min, max);
      assert.ok(result >= min, `${result} < ${min}`);
      assert.ok(result < max, `${result} >= ${max}`); // exclusive upper bound
    }
  });

  it("produces values across the range", () => {
    const seed = 42;
    const min = 0;
    const max = 100;
    
    let sawLow = false;
    let sawMid = false;
    let sawHigh = false;
    
    for (let i = 0; i < 1000; i++) {
      const result = stableFloat(seed, `roll-${i}`, min, max);
      if (result < 33) sawLow = true;
      else if (result < 66) sawMid = true;
      else sawHigh = true;
    }
    
    assert.ok(sawLow, "Expected some low values");
    assert.ok(sawMid, "Expected some mid values");
    assert.ok(sawHigh, "Expected some high values");
  });
});

describe("createStableRng", () => {
  it("creates a bound context with the seed", () => {
    const rng = createStableRng(12345);
    
    // Test that the bound methods work
    const chanceResult = rng.chance("test-roll", 0.5);
    const intResult = rng.int("test-roll", 1, 10);
    const floatResult = rng.float("test-roll", 0, 1);
    
    // Verify determinism
    const rng2 = createStableRng(12345);
    assert.equal(rng2.chance("test-roll", 0.5), chanceResult);
    assert.equal(rng2.int("test-roll", 1, 10), intResult);
    assert.equal(rng2.float("test-roll", 0, 1), floatResult);
  });

  it("provides rollId helper that works with other methods", () => {
    const rng = createStableRng(42);
    
    const rollId = rng.rollId({
      tick: 100,
      siteId: "village1",
      agentId: "npc:1",
      purpose: "combat.hit",
    });
    
    // Use the rollId with chance
    const result = rng.chance(rollId, 0.5);
    
    // Same rollId should give same result
    assert.equal(rng.chance(rollId, 0.5), result);
  });

  it("different seeds produce different results", () => {
    const rng1 = createStableRng(1);
    const rng2 = createStableRng(2);
    
    const rollId = "same-roll-id";
    
    // Collect results
    const results1: number[] = [];
    const results2: number[] = [];
    
    for (let i = 0; i < 100; i++) {
      results1.push(rng1.int(`${rollId}-${i}`, 1, 1000));
      results2.push(rng2.int(`${rollId}-${i}`, 1, 1000));
    }
    
    // Results should be different
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (results1[i] !== results2[i]) differences++;
    }
    
    // Most should be different
    assert.ok(differences > 90, `Expected most results to differ, got ${differences}/100`);
  });
});

describe("integration: StableRoll with simulation semantics", () => {
  it("same tick/site/agent/purpose always gives same roll", () => {
    const seed = 42;
    
    for (let trial = 0; trial < 10; trial++) {
      const rollId = stableRollId({
        tick: 100,
        siteId: "village1",
        agentId: "npc:5",
        purpose: "steal.spotted",
      });
      
      const result = stableChance(seed, rollId, 0.3);
      
      // Same parameters, same result
      const rollId2 = stableRollId({
        tick: 100,
        siteId: "village1",
        agentId: "npc:5",
        purpose: "steal.spotted",
      });
      
      assert.equal(rollId, rollId2);
      assert.equal(stableChance(seed, rollId2, 0.3), result);
    }
  });

  it("different towns get different rolls for same action", () => {
    const seed = 42;
    
    const rollIdVillage1 = stableRollId({
      tick: 100,
      siteId: "village1",
      agentId: "npc:1",
      purpose: "steal.spotted",
    });
    
    const rollIdVillage2 = stableRollId({
      tick: 100,
      siteId: "village2",
      agentId: "npc:1", // Same agent ID but different site
      purpose: "steal.spotted",
    });
    
    assert.notEqual(rollIdVillage1, rollIdVillage2);
  });

  it("follows purpose naming convention: {domain}.{action}", () => {
    const seed = 42;
    const tick = 100;
    const siteId = "village1";
    const agentId = "npc:1";
    
    // These should all produce valid, different rollIds
    const purposes = [
      "combat.hit",
      "combat.damage.base",
      "steal.spotted",
      "recruit.success",
      "chase.escape.direction",
    ];
    
    const rollIds = purposes.map(purpose => 
      stableRollId({ tick, siteId, agentId, purpose })
    );
    
    // All should be unique
    const uniqueIds = new Set(rollIds);
    assert.equal(uniqueIds.size, purposes.length);
  });
});
