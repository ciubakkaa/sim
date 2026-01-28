/**
 * Kernel event types with causality support.
 */

import type { SimTick, SiteId } from "../../sim/types";
import type { EntityId, EventCauses } from "../kernelTypes";

export interface KernelEvent {
  id: string;
  tick: SimTick;
  kind: string;
  visibility: "private" | "public" | "system";
  siteId?: SiteId;
  actorId?: EntityId;
  targetId?: EntityId;
  message: string;
  data?: Record<string, unknown>;
  causes?: EventCauses;
}

export interface EventFilter {
  tick?: SimTick;
  tickRange?: { from: SimTick; to: SimTick };
  kind?: string;
  kinds?: string[];
  siteId?: SiteId;
  actorId?: EntityId;
  targetId?: EntityId;
}
