import React, { useMemo } from "react";
import type { SimEvent, WorldState } from "../../../lib/protocol";
import { getAttempt } from "../metrics";

type Props = {
  world: WorldState | null;
  events: SimEvent[];
  npcId: string | null;
  onSelectEventId: (id: string) => void;
};

function labelNpc(world: WorldState | null, npcId: string | undefined): string {
  if (!npcId) return "";
  const n = world?.npcs?.[npcId];
  return n ? `${n.name} (${npcId})` : npcId;
}

function labelGoal(defId: string): string {
  // Keep v1 simple. We can add a nicer label map later.
  return defId;
}

export function NpcInspector(props: Props) {
  const npc = props.world && props.npcId ? props.world.npcs[props.npcId] : null;

  const npcEvents = useMemo(() => {
    if (!props.npcId) return [];
    const out: SimEvent[] = [];
    for (const e of props.events) {
      const a = getAttempt(e) as any;
      if (!a) continue;
      if (a.actorId === props.npcId) out.push(e);
    }
    return out;
  }, [props.events, props.npcId]);

  if (!npc) return <div style={{ padding: 12, color: "var(--muted)" }}>Select an NPC to inspect goals and actions.</div>;

  const goals = (npc.goals ?? []).slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.definitionId.localeCompare(b.definitionId));
  const intents = (npc.intents ?? []).slice().sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0) || String(a.kind).localeCompare(String(b.kind)));
  const debts = npc.debts ?? [];
  const inv = npc.inventory;
  const knowledge = npc.knowledge;
  const plan = npc.plan;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{npc.name}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{npc.id}</div>
        <div style={{ flex: 1 }} />
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{npc.category}</div>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        site={npc.siteId} • home={npc.homeSiteId} • cult={npc.cult?.member ? "yes" : "no"} • family={npc.familyIds?.length ?? 0}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Plan</div>
          <div style={{ flex: 1 }} />
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{plan ? "active" : "(none)"}</div>
        </div>
        {!plan ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>goal={plan.goal}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              step {Number(plan.stepIndex ?? 0) + 1}/{plan.steps?.length ?? 0}
            </div>
            {plan.reason ? <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{plan.reason}</div> : null}
            {plan.steps?.length ? (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                steps:{" "}
                {plan.steps
                  .slice(0, 8)
                  .map((s, i) => `${i === Number(plan.stepIndex ?? 0) ? "▶" : ""}${s.kind}`)
                  .join(" → ")}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Inventory</div>
          <div style={{ flex: 1 }} />
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{inv ? `coins=${Math.round(Number(inv.coins ?? 0))}` : "(none)"}</div>
        </div>
        {!inv ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
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

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Debts</div>
          <div style={{ flex: 1 }} />
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({debts.length})</div>
        </div>
        {debts.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {debts
              .slice()
              .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
              .slice(0, 12)
              .map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                  <div style={{ color: "var(--text)" }}>
                    {d.direction} {labelNpc(props.world, d.otherNpcId)} • {d.debtKind}
                    {d.reason ? <span style={{ color: "rgba(255,255,255,0.65)" }}> • {d.reason}</span> : null}
                  </div>
                  <div style={{ color: "var(--muted)" }}>{Math.round(Number(d.magnitude ?? 0))}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Knowledge</div>
          <div style={{ flex: 1 }} />
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            facts={knowledge?.facts?.length ?? 0} • secrets={knowledge?.secrets?.length ?? 0}
          </div>
        </div>
        {!knowledge?.facts?.length && !knowledge?.secrets?.length ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {knowledge?.facts?.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Facts</div>
                {knowledge.facts
                  .slice()
                  .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.tick ?? 0) - (a.tick ?? 0))
                  .slice(0, 10)
                  .map((f) => (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                      <div style={{ color: "var(--muted)" }}>
                        {f.kind} {labelNpc(props.world, f.subjectId)}
                        {f.object ? <span style={{ color: "rgba(255,255,255,0.7)" }}> • {String(f.object)}</span> : null}
                      </div>
                      <div style={{ color: "var(--muted)" }}>{Math.round(Number(f.confidence ?? 0))}</div>
                    </div>
                  ))}
              </div>
            ) : null}
            {knowledge?.secrets?.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Secrets</div>
                {knowledge.secrets.slice(0, 10).map((s) => (
                  <div key={s.secretId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                    <div style={{ color: "var(--muted)" }}>{s.secretId}</div>
                    <div style={{ color: "var(--muted)" }}>{Math.round(Number(s.confidence ?? 0))}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Goals</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({goals.length})</div>
        </div>
        {goals.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No goals on snapshot (or goal system not available in this view).</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {goals.slice(0, 12).map((g) => (
              <div key={g.definitionId} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ color: "var(--text)" }}>{labelGoal(g.definitionId)}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>prio={Math.round(Number(g.priority ?? 0))}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Intents</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({intents.length})</div>
        </div>
        {intents.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>(none)</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {intents.slice(0, 12).map((it) => (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ color: "var(--text)" }}>
                  {it.kind}
                  {it.targetNpcId ? <span style={{ color: "var(--muted)", fontSize: 12 }}> • target={labelNpc(props.world, it.targetNpcId)}</span> : null}
                  {it.targetSiteId ? <span style={{ color: "var(--muted)", fontSize: 12 }}> • site={it.targetSiteId}</span> : null}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round(Number(it.intensity ?? 0))}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Actions</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>({npcEvents.length})</div>
        </div>
        {npcEvents.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No actions found for this NPC in the loaded event log.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {npcEvents.slice(-60).reverse().map((e) => {
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
                        {a?.kind ?? e.kind}
                        {why ? <span style={{ color: "rgba(255,255,255,0.7)" }}> • {why}</span> : null}
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

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent actions (from snapshot)</div>
        {(npc.recentActions?.length ?? 0) === 0 ? (
          <div style={{ color: "var(--muted)" }}>No recentActions available.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {npc.recentActions!.slice(-20).reverse().map((ra, i) => (
              <div key={i} style={{ display: "flex", gap: 10 }}>
                <div style={{ color: "var(--muted)", width: 84, fontSize: 12 }}>t{ra.tick}</div>
                <div style={{ fontSize: 12 }}>
                  {ra.kind}
                  {ra.why?.text ? <span style={{ color: "rgba(255,255,255,0.7)" }}> • {ra.why.text}</span> : null}
                </div>
              </div>
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


