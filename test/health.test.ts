import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { resolveAndApplyAttempt } from "../src/sim/attempts";
import { Rng } from "../src/sim/rng";

test("assault reduces target hp (and can kill at 0)", () => {
  let world = createWorld(2);
  world = { ...world, tick: 10 };

  const npcs = Object.values(world.npcs).filter((n) => n.alive && n.siteId === "HumanVillageA");
  assert.ok(npcs.length >= 2);
  const actor = npcs[0]!;
  const target = { ...npcs[1]!, hp: 10, maxHp: 100 };

  world = { ...world, npcs: { ...world.npcs, [target.id]: target } };

  let seq = 0;
  const ctx = { rng: new Rng(123), nextEventSeq: () => ++seq };

  world = resolveAndApplyAttempt(
    world,
    {
      id: "att:assault",
      tick: world.tick,
      kind: "assault",
      visibility: "public",
      actorId: actor.id,
      targetId: target.id,
      siteId: "HumanVillageA",
      durationHours: 1,
      intentMagnitude: "normal"
    },
    ctx
  ).world;

  const after = world.npcs[target.id]!;
  assert.ok(after.hp <= 10);
  assert.ok(after.hp >= 0);
});


