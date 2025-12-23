import type { AttemptMagnitude, AttemptVisibility, NpcState, WorldState } from "../types";
import type { Rng } from "../rng";
import type { ActionDefinition } from "./types";

/**
 * Idle action definitions.
 *
 * Note: this is intentionally low-weight so it only kicks in via an explicit
 * fallback (i.e. when no scored action clears the selection threshold).
 */
export const IDLE_ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    kind: "idle",
    preconditions: [{ type: "notBusy" }, { type: "notTraveling" }, { type: "notDetained" }],
    baseWeight: 1,
    needWeights: {},
    traitWeights: {},
    siteConditionWeights: [],
    beliefWeights: [],
    relationshipWeights: [],
    durationHours: 1,
    visibility: "private",
    magnitude: "minor"
  }
];

export type IdleFallbackSpec = {
  kind: ActionDefinition["kind"];
  durationHours: number;
  visibility: AttemptVisibility;
  magnitude: AttemptMagnitude;
  resources?: Record<string, unknown>;
};

function isDangerousHere(npc: NpcState, world: WorldState): boolean {
  const s = world.sites[npc.siteId] as any;
  if (!s) return false;
  if (s.kind !== "settlement") return false;
  const unrest = typeof s.unrest === "number" ? s.unrest : 0;
  const hunger = typeof s.hunger === "number" ? s.hunger : 0;
  const press = typeof s.eclipsingPressure === "number" ? s.eclipsingPressure : 0;
  return unrest + hunger + press >= 170 || unrest >= 80 || press >= 80 || hunger >= 90;
}

/**
 * Idle fallback selection when scoring doesn't find any viable action above threshold.
 *
 * This intentionally returns a *real* attempt kind (often "idle"), rather than
 * "undefined", so we can apply a lightweight cooldown (busyUntilTick) without
 * spamming attempt events.
 */
export function pickIdleFallback(npc: NpcState, world: WorldState, rng: Rng): IdleFallbackSpec {
  // Danger-aware: if the current settlement is highly unsafe, bias toward leaving.
  if (isDangerousHere(npc, world)) {
    return { kind: "travel", durationHours: 1, visibility: "public", magnitude: "normal" };
  }

  // Away-from-home: small bias to move (wander / head home indirectly).
  if (npc.siteId !== npc.homeSiteId) {
    if (rng.chance(0.15)) {
      return { kind: "travel", durationHours: 1, visibility: "public", magnitude: "normal" };
    }
  }

  // Default: idle in place.
  return { kind: "idle", durationHours: 1, visibility: "private", magnitude: "minor" };
}


