import type { SimEvent, WorldState } from "../../lib/protocol";

export type EventCategory =
  | "attempt"
  | "world"
  | "combat"
  | "social"
  | "mind"
  | "economy"
  | "faction"
  | "narrative"
  | "system"
  | "other";

export type AttemptLike = {
  id?: string;
  actorId?: string;
  targetId?: string;
  kind?: string;
  intentMagnitude?: "minor" | "normal" | "major";
  why?: { text?: string };
};

export function getAttempt(e: SimEvent): AttemptLike | undefined {
  if (
    e.kind !== "attempt.recorded" &&
    e.kind !== "attempt.started" &&
    e.kind !== "attempt.completed" &&
    e.kind !== "attempt.aborted" &&
    e.kind !== "attempt.interrupted"
  )
    return undefined;
  const d: any = e.data ?? {};
  const a = d.attempt;
  if (!a || typeof a !== "object") return undefined;
  return a as AttemptLike;
}

export function getAttemptId(e: SimEvent): string | undefined {
  return getAttempt(e)?.id;
}

export function getRootAttemptId(e: SimEvent): string | undefined {
  if (e.kind === "opportunity.created" || e.kind === "opportunity.responded") {
    const d: any = e.data ?? {};
    return typeof d.rootAttemptId === "string" ? d.rootAttemptId : undefined;
  }
  return getAttemptId(e);
}

export function getResponseAttempt(e: SimEvent): AttemptLike | undefined {
  if (e.kind !== "opportunity.responded") return undefined;
  const d: any = e.data ?? {};
  const a = d.responseAttempt;
  if (!a || typeof a !== "object") return undefined;
  return a as AttemptLike;
}

export function getActorId(e: SimEvent): string | undefined {
  return getAttempt(e)?.actorId;
}

export function getTargetId(e: SimEvent): string | undefined {
  return getAttempt(e)?.targetId;
}

export function getAttemptKind(e: SimEvent): string | undefined {
  return getAttempt(e)?.kind;
}

export function getPrimaryActorId(e: SimEvent): string | undefined {
  // Prefer attempt actor.
  const a = getAttempt(e);
  if (a?.actorId) return a.actorId;

  // Opportunity response attempt actor.
  const ra = getResponseAttempt(e);
  if (ra?.actorId) return ra.actorId;

  // Intent signals carry actorId in data.
  if (e.kind === "intent.signaled") {
    const d: any = e.data ?? {};
    if (typeof d.actorId === "string") return d.actorId;
  }

  // Some world/local events carry npcId.
  const d: any = e.data ?? {};
  if (typeof d.npcId === "string") return d.npcId;
  return undefined;
}

export function isMajorEvent(e: SimEvent): boolean {
  if (e.kind === "npc.died" || e.kind === "world.incident" || e.kind === "travel.encounter") return true;
  if (e.kind === "chronicle.entry" || e.kind === "story.beat.detected") return true;
  if (e.kind === "faction.operation.started" || e.kind === "faction.operation.completed" || e.kind === "faction.operation.failed") return true;
  const a = getAttempt(e);
  if (a?.intentMagnitude === "major") return true;
  return false;
}

export function eventCategory(kind: string): EventCategory {
  // Most kinds are dot-separated; we keep this robust to unknown kinds.
  if (kind.startsWith("attempt.")) return "attempt";
  if (kind.startsWith("sim.")) return "system";

  if (kind.startsWith("world.") || kind.startsWith("travel.") || kind.startsWith("local.")) return "world";
  if (kind === "npc.died") return "world";

  if (kind.startsWith("entity.memory.") || kind.startsWith("entity.emotion.") || kind.startsWith("entity.goal.") || kind.startsWith("entity.plan.")) return "mind";
  if (kind.startsWith("entity.relationship.") || kind.startsWith("entity.debt.") || kind.startsWith("intent.")) return "social";
  if (kind.startsWith("entity.knowledge.") || kind.startsWith("entity.secret.") || kind.startsWith("entity.rumor.")) return "mind";
  if (kind.startsWith("entity.trade.") || kind.startsWith("entity.inventory.") || kind.startsWith("entity.wealth.")) return "economy";

  if (kind.startsWith("faction.")) return "faction";

  if (kind.startsWith("chronicle.") || kind.startsWith("narrative.") || kind.startsWith("story.")) return "narrative";

  // Heuristic: common violent event kinds (v1) often appear as attempt kinds rather than event kinds,
  // so "combat" remains mostly for future explicit combat event kinds.
  return "other";
}

export function countBy<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) out[x] = (out[x] ?? 0) + 1;
  return out;
}

export function topN(obj: Record<string, number>, n: number): Array<{ key: string; value: number }> {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

export type FactionMembership = {
  humans: Set<string>;
  elves: Set<string>;
  cult: Set<string>;
};

const elvenExtras = new Set(["Threadwarden", "AnchorMage", "ContinuumScholar", "SilentExile"]);

export function isElvenCategory(category: string): boolean {
  return category.startsWith("Elven") || elvenExtras.has(category);
}

export function factionMembershipFromWorld(world: WorldState): FactionMembership {
  const humans = new Set<string>();
  const elves = new Set<string>();
  const cult = new Set<string>();

  for (const n of Object.values(world.npcs)) {
    if (isElvenCategory(n.category)) elves.add(n.id);
    else humans.add(n.id);
    if (n.cult?.member) cult.add(n.id);
  }

  return { humans, elves, cult };
}

export function eventActorCounts(events: SimEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const actorId = getActorId(e);
    if (!actorId) continue;
    out[actorId] = (out[actorId] ?? 0) + 1;
  }
  return out;
}

export function eventAttemptKindCounts(events: SimEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = getAttemptKind(e);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function factionActorCounts(events: SimEvent[], membership: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const actorId = getActorId(e);
    if (!actorId) continue;
    if (!membership.has(actorId)) continue;
    out[actorId] = (out[actorId] ?? 0) + 1;
  }
  return out;
}


