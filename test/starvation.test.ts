import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import type { WorldState } from "../src/sim/types";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("starvation: after 48 consecutive hunger hours, NPC takes 5 hp/hour", () => {
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  const npcId = findNpcId(world, (n) => n.siteId === siteId && n.alive && n.category === "Farmer");

  // Freeze AI: prevent other NPCs from assaulting / interacting during this test.
  for (const n of Object.values(world.npcs)) {
    world = patchNpc(world, n.id, { busyUntilTick: 1_000_000_000, lastAttemptTick: world.tick, forcedActiveUntilTick: 0 });
  }

  world = patchSite(world, siteId, {
    hunger: 100,
    cohorts: { children: 0, adults: 100, elders: 0 },
    food: { grain: [], fish: [], meat: [] }
  });
  world = patchNpc(world, npcId, {
    hp: 100,
    maxHp: 100,
    consecutiveHungerHours: 47,
    busyUntilTick: 1_000_000_000,
    lastAttemptTick: 0
  });

  const res = tickHour(world, { attempts: [] });
  const npc = res.world.npcs[npcId]!;
  assert.equal(npc.consecutiveHungerHours, 48);
  assert.equal(npc.hp, 95);
});

test("starvation: elder proxy takes 1.5x damage (rounded)", () => {
  let world = createWorld(2);
  const siteId = "HumanVillageA";
  const npcId = findNpcId(world, (n) => n.siteId === siteId && n.alive);

  // Freeze AI: prevent other NPCs from assaulting / interacting during this test.
  for (const n of Object.values(world.npcs)) {
    world = patchNpc(world, n.id, { busyUntilTick: 1_000_000_000, lastAttemptTick: world.tick, forcedActiveUntilTick: 0 });
  }

  world = patchSite(world, siteId, {
    hunger: 100,
    cohorts: { children: 0, adults: 100, elders: 0 },
    food: { grain: [], fish: [], meat: [] }
  });
  world = patchNpc(world, npcId, {
    category: "LocalLeader",
    hp: 100,
    maxHp: 100,
    consecutiveHungerHours: 47,
    busyUntilTick: 1_000_000_000,
    lastAttemptTick: 0
  });

  const res = tickHour(world, { attempts: [] });
  const npc = res.world.npcs[npcId]!;
  // 5 * 1.5 = 7.5 -> rounds to 8
  assert.equal(npc.hp, 92);
});

test("starvation: death emits npc.died event with cause starvation", () => {
  let world = createWorld(3);
  const siteId = "HumanVillageA";
  const npcId = findNpcId(world, (n) => n.siteId === siteId && n.alive);

  // Freeze AI: prevent other NPCs from assaulting / interacting during this test.
  for (const n of Object.values(world.npcs)) {
    world = patchNpc(world, n.id, { busyUntilTick: 1_000_000_000, lastAttemptTick: world.tick, forcedActiveUntilTick: 0 });
  }

  world = patchSite(world, siteId, {
    hunger: 100,
    cohorts: { children: 0, adults: 100, elders: 0 },
    food: { grain: [], fish: [], meat: [] }
  });
  world = patchNpc(world, npcId, {
    hp: 4,
    maxHp: 100,
    consecutiveHungerHours: 47,
    busyUntilTick: 1_000_000_000,
    lastAttemptTick: 0
  });

  const res = tickHour(world, { attempts: [] });
  const npc = res.world.npcs[npcId]!;
  assert.equal(npc.alive, false);
  assert.equal(npc.death?.cause, "starvation");

  const deathEvt = res.events.find((e) => e.kind === "npc.died" && (e.data as any)?.npcId === npcId);
  assert.ok(deathEvt, "expected npc.died event");
  assert.equal((deathEvt!.data as any).cause, "starvation");
});


