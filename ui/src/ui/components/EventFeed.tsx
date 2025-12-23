import React, { useMemo, useState } from "react";
import type { SimEvent, WorldState } from "../../lib/protocol";
import { getAttempt, getPrimaryActorId } from "../log/metrics";
import { groupEventsByAction } from "../log/grouping";

type Props = {
  events: SimEvent[];
  selectedNpcId: string | null;
  selectedSiteId: string | null;
  world?: WorldState | null;
  selectedEventId?: string | null;
  onSelectEventId?: (id: string) => void;
  actorAllowlist?: Set<string> | null;
  locationIdFilter?: string | null;
};

function compactKind(kind: string): string {
  return kind.replaceAll("attempt.recorded", "attempt").replaceAll("world.", "").replaceAll("sim.", "");
}

export function EventFeed(props: Props) {
  const [textFilter, setTextFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [viewMode, setViewMode] = useState<"action" | "flat" | "kind" | "actor" | "site">("action");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const tf = textFilter.trim().toLowerCase();
    const kf = kindFilter.trim().toLowerCase();
    const site = props.selectedSiteId;
    const npc = props.selectedNpcId;
    const allow = props.actorAllowlist;
    const loc = props.locationIdFilter;

    return props.events
      .filter((e) => (kf ? e.kind.toLowerCase().includes(kf) : true))
      .filter((e) => (site ? e.siteId === site : true))
      .filter((e) => {
        if (!loc) return true;
        const d: any = e.data ?? {};
        if (e.kind === "local.action.performed") return d.locationId === loc;
        const a = d.attempt;
        const locationId = a?.resources?.locationId;
        return locationId === loc;
      })
      .filter((e) => {
        if (!npc) return true;
        const d = e.data ?? {};
        const attempt = (d as any).attempt;
        return (attempt?.actorId === npc || attempt?.targetId === npc || (d as any).npcId === npc) ?? false;
      })
      .filter((e) => {
        if (!allow) return true;
        const d: any = e.data ?? {};
        const a = d.attempt;
        const actorId = a?.actorId ?? d.npcId;
        if (!actorId) return false;
        return allow.has(String(actorId));
      })
      .filter((e) => (tf ? `${e.kind} ${e.message} ${e.siteId ?? ""}`.toLowerCase().includes(tf) : true));
  }, [kindFilter, props.actorAllowlist, props.events, props.locationIdFilter, props.selectedNpcId, props.selectedSiteId, textFilter]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    for (const e of props.events) s.add(e.kind);
    return Array.from(s).sort();
  }, [props.events]);

  const groupKeyLabel = (key: string, mode: "kind" | "actor" | "site") => {
    if (mode === "kind") return key;
    if (mode === "site") return key ? `@${key}` : "(no site)";
    // actor
    const n = key ? props.world?.npcs?.[key]?.name : undefined;
    return key ? `${n ? `${n} • ` : ""}${key}` : "(no actor)";
  };

  function toggleOpen(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        <select value={viewMode} onChange={(e) => setViewMode(e.target.value as any)} style={selectStyle}>
          <option value="action">Grouped: action</option>
          <option value="flat">Flat</option>
          <option value="kind">Grouped: kind</option>
          <option value="actor">Grouped: actor</option>
          <option value="site">Grouped: site</option>
        </select>
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
            {(() => {
              if (viewMode === "flat") {
                return filtered.slice(-250).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => props.onSelectEventId?.(e.id)}
                    style={{
                      ...rowStyle,
                      cursor: props.onSelectEventId ? "pointer" : "default",
                      textAlign: "left",
                      borderColor: e.id === props.selectedEventId ? "rgba(255,255,255,0.35)" : "var(--border)",
                      background: e.id === props.selectedEventId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)"
                    }}
                  >
                    <div style={{ color: "var(--muted)", fontSize: 12, width: 78, flexShrink: 0 }}>
                      t{e.tick} • {compactKind(e.kind)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13 }}>{e.message}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                      </div>
                      {e.kind === "attempt.recorded" ? (
                        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 6 }}>
                          {(() => {
                            const a: any = getAttempt(e);
                            const actorId = a?.actorId;
                            const name = actorId ? props.world?.npcs?.[actorId]?.name : undefined;
                            const why = a?.why?.text;
                            return `${name ? `${name} • ` : ""}${a?.kind ?? "attempt"}${why ? ` • ${why}` : ""}`;
                          })()}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ));
              }

              if (viewMode === "action") {
                const { groups, ungrouped } = groupEventsByAction(filtered, props.world);
                const visibleGroups = groups.slice(-120);
                const visibleUngrouped = ungrouped.slice(-80);

                return (
                  <>
                    {visibleGroups.map((g) => {
                      const open = openGroups.has(g.id);
                      return (
                        <div key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                          <button
                            onClick={() => {
                              toggleOpen(g.id);
                              const rep = g.events.find((e) => e.kind === "attempt.started") ?? g.events[g.events.length - 1];
                              if (rep?.id) props.onSelectEventId?.(rep.id);
                            }}
                            style={{
                              width: "100%",
                              ...rowStyle,
                              border: "none",
                              borderRadius: 0,
                              background: "rgba(0,0,0,0.18)",
                              cursor: "pointer"
                            }}
                          >
                            <div style={{ color: "var(--muted)", fontSize: 12, width: 92, flexShrink: 0 }}>
                              t{g.startTick}
                              {g.endTick !== g.startTick ? `→t${g.endTick}` : ""} • action
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                                <div style={{ fontSize: 13, fontWeight: 700 }}>{g.title}</div>
                                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                                  {open ? "▼" : "▶"} {g.events.length} events
                                </div>
                              </div>
                              {g.subtitle ? (
                                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 6 }}>{g.subtitle}</div>
                              ) : null}
                            </div>
                          </button>

                          {open ? (
                            <div style={{ padding: 10, background: "rgba(0,0,0,0.10)", display: "flex", flexDirection: "column", gap: 8 }}>
                              {g.events.map((e) => (
                                <button
                                  key={e.id}
                                  onClick={() => props.onSelectEventId?.(e.id)}
                                  style={{
                                    ...subRowStyle,
                                    borderColor: e.id === props.selectedEventId ? "rgba(255,255,255,0.35)" : "var(--border)",
                                    background: e.id === props.selectedEventId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)"
                                  }}
                                >
                                  <div style={{ color: "var(--muted)", fontSize: 12, width: 120, flexShrink: 0 }}>
                                    t{e.tick} • {compactKind(e.kind)}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12 }}>{e.message}</div>
                                    <div style={{ color: "var(--muted)", fontSize: 11 }}>
                                      {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {visibleUngrouped.length ? (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0" }}>Other events</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {visibleUngrouped.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => props.onSelectEventId?.(e.id)}
                              style={{
                                ...rowStyle,
                                cursor: props.onSelectEventId ? "pointer" : "default",
                                textAlign: "left",
                                borderColor: e.id === props.selectedEventId ? "rgba(255,255,255,0.35)" : "var(--border)",
                                background: e.id === props.selectedEventId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)"
                              }}
                            >
                              <div style={{ color: "var(--muted)", fontSize: 12, width: 78, flexShrink: 0 }}>
                                t{e.tick} • {compactKind(e.kind)}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13 }}>{e.message}</div>
                                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                                  {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              }

              // Grouped: kind/actor/site (full list, no ungrouped bucket).
              const mode = viewMode;
              const groupedEvents = new Map<string, SimEvent[]>();
              for (const e of filtered) {
                const key =
                  mode === "kind"
                    ? e.kind
                    : mode === "site"
                      ? e.siteId ?? ""
                      : getPrimaryActorId(e) ?? "";
                const arr = groupedEvents.get(key) ?? [];
                arr.push(e);
                groupedEvents.set(key, arr);
              }

              const groups = Array.from(groupedEvents.entries())
                .map(([key, evs]) => ({
                  id: `${mode}:${key || "(none)"}`,
                  key,
                  label: groupKeyLabel(key, mode),
                  startTick: evs[0]?.tick ?? 0,
                  endTick: evs[evs.length - 1]?.tick ?? 0,
                  events: evs
                }))
                .sort((a, b) => b.events.length - a.events.length || a.label.localeCompare(b.label));

              const visible = groups.slice(0, 120);

              return visible.map((g) => {
                const open = openGroups.has(g.id);
                const shownEvents = g.events.slice(-120);
                return (
                  <div key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    <button
                      onClick={() => toggleOpen(g.id)}
                      style={{
                        width: "100%",
                        ...rowStyle,
                        border: "none",
                        borderRadius: 0,
                        background: "rgba(0,0,0,0.18)",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12, width: 92, flexShrink: 0 }}>
                        t{g.startTick}
                        {g.endTick !== g.startTick ? `→t${g.endTick}` : ""} • {mode}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{g.label || "(none)"}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {open ? "▼" : "▶"} {g.events.length} events
                          </div>
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 6 }}>
                          Showing last {shownEvents.length} in this group
                        </div>
                      </div>
                    </button>

                    {open ? (
                      <div style={{ padding: 10, background: "rgba(0,0,0,0.10)", display: "flex", flexDirection: "column", gap: 8 }}>
                        {shownEvents.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => props.onSelectEventId?.(e.id)}
                            style={{
                              ...subRowStyle,
                              borderColor: e.id === props.selectedEventId ? "rgba(255,255,255,0.35)" : "var(--border)",
                              background: e.id === props.selectedEventId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)"
                            }}
                          >
                            <div style={{ color: "var(--muted)", fontSize: 12, width: 120, flexShrink: 0 }}>
                              t{e.tick} • {compactKind(e.kind)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12 }}>{e.message}</div>
                              <div style={{ color: "var(--muted)", fontSize: 11 }}>
                                {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              });
            })()}
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
  gap: 10,
  color: "var(--text)"
};

const subRowStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  display: "flex",
  gap: 10,
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left"
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


