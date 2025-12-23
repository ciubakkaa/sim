import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { tickHour } from "../src/sim/tick";

test("attempt lifecycle: assault is scheduled (started) and later completes or is interrupted", () => {
  let world = createWorld(1);

  // Find a settlement with at least 1 guard and at least 2 non-guards.
  const settlementId = Object.values(world.sites)
    .filter((s: any) => s.kind === "settlement")
    .map((s: any) => s.id as string)
    .sort()[0]!;
  assert.ok(settlementId);

  // Pick a guard at that site.
  const guards = Object.values(world.npcs)
    .filter((n) => n.alive && n.siteId === settlementId)
    .filter((n) => n.category === "GuardMilitia" || n.category === "ConcordEnforcer" || n.category === "ElvenWarriorSentinel");
  assert.ok(guards.length > 0);

  // Pick two other NPCs at that site.
  const others = Object.values(world.npcs).filter((n) => n.alive && n.siteId === settlementId && !guards.some((g) => g.id === n.id));
  assert.ok(others.length >= 2);
  const actorId = others[0]!.id;
  const targetId = others[1]!.id;

  // Supply an explicit assault attempt; it should schedule with windup=1.
  const t0 = world.tick;
  const res0 = tickHour(world, {
    attempts: [
      {
        id: "att:test:1",
        tick: t0 + 1,
        kind: "assault",
        visibility: "public",
        actorId,
        targetId,
        siteId: settlementId,
        durationHours: 1,
        intentMagnitude: "normal"
      }
    ]
  });

  const started = res0.events.find((e) => e.kind === "attempt.started");
  assert.ok(started, "expected attempt.started");
  assert.equal((started!.data as any)?.attempt?.kind, "assault");

  // Next tick: pending attempt should resolve into interrupted OR completed (both acceptable).
  const res1 = tickHour(res0.world);
  const outcome = res1.events.find((e) => e.kind === "attempt.interrupted" || e.kind === "attempt.completed" || e.kind === "attempt.aborted");
  assert.ok(outcome, "expected lifecycle outcome event on next tick");
});

test("counterplay: defend/flee/intervene can stop a pending assault before it resolves", () => {
  let world = createWorld(1);
  const siteId = "HumanCityPort";

  // Pick an attacker and victim at the same site, plus ensure a guard is present.
  const attackerId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && n.category === "MerchantSmuggler")?.id
    ?? Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && !n.category.includes("Guard"))!.id;
  const victimId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && n.id !== attackerId && !n.category.includes("Guard"))!.id;
  const guardId = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && n.category === "GuardMilitia")!.id;

  // Make victim very fearful so flee triggers deterministically.
  world = {
    ...world,
    npcs: {
      ...world.npcs,
      [victimId]: { ...world.npcs[victimId]!, traits: { ...world.npcs[victimId]!.traits, Fear: 95, Courage: 0 } }
    }
  };

  const t0 = world.tick;
  const res0 = tickHour(world, {
    attempts: [
      {
        id: "att:test:cp1",
        tick: t0 + 1,
        kind: "assault",
        visibility: "public",
        actorId: attackerId,
        targetId: victimId,
        siteId,
        durationHours: 1,
        intentMagnitude: "normal"
      }
    ]
  });
  assert.ok(res0.events.some((e) => e.kind === "attempt.started"));

  // Next tick: victim should flee (travel attempt), and the pending assault should abort due to target_unavailable.
  const res1 = tickHour(res0.world);
  // Opportunity should be created for the pending assault.
  assert.ok(res1.events.some((e) => e.kind === "opportunity.created"), "expected opportunity.created");
  assert.ok(res1.events.some((e) => e.kind === "opportunity.responded"), "expected opportunity.responded");
  const responseAttemptRecorded = res1.events.find((e) => {
    if (e.kind !== "attempt.recorded") return false;
    const a: any = (e.data as any)?.attempt;
    if (!a) return false;
    return a.kind === "travel" || a.kind === "defend" || a.kind === "intervene";
  });
  assert.ok(responseAttemptRecorded, "expected some counter-response attempt to be recorded (travel/defend/intervene)");

  // The pending assault should NOT successfully apply if the victim fled (target_unavailable) or if an intervene cleared it.
  const assaultApplied = res1.events.some((e) => e.kind === "attempt.recorded" && (e.data as any)?.attempt?.kind === "assault");
  const stopped = res1.events.some((e) => e.kind === "attempt.aborted" || e.kind === "attempt.interrupted");
  assert.ok(stopped || !assaultApplied, "expected pending assault to be stopped or not applied in same tick");

  // Optional: guard may intervene too; at least ensure guard exists to cover scenario setup.
  assert.ok(guardId);
});


