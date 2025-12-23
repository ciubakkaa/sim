import React, { useMemo } from "react";
import type { SimEvent, WorldState } from "../../../lib/protocol";
import { eventActorCounts, topN } from "../metrics";

export type FactionKey = "humans" | "elves" | "cult" | "guards" | "bandits";

type Props = {
  world: WorldState | null;
  events: SimEvent[];
  faction: FactionKey | null;
  membership: Record<FactionKey, Set<string>> | null;
  onSelectNpcId: (id: string) => void;
};

function labelNpc(world: WorldState | null, npcId: string): string {
  const n = world?.npcs?.[npcId];
  return n ? `${n.name} (${npcId})` : npcId;
}

export function FactionInspector(props: Props) {
  if (!props.faction || !props.membership) return <div style={{ padding: 12, color: "var(--muted)" }}>Select a faction.</div>;
  const memberSet = props.membership[props.faction];

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of props.events) {
      const a: any = (e.data as any)?.attempt;
      const actorId = a?.actorId;
      if (!actorId) continue;
      if (!memberSet.has(actorId)) continue;
      out[actorId] = (out[actorId] ?? 0) + 1;
    }
    return out;
  }, [memberSet, props.events]);

  const topActors = useMemo(() => topN(counts, 20), [counts]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{props.faction}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>members={memberSet.size}</div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Top actors (by attempts in loaded events)</div>
        {!topActors.length ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {topActors.map((x) => (
              <button
                key={x.key}
                onClick={() => props.onSelectNpcId(x.key)}
                style={{ ...rowStyle, cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>{labelNpc(props.world, x.key)}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{x.value}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(0,0,0,0.18)"
};

const rowStyle: React.CSSProperties = {
  padding: "10px 10px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "rgba(0,0,0,0.18)",
  color: "var(--text)"
};


