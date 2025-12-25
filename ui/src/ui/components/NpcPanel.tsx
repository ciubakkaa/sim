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
  const goals = selected?.goals ?? [];
  const recent = selected?.recentActions ?? [];
  const debts = (selected as any)?.debts as any[] | undefined;
  const inv = (selected as any)?.inventory as any | undefined;
  const knowledge = (selected as any)?.knowledge as any | undefined;
  const plan = (selected as any)?.plan as any | undefined;
  const emotions = (selected as any)?.emotions as any | undefined;
  const memories = (selected as any)?.episodicMemory as any[] | undefined;

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "52px 1fr 320px", minHeight: 0 }}>
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

            {!selected.alive && selected.death ? (
              <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>
                died t{selected.death.tick} • cause={String(selected.death.cause)}
                {selected.death.atSiteId ? ` • at=${String(selected.death.atSiteId)}` : ""}
                {selected.death.byNpcId ? (
                  <>
                    {" "}
                    • by=
                    <button
                      type="button"
                      onClick={() => props.onSelectNpcId(String(selected.death?.byNpcId))}
                      style={{ background: "transparent", border: "none", padding: 0, margin: 0, color: "rgba(255,255,255,0.85)", cursor: "pointer", textDecoration: "underline" }}
                      title="Jump to killer"
                    >
                      {world?.npcs?.[String(selected.death.byNpcId)]?.name ?? String(selected.death.byNpcId)}
                    </button>
                  </>
                ) : (
                  ""
                )}
              </div>
            ) : null}

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
              {inv ? <span>coins={Math.round(Number(inv.coins ?? 0))}</span> : null}
              {debts?.length ? <span>debts={debts.length}</span> : null}
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

                <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>Emotions</div>
                {!emotions ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  (["stress", "fear", "anger", "grief", "gratitude", "pride", "shame"] as const).map((k) => {
                    const v = clamp(Number(emotions[k] ?? 0), 0, 100);
                    return (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "90px 1fr 34px", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{k}</div>
                        <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ width: `${v}%`, height: "100%", background: v >= 70 ? "var(--warn)" : "rgba(255,255,255,0.55)" }} />
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right" }}>{Math.round(v)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Goals</div>
                {goals.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  goals
                    .slice()
                    .sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0))
                    .slice(0, 8)
                    .map((g: any) => (
                      <div key={g.definitionId} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ color: "var(--text)", fontSize: 12 }}>{g.definitionId}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>prio={Math.round(Number(g.priority ?? 0))}</div>
                      </div>
                    ))
                )}
              </div>

              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Memories</div>
                {!memories?.length ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  memories
                    .slice()
                    .sort((a: any, b: any) => (b.tick ?? 0) - (a.tick ?? 0))
                    .slice(0, 8)
                    .map((m: any) => (
                      <div key={String(m.id)} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ color: "var(--text)", fontSize: 12 }}>{String(m.eventType)}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>t{String(m.tick)}</div>
                        </div>
                        {m.description ? <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>{String(m.description)}</div> : null}
                      </div>
                    ))
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent actions</div>
                {recent.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  recent
                    .slice(-10)
                    .reverse()
                    .map((a: any, i: number) => (
                      <div key={i} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ color: "var(--text)", fontSize: 12 }}>{a.kind}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>t{a.tick}</div>
                        </div>
                        {a.why?.text ? (
                          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 2 }}>{a.why.text}</div>
                        ) : null}
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* Simulation state (plan/inventory/debts/knowledge) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 0 }}>
              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Plan</div>
                {!plan ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>goal={String(plan.goal)}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      step {Number(plan.stepIndex ?? 0) + 1}/{Array.isArray(plan.steps) ? plan.steps.length : 0}
                    </div>
                    {plan.reason ? <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{String(plan.reason)}</div> : null}
                    {Array.isArray(plan.steps) ? (
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        steps:{" "}
                        {plan.steps
                          .slice(0, 6)
                          .map((s: any, i: number) => `${i === Number(plan.stepIndex ?? 0) ? "▶" : ""}${s.kind}`)
                          .join(" → ")}
                      </div>
                    ) : null}
                  </div>
                )}

                <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>Inventory</div>
                {!inv ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>coins={Math.round(Number(inv.coins ?? 0))}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      food:{" "}
                      {inv.food
                        ? Object.entries(inv.food)
                            .map(([k, v]) => `${k}=${Math.round(Number(v))}`)
                            .join(", ")
                        : "(none)"}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ minHeight: 0, overflow: "auto" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Debts</div>
                {!debts?.length ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  (debts as any[])
                    .slice()
                    .sort((a: any, b: any) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
                    .slice(0, 8)
                    .map((d: any) => (
                      <div key={String(d.id)} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ color: "var(--text)", fontSize: 12 }}>
                            {String(d.direction)} {String(d.otherNpcId)}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(Number(d.magnitude ?? 0))}</div>
                        </div>
                        {d.reason ? <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>{String(d.reason)}</div> : null}
                      </div>
                    ))
                )}

                <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>Knowledge</div>
                {!knowledge?.facts?.length && !knowledge?.secrets?.length ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>(none)</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {knowledge?.facts?.length ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Facts</div>
                        {knowledge.facts
                          .slice()
                          .sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.tick ?? 0) - (a.tick ?? 0))
                          .slice(0, 8)
                          .map((f: any) => (
                            <div key={String(f.id)} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                                {String(f.kind)} {String(f.subjectId)}
                                {f.object ? <span style={{ color: "rgba(255,255,255,0.7)" }}> • {String(f.object)}</span> : null}
                              </div>
                              <div style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(Number(f.confidence ?? 0))}</div>
                            </div>
                          ))}
                      </div>
                    ) : null}

                    {knowledge?.secrets?.length ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Secrets</div>
                        {knowledge.secrets
                          .slice()
                          .sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.learnedTick ?? 0) - (a.learnedTick ?? 0))
                          .slice(0, 8)
                          .map((s: any) => (
                            <div key={String(s.secretId)} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ color: "var(--muted)", fontSize: 12 }}>{String(s.secretId)}</div>
                              <div style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(Number(s.confidence ?? 0))}</div>
                            </div>
                          ))}
                      </div>
                    ) : null}
                  </div>
                )}
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


