/**
 * Semantic digest for determinism testing.
 * 
 * Produces a hash that survives refactors by:
 * - Extracting only semantic fields
 * - Sorting by stable criteria
 * - Including a discriminator for same-shape events
 */

import { stableHashHex } from "../hash";
import type { KernelEvent } from "./eventTypes";
import type { SimEvent } from "../../sim/types";

export interface DigestableEvent {
  kind: string;
  tick: number;
  siteId?: string;
  actorId?: string;
  targetId?: string;
  discriminator?: string;
}

function extractDigestable(e: KernelEvent | SimEvent): DigestableEvent {
  const data = e.data as Record<string, unknown> | undefined;
  const attempt = data?.attempt as Record<string, unknown> | undefined;
  
  return {
    kind: e.kind,
    tick: e.tick,
    siteId: e.siteId,
    actorId: (data?.actorId ?? attempt?.actorId) as string | undefined,
    targetId: (data?.targetId ?? attempt?.targetId) as string | undefined,
    // Add discriminator to prevent two same-kind events in same tick from same actor collapsing
    discriminator: (data?.purpose ?? attempt?.kind ?? data?.actionKind) as string | undefined,
  };
}

export function computeSemanticDigest(events: (KernelEvent | SimEvent)[]): string {
  // 1. Extract semantic fields only
  const digestable = events.map(extractDigestable);
  
  // 2. Sort by (tick, kind, actorId, targetId, siteId, discriminator)
  digestable.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.actorId !== b.actorId) return (a.actorId ?? "").localeCompare(b.actorId ?? "");
    if (a.targetId !== b.targetId) return (a.targetId ?? "").localeCompare(b.targetId ?? "");
    if (a.siteId !== b.siteId) return (a.siteId ?? "").localeCompare(b.siteId ?? "");
    return (a.discriminator ?? "").localeCompare(b.discriminator ?? "");
  });
  
  // 3. Hash the sorted, normalized payload using stable hash
  return stableHashHex([JSON.stringify(digestable)]);
}
