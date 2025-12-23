import type { MapEdge, SiteId, WorldMap } from "../sim/types";
import type { MapLayout, Vec2 } from "./protocol";

type Node = { id: SiteId; pos: Vec2; vel: Vec2 };

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

function norm(a: Vec2): Vec2 {
  const l = len(a);
  if (l <= 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

function desiredEdgeLength(edge: MapEdge): number {
  // km -> layout units (tuned for ~10-25km edges in current map)
  const km = clamp(edge.km, 1, 60);
  return 80 + km * 6;
}

export function computeDeterministicLayout(map: WorldMap, seed: number): MapLayout {
  const siteIds = [...map.sites].sort();
  const edges = [...map.edges].sort((a, b) => {
    const ak = `${a.from}->${a.to}`;
    const bk = `${b.from}->${b.to}`;
    return ak.localeCompare(bk);
  });

  // Deterministic initial placement: a slightly rotated circle
  const n = Math.max(1, siteIds.length);
  const baseAngle = ((fnv1a32(`seed:${seed}`) % 360) * Math.PI) / 180;
  const radius = 260;

  const nodes: Node[] = siteIds.map((id, i) => {
    const t = baseAngle + (2 * Math.PI * i) / n;
    const jitter = ((fnv1a32(id) % 1000) / 1000 - 0.5) * 14; // tiny deterministic jitter
    const r = radius + jitter;
    return {
      id,
      pos: { x: Math.cos(t) * r, y: Math.sin(t) * r },
      vel: { x: 0, y: 0 }
    };
  });

  const byId: Record<string, Node> = {};
  for (const node of nodes) byId[node.id] = node;

  // Force simulation (deterministic: fixed iteration count and no randomness)
  const iterations = 320;
  const dt = 0.035;
  const repulsionK = 22000; // stronger => spread out
  const springK = 0.065; // stronger => tighter edge lengths
  const centerK = 0.012; // pulls toward origin to avoid drift
  const damping = 0.88;

  for (let it = 0; it < iterations; it++) {
    const forces: Record<string, Vec2> = {};
    for (const node of nodes) forces[node.id] = { x: 0, y: 0 };

    // Pairwise repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const d = sub(a.pos, b.pos);
        const dist = Math.max(18, len(d));
        const dir = norm(d);
        const mag = repulsionK / (dist * dist);
        forces[a.id] = add(forces[a.id]!, mul(dir, mag));
        forces[b.id] = add(forces[b.id]!, mul(dir, -mag));
      }
    }

    // Springs for edges
    for (const e of edges) {
      const a = byId[e.from];
      const b = byId[e.to];
      if (!a || !b) continue;
      const d = sub(b.pos, a.pos);
      const dist = Math.max(1e-6, len(d));
      const dir = norm(d);
      const target = desiredEdgeLength(e);
      const stretch = dist - target;
      const mag = springK * stretch;
      forces[a.id] = add(forces[a.id]!, mul(dir, mag));
      forces[b.id] = add(forces[b.id]!, mul(dir, -mag));
    }

    // Centering
    for (const node of nodes) {
      forces[node.id] = add(forces[node.id]!, mul(node.pos, -centerK));
    }

    // Integrate
    for (const node of nodes) {
      const f = forces[node.id]!;
      node.vel = add(mul(node.vel, damping), mul(f, dt));
      node.pos = add(node.pos, node.vel);
    }
  }

  // Bounds
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.pos.x);
    minY = Math.min(minY, node.pos.y);
    maxX = Math.max(maxX, node.pos.x);
    maxY = Math.max(maxY, node.pos.y);
  }

  const sites: Record<string, Vec2> = {};
  for (const node of nodes) sites[node.id] = { x: node.pos.x, y: node.pos.y };

  return {
    sites,
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      points: [sites[e.from]!, sites[e.to]!]
    })),
    bounds: { minX, minY, maxX, maxY }
  };
}


