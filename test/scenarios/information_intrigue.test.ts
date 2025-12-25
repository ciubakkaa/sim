import test from "node:test";
import assert from "node:assert/strict";
import { runScenarioInformationIntrigue } from "../../src/sim/scenarios/v2Smoke";

test("Scenario (v2): information intrigue baseline (private crime) creates a secret + asymmetric knowledge", () => {
  const res = runScenarioInformationIntrigue(9202, "HumanCityPort");

  const secrets = res.world.secrets ?? {};
  const ids = Object.keys(secrets);
  assert.ok(ids.length >= 1, "expected at least one world secret");

  const actorSecrets: any[] = res.world.npcs[res.actorId]!.knowledge?.secrets ?? [];
  assert.ok(actorSecrets.length >= 1, "expected actor to learn secret knowledge");

  const observerSecrets: any[] = res.world.npcs[res.observerId]!.knowledge?.secrets ?? [];
  assert.equal(observerSecrets.length, 0, "expected observer to not learn private secret");
});

