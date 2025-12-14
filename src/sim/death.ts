import type { NpcId, SiteId, WorldState } from "./types";
import type { Rng } from "./rng";

export function killRandomNpcInSite(
  world: WorldState,
  siteId: SiteId,
  rng: Rng,
  death: { tick: number; cause: "murder" | "starvation" | "illness" | "raid" | "unknown"; byNpcId?: NpcId }
): { world: WorldState; victimId?: NpcId } {
  const candidates = Object.values(world.npcs).filter((n) => n.alive && n.siteId === siteId);
  if (!candidates.length) return { world };
  const victim = candidates[rng.int(0, candidates.length - 1)]!;

  const updated = {
    ...victim,
    alive: false,
    death: { tick: death.tick, cause: death.cause, byNpcId: death.byNpcId, atSiteId: siteId }
  };

  return { world: { ...world, npcs: { ...world.npcs, [victim.id]: updated } }, victimId: victim.id };
}


