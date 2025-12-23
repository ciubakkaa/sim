import type { Rng } from "../rng";
import type { GoalWeightModifier } from "./types";
import type { ActiveGoal, GoalDefinition, GoalTrigger } from "./types";
import type { NpcState, WorldState } from "../types";
import { GOAL_DEFINITIONS } from "./definitions";

export type GoalsCtx = {
  rng: Rng;
};

const defsById = new Map<string, GoalDefinition>(GOAL_DEFINITIONS.map((d) => [d.id, d]));

function sameGoals(a: ActiveGoal[] | undefined, b: ActiveGoal[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.definitionId !== y.definitionId) return false;
    if (x.formedTick !== y.formedTick) return false;
    if (x.priority !== y.priority) return false;
    if (x.targetNpcId !== y.targetNpcId) return false;
    if (x.targetSiteId !== y.targetSiteId) return false;
    // `data` is intentionally ignored for v1 equality to keep updates cheap and stable.
  }
  return true;
}

function hasFamily(n: NpcState, minCount: number): boolean {
  return (n.familyIds?.length ?? 0) >= minCount;
}

function familyAtSameSite(n: NpcState, world: WorldState, minCount: number): boolean {
  if (!n.familyIds?.length) return false;
  let count = 0;
  for (const fid of n.familyIds) {
    const f = world.npcs[fid];
    if (f && f.alive && f.siteId === n.siteId) count++;
    if (count >= minCount) return true;
  }
  return false;
}

function triggerSatisfied(npc: NpcState, world: WorldState, t: GoalTrigger): boolean {
  switch (t.type) {
    case "beliefAbout": {
      return npc.beliefs.some((b) => b.predicate === t.predicate && b.confidence >= t.confidence);
    }
    case "needProlonged": {
      // v1 approximation: we don't track duration per-need; treat as current threshold gate.
      return (npc.needs?.[t.need] ?? 0) >= t.threshold;
    }
    case "relationshipWith": {
      // v1 approximation: any relationship meets condition.
      for (const rel of Object.values(npc.relationships ?? {})) {
        const v = (rel as any)[t.field];
        if (typeof v !== "number") continue;
        if (t.op === ">" && v > t.value) return true;
        if (t.op === "<" && v < t.value) return true;
      }
      return false;
    }
    case "witnessedEvent": {
      return npc.recentActions?.some((a) => a.kind === t.kind) ?? false;
    }
    case "stateActive": {
      return (npc.activeStates ?? []).some((s) => s.definitionId === t.stateId);
    }
    case "categoryIs": {
      return npc.category === t.category;
    }
    case "cultMember": {
      return Boolean(npc.cult?.member) === t.member;
    }
    case "hasFamily": {
      return hasFamily(npc, t.minCount);
    }
    case "familyAtSameSite": {
      return familyAtSameSite(npc, world, t.minCount);
    }
  }
}

function shouldHaveGoal(npc: NpcState, world: WorldState, def: GoalDefinition): boolean {
  if (!npc.alive) return false;
  if (npc.goals?.some((g) => g.definitionId === def.id)) return false;
  if (!def.triggers.length) return true;
  return def.triggers.some((t) => triggerSatisfied(npc, world, t));
}

function clampGoals(goals: ActiveGoal[], max: number): ActiveGoal[] {
  if (goals.length <= max) return goals;
  const sorted = [...goals].sort((a, b) => b.priority - a.priority || a.definitionId.localeCompare(b.definitionId));
  return sorted.slice(0, max);
}

/**
 * Update goals for all NPCs (v1): ensures a small set of parallel goals exist.
 * Deterministic: NPC iteration is stable by sorted id.
 */
export function updateGoals(world: WorldState, _ctx: GoalsCtx): WorldState {
  const ids = Object.keys(world.npcs).sort();
  let changed = false;
  let nextNpcs: typeof world.npcs | undefined;

  for (const id of ids) {
    const npc = world.npcs[id];
    if (!npc || !npc.alive) continue;

    const goals = npc.goals ? [...npc.goals] : [];

    // Curated goals
    for (const def of GOAL_DEFINITIONS) {
      if (!shouldHaveGoal(npc, world, def)) continue;
      goals.push({
        definitionId: def.id,
        formedTick: world.tick,
        priority: def.basePriority,
        data: {}
      });
    }

    // Procedural short-term motivations (hybrid): derive from dominant needs.
    const needPairs = Object.entries(npc.needs ?? {}) as [string, number][];
    needPairs.sort((a, b) => (b[1] as number) - (a[1] as number) || a[0].localeCompare(b[0]));
    const top = needPairs.slice(0, 2);
    for (const [need, v] of top) {
      if (v < 55) continue;
      const defId = `ShortTerm:${need}`;
      if (goals.some((g) => g.definitionId === defId)) continue;
      goals.push({
        definitionId: defId,
        formedTick: world.tick,
        priority: Math.round(30 + v * 0.4),
        data: { need, value: v }
      });
    }

    const clamped = clampGoals(goals, 6);
    if (!sameGoals(npc.goals, clamped)) {
      if (!nextNpcs) nextNpcs = { ...world.npcs };
      nextNpcs[id] = { ...npc, goals: clamped };
      changed = true;
    }
  }

  return changed && nextNpcs ? { ...world, npcs: nextNpcs } : world;
}

/**
 * Build score modifiers from the NPC's active goals (plus procedural ShortTerm:*).
 */
export function goalWeightModifiersForNpc(npc: NpcState, world: WorldState): GoalWeightModifier[] {
  const mods: GoalWeightModifier[] = [];
  for (const g of npc.goals ?? []) {
    const def = defsById.get(g.definitionId);
    if (def) {
      mods.push(...def.weightModifiers);
      continue;
    }

    // Procedural short-term mappings.
    if (g.definitionId.startsWith("ShortTerm:")) {
      const need = String(g.data?.need ?? g.definitionId.slice("ShortTerm:".length));
      const goalId = g.definitionId;

      if (need === "Food") {
        mods.push(
          { goalId, actionKind: "work_farm", weightDelta: 25 },
          { goalId, actionKind: "work_fish", weightDelta: 25 },
          { goalId, actionKind: "work_hunt", weightDelta: 20 },
          { goalId, actionKind: "steal", weightDelta: 10 },
          { goalId, actionKind: "trade", weightDelta: 8 }
        );
      } else if (need === "Belonging") {
        mods.push({ goalId, actionKind: "travel", weightDelta: 35 });
      } else if (need === "Duty") {
        mods.push(
          { goalId, actionKind: "patrol", weightDelta: 25 },
          { goalId, actionKind: "investigate", weightDelta: 15 },
          { goalId, actionKind: "arrest", weightDelta: 12 }
        );
      } else if (need === "Meaning") {
        mods.push({ goalId, actionKind: "preach_fixed_path", weightDelta: 20 });
      } else if (need === "Health") {
        mods.push({ goalId, actionKind: "heal", weightDelta: 15 });
      } else if (need === "Safety") {
        mods.push({ goalId, actionKind: "travel", weightDelta: 25 });
      }
    }
  }

  // Contextual: if family is present here, bias staying/working slightly.
  if (familyAtSameSite(npc, world, 1)) {
    mods.push({ goalId: "Context:FamilyAtHome", actionKind: "travel", weightDelta: -10 });
  }

  return mods;
}


