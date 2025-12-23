import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MapLayout, NpcState, WorldState } from "../../lib/protocol";

type Props = {
  layout: MapLayout | null;
  world: WorldState | null;
  selectedNpcId: string | null;
  selectedSiteId: string | null;
  onSelectNpcId: (id: string | null) => void;
  onSelectSiteId: (id: string | null) => void;
};

type Camera = { cx: number; cy: number; scale: number }; // world->screen: (world - c) * scale + center

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function npcColor(npc: NpcState): string {
  if (!npc.alive) return "rgba(148,163,184,0.45)";
  if (npc.status?.eclipsing) return "rgba(251,113,133,0.95)";
  if (npc.cult?.member) return "rgba(167,243,208,0.95)";
  if (npc.category.includes("Guard") || npc.category.includes("Warrior")) return "rgba(125,211,252,0.95)";
  return "rgba(255,255,255,0.88)";
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

export function MapCanvas(props: Props) {
  const { layout, world } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cam, setCam] = useState<Camera>({ cx: 0, cy: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);

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
    if (!layout) return;
    const c = { cx: (layout.bounds.minX + layout.bounds.maxX) / 2, cy: (layout.bounds.minY + layout.bounds.maxY) / 2, scale: 1 };
    setCam(c);
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
      if (!ctx || !layout || !world) return;

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

      // Edges
      for (const e of layout.edges) {
        const a = layout.sites[e.from];
        const b = layout.sites[e.to];
        if (!a || !b) continue;
        const sa = toScreen(a.x, a.y);
        const sb = toScreen(b.x, b.y);
        const quality = (world.map.edges.find((x) => (x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from)) as any)?.quality;
        ctx.strokeStyle = quality === "rough" ? "var(--rough)" : "var(--road)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
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
          ctx.fillStyle = "rgba(255,255,255,0.82)";
          ctx.font = "12px ui-sans-serif, system-ui";
          ctx.fillText(s.name, p.x + 12, p.y - 10);
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
    };

    // Expose draw for resize handler
    (window as any).__simViewerDraw = draw;

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      delete (window as any).__simViewerDraw;
    };
  }, [cam, layout, sites, world, props.selectedNpcId, props.selectedSiteId]);

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
    if (!layout || !world) return;
    const wpos = screenToWorld(e.clientX, e.clientY);

    // Hit test sites first
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


