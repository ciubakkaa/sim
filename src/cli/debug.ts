/**
 * Debug CLI commands for SimEngine v2
 * Provides tools for inspecting entities, narratives, operations, etc.
 */

import fs from "node:fs";
import readline from "node:readline";

// =============================================================================
// DEBUG ENTITY
// =============================================================================

/**
 * Show detailed entity state from a log file
 */
export async function debugEntity(filePath: string, entityId: string, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 50;
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let entityName: string | null = null;
  const memories: any[] = [];
  const goals: any[] = [];
  const plans: any[] = [];
  const relationships: Map<string, any> = new Map();
  const stateChanges: any[] = [];
  let lastKnownState: any = null;

  for await (const line of rl) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const data = e.data ?? {};

    // Track entity name
    if (data.attempt?.actorId === entityId && data.attempt?.actorName) {
      entityName = data.attempt.actorName;
    }

    // Memory events
    if (e.kind === "entity.memory.formed" && data.entityId === entityId) {
      memories.push({
        tick: e.tick,
        eventType: data.memory?.eventType,
        description: data.memory?.description,
        vividness: data.memory?.vividness,
        importance: data.memory?.importance,
        participants: data.memory?.participants,
      });
    }

    // Goal events
    if (e.kind?.startsWith("entity.goal.") && data.entityId === entityId) {
      goals.push({
        tick: e.tick,
        kind: e.kind.replace("entity.goal.", ""),
        goalType: data.goal?.type,
        goalId: data.goal?.id,
        target: data.goal?.target,
        why: data.goal?.why,
        status: data.goal?.status,
      });
    }

    // Plan events
    if (e.kind?.startsWith("entity.plan.") && data.entityId === entityId) {
      plans.push({
        tick: e.tick,
        kind: e.kind.replace("entity.plan.", ""),
        planId: data.plan?.id,
        goalId: data.plan?.goalId,
        status: data.plan?.status,
        steps: data.plan?.steps?.map((s: any) => s.actionType),
        stepIndex: data.stepIndex,
      });
    }

    // Relationship events
    if (e.kind?.startsWith("entity.relationship.") && data.entityId === entityId) {
      const targetId = data.targetId;
      relationships.set(targetId, {
        ...relationships.get(targetId),
        targetId,
        lastChange: {
          tick: e.tick,
          ...data.change,
        },
        ...data.relationship,
      });
    }

    // Actions involving this entity
    if (data.attempt?.actorId === entityId || data.attempt?.targetId === entityId) {
      stateChanges.push({
        tick: e.tick,
        kind: e.kind,
        role: data.attempt?.actorId === entityId ? "actor" : "target",
        actionKind: data.attempt?.kind,
        why: data.attempt?.why?.text,
        outcome: data.attempt?.outcome,
      });
    }
  }

  // Output
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`DEBUG ENTITY: ${entityId}${entityName ? ` (${entityName})` : ""}`);
  console.log(`File: ${filePath}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Memories
  console.log(`MEMORIES (${memories.length} total, showing last ${Math.min(limit, memories.length)}):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (memories.length === 0) {
    console.log("  (no memories recorded)");
  } else {
    for (const m of memories.slice(-limit)) {
      console.log(`  [t${m.tick}] ${m.eventType}: ${m.description}`);
      console.log(`          vividness=${m.vividness} importance=${m.importance}`);
      if (m.participants?.length) {
        console.log(`          participants: ${m.participants.map((p: any) => `${p.name}(${p.role})`).join(", ")}`);
      }
    }
  }

  // Goals
  console.log(`\nGOALS (${goals.length} events):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (goals.length === 0) {
    console.log("  (no goal events)");
  } else {
    for (const g of goals.slice(-limit)) {
      console.log(`  [t${g.tick}] ${g.kind}: ${g.goalType}${g.target ? ` → ${JSON.stringify(g.target)}` : ""}`);
      if (g.why) console.log(`          why: ${g.why}`);
    }
  }

  // Plans
  console.log(`\nPLANS (${plans.length} events):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (plans.length === 0) {
    console.log("  (no plan events)");
  } else {
    for (const p of plans.slice(-limit)) {
      console.log(`  [t${p.tick}] ${p.kind}: plan=${p.planId} goal=${p.goalId}`);
      if (p.steps) console.log(`          steps: ${p.steps.join(" → ")}`);
      if (p.stepIndex !== undefined) console.log(`          stepIndex=${p.stepIndex}`);
    }
  }

  // Relationships
  console.log(`\nRELATIONSHIPS (${relationships.size} tracked):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (relationships.size === 0) {
    console.log("  (no relationships tracked)");
  } else {
    for (const [targetId, rel] of relationships) {
      console.log(`  ${targetId}:`);
      const parts: string[] = [];
      for (const k of ["trust", "respect", "fear", "loyalty", "affinity"] as const) {
        if (rel[k] !== undefined) parts.push(`${k}=${rel[k]}`);
      }
      if (parts.length) console.log(`    ${parts.join(" ")}`);
      if (rel.lastChange) {
        console.log(`    last change [t${rel.lastChange.tick}]: ${rel.lastChange.dimension} ${rel.lastChange.oldValue}→${rel.lastChange.newValue} (${rel.lastChange.reason})`);
      }
    }
  }

  // Recent actions
  console.log(`\nACTIONS (last ${Math.min(limit, stateChanges.length)} of ${stateChanges.length}):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (stateChanges.length === 0) {
    console.log("  (no actions recorded)");
  } else {
    for (const a of stateChanges.slice(-limit)) {
      console.log(`  [t${a.tick}] ${a.actionKind} (${a.role}) - ${a.why ?? "no reason"}`);
      if (a.outcome) console.log(`          outcome: ${a.outcome}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════\n`);
}

// =============================================================================
// DEBUG NARRATIVE
// =============================================================================

/**
 * Show narrative progression from a log file
 */
export async function debugNarrative(filePath: string, narrativeId?: string) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const narratives: Map<string, any> = new Map();
  const chronicleEntries: any[] = [];
  const storyBeats: any[] = [];

  for await (const line of rl) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const data = e.data ?? {};

    // Narrative events
    if (e.kind === "narrative.started" && data.narrative) {
      narratives.set(data.narrative.id, {
        ...data.narrative,
        events: [{ tick: e.tick, type: "started" }],
      });
    }

    if (e.kind === "narrative.advanced" && data.narrativeId) {
      const n = narratives.get(data.narrativeId);
      if (n) {
        n.events.push({ tick: e.tick, type: "advanced", actIndex: data.actIndex });
        n.status = "advancing";
      }
    }

    if (e.kind === "narrative.climax" && data.narrativeId) {
      const n = narratives.get(data.narrativeId);
      if (n) {
        n.events.push({ tick: e.tick, type: "climax" });
        n.status = "climax";
      }
    }

    if (e.kind === "narrative.concluded" && data.narrativeId) {
      const n = narratives.get(data.narrativeId);
      if (n) {
        n.events.push({ tick: e.tick, type: "concluded", reason: data.reason });
        n.status = "concluded";
      }
    }

    // Chronicle entries
    if (e.kind === "chronicle.entry" && data.chronicleEntry) {
      chronicleEntries.push({
        tick: e.tick,
        ...data.chronicleEntry,
      });
    }

    // Story beats
    if (e.kind === "story.beat.detected" && data.storyBeat) {
      storyBeats.push({
        tick: e.tick,
        ...data.storyBeat,
      });
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`DEBUG NARRATIVE${narrativeId ? `: ${narrativeId}` : "S"}`);
  console.log(`File: ${filePath}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // List narratives
  console.log(`NARRATIVES (${narratives.size} total):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (narratives.size === 0) {
    console.log("  (no narratives detected)");
  } else {
    for (const [id, n] of narratives) {
      if (narrativeId && id !== narrativeId) continue;
      console.log(`\n  ${n.type}: "${n.title}" [${n.status ?? "unknown"}]`);
      console.log(`    ID: ${id}`);
      console.log(`    Protagonists: ${n.protagonistIds?.join(", ") ?? "none"}`);
      console.log(`    Antagonists: ${n.antagonistIds?.join(", ") ?? "none"}`);
      console.log(`    Tension: ${n.tension ?? 0}/100 (peak: ${n.peakTension ?? 0})`);
      console.log(`    Events:`);
      for (const ev of n.events) {
        console.log(`      [t${ev.tick}] ${ev.type}${ev.actIndex !== undefined ? ` (act ${ev.actIndex})` : ""}${ev.reason ? ` - ${ev.reason}` : ""}`);
      }
    }
  }

  // Chronicle entries
  console.log(`\n\nCHRONICLE ENTRIES (${chronicleEntries.length} total):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (chronicleEntries.length === 0) {
    console.log("  (no chronicle entries)");
  } else {
    for (const c of chronicleEntries.slice(-20)) {
      console.log(`  [t${c.tick}] ${c.type} (${c.significance}): ${c.headline}`);
      console.log(`          ${c.description}`);
    }
  }

  // Story beats
  console.log(`\n\nSTORY BEATS (${storyBeats.length} total):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (storyBeats.length === 0) {
    console.log("  (no story beats detected)");
  } else {
    for (const b of storyBeats.slice(-30)) {
      console.log(`  [t${b.tick}] ${b.type} (${b.significance}): ${b.description}`);
      if (b.narrativePotential?.startsNarrative) {
        console.log(`          → Could start: ${b.narrativePotential.narrativeType}`);
      }
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════\n`);
}

// =============================================================================
// DEBUG OPERATIONS
// =============================================================================

/**
 * Show faction operations from a log file
 */
export async function debugOperations(filePath: string, factionId?: string) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const operations: Map<string, any> = new Map();
  const factionDecisions: any[] = [];
  const attempts: { tick: number; siteId?: string; actorId?: string; targetId?: string; kind?: string }[] = [];

  for await (const line of rl) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const data = e.data ?? {};

    if (factionId && data.factionId !== factionId) continue;

    // Operation events (v2 logs emit lightweight data payloads, not full operation objects)
    const operationId = data.operationId ?? data.operation?.id;
    if (
      (e.kind === "faction.operation.created" ||
        e.kind === "faction.operation.phase" ||
        e.kind === "faction.operation.completed" ||
        e.kind === "faction.operation.aborted") &&
      operationId
    ) {
      const id = String(operationId);
      const op = operations.get(id) ?? { id, events: [] as any[] };
      if (data.factionId) op.factionId = data.factionId;
      if (data.type) op.type = data.type;
      if (data.siteId) op.siteId = data.siteId;
      if (data.targetNpcId) op.targetNpcId = data.targetNpcId;

      if (e.kind === "faction.operation.created") {
        op.events.push({ tick: e.tick, type: "created" });
        op.createdTick = e.tick;
        op.status = op.status ?? "planning";
      }
      if (e.kind === "faction.operation.phase") {
        op.events.push({ tick: e.tick, type: "phase", phaseIndex: data.phaseIndex });
        op.status = "active";
      }
      if (e.kind === "faction.operation.completed") {
        op.events.push({ tick: e.tick, type: "completed", outcome: data.outcome });
        op.status = "completed";
      }
      if (e.kind === "faction.operation.aborted") {
        op.events.push({ tick: e.tick, type: "aborted", outcome: data.outcome });
        op.status = "aborted";
      }
      operations.set(id, op);
    }

    // Faction decisions
    if (e.kind === "faction.decision") {
      factionDecisions.push({
        tick: e.tick,
        factionId: data.factionId,
        type: data.type,
        details: data.details,
      });
    }

    // Attempts (for correlating likely participants during op phases)
    if (e.kind === "attempt.recorded") {
      const a: any = data.attempt;
      attempts.push({
        tick: e.tick,
        siteId: a?.siteId ?? e.siteId,
        actorId: a?.actorId,
        targetId: a?.targetId,
        kind: a?.kind
      });
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`DEBUG OPERATIONS${factionId ? ` for ${factionId}` : ""}`);
  console.log(`File: ${filePath}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Operations
  console.log(`OPERATIONS (${operations.size} total):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (operations.size === 0) {
    console.log("  (no operations recorded)");
  } else {
    const phaseKindsForOp = (opType: string | undefined) => {
      if (!opType) return [] as string[];
      // Current sim defines cult multi-phase kidnap -> forced_eclipse
      if (opType === "kidnap") return ["kidnap", "forced_eclipse"];
      if (opType === "forced_eclipse") return ["forced_eclipse"];
      return [opType];
    };

    const listLikelyActors = (fromTick: number, toTick: number, siteId: string | undefined, kinds: string[]) => {
      const filtered = attempts.filter((a) => a.tick >= fromTick && a.tick < toTick && (!siteId || a.siteId === siteId) && kinds.includes(String(a.kind)));
      const set = new Set<string>();
      for (const a of filtered) if (a.actorId) set.add(String(a.actorId));
      return { count: filtered.length, actors: Array.from(set).sort().slice(0, 8) };
    };

    for (const [id, op] of operations) {
      console.log(`\n  ${String(op.factionId ?? "?")}:${String(op.type ?? "?")} [${op.status ?? "unknown"}]`);
      console.log(`    ID: ${id}`);
      if (op.siteId) console.log(`    Site: ${op.siteId}`);
      if (op.targetNpcId) console.log(`    Target NPC: ${op.targetNpcId}`);
      console.log(`    Events:`);
      const evs = (op.events ?? []).slice().sort((a: any, b: any) => (a.tick ?? 0) - (b.tick ?? 0));
      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i];
        let extra = "";
        if (ev.phaseIndex !== undefined) extra = ` → phase ${Number(ev.phaseIndex) + 1}`;
        if (ev.outcome) extra = ` → ${ev.outcome}`;
        if (ev.reason) extra = ` → ${ev.reason}`;
        console.log(`      [t${ev.tick}] ${ev.type}${extra}`);

        // For phase events, attempt to correlate likely participants (best-effort from attempt.recorded)
        if (ev.type === "phase") {
          const from = Number(ev.tick ?? 0);
          const to = Number(evs[i + 1]?.tick ?? from + 72); // default: 3 days window if no next event
          const phaseIndex = Number(ev.phaseIndex ?? 0);
          const kinds = phaseKindsForOp(String(op.type ?? ""));
          const phaseKind = kinds[phaseIndex] ?? kinds[0];
          if (phaseKind) {
            const { count, actors } = listLikelyActors(from, to, op.siteId ? String(op.siteId) : undefined, [phaseKind]);
            if (count) {
              console.log(`        likely actors for "${phaseKind}": ${count} attempts by ${actors.length ? actors.join(", ") : "(unknown)"}`);
            }
          }
        }
      }
    }
  }

  // Decisions
  console.log(`\n\nFACTION DECISIONS (${factionDecisions.length} total):`);
  console.log(`───────────────────────────────────────────────────────────────`);
  if (factionDecisions.length === 0) {
    console.log("  (no decisions recorded)");
  } else {
    for (const d of factionDecisions.slice(-20)) {
      console.log(`  [t${d.tick}] ${d.factionId}: ${d.type}`);
      if (d.details) console.log(`          ${JSON.stringify(d.details)}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════\n`);
}

// =============================================================================
// VALIDATE WORLD
// =============================================================================

/**
 * Validate a world snapshot for consistency
 */
export async function validateWorld(snapshotPath: string) {
  let snapshot: any;
  try {
    const content = fs.readFileSync(snapshotPath, "utf8");
    snapshot = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read snapshot: ${err}`);
    return;
  }

  const world = snapshot.world ?? snapshot.worldV2 ?? snapshot;
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`VALIDATE WORLD`);
  console.log(`File: ${snapshotPath}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Basic structure
  if (!world.tick && world.tick !== 0) errors.push("Missing tick");
  if (!world.seed && world.seed !== 0) errors.push("Missing seed");

  // Entities
  const entities = world.entities ?? world.npcs ?? {};
  const entityCount = Object.keys(entities).length;
  console.log(`Entities: ${entityCount}`);

  for (const [id, entity] of Object.entries(entities)) {
    const e = entity as any;
    if (!e.id) errors.push(`Entity ${id}: missing id`);
    if (!e.name) warnings.push(`Entity ${id}: missing name`);
    if (e.hp !== undefined && e.hp < 0) errors.push(`Entity ${id}: negative HP (${e.hp})`);
    if (e.hp !== undefined && e.maxHp !== undefined && e.hp > e.maxHp) {
      warnings.push(`Entity ${id}: HP exceeds maxHP (${e.hp}/${e.maxHp})`);
    }
    if (e.alive === false && !e.death) {
      warnings.push(`Entity ${id}: dead but no death record`);
    }
  }

  // Sites
  const sites = world.sites ?? {};
  const siteCount = Object.keys(sites).length;
  console.log(`Sites: ${siteCount}`);

  for (const [id, site] of Object.entries(sites)) {
    const s = site as any;
    if (!s.id && !s.name) warnings.push(`Site ${id}: missing id and name`);
    if (s.unrest !== undefined && (s.unrest < 0 || s.unrest > 100)) {
      warnings.push(`Site ${id}: unrest out of range (${s.unrest})`);
    }
  }

  // Factions
  const factions = world.factions ?? {};
  const factionCount = Object.keys(factions).length;
  console.log(`Factions: ${factionCount}`);

  // Results
  console.log(`\nValidation Results:`);
  console.log(`───────────────────────────────────────────────────────────────`);
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✓ No issues found`);
  } else {
    if (errors.length > 0) {
      console.log(`\nERRORS (${errors.length}):`);
      for (const e of errors) console.log(`  ✗ ${e}`);
    }
    if (warnings.length > 0) {
      console.log(`\nWARNINGS (${warnings.length}):`);
      for (const w of warnings) console.log(`  ⚠ ${w}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════\n`);
}

