import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { Attempt, WorldState } from "../src/sim/types";
import { resolveHeal } from "../src/sim/attempts/resolvers/basic";
import { baselineRelationship } from "../src/sim/relationships";
import { clamp } from "../src/sim/util";
import { createConfig, resetConfig, setConfig } from "../src/sim/config";

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

test("rich relationships: heal creates relationship deltas + a favor debt (when enabled)", () => {
  setConfig(createConfig());
  try {
    let world = createWorld(1001);
    const siteId = "HumanVillageA";

    const healerId = findNpcId(world, (n) => n.alive && n.siteId === siteId);
    const patientId = findNpcId(world, (n) => n.alive && n.siteId === siteId && n.id !== healerId);

    // Ensure healer category + wounded patient.
    world = patchNpc(world, healerId, { category: "HealerHedgeMage", busyUntilTick: 0, lastAttemptTick: -999 });
    world = patchNpc(world, patientId, { hp: 50, maxHp: 100, busyUntilTick: 0, lastAttemptTick: -999 });

    const healerBefore = world.npcs[healerId]!;
    const patientBefore = world.npcs[patientId]!;
    const base = baselineRelationship(patientBefore, healerBefore, world);

    const attempt: Attempt = {
      id: "t:heal",
      tick: world.tick,
      kind: "heal",
      // Keep private so rumor system doesn't also modify relationships (we want to test v2 deltas here).
      visibility: "private",
      actorId: healerId,
      siteId,
      durationHours: 2,
      intentMagnitude: "normal"
    };

    // Deterministic resolver: always pick first candidate + minimal heal amount.
    const rng = {
      next: () => 0,
      int: (a: number, _b?: number) => a,
      chance: (p: number) => p >= 0
    } as any;
    let seq = 0;
    const res = resolveHeal(world, attempt, { rng, nextEventSeq: () => ++seq });

    const patientAfter = res.world.npcs[patientId]!;
    const rel = patientAfter.relationships[healerId];
    assert.ok(rel, "expected relationship materialized");
    assert.equal(rel.trust, clamp(base.trust + 12, 0, 100));
    assert.equal(rel.loyalty, clamp(base.loyalty + 6, 0, 100));
    assert.equal(rel.fear, clamp(base.fear - 2, 0, 100));

    const debts = patientAfter.debts ?? [];
    assert.ok(debts.length >= 1, "expected at least one debt on patient");
    const d = debts[debts.length - 1]!;
    assert.equal(d.otherNpcId, healerId);
    assert.equal(d.direction, "owes");
    assert.equal(d.debtKind, "favor_granted");
    assert.ok(d.magnitude >= 10 && d.magnitude <= 80);
  } finally {
    resetConfig();
  }
});

// v2-only: rich relationships are always enabled, so we no longer test "disabled" behavior.


