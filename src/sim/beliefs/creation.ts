import type { Attempt, NpcId, NpcState, SimEvent, WorldState } from "../types";
import { isNpcTraveling } from "../movement";
import { addBelief } from "./index";
import { clamp } from "../util";

function npcsAtSite(world: WorldState, siteId: string): NpcState[] {
  return Object.values(world.npcs)
    .filter((n) => n.alive && !isNpcTraveling(n))
    .filter((n) => n.siteId === siteId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function addBeliefToNpc(world: WorldState, npcId: NpcId, belief: Parameters<typeof addBelief>[1]): WorldState {
  const npc = world.npcs[npcId];
  if (!npc || !npc.alive) return world;
  const updated = addBelief(npc, belief);
  return { ...world, npcs: { ...world.npcs, [npcId]: updated } };
}

export function applyBeliefsFromEvents(world: WorldState, events: SimEvent[]): WorldState {
  let next = world;

  for (const e of events) {
    if (e.kind === "intent.signaled") {
      const d: any = e.data ?? {};
      const actorId = d.actorId as NpcId | undefined;
      const intentKind = d.intentKind as string | undefined;
      if (actorId && e.siteId && typeof intentKind === "string") {
        const witnesses = npcsAtSite(next, e.siteId);
        const conf = clamp(40 + (Number(d.intensity ?? 0) * 0.4), 40, 90);
        for (const w of witnesses) {
          next = addBeliefToNpc(next, w.id, {
            subjectId: actorId,
            predicate: "witnessed_intent",
            object: intentKind,
            confidence: conf,
            source: "witnessed",
            tick: next.tick
          });
        }
      }
      continue;
    }

    if (e.kind !== "attempt.recorded") continue;
    const attempt = e.data?.attempt as Attempt | undefined;
    if (!attempt) continue;
    if (!attempt.siteId) continue;

    // Only "public" attempts create witness beliefs for now.
    if (attempt.visibility !== "public") continue;

    // Witness set: everyone present at the attempt's site (excluding travelers).
    const witnesses = npcsAtSite(next, attempt.siteId);

    // Crime/violence -> witnessed_crime belief about the actor.
    if (attempt.kind === "kill" || attempt.kind === "assault" || attempt.kind === "raid" || attempt.kind === "kidnap" || attempt.kind === "steal") {
      const conf =
        attempt.kind === "kill"
          ? 90
          : attempt.kind === "assault"
            ? 75
            : attempt.kind === "raid"
              ? 80
              : attempt.kind === "kidnap"
                ? 80
                : 65;

      for (const w of witnesses) {
        next = addBeliefToNpc(next, w.id, {
          subjectId: attempt.actorId,
          predicate: "witnessed_crime",
          object: attempt.kind,
          confidence: conf,
          source: "witnessed",
          tick: next.tick
        });
      }
    }

    // Investigate success in high-cult sites signals cult activity nearby.
    if (attempt.kind === "investigate") {
      const site = next.sites[attempt.siteId] as any;
      const cultInfluence = typeof site?.cultInfluence === "number" ? site.cultInfluence : 0;
      if (cultInfluence > 25) {
        for (const w of witnesses) {
          next = addBeliefToNpc(next, w.id, {
            subjectId: attempt.siteId as any,
            predicate: "cult_activity_nearby",
            object: "true",
            confidence: clamp(40 + cultInfluence * 0.6, 40, 90),
            source: "witnessed",
            tick: next.tick
          });
        }
      }
    }
  }

  return next;
}


