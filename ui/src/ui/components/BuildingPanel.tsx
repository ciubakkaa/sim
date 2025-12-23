import React, { useMemo } from "react";
import type { BuildingState, SettlementSiteState, WorldState } from "../../lib/protocol";

type Props = {
  world: WorldState | null;
  siteId: string | null;
  locationId: string | null;
  onSelectLocationId: (id: string | null) => void;
  onJumpToNpc: (npcId: string) => void;
};

function asSettlementSite(s: any): SettlementSiteState | null {
  if (!s || s.kind !== "settlement") return null;
  return s as SettlementSiteState;
}

export function BuildingPanel(props: Props) {
  const site = props.world && props.siteId ? asSettlementSite((props.world.sites as any)[props.siteId]) : null;
  const local = site?.local;
  const tick = props.world?.tick ?? 0;

  const selectedBuilding: BuildingState | null = useMemo(() => {
    if (!local || !props.locationId) return null;
    return local.buildings[props.locationId] ?? null;
  }, [local, props.locationId]);

  const occupants = useMemo(() => {
    if (!props.world || !site || !props.locationId) return [];
    const npcs = Object.values(props.world.npcs);
    return npcs
      .filter((n) => n.alive && n.siteId === site.id && n.local?.locationId === props.locationId && !n.localTravel)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.locationId, props.world, site]);

  const residents = useMemo(() => {
    if (!props.world || !site || !props.locationId) return [];
    const npcs = Object.values(props.world.npcs);
    return npcs
      .filter((n) => n.alive && n.homeLocationId === props.locationId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.locationId, props.world, site]);

  const node = useMemo(() => {
    if (!local || !props.locationId) return null;
    return local.nodes.find((n) => n.id === props.locationId) ?? null;
  }, [local, props.locationId]);

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "44px 1fr", minHeight: 0 }}>
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
        <div style={{ fontWeight: 700 }}>Building</div>
        <div style={{ flex: 1 }} />
        {props.locationId ? (
          <button onClick={() => props.onSelectLocationId(null)} style={btnStyle}>
            Clear
          </button>
        ) : null}
      </div>

      <div style={{ overflow: "auto", padding: 12 }}>
        {!site || !local ? (
          <div style={{ color: "var(--muted)" }}>Select a settlement to inspect buildings.</div>
        ) : !props.locationId ? (
          <div style={{ color: "var(--muted)" }}>Click a building in the settlement view.</div>
        ) : !node ? (
          <div style={{ color: "var(--muted)" }}>Unknown location: {props.locationId}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>{node.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{node.kind}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{node.id}</div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Inventory</div>
              {!selectedBuilding ? (
                <div style={{ color: "var(--muted)" }}>No inventory data.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    books: {selectedBuilding.inventory.books ?? 0}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    food:{" "}
                    {selectedBuilding.inventory.food
                      ? Object.entries(selectedBuilding.inventory.food)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")
                      : "(none)"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    items:{" "}
                    {selectedBuilding.inventory.items
                      ? Object.entries(selectedBuilding.inventory.items)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")
                      : "(none)"}
                  </div>
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>Occupants</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>({occupants.length})</div>
              </div>
              {occupants.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>No one is here right now.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {occupants.slice(0, 60).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => props.onJumpToNpc(n.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "var(--text)",
                        cursor: "pointer"
                      }}
                    >
                      <div>
                        {n.name}{" "}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          {n.busyUntilTick > tick ? `• ${n.busyKind ?? "busy"} (${n.busyUntilTick - tick}t)` : ""}
                        </span>
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.category}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {node.kind === "house" ? (
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>Residents</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>({residents.length})</div>
                </div>
                {residents.length === 0 ? (
                  <div style={{ color: "var(--muted)" }}>No registered residents.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {residents.slice(0, 60).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => props.onJumpToNpc(n.id)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        <div>
                          {n.name}{" "}
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            {n.siteId === site.id ? "" : `• @${n.siteId}`}{" "}
                            {n.busyUntilTick > tick ? `• ${n.busyKind ?? "busy"} (${n.busyUntilTick - tick}t)` : ""}
                          </span>
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.category}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
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


