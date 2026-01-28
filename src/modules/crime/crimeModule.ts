/**
 * Crime Module (kernel wrapper): Observation uncertainty and response coordination.
 *
 * Goal (v0):
 * - When a crime attempt is recorded (often private), generate uncertain observations for local witnesses.
 * - Some witnesses report; if the suspect is identified, responders get a strong "chase/arrest" bias.
 * - If suspect is unknown, responders investigate.
 *
 * Notes:
 * - This module is intentionally lightweight and deterministic via TickContext stable RNG.
 * - It does not mutate sim rules; it only emits kernel events and biases decisions.
 */

import type { KernelModule } from "../../kernel/hooks";
import type { DecisionInput, DecisionOutput, EntityId, ScoreModifier, TickContext } from "../../kernel/kernelTypes";
import type { KernelEvent } from "../../kernel/events/eventTypes";
import type { Attempt, NpcState } from "../../sim/types";
import { isNpcTraveling } from "../../sim/movement";
import { stableHashHex } from "../../kernel/hash";

export const CRIME_MODULE_ID = "crime.response";

export interface Observation {
  id: string;
  tick: number;
  observerId: string;
  eventId: string;
  sawEvent: boolean;
  sawFace: boolean;
  confidence: number; // 0..1
  descriptors: {
    height?: "short" | "medium" | "tall";
    cloakColor?: string;
    accent?: string;
    limp?: boolean;
  };
  escapeDirection?: string;
}

type CrimeKind = "steal" | "blackmail" | "assault" | "kill" | "kidnap" | "raid";

const CRIME_ATTEMPT_KINDS: readonly CrimeKind[] = ["steal", "blackmail", "assault", "kill", "kidnap", "raid"];
const CRIME_ATTEMPT_KIND_SET = new Set<string>(CRIME_ATTEMPT_KINDS);

const RESPONDER_CATEGORIES = new Set<string>([
  // Vertical slice
  "GuardMilitia",
  "ScoutRanger",
  "Threadwarden",
  "ConcordEnforcer",
  "ElvenWarriorSentinel",
]);

type PendingResponse = {
  crimeEventId: string;        // the originating attempt.recorded event id
  siteId: string;
  attemptKind: CrimeKind;
  suspectId?: string;          // only if identified by at least one reporter
  reportedTick: number;
  reporterIds: string[];
  observationIds: string[];
};

