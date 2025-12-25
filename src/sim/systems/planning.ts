/**
 * Minimal planning system (v2)
 *
 * Goal: provide a stable “commitment” layer that biases action selection across ticks,
 * without replacing the existing goals/intents yet.
 */

import type { AttemptKind, NpcId, NpcState, PlanGoalKind, PlanState, SimEvent, WorldState } from "../types";
import { makeId } from "../ids";
import { getConfig } from "../config";

export function updatePlans(world: WorldState, nextEventSeq: () => number): WorldState {
  const ids = Object.keys(world.npcs).sort();
  let nextNpcs: typeof world.npcs | undefined;
  let changed = false;

  const cfg = getConfig();
  const timeoutHours = Math.max(4, Math.floor((cfg.tuning.planStepTimeoutMultiplier ?? 2) * 6)); // default 12h
  const maxFailures = Math.max(1, Math.floor(cfg.tuning.planReplanThreshold ?? 3));

  for (const id of ids) {
    const npc = world.npcs[id];
    if (!npc || !npc.alive) continue;

    // Expire very old plans (simple safety valve).
    const plan = npc.plan;
    if (plan && world.tick - plan.createdTick > 48) {
      if (!nextNpcs) nextNpcs = { ...world.npcs };
      nextNpcs[id] = { ...npc, plan: undefined };
      changed = true;
      continue;
    }

    // Keep existing plan if still has steps, but replan if stuck for too long.
    if (plan && plan.stepIndex < plan.steps.length) {
      const last = plan.lastProgressTick ?? plan.createdTick;
      if (world.tick - last <= timeoutHours) continue;

      const failures = (plan.failures ?? 0) + 1;
      if (failures >= maxFailures) {
        if (!nextNpcs) nextNpcs = { ...world.npcs };
        nextNpcs[id] = { ...npc, plan: undefined };
        changed = true;
        continue;
      }

      // Re-plan: regenerate steps based on current dominant need, carrying failure count.
      const replanned = createPlanForNpc(npc, world, nextEventSeq, { failures });
      if (!replanned) continue;
      if (!nextNpcs) nextNpcs = { ...world.npcs };
      nextNpcs[id] = { ...npc, plan: replanned };
      changed = true;
      continue;
    }

    // Create a new plan based on dominant need.
    const created = createPlanForNpc(npc, world, nextEventSeq);
    if (!created) continue;
    if (!nextNpcs) nextNpcs = { ...world.npcs };
    nextNpcs[id] = { ...npc, plan: created };
    changed = true;
  }

  return changed && nextNpcs ? { ...world, npcs: nextNpcs } : world;
}

function createPlanForNpc(
  npc: NpcState,
  world: WorldState,
  nextEventSeq: () => number,
  opts?: { failures?: number }
): PlanState | undefined {
  const needs = npc.needs ?? ({} as any);
  const food = needs.Food ?? 0;
  const safety = needs.Safety ?? 0;
  const duty = needs.Duty ?? 0;

  // Priority order (simple, deterministic).
  if (food >= 75) {
    const step1 = pickFoodStep(npc);
    const cfg = getConfig();
    const steps: { kind: AttemptKind; note?: string }[] = [step1];
    // Multi-step: after earning/stealing, try to trade (buy food) if markets+inventory exist,
    // otherwise fall back to idle (rest).
    steps.push({ kind: "trade", note: "buy_food" });
    return mkPlan(world, nextEventSeq, "get_food", npc.id, steps, `Food=${food} => ${steps.map((s) => s.kind).join("->")}`, opts);
  }
  if (safety >= 80) {
    // If very unsafe, bias travel/flee.
    return mkPlan(
      world,
      nextEventSeq,
      "stay_safe",
      npc.id,
      [{ kind: "travel", note: `Safety=${safety}` }, { kind: "idle", note: "lay_low" }],
      `Safety=${safety} => travel->idle`,
      opts
    );
  }
  if (duty >= 70 && (npc.category === "GuardMilitia" || npc.category === "ScoutRanger" || npc.category === "Threadwarden")) {
    return mkPlan(
      world,
      nextEventSeq,
      "do_duty",
      npc.id,
      [{ kind: "patrol", note: `Duty=${duty}` }, { kind: "investigate", note: "follow_up" }],
      `Duty=${duty} => patrol->investigate`,
      opts
    );
  }
  return undefined;
}

