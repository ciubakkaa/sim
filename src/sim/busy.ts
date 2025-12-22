import type { AttemptKind, NpcState, SimTick } from "./types";

export function isBusy(npc: NpcState, tick: SimTick): boolean {
  return npc.alive && npc.busyUntilTick > tick;
}

export function markBusy(
  npc: NpcState,
  tick: SimTick,
  durationHours: number,
  kind: AttemptKind
): Pick<NpcState, "busyUntilTick" | "busyKind"> {
  const dur = Math.max(0, Math.floor(durationHours || 0));
  const until = tick + Math.max(1, dur);
  return {
    busyUntilTick: Math.max(npc.busyUntilTick ?? 0, until),
    busyKind: kind
  };
}


