/**
 * StableRoll API: Order-independent RNG for deterministic simulation.
 * 
 * Roll outcomes depend on semantic parameters (tick, siteId, agentId, purpose),
 * not on the order of RNG calls. This makes the simulation robust to refactoring.
 */

import { stableHash, stableHashHex } from "./hash";

export interface StableRollParams {
  tick: number;
  siteId: string;            // REQUIRED - prevents collisions between identical actions in different towns
  agentId?: string;
  targetId?: string;
  actionKind?: string;
  purpose: string;           // REQUIRED - describes what the roll is for
}

export function stableRollId(params: StableRollParams): string {
  // siteId is ALWAYS required - two identical actions in two towns must not share a roll
  return stableHashHex([params.tick, params.siteId, params.agentId, params.targetId, params.actionKind, params.purpose]);
}

export function stableChance(seed: number, rollId: string, p: number): boolean {
  // Maps rollId to deterministic float [0,1), independent of call order
  const h = stableHash([seed, rollId]);
  // Use 2**32 (0x100000000) not 0xffffffff to avoid edge weirdness at boundaries
  const value = (h >>> 0) / 0x100000000;
  return value < p;
}

export function stableInt(seed: number, rollId: string, min: number, max: number): number {
  const h = stableHash([seed, rollId]);
  return min + ((h >>> 0) % (max - min + 1));
}

export function stableFloat(seed: number, rollId: string, min: number, max: number): number {
  const h = stableHash([seed, rollId]);
  const value = (h >>> 0) / 0x100000000;
  return min + value * (max - min);
}

/**
 * Create a bound stable RNG context for a specific seed.
 */
export function createStableRng(seed: number) {
  return {
    chance: (rollId: string, p: number) => stableChance(seed, rollId, p),
    int: (rollId: string, min: number, max: number) => stableInt(seed, rollId, min, max),
    float: (rollId: string, min: number, max: number) => stableFloat(seed, rollId, min, max),
    rollId: (params: StableRollParams) => stableRollId(params),
  };
}
