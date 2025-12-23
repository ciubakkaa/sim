import type { NpcId, NpcState, SettlementSiteState, SiteState, TraitKey, WorldState } from "../types";
import type { Rng } from "../rng";
import type { GoalWeightModifier } from "../goals/types";
import type { StateWeightModifier } from "../states/types";
import { getRelationship } from "../relationships";
import { checkPreconditions } from "./preconditions";
import { selectTarget } from "./targets";
import type { ActionDefinition, SiteConditionWeight } from "./types";

export type ScoredAction = {
  definition: ActionDefinition;
  score: number;
  target?: NpcId;
};

function isSettlement(site: SiteState): site is SettlementSiteState {
  return (site as any).kind === "settlement";
}

function compare(op: SiteConditionWeight["op"], a: number, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
  }
}

function checkSiteCondition(site: SiteState, cond: SiteConditionWeight): boolean {
  if (!isSettlement(site)) return false;
  const v = (site as any)[cond.field];
  if (typeof v !== "number") return false;
  return compare(cond.op, v, cond.threshold);
}

export function scoreActions(
  npc: NpcState,
  world: WorldState,
  definitions: ActionDefinition[],
  stateModifiers: StateWeightModifier[] = [],
  goalModifiers: GoalWeightModifier[] = []
): ScoredAction[] {
  const results: ScoredAction[] = [];

  for (const def of definitions) {
    if (!checkPreconditions(def.preconditions, npc, world)) continue;

    const target = def.targetSelector ? selectTarget(def.targetSelector, npc, world) : undefined;
    if (def.targetSelector && !target) continue;

    let score = def.baseWeight;

    // Need contributions (need value is 0..100; weights are multipliers).
    for (const [need, weight] of Object.entries(def.needWeights)) {
      const v = npc.needs[need as keyof NpcState["needs"]] ?? 0;
      score += v * (weight ?? 0);
    }

    // Trait contributions (trait value is 0..100; weights are multipliers).
    for (const [trait, weight] of Object.entries(def.traitWeights)) {
      const v = npc.traits[trait as TraitKey] ?? 0;
      score += v * (weight ?? 0);
    }

    // Site condition contributions.
    const site = world.sites[npc.siteId];
    if (site) {
      for (const cond of def.siteConditionWeights) {
        if (checkSiteCondition(site, cond)) score += cond.weight;
      }
    }

    // Belief contributions (scaled by confidence).
    for (const bw of def.beliefWeights) {
      const belief = npc.beliefs.find((b) => b.predicate === bw.predicate);
      if (belief) score += (belief.confidence / 100) * bw.weight;
    }

    // Relationship contributions (only meaningful with a target).
    if (target) {
      const other = world.npcs[target];
      if (other) {
        const rel = getRelationship(npc, other, world);

        // Task 13: block trade when trust is very low.
        if (def.kind === "trade" && rel.trust < 20) continue;

        for (const rw of def.relationshipWeights) {
          const v = rel[rw.field] ?? 0;
          if (rw.op === ">" && v > rw.threshold) score += rw.weight;
          else if (rw.op === "<" && v < rw.threshold) score += rw.weight;
        }
      }
    }

    // Reactive state modifiers.
    for (const mod of stateModifiers) {
      if (mod.actionKind === def.kind || mod.actionKind === "*") score += mod.weightDelta;
    }

    // Goal modifiers.
    for (const mod of goalModifiers) {
      if (mod.actionKind !== def.kind) continue;
      if (mod.requiresTarget && !target) continue;
      score += mod.weightDelta;
    }

    // Task 15: flee bonus when low HP.
    if (def.kind === "travel" && npc.hp < 20) score += 50;

    if (score > 0) results.push({ definition: def, score, target });
  }

  return results.sort((a, b) => b.score - a.score || a.definition.kind.localeCompare(b.definition.kind));
}

export function selectAction(scored: ScoredAction[], rng: Rng, minThreshold: number = 10): ScoredAction | undefined {
  const viable = scored.filter((s) => s.score >= minThreshold);
  if (!viable.length) return undefined;

  const total = viable.reduce((sum, s) => sum + s.score, 0);
  let roll = rng.next() * total;

  for (const a of viable) {
    roll -= a.score;
    if (roll <= 0) return a;
  }

  return viable[0];
}


