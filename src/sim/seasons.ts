import type { SimTick } from "./types";
import { tickToDay } from "./types";

export type Season = "spring" | "summer" | "autumn" | "winter";

// Simple deterministic calendar: 120-day year, 30 days per season.
export function seasonForDay(day: number): Season {
  const d = ((day % 120) + 120) % 120;
  if (d < 30) return "spring";
  if (d < 60) return "summer";
  if (d < 90) return "autumn";
  return "winter";
}

export function seasonAtTick(tick: SimTick): Season {
  return seasonForDay(tickToDay(tick));
}

export function foodProductionMultiplier(season: Season): { grain: number; fish: number; meat: number } {
  switch (season) {
    case "spring":
      // Keep baseline identical to legacy defaults so existing tests/sims remain stable.
      return { grain: 1.0, fish: 1.0, meat: 1.0 };
    case "summer":
      return { grain: 1.05, fish: 1.0, meat: 1.0 };
    case "autumn":
      return { grain: 1.0, fish: 0.95, meat: 1.0 };
    case "winter":
      return { grain: 0.75, fish: 0.9, meat: 0.95 };
  }
}

export function travelSpeedMultiplier(season: Season): number {
  switch (season) {
    case "spring":
      return 1.0;
    case "summer":
      return 1.05;
    case "autumn":
      return 0.95;
    case "winter":
      return 0.85;
  }
}


