import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { applyFoodProcessHourly } from "../src/sim/processes/foodProcess";
import { Rng } from "../src/sim/rng";
import type { Attempt, WorldState } from "../src/sim/types";

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

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("work_farm produces grain and increments laborWorkedToday (fieldsCondition applies)", () => {
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.siteId === siteId && n.category === "Farmer");

  world = patchSite(world, siteId, {
    fieldsCondition: 0.5,
    food: { grain: [], fish: [], meat: [] },
    laborWorkedToday: { grain: 0, fish: 0, meat: 0 },
    cohorts: { children: 0, adults: 0, elders: 0 } // avoid consumption interactions in this test
  });
  world = patchNpc(world, actorId, { alive: true, busyUntilTick: 0 });

  const attempt: Attempt = {
    id: "t:work_farm",
    tick: world.tick,
    kind: "work_farm",
    visibility: "private",
    actorId,
    siteId,
    durationHours: 6,
    intentMagnitude: "normal"
  };

  const rng = new Rng(123);
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const site = res.world.sites[siteId] as any;

  // basePerHour=2 => raw=12; fieldsCondition=0.5 => 6
  const grainTotal = site.food.grain.reduce((a: number, l: any) => a + l.amount, 0);
  assert.equal(grainTotal, 6);
  assert.equal(site.laborWorkedToday.grain, 6);
});

test("daily production: 30% reduction applies when no labor worked for that food type; resets at dawn", () => {
  const rng = new Rng(1);
  let seq = 0;
  const ctx = { rng, nextEventSeq: () => ++seq };

  let world = createWorld(2);
  const siteId = "HumanVillageA";

  // At hour 6 (dawn production). Set cohorts 0 so consumption doesn't interfere.
  world = { ...world, tick: 6 };
  world = patchSite(world, siteId, {
    cohorts: { children: 0, adults: 0, elders: 0 },
    food: { grain: [], fish: [], meat: [] },
    productionPerDay: { grain: 100, fish: 0, meat: 0 },
    fieldsCondition: 1,
    laborWorkedToday: { grain: 0, fish: 0, meat: 0 }
  });

  const res = applyFoodProcessHourly(world, ctx);
  const site = res.world.sites[siteId] as any;

  const grainTotal = site.food.grain.reduce((a: number, l: any) => a + l.amount, 0);
  assert.equal(grainTotal, 70);
  assert.equal(site.laborWorkedToday.grain, 0);
});


