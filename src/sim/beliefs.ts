import type { Belief, NpcId, NpcState, SimTick } from "./types";
import { clamp } from "./util";
import { tickToDay } from "./types";

const MAX_BELIEFS = 120;

export function addBelief(npc: NpcState, belief: Belief): NpcState {
  // De-dup on (subject,predicate,object,source) keeping the newest/higher-confidence.
  const next = [...npc.beliefs];
  const idx = next.findIndex(
    (b) =>
      b.subjectId === belief.subjectId &&
      b.predicate === belief.predicate &&
      b.object === belief.object &&
      b.source === belief.source
  );
  if (idx >= 0) {
    const prev = next[idx]!;
    // Replace if newer or more confident.
    if (belief.tick >= prev.tick || belief.confidence > prev.confidence) next[idx] = belief;
  } else {
    next.push(belief);
  }

  next.sort((a, b) => b.tick - a.tick);
  const trimmed = next.length > MAX_BELIEFS ? next.slice(0, MAX_BELIEFS) : next;
  return { ...npc, beliefs: trimmed };
}

export function recordDid(
  npc: NpcState,
  subjectId: NpcId,
  kind: string,
  confidence: number,
  source: Belief["source"],
  tick: SimTick
): NpcState {
  return addBelief(npc, {
    subjectId,
    predicate: "did",
    object: kind,
    confidence: clamp(Math.round(confidence), 0, 100),
    source,
    tick
  });
}

export function decayBeliefsDaily(npc: NpcState, tick: SimTick): NpcState {
  const nowDay = tickToDay(tick);
  if (!npc.beliefs.length) return npc;

  const next: Belief[] = [];
  for (const b of npc.beliefs) {
    const ageDays = Math.max(0, nowDay - tickToDay(b.tick));
    if (ageDays <= 0) {
      next.push(b);
      continue;
    }

    const baseDecay = b.source === "rumor" ? 7 : b.source === "report" ? 6 : 4;
    const traumaticMult = b.object === "kill" || b.object === "raid" || b.object === "forced_eclipse" ? 0.6 : 1;
    const decay = Math.round(baseDecay * traumaticMult);
    const c = clamp(b.confidence - decay, 0, 100);
    if (c >= 15) next.push({ ...b, confidence: c });
  }

  return next.length === npc.beliefs.length ? npc : { ...npc, beliefs: next };
}