interface CrimeModuleState {
  pendingResponses: Map<string, PendingResponse>; // keyed by crimeEventId
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function observationIdFor(params: { tick: number; eventId: string; observerId: string }): string {
  return `obs-${stableHashHex([params.tick, params.eventId, params.observerId])}`;
}

function reportIdFor(params: { tick: number; crimeEventId: string; reporterId: string }): string {
  return `rpt-${stableHashHex([params.tick, params.crimeEventId, params.reporterId])}`;
}

function listWitnesses(world: TickContext["world"], siteId: string, actorId?: string): NpcState[] {
  const witnesses = Object.values(world.npcs)
    .filter((n): n is NpcState => Boolean(n && (n as any).alive))
    .filter((n) => !isNpcTraveling(n))
    .filter((n) => n.siteId === siteId)
    .filter((n) => (actorId ? n.id !== actorId : true))
    .sort((a, b) => a.id.localeCompare(b.id));
  return witnesses;
}

function baseReportChance(kind: CrimeKind): number {
  switch (kind) {
    case "steal":
      return 0.45;
    case "blackmail":
      return 0.55;
    case "assault":
      return 0.75;
    case "raid":
      return 0.85;
    case "kidnap":
      return 0.85;
    case "kill":
      return 0.95;
  }
}

function generateObservation(params: {
  ctx: TickContext;
  event: KernelEvent;
  attempt: Attempt;
  witness: NpcState;
  isVictim: boolean;
}): Observation {
  const { ctx, event, attempt, witness, isVictim } = params;
  const siteId = attempt.siteId ?? event.siteId ?? witness.siteId;
  const suspectId = attempt.actorId;

  // Roll IDs are semantic and stable.
  const rollSeen = ctx.rollId({
    tick: ctx.tick,
    siteId,
    agentId: witness.id,
    targetId: suspectId,
    actionKind: attempt.kind,
    purpose: `crime.observe.saw_event:${event.id}`,
  });

  const rollFace = ctx.rollId({
    tick: ctx.tick,
    siteId,
    agentId: witness.id,
    targetId: suspectId,
    actionKind: attempt.kind,
    purpose: `crime.observe.saw_face:${event.id}`,
  });

  const rollConf = ctx.rollId({
    tick: ctx.tick,
    siteId,
    agentId: witness.id,
    targetId: suspectId,
    actionKind: attempt.kind,
    purpose: `crime.observe.confidence:${event.id}`,
  });

  const visibility = attempt.visibility ?? event.visibility;

  // Saw the event: victims always "saw something", public crimes are easy to notice.
  const pSawEvent = isVictim ? 1 : visibility === "public" ? 0.95 : 0.35;
  const sawEvent = ctx.stableChance(rollSeen, pSawEvent);

  // Saw the face: harder for private crimes; victims more likely to identify.
  const pSawFace = !sawEvent ? 0 : isVictim ? 0.85 : visibility === "public" ? 0.65 : 0.25;
  const sawFace = ctx.stableChance(rollFace, pSawFace);

  // Confidence: coarse but deterministic (0.30..0.95), boosted if face was seen.
  const raw = ctx.stableInt(rollConf, 0, 65) / 100; // 0..0.65
  const base = sawFace ? 0.30 : 0.15;
  const confidence = clamp01(base + raw);

  // Lightweight descriptors (purely flavor, but deterministic and reportable).
  const descriptors: Observation["descriptors"] = {};
  let escapeDirection: string | undefined;

  if (sawEvent) {
    const rollDesc = (suffix: string) =>
      ctx.rollId({
        tick: ctx.tick,
        siteId,
        agentId: witness.id,
        targetId: suspectId,
        actionKind: attempt.kind,
        purpose: `crime.observe.${suffix}:${event.id}`,
      });

    const heights: Observation["descriptors"]["height"][] = ["short", "medium", "tall"];
    const cloaks = ["brown", "black", "gray", "green", "red", "blue"];
    const accents = ["local", "foreign", "rough", "refined"];
    const dirs = ["north", "south", "east", "west"];

    descriptors.height = heights[ctx.stableInt(rollDesc("height"), 0, heights.length - 1)];
    descriptors.cloakColor = cloaks[ctx.stableInt(rollDesc("cloak"), 0, cloaks.length - 1)];
    descriptors.accent = accents[ctx.stableInt(rollDesc("accent"), 0, accents.length - 1)];
    descriptors.limp = ctx.stableChance(rollDesc("limp"), 0.12);
    escapeDirection = dirs[ctx.stableInt(rollDesc("escape"), 0, dirs.length - 1)];
  }

  return {
    id: observationIdFor({ tick: ctx.tick, eventId: event.id, observerId: witness.id }),
    tick: ctx.tick,
    observerId: witness.id,
    eventId: event.id,
    sawEvent,
    sawFace,
    confidence,
    descriptors,
    escapeDirection,
  };
}

export function createCrimeModule(): KernelModule {
  const state: CrimeModuleState = {
    pendingResponses: new Map(),
  };

  return {
    id: CRIME_MODULE_ID,

    onTickStart(ctx: TickContext): void {
      // Clean up responses older than 24 hours.
      const cutoff = ctx.tick - 24;
      for (const [crimeEventId, r] of state.pendingResponses) {
        if (r.reportedTick < cutoff) state.pendingResponses.delete(crimeEventId);
      }
    },

    onEvent(ctx: TickContext, event: KernelEvent): void {
      // We key off attempt.recorded emitted by the sim layer.
      if (event.kind !== "attempt.recorded") return;

      const attempt = event.data?.attempt as Attempt | undefined;
      if (!attempt?.kind) return;

      // If an arrest attempt was recorded against a known suspect at this site, consider it resolved.
      if (attempt.kind === "arrest" && attempt.siteId && attempt.targetId) {
        for (const [crimeEventId, r] of state.pendingResponses) {
          if (r.siteId !== attempt.siteId) continue;
          if (!r.suspectId) continue;
          if (r.suspectId !== attempt.targetId) continue;
          state.pendingResponses.delete(crimeEventId);
          ctx.emitEvent({
            kind: "crime.response.resolved",
            tick: ctx.tick,
            siteId: r.siteId,
            actorId: attempt.actorId,
            targetId: r.suspectId,
            visibility: "private",
            message: `Crime response resolved (arrest attempt recorded)`,
            data: { crimeEventId, attemptKind: r.attemptKind, suspectId: r.suspectId },
            purpose: `resolve:${crimeEventId}`,
            causes: { eventIds: [crimeEventId, event.id] },
          });
        }
        return;
      }

      if (!CRIME_ATTEMPT_KIND_SET.has(attempt.kind)) return;
      if (!attempt.siteId && !event.siteId) return;

      const siteId = (attempt.siteId ?? event.siteId)!;
      const suspectId = attempt.actorId;
      const attemptKind = attempt.kind as CrimeKind;

      // Generate observations for witnesses at the site (private crimes need this; public is already handled elsewhere).
      // We still allow this for public attempts, but only open a response if someone reports.
      const witnesses = listWitnesses(ctx.world, siteId, suspectId);
      if (!witnesses.length) return;

      const reporters: string[] = [];
      const observationIds: string[] = [];
      let identifiedSuspectId: string | undefined;

      for (const w of witnesses) {
        const isVictim = Boolean(attempt.targetId && w.id === attempt.targetId);
        const obs = generateObservation({ ctx, event, attempt, witness: w, isVictim });

        if (!obs.sawEvent) continue;

        // Victims always report (v0 simplification) so private theft doesn't disappear.
        const rollReport = ctx.rollId({
          tick: ctx.tick,
          siteId,
          agentId: w.id,
          targetId: suspectId,
          actionKind: attempt.kind,
          purpose: `crime.report.decide:${event.id}`,
        });

        const pReport = isVictim ? 1 : clamp01(baseReportChance(attemptKind) * obs.confidence);
        const willReport = ctx.stableChance(rollReport, pReport);
        if (!willReport) continue;

        const reportId = reportIdFor({ tick: ctx.tick, crimeEventId: event.id, reporterId: w.id });
        reporters.push(w.id);
        observationIds.push(obs.id);

        // If face was seen with high confidence, treat suspect as identified.
        const identifies = Boolean(obs.sawFace && obs.confidence >= 0.7 && suspectId);
        if (identifies && suspectId) identifiedSuspectId = suspectId;

        // Emit observation and report events (private by default; they are informational artifacts).
        ctx.emitEvent({
          kind: "crime.observation.created",
          tick: ctx.tick,
          siteId,
          actorId: obs.observerId,
          targetId: suspectId,
          visibility: "private",
          message: `${w.name} observed a ${attemptKind} (uncertain)`,
          data: {
            observation: obs,
            attemptKind,
            crimeEventId: event.id,
          },
          purpose: obs.id,
          causes: { eventIds: [event.id] },
        });

        ctx.emitEvent({
          kind: "crime.reported",
          tick: ctx.tick,
          siteId,
          actorId: w.id,
          targetId: identifies ? suspectId : undefined,
          visibility: "private",
          message: identifies
            ? `${w.name} reported a ${attemptKind} and identified the suspect`
            : `${w.name} reported a ${attemptKind} but could not identify the suspect`,
          data: {
            reportId,
            attemptKind,
            crimeEventId: event.id,
            observationId: obs.id,
            suspectIdentified: identifies,
          },
          purpose: reportId,
          causes: { eventIds: [event.id], observationIds: [obs.id] },
        });
      }

      if (!reporters.length) return;

      // Open or update a pending response for this crime.
      state.pendingResponses.set(event.id, {
        crimeEventId: event.id,
        siteId,
        attemptKind,
        suspectId: identifiedSuspectId,
        reportedTick: ctx.tick,
        reporterIds: reporters,
        observationIds,
      });

      ctx.emitEvent({
        kind: "crime.response.opened",
        tick: ctx.tick,
        siteId,
        actorId: identifiedSuspectId,
        visibility: "private",
        message: identifiedSuspectId
          ? `Crime response opened for ${attemptKind} (suspect identified)`
          : `Crime response opened for ${attemptKind} (suspect unknown)`,
        data: {
          crimeEventId: event.id,
          attemptKind,
          suspectId: identifiedSuspectId,
          reporterCount: reporters.length,
        },
        purpose: `crime:${event.id}`,
        causes: { eventIds: [event.id], observationIds },
      });
    },

    onAgentDecide(ctx: TickContext, agentId: EntityId, input: DecisionInput): DecisionOutput {
      const npc = ctx.world.npcs[agentId];
      if (!npc || !npc.alive) return input;
      if (!RESPONDER_CATEGORIES.has(npc.category)) return input;

      const local = Array.from(state.pendingResponses.values()).filter((r) => r.siteId === npc.siteId);
      if (!local.length) return input;

      const options = [...input.options];
      const modifiers: ScoreModifier[] = [...input.modifiers];

      for (const r of local) {
        if (r.suspectId) {
          // Chase + arrest are distinct in kernel decision space (chase is an approach, arrest is an outcome).
          options.push({
            actionKind: "chase",
            baseScore: 40,
            targetId: r.suspectId,
            reasons: [`reported ${r.attemptKind}; suspect identified`],
          });
          modifiers.push({
            moduleId: CRIME_MODULE_ID,
            actionKind: "arrest",
            delta: 50,
            reason: `Reported ${r.attemptKind}; suspect identified (${r.suspectId})`,
          });
          modifiers.push({
            moduleId: CRIME_MODULE_ID,
            actionKind: "chase",
            delta: 30,
            reason: `Reported ${r.attemptKind}; pursue suspect`,
          });
        } else {
          options.push({
            actionKind: "investigate",
            baseScore: 25,
            reasons: [`reported ${r.attemptKind}; suspect unknown`],
          });
          modifiers.push({
            moduleId: CRIME_MODULE_ID,
            actionKind: "investigate",
            delta: 30,
            reason: `Reported ${r.attemptKind}; gather leads`,
          });
        }
      }

      return { ...input, options, modifiers };
    },

    onTickEnd(ctx: TickContext): void {
      // If an identified suspect left the site or died, drop the response (suspect fled/removed).
      for (const [crimeEventId, r] of state.pendingResponses) {
        if (!r.suspectId) continue;
        const suspect = ctx.world.npcs[r.suspectId as EntityId];
        if (!suspect || !suspect.alive || suspect.siteId !== r.siteId) {
          state.pendingResponses.delete(crimeEventId);
        }
      }
    },
  };
}

export default createCrimeModule;
