/**
 * Tests for the kernel's ModuleRegistry with 5 core hooks.
 * 
 * The ModuleRegistry provides:
 * - Module registration and orchestration
 * - 5 core hooks: onTickStart, onTick, onAgentDecide, onEvent, onTickEnd
 * - Composition rules for onAgentDecide (additive only)
 * - Final action selection via selectAction
 */

import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { ModuleRegistry, selectAction } from "../src/kernel/moduleRegistry";
import type { KernelModule } from "../src/kernel/hooks";
import type { 
  TickContext, 
  ModuleTickResult, 
  DecisionInput, 
  DecisionOutput,
  ScoredOption,
  ScoreModifier,
} from "../src/kernel/kernelTypes";
import type { KernelEvent } from "../src/kernel/events/eventTypes";

// Mock TickContext for testing
function createMockContext(overrides?: Partial<TickContext>): TickContext {
  return {
    world: {} as any,
    tick: 100,
    seed: 12345,
    emitEvent: () => "evt-mock",
    emitTrace: () => "trace-mock",
    stableChance: () => true,
    stableInt: () => 5,
    rollId: () => "roll-mock",
    ...overrides,
  };
}

describe("ModuleRegistry", () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  describe("register", () => {
    it("registers a module", () => {
      const module: KernelModule = { id: "test-module" };
      registry.register(module);
      
      const modules = registry.getModules();
      assert.equal(modules.length, 1);
      assert.equal(modules[0].id, "test-module");
    });

    it("registers multiple modules in order", () => {
      const module1: KernelModule = { id: "module-1" };
      const module2: KernelModule = { id: "module-2" };
      const module3: KernelModule = { id: "module-3" };

      registry.register(module1);
      registry.register(module2);
      registry.register(module3);

      const modules = registry.getModules();
      assert.equal(modules.length, 3);
      assert.equal(modules[0].id, "module-1");
      assert.equal(modules[1].id, "module-2");
      assert.equal(modules[2].id, "module-3");
    });

    it("returns readonly array from getModules", () => {
      const module: KernelModule = { id: "test" };
      registry.register(module);

      const modules = registry.getModules();
      // TypeScript should prevent mutation, but verify array is separate
      assert.ok(Array.isArray(modules));
    });
  });

  describe("runTickStart", () => {
    it("calls onTickStart for all modules", () => {
      const calls: string[] = [];
      const ctx = createMockContext();

      registry.register({
        id: "module-1",
        onTickStart: () => { calls.push("module-1"); },
      });
      registry.register({
        id: "module-2",
        onTickStart: () => { calls.push("module-2"); },
      });

      registry.runTickStart(ctx);

      assert.deepEqual(calls, ["module-1", "module-2"]);
    });

    it("skips modules without onTickStart hook", () => {
      const calls: string[] = [];
      const ctx = createMockContext();

      registry.register({ id: "no-hook" });
      registry.register({
        id: "has-hook",
        onTickStart: () => { calls.push("has-hook"); },
      });

      registry.runTickStart(ctx);

      assert.deepEqual(calls, ["has-hook"]);
    });

    it("passes correct context to hooks", () => {
      let receivedCtx: TickContext | null = null;
      const ctx = createMockContext({ tick: 42, seed: 999 });

      registry.register({
        id: "test",
        onTickStart: (c) => { receivedCtx = c; },
      });

      registry.runTickStart(ctx);

      assert.equal(receivedCtx!.tick, 42);
      assert.equal(receivedCtx!.seed, 999);
    });
  });

  describe("runTick", () => {
    it("calls onTick for all modules and collects results", () => {
      const ctx = createMockContext();

      registry.register({
        id: "module-1",
        onTick: () => ({ events: [] }),
      });
      registry.register({
        id: "module-2",
        onTick: () => ({ worldUpdates: { tick: 101 } as any }),
      });

      const results = registry.runTick(ctx);

      assert.equal(results.length, 2);
    });

    it("filters out undefined results", () => {
      const ctx = createMockContext();

      registry.register({
        id: "returns-result",
        onTick: () => ({ events: [] }),
      });
      registry.register({
        id: "returns-undefined",
        onTick: () => undefined,
      });
      registry.register({
        id: "returns-void",
        onTick: () => { /* no return */ },
      });

      const results = registry.runTick(ctx);

      assert.equal(results.length, 1);
    });

    it("skips modules without onTick hook", () => {
      const ctx = createMockContext();

      registry.register({ id: "no-hook" });
      registry.register({
        id: "has-hook",
        onTick: () => ({ events: [] }),
      });

      const results = registry.runTick(ctx);

      assert.equal(results.length, 1);
    });

    it("calls modules in registration order", () => {
      const order: string[] = [];
      const ctx = createMockContext();

      registry.register({
        id: "first",
        onTick: () => { order.push("first"); return {}; },
      });
      registry.register({
        id: "second",
        onTick: () => { order.push("second"); return {}; },
      });
      registry.register({
        id: "third",
        onTick: () => { order.push("third"); return {}; },
      });

      registry.runTick(ctx);

      assert.deepEqual(order, ["first", "second", "third"]);
    });
  });

  describe("runAgentDecide", () => {
    it("chains through modules in order", () => {
      const ctx = createMockContext();
      const input: DecisionInput = {
        options: [{ actionKind: "idle", baseScore: 10, reasons: [] }],
        modifiers: [],
        blockedActions: new Set(),
      };

      registry.register({
        id: "module-1",
        onAgentDecide: (ctx, agentId, inp) => ({
          ...inp,
          modifiers: [...inp.modifiers, { moduleId: "module-1", actionKind: "idle", delta: 5, reason: "boost" }],
        }),
      });
      registry.register({
        id: "module-2",
        onAgentDecide: (ctx, agentId, inp) => ({
          ...inp,
          modifiers: [...inp.modifiers, { moduleId: "module-2", actionKind: "*", delta: 2, reason: "global boost" }],
        }),
      });

      const output = registry.runAgentDecide(ctx, "npc:1", input);

      assert.equal(output.modifiers.length, 2);
      assert.equal(output.modifiers[0].moduleId, "module-1");
      assert.equal(output.modifiers[1].moduleId, "module-2");
    });

    it("allows modules to add new options", () => {
      const ctx = createMockContext();
      const input: DecisionInput = {
        options: [{ actionKind: "idle", baseScore: 10, reasons: [] }],
        modifiers: [],
        blockedActions: new Set(),
      };

      registry.register({
        id: "add-option",
        onAgentDecide: (ctx, agentId, inp) => ({
          ...inp,
          options: [...inp.options, { actionKind: "work", baseScore: 15, reasons: ["need money"] }],
        }),
      });

      const output = registry.runAgentDecide(ctx, "npc:1", input);

      assert.equal(output.options.length, 2);
      assert.equal(output.options[1].actionKind, "work");
    });

    it("allows modules to block actions", () => {
      const ctx = createMockContext();
      const input: DecisionInput = {
        options: [
          { actionKind: "steal", baseScore: 20, reasons: [] },
          { actionKind: "work", baseScore: 15, reasons: [] },
        ],
        modifiers: [],
        blockedActions: new Set(),
      };

      registry.register({
        id: "morality",
        onAgentDecide: (ctx, agentId, inp) => ({
          ...inp,
          blockedActions: new Set([...inp.blockedActions, "steal"]),
        }),
      });

      const output = registry.runAgentDecide(ctx, "npc:1", input);

      assert.ok(output.blockedActions.has("steal"));
    });

    it("skips modules without onAgentDecide hook", () => {
      const ctx = createMockContext();
      const input: DecisionInput = {
        options: [{ actionKind: "idle", baseScore: 10, reasons: [] }],
        modifiers: [],
        blockedActions: new Set(),
      };

      registry.register({ id: "no-hook" });
      registry.register({
        id: "has-hook",
        onAgentDecide: (ctx, agentId, inp) => ({
          ...inp,
          modifiers: [...inp.modifiers, { moduleId: "has-hook", actionKind: "*", delta: 1, reason: "test" }],
        }),
      });

      const output = registry.runAgentDecide(ctx, "npc:1", input);

      assert.equal(output.modifiers.length, 1);
    });

    it("passes agentId to each module", () => {
      const receivedAgentIds: string[] = [];
      const ctx = createMockContext();
      const input: DecisionInput = {
        options: [],
        modifiers: [],
        blockedActions: new Set(),
      };

      registry.register({
        id: "module-1",
        onAgentDecide: (ctx, agentId, inp) => {
          receivedAgentIds.push(agentId);
          return inp;
        },
      });
      registry.register({
        id: "module-2",
        onAgentDecide: (ctx, agentId, inp) => {
          receivedAgentIds.push(agentId);
          return inp;
        },
      });

      registry.runAgentDecide(ctx, "npc:42", input);

      assert.deepEqual(receivedAgentIds, ["npc:42", "npc:42"]);
    });
  });

  describe("broadcastEvent", () => {
    it("broadcasts event to all modules with onEvent hook", () => {
      const receivedEvents: KernelEvent[] = [];
      const ctx = createMockContext();
      const event: KernelEvent = {
        id: "evt-123",
        kind: "test.event",
        tick: 100,
        visibility: "public",
        message: "Test",
      };

      registry.register({
        id: "module-1",
        onEvent: (ctx, e) => { receivedEvents.push(e); },
      });
      registry.register({
        id: "module-2",
        onEvent: (ctx, e) => { receivedEvents.push(e); },
      });

      registry.broadcastEvent(ctx, event);

      assert.equal(receivedEvents.length, 2);
      assert.equal(receivedEvents[0].id, "evt-123");
      assert.equal(receivedEvents[1].id, "evt-123");
    });

    it("skips modules without onEvent hook", () => {
      const callCount = { count: 0 };
      const ctx = createMockContext();
      const event: KernelEvent = {
        id: "evt-123",
        kind: "test.event",
        tick: 100,
        visibility: "public",
        message: "Test",
      };

      registry.register({ id: "no-hook" });
      registry.register({
        id: "has-hook",
        onEvent: () => { callCount.count++; },
      });

      registry.broadcastEvent(ctx, event);

      assert.equal(callCount.count, 1);
    });

    it("passes both context and event to hooks", () => {
      let receivedCtx: TickContext | null = null;
      let receivedEvent: KernelEvent | null = null;
      const ctx = createMockContext({ tick: 55 });
      const event: KernelEvent = {
        id: "evt-456",
        kind: "special.event",
        tick: 55,
        visibility: "public",
        message: "Special",
      };

      registry.register({
        id: "test",
        onEvent: (c, e) => {
          receivedCtx = c;
          receivedEvent = e;
        },
      });

      registry.broadcastEvent(ctx, event);

      assert.equal(receivedCtx!.tick, 55);
      assert.equal(receivedEvent!.id, "evt-456");
      assert.equal(receivedEvent!.kind, "special.event");
    });
  });

  describe("runTickEnd", () => {
    it("calls onTickEnd for all modules", () => {
      const calls: string[] = [];
      const ctx = createMockContext();

      registry.register({
        id: "module-1",
        onTickEnd: () => { calls.push("module-1"); },
      });
      registry.register({
        id: "module-2",
        onTickEnd: () => { calls.push("module-2"); },
      });

      registry.runTickEnd(ctx);

      assert.deepEqual(calls, ["module-1", "module-2"]);
    });

    it("skips modules without onTickEnd hook", () => {
      const calls: string[] = [];
      const ctx = createMockContext();

      registry.register({ id: "no-hook" });
      registry.register({
        id: "has-hook",
        onTickEnd: () => { calls.push("has-hook"); },
      });

      registry.runTickEnd(ctx);

      assert.deepEqual(calls, ["has-hook"]);
    });
  });
});

