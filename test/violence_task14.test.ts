import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { Attempt, WorldState } from "../src/sim/types";
import { generateScoredAttempt } from "../src/sim/attempts";
import { resolveAndApplyAttempt } from "../src/sim/attempts";

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

function rngWithChanceMap(map: Record<string, boolean>) {
  return {
    next: () => 0,
    int: (a: number, _b?: number) => a,
    chance: (p: number) => map[p.toFixed(2)] ?? false
  } as any;
}

test("Task 14: BanditRaider raids with 20% chance when Food need > 50", () => {
  let world = createWorld(1);
  const banditId = findNpcId(world, (n) => n.category === "BanditRaider");
  world = patchNpc(world, banditId, {
    siteId: "HumanVillageA",
    needs: { ...world.npcs[banditId]!.needs, Food: 60 },
    lastAttemptTick: -999,
    busyUntilTick: 0
  });
  // make site a settlement (it is)
  const rng = rngWithChanceMap({ "0.20": true });
  const a = generateScoredAttempt(world.npcs[banditId]!, world, rng);
  assert.ok(a);
  assert.equal(a!.kind, "raid");
});

test("Task 14: high unrest triggers 5% random assault chance", () => {
  let world = createWorld(2);
  const aId = findNpcId(world, (n) => n.siteId === "HumanVillageA" && n.alive);
  world = patchSite(world, "HumanVillageA", { unrest: 80 });
  world = patchNpc(world, aId, { lastAttemptTick: -999, busyUntilTick: 0 });

  const rng = rngWithChanceMap({ "0.05": true });
  const att = generateScoredAttempt(world.npcs[aId]!, world, rng);
  assert.ok(att);
  assert.equal(att!.kind, "assault");
  assert.ok(att!.targetId, "expected assault to have a targetId");
  assert.notEqual(att!.targetId, aId);
  assert.equal(world.npcs[att!.targetId!]?.siteId, "HumanVillageA");
});

test("Task 14: successful raid damages fieldsCondition by 0.05..0.15", () => {
  let world = createWorld(3);
  const siteId = "HumanVillageA";
  const banditId = findNpcId(world, (n) => n.category === "BanditRaider");

  world = patchNpc(world, banditId, { siteId, busyUntilTick: 0 });
  world = patchSite(world, siteId, {
    fieldsCondition: 1,
    food: { grain: [{ amount: 100, producedDay: 0 }], fish: [], meat: [] }
  });

  const attempt: Attempt = {
    id: "t:raid",
    tick: world.tick,
    kind: "raid",
    visibility: "public",
    actorId: banditId,
    siteId,
    durationHours: 3,
    intentMagnitude: "normal"
  };

  // Ensure success: roll=0. Force fieldsDamage max-ish by int(0,10)=10.
  const rng = {
    next: () => 0,
    chance: () => false,
    int: (a: number, b?: number) => {
      if (a === 0 && b === 99) return 0;
      if (a === 0 && b === 10) return 10;
      return a;
    }
  } as any;

  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const site = res.world.sites[siteId] as any;
  assert.ok(site.fieldsCondition <= 0.95 && site.fieldsCondition >= 0.85, `fieldsCondition=${site.fieldsCondition}`);
});


