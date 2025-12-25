import type { EntityId, NpcState, WorldState } from "./types";

/**
 * v2 Entity registry (Phase E):
 * - Keep `world.entities` as a derived view over named NPCs (`world.npcs`)
 * - Avoid changing the main sim flow until the migration is complete
 */

export function syncEntitiesFromNpcs(world: WorldState): WorldState {
  // Derived view: use a shallow copy to keep it stable even if callers mutate `npcs` object identity.
  // Values are the same NpcState objects; consumers should treat entities as read-only.
  const entities: Record<EntityId, NpcState> = world.npcs as any;
  return world.entities === entities ? world : { ...world, entities };
}


