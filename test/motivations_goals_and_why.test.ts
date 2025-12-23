import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";

test("attaches why to non-idle attempts and stores it on npc.recentActions", () => {
  let world = createWorld(1);

  // Advance a few ticks to ensure attempts happen.
  const allEvents: any[] = [];
  for (let i = 0; i < 12; i++) {
    const res = tickHour(world);
    world = res.world;
    allEvents.push(...res.events);
  }

  const attemptEvents = allEvents.filter((e) => e.kind === "attempt.recorded" && e.data?.attempt);
  assert.ok(attemptEvents.length > 0);

  const withWhy = attemptEvents.filter((e) => e.data.attempt.kind !== "idle" && e.data.attempt.why?.text);
  assert.ok(withWhy.length > 0);

  const a = withWhy[0].data.attempt;
  assert.equal(typeof a.why.text, "string");
  assert.ok(Array.isArray(a.why.drivers));

  const actor = world.npcs[a.actorId];
  assert.ok(actor);
  assert.ok(actor.recentActions.some((ra) => ra.tick === a.tick && ra.kind === a.kind && ra.why?.text));
});

test("forms multiple parallel goals for at least some NPCs (e.g. guards)", () => {
  let world = createWorld(1);
  // One tick is enough because tickHour runs updateGoals.
  world = tickHour(world).world;

  const npcs = Object.values(world.npcs).filter((n) => n.alive);
  assert.ok(npcs.length > 0);

  const someHaveGoals = npcs.filter((n) => (n.goals?.length ?? 0) > 0);
  assert.ok(someHaveGoals.length > 0);

  const guards = npcs.filter((n) => n.category === "GuardMilitia");
  if (guards.length) {
    const g = guards[0];
    assert.ok((g.goals?.length ?? 0) >= 2);
  }
});

test("seeds family links deterministically and symmetrically", () => {
  const world = createWorld(1);
  const npcs = Object.values(world.npcs);
  const withFamily = npcs.filter((n) => (n.familyIds?.length ?? 0) > 0);
  assert.ok(withFamily.length > 0);

  const n = withFamily[0]!;
  const fam = n.familyIds[0]!;
  assert.equal(world.npcs[fam]?.familyIds.includes(n.id), true);
});


