import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { pickTravelDestination } from "../src/sim/npcs";
import type { Attempt, WorldState } from "../src/sim/types";

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

test("Task 16: ScoutRanger patrol near hidden hideout can discover it and create discovered_location belief", () => {
  let world = createWorld(1);
  // MountainPass neighbors CultHideout1
  const scoutId = findNpcId(world, (n) => n.category === "ScoutRanger");
  world = patchNpc(world, scoutId, { siteId: "ElvenTownFortified" });
  world = patchSite(world, "CultHideout1", { hidden: true });

  // Move scout to a settlement adjacent? We'll treat ElvenTownFortified not adjacent, so use HumanVillageA? adjacent to DeepForest->CultHideout1 not direct.
  // Instead: just patch world map sites: add fake adjacency by patrolling at MountainPass not allowed (patrol needs settlement). We'll patrol at HumanCityPort? none.
  // Use ElvenTownFortified and temporarily connect it via setting neighbor list isn't possible. So test discovery by patrolling in settlement that IS adjacent:
  // There's no settlement adjacent to CultHideout1, but ScoutRanger can patrol at settlement and discover via neighbor hideout only if directly connected.
  // We'll patch map edges to make HumanVillageB adjacent to CultHideout1 for this unit test.
  world = {
    ...world,
    map: { ...world.map, edges: [...world.map.edges, { from: "HumanVillageB", to: "CultHideout1", km: 5, quality: "rough" as any }] }
  } as any;
  world = patchNpc(world, scoutId, { siteId: "HumanVillageB" });

  const attempt: Attempt = {
    id: "t:patrol",
    tick: world.tick,
    kind: "patrol",
    visibility: "public",
    actorId: scoutId,
    siteId: "HumanVillageB",
    durationHours: 2,
    intentMagnitude: "normal"
  };

  const rng = { next: () => 0, int: (a: number) => a, chance: (p: number) => p === 0.05 } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const hideout = res.world.sites["CultHideout1"] as any;
  assert.equal(hideout.hidden, false);
  const scout = res.world.npcs[scoutId]!;
  assert.ok(scout.beliefs.some((b) => b.predicate === "discovered_location" && b.object === "CultHideout1"));
});

test("Task 16: pickTravelDestination does not select hidden hideouts", () => {
  let world = createWorld(2);
  world = patchSite(world, "CultHideout1", { hidden: true });
  // from MountainPass would strongly prefer hideout if not filtered; make OpenPlains 'dangerous'
  world = patchSite(world, "OpenPlains", { eclipsingPressure: 100 } as any);
  const rng = { next: () => 0 } as any;
  const to = pickTravelDestination(world, "MountainPass", rng);
  assert.notEqual(to, "CultHideout1");
});

test("Task 16: travel to hidden hideout is blocked until discovered", () => {
  let world = createWorld(3);
  world = patchSite(world, "CultHideout1", { hidden: true });
  const actorId = findNpcId(world, (n) => n.category === "BanditRaider");
  world = patchNpc(world, actorId, { siteId: "MountainPass", busyUntilTick: 0 });

  const attempt: Attempt = {
    id: "t:travel-hideout",
    tick: world.tick,
    kind: "travel",
    visibility: "public",
    actorId,
    siteId: "MountainPass",
    durationHours: 1,
    intentMagnitude: "normal",
    resources: { toSiteId: "CultHideout1" }
  };

  const rng = { next: () => 0, int: (a: number) => a, chance: () => false } as any;
  let seq = 0;
  const blocked = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
  assert.ok(!blocked.npcs[actorId]!.travel, "expected travel to be blocked while hideout hidden");

  world = patchSite(world, "CultHideout1", { hidden: false });
  const allowed = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
  assert.ok(allowed.npcs[actorId]!.travel, "expected travel to start once hideout discovered");
});

test("Task 16: investigate chance is doubled at discovered hideout", () => {
  let world = createWorld(4);
  world = patchSite(world, "CultHideout1", { hidden: false });
  const actorId = findNpcId(world, (n) => n.alive);
  world = patchNpc(world, actorId, {
    siteId: "CultHideout1",
    traits: { ...world.npcs[actorId]!.traits, Suspicion: 0, Discipline: 0 },
    busyUntilTick: 0
  });

  const attempt: Attempt = {
    id: "t:investigate-hideout",
    tick: world.tick,
    kind: "investigate",
    visibility: "public",
    actorId,
    siteId: "CultHideout1",
    durationHours: 2,
    intentMagnitude: "normal"
  };

  // roll=7. Base chance would clamp to 5 -> fail; doubled => 10 -> succeed.
  const rng = {
    next: () => 0,
    int: (a: number, b?: number) => {
      if (a === 0 && b === 99) return 7;
      return a;
    },
    chance: () => false
  } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const evt = res.events.find((e) => e.kind === "attempt.recorded" && (e.data as any)?.attempt?.kind === "investigate");
  assert.ok(evt, "expected attempt.recorded for investigate");
  assert.equal((evt!.data as any).discoveredHideoutBonus, true);
  assert.equal((evt!.data as any).success, true);
});


