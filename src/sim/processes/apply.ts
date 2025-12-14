import type { WorldState } from "../types";
import type { ProcessContext, ProcessResult } from "./types";
import { applyFoodProcessHourly } from "./foodProcess";
import { applyPopulationProcessDaily } from "./populationProcess";
import { applyUnrestProcessHourly } from "./unrestProcess";
import { applyEclipsingPressureHourly } from "./pressureProcess";
import { applyAnchoringHourly } from "./anchoringProcess";
import { applyCultDaily } from "./cultProcess";

export function applyAutomaticProcesses(world: WorldState, ctx: ProcessContext): ProcessResult {
  const events: ProcessResult["events"] = [];
  const keyChanges: string[] = [];

  let w = world;
  const steps = [
    applyEclipsingPressureHourly,
    applyAnchoringHourly,
    applyFoodProcessHourly,
    applyPopulationProcessDaily,
    applyUnrestProcessHourly,
    applyCultDaily
  ];

  for (const step of steps) {
    const res = step(w, ctx);
    w = res.world;
    events.push(...res.events);
    keyChanges.push(...res.keyChanges);
  }

  return { world: w, events, keyChanges };
}


