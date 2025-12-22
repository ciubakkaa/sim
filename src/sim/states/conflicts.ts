import type { ActiveState, ReactiveStateDefinition, StateWeightModifier } from "./types";

export const STATE_CONFLICT_GROUPS: Record<string, string[]> = {
  emotional_response: ["fearful", "vengeful", "defiant"],
  social_mood: ["distrustful", "grateful", "bonded"],
  energy_level: ["exhausted", "inspired", "focused"],
  survival_mode: ["starving", "desperate", "prosperous"]
};

export function getConflictingStates(stateId: string): string[] {
  for (const states of Object.values(STATE_CONFLICT_GROUPS)) {
    if (states.includes(stateId)) return states.filter((s) => s !== stateId);
  }
  return [];
}

export function resolveStateConflicts(
  activeStates: ActiveState[],
  definitionsById: Map<string, ReactiveStateDefinition>
): StateWeightModifier[] {
  const mods: StateWeightModifier[] = [];

  // Determine, per conflict group, which priority dominates.
  const groupMaxPriority = new Map<string, number>();
  for (const s of activeStates) {
    const def = definitionsById.get(s.definitionId);
    const group = def?.conflictGroup;
    if (!group) continue;
    const p = def?.priority ?? 0;
    const prev = groupMaxPriority.get(group);
    if (prev === undefined || p > prev) groupMaxPriority.set(group, p);
  }

  // Apply modifiers in ascending priority order so higher priority naturally comes later.
  const sorted = [...activeStates].sort((a, b) => {
    const pa = definitionsById.get(a.definitionId)?.priority ?? 0;
    const pb = definitionsById.get(b.definitionId)?.priority ?? 0;
    return pa - pb || a.definitionId.localeCompare(b.definitionId);
  });

  for (const s of sorted) {
    const def = definitionsById.get(s.definitionId);
    if (!def) continue;

    const maxP = def.conflictGroup ? groupMaxPriority.get(def.conflictGroup) : undefined;
    const isSuppressed = def.conflictGroup && maxP !== undefined && (def.priority ?? 0) < maxP;
    const suppression = isSuppressed ? 0.5 : 1.0;

    const intensity = Math.max(0, Math.min(100, s.intensity)) / 100;
    const multiplier = suppression * intensity;

    for (const m of def.weightModifiers) {
      mods.push({ actionKind: m.actionKind, weightDelta: m.weightDelta * multiplier });
    }
  }

  return mods;
}


