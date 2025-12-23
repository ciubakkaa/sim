import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
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

test("Task 18: investigation identification is shared to other guards at same site and nearby", () => {
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  world = patchSite(world, siteId, { cultInfluence: 80 });

  const guardA = findNpcId(world, (n) => n.category === "GuardMilitia");
  const guardB = findNpcId(world, (n) => n.category === "ScoutRanger");
  const cultId = findNpcId(world, (n) => n.cult.member);

  world = patchNpc(world, guardA, { siteId, traits: { ...world.npcs[guardA]!.traits, Suspicion: 100, Discipline: 100 } });
  world = patchNpc(world, guardB, { siteId });
  world = patchNpc(world, cultId, { siteId });

  // Place a guard in a neighboring site (HumanCityPort is adjacent to HumanVillageA in the map).
  const neighborGuard = findNpcId(world, (n) => n.category === "Threadwarden");
  world = patchNpc(world, neighborGuard, { siteId: "HumanCityPort" });

  const attempt: Attempt = {
    id: "t:investigate",
    tick: world.tick,
    kind: "investigate",
    visibility: "public",
    actorId: guardA,
    siteId,
    durationHours: 2,
    intentMagnitude: "normal"
  };

  const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => true } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });

  assert.ok(res.world.npcs[guardB]!.beliefs.some((b) => b.predicate === "identified_cult_member"), "same-site guard should receive report belief");
  assert.ok(res.world.npcs[neighborGuard]!.beliefs.some((b) => b.predicate === "identified_cult_member"), "nearby guard should receive report belief");
});

test("Task 18: kidnap gets +10% success per additional cult member present", () => {
  let world = createWorld(2);
  const siteId = "ElvenCity"; // no default cult members here in worldSeed
  const actorId = findNpcId(world, (n) => n.cult.member);
  const targetId = findNpcId(world, (n) => !n.cult.member);
  world = patchNpc(world, actorId, { siteId });
  world = patchNpc(world, targetId, { siteId });

  // Make base chance ~23 (score ~0, resist ~32 => 23). We'll use roll=24 to fail without bonus.
  world = patchNpc(world, actorId, { traits: { ...world.npcs[actorId]!.traits, Aggression: 0, Discipline: 0, Empathy: 100 } });
  world = patchNpc(world, targetId, { traits: { ...world.npcs[targetId]!.traits, Courage: 40, Discipline: 40, Suspicion: 0 } });

  const mk = () =>
    ({
      id: "t:kidnap",
      tick: world.tick,
      kind: "kidnap",
      visibility: "private",
      actorId,
      targetId,
      siteId,
      durationHours: 2,
      intentMagnitude: "normal"
    }) as Attempt;

  // Without extra cult: roll 24 should fail (base ~23).
  {
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 24 : a), chance: () => false } as any;
    let seq = 0;
    const res = resolveAndApplyAttempt(world, mk(), { rng, nextEventSeq: () => ++seq });
    assert.ok(!res.world.npcs[targetId]!.status?.detained);
  }

  // Add another cult member at site -> +10 bonus => chance ~33, roll 24 succeeds.
  const extraCult = findNpcId(world, (n) => n.cult.member && n.id !== actorId);
  world = patchNpc(world, extraCult, { siteId });
  {
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 24 : a), chance: () => false } as any;
    let seq = 0;
    const res = resolveAndApplyAttempt(world, mk(), { rng, nextEventSeq: () => ++seq });
    assert.ok(res.world.npcs[targetId]!.status?.detained);
  }
});

test("Task 18: raid gets +10% success per additional bandit present", () => {
  let world = createWorld(3);
  const siteId = "HumanVillageA";
  const banditId = findNpcId(world, (n) => n.category === "BanditRaider");
  world = patchNpc(world, banditId, { siteId, traits: { ...world.npcs[banditId]!.traits, Aggression: 0, Courage: 0, Discipline: 0 } });
  world = patchSite(world, siteId, { unrest: 0, anchoringStrength: 0, fieldsCondition: 1, food: { grain: [{ amount: 50, producedDay: 0 }], fish: [], meat: [] } });

  const mk = () =>
    ({
      id: "t:raid",
      tick: world.tick,
      kind: "raid",
      visibility: "public",
      actorId: banditId,
      siteId,
      durationHours: 3,
      intentMagnitude: "normal"
    }) as Attempt;

  // base chance = 20 (score 0, defense 35)
  // roll 25 should fail without bonus.
  {
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 25 : a), chance: () => false } as any;
    let seq = 0;
    const res = resolveAndApplyAttempt(world, mk(), { rng, nextEventSeq: () => ++seq });
    const evt = res.events.find((e) => e.kind === "attempt.recorded" && (e.data as any)?.attempt?.kind === "raid");
    assert.ok(evt);
    assert.equal((evt!.data as any).success, false);
  }

  // Add another bandit at the site => +10 bonus => chance 30, roll 25 succeeds.
  const extra = findNpcId(world, (n) => n.category === "BanditRaider" && n.id !== banditId);
  world = patchNpc(world, extra, { siteId });
  {
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 25 : a), chance: () => false } as any;
    let seq = 0;
    const res = resolveAndApplyAttempt(world, mk(), { rng, nextEventSeq: () => ++seq });
    const evt = res.events.find((e) => e.kind === "attempt.recorded" && (e.data as any)?.attempt?.kind === "raid");
    assert.ok(evt);
    assert.equal((evt!.data as any).success, true);
  }
});


