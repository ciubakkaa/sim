import type { AttemptConsequence } from "./consequences";
import type { FoodLot, NpcState, SettlementSiteState, SiteState, WorldState } from "../types";
import { addRumor } from "./rumors";
import { clamp } from "../util";
import { addBelief } from "../beliefs";
import { applyRelationshipDelta, scaleDeltaByConfidence } from "../relationships";

function isSettlement(site: SiteState): site is SettlementSiteState {
  return (site as any).kind === "settlement";
}

function mergeNpcPatch(npc: NpcState, patch: Partial<NpcState>): NpcState {
  const next: NpcState = { ...npc, ...patch };
  if (patch.status) next.status = { ...(npc.status ?? {}), ...(patch.status ?? {}) } as any;
  if (patch.cult) next.cult = { ...npc.cult, ...(patch.cult ?? {}) } as any;
  return next;
}

function takeFromLots(lots: FoodLot[], amount: number, takeFrom: "newest" | "oldest"): { lots: FoodLot[]; taken: number } {
  const next = lots.map((l) => ({ ...l }));
  let remaining = Math.max(0, amount);
  let taken = 0;

  const iter = takeFrom === "newest"
    ? (function* () {
        for (let i = next.length - 1; i >= 0; i--) yield i;
      })()
    : (function* () {
        for (let i = 0; i < next.length; i++) yield i;
      })();

  // We can't safely splice while iterating forward indexes, so handle deletion after.
  const toDelete = new Set<number>();
  for (const i of iter) {
    if (remaining <= 0) break;
    const lot = next[i]!;
    const take = Math.min(lot.amount, remaining);
    lot.amount -= take;
    remaining -= take;
    taken += take;
    if (lot.amount <= 0) toDelete.add(i);
  }

  const filtered = next.filter((_l, idx) => !toDelete.has(idx));
  return { lots: filtered, taken };
}

export function applyConsequences(world: WorldState, consequences: AttemptConsequence[]): WorldState {
  let w = world;
  for (const c of consequences) {
    if (c.kind === "npc.patch") {
      const n = w.npcs[c.npcId];
      if (!n) continue;
      w = { ...w, npcs: { ...w.npcs, [c.npcId]: mergeNpcPatch(n, c.patch) } };
      continue;
    }

    if (c.kind === "npc.number.delta") {
      const n = w.npcs[c.npcId];
      if (!n) continue;
      if (c.key === "hp") {
        const hp = clamp(n.hp + c.delta, 0, n.maxHp);
        w = { ...w, npcs: { ...w.npcs, [c.npcId]: { ...n, hp } } };
        continue;
      }
      if (c.key === "trauma") {
        const trauma = clamp(n.trauma + c.delta, 0, 100);
        w = { ...w, npcs: { ...w.npcs, [c.npcId]: { ...n, trauma } } };
        continue;
      }
      if (c.key === "notability") {
        const notability = clamp(n.notability + c.delta, 0, 100);
        w = { ...w, npcs: { ...w.npcs, [c.npcId]: { ...n, notability } } };
        continue;
      }
      continue;
    }

    if (c.kind === "npc.belief.add") {
      const n = w.npcs[c.npcId];
      if (!n) continue;
      const updated = addBelief(n, c.belief);
      w = { ...w, npcs: { ...w.npcs, [c.npcId]: updated } };
      continue;
    }

    if (c.kind === "npc.relationship.delta") {
      const n = w.npcs[c.npcId];
      if (!n) continue;
      const scaled = scaleDeltaByConfidence(c.delta, c.confidence);
      const updated = applyRelationshipDelta(n, c.otherNpcId, w, scaled);
      w = { ...w, npcs: { ...w.npcs, [c.npcId]: updated } };
      continue;
    }

    if (c.kind === "site.patch") {
      const s = w.sites[c.siteId];
      if (!s) continue;
      // Patch is expected to contain complete nested values when provided.
      w = { ...w, sites: { ...w.sites, [c.siteId]: { ...(s as any), ...(c.patch as any) } } };
      continue;
    }

    if (c.kind === "npc.killed") {
      const n = w.npcs[c.npcId];
      if (!n || !n.alive) continue;
      const updated: NpcState = {
        ...n,
        alive: false,
        death: { tick: c.tick, cause: c.cause, byNpcId: c.byNpcId, atSiteId: c.atSiteId }
      };
      w = { ...w, npcs: { ...w.npcs, [c.npcId]: updated } };
      continue;
    }

    if (c.kind === "site.food.take") {
      const s = w.sites[c.siteId];
      if (!s || !isSettlement(s)) continue;
      const lots = s.food[c.foodType];
      const res = takeFromLots(lots, c.amount, c.takeFrom);
      const updated: SettlementSiteState = { ...s, food: { ...s.food, [c.foodType]: res.lots } };
      w = { ...w, sites: { ...w.sites, [c.siteId]: updated } };
      continue;
    }

    if (c.kind === "site.rumor.add") {
      const s = w.sites[c.siteId];
      if (!s || !isSettlement(s)) continue;
      const updated = addRumor(s, c.rumor);
      w = { ...w, sites: { ...w.sites, [c.siteId]: updated } };
      continue;
    }
  }
  return w;
}


