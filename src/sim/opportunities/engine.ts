import { makeId } from "../ids";
import type { Attempt, SimEvent, SimTick, WorldState } from "../types";
import type { Opportunity } from "./types";

function oppKindFromPendingAttempt(a: Opportunity["pendingAttempt"]["kind"]): Opportunity["kind"] | null {
  if (a === "assault" || a === "kill") return "stop_violence";
  if (a === "arrest") return "counter_arrest";
  if (a === "kidnap") return "counter_kidnap";
  if (a === "steal") return "stop_theft";
  return null;
}

export function opportunitiesFromPendingAttempt(
  world: WorldState,
  pending: { executeAtTick: SimTick; attempt: Attempt },
  ctx: { nextEventSeq: () => number }
): { opportunities: Opportunity[]; events: SimEvent[] } {
  const a = pending.attempt;
  const kind = oppKindFromPendingAttempt(a.kind);
  if (!kind) return { opportunities: [], events: [] };

  // Create only for visible attempts (others can’t react to what they can’t see).
  // Note: private attempts can still be reacted to by “insiders” later; v1 keeps it simple.
  if (a.visibility !== "public") return { opportunities: [], events: [] };

  const opp: Opportunity = {
    id: makeId("opp", world.tick, ctx.nextEventSeq()),
    tick: world.tick,
    siteId: a.siteId,
    kind,
    pendingAttempt: {
      pendingAttemptId: a.id,
      actorId: a.actorId,
      targetId: a.targetId,
      kind: a.kind,
      visibility: a.visibility,
      executeAtTick: pending.executeAtTick
    },
    expiresAtTick: world.tick + 1
  };

  const ev: SimEvent = {
    id: makeId("evt", world.tick, ctx.nextEventSeq()),
    tick: world.tick,
    kind: "opportunity.created",
    visibility: "system",
    siteId: a.siteId,
    message: `Opportunity: ${kind}`,
    data: { rootAttemptId: a.id, opportunity: opp }
  };

  return { opportunities: [opp], events: [ev] };
}


