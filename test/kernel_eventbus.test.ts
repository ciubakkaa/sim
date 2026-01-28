/**
 * Tests for the kernel's EventBus with stable IDs and causality support.
 * 
 * The EventBus provides:
 * - Append-only event storage
 * - Stable hash-based IDs (deterministic, order-independent)
 * - Collision detection (throws in dev mode)
 * - Event querying with filters
 * - Causality tracking via EventCauses
 */

import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { EventBus } from "../src/kernel/events/eventBus";
import { stableEventId, type EventIdParams } from "../src/kernel/events/stableId";
import { computeSemanticDigest } from "../src/kernel/events/digest";
import type { KernelEvent } from "../src/kernel/events/eventTypes";
import type { EmitEventParams, EventCauses } from "../src/kernel/kernelTypes";

describe("stableEventId", () => {
  it("generates consistent IDs for the same parameters", () => {
    const params: EventIdParams = {
      kind: "test.event",
      tick: 100,
      siteId: "village1",
      actorId: "npc:1",
      purpose: "test",
    };
    
    const id1 = stableEventId(params, { devMode: false });
    const id2 = stableEventId(params, { devMode: false });
    assert.equal(id1, id2);
  });

  it("generates IDs with evt- prefix", () => {
    const id = stableEventId({
      kind: "test.event",
      tick: 100,
      siteId: "village1",
    }, { devMode: false });
    
    assert.ok(id.startsWith("evt-"), `Expected evt- prefix, got: ${id}`);
  });

  it("generates different IDs for different ticks", () => {
    const base = { kind: "test.event", siteId: "village1" };
    const id1 = stableEventId({ ...base, tick: 100 }, { devMode: false });
    const id2 = stableEventId({ ...base, tick: 101 }, { devMode: false });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different sites", () => {
    const base = { kind: "test.event", tick: 100 };
    const id1 = stableEventId({ ...base, siteId: "village1" }, { devMode: false });
    const id2 = stableEventId({ ...base, siteId: "village2" }, { devMode: false });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different actors", () => {
    const base = { kind: "test.event", tick: 100, siteId: "village1" };
    const id1 = stableEventId({ ...base, actorId: "npc:1" }, { devMode: false });
    const id2 = stableEventId({ ...base, actorId: "npc:2" }, { devMode: false });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different targets", () => {
    const base = { kind: "test.event", tick: 100, siteId: "village1" };
    const id1 = stableEventId({ ...base, targetId: "npc:1" }, { devMode: false });
    const id2 = stableEventId({ ...base, targetId: "npc:2" }, { devMode: false });
    assert.notEqual(id1, id2);
  });

  it("generates different IDs for different purposes", () => {
    const base = { kind: "test.event", tick: 100, siteId: "village1" };
    const id1 = stableEventId({ ...base, purpose: "phase:planning" }, { devMode: false });
    const id2 = stableEventId({ ...base, purpose: "phase:active" }, { devMode: false });
    assert.notEqual(id1, id2);
  });

  describe("validation", () => {
    it("allows global events without siteId", () => {
      // Global events like sim.started don't need siteId
      const id = stableEventId({
        kind: "sim.started",
        tick: 0,
      }, { devMode: true });
      
      assert.ok(id.startsWith("evt-"));
    });

    it("throws in dev mode for site-required events without siteId", () => {
      assert.throws(() => {
        stableEventId({
          kind: "attempt.started",
          tick: 100,
          actorId: "npc:1",
        } as EventIdParams, { devMode: true });
      }, /requires siteId/);
    });

    it("throws in dev mode for actor-required events without actorId", () => {
      assert.throws(() => {
        stableEventId({
          kind: "attempt.started",
          tick: 100,
          siteId: "village1",
        }, { devMode: true });
      }, /requires actorId/);
    });

    it("does not throw in production mode for missing fields", () => {
      // Should not throw, just log error
      const id = stableEventId({
        kind: "attempt.started",
        tick: 100,
      } as EventIdParams, { devMode: false });
      
      assert.ok(id.startsWith("evt-"));
    });
  });
});

