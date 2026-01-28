/**
 * Tests for the kernel's TraceLog for DecisionTraces.
 * 
 * TraceLog is a separate stream from WorldEventLog (EventBus):
 * - WorldEventLog: facts that happened in-world
 * - TraceLog: debug artifacts (decision traces, scoring breakdowns)
 * 
 * They share ID namespace and causality refs, but have separate storage.
 */

import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { TraceLog } from "../src/kernel/traces/traceLog";
import { stableHashHex } from "../src/kernel/hash";
import type { DecisionTrace, DecisionReason } from "../src/kernel/traces/traceTypes";

// Helper to create a valid decision trace
function createTestTrace(overrides?: Partial<Omit<DecisionTrace, "id">>): Omit<DecisionTrace, "id"> {
  return {
    tick: 100,
    agentId: "npc:1",
    reason: "goal_formed",
    location: { siteId: "village1" },
    needsSnapshot: { hunger: 0.3, safety: 0.7 },
    traitSnapshot: { bravery: 0.5, greed: 0.2 },
    topOptions: [
      { actionKind: "steal", score: 0.8, reasons: ["low_wealth", "nearby_target"] },
      { actionKind: "work", score: 0.5, reasons: ["needs_income"] },
      { actionKind: "idle", score: 0.2, reasons: ["default"] },
    ],
    chosenOption: { actionKind: "steal", score: 0.8 },
    perceivedInfoRefs: {},
    ...overrides,
  };
}

