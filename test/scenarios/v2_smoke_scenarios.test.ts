import test from "node:test";
import assert from "node:assert/strict";
import { runScenarioHealDebt, runScenarioInvestigateKnowledge, runScenarioKidnapChronicle, runScenarioPlanningInventorySteal } from "../../src/sim/scenarios/v2Smoke";

test("Scenario (v2 smoke): heal creates favor debt + relationship delta (rich relationships enabled)", () => {
  const res = runScenarioHealDebt(9101, "HumanCityPort");
  const healed = res.world.npcs[res.targetId]!;
  const debts = healed.debts ?? [];
  assert.ok(debts.length >= 1, "expected at least one debt on healed NPC");
  const favor = debts.find((d: any) => d.debtKind === "favor_granted" && d.otherNpcId === res.healerId && d.direction === "owes");
  assert.ok(favor, "expected favor_granted debt owed to healer");

  const rel: any = (healed.relationships as any)?.[res.healerId];
  assert.ok(rel, "expected relationship materialized");
  assert.ok(Number(rel.trust ?? 0) > 0, "expected trust increase");
});

test("Scenario (v2 smoke): investigate can create/propagate knowledge facts (knowledge enabled)", () => {
  const res = runScenarioInvestigateKnowledge(9102, "HumanCityPort", 50);
  const facts: any[] = res.world.npcs[res.guardId]!.knowledge?.facts ?? [];
  const found = facts.some((f) => f.kind === "identified_cult_member" && f.subjectId === res.cultId);
  assert.ok(found, "expected guard to eventually gain identified_cult_member knowledge within bounded ticks");

  const otherGuardsHere = Object.values(res.world.npcs).filter(
    (n) =>
      n.alive &&
      n.siteId === res.siteId &&
      n.id !== res.guardId &&
      (n.category === "GuardMilitia" || n.category === "ScoutRanger" || n.category === "Threadwarden")
  );
  if (otherGuardsHere.length) {
    const propagated = otherGuardsHere.some((g) => (res.world.npcs[g.id]!.knowledge?.facts ?? []).some((f: any) => f.kind === "identified_cult_member"));
    assert.ok(propagated, "expected investigation knowledge to propagate to at least one other guard at site");
  }
});

test("Scenario (v2 smoke): successful kidnap creates a chronicle entry (narrative enabled)", () => {
  const res = runScenarioKidnapChronicle(9103, "HumanCityPort", 12);
  const entries: any[] = (res.world as any).chronicle?.entries ?? [];
  const gotChronicle = entries.some((e) => e.kind === "kidnap" && e.primaryNpcId === res.actorId);
  assert.ok(gotChronicle, "expected a kidnap chronicle entry within bounded ticks");
});

test("Scenario (v2 smoke): planning + inventory: repeated planned steal gains food inventory within bounded ticks", () => {
  const res = runScenarioPlanningInventorySteal(9104, "HumanCityPort", 20);
  assert.ok(res.foodGained > 0, "expected some food added to personal inventory");
});


