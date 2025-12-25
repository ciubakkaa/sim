/**
 * Perception system (v2, opt-in via usePerception + useKnowledge)
 *
 * Minimal implementation:
 * - Active NPCs observe other NPCs present at the same site and record a location fact.
 *
 * This avoids O(N^2) by sampling and by limiting how many entities are processed per tick.
 */

import type { WorldState } from "../types";
import type { Rng } from "../rng";
import { getConfig } from "../config";
import { createFact, upsertFact } from "./knowledge";

export function updatePerception(world: WorldState, rng: Rng): WorldState {
  const cfg = getConfig();

  const npcIds = Object.keys(world.npcs);
  if (!npcIds.length) return world;

  // Deterministic stable ordering for sampling.
  npcIds.sort();

  const maxEntities = Math.max(1, cfg.limits.maxEntitiesPerTick ?? 200);
  const sampleCount = Math.min(maxEntities, npcIds.length, 80);

  // Sample a subset deterministically using rng.int.
  const sampled = new Set<string>();
  while (sampled.size < sampleCount) sampled.add(npcIds[rng.int(0, npcIds.length - 1)]!);

  let nextNpcs: WorldState["npcs"] | undefined;
  let changed = false;

  for (const observerId of sampled) {
    const obs = world.npcs[observerId];
    if (!obs || !obs.alive) continue;
    if (obs.travel && obs.travel.remainingKm > 0) continue;

    const siteId = obs.siteId;
    // Pick up to 5 other NPCs at the same site.
    const here = npcIds
      .map((id) => world.npcs[id])
      .filter((n) => n && n.alive && n.siteId === siteId && n.id !== observerId && !(n.travel && n.travel.remainingKm > 0)) as any[];
    if (!here.length) continue;

    const toObserve = Math.min(5, here.length);
    let updated = obs;
    for (let i = 0; i < toObserve; i++) {
      const target = here[rng.int(0, here.length - 1)]!;
      const fact = createFact({
        tick: world.tick,
        kind: "discovered_location",
        subjectId: String(target.id),
        object: String(siteId),
        confidence: 80,
        source: "witnessed"
      });
      updated = upsertFact(updated, fact);
    }

    if (updated !== obs) {
      if (!nextNpcs) nextNpcs = { ...world.npcs };
      nextNpcs[observerId] = updated;
      changed = true;
    }
  }

  return changed && nextNpcs ? { ...world, npcs: nextNpcs } : world;
}


