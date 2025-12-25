# simEngine

## Core rule

**The simulation core has no UI / engine dependencies.**

The simulation takes **attempts** (inputs) and produces:
- **world snapshots** (state)
- **events** (what happened, for observability)
- **summaries** (human-readable daily recap)

## Status

This repo is **v2-only**. Legacy v1 mode and v2 feature flags have been removed.

## Quickstart

Install deps:

```bash
npm install
```

Run a headless simulation:

```bash
npm run build
node dist/cli.js run --days 30 --seed 1
```

Run tests:

```bash
npm test
```

## Viewer (service + UI)

Start the viewer service (SSE + controls):

```bash
node dist/cli.js viewer --seed 1 --play --save-events
```

- The service exposes an SSE stream on `GET /events` and accepts controls on `POST /control`.
- The viewer UI lives in `ui/` (Vite + React).

Build the UI:

```bash
cd ui
npm install
npm run build
```

## Debug CLI

The CLI includes debug helpers that work directly on the latest timestamped events log in `./logs/`:

```bash
node dist/cli.js debug-entity --id npc:25
node dist/cli.js debug-narrative
node dist/cli.js debug-operations --faction cult
node dist/cli.js debug-scenario --scenario heal_debt
```

## Slow tests

Some long-running sims are gated behind `RUN_SLOW_TESTS`:

```bash
RUN_SLOW_TESTS=1 npm test
```









