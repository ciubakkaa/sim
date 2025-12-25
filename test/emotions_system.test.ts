import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";
import { getEmotions } from "../src/sim/systems/emotions";

test("emotions: witnessing a violent public attempt increases fear/anger and then decays", () => {
  // Create a small deterministic world
  let world = createWorld(1);
  const siteId = "HumanVillageA";
  const npcsHere = Object.values(world.npcs).filter((n) => n.alive && n.siteId === siteId).sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(npcsHere.length >= 3);

  const actor = npcsHere[0]!;
  const target = npcsHere[1]!;
  const witness = npcsHere[2]!;

  const before = getEmotions(witness);
  assert.equal(before.fear, 0);
  assert.equal(before.anger, 0);

  // Force a public assault attempt so memory system will observe it.
  const attempt: any = {
    id: "test-attempt",
    tick: world.tick,
    kind: "assault",
    siteId,
    actorId: actor.id,
    targetId: target.id,
    visibility: "public",
    intentMagnitude: "minor",
    durationHours: 1,
    why: { text: "test" }
  };

  // Run one tick with the supplied attempt (ensures attempt.completed event exists)
  const res = tickHour(world, { attempts: [attempt] });
  world = res.world;

  const after = getEmotions(world.npcs[witness.id]!);
  assert.ok(after.fear >= before.fear, "fear should not decrease immediately");
  assert.ok(after.anger >= before.anger, "anger should not decrease immediately");

  // Advance hours and ensure decay
  for (let i = 0; i < 5; i++) {
    world = tickHour(world).world;
  }
  const later = getEmotions(world.npcs[witness.id]!);
  assert.ok(later.fear <= after.fear, "fear should decay over time");
  assert.ok(later.anger <= after.anger, "anger should decay over time");
});


