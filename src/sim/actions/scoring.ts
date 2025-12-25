import type { NpcId, NpcState, SettlementSiteState, SiteState, TraitKey, WorldState } from "../types";
import type { Rng } from "../rng";
import type { GoalWeightModifier } from "../goals/types";
import type { StateWeightModifier } from "../states/types";
import { getRelationship } from "../relationships";
import { checkPreconditions } from "./preconditions";
import { selectTarget } from "./targets";
import type { ActionDefinition, SiteConditionWeight } from "./types";
import type { ScoreContribution } from "../types";
import { getConfig } from "../config";
import { getMemoryBasedHostility } from "../systems/memory";
import { getDebtPressure } from "../systems/debts";
import { getEmotions } from "../systems/emotions";

export type ScoredAction = {
  definition: ActionDefinition;
  score: number;
  target?: NpcId;
  contributions?: ScoreContribution[];
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
  const memEnabled = true;
  const relV2Enabled = true;

  for (const def of definitions) {
    if (!checkPreconditions(def.preconditions, npc, world)) continue;

    const target = def.targetSelector ? selectTarget(def.targetSelector, npc, world) : undefined;
    if (def.targetSelector && !target) continue;

    let score = def.baseWeight;
    const contributions: ScoreContribution[] = [{ kind: "base", delta: def.baseWeight }];

    // Need contributions (need value is 0..100; weights are multipliers).
    for (const [need, weight] of Object.entries(def.needWeights)) {
      const v = npc.needs[need as keyof NpcState["needs"]] ?? 0;
      const delta = v * (weight ?? 0);
      score += delta;
      if (delta !== 0) contributions.push({ kind: "need", key: need, delta, note: `v=${v}` });
    }

    // Trait contributions (trait value is 0..100; weights are multipliers).
    for (const [trait, weight] of Object.entries(def.traitWeights)) {
      const v = npc.traits[trait as TraitKey] ?? 0;
      const delta = v * (weight ?? 0);
      score += delta;
      if (delta !== 0) contributions.push({ kind: "trait", key: trait, delta, note: `v=${v}` });
    }

    // v2: emotion contributions (0..100)
    {
      const emo = getEmotions(npc);
      // Anger pushes toward violence/crime; fear pushes away from violence; gratitude pushes toward prosocial actions.
      let delta = 0;
      if (def.kind === "assault" || def.kind === "kill" || def.kind === "kidnap") {
        delta += (emo.anger - emo.fear) * 0.25;
      } else if (def.kind === "steal") {
        delta += (emo.anger - emo.shame) * 0.15;
      } else if (def.kind === "heal" || def.kind === "patrol" || def.kind.startsWith("work_")) {
        delta += emo.gratitude * 0.08;
      } else if (def.kind === "trade") {
        delta += (emo.gratitude - emo.fear) * 0.05;
      }
      if (delta !== 0) {
        score += delta;
        contributions.push({ kind: "emotion", key: "state", delta, note: `anger=${emo.anger.toFixed(0)} fear=${emo.fear.toFixed(0)}` });
      }
    }

    // Site condition contributions.
    const site = world.sites[npc.siteId];
    if (site) {
      for (const cond of def.siteConditionWeights) {
        if (checkSiteCondition(site, cond)) {
          score += cond.weight;
          if (cond.weight !== 0)
            contributions.push({
              kind: "siteCondition",
              key: `${cond.field}${cond.op}${cond.threshold}`,
              delta: cond.weight
            });
        }
      }
    }

    // Belief contributions (scaled by confidence).
    for (const bw of def.beliefWeights) {
      const belief = npc.beliefs.find((b) => b.predicate === bw.predicate);
      if (belief) {
        const delta = (belief.confidence / 100) * bw.weight;
        score += delta;
        if (delta !== 0)
          contributions.push({
            kind: "belief",
            key: bw.predicate,
            delta,
            note: `confidence=${belief.confidence}`
          });
      }
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
          const ok = (rw.op === ">" && v > rw.threshold) || (rw.op === "<" && v < rw.threshold);
          if (ok) {
            score += rw.weight;
            if (rw.weight !== 0)
              contributions.push({
                kind: "relationship",
                key: String(rw.field),
                delta: rw.weight,
                note: `${rw.op}${rw.threshold} v=${v}`
              });
          }
        }
      }
    }

    // v2: debt-based modifier (only when enabled).
    // If I owe the target, I'm more likely to engage (trade/cooperate) and less likely to attack.
    if (relV2Enabled && target) {
      const pressure = getDebtPressure(npc, target);
      if (pressure > 0) {
        let mult = 0;
        if (def.kind === "trade") mult = 0.2;
        else if (def.kind === "heal") mult = 0.05;
        else if (def.kind === "assault" || def.kind === "kill" || def.kind === "kidnap") mult = -0.15;

        if (mult !== 0) {
          const delta = pressure * mult;
          score += delta;
          contributions.push({
            kind: "obligation",
            key: "debt",
            delta,
            note: `pressure=${pressure.toFixed(1)}`
          });
        }
      }
    }

    // v2: memory-based modifiers (only when enabled).
    if (memEnabled && target) {
      const hostility = getMemoryBasedHostility(npc, target);
      if (hostility > 0) {
        // Adjust based on action kind.
        // - violence/kidnap gets a boost
        // - trade gets a penalty
        // - arrest gets only a small boost (duty remains primary driver)
        let mult = 0;
        if (def.kind === "assault" || def.kind === "kill" || def.kind === "kidnap") mult = 0.25;
        else if (def.kind === "arrest") mult = 0.1;
        else if (def.kind === "trade") mult = -0.2;

        if (mult !== 0) {
          const delta = hostility * mult;
          score += delta;
          contributions.push({
            kind: "memory",
            key: "hostility",
            delta,
            note: `hostility=${hostility.toFixed(1)}`
          });
        }
      }
    }

    // Reactive state modifiers.
    for (const mod of stateModifiers) {
      if (mod.actionKind === def.kind || mod.actionKind === "*") {
        score += mod.weightDelta;
        if (mod.weightDelta !== 0)
          contributions.push({
            kind: "stateMod",
            key: mod.actionKind === "*" ? "*" : def.kind,
            delta: mod.weightDelta
          });
      }
    }

    // Goal modifiers.
    for (const mod of goalModifiers) {
      if (mod.actionKind !== def.kind) continue;
      if (mod.requiresTarget && !target) continue;
      score += mod.weightDelta;
      if (mod.weightDelta !== 0)
        contributions.push({
          kind: "goalMod",
          key: mod.goalId,
          delta: mod.weightDelta
        });
    }

    // Task 15: flee bonus when low HP.
    if (def.kind === "travel" && npc.hp < 20) {
      score += 50;
      contributions.push({ kind: "specialCase", key: "low_hp_flee", delta: 50 });
    }

    if (score > 0) results.push({ definition: def, score, target, contributions });
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


