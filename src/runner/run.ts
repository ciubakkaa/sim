import type { DailySummary, SimEvent, WorldState } from "../sim/types";
import { createWorld } from "../sim/worldSeed";
import { tickHour } from "../sim/tick";

export type RunOptions = {
  seed: number;
  days: number;
};

export type RunResult = {
  finalWorld: WorldState;
  summaries: DailySummary[];
  events: SimEvent[];
};

export function runSimulation(opts: RunOptions): RunResult {
  if (!Number.isInteger(opts.seed)) throw new Error("seed must be an integer");
  if (!Number.isInteger(opts.days) || opts.days < 0) throw new Error("days must be >= 0");

  let world = createWorld(opts.seed);
  const summaries: DailySummary[] = [];
  const events: SimEvent[] = [];

  const totalHours = opts.days * 24;
  for (let i = 0; i < totalHours; i++) {
    const res = tickHour(world);
    world = res.world;
    if (res.dailySummary) summaries.push(res.dailySummary);
    events.push(...res.events);
  }

  return { finalWorld: world, summaries, events };
}


