import { makeId } from "../ids";
import type { Attempt, NpcState, SimEvent, WorldState } from "../types";
import { isNpcTraveling } from "../movement";
import { isDetained } from "../eclipsing";
import { getRelationship } from "../relationships";
import type { Opportunity } from "./types";

type Response = {
  attempt: Attempt;
  score: number;
  reason: string;
};

function canAct(n: NpcState, world: WorldState): boolean {
  if (!n.alive) return false;
  if (isNpcTraveling(n)) return false;
  if (isDetained(n)) return false;
  if (n.busyUntilTick > world.tick) return false;
  return true;
}

function inSameSite(n: NpcState, siteId: string): boolean {
  return n.siteId === siteId;
}

function isGuard(n: NpcState): boolean {
  return n.category === "GuardMilitia" || n.category === "ConcordEnforcer" || n.category === "ElvenWarriorSentinel";
}

function isCult(n: NpcState): boolean {
  return Boolean(n.cult?.member);
}

function mkAttempt(world: WorldState, actorId: string, siteId: string, kind: Attempt["kind"], targetId?: string, resources?: Record<string, unknown>, visibility: Attempt["visibility"] = "public"): Attempt {
  return {
    id: makeId("att", world.tick, (world.tick ^ actorId.length) >>> 0),
    tick: world.tick,
    kind,
    visibility,
    actorId: actorId as any,
    targetId: targetId as any,
    siteId: siteId as any,
    durationHours: 1,
    intentMagnitude: "normal",
    resources
  };
}

function responseOptionsForNpc(world: WorldState, opp: Opportunity, npc: NpcState): Response[] {
  if (!canAct(npc, world)) return [];
  if (!inSameSite(npc, opp.siteId)) return [];

  const pending = opp.pendingAttempt;
  const offender = world.npcs[pending.actorId];
  const target = pending.targetId ? world.npcs[pending.targetId] : undefined;

  const out: Response[] = [];

  // Victim: flee/defend.
  if (target && npc.id === target.id) {
    const fear = npc.traits.Fear ?? 0;
    const courage = npc.traits.Courage ?? 0;
    const discipline = npc.traits.Discipline ?? 0;
    const selfPreserve = (npc.needs?.Safety ?? 0) / 100;

    const fleeScore = (fear - courage) + (npc.hp < 25 ? 40 : 0) + selfPreserve * 30;
    out.push({
      attempt: mkAttempt(world, npc.id, opp.siteId, "travel", undefined, undefined, "public"),
      score: fleeScore,
      reason: `victim_flee fear=${Math.round(fear)} courage=${Math.round(courage)}`
    });

    const defendScore = courage * 0.4 + discipline * 0.4 - fear * 0.2;
    out.push({
      attempt: mkAttempt(world, npc.id, opp.siteId, "defend", undefined, undefined, "public"),
      score: defendScore,
      reason: `victim_defend courage=${Math.round(courage)} discipline=${Math.round(discipline)}`
    });
  }

  // Guards: intervene to stop offender.
  if (offender && isGuard(npc) && pending.visibility === "public") {
    const duty = (npc.needs?.Duty ?? 0) / 100;
    const suspicion = npc.traits.Suspicion ?? 0;
    const base = 40 + duty * 30 + suspicion * 0.2;
    out.push({
      attempt: mkAttempt(world, npc.id, opp.siteId, "intervene", offender.id, { role: "guard", stopping: pending.kind }, "public"),
      score: base,
      reason: `guard_intervene duty=${Math.round(duty * 100)} suspicion=${Math.round(suspicion)}`
    });
  }

  // Cult: intervene to protect cult target (or to stop arrests against cult).
  if (offender && target && isCult(npc) && npc.id !== target.id && isCult(target)) {
    const loyalty = getRelationship(npc, target, world).loyalty ?? 0;
    const meaning = (npc.needs?.Meaning ?? 0) / 100;
    const base = 30 + loyalty * 0.4 + meaning * 25;
    out.push({
      attempt: mkAttempt(world, npc.id, opp.siteId, "intervene", offender.id, { role: "cult", protecting: target.id, stopping: pending.kind }, "public"),
      score: base,
      reason: `cult_intervene loyalty=${Math.round(loyalty)} meaning=${Math.round(meaning * 100)}`
    });
  }

  // Family: protect family member via intervene (small).
  if (offender && target && npc.familyIds?.includes(target.id)) {
    const base = 35 + (npc.traits.Courage ?? 0) * 0.25 + (npc.traits.Aggression ?? 0) * 0.15;
    out.push({
      attempt: mkAttempt(world, npc.id, opp.siteId, "intervene", offender.id, { role: "family", protecting: target.id, stopping: pending.kind }, "public"),
      score: base,
      reason: `family_intervene`
    });
  }

  return out;
}

export function pickOpportunityResponse(
  world: WorldState,
  opp: Opportunity,
  ctx: { rng: { next: () => number } }
): { response?: Response; event?: SimEvent } {
  const candidates = Object.values(world.npcs)
    .filter((n) => n.alive && n.siteId === opp.siteId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const options: Array<{ npcId: string; r: Response }> = [];
  for (const n of candidates) {
    for (const r of responseOptionsForNpc(world, opp, n)) {
      if (r.score <= 5) continue;
      options.push({ npcId: n.id, r });
    }
  }
  if (!options.length) return {};

  options.sort((a, b) => b.r.score - a.r.score || a.npcId.localeCompare(b.npcId));
  const picked = options[0]!;

  const ev: SimEvent = {
    id: makeId("evt", world.tick, Math.floor(ctx.rng.next() * 1_000_000)),
    tick: world.tick,
    kind: "opportunity.responded",
    visibility: "system",
    siteId: opp.siteId,
    message: `Response picked for ${opp.kind}: ${picked.r.attempt.kind}`,
    data: {
      rootAttemptId: opp.pendingAttempt.pendingAttemptId,
      opportunityId: opp.id,
      reason: picked.r.reason,
      score: picked.r.score,
      responseAttempt: picked.r.attempt
    }
  };

  return { response: picked.r, event: ev };
}


