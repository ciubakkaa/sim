import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ControlAction, MapLayout, SimEvent, ViewerServerMessage, ViewerSettings, WorldState } from "../lib/protocol";
import { EventFeed } from "./components/EventFeed";
import { MapCanvas } from "./components/MapCanvas";
import { NpcPanel } from "./components/NpcPanel";
import "./theme.css";

type ConnectionState = "disconnected" | "connecting" | "connected";

function defaultServiceUrl(): string {
  const env = (import.meta as any).env?.VITE_SERVICE_URL;
  return (typeof env === "string" && env) || "http://localhost:8787";
}

async function postControl(serviceUrl: string, action: ControlAction): Promise<void> {
  await fetch(`${serviceUrl}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action)
  });
}

export function App() {
  const [serviceUrl, setServiceUrl] = useState(defaultServiceUrl);
  const [conn, setConn] = useState<ConnectionState>("disconnected");
  const [settings, setSettings] = useState<ViewerSettings | null>(null);
  const [layout, setLayout] = useState<MapLayout | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const connect = () => {
    try {
      esRef.current?.close();
    } catch {
      // ignore
    }

    setConn("connecting");
    const es = new EventSource(`${serviceUrl}/events`);
    esRef.current = es;

    const onMsg = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as ViewerServerMessage;
      if (msg.type === "hello") {
        setSettings(msg.settings);
        setLayout(msg.layout);
        setWorld(msg.world);
        setEvents([]);
        setConn("connected");
        return;
      }
      if (msg.type === "settings") {
        setSettings(msg.settings);
        return;
      }
      if (msg.type === "tick") {
        setSettings(msg.settings);
        setWorld(msg.world);
        if (msg.events?.length) {
          setEvents((prev) => {
            const next = [...prev, ...msg.events];
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
        }
        return;
      }
    };

    // We listen to multiple SSE event types but parse the same way.
    es.addEventListener("hello", onMsg);
    es.addEventListener("settings", onMsg);
    es.addEventListener("tick", onMsg);

    es.onerror = () => {
      setConn("disconnected");
    };
  };

  useEffect(() => {
    connect();
    return () => {
      try {
        esRef.current?.close();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceUrl]);

  const header = useMemo(() => {
    if (!world || !settings) return "Sim Engine Viewer";
    const day = Math.floor(world.tick / 24);
    const hour = world.tick % 24;
    const speed = settings.msPerTick >= 1000 ? `${Math.round(settings.msPerTick / 1000)}s/tick` : `${settings.msPerTick}ms/tick`;
    return `Seed ${settings.seed} • t${world.tick} (Day ${day}, ${hour}:00) • ${settings.paused ? "Paused" : "Running"} • ${speed}`;
  }, [settings, world]);

  const canControl = conn === "connected" && Boolean(settings);

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "56px 1fr", gap: 12, padding: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--panel)"
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>{header}</div>

        <div style={{ flex: 1 }} />

        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
          Service
          <input
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            style={{
              width: 230,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "8px 10px",
              color: "var(--text)"
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={!canControl}
            onClick={() => postControl(serviceUrl, { action: settings?.paused ? "play" : "pause" })}
            style={btnStyle}
          >
            {settings?.paused ? "Play" : "Pause"}
          </button>
          <button disabled={!canControl} onClick={() => postControl(serviceUrl, { action: "step" })} style={btnStyle}>
            Step
          </button>
          <button disabled={!canControl} onClick={() => postControl(serviceUrl, { action: "reset" })} style={btnStyle}>
            Reset
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Speed</span>
          <input
            disabled={!canControl}
            type="range"
            min={250}
            max={120000}
            step={250}
            value={settings?.msPerTick ?? 60000}
            onChange={(e) => postControl(serviceUrl, { action: "setSpeed", msPerTick: Number(e.target.value) })}
            style={{ width: 180 }}
          />
        </div>

        <div style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)" }}>
          {conn}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 12, minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateRows: "1fr 240px", gap: 12, minHeight: 0 }}>
          <div style={panelStyle}>
            <MapCanvas
              layout={layout}
              world={world}
              selectedNpcId={selectedNpcId}
              selectedSiteId={selectedSiteId}
              onSelectNpcId={setSelectedNpcId}
              onSelectSiteId={setSelectedSiteId}
            />
          </div>

          <div style={panelStyle}>
            <EventFeed events={events} selectedNpcId={selectedNpcId} selectedSiteId={selectedSiteId} />
          </div>
        </div>

        <div style={panelStyle}>
          <NpcPanel world={world} selectedNpcId={selectedNpcId} onSelectNpcId={setSelectedNpcId} />
        </div>
      </div>
    </div>
  );
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


