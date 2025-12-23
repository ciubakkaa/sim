import type {
  BuildingState,
  LocalEdge,
  LocalNode,
  LocalPos,
  LocationId,
  LocationKind,
  NpcId,
  NpcState,
  SettlementLocal,
  SettlementSiteState,
  SiteId
} from "../types";
import { Rng } from "../rng";

type FootprintRect = { type: "rect"; w: number; h: number; angleRad: number };
type NodeMeta = {
  footprint?: FootprintRect;
  street?: { kind: "intersection" };
  frontsStreet?: { from: LocationId; to: LocationId; t01: number; offset: number };
};

function mkLocalId(siteId: SiteId, suffix: string): LocationId {
  return `${siteId}:${suffix}`;
}

function makeBuilding(id: LocationId, inventory: BuildingState["inventory"]): BuildingState {
  return { id, inventory };
}

function add(a: LocalPos, b: LocalPos): LocalPos {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: LocalPos, b: LocalPos): LocalPos {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(a: LocalPos, k: number): LocalPos {
  return { x: a.x * k, y: a.y * k };
}

function len(a: LocalPos): number {
  return Math.hypot(a.x, a.y);
}

function norm(a: LocalPos): LocalPos {
  const l = len(a);
  if (l <= 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

function perp(a: LocalPos): LocalPos {
  return { x: -a.y, y: a.x };
}

function lerp(a: LocalPos, b: LocalPos, t: number): LocalPos {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function angleOf(dir: LocalPos): number {
  return Math.atan2(dir.y, dir.x);
}

type Obb = {
  id: LocationId;
  c: LocalPos;
  ux: LocalPos;
  uy: LocalPos;
  hx: number;
  hy: number;
  radius: number;
};

function dot(a: LocalPos, b: LocalPos): number {
  return a.x * b.x + a.y * b.y;
}

function obbFromRect(id: LocationId, c: LocalPos, w: number, h: number, angleRad: number, extraGap: number): Obb {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const ux = { x: ca, y: sa };
  const uy = { x: -sa, y: ca };
  const hx = w / 2 + extraGap;
  const hy = h / 2 + extraGap;
  const radius = Math.hypot(hx, hy);
  return { id, c, ux, uy, hx, hy, radius };
}

function obbOverlaps(a: Obb, b: Obb): boolean {
  // Fast reject: bounding circles
  const d = sub(b.c, a.c);
  if (len(d) > a.radius + b.radius) return false;

  // SAT over the 4 axes (a.ux, a.uy, b.ux, b.uy)
  const axes = [a.ux, a.uy, b.ux, b.uy];
  for (const axis of axes) {
    const dist = Math.abs(dot(d, axis));
    const ra = Math.abs(dot(axis, a.ux)) * a.hx + Math.abs(dot(axis, a.uy)) * a.hy;
    const rb = Math.abs(dot(axis, b.ux)) * b.hx + Math.abs(dot(axis, b.uy)) * b.hy;
    if (dist > ra + rb) return false;
  }
  return true;
}

function isPort(siteId: SiteId): boolean {
  return siteId === "HumanCityPort";
}

function isElvenCity(siteId: SiteId): boolean {
  return siteId === "ElvenCity" || siteId === "ElvenTownFortified";
}

function isVillageLike(npcsCount: number): boolean {
  return npcsCount <= 40;
}

function addIntersection(siteId: SiteId, nodes: LocalNode[], buildings: Record<LocationId, BuildingState>, i: number, pos: LocalPos) {
  const id = mkLocalId(siteId, `street:i${i}`);
  const meta: NodeMeta = { street: { kind: "intersection" } };
  nodes.push({ id, kind: "streets", name: "Intersection", pos, meta });
  buildings[id] = makeBuilding(id, {});
  return id;
}

function connect(edges: LocalEdge[], a: LocationId, b: LocationId, meters: number) {
  edges.push({ from: a, to: b, meters: Math.max(10, Math.round(meters)) });
}

function buildStreetNetwork(site: SettlementSiteState, rng: Rng, npcsCount: number): { nodes: LocalNode[]; edges: LocalEdge[]; streetEdgePairs: [LocationId, LocationId][] } {
  const nodes: LocalNode[] = [];
  const edges: LocalEdge[] = [];

  // Instead: generate coordinates first; caller will create nodes/buildings.
  const streetPoints: LocalPos[] = [];

  const village = isVillageLike(npcsCount);
  if (village) {
    // Cross + small loop.
    streetPoints.push({ x: -220, y: 0 }, { x: -80, y: 0 }, { x: 80, y: 0 }, { x: 220, y: 0 });
    streetPoints.push({ x: 0, y: -160 }, { x: 0, y: -40 }, { x: 0, y: 40 }, { x: 0, y: 160 });
    // loop corner (top-right)
    streetPoints.push({ x: 120, y: -120 }, { x: 220, y: -120 }, { x: 220, y: -40 }, { x: 120, y: -40 });
  } else {
    // City grid 3x3 + ring-ish.
    const s = 170;
    for (let gy = -1; gy <= 1; gy++) {
      for (let gx = -1; gx <= 1; gx++) {
        streetPoints.push({ x: gx * s, y: gy * s });
      }
    }
    // outer ring points
    const r = 320;
    const ringN = 8;
    for (let i = 0; i < ringN; i++) {
      const t = (2 * Math.PI * i) / ringN;
      const jitter = rng.int(-12, 12);
      streetPoints.push({ x: Math.round(Math.cos(t) * (r + jitter)), y: Math.round(Math.sin(t) * (r + jitter)) });
    }
    // port spur
    if (isPort(site.id)) streetPoints.push({ x: 430, y: 40 }, { x: 520, y: 60 });
  }

  // Deduplicate points (stable)
  const seen = new Set<string>();
  const pts: LocalPos[] = [];
  for (const p of streetPoints) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push(p);
  }

  // Build nodes list (caller will set buildings for these ids).
  const streetNodeIds: LocationId[] = pts.map((_, i) => mkLocalId(site.id, `street:i${i}`));
  for (let i = 0; i < pts.length; i++) {
    nodes.push({ id: streetNodeIds[i]!, kind: "streets", name: "Intersection", pos: pts[i]!, meta: { street: { kind: "intersection" } } as any });
  }

  const byKey = new Map<string, LocationId>();
  for (let i = 0; i < pts.length; i++) byKey.set(`${pts[i]!.x},${pts[i]!.y}`, streetNodeIds[i]!);

  const connectNear = (a: LocalPos, b: LocalPos) => {
    const ida = byKey.get(`${a.x},${a.y}`);
    const idb = byKey.get(`${b.x},${b.y}`);
    if (!ida || !idb) return;
    connect(edges, ida, idb, len(sub(a, b)));
  };

  if (village) {
    // Main street segments
    connectNear({ x: -220, y: 0 }, { x: -80, y: 0 });
    connectNear({ x: -80, y: 0 }, { x: 80, y: 0 });
    connectNear({ x: 80, y: 0 }, { x: 220, y: 0 });
    // Cross
    connectNear({ x: 0, y: -160 }, { x: 0, y: -40 });
    connectNear({ x: 0, y: -40 }, { x: 0, y: 40 });
    connectNear({ x: 0, y: 40 }, { x: 0, y: 160 });
    // Link cross to main
    connectNear({ x: 0, y: -40 }, { x: -80, y: 0 });
    connectNear({ x: 0, y: 40 }, { x: 80, y: 0 });
    // Small loop
    connectNear({ x: 120, y: -120 }, { x: 220, y: -120 });
    connectNear({ x: 220, y: -120 }, { x: 220, y: -40 });
    connectNear({ x: 220, y: -40 }, { x: 120, y: -40 });
    connectNear({ x: 120, y: -40 }, { x: 120, y: -120 });
    connectNear({ x: 120, y: -40 }, { x: 80, y: 0 });
  } else {
    // Grid links
    const s = 170;
    for (let gy = -1; gy <= 1; gy++) {
      for (let gx = -1; gx <= 1; gx++) {
        const p = { x: gx * s, y: gy * s };
        if (gx < 1) connectNear(p, { x: (gx + 1) * s, y: gy * s });
        if (gy < 1) connectNear(p, { x: gx * s, y: (gy + 1) * s });
      }
    }
    // Ring: connect consecutive ring points
    const ring: LocalPos[] = [];
    const r = 320;
    const ringN = 8;
    for (let i = 0; i < ringN; i++) {
      const t = (2 * Math.PI * i) / ringN;
      // match generation above (approx; jitter already baked into points)
      const approx = { x: Math.round(Math.cos(t) * r), y: Math.round(Math.sin(t) * r) };
      // find closest ring node by distance
      let best: LocalPos | undefined;
      let bestD = Infinity;
      for (const p of pts) {
        const d = len(sub(p, approx));
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) ring.push(best);
    }
    for (let i = 0; i < ring.length; i++) connectNear(ring[i]!, ring[(i + 1) % ring.length]!);

    // Port spur: connect to nearest ring node
    if (isPort(site.id)) {
      const spurA = { x: 430, y: 40 };
      const spurB = { x: 520, y: 60 };
      // connect spur segment and connect spurA to closest node
      connectNear(spurA, spurB);
      let best: LocalPos | undefined;
      let bestD = Infinity;
      for (const p of pts) {
        const d = len(sub(p, spurA));
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) connectNear(best, spurA);
    }
  }

  const streetEdgePairs: [LocationId, LocationId][] = edges.map((e) => [e.from, e.to]);
  return { nodes, edges, streetEdgePairs };
}

function placeBuildingAlongStreet(
  site: SettlementSiteState,
  rng: Rng,
  streetNodesById: Record<LocationId, LocalNode>,
  streetEdgePairs: [LocationId, LocationId][],
  placed: Obb[],
  suffix: string,
  kind: LocationKind,
  name: string,
  size: { w: number; h: number },
  inventory: BuildingState["inventory"]
): { node: LocalNode; building: BuildingState; connectTo: LocationId; meters: number } {
  const id = mkLocalId(site.id, suffix);
  const extraGap = kind === "house" ? 6 : 10;

  let best: { node: LocalNode; building: BuildingState; connectTo: LocationId; meters: number; obb: Obb } | undefined;

  const tries = 48;
  for (let attempt = 0; attempt < tries; attempt++) {
    const edge = streetEdgePairs[rng.int(0, streetEdgePairs.length - 1)]!;
    const a = streetNodesById[edge[0]];
    const b = streetNodesById[edge[1]];
    if (!a || !b) continue;

    const t = rng.int(18, 82) / 100;
    const base = lerp(a.pos, b.pos, t);
    const dir = norm(sub(b.pos, a.pos));
    const n = perp(dir);
    const side = attempt % 2 === 0 ? 1 : -1;
    const offsetMag = Math.min(140, rng.int(24, 62) + attempt * 3);
    const offset = offsetMag * side;
    const pos = add(base, mul(n, offset));
    const angleRad = angleOf(dir);

    const meta: NodeMeta = {
      footprint: { type: "rect", w: size.w, h: size.h, angleRad },
      frontsStreet: { from: edge[0], to: edge[1], t01: t, offset }
    };
    const node: LocalNode = { id, kind, name, pos, meta: meta as any };
    const building = makeBuilding(id, inventory);

    // connect to nearest endpoint intersection
    const dToA = len(sub(pos, a.pos));
    const dToB = len(sub(pos, b.pos));
    const connectTo = dToA <= dToB ? a.id : b.id;
    const meters = Math.max(12, Math.round(Math.min(dToA, dToB)));

    const obb = obbFromRect(id, pos, size.w, size.h, angleRad, extraGap);
    const overlaps = placed.some((p) => obbOverlaps(p, obb));
    if (!overlaps) {
      best = { node, building, connectTo, meters, obb };
      break;
    }

    // Keep a fallback candidate, but only if it's better (less overlap).
    if (!best) best = { node, building, connectTo, meters, obb };
  }

  if (!best) {
    // should be impossible, but keep safe default
    const node: LocalNode = { id, kind, name, pos: { x: 0, y: 0 } };
    return { node, building: makeBuilding(id, inventory), connectTo: Object.keys(streetNodesById)[0]!, meters: 25 };
  }

  placed.push(best.obb);
  return { node: best.node, building: best.building, connectTo: best.connectTo, meters: best.meters };
}

export function generateSettlementInterior(
  rng: Rng,
  site: SettlementSiteState,
  npcsHere: NpcState[]
): { local: SettlementLocal; npcHomeById: Record<NpcId, LocationId> } {
  const nodes: LocalNode[] = [];
  const edges: LocalEdge[] = [];
  const buildings: Record<LocationId, BuildingState> = {};
  const npcHomeById: Record<NpcId, LocationId> = {};

  const streetNet = buildStreetNetwork(site, rng, npcsHere.length);
  // Add street nodes and empty building states for them
  const streetNodesById: Record<LocationId, LocalNode> = {};
  for (const n of streetNet.nodes) {
    nodes.push(n);
    buildings[n.id] = makeBuilding(n.id, {});
    streetNodesById[n.id] = n;
  }
  for (const e of streetNet.edges) edges.push(e);

  const village = isVillageLike(npcsHere.length);
  const placed: Obb[] = [];

  // Place key POIs along streets
  const poi = (suffix: string, kind: LocationKind, title: string, size: { w: number; h: number }, inv: BuildingState["inventory"]) => {
    const p = placeBuildingAlongStreet(site, rng, streetNodesById, streetNet.streetEdgePairs, placed, suffix, kind, title, size, inv);
    nodes.push(p.node);
    buildings[p.node.id] = p.building;
    connect(edges, p.node.id, p.connectTo, p.meters);
    return p.node.id;
  };

  const marketId = poi("market", "market", village ? "Market Stalls" : "Market", { w: 42, h: 30 }, { food: { grain: 40, fish: 20, meat: 10 } });
  const storageId = poi("storage", "storage", "Storehouse", { w: 38, h: 28 }, { food: { grain: 80, fish: 20, meat: 30 }, items: { tools: 12 } });
  void storageId;
  const guardhouseId = poi("guardhouse", "guardhouse", "Guardhouse", { w: 38, h: 26 }, { items: { weapons: 10 } });
  void guardhouseId;
  const shrineId = poi("shrine", "shrine", isElvenCity(site.id) ? "Grove Shrine" : "Shrine", { w: 30, h: 30 }, {});
  void shrineId;
  const wellId = poi("well", "well", "Well", { w: 18, h: 18 }, {});
  void wellId;
  const gateId = poi("gate", "gate", "Gate", { w: 46, h: 16 }, {});
  void gateId;

  const fieldsId = poi("fields", "fields", "Fields", { w: 64, h: 44 }, { food: { grain: 10 } });
  void fieldsId;

  const tavernCount = village ? (rng.chance(0.55) ? 1 : 0) : site.id === "ElvenCity" ? 2 : 1;
  const tavernIds: LocationId[] = [];
  for (let i = 0; i < tavernCount; i++) {
    tavernIds.push(poi(`tavern${i + 1}`, "tavern", i === 0 ? "Tavern" : `Tavern ${i + 1}`, { w: 50, h: 34 }, { food: { grain: 25, fish: 15, meat: 10 } }));
  }

  if (isPort(site.id)) {
    poi("docks", "docks", "Docks", { w: 70, h: 26 }, { food: { fish: 80 }, items: { nets: 20 } });
  }

  if (isElvenCity(site.id)) {
    poi("library", "library", site.id === "ElvenCity" ? "Continuum Archive" : "Hall of Records", { w: 60, h: 40 }, { books: site.id === "ElvenCity" ? 300 : 80 });
  }

  if (site.id === "HumanCityPort" || village) {
    poi("clinic", "clinic", village ? "Healer's Hut" : "Clinic", { w: 40, h: 28 }, { items: { herbs: 60 } });
  }

  // Houses: place along street edges.
  const idsSorted = [...npcsHere].sort((a, b) => a.id.localeCompare(b.id));
  for (const npc of idsSorted) {
    const p = placeBuildingAlongStreet(
      site,
      rng,
      streetNodesById,
      streetNet.streetEdgePairs,
      placed,
      `house:${npc.id}`,
      "house",
      `${npc.name}'s House`,
      { w: rng.int(18, 26), h: rng.int(16, 24) },
      { food: { grain: rng.int(1, 6), fish: rng.int(0, 3), meat: rng.int(0, 3) }, items: { personal: 1 } }
    );
    nodes.push(p.node);
    buildings[p.node.id] = p.building;
    connect(edges, p.node.id, p.connectTo, p.meters);
    npcHomeById[npc.id] = p.node.id;
  }

  // Stable ordering for determinism downstream.
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));

  return { local: { nodes, edges, buildings }, npcHomeById };
}


