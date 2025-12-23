import React, { useMemo, useState } from "react";
import type { NpcState, WorldState } from "../../lib/protocol";

type Props = {
  world: WorldState | null;
  selectedNpcId: string | null;
  onSelectNpcId: (id: string | null) => void;
};

function npcNowLabel(npc: NpcState, worldTick: number): string {
  if (!npc.alive) return "Dead";
  if (npc.travel && npc.travel.remainingKm > 0) return `Traveling ${npc.travel.from} → ${npc.travel.to}`;
  if (npc.status?.detained && npc.status.detained.untilTick > worldTick) return `Detained (until t${npc.status.detained.untilTick})`;
  if (npc.status?.eclipsing && npc.status.eclipsing.completeTick > worldTick)
    return `Eclipsing (until t${npc.status.eclipsing.completeTick})`;
  if (npc.busyUntilTick > worldTick) return npc.busyKind ? `Busy: ${npc.busyKind}` : "Busy";
  return "Idle";
}

function topNeed(npc: NpcState): { k: string; v: number } | null {
  const entries = Object.entries(npc.needs ?? {});
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1] as number) - (a[1] as number));
  const [k, v] = entries[0]!;
  return { k, v: Number(v) };
}

function barColor(v: number): string {
  if (v >= 75) return "var(--bad)";
  if (v >= 45) return "var(--warn)";
  return "var(--good)";
}

export function NpcPanel(props: Props) {
  const [q, setQ] = useState("");
  const world = props.world;
  const tick = world?.tick ?? 0;

  const npcs = useMemo(() => {
    if (!world) return [];
    const query = q.trim().toLowerCase();
    return Object.values(world.npcs)
      .filter((n) => (query ? `${n.name} ${n.id} ${n.category} ${n.siteId}`.toLowerCase().includes(query) : true))
      .sort((a, b) => (b.notability ?? 0) - (a.notability ?? 0) || a.name.localeCompare(b.name));
  }, [q, world]);

  const selected = world && props.selectedNpcId ? world.npcs[props.selectedNpcId] : null;
  const selectedTopNeed = selected ? topNeed(selected) : null;

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "52px 1fr 220px", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.12)"
        }}
      >
        <div style={{ fontWeight: 700 }}>NPCs</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>({npcs.length})</div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={inputStyle} />
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {!world ? (
          <div style={{ color: "var(--muted)" }}>Waiting for world…</div>
        ) : (
          npcs.slice(0, 350).map((n) => {
            const sel = n.id === props.selectedNpcId;
            const tn = topNeed(n);
            return (
              <button
                key={n.id}
                onClick={() => props.onSelectNpcId(n.id)}
                style={{
                  ...rowStyle,
                  borderColor: sel ? "rgba(255,255,255,0.35)" : "var(--border)",
                  background: sel ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)",
                  textAlign: "left",
                  cursor: "pointer"
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{n.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.category}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.siteId}</div>
                </div>
                <div style={{ display: "flex", gap: 10, color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                  <span>{npcNowLabel(n, tick)}</span>
                  {tn ? (
                    <span>
                      TopNeed: {tn.k}({Math.round(tn.v)})
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
        {world && npcs.length > 350 ? <div style={{ color: "var(--muted)" }}>Showing top 350 (search to narrow).</div> : null}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: 12, background: "rgba(0,0,0,0.12)", minHeight: 0 }}>
        {!selected ? (
          <div style={{ color: "var(--muted)" }}>Select an NPC to see details.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateRows: "auto auto 1fr", gap: 10, height: "100%" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{selected.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{selected.id}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: selected.alive ? "var(--good)" : "var(--muted)" }}>{selected.alive ? "Alive" : "Dead"}</div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 12 }}>
              <span>site={selected.siteId}</span>
              {selected.local?.locationId ? <span>loc={selected.local.locationId.split(":").slice(-1)[0]}</span> : null}
              <span>home={selected.homeSiteId}</span>
              {selected.homeLocationId ? <span>homeLoc={selected.homeLocationId.split(":").slice(-1)[0]}</span> : null}
              <span>
                hp={Math.round(selected.hp)}/{selected.maxHp}
              </span>
              <span>trauma={Math.round(selected.trauma)}</span>
              <span>notability={Math.round(selected.notability)}</span>
              <span>beliefs={selected.beliefs?.length ?? 0}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Needs</div>
                {Object.entries(selected.needs ?? {})
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 40px", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
                      <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${clamp(Number(v), 0, 100)}%`, height: "100%", background: barColor(Number(v)) }} />
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>{Math.round(Number(v))}</div>
                    </div>
                  ))}
                {selectedTopNeed ? <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Now: {npcNowLabel(selected, tick)}</div> : null}
              </div>

              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Traits</div>
                {Object.entries(selected.traits ?? {})
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .slice(0, 10)
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
                      <div style={{ color: "var(--text)", fontSize: 12 }}>{Math.round(Number(v))}</div>
                    </div>
                  ))}
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  status={npcNowLabel(selected, tick)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

const rowStyle: React.CSSProperties = {
  padding: "10px 10px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)"
};

const inputStyle: React.CSSProperties = {
  width: 180,
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "var(--text)"
};


