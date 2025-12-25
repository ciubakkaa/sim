/**
 * Minimal personal inventory system (v2, opt-in)
 */

import type { FoodType, NpcInventory, NpcState } from "../types";
import { clamp } from "../util";

export function createEmptyInventory(): NpcInventory {
  return { coins: 0, food: {} };
}

export function ensureInventory(npc: NpcState): NpcInventory {
  return npc.inventory ?? createEmptyInventory();
}

export function addCoins(npc: NpcState, delta: number): NpcState {
  const inv = ensureInventory(npc);
  const coins = clamp((inv.coins ?? 0) + delta, 0, 1_000_000);
  return { ...npc, inventory: { ...inv, coins } };
}

export function addFood(npc: NpcState, type: FoodType, amount: number): NpcState {
  if (!(amount > 0)) return npc;
  const inv = ensureInventory(npc);
  const prev = inv.food?.[type] ?? 0;
  const next = clamp(prev + amount, 0, 1_000_000);
  return { ...npc, inventory: { ...inv, food: { ...inv.food, [type]: next } } };
}

export function takeFood(npc: NpcState, type: FoodType, amount: number): { npc: NpcState; taken: number } {
  const inv = ensureInventory(npc);
  const prev = inv.food?.[type] ?? 0;
  const want = Math.max(0, Math.floor(amount));
  const taken = Math.min(prev, want);
  if (taken <= 0) return { npc, taken: 0 };
  const next = clamp(prev - taken, 0, 1_000_000);
  return { npc: { ...npc, inventory: { ...inv, food: { ...inv.food, [type]: next } } }, taken };
}

export function getPersonalFoodTotal(npc: NpcState): number {
  const inv = npc.inventory;
  if (!inv?.food) return 0;
  return (inv.food.grain ?? 0) + (inv.food.fish ?? 0) + (inv.food.meat ?? 0);
}