describe("selectAction", () => {
  it("returns highest scored option", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "idle", baseScore: 10, reasons: [] },
        { actionKind: "work", baseScore: 20, reasons: [] },
        { actionKind: "socialize", baseScore: 15, reasons: [] },
      ],
      modifiers: [],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    assert.equal(selected?.actionKind, "work");
  });

  it("applies modifiers to scores", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "idle", baseScore: 10, reasons: [] },
        { actionKind: "work", baseScore: 15, reasons: [] },
      ],
      modifiers: [
        { moduleId: "test", actionKind: "idle", delta: 10, reason: "boost idle" },
      ],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    // idle: 10 + 10 = 20, work: 15
    assert.equal(selected?.actionKind, "idle");
  });

  it("applies wildcard modifiers to all actions", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "idle", baseScore: 10, reasons: [] },
        { actionKind: "work", baseScore: 15, reasons: [] },
      ],
      modifiers: [
        { moduleId: "test", actionKind: "*", delta: -5, reason: "reduce all" },
      ],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    // idle: 10 - 5 = 5, work: 15 - 5 = 10
    assert.equal(selected?.actionKind, "work");
  });

  it("combines multiple modifiers", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "steal", baseScore: 30, reasons: [] },
        { actionKind: "work", baseScore: 15, reasons: [] },
      ],
      modifiers: [
        { moduleId: "morality", actionKind: "steal", delta: -20, reason: "morals" },
        { moduleId: "need", actionKind: "work", delta: 10, reason: "need money" },
        { moduleId: "global", actionKind: "*", delta: 2, reason: "slight boost" },
      ],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    // steal: 30 - 20 + 2 = 12, work: 15 + 10 + 2 = 27
    assert.equal(selected?.actionKind, "work");
  });

  it("filters out blocked actions", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "steal", baseScore: 100, reasons: [] },
        { actionKind: "work", baseScore: 15, reasons: [] },
      ],
      modifiers: [],
      blockedActions: new Set(["steal"]),
    };

    const selected = selectAction(output);

    assert.equal(selected?.actionKind, "work");
  });

  it("returns null when all actions blocked", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "steal", baseScore: 100, reasons: [] },
        { actionKind: "work", baseScore: 15, reasons: [] },
      ],
      modifiers: [],
      blockedActions: new Set(["steal", "work"]),
    };

    const selected = selectAction(output);

    assert.equal(selected, null);
  });

  it("returns null when no options", () => {
    const output: DecisionOutput = {
      options: [],
      modifiers: [],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    assert.equal(selected, null);
  });

  it("falls back to first available when all scores non-positive", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "idle", baseScore: 0, reasons: [] },
        { actionKind: "work", baseScore: -5, reasons: [] },
      ],
      modifiers: [],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    // Should fall back to first available
    assert.equal(selected?.actionKind, "idle");
  });

  it("preserves option properties in result", () => {
    const output: DecisionOutput = {
      options: [
        { actionKind: "attack", baseScore: 20, targetId: "npc:enemy", reasons: ["threat detected"] },
      ],
      modifiers: [],
      blockedActions: new Set(),
    };

    const selected = selectAction(output);

    assert.equal(selected?.actionKind, "attack");
    assert.equal(selected?.targetId, "npc:enemy");
    assert.deepEqual(selected?.reasons, ["threat detected"]);
  });
});

