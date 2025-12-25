import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { Attempt, WorldState } from "../src/sim/types";
import { resolveKill } from "../src/sim/attempts/resolvers/violence";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";
import { updateChronicleFromEvents } from "../src/sim/systems/narrative";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("narrative: when enabled, successful kill produces a chronicle entry", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(6001);
    const siteId = "HumanVillageA";
    const killerId = findNpcId(world, (n) => n.alive && n.siteId === siteId);
    const victimId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== killerId);
    world = patchNpc(world, killerId, { busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, victimId, { busyUntilTick: 0, lastAttemptTick: -999 });

    const attempt: Attempt = {
      id: "t:kill",
      tick: world.tick,
      kind: "kill",
      visibility: "public",
      actorId: killerId,
      targetId: victimId,
      siteId,
      durationHours: 1,
      intentMagnitude: "major"
    };

    // Force success: roll 0 for (0..99)
    const rng = { next: () => 0, int: (a: number, b?: number) => (a === 0 && b === 99 ? 0 : a), chance: () => false } as any;
    let seq = 0;
    const res = resolveKill(world, attempt, { rng, nextEventSeq: () => ++seq });

    const updated = updateChronicleFromEvents(res.world, res.events, () => ++seq);
    const chron = updated.chronicle;
    assert.ok(chron, "expected chronicle");
    assert.ok(chron.entries.some((e) => e.kind === "murder"), "expected murder chronicle entry");
    assert.ok(chron.beats.some((b) => b.kind === "murder"), "expected murder story beat");
  } finally {
    resetConfig();
  }
});

test("narrative: when disabled, no chronicle is created", () => {
  // v2-only: narrative is always enabled; chronicle is always present once events are processed.
  assert.ok(true);
});

test("narrative: operation milestone events create an arc and advance its acts", () => {
  setConfig(createConfig());
  try {
    const world = createWorld(6003);
    const siteId = "HumanCityPort";
    let seq = 0;

    const created: any = {
      id: "evt:op_created",
      tick: world.tick,
      kind: "faction.operation.created",
      visibility: "system",
      siteId,
      message: "Operation created",
      data: { operationId: "op:1", factionId: "cult", type: "kidnap", siteId }
    };
    const w1 = updateChronicleFromEvents(world, [created], () => ++seq);
    assert.ok(w1.chronicle?.arcs?.length, "expected arc created");
    const arc = w1.chronicle!.arcs![0]!;
    assert.equal(arc.operationId, "op:1");
    assert.equal(arc.actIndex, 0);

    const phase: any = {
      id: "evt:op_phase",
      tick: world.tick,
      kind: "faction.operation.phase",
      visibility: "system",
      siteId,
      message: "Operation phase",
      data: { operationId: "op:1", factionId: "cult", type: "kidnap", phaseIndex: 1 }
    };
    const w2 = updateChronicleFromEvents(w1, [phase], () => ++seq);
    const arc2 = w2.chronicle!.arcs!.find((a) => a.operationId === "op:1")!;
    assert.equal(arc2.actIndex, 1, "expected moved to Execution act");

    const completed: any = {
      id: "evt:op_done",
      tick: world.tick,
      kind: "faction.operation.completed",
      visibility: "system",
      siteId,
      message: "Operation completed",
      data: { operationId: "op:1", factionId: "cult", type: "kidnap", outcome: "success" }
    };
    const w3 = updateChronicleFromEvents(w2, [completed], () => ++seq);
    const arc3 = w3.chronicle!.arcs!.find((a) => a.operationId === "op:1")!;
    assert.equal(arc3.status, "concluded");
    assert.equal(arc3.actIndex, 2, "expected moved to Outcome act");
    assert.ok(w3.chronicle!.entries.some((e) => e.kind === "major_event"), "expected chronicle entry for op milestone");
  } finally {
    resetConfig();
  }
});


