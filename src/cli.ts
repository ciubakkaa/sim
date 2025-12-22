import { runSimulation } from "./runner/run";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] ?? "help";

  const map: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      map[key] = true;
    } else {
      map[key] = next;
      i++;
    }
  }

  return { cmd, flags: map, positionals };
}

function numFlag(flags: Record<string, string | boolean>, key: string, fallback: number): number {
  const v = flags[key];
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  if (v === undefined || v === true) return undefined;
  return String(v);
}

function timestampForFilename(d = new Date()): string {
  // 2025-12-14T12:34:56.789Z -> 20251214-123456Z
  const iso = d.toISOString();
  const ymd = iso.slice(0, 10).replaceAll("-", "");
  const hms = iso.slice(11, 19).replaceAll(":", "");
  return `${ymd}-${hms}Z`;
}

function defaultEventsOutPath(opts: { seed: number; days: number }): string {
  const ts = timestampForFilename();
  return path.join("logs", `events-${ts}-seed${opts.seed}-days${opts.days}.jsonl`);
}

function writeEventsJsonl(outPath: string, events: unknown[]): Promise<void> {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    try {
      for (const e of events) {
        stream.write(`${JSON.stringify(e)}\n`);
      }
      stream.end();
    } catch (err) {
      stream.destroy();
      reject(err);
    }
  });
}

function printHelp() {
  console.log(
    [
      "sim-engine CLI",
      "",
      "Commands:",
      "  run --days <n> --seed <n> [--events] [--events-limit <n>] [--events-kind <kind>] [--events-site <siteId>]",
      "      [--save-events] [--events-out <path>]",
      "  npcs --days <n> --seed <n> --site <siteId> [--limit <n>]",
      "  npc --days <n> --seed <n> --id <npcId>",
      "      (npc/npcs now display travel/detention/eclipsing/busy/hp/beliefs)",
      "  summarize-log --file <path> [--sample-days <csv>] [--show-sites <csv>]",
      "  npc-history --id <npcId> [--file <path>] [--limit <n>]  (defaults to latest logs/events-*.jsonl)",
      "  story <days>  (seed=1, saves all events JSONL, then prints summary)",
      "",
      "Notes:",
      "  - You can pass different params via npm scripts using: npm run <script> -- --days 90 --seed 2",
      "  - --save-events writes JSONL to ./logs/ by default (timestamped filename).",
      "",
      "Examples:",
      "  node dist/cli.js run --days 30 --seed 1",
      "  node dist/cli.js run --days 10 --seed 42 --events --events-limit 100",
      "  node dist/cli.js run --days 10 --seed 42 --events --events-kind attempt.recorded",
      "  node dist/cli.js run --days 10 --seed 42 --save-events",
      "  node dist/cli.js run --days 10 --seed 42 --events-kind attempt.recorded --save-events",
      "  node dist/cli.js npcs --days 0 --seed 1 --site HumanCityPort --limit 20",
      "  node dist/cli.js npc --days 3 --seed 1 --id npc:25",
      "  node dist/cli.js summarize-log --file logs/events-20251214-223440Z-seed1-days180.jsonl",
      "  node dist/cli.js npc-history --file logs/events-20251214-224225Z-seed1-days30.jsonl --id npc:25 --limit 50",
      "  node dist/cli.js story 180"
    ].join("\n")
  );
}

