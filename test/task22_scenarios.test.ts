import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runner/run";

const runSlow = process.env.RUN_SLOW_TESTS === "1";
const slowTest = runSlow ? test : test.skip;

slowTest("Task 22: 7-day simulation should show food/population stability signals (no negative food/pop)", () => {
  const r = runSimulation({ seed: 42, days: 7 });
  for (const s of r.summaries) {
    for (const site of s.sites) {
      if (site.foodTotals) {
        assert.ok(site.foodTotals.grain >= 0);
        assert.ok(site.foodTotals.fish >= 0);
        assert.ok(site.foodTotals.meat >= 0);
      }
      if (site.cohorts) {
        const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
        assert.ok(pop >= 0);
      }
    }
  }
});

slowTest("Task 22: 30-day simulation should produce emergent events (some conflict + some system events)", () => {
  const r = runSimulation({ seed: 77, days: 30 });
  const kinds = new Set(r.events.map((e) => e.kind));
  const hasConflictAttempt = r.events.some(
    (e) => e.kind === "attempt.recorded" && ["assault", "raid", "steal", "kidnap"].includes((e.data as any)?.attempt?.kind)
  );
  assert.ok(hasConflictAttempt, "expected at least one conflict attempt within 30 days");
  assert.ok(kinds.has("world.food.consumed") && kinds.has("world.food.produced"), "expected food system to run");
});


