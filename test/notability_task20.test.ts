import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { applyNotabilityFromEvents, decayNotabilityDaily } from "../src/sim/notability";
import type { SimEvent } from "../src/sim/types";

test("Task 20: decay is 0.5/day normally and 0.25/day when notability > 50", () => {
  let world = createWorld(1);
  world = { ...world, tick: 24 * 10 }; // day 10
  const id = Object.values(world.npcs).find(
    (n) => n.category !== "LocalLeader" && n.category !== "ElvenLeader" && n.category !== "ConcordCellLeaderRitualist"
  )!.id;

  world = { ...world, npcs: { ...world.npcs, [id]: { ...world.npcs[id]!, notability: 40 } } };
  world = decayNotabilityDaily(world);
  assert.equal(world.npcs[id]!.notability, 39.5);

  world = { ...world, npcs: { ...world.npcs, [id]: { ...world.npcs[id]!, notability: 60 } } };
  world = decayNotabilityDaily(world);
  assert.equal(world.npcs[id]!.notability, 59.75);
});

test("Task 20: major events grant +50% notability", () => {
  let world = createWorld(2);
  const id = Object.values(world.npcs).find(
    (n) => n.category !== "LocalLeader" && n.category !== "ElvenLeader" && n.category !== "ConcordCellLeaderRitualist"
  )!.id;
  world = { ...world, npcs: { ...world.npcs, [id]: { ...world.npcs[id]!, notability: 0 } } };

  const evt: SimEvent = {
    id: "evt",
    tick: world.tick,
    kind: "attempt.recorded",
    visibility: "public",
    siteId: "HumanVillageA",
    message: "raid",
    data: {
      attempt: { id: "a", tick: world.tick, kind: "raid", visibility: "public", actorId: id, siteId: "HumanVillageA", durationHours: 3, intentMagnitude: "major" }
    } as any
  };

  const w2 = applyNotabilityFromEvents(world, [evt]);
  // base raid 15 * 1.5 => 22.5 => 23
  assert.equal(w2.npcs[id]!.notability, 23);
});

test("Task 20: leadership roles have minimum notability of 40", () => {
  let world = createWorld(3);
  const leaderId = Object.values(world.npcs).find((n) => n.category === "LocalLeader")!.id;
  world = { ...world, tick: 24, npcs: { ...world.npcs, [leaderId]: { ...world.npcs[leaderId]!, notability: 5 } } };
  const w2 = decayNotabilityDaily(world);
  assert.equal(w2.npcs[leaderId]!.notability, 40);
});

test("Task 20: notability is preserved for 30 days after death", () => {
  let world = createWorld(4);
  const id = Object.values(world.npcs)[0]!.id;
  world = {
    ...world,
    tick: 24 * 100,
    npcs: {
      ...world.npcs,
      [id]: { ...world.npcs[id]!, alive: false, notability: 80, death: { tick: 24 * 75, cause: "murder", atSiteId: "HumanVillageA" } as any }
    }
  };

  const w2 = decayNotabilityDaily(world);
  assert.equal(w2.npcs[id]!.notability, 80);

  // After 31 days, decay resumes (80 -> 79.75 since > 50).
  world = { ...world, tick: 24 * 107 };
  const w3 = decayNotabilityDaily(world);
  assert.equal(w3.npcs[id]!.notability, 79.75);
});