function parseCsvList(s?: string): string[] | undefined {
  if (!s) return undefined;
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function summarizeLog(filePath: string, opts: { sampleDays?: number[]; showSites?: string[] }) {
  const counts: Record<string, number> = {};
  const incidentByType: Record<string, number> = {};
  const travelEncounterByType: Record<string, number> = {};
  const attemptByKind: Record<string, number> = {};
  const attemptByActor: Record<string, number> = {};

  const firstZeroFood: Record<string, number> = {};
  const firstUnrest100: Record<string, number> = {};
  const firstCult100: Record<string, number> = {};
  const firstSickness100: Record<string, number> = {};

  let totalLines = 0;
  let seed: number | null = null;
  let lastTick = 0;
  let lastDay = -1;
  let lastDaySummary: any = null;

  const wantedDays = new Set(opts.sampleDays ?? [0, 7, 30, 60, 90]);
  const samples: Record<number, any> = {};

  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof e.tick === "number") lastTick = Math.max(lastTick, e.tick);
    if (e.kind) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

    if (e.kind === "sim.started" && e.data && typeof e.data.seed === "number") seed = e.data.seed;

    if (e.kind === "world.incident") {
      const t = e.data?.type ?? "unknown";
      incidentByType[t] = (incidentByType[t] ?? 0) + 1;
    }

    if (e.kind === "travel.encounter") {
      const t = e.data?.encounterKind ?? e.data?.kind ?? e.data?.encounter ?? e.data?.type ?? "unknown";
      travelEncounterByType[String(t)] = (travelEncounterByType[String(t)] ?? 0) + 1;
    }

    if (e.kind === "attempt.recorded") {
      const a = e.data?.attempt;
      const kind = a?.kind;
      const actorId = a?.actorId;
      if (typeof kind === "string") attemptByKind[kind] = (attemptByKind[kind] ?? 0) + 1;
      if (typeof actorId === "string") attemptByActor[actorId] = (attemptByActor[actorId] ?? 0) + 1;
    }

    if (e.kind === "sim.day.ended") {
      const sum = e.data?.summary;
      if (!sum || typeof sum.day !== "number") continue;

      const day = sum.day;
      if (day >= lastDay) {
        lastDay = day;
        lastDaySummary = sum;
      }

      if (wantedDays.has(day)) samples[day] = sum;

      for (const site of sum.sites ?? []) {
        if (!site.foodTotals) continue; // only settlements have these
        const sid = site.siteId;
        const foodTot = site.foodTotals.grain + site.foodTotals.fish + site.foodTotals.meat;
        if (foodTot === 0 && firstZeroFood[sid] === undefined) firstZeroFood[sid] = day;
        if (site.unrest === 100 && firstUnrest100[sid] === undefined) firstUnrest100[sid] = day;
        if (site.cultInfluence === 100 && firstCult100[sid] === undefined) firstCult100[sid] = day;
        if (site.sickness === 100 && firstSickness100[sid] === undefined) firstSickness100[sid] = day;
      }
    }
  }

  const top = (obj: Record<string, number>, n: number) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  const compactDay = (sum: any) => {
    const showSites = opts.showSites;
    const settlementSites = (sum.sites ?? []).filter((s: any) => Boolean(s.foodTotals));
    const filtered = showSites ? settlementSites.filter((s: any) => showSites.includes(s.siteId)) : settlementSites;
    return {
      day: sum.day,
      tick: sum.tick,
      keyChanges: (sum.keyChanges ?? []).slice(0, 20),
      sites: filtered.map((s: any) => {
        const pop = (s.cohorts?.children ?? 0) + (s.cohorts?.adults ?? 0) + (s.cohorts?.elders ?? 0);
        const foodTot = s.foodTotals.grain + s.foodTotals.fish + s.foodTotals.meat;
        const namedAlive = typeof s.aliveNpcs === "number" ? s.aliveNpcs : undefined;
        const namedToCohortPct =
          namedAlive !== undefined && pop > 0 ? Math.round((namedAlive / pop) * 100) : undefined;
        return {
          siteId: s.siteId,
          name: s.name,
          pop,
          foodTot,
          unrest: s.unrest,
          morale: s.morale,
          sickness: s.sickness,
          hunger: s.hunger,
          cult: s.cultInfluence,
          press: Math.round(s.eclipsingPressure),
          anchor: Math.round(s.anchoringStrength)
          ,
          aliveNpcs: s.aliveNpcs,
          deadNpcs: s.deadNpcs,
          cultMembers: s.cultMembers,
          avgTrauma: s.avgTrauma !== undefined ? Math.round(s.avgTrauma) : undefined,
          namedToCohortPct,
          deathsToday: s.deathsToday
        };
      })
    };
  };

  console.log(`File: ${filePath}`);
  console.log(`Lines: ${totalLines}`);
  console.log(`Seed: ${seed ?? "unknown"}  LastTick: ${lastTick}  LastDay: ${lastDay}`);
  console.log("Note: pop is cohort population; aliveNpcs/deadNpcs/cultMembers are tracked NPCs and may be far smaller.");
  console.log("");

  console.log("Top event kinds:");
  for (const [k, v] of top(counts, 12)) console.log(`- ${k}: ${v}`);
  console.log("");

  console.log("Incidents by type:");
  const incEntries = Object.entries(incidentByType);
  if (!incEntries.length) console.log("- (none)");
  else for (const [k, v] of incEntries.sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${v}`);
  console.log("");

  console.log("Travel encounters by type:");
  const teEntries = Object.entries(travelEncounterByType);
  if (!teEntries.length) console.log("- (none)");
  else for (const [k, v] of teEntries.sort((a, b) => b[1] - a[1])) console.log(`- ${k}: ${v}`);
  console.log("");

  console.log("Top attempt kinds:");
  const atk = top(attemptByKind, 12);
  if (!atk.length) console.log("- (none parsed)");
  else for (const [k, v] of atk) console.log(`- ${k}: ${v}`);
  console.log("");

  console.log("Top actors by attempt count:");
  const taa = top(attemptByActor, 10);
  if (!taa.length) console.log("- (none parsed)");
  else for (const [k, v] of taa) console.log(`- ${k}: ${v}`);
  console.log("");

  console.log("Milestones (first day): food=0 / unrest=100 / cult=100 / sickness=100");
  const allSites = Array.from(
    new Set([...Object.keys(firstZeroFood), ...Object.keys(firstUnrest100), ...Object.keys(firstCult100), ...Object.keys(firstSickness100)])
  ).sort();
  for (const sid of allSites) {
    console.log(
      `- ${sid}: food0=${firstZeroFood[sid] ?? "-"} unrest100=${firstUnrest100[sid] ?? "-"} cult100=${firstCult100[sid] ?? "-"} sickness100=${firstSickness100[sid] ?? "-"}`
    );
  }
  console.log("");

  console.log("Sample day snapshots:");
  const dayKeys = Object.keys(samples)
    .map((x) => Number(x))
    .sort((a, b) => a - b);
  for (const d of dayKeys) {
    console.log(JSON.stringify(compactDay(samples[d]!), null, 2));
  }
  console.log("");

  if (lastDaySummary) {
    console.log("Last day snapshot:");
    console.log(JSON.stringify(compactDay(lastDaySummary), null, 2));
  }
}

async function npcHistory(filePath: string, npcId: string, limit: number) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const hits: any[] = [];
  let totalLines = 0;
  let sawAttemptPayload = false;

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const kind = e.kind;
    const tick = e.tick;
    const siteId = e.siteId;
    const msg = e.message;
    const data = e.data ?? {};

    const attempt = data.attempt;
    if (attempt) sawAttemptPayload = true;

    const isActor = attempt && attempt.actorId === npcId;
    const isTarget = attempt && attempt.targetId === npcId;

    const isIncidentVictim = kind === "world.incident" && data.victimNpcId === npcId;
    const isKilled = kind === "world.incident" && data.type === "murder" && data.victimNpcId === npcId;

    // Some events may include NPC ids directly in data later; keep this generic:
    const matches =
      isActor ||
      isTarget ||
      isIncidentVictim ||
      (data.byNpcId === npcId) ||
      (data.actorId === npcId) ||
      (data.targetId === npcId);

    if (!matches) continue;

    hits.push({
      tick,
      kind,
      siteId,
      role: isActor ? "actor" : isTarget ? "target" : isIncidentVictim ? "victim" : "involved",
      attemptKind: attempt?.kind,
      message: msg,
      data: kind === "attempt.recorded" ? { attempt } : data
    });

    // Keep last N hits only (streaming-friendly).
    if (hits.length > limit) hits.shift();
  }

  console.log(`File: ${filePath}`);
  console.log(`Lines: ${totalLines}`);
  console.log(`NPC: ${npcId}`);
  if (!sawAttemptPayload) {
    console.log(
      "Note: this log file appears to predate embedding attempt payloads in events; npc-history may be incomplete."
    );
  }
  console.log("");

  if (!hits.length) {
    console.log("No matching events found.");
    return;
  }

  console.log(`Last ${hits.length} matching events (most recent last):`);
  for (const h of hits) {
    const extra = h.attemptKind ? ` attempt=${h.attemptKind}` : "";
    console.log(`- [t${h.tick}] ${h.kind}${h.siteId ? `@${h.siteId}` : ""} ${h.role}${extra}: ${h.message}`);
  }
}

function pickLatestEventsLog(): string | undefined {
  const dir = "logs";
  if (!fs.existsSync(dir)) return undefined;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"))
    .map((f) => ({ f, p: path.join(dir, f) }))
    .filter((x) => fs.existsSync(x.p));
  if (!files.length) return undefined;
  files.sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
  return files[0]!.p;
}

async function main() {
  const { cmd, flags, positionals } = parseArgs(process.argv);

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (
    cmd !== "run" &&
    cmd !== "npcs" &&
    cmd !== "npc" &&
    cmd !== "summarize-log" &&
    cmd !== "npc-history" &&
    cmd !== "story"
  ) {
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (cmd === "summarize-log") {
    const file = strFlag(flags, "file");
    if (!file) {
      console.error("Missing required flag: --file <path>");
      process.exitCode = 1;
      return;
    }
    const sampleDaysCsv = strFlag(flags, "sample-days");
    const showSitesCsv = strFlag(flags, "show-sites");
    const sampleDays = parseCsvList(sampleDaysCsv)?.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    const showSites = parseCsvList(showSitesCsv);
    await summarizeLog(file, { sampleDays, showSites });
    return;
  }

  if (cmd === "npc-history") {
    const file = strFlag(flags, "file") ?? pickLatestEventsLog();
    const npcId = strFlag(flags, "id");
    if (!file) {
      console.error("Missing required flag: --file <path> (and no logs/events-*.jsonl found)");
      process.exitCode = 1;
      return;
    }
    if (!npcId) {
      console.error("Missing required flag: --id <npcId>");
      process.exitCode = 1;
      return;
    }
    const limit = numFlag(flags, "limit", 50);
    await npcHistory(file, npcId, limit);
    return;
  }

  if (cmd === "story") {
    const daysPos = positionals[0];
    const days = daysPos ? Number(daysPos) : 30;
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
      console.error("story requires a non-negative integer days argument, e.g. `node dist/cli.js story 90`");
      process.exitCode = 1;
      return;
    }

    const seed = 1;
    const res = runSimulation({ days, seed });
    const outPath = defaultEventsOutPath({ seed, days });
    await writeEventsJsonl(outPath, res.events);
    console.log(`Saved ${res.events.length} events to ${outPath}`);
    console.log("");
    await summarizeLog(outPath, { sampleDays: [0, 7, 30, 60, 90, 120, 150, days - 1].filter((d) => d >= 0) });
    return;
  }

  const days = numFlag(flags, "days", 30);
  const seed = numFlag(flags, "seed", 1);

  const res = runSimulation({ days, seed });

  if (cmd === "npcs") {
    const siteId = strFlag(flags, "site");
    if (!siteId) {
      console.error("Missing required flag: --site <siteId>");
      process.exitCode = 1;
      return;
    }
    const limit = numFlag(flags, "limit", 50);

    const npcs = Object.values(res.finalWorld.npcs).filter((n) => n.siteId === siteId);
    console.log(`Seed=${seed} Days=${days} | NPCs in ${siteId} (count=${npcs.length})`);
    console.log("");

    for (const n of npcs.slice(0, limit)) {
      const needs = n.needs;
      const topNeed = Object.entries(needs).sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      const status = n.alive ? "alive" : `dead(${n.death?.cause ?? "unknown"})`;
      const travelStr = n.travel ? `travel(${n.travel.from}->${n.travel.to} remKm=${n.travel.remainingKm.toFixed(1)} q=${n.travel.edgeQuality})` : "";
      const detainedStr = n.status?.detained ? `detained(until=t${n.status.detained.untilTick})` : "";
      const eclipsingStr = n.status?.eclipsing ? `eclipsing(done=t${n.status.eclipsing.completeTick})` : "";
      const busyStr = n.busyUntilTick > res.finalWorld.tick ? `busy(until=t${n.busyUntilTick} kind=${n.busyKind ?? "?"})` : "";
      const flags = [travelStr, detainedStr, eclipsingStr, busyStr].filter(Boolean).join(" ");
      console.log(
        `- ${n.id} | ${status} | ${n.name} | ${n.category} | hp=${Math.round(n.hp)}/${n.maxHp} | notability=${n.notability.toFixed(0)} | beliefs=${n.beliefs.length} | topNeed=${topNeed?.[0]}(${Number(
          topNeed?.[1] ?? 0
        ).toFixed(0)})${flags ? ` | ${flags}` : ""}`
      );
    }
    if (npcs.length > limit) console.log(`\n... (${npcs.length - limit} more)`);
    return;
  }

  if (cmd === "npc") {
    const npcId = strFlag(flags, "id");
    if (!npcId) {
      console.error("Missing required flag: --id <npcId>");
      process.exitCode = 1;
      return;
    }
    const n = res.finalWorld.npcs[npcId];
    if (!n) {
      console.error(`NPC not found: ${npcId}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Seed=${seed} Days=${days} | NPC ${n.id}`);
    console.log(`name=${n.name}`);
    console.log(`category=${n.category}`);
    console.log(`siteId=${n.siteId}`);
    console.log(`alive=${n.alive}`);
    if (!n.alive) console.log(`death=${JSON.stringify(n.death)}`);
    console.log(`hp=${Math.round(n.hp)}/${n.maxHp}`);
    console.log(`notability=${n.notability}`);
    console.log(`cult=${JSON.stringify(n.cult)}`);
    if (n.travel) console.log(`travel=${JSON.stringify(n.travel)}`);
    if (n.status) console.log(`status=${JSON.stringify(n.status)}`);
    console.log(`busyUntilTick=${n.busyUntilTick}${n.busyKind ? ` busyKind=${n.busyKind}` : ""}`);
    console.log(`trauma=${n.trauma}`);
    console.log("");
    console.log("needs:", n.needs);
    console.log("traits:", n.traits);
    console.log(`beliefs.count=${n.beliefs.length}`);
    console.log(`relationships.materialized=${Object.keys(n.relationships).length}`);
    return;
  }

  const showEvents = Boolean(flags.events);
  const eventsLimit = numFlag(flags, "events-limit", 30);
  const eventsKind = strFlag(flags, "events-kind");
  const eventsSite = strFlag(flags, "events-site");
  const saveEvents = Boolean(flags["save-events"]);
  const eventsOut = strFlag(flags, "events-out");

  console.log(`Seed=${seed} Days=${days}`);
  console.log(`Final tick=${res.finalWorld.tick} (hour ticks)`);
  console.log("");

  for (const s of res.summaries) {
    console.log(`Day ${s.day} :: ${s.keyChanges.join("; ")}`);
    for (const site of s.sites) {
      if (!site.cohorts || !site.foodTotals) continue;
      const pop = site.cohorts.children + site.cohorts.adults + site.cohorts.elders;
    console.log(
        `  - ${site.name} (${site.culture}) pop=${pop} food[g=${site.foodTotals.grain}, f=${site.foodTotals.fish}, m=${site.foodTotals.meat}] unrest=${site.unrest?.toFixed(
          0
        )} cult=${site.cultInfluence?.toFixed(0)} press=${site.eclipsingPressure.toFixed(0)} anchor=${site.anchoringStrength.toFixed(0)}`
    );
    }
  }

  if (showEvents) {
    console.log("\nRecent events:");
    const filtered = res.events
      .filter((e) => (eventsKind ? e.kind === eventsKind : true))
      .filter((e) => (eventsSite ? e.siteId === eventsSite : true));
    for (const e of filtered.slice(-eventsLimit)) {
      const attempt = (e.data as any)?.attempt;
      const attemptStr = attempt ? ` actor=${attempt.actorId} kind=${attempt.kind}` : "";
      console.log(`- [t${e.tick}] ${e.kind}${e.siteId ? `@${e.siteId}` : ""}:${attemptStr} ${e.message}`);
    }
  }

  if (saveEvents) {
    const filtered = res.events
      .filter((e) => (eventsKind ? e.kind === eventsKind : true))
      .filter((e) => (eventsSite ? e.siteId === eventsSite : true));

    const outPath = eventsOut ?? defaultEventsOutPath({ seed, days });
    await writeEventsJsonl(outPath, filtered);
    console.log(`\nSaved ${filtered.length} events to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exitCode = 1;
});


