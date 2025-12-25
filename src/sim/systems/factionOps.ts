/**
 * Minimal faction operations planner (v2, opt-in via useFactionOperations)
 *
 * For now, only models CULT operations in a deterministic, low-impact way:
 * - If a cult cell leader exists at a site with enough cult members and a viable target,
 *   create an operation that biases cult members toward kidnap or forced_eclipse.
 */

import type { AttemptKind, FactionOperation, NpcId, NpcState, OperationPhase, SiteId, SimEvent, WorldState } from "../types";
import { makeId } from "../ids";
import { getConfig } from "../config";
import { isNpcTraveling } from "../movement";
// NOTE: we don't reuse isDetained() because it includes other statuses and we only want active detention by tick.

function isCultMember(n: NpcState): boolean {
  return Boolean(n.cult?.member);
}

function isDetainedNow(n: NpcState, tick: number): boolean {
  const until = n.status?.detained?.untilTick;
  return typeof until === "number" && until > tick;
}

export function updateFactionOperations(world: WorldState, nextEventSeq: () => number): WorldState {
  return updateFactionOperationsWithEvents(world, nextEventSeq).world;
}

export function updateFactionOperationsWithEvents(
  world: WorldState,
  nextEventSeq: () => number
): { world: WorldState; events: SimEvent[] } {
  // Keep existing registry
  const ops: Record<string, FactionOperation> = { ...(world.operations ?? {}) };
  const events: SimEvent[] = [];

  // Deterministic per-site scan
  const siteIds = Object.keys(world.sites).sort();
  for (const siteId of siteIds) {
    const created = maybeCreateCultOperationAtSite(world, siteId as SiteId, nextEventSeq);
    if (!created) continue;
    ops[created.id] = created;
    events.push({
      id: makeId("evt", world.tick, nextEventSeq()),
      tick: world.tick,
      kind: "faction.operation.created",
      visibility: "system",
      siteId: created.siteId,
      message: `Operation created: ${created.factionId}:${created.type}`,
      data: { operationId: created.id, factionId: created.factionId, type: created.type, siteId: created.siteId, targetNpcId: created.targetNpcId }
    });
  }

  const nextWorld = { ...world, operations: ops };
  return { world: nextWorld, events };
}

function hasActiveCultOpAtSite(world: WorldState, siteId: SiteId): boolean {
  const ops = world.operations;
  if (!ops) return false;
  return Object.values(ops).some((o) => o.factionId === "cult" && o.siteId === siteId && (o.status === "planning" || o.status === "active"));
}

function maybeCreateCultOperationAtSite(world: WorldState, siteId: SiteId, nextEventSeq: () => number): FactionOperation | undefined {
  // Only one active cult op per site for now.
  if (hasActiveCultOpAtSite(world, siteId)) return undefined;

  const site: any = world.sites[siteId];
  const isSettlement = site?.kind === "settlement";
  if (!isSettlement) return undefined;

  // Need pressure to act.
  const enoughPressure = (site.eclipsingPressure ?? 0) >= 55 && (site.anchoringStrength ?? 0) <= 60;
  if (!enoughPressure) return undefined;

  const npcsHere = Object.values(world.npcs)
    .filter((n) => n.alive && n.siteId === siteId && !isNpcTraveling(n) && !isDetainedNow(n, world.tick))
    .sort((a, b) => a.id.localeCompare(b.id));

  const leaders = npcsHere.filter((n) => n.cult?.role === "cell_leader");
  const leader = leaders[0];
  if (!leader) return undefined;

  const cultHere = npcsHere.filter(isCultMember);
  if (cultHere.length < 2) return undefined; // need a team

  // Prefer forced_eclipse if there's a detained non-cult target, else kidnap.
  const detainedTargets = npcsHere.filter((n) => !isCultMember(n) && isDetainedNow(n, world.tick));
  const freeTargets = npcsHere.filter((n) => !isCultMember(n) && !n.status?.detained);

  if (detainedTargets.length) {
    const t = detainedTargets[0]!;
    return {
      id: makeId("op", world.tick, nextEventSeq()),
      factionId: "cult",
      type: "forced_eclipse",
      siteId,
      targetNpcId: t.id,
      leaderNpcId: leader.id,
      participantNpcIds: cultHere.map((n) => n.id),
      createdTick: world.tick,
      status: "planning",
      executeAfterTick: world.tick + 1,
      note: "cult_op:forced_eclipse",
      phases: [{ kind: "forced_eclipse", note: "ritual" }],
      phaseIndex: 0,
      lastProgressTick: world.tick
    };
  }

  if (freeTargets.length) {
    const t = freeTargets[0]!;
    const roles: Partial<Record<NpcId, "leader" | "enforcer" | "scout" | "lookout">> = {};
    for (const n of cultHere) {
      if (n.id === leader.id) roles[n.id] = "leader";
      else if (n.category === "ConcordEnforcer") roles[n.id] = "enforcer";
      else if ((n.traits.Curiosity ?? 0) >= 60) roles[n.id] = "scout";
      else roles[n.id] = "lookout";
    }
    return {
      id: makeId("op", world.tick, nextEventSeq()),
      factionId: "cult",
      type: "kidnap",
      siteId,
      targetNpcId: t.id,
      leaderNpcId: leader.id,
      participantNpcIds: cultHere.map((n) => n.id),
      participantRoles: roles,
      createdTick: world.tick,
      status: "planning",
      executeAfterTick: world.tick + 1,
      note: "cult_op:kidnap",
      phases: [
        { kind: "recon", note: "scout_routes_and_patrols" },
        { kind: "kidnap", note: "capture_target" },
        { kind: "forced_eclipse", note: "followup_ritual" }
      ],
      phaseIndex: 0,
      lastProgressTick: world.tick
    };
  }

  return undefined;
}

