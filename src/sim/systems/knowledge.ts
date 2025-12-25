/**
 * Asymmetric knowledge system (v2, opt-in)
 *
 * Knowledge is distinct from beliefs:
 * - Beliefs are shared simulation semantics used by existing AI + viewer.
 * - Knowledge is per-NPC “facts” and “secrets” used for richer reasoning later.
 */

import type { KnowledgeFact, KnowledgeFactKind, NpcKnowledge, NpcState, SimTick } from "../types";

export function ensureKnowledge(npc: NpcState): NpcKnowledge {
  return npc.knowledge ?? { facts: [], secrets: [] };
}

export function createFact(input: {
  tick: SimTick;
  kind: KnowledgeFactKind;
  subjectId: string;
  object?: string;
  confidence: number;
  source: KnowledgeFact["source"];
  id?: string;
}): KnowledgeFact {
  return {
    id: input.id ?? `fact:${input.kind}:${input.subjectId}:${input.tick}`,
    kind: input.kind,
    subjectId: input.subjectId,
    object: input.object,
    confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
    source: input.source,
    tick: input.tick
  };
}

export function upsertFact(npc: NpcState, fact: KnowledgeFact): NpcState {
  const k = ensureKnowledge(npc);
  const existingIdx = k.facts.findIndex((f) => f.kind === fact.kind && f.subjectId === fact.subjectId && f.object === fact.object);
  const facts = k.facts.slice();
  if (existingIdx >= 0) {
    const prev = facts[existingIdx]!;
    // Keep the higher confidence + newest tick.
    facts[existingIdx] = {
      ...prev,
      confidence: Math.max(prev.confidence, fact.confidence),
      tick: Math.max(prev.tick, fact.tick),
      source: prev.confidence >= fact.confidence ? prev.source : fact.source
    };
  } else {
    facts.push(fact);
  }
  const nextFacts = facts.length > 120 ? facts.slice(facts.length - 120) : facts;
  return { ...npc, knowledge: { ...k, facts: nextFacts } };
}

export function hasFact(npc: NpcState, kind: KnowledgeFactKind, subjectId: string): boolean {
  const k = npc.knowledge;
  if (!k) return false;
  return k.facts.some((f) => f.kind === kind && f.subjectId === subjectId && f.confidence >= 50);
}


