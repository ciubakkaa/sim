import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { WorldState } from "../src/sim/types";
import { generateReflexAttempt, generateScoredAttempt } from "../src/sim/attempts";

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

test("integration: scoring attempt generation matches legacy reflex for simple farmer case", () => {
  const w0 = createWorld(1);
  const farmerId = findNpcId(w0, (n) => n.category === "Farmer" && n.siteId === "HumanVillageA");

  const w1 = patchNpc(w0, farmerId, {
    needs: { ...w0.npcs[farmerId]!.needs, Food: 90, Duty: 20, Safety: 0, Freedom: 0, Meaning: 0 },
    traits: { ...w0.npcs[farmerId]!.traits, Discipline: 60 },
    lastAttemptTick: -999,
    busyUntilTick: -999,
    forcedActiveUntilTick: -999
  });

  // Deterministic RNG stub:
  // - next() = 0 => selectAction picks the top-scored action.
  // - chance() = false => avoid random travel in legacy reflex logic.
  // - int() = low end => stable attempt ids.
  const rng = {
    next: () => 0,
    int: (a: number, _b?: number) => a,
    chance: () => false
  } as any;

  const npc = w1.npcs[farmerId]!;
  const legacy = generateReflexAttempt(npc, w1, rng);
  const scored = generateScoredAttempt(npc, w1, rng);

  assert.ok(legacy, "legacy attempt should exist");
  assert.ok(scored, "scored attempt should exist");

  assert.equal(legacy!.kind, "work_farm");
  assert.equal(scored!.kind, "work_farm");
  assert.equal(scored!.durationHours, 6);
  assert.equal(scored!.visibility, "private");
});


