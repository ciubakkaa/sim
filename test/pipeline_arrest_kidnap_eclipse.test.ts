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

function mkRng(opts: { roll?: number; chanceRoll?: number } = {}) {
  const roll = opts.roll ?? 0;
  const chanceRoll = opts.chanceRoll ?? 0;
  return {
    next: () => 0,
    int: (a: number, b?: number) => {
      // use provided roll for (0..99) checks; otherwise take the lower bound
      if (a === 0 && b === 99) return roll;
      return a;
    },
    chance: (p: number) => chanceRoll < p
  } as any;
}

test("investigate: at cultInfluence>40, guard can identify a cult member and gain belief", () => {
  let world = createWorld(1);
  const siteId = "HumanCityPort";

  const guardId = findNpcId(world, (n) => n.category === "GuardMilitia");
  const cultId = findNpcId(world, (n) => n.siteId === "HumanCityPort" && n.cult.member);

  world = patchSite(world, siteId, { cultInfluence: 60 });
  world = patchNpc(world, guardId, { siteId, busyUntilTick: 0, traits: { ...world.npcs[guardId]!.traits, Suspicion: 100, Discipline: 100 } });
  world = patchNpc(world, cultId, { siteId });

  const attempt: Attempt = {
    id: "t:investigate",
    tick: world.tick,
    kind: "investigate",
    visibility: "public",
    actorId: guardId,
    siteId,
    durationHours: 2,
    intentMagnitude: "normal"
  };

  const rng = mkRng({ roll: 0, chanceRoll: 0 }); // success + identification
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  const guard = res.world.npcs[guardId]!;
  assert.ok(guard.beliefs.some((b) => b.predicate === "identified_cult_member"), "expected identified_cult_member belief");
});

test("kidnap: baseline chance bump makes a previously failing roll succeed (roll=50)", () => {
  let world = createWorld(2);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.cult.member && n.siteId === siteId);
  const targetId = findNpcId(world, (n) => !n.cult.member && n.siteId === siteId && n.id !== actorId);

  world = patchNpc(world, actorId, {
    traits: { ...world.npcs[actorId]!.traits, Aggression: 0, Discipline: 0, Empathy: 100 }
  });
  world = patchNpc(world, targetId, {
    traits: { ...world.npcs[targetId]!.traits, Courage: 0, Discipline: 0, Suspicion: 0 }
  });

  const attempt: Attempt = {
    id: "t:kidnap",
    tick: world.tick,
    kind: "kidnap",
    visibility: "private",
    actorId,
    targetId,
    siteId,
    durationHours: 2,
    intentMagnitude: "normal"
  };

  const rng = mkRng({ roll: 50 });
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  assert.ok(res.world.npcs[targetId]!.status?.detained, "expected target to be detained after successful kidnap");
});

test("forced_eclipse: success chance is 60% (roll 59 succeeds, roll 60 fails)", () => {
  let world = createWorld(3);
  const siteId = "HumanVillageA";
  world = patchSite(world, siteId, { eclipsingPressure: 60, anchoringStrength: 40 });

  const actorId = findNpcId(world, (n) => n.cult.role === "cell_leader");
  const targetId = findNpcId(world, (n) => n.siteId === siteId && n.alive && !n.cult.member && n.id !== actorId);

  world = patchNpc(world, actorId, { siteId });
  world = patchNpc(world, targetId, { siteId, status: { detained: { byNpcId: actorId, atSiteId: siteId, startedTick: 0, untilTick: 999 } } });

  const attempt: Attempt = {
    id: "t:forced",
    tick: world.tick,
    kind: "forced_eclipse",
    visibility: "private",
    actorId,
    targetId,
    siteId,
    durationHours: 6,
    intentMagnitude: "major"
  };

  {
    const rng = mkRng({ roll: 59 });
    let seq = 0;
    const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
    assert.ok(res.world.npcs[targetId]!.status?.eclipsing, "expected eclipsing status on success");
  }
  {
    const rng = mkRng({ roll: 60 });
    let seq = 0;
    const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
    assert.ok(!res.world.npcs[targetId]!.status?.eclipsing, "expected no eclipsing status on failure");
  }
});

test("pipeline: kidnap -> forced_eclipse -> anchor_sever succeeds end-to-end", () => {
  let world = createWorld(4);
  const siteId = "HumanVillageA";
  world = patchSite(world, siteId, { eclipsingPressure: 60, anchoringStrength: 40, cultInfluence: 60 });

  const cultKidnapperId = findNpcId(world, (n) => n.cult.member && n.siteId === siteId);
  const cultLeaderId = findNpcId(world, (n) => n.cult.role === "cell_leader");
  const anchorMageId = findNpcId(world, (n) => n.category === "AnchorMage");
  const targetId = findNpcId(world, (n) => n.siteId === siteId && n.alive && !n.cult.member && n.id !== cultKidnapperId);

  world = patchNpc(world, cultLeaderId, { siteId });
  world = patchNpc(world, anchorMageId, { siteId });

  // Step 1: kidnap (force success by roll 0)
  {
    const attempt: Attempt = {
      id: "t:kidnap2",
      tick: world.tick,
      kind: "kidnap",
      visibility: "private",
      actorId: cultKidnapperId,
      targetId,
      siteId,
      durationHours: 2,
      intentMagnitude: "normal"
    };
    const rng = mkRng({ roll: 0 });
    let seq = 0;
    world = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
    assert.ok(world.npcs[targetId]!.status?.detained, "expected detained after kidnap");
  }

  // Step 2: forced_eclipse (success roll 0 < 60)
  {
    const attempt: Attempt = {
      id: "t:forced2",
      tick: world.tick,
      kind: "forced_eclipse",
      visibility: "private",
      actorId: cultLeaderId,
      targetId,
      siteId,
      durationHours: 6,
      intentMagnitude: "major"
    };
    const rng = mkRng({ roll: 0 });
    let seq = 0;
    world = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
    assert.ok(world.npcs[targetId]!.status?.eclipsing, "expected eclipsing after forced_eclipse");
  }

  // Step 3: anchor_sever (success roll 0 < 70)
  {
    const attempt: Attempt = {
      id: "t:sever",
      tick: world.tick,
      kind: "anchor_sever",
      visibility: "public",
      actorId: anchorMageId,
      targetId,
      siteId,
      durationHours: 2,
      intentMagnitude: "major"
    };
    const rng = mkRng({ roll: 0 });
    let seq = 0;
    world = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
    assert.ok(!world.npcs[targetId]!.status?.eclipsing, "expected eclipsing cleared after anchor_sever");
  }
});


