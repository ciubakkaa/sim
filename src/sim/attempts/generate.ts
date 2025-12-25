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
import { goalWeightModifiersForNpc } from "../goals/engine";
import type { AttemptWhy, ScoreContribution } from "../types";
import { planWeightModifiersForNpc } from "../systems/planning";
import { operationWeightModifiersForNpc } from "../systems/factionOps";
import { scheduleWeightModifiersForNpc } from "../systems/schedules";

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

function obligationWeightModifiers(npc: NpcState, world: WorldState) {
  const hourOfDay = world.tick % 24;
  const mods: { goalId: string; actionKind: Attempt["kind"]; weightDelta: number }[] = [];

  // Simple contextual obligations by role/category (not “personal goals”).
  if (npc.category === "GuardMilitia") {
    const onDuty = hourOfDay >= 6 && hourOfDay <= 19;
    if (onDuty) {
      mods.push(
        { goalId: "obligation:guard_duty", actionKind: "patrol", weightDelta: 35 },
        { goalId: "obligation:guard_duty", actionKind: "investigate", weightDelta: 20 },
        { goalId: "obligation:guard_duty", actionKind: "arrest", weightDelta: 12 }
      );
    } else {
      // Off duty: bias away from policing.
      mods.push({ goalId: "obligation:off_duty", actionKind: "patrol", weightDelta: -15 });
    }
  }

  // Family time: if at home and family is present, bias idling/travel less (stay).
  const familyHere = (npc.familyIds ?? []).some((id) => world.npcs[id]?.alive && world.npcs[id]?.siteId === npc.siteId);
  if (familyHere && npc.siteId === npc.homeSiteId && (hourOfDay >= 18 || hourOfDay <= 7)) {
    mods.push({ goalId: "obligation:family_time", actionKind: "travel", weightDelta: -20 });
  }

  // Subsistence baseline: strongly hungry NPCs tend to work even if no explicit goal formed.
  if ((npc.needs?.Food ?? 0) >= 70) {
    mods.push(
      { goalId: "obligation:subsistence", actionKind: "work_farm", weightDelta: 15 },
      { goalId: "obligation:subsistence", actionKind: "work_fish", weightDelta: 15 },
      { goalId: "obligation:subsistence", actionKind: "work_hunt", weightDelta: 15 }
    );
  }

  return mods;
}

function topDrivers(contribs: ScoreContribution[], limit = 6): ScoreContribution[] {
  const filtered = contribs.filter((c) => c.delta !== 0);
  filtered.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || String(a.kind).localeCompare(String(b.kind)));
  return filtered.slice(0, limit);
}

