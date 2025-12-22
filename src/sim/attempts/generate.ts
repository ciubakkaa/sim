import { makeId } from "../ids";
import { pickTravelDestination } from "../npcs";
import type { Attempt, NeedKey, NpcState, WorldState } from "../types";
import type { Rng } from "../rng";
import { isNpcTraveling } from "../movement";
import { isDetained } from "../eclipsing";
import { isBusy } from "../busy";

export function shouldNpcAct(npc: NpcState, worldTick: number): boolean {
  if (isNpcTraveling(npc)) return false;
  if (isDetained(npc)) return false;
  if (isBusy(npc, worldTick)) return false;
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
  const site = world.sites[siteId];

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

  // Duty / protective roles: arrest/kidnap counterplay + sever eclipsing window.
  if (need === "Duty") {
    // If someone is being eclipsed here and we're an anchor-capable role, try to sever within 48h.
    if (npc.category === "AnchorMage" || npc.category === "Threadwarden") {
      const candidates = Object.values(world.npcs).filter(
        (n) =>
          n.alive &&
          n.siteId === siteId &&
          n.status?.eclipsing &&
          world.tick <= (n.status?.eclipsing?.reversibleUntilTick ?? -1)
      );
      if (candidates.length) {
        const target = candidates[rng.int(0, candidates.length - 1)]!;
        return { ...mk("anchor_sever", 2, "public", undefined, "major"), targetId: target.id };
      }
    }

    if (npc.category === "GuardMilitia" || npc.category === "ScoutRanger" || npc.category === "Threadwarden") {
      // Escalate from investigate -> arrest in high-cult settlements.
      const cultish =
        (site as any)?.kind === "settlement" ? (site as any).cultInfluence ?? 0 : 0;
      if (cultish >= 60) {
        const targets = Object.values(world.npcs).filter(
          (n) => n.alive && n.siteId === siteId && n.cult.member && !n.status?.detained
        );
        if (targets.length && rng.chance(0.35)) {
          const target = targets[rng.int(0, targets.length - 1)]!;
          return {
            ...mk("arrest", 2, "public", undefined),
            targetId: target.id
          };
        }
      }
      // Otherwise, patrol most of the time; investigate only when there's enough cult signal.
      // This avoids the sim degenerating into constant investigate spam.
      if (cultish >= 25 || rng.chance(0.25)) return mk("investigate", 2, "public");
      return mk("patrol", 2, "public");
    }
  }

  if (need === "Food") {
    if (npc.category === "Farmer") return mk("work_farm", 6, "private");
    if (npc.category === "Fisher") return mk("work_fish", 6, "private");
    if (npc.category === "HunterTrapper") return mk("work_hunt", 6, "private");

    const desperate = npc.needs.Food >= 80;
    if (desperate && npc.traits.Integrity < 40) return mk("steal", 1, "private", undefined, "normal");
    return mk("work_hunt", 4, "private"); // fallback subsistence
  }

  if (need === "Meaning") {
    if (npc.cult.role === "devotee" || npc.cult.role === "cell_leader") {
      // If someone is detained here and conditions are oppressive, try forced eclipsing.
      const detained = Object.values(world.npcs).find((n) => n.alive && n.siteId === siteId && n.status?.detained);
      const pressure = (site as any)?.eclipsingPressure ?? 0;
      const anchor = (site as any)?.anchoringStrength ?? 0;
      if (detained && pressure >= 55 && anchor <= 45 && rng.chance(0.4)) {
        return { ...mk("forced_eclipse", 6, "private", undefined, "major"), targetId: detained.id };
      }
      // Opportunistic kidnapping in high-pressure/low-anchor human settlements.
      if ((site as any)?.kind === "settlement" && (site as any)?.culture === "human" && pressure >= 50 && anchor <= 50) {
        const targets = Object.values(world.npcs).filter(
          (n) => n.alive && n.siteId === siteId && !n.cult.member && !n.status?.detained && n.category !== "GuardMilitia"
        );
        if (targets.length && rng.chance(0.15)) {
          const target = targets[rng.int(0, targets.length - 1)]!;
          return { ...mk("kidnap", 2, "private", undefined, "normal"), targetId: target.id };
        }
      }

      return mk("preach_fixed_path", 2, "public");
    }
  }

  if (need === "Health") {
    if (npc.category === "HealerHedgeMage") return mk("heal", 2, "public");
  }

  // Bandits: raid when hungry/desperate or opportunistically.
  if (npc.category === "BanditRaider" && (site as any)?.kind === "settlement") {
    if (npc.needs.Food >= 60 || rng.chance(0.08)) return mk("raid", 3, "public", undefined, npc.needs.Food >= 80 ? "major" : "normal");
  }

  // Merchants: trade as low-impact filler.
  if (npc.category === "MerchantSmuggler" && (site as any)?.kind === "settlement" && rng.chance(0.12)) {
    return mk("trade", 2, "public");
  }

  // Light travel/idling
  if (rng.chance(0.1)) {
    const toSiteId = pickTravelDestination(world, npc.siteId, rng);
    if (toSiteId) return mk("travel", 1, "public", { toSiteId });
  }

  return undefined;
}


