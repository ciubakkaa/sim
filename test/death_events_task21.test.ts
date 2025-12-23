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

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("Task 21: kill emits npc.died event and seeds npc_died beliefs for witnesses", () => {
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.siteId === siteId && n.alive);
  const targetId = findNpcId(world, (n) => n.siteId === siteId && n.alive && n.id !== actorId);
  const witnessId = findNpcId(world, (n) => n.siteId === siteId && n.alive && n.id !== actorId && n.id !== targetId);

  // Force baseline-ish traits but ensure success: roll=0.
  world = patchNpc(world, actorId, { traits: { ...world.npcs[actorId]!.traits, Aggression: 100, Courage: 100, Discipline: 100 } });
  world = patchNpc(world, targetId, { traits: { ...world.npcs[targetId]!.traits, Courage: 0, Discipline: 0, Aggression: 0 } });

  const attempt: Attempt = {
    id: "t:kill",
    tick: world.tick,
    kind: "kill",
    visibility: "public",
    actorId,
    targetId,
    siteId,
    durationHours: 1,
    intentMagnitude: "major"
  };

  const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });

  const died = res.events.find((e) => e.kind === "npc.died" && (e.data as any)?.npcId === targetId);
  assert.ok(died, "expected npc.died event");
  assert.equal((died!.data as any).cause, "murder");
  assert.equal((died!.data as any).byNpcId, actorId);

  const witness = res.world.npcs[witnessId]!;
  assert.ok(witness.beliefs.some((b) => b.predicate === "npc_died" && b.subjectId === targetId && b.object === "murder"));
});

test("Task 21: raid victim death emits npc.died event and adds keyChanges", () => {
  let world = createWorld(2);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.category === "BanditRaider");
  world = patchNpc(world, actorId, { siteId });

  const attempt: Attempt = {
    id: "t:raid",
    tick: world.tick,
    kind: "raid",
    visibility: "public",
    actorId,
    siteId,
    durationHours: 3,
    intentMagnitude: "major"
  };

  // Force: success roll=0; victim kill chance = true; victim selection index 0.
  const rng = {
    next: () => 0,
    int: (a: number, b?: number) => {
      if (a === 0 && b === 99) return 0;
      return a;
    },
    chance: (p: number) => (p === 0.35 ? true : false)
  } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  assert.ok(res.events.some((e) => e.kind === "npc.died" && (e.data as any)?.cause === "raid"));
  assert.ok(res.keyChanges.some((s) => s.includes("died in a raid")));
});


