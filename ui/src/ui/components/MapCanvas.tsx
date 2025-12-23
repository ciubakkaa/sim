import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LocalNode, MapLayout, NpcState, SettlementSiteState, WorldState } from "../../lib/protocol";

type Props = {
  layout: MapLayout | null;
  world: WorldState | null;
  selectedNpcId: string | null;
  selectedSiteId: string | null;
  selectedLocationId: string | null;
  focusNpcId: string | null;
  onSelectNpcId: (id: string | null) => void;
  onSelectSiteId: (id: string | null) => void;
  onSelectLocationId: (id: string | null) => void;
};

type Camera = { cx: number; cy: number; scale: number }; // world->screen: (world - c) * scale + center

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function familyColor(npc: NpcState): string {
  const fam = (npc as any).familyIds as string[] | undefined;
  const ids = [npc.id, ...(fam ?? [])].sort();
  const key = ids[0] ?? npc.id;
  const h = fnv1a32(key) % 360;
  const s = 72;
  const l = 58;
  return `hsl(${h} ${s}% ${l}%)`;
}

function npcColor(npc: NpcState): string {
  if (!npc.alive) return "rgba(148,163,184,0.45)";
  if (npc.status?.eclipsing) return "rgba(251,113,133,0.95)";
  if (npc.cult?.member) return "rgba(167,243,208,0.95)";
  if (npc.category.includes("Guard") || npc.category.includes("Warrior")) return "rgba(125,211,252,0.95)";
  return familyColor(npc);
}

function worldNpcPosition(layout: MapLayout, npc: NpcState): { x: number; y: number; traveling: boolean } {
  const at = layout.sites[npc.siteId];
  const travel = npc.travel;
  if (!travel || !layout.sites[travel.from] || !layout.sites[travel.to] || !(travel.totalKm > 0)) {
    return { x: at?.x ?? 0, y: at?.y ?? 0, traveling: false };
  }
  const a = layout.sites[travel.from]!;
  const b = layout.sites[travel.to]!;
  const p = clamp(1 - travel.remainingKm / travel.totalKm, 0, 1);
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, traveling: true };
}

function settlementNpcPosition(site: SettlementSiteState, npc: NpcState): { x: number; y: number; traveling: boolean } {
  const local = site.local;
  if (!local) return { x: 0, y: 0, traveling: false };
  const byId: Record<string, LocalNode> = {};
  for (const n of local.nodes) byId[n.id] = n;

  const lt = npc.localTravel;
  if (lt && byId[lt.fromLocationId] && byId[lt.toLocationId] && lt.totalMeters > 0) {
    const a = byId[lt.fromLocationId]!.pos;
    const b = byId[lt.toLocationId]!.pos;
    const p = clamp(1 - lt.remainingMeters / lt.totalMeters, 0, 1);
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, traveling: true };
  }

  const locId = npc.local?.locationId;
  const node = locId ? byId[locId] : undefined;
  return node ? { x: node.pos.x, y: node.pos.y, traveling: false } : { x: 0, y: 0, traveling: false };
}

function getFootprintRect(n: LocalNode): { w: number; h: number; angleRad: number } | null {
  const fp: any = (n as any).meta?.footprint;
  if (!fp || fp.type !== "rect") return null;
  if (typeof fp.w !== "number" || typeof fp.h !== "number" || typeof fp.angleRad !== "number") return null;
  return { w: fp.w, h: fp.h, angleRad: fp.angleRad };
}

function pointInRotRect(p: { x: number; y: number }, c: { x: number; y: number }, fp: { w: number; h: number; angleRad: number }): boolean {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const ca = Math.cos(-fp.angleRad);
  const sa = Math.sin(-fp.angleRad);
  const lx = dx * ca - dy * sa;
  const ly = dx * sa + dy * ca;
  return Math.abs(lx) <= fp.w / 2 && Math.abs(ly) <= fp.h / 2;
}

