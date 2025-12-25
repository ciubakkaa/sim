import React, { useMemo } from "react";
import type { ChronicleEntry, FactionOperation, WorldState } from "../../lib/protocol";

type Props = {
  world: WorldState | null;
  onSelectNpcId?: (npcId: string) => void;
  onSelectSiteId?: (siteId: string) => void;
};

export function WorldPanel(props: Props) {
  const labelNpc = (id: string | undefined) => {
    if (!id) return "(none)";
    const w: any = props.world as any;
    const n = w?.npcs?.[id];
    if (n?.name) return String(n.name);
    return String(id);
  };

  const ops = useMemo(() => {
    const world = props.world as any;
    const map: Record<string, FactionOperation> | undefined = world?.operations;
    if (!map) return [];
    return Object.values(map).slice().sort((a: any, b: any) => (b.createdTick ?? 0) - (a.createdTick ?? 0));
  }, [props.world]);

  const chronicle = useMemo(() => {
    const world = props.world as any;
    const c = world?.chronicle;
    const entries: ChronicleEntry[] = c?.entries ?? [];
    return entries.slice(-20).reverse();
  }, [props.world]);

  const arcs = useMemo(() => {
    const world = props.world as any;
    const c = world?.chronicle;
    const a: any[] = c?.arcs ?? [];
    return a.slice().sort((x: any, y: any) => (y.startTick ?? 0) - (x.startTick ?? 0)).slice(0, 10);
  }, [props.world]);

  const findOpById = (id: string | undefined) => {
    if (!id) return null;
    const w: any = props.world as any;
    const ops: Record<string, any> | undefined = w?.operations;
    return ops?.[id] ?? null;
  };

  const renderNpcLinks = (ids: unknown, limit = 4) => {
    const arr = Array.isArray(ids) ? (ids as any[]).map((x) => String(x)) : [];
    if (!arr.length) return <span>(none)</span>;
    const shown = arr.slice(0, limit);
    const extra = arr.length - shown.length;
    return (
      <>
        {shown.map((id, idx) => (
          <React.Fragment key={id}>
            {idx ? <span style={{ color: "var(--muted)" }}>, </span> : null}
            <button type="button" onClick={() => props.onSelectNpcId?.(id)} style={linkBtn} title="Jump to NPC">
              {labelNpc(id)}
            </button>
          </React.Fragment>
        ))}
        {extra > 0 ? <span style={{ color: "var(--muted)" }}> +{extra}</span> : null}
      </>
    );
  };

  const renderActPreview = (a: any, limit = 4) => {
    const acts = Array.isArray(a?.acts) ? a.acts : [];
    if (!acts.length) return null;
    const idx = Number(a?.actIndex ?? 0);
    const start = Math.max(0, idx - 1);
    const shown = acts.slice(start, start + limit);
    return (
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
        {shown.map((act: any, i: number) => {
          const actName = String(act?.name ?? `Act ${start + i + 1}`);
          const isCurrent = start + i === idx;
          return (
            <span key={String(act?.id ?? `${start + i}`)} style={{ fontWeight: isCurrent ? 700 : 400 }}>
              {isCurrent ? "▶ " : ""}
              {actName}
              {i < shown.length - 1 ? <span style={{ color: "var(--muted)" }}> → </span> : null}
            </span>
          );
        })}
        {acts.length > start + shown.length ? <span style={{ color: "var(--muted)" }}> → …</span> : null}
      </div>
    );
  };

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
        <div style={{ fontWeight: 700 }}>World</div>
        <div style={{ flex: 1 }} />
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          ops={ops.length} • chron={chronicle.length} • arcs={arcs.length}
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Operations</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>({ops.length})</div>
          </div>
          {ops.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
          ) : (
            ops.slice(0, 10).map((o: any) => (
              <div key={String(o.id)} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {String(o.factionId)} • {String(o.type)}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{String(o.status)}</div>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  @
                  <button type="button" onClick={() => props.onSelectSiteId?.(String(o.siteId))} style={linkBtn} title="Jump to site">
                    {String(o.siteId)}
                  </button>{" "}
                  leader=
                  <button type="button" onClick={() => props.onSelectNpcId?.(String(o.leaderNpcId))} style={linkBtn} title="Jump to NPC">
                    {labelNpc(String(o.leaderNpcId))}
                  </button>{" "}
                  target=
                  {o.targetNpcId ? (
                    <button type="button" onClick={() => props.onSelectNpcId?.(String(o.targetNpcId))} style={linkBtn} title="Jump to NPC">
                      {labelNpc(String(o.targetNpcId))}
                    </button>
                  ) : (
                    "(none)"
                  )}
                </div>
                {"participantNpcIds" in o ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    participants={renderNpcLinks((o as any).participantNpcIds)}
                    {(o as any).participantRoles ? (
                      <span style={{ color: "var(--muted)" }}> • roles=yes</span>
                    ) : null}
                  </div>
                ) : null}
                {typeof o.phaseIndex === "number" ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>phase={Number(o.phaseIndex) + 1}</div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Arcs</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>({arcs.length})</div>
          </div>
          {arcs.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              (none yet) <span style={{ opacity: 0.85 }}>Arcs are currently created from faction operations.</span>
            </div>
          ) : (
            arcs.map((a: any) => (
              <div key={String(a.id)} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {String(a.title ?? a.kind ?? a.id)}
                    {a.operationId ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={() => {
                            const op = findOpById(String(a.operationId));
                            if (op?.targetNpcId) props.onSelectNpcId?.(String(op.targetNpcId));
                            else if (op?.leaderNpcId) props.onSelectNpcId?.(String(op.leaderNpcId));
                            else if (a.siteId) props.onSelectSiteId?.(String(a.siteId));
                          }}
                          style={linkBtn}
                          title="Follow story"
                        >
                          follow
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{String(a.status ?? "")}</div>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  act {Number(a.actIndex ?? 0) + 1}/{Array.isArray(a.acts) ? a.acts.length : 0}
                  {Array.isArray(a.acts) && a.acts[Number(a.actIndex ?? 0)]?.name ? ` • ${String(a.acts[Number(a.actIndex ?? 0)]?.name)}` : ""}
                  {a.operationId ? ` • op=${String(a.operationId)}` : ""}
                </div>
                {renderActPreview(a)}
              </div>
            ))
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Chronicle</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>({chronicle.length})</div>
          </div>
          {chronicle.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
          ) : (
            chronicle.map((e: any) => (
              <div key={String(e.id)} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{String(e.kind)}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>t{String(e.tick)}</div>
                </div>
                <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>{String(e.headline ?? e.description ?? "")}</div>
                <div style={{ color: "var(--muted)", fontSize: 11 }}>
                  {e.siteId ? (
                    <>
                      @
                      <button type="button" onClick={() => props.onSelectSiteId?.(String(e.siteId))} style={linkBtn} title="Jump to site">
                        {String(e.siteId)}
                      </button>
                    </>
                  ) : (
                    ""
                  )}{" "}
                  {e.significance ? `• ${String(e.significance)}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "rgba(0,0,0,0.10)",
  padding: 10
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  color: "rgba(255,255,255,0.85)",
  cursor: "pointer",
  textDecoration: "underline"
};


