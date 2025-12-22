import { makeId } from "./ids";
import type { NpcState, SimEvent, WorldState } from "./types";
import { clamp } from "./util";
import type { Rng } from "./rng";

export function isDetained(npc: NpcState): boolean {
  return Boolean(npc.status?.detained);
}

export function progressDetentionHourly(
  world: WorldState,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;
  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    const d = npc.status?.detained;
    if (!d) continue;
    if (world.tick < d.untilTick) continue;

    const updated: NpcState = {
      ...npc,
      status: { ...(npc.status ?? {}), detained: undefined }
    };

    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
    keyChanges.push(`${npc.name} was released`);
    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "attempt.recorded",
      visibility: "system",
      siteId: d.atSiteId,
      message: `${npc.name} was released from detention`,
      data: { npcId: npc.id, detainedBy: d.byNpcId, startedTick: d.startedTick, untilTick: d.untilTick }
    });
  }

  return { world: nextWorld, events, keyChanges };
}

export function hasEclipsingInProgress(npc: NpcState): boolean {
  return Boolean(npc.status?.eclipsing && npc.alive && npc.category !== "TaintedThrall");
}

export function progressEclipsingHourly(
  world: WorldState,
  ctx: { rng: Rng; nextEventSeq: () => number }
): { world: WorldState; events: SimEvent[]; keyChanges: string[] } {
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];

  let nextWorld = world;

  for (const npc of Object.values(world.npcs)) {
    if (!npc.alive) continue;
    const e = npc.status?.eclipsing;
    if (!e) continue;
    if (npc.category === "TaintedThrall") continue;
    if (world.tick < e.completeTick) continue;

    const updated: NpcState = {
      ...npc,
      category: "TaintedThrall",
      // Eclipsed are forced; treat as not "cult members" for Concord influence.
      cult: { member: false, role: "none" },
      trauma: clamp(npc.trauma + 25, 0, 100),
      status: { ...(npc.status ?? {}), eclipsing: undefined, detained: undefined }
    };

    nextWorld = { ...nextWorld, npcs: { ...nextWorld.npcs, [npc.id]: updated } };
    keyChanges.push(`${npc.name} was eclipsed`);

    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "attempt.recorded",
      visibility: "system",
      siteId: npc.siteId,
      message: `${npc.name} became a Tainted Thrall`,
      data: { npcId: npc.id, initiatedTick: e.initiatedTick, completeTick: e.completeTick }
    });
  }

  return { world: nextWorld, events, keyChanges };
}


