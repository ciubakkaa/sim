import React, { useEffect, useMemo, useState } from "react";
import type { SimEvent, WorldState } from "../../lib/protocol";
import { EventFeed } from "../components/EventFeed";
import { EventInspector } from "../components/EventInspector";
import { NpcInspector } from "./components/NpcInspector";
import { SiteInspector } from "./components/SiteInspector";
import { FactionInspector, type FactionKey } from "./components/FactionInspector";
import {
  eventActorCounts,
  eventAttemptKindCounts,
  factionActorCounts,
  factionMembershipFromWorld,
  isMajorEvent,
  topN
} from "./metrics";

type Props = {
  serviceUrl: string;
};

type OpenResponse = {
  ok: boolean;
  baseDir: string;
  seed: number;
  runId: string;
  runDir: string;
  snapshotSummary: { createdAt?: string; tick: number; npcCount: number; siteCount: number };
  stats: {
    totalLines: number;
    firstTick?: number;
    lastTick?: number;
    countsByKind: Record<string, number>;
    attemptByKind: Record<string, number>;
    attemptByActor: Record<string, number>;
  };
};

type Snapshot = {
  version: number;
  seed: number;
  createdAt: string;
  world: WorldState;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function parseJsonlEvents(raw: string): SimEvent[] {
  const out: SimEvent[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as SimEvent);
    } catch {
      // ignore bad line
    }
  }
  return out;
}

