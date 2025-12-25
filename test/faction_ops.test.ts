import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { WorldState } from "../src/sim/types";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";
import { applyOperationProgressFromEvents, operationWeightModifiersForNpc, updateFactionOperationsWithEvents } from "../src/sim/systems/factionOps";
import { generateScoredAttempt } from "../src/sim/attempts/generate";

function patchNpc(world: WorldState, npcId: string, patch: any): WorldState {
  const npc = world.npcs[npcId];
  assert.ok(npc, "npc must exist");
  return { ...world, npcs: { ...world.npcs, [npcId]: { ...npc, ...patch } } };
}

function patchSite(world: WorldState, siteId: string, patch: any): WorldState {
  const site = world.sites[siteId];
  assert.ok(site, "site must exist");
  return { ...world, sites: { ...world.sites, [siteId]: { ...(site as any), ...(patch as any) } } };
}

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

const deterministicRng = {
  next: () => 0,
  int: (a: number, _b?: number) => a,
  chance: (_p: number) => false
} as any;

test("faction ops: when enabled, cult operation is created under high pressure and biases members toward kidnap", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(5001);
    const siteId = "HumanCityPort";
    world = patchSite(world, siteId, { eclipsingPressure: 70, anchoringStrength: 20 });

    // Ensure a cell leader + another cult member at site, and a non-cult target.
    const leaderId = findNpcId(world, (n) => n.cult?.role === "cell_leader");
    const cult2Id = findNpcId(world, (n) => n.cult?.member && n.id !== leaderId);
    const targetId = findNpcId(world, (n) => !n.cult?.member);

    world = patchNpc(world, leaderId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, cult2Id, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, targetId, { siteId });

    let seq = 0;
    const opRes = updateFactionOperationsWithEvents(world, () => ++seq);
    world = opRes.world;
    const ops = world.operations ?? {};
    assert.ok(Object.keys(ops).length >= 1, "expected an operation created");

    const op = Object.values(ops)[0]!;
    assert.equal(op.factionId, "cult");
    assert.equal(op.type, "kidnap");

    // Bias should influence attempt generation to pick recon first for a participant.
    const npc = world.npcs[cult2Id]!;
    const att = generateScoredAttempt(npc, world, deterministicRng);
    assert.ok(att, "expected attempt");
    assert.equal(att!.kind, "recon");
  } finally {
    resetConfig();
  }
});

test("faction ops: multi-phase op advances from kidnap -> forced_eclipse on executed attempts", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(5002);
    const siteId = "HumanCityPort";
    world = patchSite(world, siteId, { eclipsingPressure: 70, anchoringStrength: 20 });

    const leaderId = findNpcId(world, (n) => n.cult?.role === "cell_leader");
    const cult2Id = findNpcId(world, (n) => n.cult?.member && n.id !== leaderId);
    const targetId = findNpcId(world, (n) => !n.cult?.member);

    world = patchNpc(world, leaderId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, cult2Id, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, targetId, { siteId, busyUntilTick: 0, lastAttemptTick: -999 });

    let seq = 0;
    world = updateFactionOperationsWithEvents(world, () => ++seq).world;
    const op = Object.values(world.operations ?? {})[0]!;
    assert.ok(op.phases && op.phases.length >= 2, "expected multi-phase op");
    assert.equal(op.phaseIndex ?? 0, 0);

    // Before progress: bias should be recon.
    assert.equal(generateScoredAttempt(world.npcs[cult2Id]!, world, deterministicRng)!.kind, "recon");

    // Apply an executed recon attempt record.
    const evRecon: any = {
      id: "evt:recon",
      tick: world.tick,
      kind: "attempt.recorded",
      visibility: "private",
      siteId,
      message: "recon",
      data: { attempt: { actorId: cult2Id, kind: "recon" }, success: true, consequences: [] }
    };
    world = applyOperationProgressFromEvents(world, [evRecon], () => ++seq).world;
    const op1 = Object.values(world.operations ?? {})[0]!;
    assert.equal(op1.phaseIndex, 1, "expected phase advanced");
    assert.equal(op1.status, "active");

    // After progress: weight modifier should point to kidnap (phase 2).
    const mods = operationWeightModifiersForNpc(world.npcs[cult2Id]!, world);
    assert.ok(mods.length >= 1);
    assert.equal(mods[0]!.actionKind, "kidnap");

    // Apply an executed kidnap attempt record, advances to forced_eclipse.
    const evKidnap: any = {
      id: "evt:kidnap",
      tick: world.tick,
      kind: "attempt.recorded",
      visibility: "private",
      siteId,
      message: "kidnap",
      data: { attempt: { actorId: cult2Id, kind: "kidnap", targetId }, success: true, consequences: [] }
    };
    world = applyOperationProgressFromEvents(world, [evKidnap], () => ++seq).world;
    const op2 = Object.values(world.operations ?? {})[0]!;
    assert.equal(op2.phaseIndex, 2, "expected phase advanced to forced_eclipse");

    // Apply executed forced_eclipse attempt record, completes.
    const evRitual: any = {
      id: "evt:ritual",
      tick: world.tick,
      kind: "attempt.recorded",
      visibility: "private",
      siteId,
      message: "forced_eclipse",
      data: { attempt: { actorId: cult2Id, kind: "forced_eclipse", targetId }, success: true, consequences: [] }
    };
    world = applyOperationProgressFromEvents(world, [evRitual], () => ++seq).world;
    const op3 = Object.values(world.operations ?? {})[0]!;
    assert.equal(op3.status, "completed", "expected completed after last phase");
  } finally {
    resetConfig();
  }
});


