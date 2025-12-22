# simEngine

## Core rule

**The simulation core has no UI / engine dependencies.**

The simulation takes **attempts** (inputs) and produces:
- **world snapshots** (state)
- **events** (what happened, for observability)
- **summaries** (human-readable daily recap)

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









