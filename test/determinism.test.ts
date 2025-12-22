import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runner/run";

const runSimTests = process.env.RUN_SIM_TESTS === "1" || process.env.RUN_SLOW_TESTS === "1";
const simTest = runSimTests ? test : test.skip;

simTest("determinism: same seed/days => identical outputs", () => {
  const a = runSimulation({ seed: 123, days: 7 });
  const b = runSimulation({ seed: 123, days: 7 });

  assert.deepEqual(a.finalWorld, b.finalWorld);
  assert.deepEqual(a.summaries, b.summaries);
  assert.deepEqual(a.events, b.events);
});

simTest("divergence: different seeds should produce different outcomes", () => {
  const a = runSimulation({ seed: 1, days: 10 });
  const b = runSimulation({ seed: 2, days: 10 });

  // Even if the world converges to a similar end-state, the path (daily summaries) should differ.
  assert.notDeepEqual(a.summaries, b.summaries);
});

simTest("invariants: bounds + non-negative resources", () => {
  const r = runSimulation({ seed: 999, days: 200 });

  for (const s of r.summaries) {
    for (const site of s.sites) {
      if (site.foodTotals) {
        assert.ok(site.foodTotals.grain >= 0, "grain must be >= 0");
        assert.ok(site.foodTotals.fish >= 0, "fish must be >= 0");
        assert.ok(site.foodTotals.meat >= 0, "meat must be >= 0");
      }
      if (site.cohorts) {
        const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
        assert.ok(pop >= 0, "population must be >= 0");
      }
      if (site.unrest !== undefined) {
        assert.ok(site.unrest >= 0 && site.unrest <= 100, "unrest must be 0..100");
      }
      if (site.hunger !== undefined) {
        assert.ok(site.hunger >= 0 && site.hunger <= 100, "hunger must be 0..100");
      }
      if (site.cultInfluence !== undefined) {
        assert.ok(site.cultInfluence >= 0 && site.cultInfluence <= 100, "cultInfluence must be 0..100");
      }
      assert.ok(site.eclipsingPressure >= 0 && site.eclipsingPressure <= 100, "eclipsingPressure must be 0..100");
      assert.ok(site.anchoringStrength >= 0 && site.anchoringStrength <= 100, "anchoringStrength must be 0..100");
    }
  }

  // Travel invariants (final world snapshot).
  for (const npc of Object.values(r.finalWorld.npcs)) {
    if (!npc.travel) continue;
    assert.ok(npc.travel.totalKm >= 0, "travel.totalKm must be >= 0");
    assert.ok(npc.travel.remainingKm >= 0, "travel.remainingKm must be >= 0");
    assert.ok(npc.travel.remainingKm <= npc.travel.totalKm, "travel.remainingKm must be <= travel.totalKm");
  }
});


