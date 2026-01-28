/**
 * Trace types for debug artifacts.
 * 
 * TraceLog is separate from WorldEventLog:
 * - WorldEventLog: facts that happened in-world
 * - TraceLog: debug artifacts (decision traces, scoring breakdowns)
 */

import type { SimTick, SiteId } from "../../sim/types";
import type { EntityId, DecisionReason } from "../kernelTypes";

export { DecisionReason } from "../kernelTypes";

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
