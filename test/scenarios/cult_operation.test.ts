import test from "node:test";
import assert from "node:assert/strict";
import { runScenarioCultOperation } from "../../src/sim/scenarios/v2Smoke";

test("Scenario (v2): cult operation lifecycle creates op, advances phases, and concludes arc", () => {
  const res = runScenarioCultOperation(9204, "HumanCityPort");

  const ops = res.world.operations ?? {};
  const op = ops[res.opId];
  assert.ok(op, "expected operation present in world");
  assert.ok(op.status === "active" || op.status === "completed" || op.status === "aborted");

  // Narrative arc is created/advanced from milestone events.
  const arcs: any[] = (res.world as any).chronicle?.arcs ?? [];
  assert.ok(arcs.some((a) => a.operationId === res.opId), "expected narrative arc for operation");

  // We should see milestone events emitted.
  assert.ok(res.events.some((e) => e.kind === "faction.operation.created"), "expected op.created event");
  assert.ok(res.events.some((e) => e.kind === "faction.operation.phase"), "expected op.phase event");
  assert.ok(
    res.events.some((e) => e.kind === "faction.operation.completed" || e.kind === "faction.operation.aborted"),
    "expected op completed/aborted event"
  );
});

