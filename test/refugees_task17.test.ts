import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { applyPopulationProcessDaily } from "../src/sim/processes/populationProcess";
import type { WorldState } from "../src/sim/types";

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

test("Task 17: under-populated settlement can receive 1-3 named refugees with elevated Fear and reduced trust", () => {
  let world = createWorld(1);
  // day boundary
  world = { ...world, tick: 0 };

  // Make HumanVillageA under 50% housing: pop 10, housing 100
  world = patchSite(world, "HumanVillageA", {
    cohorts: { children: 2, adults: 8, elders: 0 },
    housingCapacity: 100
  });

  const beforeCount = Object.keys(world.npcs).length;

  // RNG forces named refugee spawn: chance(p) -> true, int(1,3)->3
  const rng = {
    next: () => 0.1,
    int: (a: number, b?: number) => {
      if (a === 1 && b === 3) return 3;
      return a;
    },
    chance: () => true
  } as any;
  let seq = 0;
  const res = applyPopulationProcessDaily(world, { rng, nextEventSeq: () => ++seq });
  const after = res.world;
  const afterCount = Object.keys(after.npcs).length;
  assert.equal(afterCount, beforeCount + 3);

  const newcomers = Object.values(after.npcs).filter((n) => n.id.startsWith("npc:0:") && n.siteId === "HumanVillageA");
  assert.equal(newcomers.length, 3);
  for (const n of newcomers) {
    assert.ok(n.traits.Fear >= 70, `Fear=${n.traits.Fear}`);
    // Should have at least one seeded relationship with reduced trust.
    const rels = Object.values(n.relationships);
    assert.ok(rels.length >= 1);
    assert.ok(rels.some((r) => r.trust <= 35), "expected reduced trust toward locals");
  }
});


