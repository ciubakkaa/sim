import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { WorldState } from "../src/sim/types";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";
import { updatePlans, applyPlanProgressFromEvents } from "../src/sim/systems/planning";
import { generateScoredAttempt } from "../src/sim/attempts/generate";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

const deterministicRng = {
  next: () => 0,
  int: (a: number, _b?: number) => a,
  chance: (_p: number) => false
} as any;

test("planning: creates a get_food plan when Food need is high (enabled)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(4001);
    const siteId = "HumanCityPort";
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"));
    world = patchNpc(world, npcId, { needs: { ...world.npcs[npcId]!.needs, Food: 90 }, busyUntilTick: 0, lastAttemptTick: -999 });

    world = updatePlans(world, () => 1);
    const npc = world.npcs[npcId]!;
    assert.ok(npc.plan, "expected plan created");
    assert.equal(npc.plan!.goal, "get_food");
    assert.ok(npc.plan!.steps.length >= 2, "expected multi-step plan");
  } finally {
    resetConfig();
  }
});

test("planning: biases attempt generation toward plan step kind", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(4002);
    const siteId = "HumanCityPort";
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"));
    world = patchNpc(world, npcId, { needs: { ...world.npcs[npcId]!.needs, Food: 90 }, busyUntilTick: 0, lastAttemptTick: -999 });
    world = updatePlans(world, () => 1);

    const npc = world.npcs[npcId]!;
    assert.ok(npc.plan);
    const plannedKind = npc.plan!.steps[npc.plan!.stepIndex]!.kind;

    const a = generateScoredAttempt(npc, world, deterministicRng);
    assert.ok(a, "expected an attempt");
    assert.equal(a!.kind, plannedKind);
  } finally {
    resetConfig();
  }
});

test("planning: progresses plan when matching executed attempt.recorded appears", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(4003);
    const siteId = "HumanVillageA";
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.category === "Farmer");
    // Force a simple single-step plan.
    world = patchNpc(world, npcId, {
      needs: { ...world.npcs[npcId]!.needs, Food: 95 },
      busyUntilTick: 0,
      lastAttemptTick: -999
    });
    world = updatePlans(world, () => 1);
    const npc = world.npcs[npcId]!;
    assert.ok(npc.plan);
    const plannedKind = npc.plan!.steps[0]!.kind;

    // Simulate an attempt.recorded event.
    const evt: any = {
      id: "evt:test",
      tick: world.tick,
      kind: "attempt.recorded",
      visibility: "private",
      siteId,
      message: "test",
      data: { attempt: { actorId: npcId, kind: plannedKind }, consequences: [] }
    };

    const nextWorld = applyPlanProgressFromEvents(world, [evt]);
    assert.ok(nextWorld.npcs[npcId]!.plan, "expected plan still present after first step");
    assert.equal(nextWorld.npcs[npcId]!.plan!.stepIndex, 1, "expected stepIndex advanced");
  } finally {
    resetConfig();
  }
});

test("planning: clears plan after all steps are observed (multi-step)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(4004);
    const siteId = "HumanCityPort";
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"));
    world = patchNpc(world, npcId, { needs: { ...world.npcs[npcId]!.needs, Food: 95 }, busyUntilTick: 0, lastAttemptTick: -999 });
    world = updatePlans(world, () => 1);
    const plan = world.npcs[npcId]!.plan!;
    assert.ok(plan.steps.length >= 2);

    const ev0: any = { id: "evt:0", tick: world.tick, kind: "attempt.recorded", visibility: "private", siteId, message: "s0", data: { attempt: { actorId: npcId, kind: plan.steps[0]!.kind }, consequences: [] } };
    const w1 = applyPlanProgressFromEvents(world, [ev0]);
    assert.ok(w1.npcs[npcId]!.plan);

    const p1 = w1.npcs[npcId]!.plan!;
    const ev1: any = { id: "evt:1", tick: world.tick, kind: "attempt.recorded", visibility: "private", siteId, message: "s1", data: { attempt: { actorId: npcId, kind: p1.steps[p1.stepIndex]!.kind }, consequences: [] } };
    const w2 = applyPlanProgressFromEvents(w1, [ev1]);
    assert.equal(w2.npcs[npcId]!.plan, undefined, "expected plan cleared after last step");
  } finally {
    resetConfig();
  }
});


