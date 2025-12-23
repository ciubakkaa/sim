import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import type { Attempt, WorldState } from "../src/sim/types";
import { totalFood } from "../src/sim/food";

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function sumAllFood(world: WorldState): number {
  let s = 0;
  for (const site of Object.values(world.sites) as any[]) {
    if (site.kind !== "settlement") continue;
    const t = totalFood(site.food);
    s += t.grain + t.fish + t.meat;
  }
  return s;
}

test("Task 19: trade transfers food from >7d stored exporter to <3d importer with 10% loss", () => {
  let world = createWorld(1);
  world = { ...world, tick: 0 };

  // Exporter: HumanVillageA, pop 10, food 100 (10 days stored)
  world = patchSite(world, "HumanVillageA", {
    cohorts: { children: 0, adults: 10, elders: 0 },
    food: { grain: [{ amount: 100, producedDay: 0 }], fish: [], meat: [] }
  });
  // Importer: HumanVillageB, pop 30, food 30 (1 day stored)
  world = patchSite(world, "HumanVillageB", {
    cohorts: { children: 0, adults: 30, elders: 0 },
    food: { grain: [{ amount: 30, producedDay: 0 }], fish: [], meat: [] }
  });

  const traderId = Object.values(world.npcs).find((n) => n.category === "MerchantSmuggler")!.id;
  world = patchNpc(world, traderId, { siteId: "HumanVillageA" });

  const beforeTotal = sumAllFood(world);
  const beforeImp = totalFood((world.sites["HumanVillageB"] as any).food).grain;

  const attempt: Attempt = {
    id: "t:trade",
    tick: world.tick,
    kind: "trade",
    visibility: "public",
    actorId: traderId,
    siteId: "HumanVillageA",
    durationHours: 2,
    intentMagnitude: "normal",
    targetId: Object.values(world.npcs).find((n) => n.siteId === "HumanVillageA" && n.id !== traderId)!.id
  };

  const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const after = res.world;

  const afterTotal = sumAllFood(after);
  const afterImp = totalFood((after.sites["HumanVillageB"] as any).food).grain;

  assert.ok(afterImp > beforeImp, "importer should receive food");
  assert.ok(afterTotal < beforeTotal, "total food should drop due to 10% loss");
  assert.equal(beforeTotal - afterTotal, 3); // transfer 30 -> delivered 27 => loss 3
});

test("Task 19: bandit disruption reduces trade success by 20%", () => {
  let world = createWorld(2);
  world = { ...world, tick: 0 };

  // Ensure there is a clear exporter/importer pair.
  world = patchSite(world, "HumanVillageA", {
    cohorts: { children: 0, adults: 10, elders: 0 },
    food: { grain: [{ amount: 100, producedDay: 0 }], fish: [], meat: [] }
  });
  world = patchSite(world, "HumanVillageB", {
    cohorts: { children: 0, adults: 30, elders: 0 },
    food: { grain: [{ amount: 30, producedDay: 0 }], fish: [], meat: [] }
  });

  const traderId = Object.values(world.npcs).find((n) => n.category === "MerchantSmuggler")!.id;
  world = patchNpc(world, traderId, { siteId: "HumanVillageA" });
  const partnerId = Object.values(world.npcs).find((n) => n.siteId === "HumanVillageA" && n.id !== traderId)!.id;

  const attempt: Attempt = {
    id: "t:trade2",
    tick: world.tick,
    kind: "trade",
    visibility: "public",
    actorId: traderId,
    siteId: "HumanVillageA",
    durationHours: 2,
    intentMagnitude: "normal",
    targetId: partnerId
  };

  // roll=70 succeeds at 80% but fails at 60%.
  const rngRoll70 = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 70 : a), chance: () => false } as any;

  let seq = 0;
  const before = sumAllFood(world);
  const noBandits = resolveAndApplyAttempt(world, attempt, { rng: rngRoll70, nextEventSeq: () => ++seq }).world;
  assert.ok(sumAllFood(noBandits) < before, "expected success without bandit disruption");

  const banditId = Object.values(world.npcs).find((n) => n.category === "BanditRaider")!.id;
  world = patchNpc(world, banditId, { siteId: "HumanVillageA" });
  const withBandits = resolveAndApplyAttempt(world, attempt, { rng: rngRoll70, nextEventSeq: () => ++seq }).world;
  assert.equal(sumAllFood(withBandits), before, "expected no transfer due to disrupted trade failure");
});