describe("EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus({ devMode: true });
  });

  describe("emit", () => {
    it("returns stable event ID", () => {
      const id = eventBus.emit({
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test event",
      });

      assert.ok(id.startsWith("evt-"), `Expected evt- prefix, got: ${id}`);
    });

    it("stores events that can be retrieved", () => {
      eventBus.emit({
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test event",
      });

      const events = eventBus.getAll();
      assert.equal(events.length, 1);
      assert.equal(events[0].kind, "test.event");
    });

    it("generates same ID for same semantic parameters", () => {
      const bus1 = new EventBus({ devMode: false });
      const bus2 = new EventBus({ devMode: false });

      const params: EmitEventParams = {
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        visibility: "public",
        message: "Test",
      };

      const id1 = bus1.emit(params);
      const id2 = bus2.emit(params);

      assert.equal(id1, id2);
    });

    it("supports causality tracking via causes field", () => {
      const causeId = eventBus.emit({
        kind: "theft.attempted",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        visibility: "public",
        message: "Thief attempts to steal",
      });

      const causes: EventCauses = {
        eventIds: [causeId],
        agentIds: ["npc:1"],
      };

      eventBus.emit({
        kind: "guard.alerted",
        tick: 100,
        siteId: "village1",
        actorId: "guard:1",
        purpose: "response",
        visibility: "public",
        message: "Guard notices theft attempt",
        causes,
      });

      const events = eventBus.getAll();
      assert.equal(events.length, 2);
      assert.deepEqual(events[1].causes?.eventIds, [causeId]);
      assert.deepEqual(events[1].causes?.agentIds, ["npc:1"]);
    });

    it("supports all causality reference types", () => {
      const causes: EventCauses = {
        eventIds: ["evt-123", "evt-456"],
        rumorIds: ["rumor:1"],
        observationIds: ["obs:1", "obs:2"],
        agentIds: ["npc:1", "npc:2"],
      };

      eventBus.emit({
        kind: "decision.made",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        visibility: "private",
        message: "Agent makes decision",
        causes,
      });

      const events = eventBus.getAll();
      assert.deepEqual(events[0].causes, causes);
    });

    it("supports data payload", () => {
      eventBus.emit({
        kind: "combat.resolved",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        targetId: "npc:2",
        visibility: "public",
        message: "Combat ended",
        data: {
          winner: "npc:1",
          damage: 25,
          weaponUsed: "sword",
        },
      });

      const events = eventBus.getAll();
      assert.equal(events[0].data?.winner, "npc:1");
      assert.equal(events[0].data?.damage, 25);
    });
  });

  describe("collision detection", () => {
    it("throws on duplicate event ID in dev mode", () => {
      const params: EmitEventParams = {
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test",
      };

      eventBus.emit(params);

      assert.throws(() => {
        eventBus.emit(params);
      }, /duplicate event ID/);
    });

    it("allows same event kind with different purpose", () => {
      eventBus.emit({
        kind: "faction.operation.phase",
        tick: 100,
        siteId: "village1",
        visibility: "system",
        message: "Planning phase",
        purpose: "phase:planning",
      });

      // Different purpose should generate different ID
      const id = eventBus.emit({
        kind: "faction.operation.phase",
        tick: 100,
        siteId: "village1",
        visibility: "system",
        message: "Active phase",
        purpose: "phase:active",
      });

      assert.ok(id.startsWith("evt-"));
      assert.equal(eventBus.getAll().length, 2);
    });

    it("allows same event kind with different actors", () => {
      eventBus.emit({
        kind: "attempt.completed",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        visibility: "public",
        message: "NPC 1 completed action",
      });

      const id = eventBus.emit({
        kind: "attempt.completed",
        tick: 100,
        siteId: "village1",
        actorId: "npc:2",
        visibility: "public",
        message: "NPC 2 completed action",
      });

      assert.ok(id.startsWith("evt-"));
      assert.equal(eventBus.getAll().length, 2);
    });

    it("does not throw in production mode (logs instead)", () => {
      const prodBus = new EventBus({ devMode: false });
      const params: EmitEventParams = {
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test",
      };

      prodBus.emit(params);
      
      // Should not throw, just log
      const id = prodBus.emit(params);
      assert.ok(id.startsWith("evt-"));
    });
  });

  describe("query", () => {
    beforeEach(() => {
      // Emit various events for querying
      eventBus.emit({
        kind: "theft.attempted",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        targetId: "npc:2",
        visibility: "public",
        message: "Theft in village1",
      });

      eventBus.emit({
        kind: "trade.completed",
        tick: 100,
        siteId: "village1",
        actorId: "npc:3",
        visibility: "public",
        message: "Trade in village1",
      });

      eventBus.emit({
        kind: "theft.attempted",
        tick: 101,
        siteId: "village2",
        actorId: "npc:4",
        visibility: "public",
        message: "Theft in village2",
      });

      eventBus.emit({
        kind: "gossip.spread",
        tick: 102,
        siteId: "village1",
        visibility: "private",
        message: "Gossip",
        purpose: "rumor:1",
      });
    });

    it("filters by tick", () => {
      const results = eventBus.query({ tick: 100 });
      assert.equal(results.length, 2);
      results.forEach(e => assert.equal(e.tick, 100));
    });

    it("filters by tick range", () => {
      const results = eventBus.query({ tickRange: { from: 100, to: 101 } });
      assert.equal(results.length, 3);
    });

    it("filters by kind", () => {
      const results = eventBus.query({ kind: "theft.attempted" });
      assert.equal(results.length, 2);
      results.forEach(e => assert.equal(e.kind, "theft.attempted"));
    });

    it("filters by multiple kinds", () => {
      const results = eventBus.query({ kinds: ["theft.attempted", "trade.completed"] });
      assert.equal(results.length, 3);
    });

    it("filters by siteId", () => {
      const results = eventBus.query({ siteId: "village1" });
      assert.equal(results.length, 3);
      results.forEach(e => assert.equal(e.siteId, "village1"));
    });

    it("filters by actorId", () => {
      const results = eventBus.query({ actorId: "npc:1" });
      assert.equal(results.length, 1);
      assert.equal(results[0].actorId, "npc:1");
    });

    it("filters by targetId", () => {
      const results = eventBus.query({ targetId: "npc:2" });
      assert.equal(results.length, 1);
      assert.equal(results[0].targetId, "npc:2");
    });

    it("combines multiple filters", () => {
      const results = eventBus.query({
        kind: "theft.attempted",
        siteId: "village1",
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].tick, 100);
    });

    it("returns empty array when no matches", () => {
      const results = eventBus.query({ siteId: "nonexistent" });
      assert.equal(results.length, 0);
    });
  });

  describe("getAll", () => {
    it("returns copy of events (not the original array)", () => {
      eventBus.emit({
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test",
      });

      const events1 = eventBus.getAll();
      const events2 = eventBus.getAll();

      assert.notEqual(events1, events2); // Different array instances
      assert.deepEqual(events1, events2); // Same contents
    });
  });

  describe("clear", () => {
    it("removes all events and resets seen IDs", () => {
      const params: EmitEventParams = {
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test",
      };

      eventBus.emit(params);
      assert.equal(eventBus.getAll().length, 1);

      eventBus.clear();
      assert.equal(eventBus.getAll().length, 0);

      // Should be able to emit same event again after clear
      eventBus.emit(params);
      assert.equal(eventBus.getAll().length, 1);
    });
  });
});

