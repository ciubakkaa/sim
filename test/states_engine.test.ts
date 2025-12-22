import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import type { ReactiveStateDefinition } from "../src/sim/states/types";
import { decayActiveStates, updateStates } from "../src/sim/states/engine";
import { STATE_DEFINITIONS } from "../src/sim/states/definitions";
import { resolveStateConflicts } from "../src/sim/states/conflicts";
import type { ActiveState } from "../src/sim/states/types";
import type { SimEvent, WorldState } from "../src/sim/types";

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("states: trigger detection (witnessedAttempt assault as victim)", () => {
  const w0 = createWorld(1);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(w0, (n) => n.siteId === siteId && n.alive);
  const targetId = findNpcId(w0, (n) => n.siteId === siteId && n.alive && n.id !== actorId);

  const vengeful = STATE_DEFINITIONS.find((d) => d.id === "vengeful");
  assert.ok(vengeful, "missing vengeful def");

  const ev: SimEvent = {
    id: "evt:test",
    tick: w0.tick,
    kind: "attempt.recorded",
    visibility: "public",
    siteId,
    message: "test assault",
    data: {
      attempt: {
        id: "att:test",
        tick: w0.tick,
        kind: "assault",
        visibility: "public",
        actorId,
        targetId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      },
      success: true
    }
  };

  const w1 = updateStates(w0, w0, [ev], { definitions: [vengeful] });
  assert.ok(w1.npcs[targetId]!.activeStates.some((s) => s.definitionId === "vengeful"));
});

test("states: decay reduces intensity over time and removes at expiry", () => {
  const def: ReactiveStateDefinition = {
    id: "x",
    name: "x",
    triggers: [],
    weightModifiers: [{ actionKind: "*", weightDelta: 1 }],
    baseDurationHours: 10,
    decayRateModifier: 1,
    resistanceTraits: {},
    priority: 0,
    stackable: false
  };
  const defs = new Map([[def.id, def]]);
  const s: ActiveState = { definitionId: "x", startedTick: 0, expiresAtTick: 10, intensity: 100 };

  const after1 = decayActiveStates([s], 1, defs);
  assert.equal(after1.length, 1);
  assert.equal(Math.round(after1[0]!.intensity), 90);

  const after10 = decayActiveStates([s], 10, defs);
  assert.equal(after10.length, 0);
});

test("states: conflict resolution halves lower-priority state modifiers", () => {
  const fearful = STATE_DEFINITIONS.find((d) => d.id === "fearful");
  const vengeful = STATE_DEFINITIONS.find((d) => d.id === "vengeful");
  assert.ok(fearful && vengeful, "missing defs");

  const defsById = new Map([
    ["fearful", fearful],
    ["vengeful", vengeful]
  ]);

  const active: ActiveState[] = [
    { definitionId: "fearful", startedTick: 0, expiresAtTick: 100, intensity: 100 },
    { definitionId: "vengeful", startedTick: 0, expiresAtTick: 100, intensity: 100 }
  ];

  const mods = resolveStateConflicts(active, defsById);
  const fearfulAssault = mods.find((m) => m.actionKind === "assault" && m.weightDelta < 0);
  const vengefulAssault = mods.find((m) => m.actionKind === "assault" && m.weightDelta > 0);

  assert.equal(fearfulAssault?.weightDelta, -20); // -40 halved
  assert.equal(vengefulAssault?.weightDelta, 40); // +40 full
});

test("states: needThreshold duration uses stateTriggerMemory", () => {
  const def: ReactiveStateDefinition = {
    id: "need_state",
    name: "Need State",
    triggers: [{ type: "needThreshold", need: "Food", op: ">", value: 85, duration: 2 }],
    weightModifiers: [{ actionKind: "*", weightDelta: 1 }],
    baseDurationHours: 24,
    decayRateModifier: 1,
    resistanceTraits: {},
    priority: 0,
    stackable: false
  };

  const w0 = createWorld(1);
  const npcId = findNpcId(w0, (n) => n.siteId === "HumanVillageA" && n.alive);

  const w0a: WorldState = {
    ...w0,
    npcs: { ...w0.npcs, [npcId]: { ...w0.npcs[npcId]!, needs: { ...w0.npcs[npcId]!.needs, Food: 90 } } }
  };

  const w0u = updateStates(w0a, w0a, [], { definitions: [def] });
  assert.equal(w0u.npcs[npcId]!.activeStates.some((s) => s.definitionId === "need_state"), false);

  const w1 = { ...w0u, tick: 1 };
  const w1u = updateStates(w1, w0u, [], { definitions: [def] });
  assert.equal(w1u.npcs[npcId]!.activeStates.some((s) => s.definitionId === "need_state"), false);

  const w2 = { ...w1u, tick: 2 };
  const w2u = updateStates(w2, w1u, [], { definitions: [def] });
  assert.equal(w2u.npcs[npcId]!.activeStates.some((s) => s.definitionId === "need_state"), true);
});


