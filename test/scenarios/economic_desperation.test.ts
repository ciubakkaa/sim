import test from "node:test";
import assert from "node:assert/strict";
import { runScenarioEconomicDesperation } from "../../src/sim/scenarios/v2Smoke";

test("Scenario (v2): economic desperation baseline (hungry + coins) buys food at local market", () => {
  const res = runScenarioEconomicDesperation(9203, "HumanCityPort");
  assert.ok(res.after.foodTotal > res.before.foodTotal, "expected food to increase after trade buy");
  assert.ok(res.after.coins < res.before.coins, "expected coins to decrease after trade buy");
});

