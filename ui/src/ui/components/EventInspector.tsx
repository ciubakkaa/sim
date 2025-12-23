import React, { useMemo } from "react";
import type { SimEvent, WorldState } from "../../lib/protocol";
import { getAttempt, getActorId, getAttemptKind, getTargetId } from "../log/metrics";

type Props = {
  world?: WorldState | null;
  events: SimEvent[];
  selectedEventId: string | null;
  onSelectEventId: (id: string | null) => void;
};

function labelNpc(world: WorldState | null | undefined, npcId: string | undefined): string {
  if (!npcId) return "";
  const n = world?.npcs?.[npcId];
  return n ? `${n.name} (${npcId})` : npcId;
}

function pretty(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function EventInspector(props: Props) {
  const e = useMemo(() => props.events.find((x) => x.id === props.selectedEventId) ?? null, [props.events, props.selectedEventId]);

  const idx = useMemo(() => (e ? props.events.findIndex((x) => x.id === e.id) : -1), [e, props.events]);

  const trace = useMemo(() => {
    if (!e || idx < 0) return [];
    const actorId = getActorId(e);
    const siteId = e.siteId;
    const start = Math.max(0, idx - 40);
    const end = Math.min(props.events.length, idx + 1);
    const window = props.events.slice(start, end);
    const filtered = window.filter((x) => {
      if (x.id === e.id) return true;
      if (actorId) {
        const a = getActorId(x);
        const t = getTargetId(x);
        if (a === actorId || t === actorId) return true;
      }
      if (siteId && x.siteId === siteId) return true;
      return false;
    });
    return filtered.slice(-18);
  }, [e, idx, props.events]);

  if (!e) {
    return <div style={{ padding: 12, color: "var(--muted)" }}>Select an action/event to inspect details.</div>;
  }

  const attempt: any = getAttempt(e);
  const why: any = attempt?.why;
  const actorId = attempt?.actorId;
  const targetId = attempt?.targetId;
  const executeAtTick = (e.data as any)?.executeAtTick as number | undefined;
  const interruptedBy = (e.data as any)?.byNpcId as string | undefined;
  const interruptReason = (e.data as any)?.reason as string | undefined;

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "52px 1fr", minHeight: 0 }}>
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
        <div style={{ fontWeight: 800 }}>Event</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{e.id}</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => props.onSelectEventId(null)} style={btnStyle}>
          Close
        </button>
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <div style={{ fontWeight: 800 }}>
            t{e.tick} • {e.kind}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
          </div>
        </div>

        <div style={{ color: "var(--text)" }}>{e.message}</div>

        {attempt ? (
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Action</div>
            <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
              <div style={{ color: "var(--muted)" }}>
                kind: <span style={{ color: "var(--text)" }}>{getAttemptKind(e) ?? attempt?.kind}</span>
              </div>
              <div style={{ color: "var(--muted)" }}>
                phase: <span style={{ color: "var(--text)" }}>{e.kind}</span>
                {typeof executeAtTick === "number" ? <span style={{ color: "var(--muted)" }}> • executeAt=t{executeAtTick}</span> : null}
              </div>
              {actorId ? (
                <div style={{ color: "var(--muted)" }}>
                  actor: <span style={{ color: "var(--text)" }}>{labelNpc(props.world, actorId)}</span>
                </div>
              ) : null}
              {targetId ? (
                <div style={{ color: "var(--muted)" }}>
                  target: <span style={{ color: "var(--text)" }}>{labelNpc(props.world, targetId)}</span>
                </div>
              ) : null}
              {e.kind === "attempt.interrupted" ? (
                <div style={{ color: "var(--muted)" }}>
                  interruptedBy: <span style={{ color: "var(--text)" }}>{labelNpc(props.world, interruptedBy)}</span>
                  {interruptReason ? <span style={{ color: "var(--muted)" }}> • {interruptReason}</span> : null}
                </div>
              ) : null}
              {typeof why?.text === "string" ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Why</div>
                  <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                    {why.text}
                  </div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>No rationale attached.</div>
              )}

              {Array.isArray(why?.drivers) && why.drivers.length ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Top drivers</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {why.drivers.slice(0, 10).map((d: any, i: number) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ color: "var(--muted)" }}>
                          {d.kind}
                          {d.key ? `:${d.key}` : ""}
                          {d.note ? ` (${d.note})` : ""}
                        </div>
                        <div style={{ color: "var(--text)" }}>{typeof d.delta === "number" ? d.delta.toFixed(1) : String(d.delta)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Trace (what led to this)</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
            Last {trace.length} related events (same actor/target or same site).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trace.map((x) => (
              <button
                key={x.id}
                onClick={() => props.onSelectEventId(x.id)}
                style={{
                  ...rowStyle,
                  cursor: "pointer",
                  textAlign: "left",
                  borderColor: x.id === e.id ? "rgba(255,255,255,0.35)" : "var(--border)",
                  background: x.id === e.id ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)"
                }}
              >
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, width: 92, flexShrink: 0 }}>
                    t{x.tick} • {x.kind}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12 }}>{x.message}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {x.siteId ? `@${x.siteId}` : ""} {x.visibility ? `• ${x.visibility}` : ""}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Raw</div>
          <pre style={preStyle}>{pretty(e)}</pre>
        </div>
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

const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 11,
  color: "rgba(255,255,255,0.8)"
};


