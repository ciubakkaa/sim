/**
 * Secrets system (v2, opt-in via useSecrets)
 *
 * Minimal implementation:
 * - Creates world-level Secret records for certain events
 * - Stores per-NPC secret knowledge (NpcKnowledge.secrets)
 *
 * This intentionally stays lightweight and deterministic.
 */

import type { KnowledgeConfidence, NpcState, Secret, SecretKind, SecretKnowledge, SimEvent, SimTick, WorldState } from "../types";
import { getConfig } from "../config";
import { makeId } from "../ids";

function ensureSecrets(world: WorldState): Record<string, Secret> {
  return world.secrets ?? {};
}

function ensureNpcKnowledge(n: NpcState) {
  return n.knowledge ?? { facts: [], secrets: [] };
}

function addSecretKnowledge(n: NpcState, sk: SecretKnowledge, max = 120): NpcState {
  const k = ensureNpcKnowledge(n);
  const existingIdx = k.secrets.findIndex((x) => x.secretId === sk.secretId);
  const next = k.secrets.slice();
  if (existingIdx >= 0) {
    const prev = next[existingIdx]!;
    next[existingIdx] = {
      ...prev,
      confidence: Math.max(prev.confidence, sk.confidence),
      learnedTick: Math.max(prev.learnedTick, sk.learnedTick),
      source: prev.confidence >= sk.confidence ? prev.source : sk.source
    };
  } else {
    next.push(sk);
  }
  const bounded = next.length > max ? next.slice(next.length - max) : next;
  return { ...n, knowledge: { ...k, secrets: bounded } };
}

export function createSecret(input: {
  id: string;
  kind: SecretKind;
  subjectId: string;
  details: string;
  createdTick: SimTick;
}): Secret {
  return { ...input };
}

/**
 * Create minimal secrets from events and update:
 * - world.secrets
 * - npc.knowledge.secrets for the actor (and optionally witnesses)
 */
export function createSecretsFromEvents(world: WorldState, events: SimEvent[], nextEventSeq: () => number): WorldState {
  const cfg = getConfig();

  let secrets = ensureSecrets(world);
  let nextNpcs: WorldState["npcs"] | undefined;
  let secretsChanged = false;
  let npcsChanged = false;

  for (const e of events) {
    if (e.kind !== "attempt.recorded") continue;
    const a: any = (e.data as any)?.attempt;
    if (!a?.actorId || !a?.kind) continue;

    // Only treat non-public attempts as "secret-worthy" for now.
    const vis = String(e.visibility ?? "private");
    if (vis === "public") continue;

    const kind = String(a.kind);
    const actorId = String(a.actorId);
    const targetId = a.targetId ? String(a.targetId) : undefined;

    // Very small starter set.
    let secretKind: SecretKind | undefined;
    let details = "";
    if (kind === "steal") {
      secretKind = "crime";
      details = targetId ? `stole from ${targetId}` : "stole";
    } else if (kind === "kill") {
      secretKind = "crime";
      details = targetId ? `killed ${targetId}` : "killed someone";
    } else if (kind === "kidnap") {
      secretKind = "crime";
      details = targetId ? `kidnapped ${targetId}` : "kidnapped someone";
    } else if (kind === "forced_eclipse") {
      secretKind = "plan";
      details = "performed a forced eclipse ritual";
    } else {
      continue;
    }

    const id = makeId("sec", world.tick, nextEventSeq());
    const secret = createSecret({ id, kind: secretKind, subjectId: actorId, details, createdTick: world.tick });

    if (secrets === (world.secrets ?? {})) secrets = { ...secrets };
    secrets[id] = secret;
    secretsChanged = true;

    const actor = world.npcs[actorId];
    if (actor) {
      const sk: SecretKnowledge = {
        secretId: id,
        confidence: 100 as KnowledgeConfidence,
        learnedTick: world.tick,
        source: "witnessed"
      };
      const updated = addSecretKnowledge(actor, sk, cfg.limits.maxSecretsInWorld);
      if (!nextNpcs) nextNpcs = { ...world.npcs };
      nextNpcs[actorId] = updated;
      npcsChanged = true;
    }
  }

  if (!secretsChanged && !npcsChanged) return world;
  return { ...world, ...(secretsChanged ? { secrets } : {}), ...(npcsChanged && nextNpcs ? { npcs: nextNpcs } : {}) };
}