describe("computeSemanticDigest", () => {
  it("produces consistent digests for same events", () => {
    const events: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test 1",
      },
      {
        id: "evt-2",
        kind: "test.event",
        tick: 101,
        siteId: "village1",
        visibility: "public",
        message: "Test 2",
      },
    ];

    const digest1 = computeSemanticDigest(events);
    const digest2 = computeSemanticDigest(events);

    assert.equal(digest1, digest2);
  });

  it("produces same digest regardless of event order", () => {
    const event1: KernelEvent = {
      id: "evt-1",
      kind: "theft.attempted",
      tick: 100,
      siteId: "village1",
      actorId: "npc:1",
      visibility: "public",
      message: "Theft",
    };

    const event2: KernelEvent = {
      id: "evt-2",
      kind: "trade.completed",
      tick: 101,
      siteId: "village2",
      actorId: "npc:2",
      visibility: "public",
      message: "Trade",
    };

    const digestOrder1 = computeSemanticDigest([event1, event2]);
    const digestOrder2 = computeSemanticDigest([event2, event1]);

    assert.equal(digestOrder1, digestOrder2);
  });

  it("produces same digest regardless of event IDs", () => {
    const events1: KernelEvent[] = [
      {
        id: "evt-abc123",
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Test",
      },
    ];

    const events2: KernelEvent[] = [
      {
        id: "evt-different-id",
        kind: "test.event",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Different message but same semantic",
      },
    ];

    const digest1 = computeSemanticDigest(events1);
    const digest2 = computeSemanticDigest(events2);

    // Same semantic content = same digest
    assert.equal(digest1, digest2);
  });

  it("produces different digests for different semantic content", () => {
    const events1: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "theft.attempted",
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Theft",
      },
    ];

    const events2: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "trade.completed", // Different kind
        tick: 100,
        siteId: "village1",
        visibility: "public",
        message: "Trade",
      },
    ];

    const digest1 = computeSemanticDigest(events1);
    const digest2 = computeSemanticDigest(events2);

    assert.notEqual(digest1, digest2);
  });

  it("uses discriminator to distinguish same-shape events", () => {
    const events1: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "faction.operation.phase",
        tick: 100,
        siteId: "village1",
        visibility: "system",
        message: "Planning",
        data: { purpose: "phase:planning" },
      },
    ];

    const events2: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "faction.operation.phase",
        tick: 100,
        siteId: "village1",
        visibility: "system",
        message: "Active",
        data: { purpose: "phase:active" },
      },
    ];

    const digest1 = computeSemanticDigest(events1);
    const digest2 = computeSemanticDigest(events2);

    assert.notEqual(digest1, digest2);
  });

  it("returns hex string of correct format", () => {
    const events: KernelEvent[] = [
      {
        id: "evt-1",
        kind: "test",
        tick: 100,
        visibility: "public",
        message: "Test",
      },
    ];

    const digest = computeSemanticDigest(events);
    
    // Should be 8 character hex string
    assert.equal(digest.length, 8);
    assert.ok(/^[0-9a-f]{8}$/.test(digest), `Expected hex string, got: ${digest}`);
  });
});

