import { makeId } from "../ids";
import { pickTravelDestination } from "../npcs";
import type { Attempt, NeedKey, NpcId, NpcState, WorldState } from "../types";
import type { Rng } from "../rng";
import { isNpcTraveling } from "../movement";
import { isDetained } from "../eclipsing";
import { isBusy } from "../busy";
import { isNpcLocalTraveling } from "../localMovement";
import { ACTION_DEFINITIONS } from "../actions/definitions";
import { IDLE_ACTION_DEFINITIONS, pickIdleFallback } from "../actions/idle";
import { scoreActions, selectAction } from "../actions/scoring";
import { STATE_DEFINITIONS } from "../states/definitions";
import { resolveStateConflicts } from "../states/conflicts";
import { getNeighbors } from "../map";
import { getRelationship } from "../relationships";

export function shouldNpcAct(npc: NpcState, worldTick: number): boolean {
  if (isNpcTraveling(npc)) return false;
  if (isNpcLocalTraveling(npc)) return false;
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

function mkAttempt(
  npc: NpcState,
  world: WorldState,
  rng: Rng,
  kind: Attempt["kind"],
  durationHours: number,
  visibility: Attempt["visibility"],
  resources?: Record<string, unknown>,
  intentMagnitude: Attempt["intentMagnitude"] = "normal",
  targetId?: string
): Attempt {
  return {
    id: makeId("att", world.tick, rng.int(1, 1_000_000)),
    tick: world.tick,
    kind,
    visibility,
    actorId: npc.id,
    targetId,
    siteId: npc.siteId,
    durationHours,
    intentMagnitude,
    resources
  };
}

function stateWeightModifiers(npc: NpcState) {
  const defsById = new Map(STATE_DEFINITIONS.map((d) => [d.id, d]));
  return resolveStateConflicts(npc.activeStates ?? [], defsById);
}

function goalWeightModifiers(_npc: NpcState) {
  // Goal system isn't implemented yet (Task 5). Keep plumbing in place.
  return [];
}

/**
 * Scoring-based attempt generation (Task 7).
 * Uses action definitions + state/goal modifiers and falls back to idle when no action clears threshold.
 */
export function generateScoredAttempt(npc: NpcState, world: WorldState, rng: Rng): Attempt | undefined {
  if (!shouldNpcAct(npc, world.tick)) return undefined;

  const site: any = world.sites[npc.siteId];

  // ===== Task 14: explicit conflict probability knobs (kept small and deterministic) =====
  // Bandits: higher raid/steal chance when hungry and in a settlement.
  if (npc.category === "BanditRaider" && site?.kind === "settlement") {
    if ((npc.needs?.Food ?? 0) > 50 && rng.chance(0.2)) {
      return mkAttempt(npc, world, rng, "raid", 3, "public", undefined, "major");
    }
    if (rng.chance(0.15)) {
      return mkAttempt(npc, world, rng, "steal", 1, "private", undefined, "normal");
    }
  }

  // Unrest-driven random violence: 5% chance to assault someone when unrest is high.
  if (site?.kind === "settlement" && typeof site.unrest === "number" && site.unrest > 60 && rng.chance(0.05)) {
    const targets = Object.values(world.npcs)
      .filter((n) => n.alive && n.siteId === npc.siteId && n.id !== npc.id);
    targets.sort((a, b) => a.id.localeCompare(b.id));
    const target = targets[0];
    if (target) {
      return mkAttempt(npc, world, rng, "assault", 1, "public", undefined, "normal", target.id);
    }
  }

  // Concord enforcers: react violently to perceived threats (crime beliefs at the site).
  if (npc.category === "ConcordEnforcer") {
    const threats = npc.beliefs
      .filter((b) => b.predicate === "witnessed_crime" && b.confidence >= 70)
      .map((b) => ({ subjectId: b.subjectId as NpcId, confidence: b.confidence, tick: b.tick, kind: b.object }))
      .filter((x) => Boolean(world.npcs[x.subjectId]?.alive && world.npcs[x.subjectId]?.siteId === npc.siteId))
      .sort((a, b) => b.confidence - a.confidence || b.tick - a.tick || String(a.subjectId).localeCompare(String(b.subjectId)));
    const t = threats[0];
    if (t && rng.chance(0.6)) {
      const kill = rng.chance(0.5);
      return mkAttempt(npc, world, rng, kill ? "kill" : "assault", 1, "public", undefined, kill ? "major" : "normal", t.subjectId);
    }
  }

  const stateMods = stateWeightModifiers(npc);
  const goalMods = goalWeightModifiers(npc);

  // Task 13: site avoidance when fear > 70 toward someone present at the site.
  const fearfulSomeoneHere =
    Object.values(world.npcs)
      .filter((n) => n.alive && n.siteId === npc.siteId && n.id !== npc.id)
      .some((other) => getRelationship(npc, other, world).fear > 70);
  const fearAvoidMods = fearfulSomeoneHere ? [{ actionKind: "travel" as const, weightDelta: 35 }] : [];

  // Home-seeking behavior (Task 8): if belonging is high and we're away, bias travel.
  const homeReturnMods =
    npc.siteId !== npc.homeSiteId && (npc.needs?.Belonging ?? 0) > 60
      ? [{ actionKind: "travel" as const, weightDelta: 45 }]
      : [];

  const defs = [...ACTION_DEFINITIONS, ...IDLE_ACTION_DEFINITIONS];
  const scored = scoreActions(npc, world, defs, [...stateMods, ...fearAvoidMods, ...homeReturnMods], goalMods);
  const picked = selectAction(scored, rng, 10);

  if (!picked) {
    const fallback = pickIdleFallback(npc, world, rng);
    return mkAttempt(
      npc,
      world,
      rng,
      fallback.kind,
      fallback.durationHours,
      fallback.visibility,
      fallback.resources,
      fallback.magnitude
    );
  }

  // If traveling to satisfy belonging, and home is directly adjacent, set destination to home.
  let resources: Record<string, unknown> | undefined;
  if (picked.definition.kind === "travel" && npc.siteId !== npc.homeSiteId && (npc.needs?.Belonging ?? 0) > 60) {
    const neighbors = getNeighbors(world.map, npc.siteId);
    if (neighbors.some((e) => e.to === npc.homeSiteId)) {
      resources = { toSiteId: npc.homeSiteId };
    }
  }

  // Task 16: guards travel to discovered hideouts they know about when adjacent.
  if (!resources && picked.definition.kind === "travel") {
    const known = npc.beliefs
      .filter((b) => b.predicate === "discovered_location")
      .map((b) => b.object)
      .filter((id) => typeof id === "string") as string[];
    for (const hid of known) {
      const s: any = world.sites[hid];
      if (s?.kind !== "hideout") continue;
      if (s.hidden) continue;
      const neighbors = getNeighbors(world.map, npc.siteId);
      if (neighbors.some((e) => e.to === hid)) {
        resources = { toSiteId: hid };
        break;
      }
    }
  }

  return mkAttempt(
    npc,
    world,
    rng,
    picked.definition.kind,
    picked.definition.durationHours,
    picked.definition.visibility,
    resources,
    picked.definition.magnitude,
    picked.target
  );
}

/**
 * @deprecated Legacy v1 reflex attempt generation (kept for comparison tests and rollback safety).
 */
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
  ): Attempt => mkAttempt(npc, world, rng, kind, durationHours, visibility, resources, intentMagnitude);

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
      if (detained && pressure >= 55 && anchor <= 45 && rng.chance(0.6)) {
        return { ...mk("forced_eclipse", 6, "private", undefined, "major"), targetId: detained.id };
      }
      // Opportunistic kidnapping in high-pressure/low-anchor human settlements.
      if ((site as any)?.kind === "settlement" && (site as any)?.culture === "human" && pressure > 35 && anchor < 60) {
        const targets = Object.values(world.npcs).filter(
          (n) => n.alive && n.siteId === siteId && !n.cult.member && !n.status?.detained && n.category !== "GuardMilitia"
        );
        if (targets.length && rng.chance(0.25)) {
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


