/**
 * EventBus: Append-only world event log with stable IDs and collision detection.
 */

import type { KernelEvent, EventFilter } from "./eventTypes";
import type { EmitEventParams, EventCauses } from "../kernelTypes";
import { stableEventId } from "./stableId";

export class EventBus {
  private events: KernelEvent[] = [];
  private seenIds = new Set<string>();
  private devMode: boolean;
  
  constructor(opts?: { devMode?: boolean }) {
    this.devMode = opts?.devMode ?? (process.env.NODE_ENV !== "production");
  }
  
  emit(params: EmitEventParams): string {
    const id = stableEventId({
      kind: params.kind,
      tick: params.tick,
      siteId: params.siteId,
      actorId: params.actorId,
      targetId: params.targetId,
      purpose: params.purpose,
    }, { devMode: this.devMode });
    
    // Collision detection
    if (this.seenIds.has(id)) {
      const msg = `EventBus: duplicate event ID "${id}" at tick ${params.tick}. ` +
        `Check purpose field or missing actorId/targetId/siteId.`;
      if (this.devMode) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
    this.seenIds.add(id);
    
    const event: KernelEvent = {
      id,
      tick: params.tick,
      kind: params.kind,
      visibility: params.visibility,
      siteId: params.siteId,
      actorId: params.actorId,
      targetId: params.targetId,
      message: params.message,
      data: params.data,
      causes: params.causes,
    };
    
    this.events.push(event);
    return id;
  }
  
  query(filter: EventFilter): KernelEvent[] {
    return this.events.filter(e => {
      if (filter.tick !== undefined && e.tick !== filter.tick) return false;
      if (filter.tickRange) {
        if (e.tick < filter.tickRange.from || e.tick > filter.tickRange.to) return false;
      }
      if (filter.kind && e.kind !== filter.kind) return false;
      if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
      if (filter.siteId && e.siteId !== filter.siteId) return false;
      if (filter.actorId && e.actorId !== filter.actorId) return false;
      if (filter.targetId && e.targetId !== filter.targetId) return false;
      return true;
    });
  }
  
  getAll(): KernelEvent[] {
    return [...this.events];
  }
  
  clear(): void {
    this.events = [];
    this.seenIds.clear();
  }
}
