import test from "node:test";
import assert from "node:assert/strict";
import { runScenarioRevengeArc } from "../../src/sim/scenarios/v2Smoke";

test("Scenario (v2): revenge arc seed event (public murder) creates memory + hostility + chronicle entry", () => {
  const res = runScenarioRevengeArc(9201, "HumanVillageA");

  // Victim died, and chronicle recorded the murder.
  assert.equal(res.world.npcs[res.victimId]!.alive, false);
  const entries: any[] = (res.world as any).chronicle?.entries ?? [];
  assert.ok(entries.some((e) => e.kind === "murder"), "expected murder chronicle entry");

  // Witness formed a memory about the death/murder context.
  const witness: any = res.world.npcs[res.witnessId] as any;
  const mems: any[] = witness.episodicMemory ?? [];
  assert.ok(Array.isArray(mems) && mems.length >= 1, "expected episodicMemory to be present");
  assert.ok(mems.some((m) => (m.eventType === "witnessed_death" || m.eventType === "witnessed_murder") && String(m.description).length > 0));

  // Public rumor should drive relationship toward hostility (low trust and/or higher fear).
  const rel: any = res.world.npcs[res.witnessId]!.relationships?.[res.killerId];
  assert.ok(rel, "expected relationship materialized");
  assert.ok(Number(rel.trust ?? 100) <= 25 || Number(rel.fear ?? 0) >= 25, "expected hostility shift toward killer");
});

