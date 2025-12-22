import type { Attempt, NpcId, NpcState, SimEvent, WorldState } from "./types";
import { clamp } from "./util";

function bumpForAttemptKind(kind: Attempt["kind"], magnitude: Attempt["intentMagnitude"]): number {
  const mag = magnitude === "major" ? 1.3 : magnitude === "minor" ? 0.8 : 1;
  let base = 0;
  switch (kind) {
    case "kill":
      base = 20;
      break;
    case "forced_eclipse":
      base = 18;
      break;
    case "raid":
      base = 15;
      break;
    case "kidnap":
      base = 12;
      break;
    case "assault":
      base = 10;
      break;
    case "anchor_sever":
      base = 10;
      break;
    case "arrest":
      base = 8;
      break;
    case "steal":
      base = 6;
      break;
    case "investigate":
    case "preach_fixed_path":
    case "heal":
      base = 3;
      break;
    case "trade":
      base = 2;
      break;
    default:
      base = 1;
  }
  return Math.round(base * mag);
}

export function applyNotabilityFromEvents(world: WorldState, events: SimEvent[]): WorldState {
  const bumps: Record<NpcId, number> = {};

  for (const e of events) {
    if (e.kind === "attempt.recorded") {
      const a = e.data?.attempt as Attempt | undefined;
      if (!a) continue;
      const b = bumpForAttemptKind(a.kind, a.intentMagnitude);
      bumps[a.actorId] = (bumps[a.actorId] ?? 0) + b;
      if (a.targetId) bumps[a.targetId] = (bumps[a.targetId] ?? 0) + Math.round(b * 0.6);
    }

    if (e.kind === "world.incident") {
      const victimId = e.data?.victimNpcId as string | undefined;
      if (victimId) bumps[victimId] = (bumps[victimId] ?? 0) + 8;
    }
  }

  if (!Object.keys(bumps).length) return world;

  const nextNpcs: Record<string, NpcState> = { ...world.npcs };
  for (const [id, bump] of Object.entries(bumps)) {
    const n = nextNpcs[id];
    if (!n) continue;
    nextNpcs[id] = { ...n, notability: clamp(n.notability + bump, 0, 100) };
  }

  return { ...world, npcs: nextNpcs as any };
}

export function decayNotabilityDaily(world: WorldState): WorldState {
  const nextNpcs: Record<string, NpcState> = { ...world.npcs };
  let changed = false;
  for (const n of Object.values(world.npcs)) {
    const next = n.notability > 0 ? Math.max(0, n.notability - 0.5) : n.notability;
    if (next !== n.notability) {
      nextNpcs[n.id] = { ...n, notability: next };
      changed = true;
    }
  }
  return changed ? { ...world, npcs: nextNpcs as any } : world;
}


