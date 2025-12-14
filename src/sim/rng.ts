/**
 * Deterministic PRNG for reproducible simulations.
 * Mulberry32: small, fast, stable.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // force to uint32
    this.state = seed >>> 0;
  }

  next(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return out;
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxInclusive)) {
      throw new Error("Rng.int bounds must be finite numbers");
    }
    if (maxInclusive < minInclusive) {
      throw new Error("Rng.int maxInclusive must be >= minInclusive");
    }
    const span = maxInclusive - minInclusive + 1;
    const n = Math.floor(this.next() * span);
    return minInclusive + n;
  }

  float(minInclusive: number, maxExclusive: number): number {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxExclusive)) {
      throw new Error("Rng.float bounds must be finite numbers");
    }
    if (maxExclusive <= minInclusive) {
      throw new Error("Rng.float maxExclusive must be > minInclusive");
    }
    return minInclusive + this.next() * (maxExclusive - minInclusive);
  }

  chance(p: number): boolean {
    if (!Number.isFinite(p)) throw new Error("Rng.chance p must be finite");
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }
}


