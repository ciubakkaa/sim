import React, { useMemo, useState } from "react";
import type { SimEvent } from "../../lib/protocol";

type Props = {
  events: SimEvent[];
  selectedNpcId: string | null;
  selectedSiteId: string | null;
};

function compactKind(kind: string): string {
  return kind.replaceAll("attempt.recorded", "attempt").replaceAll("world.", "").replaceAll("sim.", "");
}

export function EventFeed(props: Props) {
  const [textFilter, setTextFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");

  const filtered = useMemo(() => {
    const tf = textFilter.trim().toLowerCase();
    const kf = kindFilter.trim().toLowerCase();
    const site = props.selectedSiteId;
    const npc = props.selectedNpcId;

    return props.events
      .filter((e) => (kf ? e.kind.toLowerCase().includes(kf) : true))
      .filter((e) => (site ? e.siteId === site : true))
      .filter((e) => {
        if (!npc) return true;
        const d = e.data ?? {};
        const attempt = (d as any).attempt;
        return (attempt?.actorId === npc || attempt?.targetId === npc || (d as any).npcId === npc) ?? false;
      })
      .filter((e) => (tf ? `${e.kind} ${e.message} ${e.siteId ?? ""}`.toLowerCase().includes(tf) : true));
  }, [kindFilter, props.events, props.selectedNpcId, props.selectedSiteId, textFilter]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    for (const e of props.events) s.add(e.kind);
    return Array.from(s).sort();
  }, [props.events]);

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "44px 1fr", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.12)"
        }}
      >
        <div style={{ fontWeight: 700 }}>Events</div>
        <div style={{ flex: 1 }} />
        <input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Search"
          style={inputStyle(180)}
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={selectStyle}>
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div style={{ overflow: "auto", padding: 12 }}>
        {filtered.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No events yet (or filtered out).</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.slice(-250).map((e) => (
              <div key={e.id} style={rowStyle}>
                <div style={{ color: "var(--muted)", fontSize: 12, width: 78, flexShrink: 0 }}>
                  t{e.tick} • {compactKind(e.kind)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{e.message}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  padding: "10px 10px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "rgba(0,0,0,0.18)",
  display: "flex",
  gap: 10
};

const inputStyle = (w: number): React.CSSProperties => ({
  width: w,
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "var(--text)"
});

const selectStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "var(--text)"
};


