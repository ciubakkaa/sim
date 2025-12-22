import type { NpcId, NpcState, WorldState } from "../types";
import { isNpcTraveling } from "../movement";
import { getRelationship } from "../relationships";
import type { TargetSelector } from "./types";

function candidatesAtSite(npc: NpcState, world: WorldState, opts: { excludeSelf: boolean }): NpcState[] {
  const res: NpcState[] = [];
  for (const other of Object.values(world.npcs)) {
    if (!other.alive) continue;
    if (opts.excludeSelf && other.id === npc.id) continue;
    if (isNpcTraveling(other)) continue;
    if (other.siteId !== npc.siteId) continue;
    res.push(other);
  }
  res.sort((a, b) => a.id.localeCompare(b.id));
  return res;
}

export function listTargets(selector: TargetSelector, npc: NpcState, world: WorldState): NpcId[] {
  const atSite = candidatesAtSite(npc, world, { excludeSelf: selector.type !== "detainedAtSite" && selector.type !== "eclipsingReversible" });

  switch (selector.type) {
    case "anyNpcAtSite": {
      return candidatesAtSite(npc, world, { excludeSelf: selector.excludeSelf }).map((n) => n.id);
    }
    case "cultMemberAtSite": {
      return atSite.filter((n) => n.cult.member).map((n) => n.id);
    }
    case "nonCultMemberAtSite": {
      return atSite.filter((n) => !n.cult.member).map((n) => n.id);
    }
    case "detainedAtSite": {
      const detained = Object.values(world.npcs)
        .filter((n) => n.alive && !isNpcTraveling(n))
        .filter((n) => n.status?.detained?.atSiteId === npc.siteId);
      detained.sort((a, b) => a.id.localeCompare(b.id));
      return detained.map((n) => n.id);
    }
    case "eclipsingReversible": {
      const xs = Object.values(world.npcs)
        .filter((n) => n.alive && !isNpcTraveling(n))
        .filter((n) => n.siteId === npc.siteId)
        .filter((n) => (n.status?.eclipsing?.reversibleUntilTick ?? -1) >= world.tick);
      xs.sort((a, b) => a.id.localeCompare(b.id));
      return xs.map((n) => n.id);
    }
    case "lowTrustNpc": {
      const scored = atSite
        .map((other) => ({ other, rel: getRelationship(npc, other, world) }))
        .filter((x) => x.rel.trust < selector.threshold)
        .sort((a, b) => a.rel.trust - b.rel.trust || a.other.id.localeCompare(b.other.id));
      return scored.map((x) => x.other.id);
    }
    case "highFearNpc": {
      const scored = atSite
        .map((other) => ({ other, rel: getRelationship(npc, other, world) }))
        .filter((x) => x.rel.fear > selector.threshold)
        .sort((a, b) => b.rel.fear - a.rel.fear || a.other.id.localeCompare(b.other.id));
      return scored.map((x) => x.other.id);
    }
    case "beliefSubject": {
      // Heuristic: if a belief's object looks like an npc id and that npc is present, use it.
      const candidates = npc.beliefs
        .filter((b) => b.predicate === selector.predicate)
        .sort((a, b) => b.confidence - a.confidence || b.tick - a.tick);

      for (const b of candidates) {
        const id = b.object as NpcId;
        const target = world.npcs[id];
        if (!target || !target.alive) continue;
        if (isNpcTraveling(target)) continue;
        if (target.siteId !== npc.siteId) continue;
        if (target.id === npc.id) continue;
        return [target.id];
      }
      return [];
    }
  }
}

export function selectTarget(selector: TargetSelector, npc: NpcState, world: WorldState): NpcId | undefined {
  return listTargets(selector, npc, world)[0];
}


