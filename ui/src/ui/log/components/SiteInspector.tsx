import React, { useMemo } from "react";
import type { LocalNode, SettlementSiteState, SimEvent, WorldState } from "../../../lib/protocol";
import { getAttempt } from "../metrics";

type Props = {
  world: WorldState | null;
  events: SimEvent[];
  siteId: string | null;
  selectedLocationId: string | null;
  onSelectLocationId: (id: string | null) => void;
  onSelectEventId: (id: string) => void;
};

function asSettlementSite(s: any): SettlementSiteState | null {
  if (!s || s.kind !== "settlement") return null;
  return s as SettlementSiteState;
}

export function SiteInspector(props: Props) {
  const site = props.world && props.siteId ? (props.world.sites as any)[props.siteId] : null;
  const settlement = asSettlementSite(site);
  const local = settlement?.local;

  const siteEvents = useMemo(() => {
    if (!props.siteId) return [];
    return props.events.filter((e) => e.siteId === props.siteId);
  }, [props.events, props.siteId]);

  const nodes = useMemo(() => {
    if (!local) return [];
    return [...local.nodes].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }, [local]);

  if (!site) return <div style={{ padding: 12, color: "var(--muted)" }}>Select a site/city to inspect.</div>;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{(site as any).name ?? site.id}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{site.id}</div>
        <div style={{ flex: 1 }} />
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {site.kind} • {(site as any).culture ?? ""}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Buildings</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({nodes.length})</div>
          <div style={{ flex: 1 }} />
          {props.selectedLocationId ? (
            <button onClick={() => props.onSelectLocationId(null)} style={btnStyle}>
              Clear building filter
            </button>
          ) : null}
        </div>
        {!local ? (
          <div style={{ color: "var(--muted)" }}>No local layout available for this site.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {nodes.slice(0, 80).map((n: LocalNode) => (
              <button
                key={n.id}
                onClick={() => props.onSelectLocationId(n.id)}
                style={{
                  ...rowStyle,
                  cursor: "pointer",
                  textAlign: "left",
                  borderColor: n.id === props.selectedLocationId ? "rgba(255,255,255,0.35)" : "var(--border)",
                  background: n.id === props.selectedLocationId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)"
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontWeight: 700 }}>{n.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.kind}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.id.split(":").slice(-1)[0]}</div>
                </div>
              </button>
            ))}
            {nodes.length > 80 ? <div style={{ color: "var(--muted)", fontSize: 12 }}>Showing first 80.</div> : null}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Site events</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({siteEvents.length})</div>
        </div>
        {siteEvents.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No events at this site in the loaded log.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {siteEvents.slice(-80).reverse().map((e) => {
              const a: any = getAttempt(e);
              const why = a?.why?.text;
              return (
                <button
                  key={e.id}
                  onClick={() => props.onSelectEventId(e.id)}
                  style={{ ...rowStyle, cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ color: "var(--muted)", fontSize: 12, width: 84, flexShrink: 0 }}>t{e.tick}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13 }}>
                        {e.kind}
                        {a?.kind ? <span style={{ color: "rgba(255,255,255,0.75)" }}> • {a.kind}</span> : null}
                        {why ? <span style={{ color: "rgba(255,255,255,0.65)" }}> • {why}</span> : null}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{e.message}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer"
};

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


