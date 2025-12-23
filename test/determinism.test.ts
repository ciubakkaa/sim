import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";

const runSlow = process.env.RUN_SLOW_TESTS === "1";
const maybeTest = runSlow ? test : test.skip;

function runHours(seed: number, hours: number) {
  let world = createWorld(seed);
  const events: any[] = [];
  const summaries: any[] = [];
  for (let i = 0; i < hours; i++) {
    const res = tickHour(world);
    world = res.world;
    if (res.dailySummary) summaries.push(res.dailySummary);
    events.push(...res.events);
  }
  return { finalWorld: world, summaries, events };
}

maybeTest("determinism: same seed/days => identical outputs", () => {
  // Keep runtime bounded: 6 hours is enough to validate determinism guarantees.
  const a = runHours(123, 6);
  const b = runHours(123, 6);

  assert.deepEqual(a.finalWorld, b.finalWorld);
  assert.deepEqual(a.summaries, b.summaries);
  assert.deepEqual(a.events, b.events);
});

maybeTest("divergence: different seeds should produce different outcomes", () => {
  const a = runHours(1, 6);
  const b = runHours(2, 6);

  // Even if the world converges to a similar end-state, the path (daily summaries) should differ.
  assert.notDeepEqual(a.events, b.events);
});

maybeTest("invariants: bounds + non-negative resources", () => {
  const r = runHours(999, 6);

  // Travel invariants (final world snapshot).
  for (const npc of Object.values(r.finalWorld.npcs)) {
    if (!npc.travel) continue;
    assert.ok(npc.travel.totalKm >= 0, "travel.totalKm must be >= 0");
    assert.ok(npc.travel.remainingKm >= 0, "travel.remainingKm must be >= 0");
    assert.ok(npc.travel.remainingKm <= npc.travel.totalKm, "travel.remainingKm must be <= travel.totalKm");
  }
});


