/**
 * Stable hash function for deterministic ID generation.
 * Uses MurmurHash3 (32-bit variant) for excellent distribution and speed.
 * 
 * MurmurHash3 is widely used, well-tested, and provides:
 * - Excellent avalanche properties (small input changes cause large hash changes)
 * - Good distribution across the hash space
 * - Fast performance
 * - Deterministic results across platforms
 */

/**
 * MurmurHash3 32-bit implementation.
 * Based on the original algorithm by Austin Appleby.
 */
function murmur3_32(key: string, seed: number = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const r1 = 15;
  const r2 = 13;
  const m = 5;
  const n = 0xe6546b64;

  let hash = seed >>> 0;
  const len = key.length;
  const nblocks = len >> 2; // Number of 4-byte blocks

  // Process 4-byte blocks
  for (let i = 0; i < nblocks; i++) {
    const blockStart = i * 4;
    let k =
      (key.charCodeAt(blockStart) & 0xff) |
      ((key.charCodeAt(blockStart + 1) & 0xff) << 8) |
      ((key.charCodeAt(blockStart + 2) & 0xff) << 16) |
      ((key.charCodeAt(blockStart + 3) & 0xff) << 24);

    k = Math.imul(k, c1);
    k = (k << r1) | (k >>> (32 - r1));
    k = Math.imul(k, c2);

    hash ^= k;
    hash = (hash << r2) | (hash >>> (32 - r2));
    hash = Math.imul(hash, m) + n;
  }

  // Process remaining bytes
  const tailStart = nblocks * 4;
  let k1 = 0;
  const tailLen = len & 3;

  if (tailLen >= 3) k1 ^= (key.charCodeAt(tailStart + 2) & 0xff) << 16;
  if (tailLen >= 2) k1 ^= (key.charCodeAt(tailStart + 1) & 0xff) << 8;
  if (tailLen >= 1) {
    k1 ^= key.charCodeAt(tailStart) & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << r1) | (k1 >>> (32 - r1));
    k1 = Math.imul(k1, c2);
    hash ^= k1;
  }

  // Finalization
  hash ^= len;

  // fmix32
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

export function stableHash(parts: (string | number | undefined)[]): number {
  // Normalize: filter undefined, convert to stable string representation
  const input = parts.filter(p => p !== undefined).map(String).join('\0');
  return murmur3_32(input);
}

export function stableHashHex(parts: (string | number | undefined)[]): string {
  return stableHash(parts).toString(16).padStart(8, '0');
}
