/**
 * Core kernel types for the setting-agnostic simulation engine.
 */

import type { SimTick, SiteId, NpcId, WorldState, SimEvent } from "../sim/types";

export type EntityId = string;

/**
 * Context passed to modules during tick execution.
 */
export interface TickContext {
  world: WorldState;
  tick: SimTick;
  seed: number;
  
  // Event emission
  emitEvent: (params: EmitEventParams) => string;
  
  // Trace emission
  emitTrace: (trace: Omit<DecisionTrace, "id">) => string;
  
  // Stable RNG
  stableChance: (rollId: string, p: number) => boolean;
  stableInt: (rollId: string, min: number, max: number) => number;
  
  // Roll ID generation helper
  rollId: (params: StableRollParams) => string;
}

export interface EmitEventParams {
  kind: string;
  tick: SimTick;
  siteId?: SiteId;
  actorId?: EntityId;
  targetId?: EntityId;
  visibility: "private" | "public" | "system";
  message: string;
  data?: Record<string, unknown>;
  purpose?: string;
  causes?: EventCauses;
}

export interface EventCauses {
  eventIds?: string[];
  rumorIds?: string[];
  observationIds?: string[];
  agentIds?: string[];
}

export interface StableRollParams {
  tick: SimTick;
  siteId: string;
  agentId?: string;
  targetId?: string;
  actionKind?: string;
  purpose: string;
}

export type DecisionReason = 
  | "goal_formed"
  | "plan_created"
  | "plan_changed"
  | "plan_abandoned";

export interface DecisionTrace {
  id: string;
  tick: SimTick;
  agentId: EntityId;
  reason: DecisionReason;
  location: { siteId: SiteId; locationId?: string };
  needsSnapshot: Partial<Record<string, number>>;
  traitSnapshot: Partial<Record<string, number>>;
  topOptions: { actionKind: string; score: number; reasons: string[] }[];
  chosenOption: { actionKind: string; score: number };
  perceivedInfoRefs: { eventIds?: string[]; rumorIds?: string[]; observationIds?: string[] };
}

/**
 * Result from a tick execution.
 */
export interface KernelTickResult {
  world: WorldState;
  events: SimEvent[];
  traces: DecisionTrace[];
}

/**
 * Result from module tick hooks.
 */
export interface ModuleTickResult {
  worldUpdates?: Partial<WorldState>;
  events?: SimEvent[];
}

/**
 * Decision input for onAgentDecide hook.
 */
export interface DecisionInput {
  options: ScoredOption[];
  modifiers: ScoreModifier[];
  blockedActions: Set<string>;
}

export interface ScoredOption {
  actionKind: string;
  baseScore: number;
  targetId?: EntityId;
  reasons: string[];
}

export interface ScoreModifier {
  moduleId: string;
  actionKind: string; // '*' for all actions
  delta: number;
  reason: string;
}

export type DecisionOutput = DecisionInput;
