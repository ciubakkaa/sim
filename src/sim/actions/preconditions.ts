import type { NpcState, WorldState } from "../types";
import { isBusy } from "../busy";
import { isDetained } from "../eclipsing";
import { isNpcTraveling } from "../movement";
import type { ActionPrecondition } from "./types";
import { listTargets } from "./targets";

function compare(op: ">" | "<" | ">=" | "<=", a: number, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
  }
}

export function checkPreconditions(preconditions: ActionPrecondition[], npc: NpcState, world: WorldState): boolean {
  for (const p of preconditions) {
    if (p.type === "atSiteKind") {
      const s = world.sites[npc.siteId];
      if (!s) return false;
      if (!p.kinds.includes(s.kind)) return false;
      continue;
    }

    if (p.type === "hasCategory") {
      if (!p.categories.includes(npc.category)) return false;
      continue;
    }

    if (p.type === "hasCultRole") {
      if (!p.roles.includes(npc.cult.role)) return false;
      continue;
    }

    if (p.type === "siteCondition") {
      const s: any = world.sites[npc.siteId];
      const v = s?.[p.field];
      if (typeof v !== "number") return false;
      if (!compare(p.op, v, p.value)) return false;
      continue;
    }

    if (p.type === "npcCondition") {
      const n: any = npc as any;
      const v = n?.[p.field];
      if (typeof v !== "number") return false;
      if (!compare(p.op, v, p.value)) return false;
      continue;
    }

    if (p.type === "hasTarget") {
      const targets = listTargets(p.selector, npc, world);
      if (!targets.length) return false;
      continue;
    }

    if (p.type === "notBusy") {
      if (isBusy(npc, world.tick)) return false;
      continue;
    }

    if (p.type === "notTraveling") {
      if (isNpcTraveling(npc)) return false;
      continue;
    }

    if (p.type === "notDetained") {
      if (isDetained(npc)) return false;
      continue;
    }
  }

  return true;
}


