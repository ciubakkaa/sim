import type { AttemptKind, NpcId, SimTick, SiteId } from "../types";

export type OpportunityKind =
  | "stop_violence"
  | "protect_target"
  | "counter_arrest"
  | "counter_kidnap"
  | "stop_theft";

export type Opportunity = {
  id: string;
  tick: SimTick;
  siteId: SiteId;
  kind: OpportunityKind;
  /**
   * The pending attempt that created this opportunity (if any).
   * We keep this as a reference payload for response scoring.
   */
  pendingAttempt: {
    pendingAttemptId: string;
    actorId: NpcId;
    targetId?: NpcId;
    kind: AttemptKind;
    visibility: "private" | "public";
    executeAtTick: SimTick;
  };
  expiresAtTick: SimTick;
};


