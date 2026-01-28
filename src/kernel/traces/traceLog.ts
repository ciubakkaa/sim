/**
 * TraceLog: Separate stream for decision traces (debug artifacts).
 */

import type { DecisionTrace } from "./traceTypes";
import { stableHashHex } from "../hash";

export class TraceLog {
  private traces: DecisionTrace[] = [];
  private seenIds = new Set<string>();
  private devMode: boolean;
  
  constructor(opts?: { devMode?: boolean }) {
    this.devMode = opts?.devMode ?? (process.env.NODE_ENV !== "production");
  }
  
  emitDecision(trace: Omit<DecisionTrace, "id">): string {
    // Include reason in hash - allows multiple trace types per agent per tick if needed
    const id = `trace-${stableHashHex([trace.tick, trace.agentId, trace.reason])}`;
    
    // Collision detection - duplicate traces usually mean a bug in gating
    if (this.seenIds.has(id)) {
      const msg = `TraceLog: duplicate trace ID "${id}" - check gating logic in shouldEmitDecisionTrace`;
      if (this.devMode) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
    this.seenIds.add(id);
    
    this.traces.push({ id, ...trace });
    return id;
  }
  
  getAll(): DecisionTrace[] {
    return [...this.traces];
  }
  
  clear(): void {
    this.traces = [];
    this.seenIds.clear();
  }
}
