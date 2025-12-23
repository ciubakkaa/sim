import type { SimEvent, WorldState } from "../../lib/protocol";
import { getAttempt, getAttemptId, getResponseAttempt, getRootAttemptId } from "./metrics";

export type ActionGroup = {
  id: string; // root attempt id
  siteId?: string;
  startTick: number;
  endTick: number;
  title: string;
  subtitle?: string;
  outcome?: "completed" | "aborted" | "interrupted";
  events: SimEvent[];
  childActionIds: string[];
};

function labelNpc(world: WorldState | null | undefined, npcId: string | undefined): string | undefined {
  if (!npcId) return undefined;
  const n = world?.npcs?.[npcId];
  return n ? n.name : npcId;
}

function outcomeFromEvents(events: SimEvent[]): ActionGroup["outcome"] {
  if (events.some((e) => e.kind === "attempt.interrupted")) return "interrupted";
  if (events.some((e) => e.kind === "attempt.aborted")) return "aborted";
  if (events.some((e) => e.kind === "attempt.completed")) return "completed";
  return undefined;
}

function maybeAttachIntentPrelude(all: SimEvent[], idx: number, attempt: { actorId?: string; targetId?: string }, windowTicks = 4): SimEvent[] {
  const started = all[idx];
  if (!started || started.kind !== "attempt.started") return [];
  const actorId = attempt.actorId;
  if (!actorId) return [];
  const startTick = started.tick;
  const out: SimEvent[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const e = all[i]!;
    if (startTick - e.tick > windowTicks) break;
    if (e.kind !== "intent.signaled") continue;
    const d: any = e.data ?? {};
    if (d.actorId !== actorId) continue;
    if (attempt.targetId && d.targetId && d.targetId !== attempt.targetId) continue;
    out.push(e);
  }
  return out.reverse();
}

export function groupEventsByAction(events: SimEvent[], world?: WorldState | null): { groups: ActionGroup[]; ungrouped: SimEvent[] } {
  // Use a stable ordering first.
  const ordered = [...events].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));

  // Map attemptId -> indices/events.
  const byAttemptId = new Map<string, SimEvent[]>();
  for (const e of ordered) {
    const id = getAttemptId(e);
    if (!id) continue;
    const arr = byAttemptId.get(id) ?? [];
    arr.push(e);
    byAttemptId.set(id, arr);
  }

  // Map rootAttemptId -> opportunity events and child action ids (responses).
  const oppEventsByRoot = new Map<string, SimEvent[]>();
  const childActionsByRoot = new Map<string, Set<string>>();

  for (const e of ordered) {
    if (e.kind !== "opportunity.created" && e.kind !== "opportunity.responded") continue;
    const rootId = getRootAttemptId(e);
    if (!rootId) continue;
    const arr = oppEventsByRoot.get(rootId) ?? [];
    arr.push(e);
    oppEventsByRoot.set(rootId, arr);

    if (e.kind === "opportunity.responded") {
      const ra = getResponseAttempt(e);
      const rid = ra?.id;
      if (rid) {
        const set = childActionsByRoot.get(rootId) ?? new Set<string>();
        set.add(rid);
        childActionsByRoot.set(rootId, set);
      }
    }
  }

  const usedEventIds = new Set<string>();
  const groups: ActionGroup[] = [];

  // Root actions: any attempt that has started/recorded/completed etc.
  const rootAttemptIds = Array.from(byAttemptId.keys()).sort();
  for (const attemptId of rootAttemptIds) {
    const coreEvents = byAttemptId.get(attemptId) ?? [];
    const oppEvents = oppEventsByRoot.get(attemptId) ?? [];

    // Find a canonical attempt object (prefer started/completed/recorded in that order).
    const canonicalEvent =
      coreEvents.find((e) => e.kind === "attempt.started") ??
      coreEvents.find((e) => e.kind === "attempt.completed") ??
      coreEvents.find((e) => e.kind === "attempt.recorded") ??
      coreEvents[0];
    const a: any = canonicalEvent ? getAttempt(canonicalEvent) : undefined;

    // Intent prelude (heuristic): only for attempt.started groups.
    let prelude: SimEvent[] = [];
    if (canonicalEvent?.kind === "attempt.started") {
      const idx = ordered.findIndex((x) => x.id === canonicalEvent.id);
      if (idx >= 0 && a) prelude = maybeAttachIntentPrelude(ordered, idx, a);
    }

    const childIds = Array.from(childActionsByRoot.get(attemptId) ?? []).sort();
    const childEvents: SimEvent[] = [];
    for (const childId of childIds) {
      const evs = byAttemptId.get(childId);
      if (evs) childEvents.push(...evs);
    }

    const allEvents = [...prelude, ...coreEvents, ...oppEvents, ...childEvents]
      .filter((e) => e) // defensive
      .sort((x, y) => x.tick - y.tick || x.id.localeCompare(y.id));

    if (allEvents.length === 0) continue;

    for (const e of allEvents) usedEventIds.add(e.id);

    const actorName = labelNpc(world, a?.actorId);
    const kind = a?.kind ?? canonicalEvent?.kind ?? "action";
    const why = a?.why?.text ? String(a.why.text) : "";
    const outcome = outcomeFromEvents(allEvents);
    const startTick = allEvents[0]!.tick;
    const endTick = allEvents[allEvents.length - 1]!.tick;
    const responses = childIds.length;

    groups.push({
      id: attemptId,
      siteId: canonicalEvent?.siteId,
      startTick,
      endTick,
      title: `${actorName ? `${actorName} • ` : ""}${kind}${outcome ? ` • ${outcome}` : ""}`,
      subtitle: `${why ? why : ""}${responses ? `${why ? " • " : ""}+${responses} response${responses === 1 ? "" : "s"}` : ""}` || undefined,
      outcome,
      events: allEvents,
      childActionIds: childIds
    });
  }

  // Ungrouped: anything not in an action group (world/system events, local actions, etc.).
  const ungrouped = ordered.filter((e) => !usedEventIds.has(e.id));

  // Sort groups newest-last to match existing feed ordering (EventFeed slices from the end).
  groups.sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));

  return { groups, ungrouped };
}


