import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runner/run";

test("determinism: same seed/days => identical outputs", () => {
  const a = runSimulation({ seed: 123, days: 30 });
  const b = runSimulation({ seed: 123, days: 30 });

  assert.deepEqual(a.finalWorld, b.finalWorld);
  assert.deepEqual(a.summaries, b.summaries);
  assert.deepEqual(a.events, b.events);
});

test("divergence: different seeds should produce different outcomes", () => {
  const a = runSimulation({ seed: 1, days: 50 });
  const b = runSimulation({ seed: 2, days: 50 });

  // Even if the world converges to a similar end-state, the path (daily summaries) should differ.
  assert.notDeepEqual(a.summaries, b.summaries);
});

test("invariants: bounds + non-negative resources", () => {
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
      if (site.cultInfluence !== undefined) {
        assert.ok(site.cultInfluence >= 0 && site.cultInfluence <= 100, "cultInfluence must be 0..100");
      }
      assert.ok(site.eclipsingPressure >= 0 && site.eclipsingPressure <= 100, "eclipsingPressure must be 0..100");
      assert.ok(site.anchoringStrength >= 0 && site.anchoringStrength <= 100, "anchoringStrength must be 0..100");
    }
  }
});


