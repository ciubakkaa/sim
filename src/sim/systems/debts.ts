/**
 * Social Debts system (v2, opt-in)
 *
 * Debts are simple obligations between NPCs that influence decisions.
 * Stored on the debtor NPC as `debts?: SocialDebt[]`.
 */

import type { NpcId, NpcState, SimTick, SocialDebt, SocialDebtKind } from "../types";
import { clamp } from "../util";

export type CreateDebtInput = {
  id: string;
  createdTick: SimTick;
  otherNpcId: NpcId;
  direction: "owes" | "owed";
  debtKind: SocialDebtKind;
  magnitude: number; // 0..100
  reason: string;
  dueTick?: SimTick;
};

export function createDebt(input: CreateDebtInput): SocialDebt {
  return {
    id: input.id,
    otherNpcId: input.otherNpcId,
    direction: input.direction,
    debtKind: input.debtKind,
    magnitude: clamp(input.magnitude, 0, 100),
    reason: input.reason,
    createdTick: input.createdTick,
    dueTick: input.dueTick,
    settled: false
  };
}

export function getActiveDebts(npc: NpcState): SocialDebt[] {
  return (npc.debts ?? []).filter((d) => !d.settled);
}

export function getDebtPressure(npc: NpcState, otherNpcId: NpcId): number {
  // How strongly this NPC is pressured by outstanding debts with `otherNpcId`.
  // Only "owes" increases pressure; "owed" can create entitlement but we skip for now.
  let p = 0;
  for (const d of getActiveDebts(npc)) {
    if (d.otherNpcId !== otherNpcId) continue;
    if (d.direction !== "owes") continue;
    p += d.magnitude;
  }
  return clamp(p, 0, 100);
}

export function hasAnyDebtWith(npc: NpcState, otherNpcId: NpcId): boolean {
  return getActiveDebts(npc).some((d) => d.otherNpcId === otherNpcId);
}


