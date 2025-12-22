import type { SimTick } from "./types";

export function makeId(prefix: string, tick: SimTick, seq: number): string {
  return `${prefix}:${tick}:${seq}`;
}









