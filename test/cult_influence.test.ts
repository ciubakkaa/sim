import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { Rng } from "../src/sim/rng";
import { applyCultDaily } from "../src/sim/processes/cultProcess";
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

test("preach influence: anchoring multiplier + high-anchoring penalty + saturation affect success chance", () => {
  const w0 = createWorld(1);
  const actorId = findNpcId(w0, (n) => n.siteId === "HumanVillageA");

  const mkAttempt = (siteId: string): Attempt => ({
    id: "t:preach",
    tick: w0.tick,
    kind: "preach_fixed_path",
    visibility: "public",
    actorId,
    siteId: siteId as any,
    durationHours: 2,
    intentMagnitude: "normal"
  });

  const rng = {
    next: () => 0.3,
    int: (a: number) => a,
    chance: (p: number) => 0.3 < p
  } as any;

  // anchoring=0 => chance 1.0 -> succeed (0.3 < 1)
  {
    const w1 = patchSite(w0, "HumanVillageA", { anchoringStrength: 0, cultInfluence: 0 });
    const res = resolveAndApplyAttempt(w1, mkAttempt("HumanVillageA"), { rng, nextEventSeq: () => 1 });
    assert.equal((res.world.sites["HumanVillageA"] as any).cultInfluence, 1);
  }

  // anchoring=60 => anchorMult=0.4 and high-anchor penalty 0.5 => chance 0.2 -> fail (0.3 !< 0.2)
  {
    const w1 = patchSite(w0, "HumanVillageA", { anchoringStrength: 60, cultInfluence: 0 });
    const res = resolveAndApplyAttempt(w1, mkAttempt("HumanVillageA"), { rng, nextEventSeq: () => 1 });
    assert.equal((res.world.sites["HumanVillageA"] as any).cultInfluence, 0);
  }

  // saturation: influence>80 halves chance
  // anchoring=0 => 1.0 * 0.5 = 0.5 -> succeed (0.3 < 0.5)
  {
    const w1 = patchSite(w0, "HumanVillageA", { anchoringStrength: 0, cultInfluence: 90 });
    const res = resolveAndApplyAttempt(w1, mkAttempt("HumanVillageA"), { rng, nextEventSeq: () => 1 });
    assert.equal((res.world.sites["HumanVillageA"] as any).cultInfluence, 91);
  }
});

test("integration: 30 days of daily preaching should not explode cultInfluence to 100", () => {
  let world = createWorld(7);
  const siteId = "HumanCityPort";
  const actorId = findNpcId(world, (n) => n.siteId === siteId);

  // Prevent recruitment from dominating this test:
  // keep exactly 1 cult member (the actor) but no recruiters (role 'none').
  const nextNpcs: WorldState["npcs"] = { ...world.npcs };
  for (const n of Object.values(world.npcs)) {
    if (n.siteId !== siteId) continue;
    nextNpcs[n.id] = {
      ...n,
      cult: { member: n.id === actorId, role: "none", joinedTick: n.id === actorId ? 0 : undefined }
    };
  }
  world = { ...world, npcs: nextNpcs };

  const preach = (tick: number): Attempt => ({
    id: `ext:preach:${tick}`,
    tick,
    kind: "preach_fixed_path",
    visibility: "public",
    actorId,
    siteId,
    durationHours: 2,
    intentMagnitude: "normal"
  });

  const start = (world.sites[siteId] as any).cultInfluence;
  let max = start;

  const rng = new Rng(123);
  let seq = 0;
  const nextEventSeq = () => ++seq;

  // Simulate 30 days:
  // - midday: preach once
  // - day boundary: apply cult daily process (which includes influence smoothing)
  for (let day = 0; day < 30; day++) {
    // midday preach
    world = { ...world, tick: day * 24 + 12 };
    world = resolveAndApplyAttempt(world, preach(world.tick), { rng, nextEventSeq }).world;
    max = Math.max(max, (world.sites[siteId] as any).cultInfluence);

    // daily boundary update (hour 0)
    world = { ...world, tick: (day + 1) * 24 };
    world = applyCultDaily(world, { rng, nextEventSeq }).world;
    max = Math.max(max, (world.sites[siteId] as any).cultInfluence);
  }

  const end = (world.sites[siteId] as any).cultInfluence;
  void end;
  assert.ok(max < 60, `expected influence to stay well below runaway levels, got max=${max}`);
});