export function operationWeightModifiersForNpc(npc: NpcState, world: WorldState) {
  const ops = world.operations;
  if (!ops) return [];

  // Choose the newest relevant op for this NPC.
  const relevant = Object.values(ops)
    .filter((o) => o.status === "planning" || o.status === "active")
    .filter((o) => o.participantNpcIds.includes(npc.id))
    .sort((a, b) => b.createdTick - a.createdTick || a.id.localeCompare(b.id));

  const op = relevant[0];
  if (!op) return [];

  // Basic: bias action kind.
  const phases = op.phases ?? ([{ kind: op.type as any }] as OperationPhase[]);
  const phaseIndex = op.phaseIndex ?? 0;
  const phase = phases[phaseIndex] ?? phases[0];
  const actionKind = (phase?.kind ?? op.type) as AttemptKind;
  return [{ goalId: `op:${op.id}:${op.type}:${phaseIndex}`, actionKind: actionKind as any, weightDelta: 70 }];
}

export function applyOperationProgressFromEvents(
  world: WorldState,
  events: SimEvent[],
  nextEventSeq: () => number
): { world: WorldState; events: SimEvent[] } {
  const ops = world.operations;
  if (!ops || !Object.keys(ops).length) return { world, events: [] };

  const opEvents: SimEvent[] = [];

  // Group executed attempt.recorded by actor.
  const executedByActor: Record<string, { kind: AttemptKind; targetId?: NpcId; success?: boolean }[]> = {};
  for (const e of events) {
    if (e.kind !== "attempt.recorded") continue;
    const d: any = e.data ?? {};
    if (!Array.isArray(d.consequences)) continue; // filters "busy ignored"
    const a: any = d.attempt;
    if (!a?.actorId || !a?.kind) continue;
    (executedByActor[a.actorId] ??= []).push({ kind: a.kind as AttemptKind, targetId: a.targetId as any, success: d.success });
  }
  const actorIds = Object.keys(executedByActor).sort();
  if (!actorIds.length) return { world, events: [] };

  let changed = false;
  const nextOps: Record<string, FactionOperation> = { ...ops };

  const opIds = Object.keys(ops).sort();
  for (const opId of opIds) {
    const op = ops[opId]!;
    if (op.status !== "planning" && op.status !== "active") continue;

    const phases = op.phases ?? ([{ kind: op.type as any }] as OperationPhase[]);
    const phaseIndex = op.phaseIndex ?? 0;
    const current = phases[phaseIndex] ?? phases[0];
    if (!current) continue;

    // If execution window opened, promote planning->active.
    if (op.status === "planning" && typeof op.executeAfterTick === "number" && world.tick >= op.executeAfterTick) {
      const nextOp: FactionOperation = { ...op, status: "active" };
      nextOps[opId] = nextOp;
      changed = true;
      opEvents.push({
        id: makeId("evt", world.tick, nextEventSeq()),
        tick: world.tick,
        kind: "faction.operation.phase",
        visibility: "system",
        siteId: op.siteId,
        message: `Operation activated: ${op.factionId}:${op.type}`,
        data: { operationId: op.id, factionId: op.factionId, type: op.type, phaseIndex: phaseIndex }
      });
    }

    // Progress on matching executed attempts by participants.
    const participants = new Set(op.participantNpcIds);
    const performed = actorIds
      .filter((aid) => participants.has(aid as any))
      .flatMap((aid) => executedByActor[aid] ?? []);

    const matched = performed.find((p) => p.kind === current.kind && (!op.targetNpcId || !p.targetId || p.targetId === op.targetNpcId));
    if (!matched) continue;

    const success = matched.success !== false;
    if (!success) {
      const failures = (op.failures ?? 0) + 1;
      const nextOp: FactionOperation = { ...op, failures, lastProgressTick: world.tick };
      nextOps[opId] = nextOp;
      changed = true;
      if (failures >= 3) {
        nextOps[opId] = { ...nextOp, status: "aborted" };
        opEvents.push({
          id: makeId("evt", world.tick, nextEventSeq()),
          tick: world.tick,
          kind: "faction.operation.aborted",
          visibility: "system",
          siteId: op.siteId,
          message: `Operation aborted (failures): ${op.factionId}:${op.type}`,
          data: { operationId: op.id, factionId: op.factionId, type: op.type, outcome: "failures" }
        });
      }
      continue;
    }

    const nextPhaseIndex = phaseIndex + 1;
    if (nextPhaseIndex >= phases.length) {
      nextOps[opId] = { ...op, status: "completed", phaseIndex: nextPhaseIndex, lastProgressTick: world.tick };
      changed = true;
      opEvents.push({
        id: makeId("evt", world.tick, nextEventSeq()),
        tick: world.tick,
        kind: "faction.operation.completed",
        visibility: "system",
        siteId: op.siteId,
        message: `Operation completed: ${op.factionId}:${op.type}`,
        data: { operationId: op.id, factionId: op.factionId, type: op.type, outcome: "success" }
      });
    } else {
      nextOps[opId] = { ...op, status: "active", phaseIndex: nextPhaseIndex, lastProgressTick: world.tick };
      changed = true;
      opEvents.push({
        id: makeId("evt", world.tick, nextEventSeq()),
        tick: world.tick,
        kind: "faction.operation.phase",
        visibility: "system",
        siteId: op.siteId,
        message: `Operation advanced: ${op.factionId}:${op.type} phase ${nextPhaseIndex + 1}/${phases.length}`,
        data: { operationId: op.id, factionId: op.factionId, type: op.type, phaseIndex: nextPhaseIndex }
      });
    }
  }

  const nextWorld = changed ? { ...world, operations: nextOps } : world;
  return { world: nextWorld, events: opEvents };
}


