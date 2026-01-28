/**
 * Stable event ID generation.
 * 
 * IDs are hash-based on semantic fields, not emission order.
 * This ensures determinism and enables causality tracking.
 */

import { stableHashHex } from "../hash";

// For most events, siteId is REQUIRED
export interface LocalEventIdParams {
  kind: string;
  tick: number;
  siteId: string;
  actorId?: string;
  targetId?: string;
  purpose?: string;
}

// For truly global events (sim.started, sim.day.ended), siteId is optional
export interface GlobalEventIdParams {
  kind: string;
  tick: number;
  siteId?: undefined;
  actorId?: string;
  targetId?: string;
  purpose?: string;
}

export type EventIdParams = LocalEventIdParams | GlobalEventIdParams;

// Global event kinds that don't require siteId
const GLOBAL_EVENT_KINDS = new Set(["sim.started", "sim.day.ended"]);

// Event kinds that MUST have siteId
const SITE_REQUIRED_EVENT_KINDS = new Set([
  // Crime/Attempts
  "attempt.started", "attempt.completed", "attempt.recorded", "attempt.aborted", "attempt.interrupted",
  // Combat
  "npc.died",
  // Economy
  "world.food.produced", "world.food.consumed", "world.food.spoiled",
  "world.population.changed", "world.unrest.drifted", "world.morale.drifted",
  // Social
  "intent.signaled", "opportunity.created", "opportunity.responded",
  // Faction
  "faction.operation.created", "faction.operation.phase", "faction.operation.completed",
]);

// Event kinds that MUST have actorId
const ACTOR_REQUIRED_EVENT_KINDS = new Set([
  // Agent actions
  "attempt.started", "attempt.completed", "attempt.recorded", "attempt.aborted", "attempt.interrupted",
  // Death events
  "npc.died",
  // Social signals
  "intent.signaled",
  // Travel
  "travel.encounter", "local.travel.started", "local.travel.arrived",
]);

export function stableEventId(params: EventIdParams, opts?: { devMode?: boolean }): string {
  const devMode = opts?.devMode ?? (process.env.NODE_ENV !== "production");
  
  // Strict validation: some event kinds MUST have siteId
  if (!params.siteId && SITE_REQUIRED_EVENT_KINDS.has(params.kind)) {
    const msg = `stableEventId: event kind "${params.kind}" requires siteId but none provided`;
    if (devMode) throw new Error(msg);
    else console.error(msg);
  }
  
  // Strict validation: some event kinds MUST have actorId
  if (!params.actorId && ACTOR_REQUIRED_EVENT_KINDS.has(params.kind)) {
    const msg = `stableEventId: event kind "${params.kind}" requires actorId but none provided`;
    if (devMode) throw new Error(msg);
    else console.error(msg);
  }
  
  // Soft validation: warn for unknown event kinds without siteId
  if (!params.siteId && !GLOBAL_EVENT_KINDS.has(params.kind) && !SITE_REQUIRED_EVENT_KINDS.has(params.kind)) {
    console.warn(`stableEventId: event kind "${params.kind}" should probably have siteId for collision safety`);
  }
  
  const parts = [params.kind, params.tick, params.siteId, params.actorId, params.targetId, params.purpose];
  return `evt-${stableHashHex(parts)}`;
}