function buildWhyFromPicked(npc: NpcState, world: WorldState, picked: { contributions?: ScoreContribution[] }): AttemptWhy {
  const activeGoalIds = (npc.goals ?? []).map((g) => g.definitionId);
  const drivers = topDrivers(picked.contributions ?? []);

  const selectedGoalIds = drivers
    .filter((d) => d.kind === "goalMod" && typeof d.key === "string" && !d.key.startsWith("obligation:"))
    .map((d) => d.key!) as string[];

  const obligations = Array.from(
    new Set(
      drivers
        .filter((d) => d.kind === "goalMod" && typeof d.key === "string" && d.key.startsWith("obligation:"))
        .map((d) => d.key!.slice("obligation:".length))
    )
  );

  const humanBits: string[] = [];
  if (obligations.length) humanBits.push(`obligations=${obligations.join(",")}`);
  if (selectedGoalIds.length) humanBits.push(`goals=${selectedGoalIds.join(",")}`);

  // Add top non-goal drivers.
  const other = drivers.filter((d) => d.kind !== "goalMod").slice(0, 3);
  if (other.length) {
    const parts = other.map((d) => `${d.kind}${d.key ? `:${d.key}` : ""}${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(1)}`);
    humanBits.push(`drivers=${parts.join(";")}`);
  }

  return {
    text: humanBits.length ? humanBits.join(" | ") : "no_strong_drivers",
    activeGoalIds,
    selectedGoalIds: Array.from(new Set(selectedGoalIds)),
    obligations,
    drivers
  };
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
      const a = mkAttempt(npc, world, rng, "raid", 3, "public", undefined, "major");
      a.why = {
        text: "specialCase=bandit_hungry_raid",
        activeGoalIds: (npc.goals ?? []).map((g) => g.definitionId),
        selectedGoalIds: [],
        obligations: [],
        drivers: [{ kind: "specialCase", key: "bandit_hungry_raid", delta: 1 }]
      };
      return a;
    }
    if (rng.chance(0.15)) {
      const a = mkAttempt(npc, world, rng, "steal", 1, "private", undefined, "normal");
      a.why = {
        text: "specialCase=bandit_opportunistic_steal",
        activeGoalIds: (npc.goals ?? []).map((g) => g.definitionId),
        selectedGoalIds: [],
        obligations: [],
        drivers: [{ kind: "specialCase", key: "bandit_opportunistic_steal", delta: 1 }]
      };
      return a;
    }
  }

  // Unrest-driven random violence: 5% chance to assault someone when unrest is high.
  if (site?.kind === "settlement" && typeof site.unrest === "number" && site.unrest > 60 && rng.chance(0.05)) {
    const targets = Object.values(world.npcs)
      .filter((n) => n.alive && n.siteId === npc.siteId && n.id !== npc.id);
    targets.sort((a, b) => a.id.localeCompare(b.id));
    const target = targets[0];
    if (target) {
      const a = mkAttempt(npc, world, rng, "assault", 1, "public", undefined, "normal", target.id);
      a.why = {
        text: "specialCase=unrest_violence",
        activeGoalIds: (npc.goals ?? []).map((g) => g.definitionId),
        selectedGoalIds: [],
        obligations: [],
        drivers: [{ kind: "specialCase", key: "unrest_violence", delta: 1 }]
      };
      return a;
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
      const a = mkAttempt(
        npc,
        world,
        rng,
        kill ? "kill" : "assault",
        1,
        "public",
        undefined,
        kill ? "major" : "normal",
        t.subjectId
      );
      a.why = {
        text: `specialCase=concord_enforcer_threat kind=${String(t.kind)} confidence=${t.confidence}`,
        activeGoalIds: (npc.goals ?? []).map((g) => g.definitionId),
        selectedGoalIds: [],
        obligations: [],
        drivers: [{ kind: "belief", key: "witnessed_crime", delta: t.confidence / 100, note: String(t.kind) }]
      };
      return a;
    }
  }

  const stateMods = stateWeightModifiers(npc);
  const goalMods = goalWeightModifiersForNpc(npc, world);
  const obligationMods = obligationWeightModifiers(npc, world);
  const planMods = planWeightModifiersForNpc(npc);
  const opMods = operationWeightModifiersForNpc(npc, world);
  const scheduleMods = scheduleWeightModifiersForNpc(npc, world);

  // Task 13: site avoidance when fear > 70 toward someone present at the site.
  const fearfulSomeoneHere =
    Object.values(world.npcs)
      .filter((n) => n.alive && n.siteId === npc.siteId && n.id !== npc.id)
      .some((other) => getRelationship(npc, other, world).fear > 70);
  const fearAvoidMods = fearfulSomeoneHere ? [{ actionKind: "travel" as const, weightDelta: 35 }] : [];

  // Home-seeking behavior (Task 8): if belonging is high and we're away, bias travel.
  const homeReturnMods =
    npc.siteId !== npc.homeSiteId && (npc.needs?.Belonging ?? 0) > 60
      ? [{ actionKind: "travel" as const, weightDelta: 90 }]
      : [];

  const defs = [...ACTION_DEFINITIONS, ...IDLE_ACTION_DEFINITIONS];
  const scored = scoreActions(
    npc,
    world,
    defs,
    [...stateMods, ...fearAvoidMods, ...homeReturnMods],
    [...goalMods, ...obligationMods, ...planMods, ...opMods, ...scheduleMods]
  );
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

  const attempt = mkAttempt(
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
  attempt.why = buildWhyFromPicked(npc, world, picked);
  return attempt;
}