export function LogView(props: Props) {
  const [baseDir, setBaseDir] = useState<string>("");
  const [seed, setSeed] = useState<number>(1);
  const [runId, setRunId] = useState<string>("");
  const [runIds, setRunIds] = useState<string[]>([]);
  const [openInfo, setOpenInfo] = useState<OpenResponse | null>(null);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);

  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedFaction, setSelectedFaction] = useState<FactionKey | null>(null);
  const [navTab, setNavTab] = useState<"npcs" | "sites" | "factions" | "buildings">("npcs");

  const [npcQuery, setNpcQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const world = snapshot?.world ?? null;

  const membership = useMemo(() => (world ? factionMembershipFromWorld(world) : null), [world]);
  const membershipV2 = useMemo(() => {
    if (!world) return null;
    const humans = membership?.humans ?? new Set<string>();
    const elves = membership?.elves ?? new Set<string>();
    const cult = membership?.cult ?? new Set<string>();
    const guards = new Set<string>();
    const bandits = new Set<string>();
    for (const n of Object.values(world.npcs)) {
      if (String(n.category).includes("Guard") || String(n.category).includes("Warrior")) guards.add(n.id);
      if (String(n.category).includes("Bandit")) bandits.add(n.id);
    }
    return { humans, elves, cult, guards, bandits } as Record<FactionKey, Set<string>>;
  }, [membership, world]);
  const actorCounts = useMemo(() => eventActorCounts(events), [events]);
  const attemptKindCounts = useMemo(() => eventAttemptKindCounts(events), [events]);
  const majorEvents = useMemo(() => events.filter(isMajorEvent).slice(-200), [events]);

  const selectedNpc = world && selectedNpcId ? world.npcs[selectedNpcId] : null;

  const filteredNpcs = useMemo(() => {
    if (!world) return [];
    const q = npcQuery.trim().toLowerCase();
    return Object.values(world.npcs)
      .filter((n) => (q ? `${n.name} ${n.id} ${n.category} ${n.siteId}`.toLowerCase().includes(q) : true))
      .sort((a, b) => (actorCounts[b.id] ?? 0) - (actorCounts[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [actorCounts, npcQuery, world]);

  const topActorsOverall = useMemo(() => topN(actorCounts, 10), [actorCounts]);
  const topAttemptKinds = useMemo(() => topN(attemptKindCounts, 12), [attemptKindCounts]);

  const topHumans = useMemo(() => (membership ? topN(factionActorCounts(events, membership.humans), 8) : []), [events, membership]);
  const topElves = useMemo(() => (membership ? topN(factionActorCounts(events, membership.elves), 8) : []), [events, membership]);
  const topCult = useMemo(() => (membership ? topN(factionActorCounts(events, membership.cult), 8) : []), [events, membership]);

  const loadRuns = async () => {
    setError(null);
    setLoading("Loading runs…");
    try {
      const params = new URLSearchParams({ seed: String(seed) });
      if (baseDir.trim()) params.set("baseDir", baseDir.trim());
      const r = await fetchJson<{ ok: boolean; runIds: string[] }>(`${props.serviceUrl}/log/runs?${params.toString()}`);
      setRunIds(r.runIds ?? []);
      if (!runId && r.runIds?.length) setRunId(r.runIds[0]!);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(null);
    }
  };

  const openRun = async () => {
    setError(null);
    setLoading("Opening run…");
    try {
      const body: any = { seed };
      if (runId.trim()) body.runId = runId.trim();
      if (baseDir.trim()) body.baseDir = baseDir.trim();
      const info = await fetchJson<OpenResponse>(`${props.serviceUrl}/log/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setOpenInfo(info);
      setSelectedNpcId(null);
      setSelectedSiteId(null);
      setSelectedEventId(null);
      setSelectedLocationId(null);
      setSelectedFaction(null);

      const snapParams = new URLSearchParams({ seed: String(seed), runId: info.runId });
      if (info.baseDir) snapParams.set("baseDir", info.baseDir);
      const snap = await fetchJson<Snapshot>(`${props.serviceUrl}/log/snapshot?${snapParams.toString()}`);
      setSnapshot(snap);

      const evParams = new URLSearchParams({ seed: String(seed), runId: info.runId });
      if (info.baseDir) evParams.set("baseDir", info.baseDir);
      const raw = await fetchText(`${props.serviceUrl}/log/events?${evParams.toString()}`);
      setEvents(parseJsonlEvents(raw));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(null);
    }
  };

  // Convenience: if user changes seed, clear run selection.
  useEffect(() => {
    setRunIds([]);
    setRunId("");
    setOpenInfo(null);
    setSnapshot(null);
    setEvents([]);
    setSelectedNpcId(null);
    setSelectedSiteId(null);
    setSelectedEventId(null);
    setSelectedLocationId(null);
    setSelectedFaction(null);
    setNavTab("npcs");
  }, [seed]);

  const selectedAllowlist = selectedFaction && membershipV2 ? membershipV2[selectedFaction] : null;

  const sites = useMemo(() => {
    if (!world) return [];
    return Object.values(world.sites).slice().sort((a: any, b: any) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
  }, [world]);

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "56px 1fr", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.12)"
        }}
      >
        <div style={{ fontWeight: 800 }}>Log Viewer</div>
        <div style={{ flex: 1 }} />

        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
          baseDir
          <input
            value={baseDir}
            onChange={(e) => setBaseDir(e.target.value)}
            placeholder="(default logs/worlds)"
            style={inputStyle(260)}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
          seed
          <input value={String(seed)} onChange={(e) => setSeed(Number(e.target.value) || 1)} style={inputStyle(90)} />
        </label>

        <button onClick={loadRuns} style={btnStyle}>
          Load runs
        </button>
        <select value={runId} onChange={(e) => setRunId(e.target.value)} style={selectStyle}>
          <option value="">(select run)</option>
          {runIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button onClick={openRun} style={btnStyle}>
          Open
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr 420px", gap: 12, padding: 12, minHeight: 0 }}>
        <div style={panelStyle}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Navigate</div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setNavTab("npcs")} style={{ ...btnStyle, borderColor: navTab === "npcs" ? "rgba(255,255,255,0.35)" : "var(--border)" }}>
                  NPCs
                </button>
                <button onClick={() => setNavTab("sites")} style={{ ...btnStyle, borderColor: navTab === "sites" ? "rgba(255,255,255,0.35)" : "var(--border)" }}>
                  Sites
                </button>
                <button onClick={() => setNavTab("factions")} style={{ ...btnStyle, borderColor: navTab === "factions" ? "rgba(255,255,255,0.35)" : "var(--border)" }}>
                  Factions
                </button>
                <button onClick={() => setNavTab("buildings")} style={{ ...btnStyle, borderColor: navTab === "buildings" ? "rgba(255,255,255,0.35)" : "var(--border)" }}>
                  Buildings
                </button>
              </div>
            </div>
            {selectedNpc ? (
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                Selected: <span style={{ color: "var(--text)" }}>{selectedNpc.name}</span> ({selectedNpc.id}) • {selectedNpc.category} •
                site={selectedNpc.siteId} • cult={selectedNpc.cult?.member ? "yes" : "no"} • actions={actorCounts[selectedNpc.id] ?? 0}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <input
                value={npcQuery}
                onChange={(e) => setNpcQuery(e.target.value)}
                placeholder={navTab === "npcs" ? "Search NPCs" : navTab === "sites" ? "Search sites" : "Search"}
                style={inputStyle(260)}
              />
              <div style={{ flex: 1 }} />
              {(selectedNpcId || selectedSiteId || selectedFaction || selectedLocationId) ? (
                <button
                  onClick={() => {
                    setSelectedNpcId(null);
                    setSelectedSiteId(null);
                    setSelectedEventId(null);
                    setSelectedFaction(null);
                    setSelectedLocationId(null);
                  }}
                  style={btnStyle}
                >
                  Clear selection
                </button>
              ) : null}
            </div>
          </div>
          <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {!world ? (
              <div style={{ color: "var(--muted)" }}>No snapshot loaded.</div>
            ) : navTab === "npcs" ? (
              filteredNpcs.slice(0, 400).map((n) => {
                const sel = n.id === selectedNpcId;
                const actions = actorCounts[n.id] ?? 0;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      setSelectedNpcId(n.id);
                      setSelectedSiteId(null);
                      setSelectedFaction(null);
                      setSelectedLocationId(null);
                      setSelectedEventId(null);
                    }}
                    style={{
                      ...rowStyle,
                      borderColor: sel ? "rgba(255,255,255,0.35)" : "var(--border)",
                      background: sel ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)",
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <div style={{ fontWeight: 700 }}>{n.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{n.category}</div>
                      <div style={{ flex: 1 }} />
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{actions} actions</div>
                    </div>
                    <div style={{ display: "flex", gap: 10, color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                      <span>@{n.siteId}</span>
                      <span>cult={n.cult?.member ? "yes" : "no"}</span>
                    </div>
                  </button>
                );
              })
            ) : navTab === "sites" ? (
              sites.map((s: any) => {
                const sel = s.id === selectedSiteId;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSiteId(s.id);
                      setSelectedNpcId(null);
                      setSelectedFaction(null);
                      setSelectedLocationId(null);
                      setSelectedEventId(null);
                    }}
                    style={{
                      ...rowStyle,
                      borderColor: sel ? "rgba(255,255,255,0.35)" : "var(--border)",
                      background: sel ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)",
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <div style={{ fontWeight: 700 }}>{s.name ?? s.id}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{s.kind}</div>
                      <div style={{ flex: 1 }} />
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{s.id}</div>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{s.culture ? `culture=${s.culture}` : ""}</div>
                  </button>
                );
              })
            ) : navTab === "factions" ? (
              (["humans", "elves", "cult", "guards", "bandits"] as FactionKey[]).map((fk) => {
                const sel = fk === selectedFaction;
                const size = membershipV2?.[fk]?.size ?? 0;
                return (
                  <button
                    key={fk}
                    onClick={() => {
                      setSelectedFaction(fk);
                      setSelectedNpcId(null);
                      setSelectedSiteId(null);
                      setSelectedLocationId(null);
                      setSelectedEventId(null);
                    }}
                    style={{
                      ...rowStyle,
                      borderColor: sel ? "rgba(255,255,255,0.35)" : "var(--border)",
                      background: sel ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)",
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <div style={{ fontWeight: 700 }}>{fk}</div>
                      <div style={{ flex: 1 }} />
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{size} members</div>
                    </div>
                  </button>
                );
              })
            ) : (
              (() => {
                const s: any = selectedSiteId && world ? (world.sites as any)[selectedSiteId] : null;
                const isSettlement = s && s.kind === "settlement" && s.local;
                const settlementSites = sites.filter((x: any) => x.kind === "settlement");

                if (!selectedSiteId) {
                  return (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Pick a settlement first:</div>
                      {settlementSites.slice(0, 40).map((x: any) => (
                        <button
                          key={x.id}
                          onClick={() => {
                            setSelectedSiteId(x.id);
                            setSelectedNpcId(null);
                            setSelectedFaction(null);
                            setSelectedEventId(null);
                            setSelectedLocationId(null);
                          }}
                          style={{ ...rowStyle, cursor: "pointer", textAlign: "left" }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                            <div style={{ fontWeight: 700 }}>{x.name ?? x.id}</div>
                            <div style={{ flex: 1 }} />
                            <div style={{ color: "var(--muted)", fontSize: 12 }}>{x.id}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                }

                if (!isSettlement) {
                  return <div style={{ color: "var(--muted)" }}>Selected site has no local buildings. Pick a settlement site.</div>;
                }

                const nodes = (s.local.nodes ?? []).slice().sort((a: any, b: any) => String(a.kind).localeCompare(String(b.kind)) || String(a.name).localeCompare(String(b.name)));
                return (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      Settlement: <span style={{ color: "var(--text)" }}>{s.name ?? s.id}</span> • click a building to filter events
                    </div>
                    {nodes.slice(0, 120).map((n: any) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          setSelectedLocationId(n.id);
                          setSelectedNpcId(null);
                          setSelectedFaction(null);
                          setSelectedEventId(null);
                        }}
                        style={{
                          ...rowStyle,
                          cursor: "pointer",
                          textAlign: "left",
                          borderColor: n.id === selectedLocationId ? "rgba(255,255,255,0.35)" : "var(--border)",
                          background: n.id === selectedLocationId ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.18)"
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
                    {nodes.length > 120 ? <div style={{ color: "var(--muted)", fontSize: 12 }}>Showing first 120.</div> : null}
                  </div>
                );
              })()
            )}
          </div>
        </div>

        <div style={{ ...panelStyle, display: "grid", gridTemplateRows: "260px 1fr", minHeight: 0 }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Overview</div>
              <div style={{ flex: 1 }} />
              {loading ? <div style={{ color: "var(--muted)", fontSize: 12 }}>{loading}</div> : null}
            </div>
            {error ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid var(--bad)", color: "var(--bad)" }}>
                {error}
              </div>
            ) : null}

            {openInfo ? (
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                seed={openInfo.seed} • run={openInfo.runId} • events={openInfo.stats.totalLines} • ticks=
                {openInfo.stats.firstTick ?? "?"}..{openInfo.stats.lastTick ?? "?"} • snapshotNpcs={openInfo.snapshotSummary.npcCount}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Top actors</div>
                {topActorsOverall.length ? (
                  topActorsOverall.map((x) => (
                    <div key={x.key} style={kvRow}>
                      <span style={{ color: "var(--muted)" }}>{labelNpc(world, x.key)}</span>
                      <span>{x.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>(none)</div>
                )}
              </div>
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Top attempt kinds</div>
                {topAttemptKinds.length ? (
                  topAttemptKinds.map((x) => (
                    <div key={x.key} style={kvRow}>
                      <span style={{ color: "var(--muted)" }}>{x.key}</span>
                      <span>{x.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>(none)</div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Humans</div>
                {topHumans.length ? (
                  topHumans.map((x) => (
                    <div key={x.key} style={kvRow}>
                      <span style={{ color: "var(--muted)" }}>{labelNpc(world, x.key)}</span>
                      <span>{x.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>(none)</div>
                )}
              </div>
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Elves</div>
                {topElves.length ? (
                  topElves.map((x) => (
                    <div key={x.key} style={kvRow}>
                      <span style={{ color: "var(--muted)" }}>{labelNpc(world, x.key)}</span>
                      <span>{x.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>(none)</div>
                )}
              </div>
              <div style={cardStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Cult</div>
                {topCult.length ? (
                  topCult.map((x) => (
                    <div key={x.key} style={kvRow}>
                      <span style={{ color: "var(--muted)" }}>{labelNpc(world, x.key)}</span>
                      <span>{x.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)" }}>(none)</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ minHeight: 0 }}>
            <EventFeed
              events={events}
              world={world}
              selectedNpcId={selectedNpcId}
              selectedSiteId={selectedSiteId}
              actorAllowlist={selectedAllowlist}
              locationIdFilter={selectedLocationId}
              selectedEventId={selectedEventId}
              onSelectEventId={(id) => setSelectedEventId(id)}
            />
          </div>
        </div>

        <div style={panelStyle}>
          {selectedEventId ? (
            <EventInspector world={world ?? null} events={events} selectedEventId={selectedEventId} onSelectEventId={setSelectedEventId} />
          ) : selectedNpcId ? (
            <NpcInspector world={world ?? null} events={events} npcId={selectedNpcId} onSelectEventId={setSelectedEventId} />
          ) : selectedSiteId ? (
            <SiteInspector
              world={world ?? null}
              events={events}
              siteId={selectedSiteId}
              selectedLocationId={selectedLocationId}
              onSelectLocationId={setSelectedLocationId}
              onSelectEventId={setSelectedEventId}
            />
          ) : selectedFaction ? (
            <FactionInspector
              world={world ?? null}
              events={events}
              faction={selectedFaction}
              membership={membershipV2}
              onSelectNpcId={(id) => {
                setSelectedNpcId(id);
                setSelectedFaction(null);
                setSelectedEventId(null);
              }}
            />
          ) : (
            <>
              <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontWeight: 800 }}>Major events</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>({majorEvents.length})</div>
                  <div style={{ flex: 1 }} />
                  {selectedSiteId ? (
                    <button onClick={() => setSelectedSiteId(null)} style={btnStyle}>
                      Clear site filter
                    </button>
                  ) : null}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  Click an event to open it; click an NPC in the roster to see goals + action history.
                </div>
              </div>
              <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {!majorEvents.length ? (
                  <div style={{ color: "var(--muted)" }}>No major events found yet.</div>
                ) : (
                  majorEvents
                    .filter((e) => (selectedSiteId ? e.siteId === selectedSiteId : true))
                    .slice(-120)
                    .map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          if (e.siteId) setSelectedSiteId(e.siteId);
                          const actorId = (e.data as any)?.attempt?.actorId;
                          if (typeof actorId === "string") setSelectedNpcId(actorId);
                          setSelectedEventId(e.id);
                        }}
                        style={{ ...rowStyle, cursor: "pointer", textAlign: "left" }}
                      >
                        <div style={{ display: "flex", gap: 10 }}>
                          <div style={{ color: "var(--muted)", fontSize: 12, width: 78, flexShrink: 0 }}>
                            t{e.tick} • {e.kind}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13 }}>{e.message}</div>
                            <div style={{ color: "var(--muted)", fontSize: 12 }}>
                              {e.siteId ? `@${e.siteId}` : ""} {e.visibility ? `• ${e.visibility}` : ""}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function labelNpc(world: WorldState | null, npcId: string): string {
  const n = world?.npcs?.[npcId];
  return n ? `${n.name} (${npcId})` : npcId;
}

const panelStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--panel2)",
  overflow: "hidden",
  minHeight: 0
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer"
};

const selectStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "var(--text)",
  minWidth: 220
};

const inputStyle = (w: number): React.CSSProperties => ({
  width: w,
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "var(--text)"
});

const rowStyle: React.CSSProperties = {
  padding: "10px 10px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "rgba(0,0,0,0.18)",
  color: "var(--text)"
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(0,0,0,0.18)"
};

const kvRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  fontSize: 12,
  marginBottom: 6
};


