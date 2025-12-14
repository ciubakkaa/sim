import type { MapEdge, SiteId, WorldMap } from "./types";

export function getNeighbors(map: WorldMap, siteId: SiteId): { to: SiteId; km: number }[] {
  const out: { to: SiteId; km: number }[] = [];
  for (const e of map.edges) {
    if (e.from === siteId) out.push({ to: e.to, km: e.km });
    else if (e.to === siteId) out.push({ to: e.from, km: e.km });
  }
  return out;
}

export function findEdge(map: WorldMap, a: SiteId, b: SiteId): MapEdge | undefined {
  return map.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}


