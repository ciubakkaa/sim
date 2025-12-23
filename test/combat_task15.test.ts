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

test("Task 15: assault applies damage to both attacker and defender", () => {
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.siteId === siteId && n.alive);
  const targetId = findNpcId(world, (n) => n.siteId === siteId && n.alive && n.id !== actorId);

  world = patchNpc(world, actorId, { hp: 100, maxHp: 100 });
  world = patchNpc(world, targetId, { hp: 100, maxHp: 100 });

  const attempt: Attempt = {
    id: "t:assault",
    tick: world.tick,
    kind: "assault",
    visibility: "public",
    actorId,
    targetId,
    siteId,
    durationHours: 1,
    intentMagnitude: "normal"
  };

  const rng = {
    next: () => 0,
    chance: () => false,
    int: (a: number, b?: number) => {
      if (a === 0 && b === 99) return 0; // success
      return 0; // deterministic
    }
  } as any;
  let seq = 0;
  const res = resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq });
  assert.ok(res.world.npcs[actorId]!.hp < 100, "attacker should take retaliation damage");
  assert.ok(res.world.npcs[targetId]!.hp < 100, "target should take damage");
});

test("Task 15: kill success baseline is 30% (roll 29 succeeds, roll 30 fails) for equal traits", () => {
  let world = createWorld(2);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(world, (n) => n.siteId === siteId && n.alive);
  const targetId = findNpcId(world, (n) => n.siteId === siteId && n.alive && n.id !== actorId);

  const traits50 = {
    ...world.npcs[actorId]!.traits,
    Aggression: 50,
    Courage: 50,
    Discipline: 50
  };
  world = patchNpc(world, actorId, { traits: traits50, hp: 100, maxHp: 100 });
  world = patchNpc(world, targetId, { traits: traits50, hp: 100, maxHp: 100 });

  const mk = (roll: number): WorldState => {
    const attempt: Attempt = {
      id: `t:kill:${roll}`,
      tick: world.tick,
      kind: "kill",
      visibility: "public",
      actorId,
      targetId,
      siteId,
      durationHours: 1,
      intentMagnitude: "major"
    };
    const rng = {
      next: () => 0,
      chance: () => false,
      int: (a: number, b?: number) => {
        if (a === 0 && b === 99) return roll;
        return 0;
      }
    } as any;
    let seq = 0;
    return resolveAndApplyAttempt(world, attempt, { rng, nextEventSeq: () => ++seq }).world;
  };

  const wSucceed = mk(29);
  assert.equal(wSucceed.npcs[targetId]!.alive, false, "expected kill at roll 29");

  const wFail = mk(30);
  assert.equal(wFail.npcs[targetId]!.alive, true, "expected fail at roll 30");
});