describe("TraceLog", () => {
  let traceLog: TraceLog;

  beforeEach(() => {
    traceLog = new TraceLog({ devMode: true });
  });

  describe("emitDecision", () => {
    it("returns stable trace ID with trace- prefix", () => {
      const trace = createTestTrace();
      const id = traceLog.emitDecision(trace);

      assert.ok(id.startsWith("trace-"), `Expected trace- prefix, got: ${id}`);
    });

    it("generates consistent IDs for same parameters", () => {
      const log1 = new TraceLog({ devMode: false });
      const log2 = new TraceLog({ devMode: false });

      const trace = createTestTrace();

      const id1 = log1.emitDecision(trace);
      const id2 = log2.emitDecision(trace);

      assert.equal(id1, id2);
    });

    it("stores traces that can be retrieved", () => {
      const trace = createTestTrace();
      traceLog.emitDecision(trace);

      const traces = traceLog.getAll();
      assert.equal(traces.length, 1);
      assert.equal(traces[0].agentId, "npc:1");
      assert.equal(traces[0].reason, "goal_formed");
    });

    it("preserves all trace data fields", () => {
      const trace = createTestTrace({
        needsSnapshot: { hunger: 0.5, safety: 0.3 },
        traitSnapshot: { bravery: 0.8 },
        perceivedInfoRefs: {
          eventIds: ["evt-123", "evt-456"],
          rumorIds: ["rumor:1"],
        },
      });

      traceLog.emitDecision(trace);

      const stored = traceLog.getAll()[0];
      assert.deepEqual(stored.needsSnapshot, { hunger: 0.5, safety: 0.3 });
      assert.deepEqual(stored.traitSnapshot, { bravery: 0.8 });
      assert.deepEqual(stored.perceivedInfoRefs, {
        eventIds: ["evt-123", "evt-456"],
        rumorIds: ["rumor:1"],
      });
    });

    it("includes location with optional locationId", () => {
      const trace = createTestTrace({
        location: { siteId: "village1", locationId: "marketplace" },
      });

      traceLog.emitDecision(trace);

      const stored = traceLog.getAll()[0];
      assert.equal(stored.location.siteId, "village1");
      assert.equal(stored.location.locationId, "marketplace");
    });
  });

  describe("ID generation", () => {
    it("generates different IDs for different ticks", () => {
      const log1 = new TraceLog({ devMode: false });
      const log2 = new TraceLog({ devMode: false });

      const id1 = log1.emitDecision(createTestTrace({ tick: 100 }));
      const id2 = log2.emitDecision(createTestTrace({ tick: 101 }));

      assert.notEqual(id1, id2);
    });

    it("generates different IDs for different agents", () => {
      const log1 = new TraceLog({ devMode: false });
      const log2 = new TraceLog({ devMode: false });

      const id1 = log1.emitDecision(createTestTrace({ agentId: "npc:1" }));
      const id2 = log2.emitDecision(createTestTrace({ agentId: "npc:2" }));

      assert.notEqual(id1, id2);
    });

    it("generates different IDs for different reasons", () => {
      const log1 = new TraceLog({ devMode: false });
      const log2 = new TraceLog({ devMode: false });

      const id1 = log1.emitDecision(createTestTrace({ reason: "goal_formed" }));
      const id2 = log2.emitDecision(createTestTrace({ reason: "plan_created" }));

      assert.notEqual(id1, id2);
    });

    it("ID is hash of tick, agentId, and reason only", () => {
      // ID should NOT change if other fields change
      const log1 = new TraceLog({ devMode: false });
      const log2 = new TraceLog({ devMode: false });

      const id1 = log1.emitDecision(createTestTrace({
        needsSnapshot: { hunger: 0.1 },
        chosenOption: { actionKind: "work", score: 0.5 },
      }));

      const id2 = log2.emitDecision(createTestTrace({
        needsSnapshot: { hunger: 0.9 },
        chosenOption: { actionKind: "steal", score: 0.9 },
      }));

      // Same tick, agentId, reason -> same ID
      assert.equal(id1, id2);
    });

    it("matches expected hash format", () => {
      const trace = createTestTrace({ tick: 100, agentId: "npc:1", reason: "goal_formed" });
      const expectedId = `trace-${stableHashHex([100, "npc:1", "goal_formed"])}`;

      const id = traceLog.emitDecision(trace);

      assert.equal(id, expectedId);
    });
  });

  describe("collision detection", () => {
    it("throws on duplicate trace ID in dev mode", () => {
      const trace = createTestTrace();

      traceLog.emitDecision(trace);

      assert.throws(() => {
        traceLog.emitDecision(trace);
      }, /duplicate trace ID/);
    });

    it("allows same agent at different ticks", () => {
      traceLog.emitDecision(createTestTrace({ tick: 100 }));

      // Different tick, should succeed
      const id = traceLog.emitDecision(createTestTrace({ tick: 101 }));

      assert.ok(id.startsWith("trace-"));
      assert.equal(traceLog.getAll().length, 2);
    });

    it("allows different agents at same tick", () => {
      traceLog.emitDecision(createTestTrace({ agentId: "npc:1" }));

      // Different agent, should succeed
      const id = traceLog.emitDecision(createTestTrace({ agentId: "npc:2" }));

      assert.ok(id.startsWith("trace-"));
      assert.equal(traceLog.getAll().length, 2);
    });

    it("allows different reasons for same agent at same tick", () => {
      traceLog.emitDecision(createTestTrace({ reason: "goal_formed" }));

      // Different reason, should succeed
      const id = traceLog.emitDecision(createTestTrace({ reason: "plan_created" }));

      assert.ok(id.startsWith("trace-"));
      assert.equal(traceLog.getAll().length, 2);
    });

    it("does not throw in production mode (logs instead)", () => {
      const prodLog = new TraceLog({ devMode: false });
      const trace = createTestTrace();

      prodLog.emitDecision(trace);

      // Should not throw, just log
      const id = prodLog.emitDecision(trace);
      assert.ok(id.startsWith("trace-"));
    });
  });

  describe("DecisionReason values", () => {
    const reasons: DecisionReason[] = [
      "goal_formed",
      "plan_created",
      "plan_changed",
      "plan_abandoned",
    ];

    for (const reason of reasons) {
      it(`accepts reason: ${reason}`, () => {
        const trace = createTestTrace({ reason });
        const id = traceLog.emitDecision(trace);

        assert.ok(id.startsWith("trace-"));
        assert.equal(traceLog.getAll()[0].reason, reason);
      });
    }
  });

  describe("getAll", () => {
    it("returns copy of traces (not the original array)", () => {
      traceLog.emitDecision(createTestTrace());

      const traces1 = traceLog.getAll();
      const traces2 = traceLog.getAll();

      assert.notEqual(traces1, traces2); // Different array instances
      assert.deepEqual(traces1, traces2); // Same contents
    });

    it("returns traces in emission order", () => {
      traceLog.emitDecision(createTestTrace({ tick: 100, agentId: "npc:1" }));
      traceLog.emitDecision(createTestTrace({ tick: 100, agentId: "npc:2" }));
      traceLog.emitDecision(createTestTrace({ tick: 101, agentId: "npc:1" }));

      const traces = traceLog.getAll();

      assert.equal(traces.length, 3);
      assert.equal(traces[0].tick, 100);
      assert.equal(traces[0].agentId, "npc:1");
      assert.equal(traces[1].tick, 100);
      assert.equal(traces[1].agentId, "npc:2");
      assert.equal(traces[2].tick, 101);
    });
  });

  describe("clear", () => {
    it("removes all traces and resets seen IDs", () => {
      const trace = createTestTrace();

      traceLog.emitDecision(trace);
      assert.equal(traceLog.getAll().length, 1);

      traceLog.clear();
      assert.equal(traceLog.getAll().length, 0);

      // Should be able to emit same trace again after clear
      traceLog.emitDecision(trace);
      assert.equal(traceLog.getAll().length, 1);
    });
  });
});

describe("TraceLog and EventBus separation", () => {
  it("TraceLog IDs use trace- prefix, EventBus IDs use evt- prefix", () => {
    const traceLog = new TraceLog({ devMode: true });

    const traceId = traceLog.emitDecision(createTestTrace());

    assert.ok(traceId.startsWith("trace-"), "TraceLog IDs should start with trace-");
    assert.ok(!traceId.startsWith("evt-"), "TraceLog IDs should NOT start with evt-");
  });

  it("trace perceivedInfoRefs can reference event IDs", () => {
    const traceLog = new TraceLog({ devMode: true });

    // Simulate having event IDs from EventBus
    const eventIds = ["evt-abc12345", "evt-def67890"];
    const rumorIds = ["rumor:village1:theft"];
    const observationIds = ["obs:123"];

    const trace = createTestTrace({
      perceivedInfoRefs: {
        eventIds,
        rumorIds,
        observationIds,
      },
    });

    traceLog.emitDecision(trace);

    const stored = traceLog.getAll()[0];
    assert.deepEqual(stored.perceivedInfoRefs.eventIds, eventIds);
    assert.deepEqual(stored.perceivedInfoRefs.rumorIds, rumorIds);
    assert.deepEqual(stored.perceivedInfoRefs.observationIds, observationIds);
  });
});

