import { makeId } from "../ids";
import { pickTravelDestination } from "../npcs";
import type { Attempt, NeedKey, NpcState, WorldState } from "../types";
import type { Rng } from "../rng";

export function shouldNpcAct(npc: NpcState, worldTick: number): boolean {
  return worldTick - npc.lastAttemptTick >= 2;
}

export function pickNeedToActOn(needs: NpcState["needs"]): NeedKey {
  let best: NeedKey = "Food";
  let bestV = -1;
  for (const [k, v] of Object.entries(needs) as [NeedKey, number][]) {
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best;
}

export function generateReflexAttempt(npc: NpcState, world: WorldState, rng: Rng): Attempt | undefined {
  if (!shouldNpcAct(npc, world.tick)) return undefined;

  const need = pickNeedToActOn(npc.needs);
  const siteId = npc.siteId;

  const mk = (
    kind: Attempt["kind"],
    durationHours: number,
    visibility: Attempt["visibility"],
    resources?: Record<string, unknown>,
    intentMagnitude: Attempt["intentMagnitude"] = "normal"
  ): Attempt => ({
    id: makeId("att", world.tick, rng.int(1, 1_000_000)),
    tick: world.tick,
    kind,
    visibility,
    actorId: npc.id,
    siteId,
    durationHours,
    intentMagnitude,
    resources
  });

  // Safety override
  if (need === "Safety" && npc.needs.Safety >= 80) {
    const toSiteId = pickTravelDestination(world, npc.siteId, rng);
    if (toSiteId) return mk("travel", 1, "public", { toSiteId });
  }

  if (need === "Food") {
    if (npc.category === "Farmer") return mk("work_farm", 6, "private");
    if (npc.category === "Fisher") return mk("work_fish", 6, "private");
    if (npc.category === "HunterTrapper") return mk("work_hunt", 6, "private");

    const desperate = npc.needs.Food >= 80;
    if (desperate && npc.traits.Integrity < 40) return mk("steal", 1, "private", undefined, "normal");
    return mk("work_hunt", 4, "private"); // fallback subsistence
  }

  if (need === "Duty") {
    if (npc.category === "GuardMilitia" || npc.category === "ScoutRanger" || npc.category === "Threadwarden") {
      return mk("investigate", 2, "public");
    }
  }

  if (need === "Meaning") {
    if (npc.cult.role === "devotee" || npc.cult.role === "cell_leader") return mk("preach_fixed_path", 2, "public");
  }

  if (need === "Health") {
    if (npc.category === "HealerHedgeMage") return mk("heal", 2, "public");
  }

  // Light travel/idling
  if (rng.chance(0.1)) {
    const toSiteId = pickTravelDestination(world, npc.siteId, rng);
    if (toSiteId) return mk("travel", 1, "public", { toSiteId });
  }

  return undefined;
}


