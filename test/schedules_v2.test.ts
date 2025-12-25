import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { WorldState } from "../src/sim/types";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";
import { generateScoredAttempt } from "../src/sim/attempts/generate";

const deterministicRng = {
  next: () => 0,
  int: (a: number, _b?: number) => a,
  chance: (_p: number) => false
} as any;

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

function zeroNeeds(n: any) {
  const out: any = {};
  for (const k of Object.keys(n.needs ?? {})) out[k] = 0;
  return out;
}

test("v2 schedules: farmer prefers work_farm during morning work hours (enabled)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(14001);
    // Force hour=7
    world = { ...world, tick: 7 };
    const siteId = "HumanVillageA";
    const farmerId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.category === "Farmer");
    world = patchNpc(world, farmerId, { busyUntilTick: 0, lastAttemptTick: -999, needs: zeroNeeds(world.npcs[farmerId]!) });
    const a = generateScoredAttempt(world.npcs[farmerId]!, world, deterministicRng);
    assert.ok(a, "expected attempt");
    assert.equal(a!.kind, "work_farm");
  } finally {
    resetConfig();
  }
});

test("v2 schedules: merchant prefers trade during market hours (enabled)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(14002);
    // Force hour=14
    world = { ...world, tick: 14 };
    const siteId = "HumanCityPort";
    const npcId = findNpcId(world, (n) => n.alive && n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"));
    world = patchNpc(world, npcId, { busyUntilTick: 0, lastAttemptTick: -999, needs: zeroNeeds(world.npcs[npcId]!) });
    const a = generateScoredAttempt(world.npcs[npcId]!, world, deterministicRng);
    assert.ok(a, "expected attempt");
    assert.equal(a!.kind, "trade");
  } finally {
    resetConfig();
  }
});


