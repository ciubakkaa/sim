import { clamp } from "../util";
import type { NpcId, NpcState, SimEvent, WorldState } from "../types";
import { makeId } from "../ids";
import { isNpcTraveling } from "../movement";

/**
 * Lightweight "tell" signals derived from current state (beliefs/traits/etc).
 * This replaces the legacy stored "intents" system: we still emit `intent.signaled`
 * events for observability/AI beliefs, but we do not maintain a parallel intent state.
 */
export function emitSignalsFromState(
  world: WorldState,
  nextEventSeq: () => number
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  const ids = Object.keys(world.npcs).sort();
  for (const id of ids) {
    const npc: NpcState = world.npcs[id]!;
    if (!npc.alive) continue;
    if (isNpcTraveling(npc)) continue;

    // Only signal in settlements (tells are local and meaningful).
    const siteAny: any = world.sites[npc.siteId];
    if (siteAny?.kind !== "settlement") continue;

    // Find strongest local crime target.
    const seen = (npc.beliefs ?? [])
      .filter((b) => b.predicate === "witnessed_crime")
      .map((b) => ({ targetId: b.subjectId as NpcId, confidence: b.confidence, kind: b.object, tick: b.tick }))
      .filter((x) => x.targetId && world.npcs[x.targetId]?.alive && world.npcs[x.targetId]?.siteId === npc.siteId)
      .sort((a, b) => b.confidence - a.confidence || b.tick - a.tick || String(a.targetId).localeCompare(String(b.targetId)));
    const t = seen[0];
    if (!t) continue;

    const aggression = npc.traits.Aggression ?? 0;
    const discipline = npc.traits.Discipline ?? 50;
    const integrity = npc.traits.Integrity ?? 50;
    const raw = aggression * 0.55 + t.confidence * 0.55 - discipline * 0.25 - integrity * 0.15;
    const intensity = clamp(Math.round(raw), 0, 100);

    // Emit an observable tell only when very strong.
    if (intensity < 80) continue;

    events.push({
      id: makeId("evt", world.tick, nextEventSeq()),
      tick: world.tick,
      kind: "intent.signaled",
      visibility: "public",
      siteId: npc.siteId,
      message: `${npc.name} looked ready to attack`,
      data: {
        actorId: npc.id,
        targetId: t.targetId,
        intentKind: "attack",
        signal: "weapon_draw",
        intensity
      }
    });
  }

  return { world, events, keyChanges };
}


