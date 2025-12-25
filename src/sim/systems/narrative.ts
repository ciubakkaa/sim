/**
 * Minimal narrative system (v2, opt-in via useNarrative)
 *
 * Converts raw simulation events into:
 * - Story beats (lightweight signals)
 * - Chronicle entries (durable history)
 * - Minimal narrative arcs (ops-driven, for now)
 */

import type {
  ChronicleEntry,
  ChronicleEntryKind,
  ChronicleState,
  NarrativeArc,
  NarrativeAct,
  SimEvent,
  StoryBeat,
  WorldState
} from "../types";
import { makeId } from "../ids";
import { getConfig } from "../config";

export function ensureChronicle(world: WorldState): ChronicleState {
  return world.chronicle ?? { entries: [], beats: [], arcs: [] };
}

export function updateChronicleFromEvents(
  world: WorldState,
  events: SimEvent[],
  nextEventSeq: () => number
): WorldState {
  const chron = ensureChronicle(world);
  const newBeats: StoryBeat[] = [];
  const newEntries: ChronicleEntry[] = [];
  const arcs = [...(chron.arcs ?? [])];
  let arcsChanged = false;

  for (const e of events) {
    const detected = detectBeatFromEvent(world, e, nextEventSeq);
    if (!detected) continue;
    newBeats.push(detected.beat);
    newEntries.push(detected.entry);
  }

  for (const e of events) {
    arcsChanged = applyArcsFromEvent(world, arcs, e) || arcsChanged;
  }

  if (!newBeats.length && !newEntries.length && !arcsChanged) return world;

  const beats = [...chron.beats, ...newBeats];
  const entries = [...chron.entries, ...newEntries];

  // Bound growth (keep recent).
  const boundedBeats = beats.length > 400 ? beats.slice(beats.length - 400) : beats;
  const boundedEntries = entries.length > 1200 ? entries.slice(entries.length - 1200) : entries;
  const boundedArcs = arcs.length > 200 ? arcs.slice(arcs.length - 200) : arcs;

  return { ...world, chronicle: { beats: boundedBeats, entries: boundedEntries, arcs: boundedArcs } };
}

function detectBeatFromEvent(
  world: WorldState,
  e: SimEvent,
  nextEventSeq: () => number
): { beat: StoryBeat; entry: ChronicleEntry } | undefined {
  // Faction operation milestone events
  if (
    e.kind === "faction.operation.created" ||
    e.kind === "faction.operation.phase" ||
    e.kind === "faction.operation.completed" ||
    e.kind === "faction.operation.aborted"
  ) {
    const d: any = e.data ?? {};
    const factionId = String(d.factionId ?? "faction");
    const type = String(d.type ?? "op");
    const siteName = e.siteId ? (world.sites[e.siteId as any]?.name ?? e.siteId) : "a site";
    const outcome = d.outcome ? ` (${String(d.outcome)})` : "";
    const headline =
      e.kind === "faction.operation.created"
        ? `${factionId} started an operation (${type}) at ${siteName}`
        : e.kind === "faction.operation.completed"
          ? `${factionId} operation completed (${type}) at ${siteName}${outcome}`
          : e.kind === "faction.operation.aborted"
            ? `${factionId} operation aborted (${type}) at ${siteName}${outcome}`
            : `${factionId} operation advanced (${type}) at ${siteName}`;
    return mk(world, e, nextEventSeq, "major_event", headline, d.leaderNpcId, d.targetNpcId ? [d.targetNpcId] : []);
  }

  // Kill-like actions
  if (e.kind === "attempt.recorded") {
    const a: any = (e.data as any)?.attempt;
    const success: boolean | undefined = (e.data as any)?.success;
    if (!a?.kind || !a?.actorId) return undefined;
    if (success === false) return undefined;

    const kind = String(a.kind) as string;
    if (kind === "kill") {
      const victimId = a.targetId;
      const killerName = world.npcs[a.actorId]?.name ?? a.actorId;
      const victimName = victimId ? world.npcs[victimId]?.name ?? victimId : "someone";
      return mk(world, e, nextEventSeq, "murder", `${killerName} killed ${victimName}`, a.actorId, victimId ? [victimId] : []);
    }
    if (kind === "kidnap") {
      const targetId = a.targetId;
      const actorName = world.npcs[a.actorId]?.name ?? a.actorId;
      const targetName = targetId ? world.npcs[targetId]?.name ?? targetId : "someone";
      return mk(world, e, nextEventSeq, "kidnap", `${actorName} kidnapped ${targetName}`, a.actorId, targetId ? [targetId] : []);
    }
    if (kind === "raid") {
      const actorName = world.npcs[a.actorId]?.name ?? a.actorId;
      const siteName = e.siteId ? world.sites[e.siteId as any]?.name ?? e.siteId : "a site";
      return mk(world, e, nextEventSeq, "raid", `${actorName} raided ${siteName}`, a.actorId, []);
    }
    if (kind === "forced_eclipse") {
      const actorName = world.npcs[a.actorId]?.name ?? a.actorId;
      return mk(world, e, nextEventSeq, "forced_eclipse", `${actorName} performed a forced eclipse ritual`, a.actorId, []);
    }
  }

  // Death events (starvation/illness/etc)
  if (e.kind === "npc.died") {
    const npcId = String((e.data as any)?.npcId ?? "");
    const name = npcId ? world.npcs[npcId]?.name ?? npcId : "Someone";
    const cause = String((e.data as any)?.cause ?? "unknown");
    return mk(world, e, nextEventSeq, "death", `${name} died (${cause})`, npcId || undefined, []);
  }

  return undefined;
}

