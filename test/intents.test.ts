import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { addBelief } from "../src/sim/beliefs";
import { emitSignalsFromState } from "../src/sim/systems/signals";

test("signals: witnessed_crime can emit an intent.signaled tell for attack", () => {
  let world = createWorld(1);

  // Find two NPCs at the same site.
  const npcs = Object.values(world.npcs).filter((n) => n.alive);
  const bySite: Record<string, string[]> = {};
  for (const n of npcs) (bySite[n.siteId] ??= []).push(n.id);
  const siteId = Object.keys(bySite).find((s) => (bySite[s]?.length ?? 0) >= 2)!;
  assert.ok(siteId);

  const [aId, bId] = bySite[siteId]!.slice(0, 2);
  let a = world.npcs[aId]!;
  const b = world.npcs[bId]!;

  // Give A a strong crime belief about B and high aggression, low discipline/integrity to raise intent intensity.
  a = {
    ...a,
    traits: { ...a.traits, Aggression: 95, Discipline: 10, Integrity: 10 },
    beliefs: addBelief(a, {
      subjectId: b.id,
      predicate: "witnessed_crime",
      object: "assault",
      confidence: 90,
      source: "witnessed",
      tick: world.tick
    }).beliefs
  };
  world = { ...world, npcs: { ...world.npcs, [a.id]: a } };

  const res = emitSignalsFromState(world, (() => { let i = 0; return () => ++i; })());

  // If intensity crosses the threshold, we should see a signal event.
  const signaled = res.events.some((e) => e.kind === "intent.signaled" && (e.data as any)?.actorId === a.id);
  // Not strictly guaranteed if intensity doesn't cross, but with the above setup it should.
  assert.equal(signaled, true);
});