function pickFoodStep(npc: NpcState): { kind: AttemptKind; note?: string } {
  // If category can work its niche, prefer that.
  if (npc.category === "Farmer") return { kind: "work_farm", note: "category=Farmer" };
  if (npc.category === "Fisher") return { kind: "work_fish", note: "category=Fisher" };
  if (npc.category === "HunterTrapper") return { kind: "work_hunt", note: "category=HunterTrapper" };
  if (npc.category === "MerchantSmuggler" || npc.category === "Craftsperson") return { kind: "trade", note: "category=Merchant/Craft" };

  // Otherwise: disciplined -> work (any), greedy/low integrity -> steal.
  const discipline = npc.traits?.Discipline ?? 50;
  const greed = npc.traits?.Greed ?? 50;
  const integrity = npc.traits?.Integrity ?? 50;

  if (greed > 65 && integrity < 40) return { kind: "steal", note: "greed_high integrity_low" };
  if (discipline > 55) return { kind: "work_farm", note: "discipline_high => generic work_farm" };
  return { kind: "steal", note: "fallback" };
}

function mkPlan(
  world: WorldState,
  nextEventSeq: () => number,
  goal: PlanGoalKind,
  npcId: NpcId,
  steps: { kind: AttemptKind; note?: string }[],
  reason: string,
  opts?: { failures?: number }
): PlanState {
  return {
    id: makeId("plan", world.tick, nextEventSeq()),
    goal,
    createdTick: world.tick,
    steps,
    stepIndex: 0,
    reason,
    ...(opts?.failures ? { failures: opts.failures } : {})
  };
}

export function planWeightModifiersForNpc(npc: NpcState): { goalId: string; actionKind: AttemptKind; weightDelta: number }[] {
  const plan = npc.plan;
  if (!plan) return [];
  const step = plan.steps[plan.stepIndex];
  if (!step) return [];

  return [{ goalId: `plan:${plan.id}:${plan.goal}`, actionKind: step.kind, weightDelta: 80 }];
}

export function applyPlanProgressFromEvents(world: WorldState, events: SimEvent[]): WorldState {
  // Treat executed attempt.recorded matching the current plan step as progress.
  // We require `data.consequences` to be present (resolver-emitted), which filters out
  // "Attempt ignored (busy)" records and other non-executed logs.
  const byActor: Record<string, AttemptKind[]> = {};
  for (const e of events) {
    if (e.kind !== "attempt.recorded") continue;
    const a: any = (e.data as any)?.attempt;
    const d: any = e.data ?? {};
    if (!Array.isArray(d.consequences)) continue;
    if (d.success === false) continue;
    if (!a?.actorId || !a?.kind) continue;
    (byActor[a.actorId] ??= []).push(a.kind as AttemptKind);
  }

  const ids = Object.keys(byActor).sort();
  if (!ids.length) return world;

  let changed = false;
  let nextNpcs: typeof world.npcs | undefined;

  for (const actorId of ids) {
    const npc = world.npcs[actorId];
    if (!npc?.plan) continue;
    const plan = npc.plan;
    const step = plan.steps[plan.stepIndex];
    if (!step) continue;

    const performed = byActor[actorId] ?? [];
    if (!performed.includes(step.kind)) continue;

    const nextStepIndex = plan.stepIndex + 1;
    const progressed = nextStepIndex >= plan.steps.length
      ? undefined
      : { ...plan, stepIndex: nextStepIndex, lastProgressTick: world.tick };
    const nextPlan = progressed;

    if (!nextNpcs) nextNpcs = { ...world.npcs };
    nextNpcs[actorId] = { ...npc, plan: nextPlan };
    changed = true;
  }

  return changed && nextNpcs ? { ...world, npcs: nextNpcs } : world;
}


