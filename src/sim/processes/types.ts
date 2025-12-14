import type { Rng } from "../rng";
import type { SimEvent, WorldState } from "../types";

export type ProcessContext = {
  rng: Rng;
  nextEventSeq: () => number;
};

export type ProcessResult = {
  world: WorldState;
  events: SimEvent[];
  keyChanges: string[];
};


