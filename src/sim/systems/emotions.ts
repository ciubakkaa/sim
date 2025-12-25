import type { EmotionalState, NpcState } from "../types";
import type { EpisodicMemory } from "./memoryTypes";
import { clamp } from "../util";
import { getConfig } from "../config";

export function emptyEmotions(): EmotionalState {
  return {
    anger: 0,
    fear: 0,
    grief: 0,
    gratitude: 0,
    pride: 0,
    shame: 0,
    stress: 0
  };
}

export function getEmotions(npc: NpcState): EmotionalState {
  return npc.emotions ?? emptyEmotions();
}

export function decayEmotionsHourly(npc: NpcState): EmotionalState {
  const cfg = getConfig();
  const e = getEmotions(npc);
  const d = clamp(cfg.tuning.emotionDecayPerHour ?? 2, 0, 50);
  const ds = clamp(cfg.tuning.stressDecayPerHour ?? 1, 0, 50);
  return {
    anger: Math.max(0, e.anger - d),
    fear: Math.max(0, e.fear - d),
    grief: Math.max(0, e.grief - d),
    gratitude: Math.max(0, e.gratitude - d),
    pride: Math.max(0, e.pride - d),
    shame: Math.max(0, e.shame - d),
    stress: Math.max(0, e.stress - ds)
  };
}

export function applyEmotionalImpact(npc: NpcState, memory: Pick<EpisodicMemory, "emotionalImpact" | "importance">): EmotionalState {
  const cfg = getConfig();
  const e = getEmotions(npc);

  // Convert [-1..1] valence + [0..1] arousal into a 0..100-ish delta scaled by importance.
  const base = clamp(cfg.tuning.baseEmotionIntensity ?? 50, 0, 200);
  const scale = (clamp(memory.importance ?? 50, 0, 100) / 100) * clamp(memory.emotionalImpact?.arousal ?? 0.5, 0, 1);
  const mag = base * scale;

  const tags = memory.emotionalImpact?.emotions ?? [];
  const next: EmotionalState = { ...e };

  for (const t of tags) {
    if (t === "anger" || t === "resentment") next.anger = clamp(next.anger + mag, 0, 100);
    else if (t === "fear" || t === "anxiety") next.fear = clamp(next.fear + mag, 0, 100);
    else if (t === "grief" || t === "sadness") next.grief = clamp(next.grief + mag * 0.8, 0, 100);
    else if (t === "gratitude" || t === "admiration" || t === "trust") next.gratitude = clamp(next.gratitude + mag * 0.7, 0, 100);
    else if (t === "pride") next.pride = clamp(next.pride + mag * 0.5, 0, 100);
    else if (t === "shame" || t === "guilt") next.shame = clamp(next.shame + mag * 0.6, 0, 100);
  }

  // Stress follows negative valence events.
  const valence = clamp(memory.emotionalImpact?.valence ?? 0, -1, 1);
  if (valence < 0) next.stress = clamp(next.stress + Math.abs(valence) * mag, 0, 100);

  return next;
}


