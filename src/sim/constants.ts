import type { FoodType } from "./types";

export const HOURS_PER_DAY = 24;

export const FOOD_EXPIRY_DAYS: Record<FoodType, number> = {
  fish: 2,
  meat: 4,
  grain: 60
};

// Per-capita food need per day (abstract units).
export const FOOD_PER_CAPITA_PER_DAY = 1;

// Site-level clamp bounds.
export const MAX_STAT = 100;
export const MIN_STAT = 0;

export const DEFAULT_DAYLIGHT_HOURS = { start: 6, end: 20 } as const;

// Refugee inflow tuning (Phase 1.3 baseline).
export const REFUGEE_DAILY_BASE_MIN = 0;
export const REFUGEE_DAILY_BASE_MAX = 2;

// Cult incident baseline rate (scaled further by influence/pressure/anchoring).
export const CULT_INCIDENT_BASE_CHANCE_PER_DAY = 0.04;

// Diffusion tuning (km scale where influence decays noticeably).
export const DIFFUSION_KM_SCALE = 20;


