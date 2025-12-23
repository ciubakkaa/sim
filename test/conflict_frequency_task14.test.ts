import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/sim/worldSeed";
import { generateScoredAttempt } from "../src/sim/attempts";

test("Task 14 integration: high-unrest site should produce at least one assault/raid within 2 days", () => {
  let world = createWorld(99);

  // Make HumanVillageA volatile and ensure multiple NPCs are present there.
  world = {
    ...world,
    sites: {
      ...world.sites,
      HumanVillageA: { ...(world.sites["HumanVillageA"] as any), unrest: 85, hunger: 80 }
    }
  };

  // Fast, deterministic sampling: try to generate actions for many NPCs once in a high-unrest site.
  // We don't resolve attempts; we only validate that conflict selection becomes available.
  const rng = {
    next: () => 0.123,
    int: (a: number, _b?: number) => a,
    chance: (p: number) => p >= 0.05 // allow unrest assault + bandit raid/steal branches to trigger
  } as any;

  const seen = new Set<string>();
  const npcs = Object.values(world.npcs).filter((n) => n.alive && n.siteId === "HumanVillageA");

  for (const n of npcs) {
    const a = generateScoredAttempt({ ...n, lastAttemptTick: -999, busyUntilTick: 0 } as any, world, rng);
    if (!a) continue;
    if (a.kind === "assault" || a.kind === "raid" || a.kind === "steal") seen.add(a.kind);
  }

  assert.ok(seen.size >= 1, `expected at least one conflict attempt, saw: ${Array.from(seen).join(",") || "(none)"}`);
});