describe("integration: EventBus determinism", () => {
  it("same emissions produce same event IDs across bus instances", () => {
    const bus1 = new EventBus({ devMode: false });
    const bus2 = new EventBus({ devMode: false });

    const emitSequence = (bus: EventBus) => {
      bus.emit({
        kind: "sim.started",
        tick: 0,
        visibility: "system",
        message: "Simulation started",
      });

      bus.emit({
        kind: "theft.attempted",
        tick: 100,
        siteId: "village1",
        actorId: "npc:1",
        targetId: "npc:2",
        visibility: "public",
        message: "Theft",
      });

      bus.emit({
        kind: "guard.alerted",
        tick: 100,
        siteId: "village1",
        actorId: "guard:1",
        visibility: "public",
        message: "Guard response",
        purpose: "response:theft",
      });
    };

    emitSequence(bus1);
    emitSequence(bus2);

    const events1 = bus1.getAll();
    const events2 = bus2.getAll();

    assert.equal(events1.length, events2.length);
    for (let i = 0; i < events1.length; i++) {
      assert.equal(events1[i].id, events2[i].id);
    }
  });

  it("semantic digest is same for identical simulation runs", () => {
    const runSimulation = () => {
      const bus = new EventBus({ devMode: false });

      bus.emit({
        kind: "sim.started",
        tick: 0,
        visibility: "system",
        message: "Start",
      });

      for (let tick = 1; tick <= 10; tick++) {
        bus.emit({
          kind: "world.tick",
          tick,
          siteId: "world",
          visibility: "system",
          message: `Tick ${tick}`,
        });
      }

      bus.emit({
        kind: "sim.day.ended",
        tick: 24,
        visibility: "system",
        message: "Day end",
      });

      return bus.getAll();
    };

    const events1 = runSimulation();
    const events2 = runSimulation();

    const digest1 = computeSemanticDigest(events1);
    const digest2 = computeSemanticDigest(events2);

    assert.equal(digest1, digest2);
  });
});