describe("integration: full hook lifecycle", () => {
  it("executes all hooks in correct order", () => {
    const executionOrder: string[] = [];
    const registry = new ModuleRegistry();
    const ctx = createMockContext();

    registry.register({
      id: "test-module",
      onTickStart: () => { executionOrder.push("tickStart"); },
      onTick: () => { executionOrder.push("tick"); return {}; },
      onAgentDecide: (ctx, agentId, input) => {
        executionOrder.push("agentDecide");
        return input;
      },
      onEvent: () => { executionOrder.push("event"); },
      onTickEnd: () => { executionOrder.push("tickEnd"); },
    });

    // Simulate tick lifecycle
    registry.runTickStart(ctx);
    registry.runTick(ctx);
    registry.runAgentDecide(ctx, "npc:1", {
      options: [],
      modifiers: [],
      blockedActions: new Set(),
    });
    registry.broadcastEvent(ctx, {
      id: "evt-1",
      kind: "test",
      tick: 100,
      visibility: "public",
      message: "Test",
    });
    registry.runTickEnd(ctx);

    assert.deepEqual(executionOrder, [
      "tickStart",
      "tick",
      "agentDecide",
      "event",
      "tickEnd",
    ]);
  });

  it("multiple modules can coexist without interference", () => {
    const registry = new ModuleRegistry();
    const ctx = createMockContext();

    const economyState = { processed: false };
    const socialState = { processed: false };

    registry.register({
      id: "economy",
      onTick: () => {
        economyState.processed = true;
        return { worldUpdates: { economy: "updated" } as any };
      },
      onAgentDecide: (ctx, agentId, input) => ({
        ...input,
        modifiers: [...input.modifiers, { moduleId: "economy", actionKind: "trade", delta: 5, reason: "profitable" }],
      }),
    });

    registry.register({
      id: "social",
      onTick: () => {
        socialState.processed = true;
        return { worldUpdates: { social: "updated" } as any };
      },
      onAgentDecide: (ctx, agentId, input) => ({
        ...input,
        modifiers: [...input.modifiers, { moduleId: "social", actionKind: "socialize", delta: 3, reason: "lonely" }],
      }),
    });

    // Run tick
    const tickResults = registry.runTick(ctx);
    assert.equal(tickResults.length, 2);
    assert.ok(economyState.processed);
    assert.ok(socialState.processed);

    // Run agent decision
    const input: DecisionInput = {
      options: [
        { actionKind: "trade", baseScore: 10, reasons: [] },
        { actionKind: "socialize", baseScore: 10, reasons: [] },
      ],
      modifiers: [],
      blockedActions: new Set(),
    };

    const output = registry.runAgentDecide(ctx, "npc:1", input);

    // Both modules should have added their modifiers
    assert.equal(output.modifiers.length, 2);
    assert.ok(output.modifiers.some(m => m.moduleId === "economy"));
    assert.ok(output.modifiers.some(m => m.moduleId === "social"));
  });
});
