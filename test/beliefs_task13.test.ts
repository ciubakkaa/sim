import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { applyBeliefsFromEvents } from "../src/sim/beliefs/creation";
import { isBeliefPredicate } from "../src/sim/beliefs";
import { computeNpcNeeds } from "../src/sim/npcs";
import { scoreActions } from "../src/sim/actions/scoring";
import { ACTION_DEFINITIONS } from "../src/sim/actions/definitions";
import type { Attempt, SimEvent, WorldState } from "../src/sim/types";

function findNpcId(world: WorldState, pred: (n: any) => boolean): string {
  const n = Object.values(world.npcs).find(pred);
  assert.ok(n, "npc not found");
  return n.id;
}

test("predicate validation: isBeliefPredicate recognizes known predicates", () => {
  assert.equal(isBeliefPredicate("witnessed_crime"), true);
  assert.equal(isBeliefPredicate("not_a_real_predicate"), false);
});

test("belief creation: public kill attempt creates witnessed_crime belief for witnesses", () => {
  const w0 = createWorld(1);
  const siteId = "HumanVillageA";
  const actorId = findNpcId(w0, (n) => n.siteId === siteId && n.alive);
  const targetId = findNpcId(w0, (n) => n.siteId === siteId && n.alive && n.id !== actorId);

  const attempt: Attempt = {
    id: "t:kill",
    tick: w0.tick,
    kind: "kill",
    visibility: "public",
    actorId,
    targetId,
    siteId,
    durationHours: 1,
    intentMagnitude: "major"
  };
  const evt: SimEvent = {
    id: "evt",
    tick: w0.tick,
    kind: "attempt.recorded",
    visibility: "public",
    siteId,
    message: "Attempt recorded: kill",
    data: { attempt }
  };

  const w1 = applyBeliefsFromEvents(w0, [evt]);
  const witnessId = findNpcId(w1, (n) => n.siteId === siteId && n.alive && n.id !== actorId && n.id !== targetId);
  const witness = w1.npcs[witnessId]!;
  assert.ok(witness.beliefs.some((b) => b.predicate === "witnessed_crime" && b.subjectId === actorId && b.object === "kill"));
});

test("needs: holding high-confidence witnessed_crime increases Safety by 15", () => {
  const w0 = createWorld(2);
  const npcId = findNpcId(w0, (n) => n.alive);
  const npc = {
    ...w0.npcs[npcId]!,
    beliefs: [
      {
        subjectId: "npc:someone",
        predicate: "witnessed_crime",
        object: "kill",
        confidence: 90,
        source: "witnessed",
        tick: w0.tick
      }
    ]
  };
  const base = computeNpcNeeds({ ...npc, beliefs: [] as any }, w0);
  const withBelief = computeNpcNeeds(npc as any, w0);
  assert.equal(withBelief.Safety, Math.min(100, base.Safety + 15));
});

test("scoring: trade is blocked when trust < 20 (no scored trade action)", () => {
  const w0 = createWorld(3);
  const siteId = "HumanVillageA";
  const merchantId = findNpcId(w0, (n) => n.siteId === siteId && (n.category === "MerchantSmuggler" || n.category === "Craftsperson"));
  const otherId = findNpcId(w0, (n) => n.siteId === siteId && n.id !== merchantId);

  const w1: WorldState = {
    ...w0,
    npcs: {
      ...w0.npcs,
      [merchantId]: {
        ...w0.npcs[merchantId]!,
        relationships: { ...w0.npcs[merchantId]!.relationships, [otherId]: { trust: 0, fear: 0, loyalty: 0 } }
      }
    }
  };

  const merchant = w1.npcs[merchantId]!;
  const tradeDef = ACTION_DEFINITIONS.find((d) => d.kind === "trade")!;
  const scored = scoreActions(merchant, w1, [tradeDef], [], []);
  assert.equal(scored.length, 0);
});


