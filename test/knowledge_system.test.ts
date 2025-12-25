import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import type { Attempt, WorldState } from "../src/sim/types";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";

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

test("knowledge: investigate records identified cult member as a fact when enabled", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(3001);
    const siteId = "HumanVillageA";
    world = patchSite(world, siteId, { cultInfluence: 80 });

    const guardA = findNpcId(world, (n) => n.category === "GuardMilitia");
    const cultId = findNpcId(world, (n) => n.cult.member);

    world = patchNpc(world, guardA, { siteId, traits: { ...world.npcs[guardA]!.traits, Suspicion: 100, Discipline: 100 } });
    world = patchNpc(world, cultId, { siteId });

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

    const actor = res.world.npcs[guardA] as any;
    const facts = actor.knowledge?.facts ?? [];
    assert.ok(facts.some((f: any) => f.kind === "identified_cult_member" && f.confidence >= 70), "expected identified_cult_member fact");
  } finally {
    resetConfig();
  }
});

// v2-only: knowledge is always enabled, so we no longer test "disabled" behavior.