function buildingFill(kind: string): string {
  switch (kind) {
    case "house":
      return "rgba(226,232,240,0.80)";
    case "tavern":
      return "rgba(251,191,36,0.92)";
    case "market":
      return "rgba(196,181,253,0.90)";
    case "shrine":
      return "rgba(167,243,208,0.85)";
    case "guardhouse":
      return "rgba(125,211,252,0.90)";
    case "storage":
      return "rgba(203,213,225,0.78)";
    case "well":
      return "rgba(165,243,252,0.85)";
    case "gate":
      return "rgba(148,163,184,0.80)";
    case "fields":
      return "rgba(52,211,153,0.78)";
    case "docks":
      return "rgba(94,234,212,0.88)";
    case "clinic":
      return "rgba(251,113,133,0.75)";
    case "library":
      return "rgba(110,231,183,0.90)";
    default:
      return "rgba(148,163,184,0.75)";
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bold = false) {
  ctx.save();
  ctx.font = `${bold ? "700 " : ""}12px ui-sans-serif, system-ui`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

type NpcPathAnim = {
  points: { x: number; y: number }[];
  segLens: number[];
  total: number;
  startMs: number;
  endMs: number;
  fromLocId: string;
  toLocId: string;
};

export function MapCanvas(props: Props) {
  const { layout, world } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cam, setCam] = useState<Camera>({ cx: 0, cy: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const animRef = useRef<Record<string, NpcPathAnim | undefined>>({});
  const currentLocRef = useRef<Record<string, string>>({});
  const queueRef = useRef<Record<string, string[]>>({});
  const lastTargetRef = useRef<Record<string, string>>({});
  const [frame, setFrame] = useState(0);

  const selectedSite: any = world && props.selectedSiteId ? (world.sites as any)[props.selectedSiteId] : null;
  const settlementSite: SettlementSiteState | null =
    selectedSite && selectedSite.kind === "settlement" && selectedSite.local ? (selectedSite as SettlementSiteState) : null;

  const sites = useMemo(() => {
    if (!layout || !world) return [];
    return Object.values(world.sites).map((s) => ({
      id: s.id,
      name: (s as any).name as string,
      kind: (s as any).kind as string,
      culture: (s as any).culture as string,
      pos: layout.sites[s.id]
    }));
  }, [layout, world]);

  // Fit to bounds on first layout
  useEffect(() => {
    if (settlementSite?.local) {
      // fit settlement view
      const xs = settlementSite.local.nodes.map((n) => n.pos.x);
      const ys = settlementSite.local.nodes.map((n) => n.pos.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      setCam({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: 1.3 });
      return;
    }
    if (!layout) return;
    setCam({ cx: (layout.bounds.minX + layout.bounds.maxX) / 2, cy: (layout.bounds.minY + layout.bounds.maxY) / 2, scale: 1 });
  }, [layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      draw();
    };

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !world) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const toScreen = (x: number, y: number) => ({
        x: (x - cam.cx) * cam.scale + w / 2,
        y: (y - cam.cy) * cam.scale + h / 2
      });

      // Subtle grid
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      const grid = 80 * cam.scale;
      if (grid >= 20) {
        for (let x = (w / 2) % grid; x < w; x += grid) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = (h / 2) % grid; y < h; y += grid) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }
      ctx.restore();

      if (settlementSite?.local) {
        // ===== Settlement view =====
        const local = settlementSite.local;

        const nodeById: Record<string, LocalNode> = {};
        for (const n of local.nodes) nodeById[n.id] = n;
        const edgeMetersByKey = new Map<string, number>();
        for (const e of local.edges) {
          const k1 = `${e.from}::${e.to}`;
          const k2 = `${e.to}::${e.from}`;
          edgeMetersByKey.set(k1, e.meters);
          edgeMetersByKey.set(k2, e.meters);
        }

        // Streets (thick) and paths (thin)
        for (const e of local.edges) {
          const na = nodeById[e.from];
          const nb = nodeById[e.to];
          const a = na?.pos;
          const b = nb?.pos;
          if (!na || !nb || !a || !b) continue;
          const sa = toScreen(a.x, a.y);
          const sb = toScreen(b.x, b.y);
          const isStreet = na.kind === "streets" && nb.kind === "streets";
          ctx.strokeStyle = isStreet ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)";
          ctx.lineWidth = isStreet ? 5 : 2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
        }

        // Buildings (footprints)
        for (const n of local.nodes) {
          if (n.kind === "streets") continue;
          const p = toScreen(n.pos.x, n.pos.y);
          const isSel = props.selectedLocationId === n.id;
          const fp = getFootprintRect(n);
          const r = n.kind === "fields" ? 12 : 9;

          ctx.fillStyle = buildingFill(n.kind);
          ctx.beginPath();
          if (fp) {
            const ca = Math.cos(fp.angleRad);
            const sa = Math.sin(fp.angleRad);
            const hw = fp.w / 2;
            const hh = fp.h / 2;
            const corners = [
              { x: -hw, y: -hh },
              { x: hw, y: -hh },
              { x: hw, y: hh },
              { x: -hw, y: hh }
            ].map((c) => ({
              x: p.x + (c.x * ca - c.y * sa) * cam.scale,
              y: p.y + (c.x * sa + c.y * ca) * cam.scale
            }));
            ctx.moveTo(corners[0]!.x, corners[0]!.y);
            for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
            ctx.closePath();
          } else {
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          }
          ctx.fill();

          if (isSel) {
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = "rgba(255,255,255,0.14)";
            ctx.lineWidth = 1;
          }
          ctx.stroke();

          if (cam.scale >= 0.95 || isSel || n.kind !== "house") drawLabel(ctx, n.name, p.x + 10, p.y - 8, true);
        }

        // NPCs in this settlement (animated along local graph)
        const npcs = Object.values(world.npcs).filter((n) => n.siteId === settlementSite.id);
        for (const npc of npcs) {
          const base = settlementNpcPosition(settlementSite, npc);
          const anim = animRef.current[npc.id];
          const now = performance.now();
          let pos = { x: base.x, y: base.y };

          if (anim) {
            if (now >= anim.endMs) {
              // animation complete
              animRef.current[npc.id] = undefined;
              currentLocRef.current[npc.id] = anim.toLocId;
            } else {
              const t = clamp((now - anim.startMs) / Math.max(1, anim.endMs - anim.startMs), 0, 1);
              const dist = anim.total * t;
              let acc = 0;
              for (let i = 0; i < anim.segLens.length; i++) {
                const seg = anim.segLens[i]!;
                if (acc + seg >= dist) {
                  const r = seg > 0 ? (dist - acc) / seg : 0;
                  const a = anim.points[i]!;
                  const b = anim.points[i + 1]!;
                  pos = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
                  break;
                }
                acc += seg;
              }
            }
          }

          // If no animation running, start next queued move (if any)
          if (!animRef.current[npc.id]) {
            const q = queueRef.current[npc.id];
            const next = q && q.length ? q.shift() : undefined;
            if (next && next !== currentLocRef.current[npc.id]) {
              const path = shortestPath(local, currentLocRef.current[npc.id] ?? npc.local?.locationId ?? next, next);
              if (path && path.length >= 2) {
                const pts = path.map((id) => nodeById[id]?.pos ?? { x: 0, y: 0 });
                const segLens: number[] = [];
                let total = 0;
                for (let i = 0; i < pts.length - 1; i++) {
                  const a = pts[i]!;
                  const b = pts[i + 1]!;
                  const m = edgeMetersByKey.get(`${path[i]}::${path[i + 1]}`) ?? Math.hypot(b.x - a.x, b.y - a.y);
                  segLens.push(m);
                  total += m;
                }
                const speedMps = 70; // visualization speed (meters/sec)
                const dur = clamp((total / speedMps) * 1000, 900, 6500);
                animRef.current[npc.id] = {
                  points: pts.map((p) => ({ x: p.x, y: p.y })),
                  segLens,
                  total,
                  startMs: now,
                  endMs: now + dur,
                  fromLocId: path[0]!,
                  toLocId: next
                };
              } else {
                currentLocRef.current[npc.id] = next;
              }
            }
          }

          const sp = toScreen(pos.x, pos.y);
          const sel = props.selectedNpcId === npc.id;
          const r = sel ? 4.2 : 2.6;
          ctx.fillStyle = npcColor(npc);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (sel) {
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            drawLabel(ctx, npc.name, sp.x + 8, sp.y - 8, true);
          }
        }

        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.fillText("Settlement view • Pan: drag • Zoom: wheel • Click building/NPC to select", 12, h - 14);
      } else if (layout) {
        // ===== World view =====
        // Edges
        for (const e of layout.edges) {
          if (!e.points?.length) continue;
          const pts = e.points.map((p) => toScreen(p.x, p.y));
          const quality = (world.map.edges.find((x) => (x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from)) as any)?.quality;
          ctx.strokeStyle = quality === "rough" ? "rgba(251,191,36,0.45)" : "rgba(125,211,252,0.55)";
          ctx.lineWidth = quality === "rough" ? 2 : 3.5;
          ctx.lineCap = "round";
          ctx.setLineDash(quality === "rough" ? [6, 6] : []);
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Sites
        for (const s of sites) {
          if (!s.pos) continue;
          const p = toScreen(s.pos.x, s.pos.y);
          const isSel = props.selectedSiteId === s.id;
          const cultureColor =
            s.culture === "human" ? "var(--siteHuman)" : s.culture === "elven" ? "var(--siteElven)" : "var(--siteNeutral)";
          const r = s.kind === "settlement" ? 10 : s.kind === "hideout" ? 7 : 8;

          ctx.fillStyle = cultureColor;
          ctx.globalAlpha = s.kind === "hideout" ? 0.55 : 0.9;
          ctx.beginPath();
          if (s.kind === "settlement") {
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          } else {
            ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
          }
          ctx.fill();

          ctx.globalAlpha = 1;
          ctx.strokeStyle = isSel ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.20)";
          ctx.lineWidth = isSel ? 2 : 1;
          ctx.stroke();

          // Label
          if (cam.scale >= 0.9 || s.kind === "settlement" || isSel) {
            drawLabel(ctx, s.name, p.x + 12, p.y - 10, true);
          }
        }

        // NPCs
        const npcs = Object.values(world.npcs);
        for (const npc of npcs) {
          const pos = worldNpcPosition(layout, npc);
          const sp = toScreen(pos.x, pos.y);
          const sel = props.selectedNpcId === npc.id;
          const r = sel ? 4.5 : 2.7;

          ctx.fillStyle = npcColor(npc);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
          ctx.fill();

          if (sel) {
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.font = "12px ui-sans-serif, system-ui";
            ctx.fillText(npc.name, sp.x + 8, sp.y - 8);
          } else if (cam.scale >= 1.55 && npc.notability >= 55) {
            ctx.fillStyle = "rgba(255,255,255,0.70)";
            ctx.font = "11px ui-sans-serif, system-ui";
            ctx.fillText(npc.name, sp.x + 6, sp.y - 6);
          }
        }

        // HUD hint
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.fillText("Pan: drag • Zoom: wheel • Click site/NPC to select", 12, h - 14);
      }

      // HUD hint
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText("Pan: drag • Zoom: wheel • Click site/NPC to select", 12, h - 14);
    };

    // Expose draw for resize handler
    (window as any).__simViewerDraw = draw;

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      delete (window as any).__simViewerDraw;
    };
  }, [cam, frame, layout, settlementSite, sites, world, props.selectedLocationId, props.selectedNpcId, props.selectedSiteId]);

  function shortestPath(local: any, fromId: string, toId: string): string[] | null {
    if (!fromId || !toId) return null;
    if (fromId === toId) return [fromId];
    const edges = local.edges as { from: string; to: string; meters: number }[];
    const adj = new Map<string, { to: string; w: number }[]>();
    for (const e of edges) {
      (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push({ to: e.to, w: e.meters });
      (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push({ to: e.from, w: e.meters });
    }
    for (const [k, v] of adj) v.sort((a, b) => a.to.localeCompare(b.to));

    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    dist.set(fromId, 0);

    const pickNext = (): string | undefined => {
      let best: { id: string; d: number } | undefined;
      for (const [id, d] of dist.entries()) {
        if (visited.has(id)) continue;
        if (!best || d < best.d || (d === best.d && id.localeCompare(best.id) < 0)) best = { id, d };
      }
      return best?.id;
    };

    while (true) {
      const cur = pickNext();
      if (!cur) return null;
      if (cur === toId) break;
      visited.add(cur);
      const base = dist.get(cur)!;
      const nbs = adj.get(cur) ?? [];
      for (const nb of nbs) {
        if (visited.has(nb.to)) continue;
        const nd = base + nb.w;
        const pd = dist.get(nb.to);
        if (pd === undefined || nd < pd) {
          dist.set(nb.to, nd);
          prev.set(nb.to, cur);
        }
      }
    }

    const path: string[] = [];
    let cur: string | undefined = toId;
    let guard = 0;
    while (cur && guard++ < 5000) {
      path.push(cur);
      if (cur === fromId) break;
      cur = prev.get(cur);
    }
    path.reverse();
    return path[0] === fromId ? path : null;
  }

  // Queue movements between ticks in settlement view (visual-only slow motion).
  useEffect(() => {
    if (!settlementSite?.local || !world) return;
    for (const npc of Object.values(world.npcs).filter((n) => n.siteId === settlementSite.id)) {
      const locId = npc.local?.locationId ?? "";
      const curLoc = currentLocRef.current[npc.id];
      if (!curLoc) {
        currentLocRef.current[npc.id] = locId;
        lastTargetRef.current[npc.id] = locId;
        continue;
      }
      const lastT = lastTargetRef.current[npc.id] ?? curLoc;
      if (locId && locId !== lastT) {
        (queueRef.current[npc.id] ??= []).push(locId);
        lastTargetRef.current[npc.id] = locId;
      }
    }
  }, [settlementSite?.id, settlementSite?.local, world?.tick]);

  // Animation pump when in settlement view.
  useEffect(() => {
    if (!settlementSite?.local) return;
    let raf = 0;
    const loop = () => {
      setFrame((x) => (x + 1) % 10_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [settlementSite?.id]);

  const screenToWorld = (sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = sx - rect.left;
    const y = sy - rect.top;
    const w = rect.width;
    const h = rect.height;
    return { x: (x - w / 2) / cam.scale + cam.cx, y: (y - h / 2) / cam.scale + cam.cy };
  };

  const onWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    const delta = e.deltaY;
    const zoom = Math.exp(-delta * 0.0012);
    const nextScale = clamp(cam.scale * zoom, 0.15, 6);

    const worldBefore = screenToWorld(e.clientX, e.clientY);
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const nextCx = worldBefore.x - (sx - w / 2) / nextScale;
    const nextCy = worldBefore.y - (sy - h / 2) / nextScale;
    setCam({ cx: nextCx, cy: nextCy, scale: nextScale });
  };

  const onMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    setIsDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: cam.cx, cy: cam.cy };
  };

  const onMouseUp: React.MouseEventHandler<HTMLCanvasElement> = () => {
    setIsDragging(false);
    dragRef.current = null;
  };

  const onMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!isDragging || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setCam({ ...cam, cx: dragRef.current.cx - dx / cam.scale, cy: dragRef.current.cy - dy / cam.scale });
  };

  const onClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!world) return;
    const wpos = screenToWorld(e.clientX, e.clientY);

    if (settlementSite?.local) {
      // Hit test buildings
      let bestLoc: { id: string; d2: number } | null = null;
      for (const n of settlementSite.local.nodes) {
        if (n.kind === "streets") continue;
        const dx = wpos.x - n.pos.x;
        const dy = wpos.y - n.pos.y;
        const d2 = dx * dx + dy * dy;
        const fp = getFootprintRect(n);
        const inside = fp ? pointInRotRect(wpos, n.pos, fp) : d2 <= ((n.kind === "house" ? 12 : 14) / cam.scale) ** 2;
        if (!inside) continue;
        if (!bestLoc || d2 < bestLoc.d2) bestLoc = { id: n.id, d2 };
      }
      if (bestLoc) {
        props.onSelectLocationId(bestLoc.id);
        return;
      }

      // Hit test NPCs
      let bestNpc: { id: string; d2: number } | null = null;
      for (const npc of Object.values(world.npcs).filter((n) => n.siteId === settlementSite.id)) {
        const p = settlementNpcPosition(settlementSite, npc);
        const dx = wpos.x - p.x;
        const dy = wpos.y - p.y;
        const d2 = dx * dx + dy * dy;
        const r = 8 / cam.scale;
        if (d2 <= r * r) {
          if (!bestNpc || d2 < bestNpc.d2) bestNpc = { id: npc.id, d2 };
        }
      }
      if (bestNpc) {
        props.onSelectNpcId(bestNpc.id);
        return;
      }

      props.onSelectLocationId(null);
      props.onSelectNpcId(null);
      return;
    }

    // World view: hit test sites first
    if (!layout) return;
    let bestSite: { id: string; d2: number } | null = null;
    for (const s of sites) {
      if (!s.pos) continue;
      const dx = wpos.x - s.pos.x;
      const dy = wpos.y - s.pos.y;
      const d2 = dx * dx + dy * dy;
      const r = s.kind === "settlement" ? 14 : 12;
      if (d2 <= (r / cam.scale) * (r / cam.scale)) {
        if (!bestSite || d2 < bestSite.d2) bestSite = { id: s.id, d2 };
      }
    }
    if (bestSite) {
      props.onSelectSiteId(bestSite.id);
      return;
    }

    // Hit test NPCs
    let bestNpc: { id: string; d2: number } | null = null;
    for (const npc of Object.values(world.npcs)) {
      const p = worldNpcPosition(layout, npc);
      const dx = wpos.x - p.x;
      const dy = wpos.y - p.y;
      const d2 = dx * dx + dy * dy;
      const r = 8 / cam.scale;
      if (d2 <= r * r) {
        if (!bestNpc || d2 < bestNpc.d2) bestNpc = { id: npc.id, d2 };
      }
    }
    if (bestNpc) {
      props.onSelectNpcId(bestNpc.id);
      return;
    }

    props.onSelectNpcId(null);
    props.onSelectSiteId(null);
  };

  // Center camera on focused NPC (jump-to)
  useEffect(() => {
    if (!props.focusNpcId || !world) return;
    const npc = world.npcs[props.focusNpcId];
    if (!npc) return;

    if (settlementSite?.local && npc.siteId === settlementSite.id) {
      const p = settlementNpcPosition(settlementSite, npc);
      setCam((c) => ({ ...c, cx: p.x, cy: p.y }));
      return;
    }

    if (layout) {
      const p = worldNpcPosition(layout, npc);
      setCam((c) => ({ ...c, cx: p.x, cy: p.y }));
    }
  }, [layout, props.focusNpcId, settlementSite?.id, settlementSite?.local, world]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", cursor: isDragging ? "grabbing" : "grab" }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onMouseMove={onMouseMove}
      onClick={onClick}
    />
  );
}


