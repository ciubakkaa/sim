import { makeId } from "../../ids";
import type { Attempt, SimEvent, SiteRumor, WorldState } from "../../types";
import type { Rng } from "../../rng";
import { applyPublicRumorAndRelationships } from "../rumors";
import type { AttemptConsequence } from "../consequences";
import { applyConsequences } from "../applyConsequences";

export type ResolveCtx = { rng: Rng; nextEventSeq: () => number };

export type ResolveResult = { world: WorldState; events: SimEvent[]; keyChanges: string[] };

export function makeHelpers(world: WorldState, attempt: Attempt, ctx: ResolveCtx) {
  let nextWorld = world;
  const events: SimEvent[] = [];
  const keyChanges: string[] = [];
  const consequences: AttemptConsequence[] = [];

  const emit = (message: string, data?: Record<string, unknown>) => {
    events.push({
      id: makeId("evt", nextWorld.tick, ctx.nextEventSeq()),
      tick: nextWorld.tick,
      kind: "attempt.recorded",
      visibility: attempt.visibility,
      siteId: attempt.siteId,
      message,
      // Snapshot consequences at emit time so later mutations don't retroactively change past events.
      data: { attempt, consequences: [...consequences], ...(data ?? {}) }
    });
  };

  const addPublicRumor = (label: string, confidence: number) => {
    const rumor: SiteRumor = {
      tick: nextWorld.tick,
      kind: attempt.kind,
      actorId: attempt.actorId,
      targetId: attempt.targetId,
      siteId: attempt.siteId,
      confidence,
      label
    };
    nextWorld = applyPublicRumorAndRelationships(nextWorld, rumor);
  };

  return {
    get world() {
      return nextWorld;
    },
    get consequences() {
      return consequences;
    },
    setWorld(w: WorldState) {
      nextWorld = w;
    },
    apply(c: AttemptConsequence) {
      consequences.push(c);
      nextWorld = applyConsequences(nextWorld, [c]);
    },
    applyAll(cs: AttemptConsequence[]) {
      consequences.push(...cs);
      nextWorld = applyConsequences(nextWorld, cs);
    },
    events,
    keyChanges,
    emit,
    addPublicRumor,
    pushKeyChange(s: string) {
      keyChanges.push(s);
    }
  };
}


