/**
 * Minimal schedules/routines system (v2, opt-in via useSchedules)
 *
 * Implemented as scoring weight modifiers so we don't rewrite the AI.
 * These are "soft" biases: they can be overridden by strong needs/threats.
 */

import type { Attempt, NpcState, WorldState } from "../types";
import { getConfig } from "../config";

export function scheduleWeightModifiersForNpc(
  npc: NpcState,
  world: WorldState
): Array<{ goalId: string; actionKind: Attempt["kind"]; weightDelta: number }> {
  const cfg = getConfig();

  const hour = world.tick % 24;
  const mods: Array<{ goalId: string; actionKind: Attempt["kind"]; weightDelta: number }> = [];

  // Night rest: bias toward idle and away from travel.
  const isNight = hour >= 22 || hour <= 5;
  if (isNight) {
    mods.push(
      { goalId: "schedule:sleep", actionKind: "idle", weightDelta: 35 },
      { goalId: "schedule:sleep", actionKind: "travel", weightDelta: -20 }
    );
  }

  // Morning work block.
  const isMorningWork = hour >= 6 && hour <= 11;
  if (isMorningWork) {
    if (npc.category === "Farmer") mods.push({ goalId: "schedule:work", actionKind: "work_farm", weightDelta: 60 });
    if (npc.category === "Fisher") mods.push({ goalId: "schedule:work", actionKind: "work_fish", weightDelta: 60 });
    if (npc.category === "HunterTrapper") mods.push({ goalId: "schedule:work", actionKind: "work_hunt", weightDelta: 60 });

    if (npc.category === "GuardMilitia" || npc.category === "ScoutRanger" || npc.category === "Threadwarden") {
      mods.push({ goalId: "schedule:guard_shift", actionKind: "patrol", weightDelta: 35 });
    }
  }

  // Market window for merchants/crafts.
  const isMarketHours = hour >= 10 && hour <= 18;
  if (isMarketHours) {
    if (npc.category === "MerchantSmuggler" || npc.category === "Craftsperson") {
      mods.push({ goalId: "schedule:market_hours", actionKind: "trade", weightDelta: 45 });
    }
  }

  // Evening: discourage long travel (people settle down).
  if (hour >= 19 && hour <= 22) {
    mods.push({ goalId: "schedule:evening", actionKind: "travel", weightDelta: -10 });
  }

  return mods;
}


