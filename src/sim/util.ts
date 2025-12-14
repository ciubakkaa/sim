export function clamp(n: number, min: number, max: number): number {
  if (max < min) throw new Error("clamp max must be >= min");
  return Math.min(max, Math.max(min, n));
}