function mk(
  world: WorldState,
  sourceEvent: SimEvent,
  nextEventSeq: () => number,
  kind: ChronicleEntryKind,
  headline: string,
  primaryNpcId?: string,
  otherNpcIds?: string[]
): { beat: StoryBeat; entry: ChronicleEntry } {
  const id = makeId("chr", world.tick, nextEventSeq());
  const beat: StoryBeat = {
    id: `beat:${id}`,
    tick: world.tick,
    kind,
    siteId: sourceEvent.siteId,
    primaryNpcId: primaryNpcId as any,
    description: headline,
    sourceEventId: sourceEvent.id
  };
  const entry: ChronicleEntry = {
    id,
    tick: world.tick,
    kind,
    significance: kind === "murder" || kind === "forced_eclipse" ? "major" : "notable",
    siteId: sourceEvent.siteId,
    headline,
    description: sourceEvent.message || headline,
    primaryNpcId: primaryNpcId as any,
    otherNpcIds: otherNpcIds as any,
    sourceEventId: sourceEvent.id
  };
  return { beat, entry };
}

function opArcId(operationId: string): string {
  return `arc:op:${operationId}`;
}

function findArc(arcs: NarrativeArc[], id: string): NarrativeArc | undefined {
  return arcs.find((a) => a.id === id);
}

function mkActs(): NarrativeAct[] {
  return [{ name: "Planning" }, { name: "Execution" }, { name: "Outcome" }];
}

function applyArcsFromEvent(world: WorldState, arcs: NarrativeArc[], e: SimEvent): boolean {
  if (
    e.kind !== "faction.operation.created" &&
    e.kind !== "faction.operation.phase" &&
    e.kind !== "faction.operation.completed" &&
    e.kind !== "faction.operation.aborted"
  ) {
    return false;
  }

  const d: any = e.data ?? {};
  const operationId = String(d.operationId ?? "");
  if (!operationId) return false;

  const id = opArcId(operationId);
  const existing = findArc(arcs, id);
  const siteName = e.siteId ? (world.sites[e.siteId as any]?.name ?? e.siteId) : "a site";
  const factionId = String(d.factionId ?? "faction");
  const type = String(d.type ?? "op");

  if (!existing && e.kind === "faction.operation.created") {
    const arc: NarrativeArc = {
      id,
      kind: "operation",
      title: `${factionId}:${type} @ ${siteName}`,
      status: "developing",
      startTick: world.tick,
      siteId: e.siteId,
      factionId: d.factionId,
      operationId,
      acts: mkActs(),
      actIndex: 0
    };
    arc.acts[0]!.startedTick = world.tick;
    arcs.push(arc);
    return true;
  }

  const arc = existing;
  if (!arc) return false;

  if (e.kind === "faction.operation.phase") {
    if (arc.actIndex < 1) {
      arc.acts[0]!.endedTick = arc.acts[0]!.endedTick ?? world.tick;
      arc.acts[1]!.startedTick = arc.acts[1]!.startedTick ?? world.tick;
      arc.actIndex = 1;
      arc.status = "climax";
      return true;
    }
    return false;
  }

  if (e.kind === "faction.operation.completed") {
    arc.acts[1]!.endedTick = arc.acts[1]!.endedTick ?? world.tick;
    arc.acts[2]!.startedTick = arc.acts[2]!.startedTick ?? world.tick;
    arc.acts[2]!.endedTick = arc.acts[2]!.endedTick ?? world.tick;
    arc.actIndex = 2;
    arc.status = "concluded";
    arc.endTick = world.tick;
    return true;
  }

  if (e.kind === "faction.operation.aborted") {
    arc.acts[1]!.endedTick = arc.acts[1]!.endedTick ?? world.tick;
    arc.acts[2]!.startedTick = arc.acts[2]!.startedTick ?? world.tick;
    arc.acts[2]!.endedTick = arc.acts[2]!.endedTick ?? world.tick;
    arc.actIndex = 2;
    arc.status = "abandoned";
    arc.endTick = world.tick;
    return true;
  }

  return false;
}


