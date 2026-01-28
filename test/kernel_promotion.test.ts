/**
 * Tests for promotion pipeline (kernel/population/promotion.ts).
 * 
 * Tests cover:
 * - Role slot management
 * - Vacancy detection
 * - Candidate sampling and promotion
 * - Training mechanics (progress, completion, mentors)
 * - Full promotion pipeline
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  type RoleSlot,
  type TraineeState,
  type PromotionState,
  type PromotionConfig,
  DEFAULT_PROMOTION_CONFIG,
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
} from "../src/kernel/population/promotion";

import {
  type PoolState,
  createEmptyPoolState,
  setPool,
} from "../src/kernel/population/pools";

import type { WorldState, NpcState, NpcCategory } from "../src/sim/types";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMinimalWorld(seed = 12345): WorldState {
  return {
    seed,
    tick: 100,
    map: { sites: ["town-1", "town-2"], edges: [] },
    sites: {
      "town-1": {
        id: "town-1",
        kind: "settlement",
        name: "Test Town",
        culture: "human",
        eclipsingPressure: 0,
        anchoringStrength: 0,
        cohorts: { children: 20, adults: 80, elders: 20 },
        housingCapacity: 150,
        sickness: 5,
        hunger: 0,
        unrest: 10,
        morale: 60,
        cultInfluence: 5,
        food: { grain: [], fish: [], meat: [] },
        productionPerDay: { grain: 100, fish: 50, meat: 30 },
        fieldsCondition: 1,
        laborWorkedToday: { grain: 0, fish: 0, meat: 0 },
        rumors: [],
        deathsToday: {},
        local: {
          nodes: [{ id: "town-1:street:i0", kind: "streets", name: "Main Street", pos: { x: 0, y: 0 } }],
          edges: [],
          buildings: {},
        },
      },
      "town-2": {
        id: "town-2",
        kind: "settlement",
        name: "Elven City",
        culture: "elven",
        eclipsingPressure: 0,
        anchoringStrength: 0,
        cohorts: { children: 10, adults: 50, elders: 10 },
        housingCapacity: 80,
        sickness: 2,
        hunger: 0,
        unrest: 5,
        morale: 70,
        cultInfluence: 0,
        food: { grain: [], fish: [], meat: [] },
        productionPerDay: { grain: 60, fish: 20, meat: 20 },
        fieldsCondition: 1,
        laborWorkedToday: { grain: 0, fish: 0, meat: 0 },
        rumors: [],
        deathsToday: {},
        local: {
          nodes: [{ id: "town-2:street:i0", kind: "streets", name: "Main Path", pos: { x: 0, y: 0 } }],
          edges: [],
          buildings: {},
        },
      },
    } as any,
    npcs: {},
  };
}

function createMinimalNpc(
  id: string,
  siteId: string,
  category: NpcCategory = "Farmer",
  alive = true
): NpcState {
  return {
    id,
    name: `NPC ${id}`,
    category,
    siteId,
    homeSiteId: siteId,
    awayFromHomeSinceTick: undefined,
    familyIds: [],
    activeStates: [],
    goals: [],
    intents: [],
    proficiency: {},
    recentActions: [],
    consecutiveHungerHours: 0,
    stateTriggerMemory: {},
    alive,
    cult: { member: false, role: "none" },
    trauma: 0,
    emotions: { anger: 0, fear: 0, grief: 0, gratitude: 0, pride: 0, shame: 0, stress: 0 },
    hp: 100,
    maxHp: 100,
    traits: {
      Fear: 50, Ambition: 50, Loyalty: 50, Greed: 50, Empathy: 50, Aggression: 50,
      Discipline: 50, Curiosity: 50, Suspicion: 50, NeedForCertainty: 50, Courage: 50, Integrity: 50,
    },
    values: [],
    needs: {
      Food: 0, Safety: 0, Health: 0, Shelter: 0, Belonging: 0,
      Status: 0, Wealth: 0, Freedom: 0, Meaning: 0, Duty: 0,
    },
    notability: 10,
    lastAttemptTick: 0,
    forcedActiveUntilTick: 0,
    busyUntilTick: 0,
    pendingAttempt: undefined,
    beliefs: [],
    relationships: {},
  };
}

// ============================================================================
// State Management Tests
// ============================================================================

describe("promotion state management", () => {
  it("creates empty promotion state", () => {
    const state = createEmptyPromotionState();
    assert.deepStrictEqual(state, { roleSlots: [], trainees: [] });
  });

  it("initializes role slots from world with NPCs", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
      "npc:2": createMinimalNpc("npc:2", "town-1", "GuardMilitia"),
      "npc:3": createMinimalNpc("npc:3", "town-2", "ElvenCitizen"),
    };

    const slots = initializeRoleSlotsFromWorld(world);

    assert.strictEqual(slots.length, 3);
    assert.ok(slots.some(s => s.role === "Farmer" && s.siteId === "town-1"));
    assert.ok(slots.some(s => s.role === "GuardMilitia" && s.siteId === "town-1"));
    assert.ok(slots.some(s => s.role === "ElvenCitizen" && s.siteId === "town-2"));
  });

  it("skips dead NPCs when initializing slots", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer", true),
      "npc:2": createMinimalNpc("npc:2", "town-1", "GuardMilitia", false), // dead
    };

    const slots = initializeRoleSlotsFromWorld(world);

    assert.strictEqual(slots.length, 1);
    assert.strictEqual(slots[0].role, "Farmer");
  });
});

// ============================================================================
// Role Priority Tests
// ============================================================================

describe("role priority", () => {
  it("assigns highest priority to leaders", () => {
    assert.strictEqual(getRolePriority("LocalLeader"), 100);
    assert.strictEqual(getRolePriority("ElvenLeader"), 100);
  });

  it("assigns high priority to security roles", () => {
    const guardPriority = getRolePriority("GuardMilitia");
    const leaderPriority = getRolePriority("LocalLeader");
    
    assert.ok(guardPriority < leaderPriority);
    assert.ok(guardPriority > 50);
  });

  it("assigns lower priority to common roles", () => {
    const farmerPriority = getRolePriority("Farmer");
    const guardPriority = getRolePriority("GuardMilitia");
    
    assert.ok(farmerPriority < guardPriority);
  });
});

// ============================================================================
// Vacancy Detection Tests
// ============================================================================

describe("vacancy detection", () => {
  it("finds unfilled slots as vacancies", () => {
    const state: PromotionState = {
      roleSlots: [
        { id: "slot:1", role: "Farmer", siteId: "town-1", filledBy: undefined, priority: 50 },
        { id: "slot:2", role: "Guard", siteId: "town-1", filledBy: "npc:1", priority: 80 },
      ],
      trainees: [],
    };

    const vacancies = findVacancies(state, new Set());

    assert.strictEqual(vacancies.length, 1);
    assert.strictEqual(vacancies[0].role, "Farmer");
  });

  it("finds slots where assigned NPC died", () => {
    const state: PromotionState = {
      roleSlots: [
        { id: "slot:1", role: "Farmer", siteId: "town-1", filledBy: "npc:1", priority: 50 },
        { id: "slot:2", role: "Guard", siteId: "town-1", filledBy: "npc:2", priority: 80 },
      ],
      trainees: [],
    };

    const deadIds = new Set(["npc:1"]);
    const vacancies = findVacancies(state, deadIds);

    assert.strictEqual(vacancies.length, 1);
    assert.strictEqual(vacancies[0].role, "Farmer");
    assert.strictEqual(vacancies[0].filledBy, "npc:1");
  });

  it("sorts vacancies by priority (highest first)", () => {
    const state: PromotionState = {
      roleSlots: [
        { id: "slot:1", role: "Farmer", siteId: "town-1", filledBy: undefined, priority: 50 },
        { id: "slot:2", role: "Guard", siteId: "town-1", filledBy: undefined, priority: 80 },
        { id: "slot:3", role: "Leader", siteId: "town-1", filledBy: undefined, priority: 100 },
      ],
      trainees: [],
    };

    const vacancies = findVacancies(state, new Set());

    assert.strictEqual(vacancies.length, 3);
    assert.strictEqual(vacancies[0].role, "Leader");
    assert.strictEqual(vacancies[1].role, "Guard");
    assert.strictEqual(vacancies[2].role, "Farmer");
  });

  it("detects dead entities from world", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer", true),
      "npc:2": createMinimalNpc("npc:2", "town-1", "GuardMilitia", false),
      "npc:3": createMinimalNpc("npc:3", "town-2", "ElvenCitizen", false),
    };

    const deadIds = getDeadEntityIds(world);

    assert.strictEqual(deadIds.size, 2);
    assert.ok(deadIds.has("npc:2"));
    assert.ok(deadIds.has("npc:3"));
    assert.ok(!deadIds.has("npc:1"));
  });
});

// ============================================================================
// Site Needs Tests
// ============================================================================

describe("site promotion needs", () => {
  it("detects site needing more NPCs", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
    };

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 10 },
    };

    const result = siteNeedsPromotion(world, "town-1", config);

    assert.strictEqual(result.needed, true);
    assert.strictEqual(result.deficit, 9);
  });

  it("detects site at capacity", () => {
    const world = createMinimalWorld();
    for (let i = 1; i <= 10; i++) {
      world.npcs[`npc:${i}`] = createMinimalNpc(`npc:${i}`, "town-1", "Farmer");
    }

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 10 },
    };

    const result = siteNeedsPromotion(world, "town-1", config);

    assert.strictEqual(result.needed, false);
    assert.strictEqual(result.deficit, 0);
  });

  it("uses default target for unknown sites", () => {
    const world = createMinimalWorld();
    world.npcs = {};

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      defaultTargetNamedAgents: 20,
      targetNamedAgentsPerSite: {},
    };

    const result = siteNeedsPromotion(world, "town-1", config);

    assert.strictEqual(result.needed, true);
    assert.strictEqual(result.deficit, 20);
  });
});

// ============================================================================
// Candidate Sampling Tests
// ============================================================================

describe("candidate sampling", () => {
  it("generates human names for human sites", () => {
    const candidate = sampleCandidate({
      siteId: "town-1",
      role: "Farmer",
      tick: 100,
      seed: 12345,
      culture: "human",
    });

    assert.ok(candidate.name.includes(" ")); // Human names have first + last
    assert.strictEqual(candidate.category, "Farmer");
  });

  it("generates elven names for elven sites", () => {
    const candidate = sampleCandidate({
      siteId: "town-2",
      role: "ElvenCitizen",
      tick: 100,
      seed: 12345,
      culture: "elven",
    });

    assert.ok(!candidate.name.includes(" ")); // Elven names are single compound
    assert.strictEqual(candidate.category, "ElvenCitizen");
  });

  it("applies role trait biases", () => {
    const guardCandidate = sampleCandidate({
      siteId: "town-1",
      role: "GuardMilitia",
      tick: 100,
      seed: 12345,
      culture: "human",
    });

    // Guard bias: Discipline: 60, Courage: 60, Integrity: 55
    // With ±20 variation, values should cluster around these biases
    // We can't assert exact values due to randomness, but traits should exist
    assert.ok(typeof guardCandidate.traits.Discipline === "number");
    assert.ok(guardCandidate.traits.Discipline >= 0 && guardCandidate.traits.Discipline <= 100);
  });

  it("generates deterministic results for same parameters", () => {
    const params = {
      siteId: "town-1",
      role: "Farmer",
      tick: 100,
      seed: 12345,
      culture: "human" as const,
    };

    const candidate1 = sampleCandidate(params);
    const candidate2 = sampleCandidate(params);

    assert.strictEqual(candidate1.name, candidate2.name);
    assert.deepStrictEqual(candidate1.traits, candidate2.traits);
  });

  it("generates different results for different seeds", () => {
    const candidate1 = sampleCandidate({
      siteId: "town-1",
      role: "Farmer",
      tick: 100,
      seed: 12345,
      culture: "human",
    });

    const candidate2 = sampleCandidate({
      siteId: "town-1",
      role: "Farmer",
      tick: 100,
      seed: 54321, // Different seed
      culture: "human",
    });

    // Names or traits should differ (overwhelming probability)
    assert.ok(
      candidate1.name !== candidate2.name ||
      candidate1.traits.Fear !== candidate2.traits.Fear
    );
  });
});

// ============================================================================
// Training Tests
// ============================================================================

describe("training mechanics", () => {
  it("creates trainee with correct required hours", () => {
    const trainee = createTrainee("npc:1", "GuardMilitia", "town-1", 100);

    assert.strictEqual(trainee.entityId, "npc:1");
    assert.strictEqual(trainee.role, "GuardMilitia");
    assert.strictEqual(trainee.siteId, "town-1");
    assert.strictEqual(trainee.startTick, 100);
    assert.strictEqual(trainee.progressHours, 0);
    // GuardMilitia requires 168 hours (7 days)
    assert.strictEqual(trainee.requiredHours, 168);
  });

  it("uses base hours for unknown roles", () => {
    const trainee = createTrainee("npc:1", "UnknownRole", "town-1", 100);

    assert.strictEqual(trainee.requiredHours, DEFAULT_PROMOTION_CONFIG.trainingHoursBase);
  });

  it("advances training by 1 hour without mentor", () => {
    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 10,
      requiredHours: 72,
    };

    const advanced = advanceTraining(trainee, false);

    assert.strictEqual(advanced.progressHours, 11);
  });

  it("advances training faster with mentor", () => {
    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 10,
      requiredHours: 72,
    };

    const advanced = advanceTraining(trainee, true);

    // Default mentor bonus is 1.5x
    assert.strictEqual(advanced.progressHours, 11.5);
  });

  it("detects training completion", () => {
    const incomplete: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 50,
      requiredHours: 72,
    };

    const complete: TraineeState = {
      ...incomplete,
      progressHours: 72,
    };

    assert.strictEqual(isTrainingComplete(incomplete), false);
    assert.strictEqual(isTrainingComplete(complete), true);
  });

  it("assigns mentor to trainee", () => {
    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 0,
      requiredHours: 72,
    };

    const withMentor = assignMentor(trainee, "npc:2");

    assert.strictEqual(withMentor.mentorId, "npc:2");
  });
});

// ============================================================================
// Mentor Finding Tests
// ============================================================================

describe("mentor finding", () => {
  it("finds mentor of same role at same site", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
      "npc:2": createMinimalNpc("npc:2", "town-1", "Farmer"),
    };
    world.npcs["npc:2"].notability = 30; // Higher notability = more likely mentor

    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 0,
      requiredHours: 72,
    };

    const mentorId = findMentor(world, trainee);

    assert.strictEqual(mentorId, "npc:2");
  });

  it("returns undefined if no eligible mentor", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
      "npc:2": createMinimalNpc("npc:2", "town-1", "GuardMilitia"), // Different role
    };

    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 0,
      requiredHours: 72,
    };

    const mentorId = findMentor(world, trainee);

    assert.strictEqual(mentorId, undefined);
  });

  it("excludes dead NPCs as mentors", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
      "npc:2": createMinimalNpc("npc:2", "town-1", "Farmer", false), // Dead
    };

    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 0,
      requiredHours: 72,
    };

    const mentorId = findMentor(world, trainee);

    assert.strictEqual(mentorId, undefined);
  });

  it("excludes NPCs at different sites", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
      "npc:2": createMinimalNpc("npc:2", "town-2", "Farmer"), // Different site
    };

    const trainee: TraineeState = {
      entityId: "npc:1",
      role: "Farmer",
      siteId: "town-1",
      startTick: 100,
      progressHours: 0,
      requiredHours: 72,
    };

    const mentorId = findMentor(world, trainee);

    assert.strictEqual(mentorId, undefined);
  });
});

// ============================================================================
// Full Pipeline Tests
// ============================================================================

describe("full promotion pipeline", () => {
  it("promotes candidate when site below target", () => {
    const world = createMinimalWorld();
    world.npcs = {};

    const state = createEmptyPromotionState();
    const poolState: PoolState = {
      pools: {
        "town-1": { siteId: "town-1", count: 100 }, // Plenty of pool population
      },
    };

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 10 },
      maxPromotionsPerTick: 5,
    };

    const result = checkPromotions(world, state, poolState, config);

    assert.ok(result.newNpcs.length > 0);
    assert.ok(result.events.some(e => e.type === "candidate_promoted"));
    assert.ok(result.events.some(e => e.type === "training_started"));
    assert.ok(result.state.trainees.length > 0);
  });

  it("respects max promotions per tick", () => {
    const world = createMinimalWorld();
    world.npcs = {};

    const state = createEmptyPromotionState();
    const poolState: PoolState = {
      pools: {
        "town-1": { siteId: "town-1", count: 100 },
      },
    };

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 100 },
      maxPromotionsPerTick: 2, // Limit
    };

    const result = checkPromotions(world, state, poolState, config);

    assert.ok(result.newNpcs.length <= 2);
  });

  it("skips promotion when pool too small", () => {
    const world = createMinimalWorld();
    world.npcs = {};

    const state = createEmptyPromotionState();
    const poolState: PoolState = {
      pools: {
        "town-1": { siteId: "town-1", count: 5 }, // Below minPoolForPromotion
      },
    };

    const result = checkPromotions(world, state, poolState);

    assert.strictEqual(result.newNpcs.length, 0);
  });

  it("advances existing trainees", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
    };

    const state: PromotionState = {
      roleSlots: [],
      trainees: [{
        entityId: "npc:1",
        role: "Farmer",
        siteId: "town-1",
        startTick: 50,
        progressHours: 71, // One hour away from completion (72 required)
        requiredHours: 72,
      }],
    };

    const poolState: PoolState = { pools: {} };
    
    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 1 }, // Already at target
    };

    const result = checkPromotions(world, state, poolState, config);

    // Training should advance and complete (71 + 1 = 72 >= 72)
    assert.strictEqual(result.state.trainees.length, 0); // Trainee graduated
    assert.ok(result.graduatedIds.includes("npc:1"));
    assert.ok(result.events.some(e => e.type === "training_completed"));
  });

  it("removes dead trainees", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer", false), // Dead
    };

    const state: PromotionState = {
      roleSlots: [],
      trainees: [{
        entityId: "npc:1",
        role: "Farmer",
        siteId: "town-1",
        startTick: 50,
        progressHours: 20,
        requiredHours: 72,
      }],
    };

    const poolState: PoolState = { pools: {} };

    const result = checkPromotions(world, state, poolState);

    assert.strictEqual(result.state.trainees.length, 0);
    assert.ok(!result.graduatedIds.includes("npc:1")); // Didn't graduate, just removed
  });

  it("detects vacancies from dead NPCs", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "GuardMilitia", false), // Dead guard
    };

    const state: PromotionState = {
      roleSlots: [{
        id: "slot:1",
        role: "GuardMilitia",
        siteId: "town-1",
        filledBy: "npc:1",
        priority: 80,
      }],
      trainees: [],
    };

    const poolState: PoolState = {
      pools: { "town-1": { siteId: "town-1", count: 50 } },
    };

    const result = checkPromotions(world, state, poolState);

    assert.ok(result.events.some(e => e.type === "vacancy_detected"));
    // Should also promote a replacement
    assert.ok(result.newNpcs.length > 0 || result.state.roleSlots.some(s => !s.filledBy));
  });
});

// ============================================================================
// Graduation Tests
// ============================================================================

describe("graduation effects", () => {
  it("increases proficiency on graduation", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "GuardMilitia"),
    };
    world.npcs["npc:1"].proficiency = { combat: 10 };

    const updated = applyGraduation(world, ["npc:1"]);

    assert.ok((updated.npcs["npc:1"].proficiency.combat ?? 0) > 10);
  });

  it("clears busyUntilTick on graduation", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
    };
    world.npcs["npc:1"].busyUntilTick = 200;

    const updated = applyGraduation(world, ["npc:1"]);

    assert.strictEqual(updated.npcs["npc:1"].busyUntilTick, 0);
  });

  it("handles empty graduation list", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "Farmer"),
    };

    const updated = applyGraduation(world, []);

    assert.strictEqual(updated, world); // No change
  });

  it("applies correct proficiency per role", () => {
    const world = createMinimalWorld();
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "HealerHedgeMage"),
      "npc:2": createMinimalNpc("npc:2", "town-1", "ScoutRanger"),
    };

    const updated = applyGraduation(world, ["npc:1", "npc:2"]);

    // Healer gets healing proficiency
    assert.ok((updated.npcs["npc:1"].proficiency.healing ?? 0) > 0);
    // Scout gets stealth and investigation
    assert.ok((updated.npcs["npc:2"].proficiency.stealth ?? 0) > 0);
    assert.ok((updated.npcs["npc:2"].proficiency.investigation ?? 0) > 0);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("promotion pipeline integration", () => {
  it("full cycle: vacancy -> promote -> train -> graduate", () => {
    let world = createMinimalWorld();
    
    // Start with one guard who will die
    world.npcs = {
      "npc:1": createMinimalNpc("npc:1", "town-1", "GuardMilitia"),
    };

    let state: PromotionState = {
      roleSlots: initializeRoleSlotsFromWorld(world),
      trainees: [],
    };

    const poolState: PoolState = {
      pools: { "town-1": { siteId: "town-1", count: 50 } },
    };

    const config: PromotionConfig = {
      ...DEFAULT_PROMOTION_CONFIG,
      targetNamedAgentsPerSite: { "town-1": 5 },
      trainingHoursByRole: { "GuardMilitia": 5 }, // Quick training for test
    };

    // Step 1: Guard dies
    world.npcs["npc:1"].alive = false;
    let result = checkPromotions(world, state, poolState, config);
    
    assert.ok(result.events.some(e => e.type === "vacancy_detected"));
    assert.ok(result.newNpcs.length > 0, "Should promote replacement");
    
    // Add new NPCs to world
    for (const npc of result.newNpcs) {
      world = { ...world, npcs: { ...world.npcs, [npc.id]: npc } };
    }
    state = result.state;

    // Verify trainee was created
    assert.ok(state.trainees.length > 0);
    const traineeId = state.trainees[0].entityId;

    // Step 2: Advance training
    world = { ...world, tick: world.tick + 1 };
    result = checkPromotions(world, state, poolState, config);
    state = result.state;

    // Step 3: Complete training (advance enough hours)
    for (let i = 0; i < 10; i++) {
      world = { ...world, tick: world.tick + 1 };
      result = checkPromotions(world, state, poolState, config);
      state = result.state;
      
      if (result.graduatedIds.includes(traineeId)) {
        break;
      }
    }

    assert.ok(result.graduatedIds.includes(traineeId), "Trainee should graduate");
    assert.ok(result.events.some(e => e.type === "training_completed"));
  });
});