describe("decision trace gating scenarios", () => {
  // These tests document when traces SHOULD be emitted
  // The actual gating logic lives in the sim code (e.g., attempts/generate.ts)

  it("goal_formed: emitted when agent selects a new goal", () => {
    const traceLog = new TraceLog({ devMode: true });

    // Agent had no goal, now forms one
    const trace = createTestTrace({
      reason: "goal_formed",
      topOptions: [
        { actionKind: "find_food", score: 0.9, reasons: ["hungry", "low_satiety"] },
        { actionKind: "earn_money", score: 0.5, reasons: ["broke"] },
      ],
      chosenOption: { actionKind: "find_food", score: 0.9 },
    });

    traceLog.emitDecision(trace);

    assert.equal(traceLog.getAll().length, 1);
    assert.equal(traceLog.getAll()[0].reason, "goal_formed");
  });

  it("plan_created: emitted when agent creates new plan for goal", () => {
    const traceLog = new TraceLog({ devMode: true });

    const trace = createTestTrace({
      reason: "plan_created",
      topOptions: [
        { actionKind: "steal_from_market", score: 0.7, reasons: ["easy_target"] },
        { actionKind: "beg", score: 0.3, reasons: ["desperate"] },
      ],
      chosenOption: { actionKind: "steal_from_market", score: 0.7 },
    });

    traceLog.emitDecision(trace);

    assert.equal(traceLog.getAll().length, 1);
    assert.equal(traceLog.getAll()[0].reason, "plan_created");
  });

  it("plan_changed: emitted when agent modifies plan mid-execution", () => {
    const traceLog = new TraceLog({ devMode: true });

    const trace = createTestTrace({
      reason: "plan_changed",
      topOptions: [
        { actionKind: "flee", score: 0.95, reasons: ["guard_spotted", "self_preservation"] },
        { actionKind: "continue_stealing", score: 0.2, reasons: ["original_goal"] },
      ],
      chosenOption: { actionKind: "flee", score: 0.95 },
      perceivedInfoRefs: {
        eventIds: ["evt-guard-patrol"], // The event that triggered replan
      },
    });

    traceLog.emitDecision(trace);

    assert.equal(traceLog.getAll().length, 1);
    assert.equal(traceLog.getAll()[0].reason, "plan_changed");
  });

  it("plan_abandoned: emitted when agent drops plan", () => {
    const traceLog = new TraceLog({ devMode: true });

    const trace = createTestTrace({
      reason: "plan_abandoned",
      topOptions: [
        { actionKind: "idle", score: 0.5, reasons: ["interrupted", "no_valid_target"] },
      ],
      chosenOption: { actionKind: "idle", score: 0.5 },
      perceivedInfoRefs: {
        eventIds: ["evt-target-died"], // The event that caused abandonment
      },
    });

    traceLog.emitDecision(trace);

    assert.equal(traceLog.getAll().length, 1);
    assert.equal(traceLog.getAll()[0].reason, "plan_abandoned");
  });

  it("multiple trace types for same agent in same tick (via different reasons)", () => {
    const traceLog = new TraceLog({ devMode: true });

    // Agent can form a new goal AND create a plan in the same tick
    // This is allowed because the ID includes the reason
    traceLog.emitDecision(createTestTrace({
      tick: 100,
      agentId: "npc:1",
      reason: "goal_formed",
    }));

    traceLog.emitDecision(createTestTrace({
      tick: 100,
      agentId: "npc:1",
      reason: "plan_created",
    }));

    assert.equal(traceLog.getAll().length, 2);
  });
});

describe("integration: TraceLog determinism", () => {
  it("same trace parameters produce same IDs across log instances", () => {
    const log1 = new TraceLog({ devMode: false });
    const log2 = new TraceLog({ devMode: false });

    const emitSequence = (log: TraceLog) => {
      log.emitDecision(createTestTrace({
        tick: 0,
        agentId: "npc:1",
        reason: "goal_formed",
      }));

      log.emitDecision(createTestTrace({
        tick: 1,
        agentId: "npc:1",
        reason: "plan_created",
      }));

      log.emitDecision(createTestTrace({
        tick: 5,
        agentId: "npc:1",
        reason: "plan_changed",
      }));
    };

    emitSequence(log1);
    emitSequence(log2);

    const traces1 = log1.getAll();
    const traces2 = log2.getAll();

    assert.equal(traces1.length, traces2.length);
    for (let i = 0; i < traces1.length; i++) {
      assert.equal(traces1[i].id, traces2[i].id);
    }
  });
});
