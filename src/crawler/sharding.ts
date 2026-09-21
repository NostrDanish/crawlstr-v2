/**
 * Deterministic crawl-space sharding — ported byte-compatibly from Indexstr
 * (src/crawler/sharding.ts) so both node types compute the SAME assignment.
 *
 * Crawlstr only needs this for the heartbeat's home-shard field — Indexstr
 * does the actual preferential scheduling. Sharing the algorithm means the
 * dashboard can reason about coverage across both node classes.
 *
 * The hash is FNV-1a 32-bit over the SIP-01-normalized URL — deliberately
 * NOT SHA-256: sharding needs cheap synchronous bulk computation and uniform
 * spread, not cryptographic identity (that stays with the SIP-01 `d` tag).
 */

export const SHARD_COUNT = 256;

/** FNV-1a 32-bit. Uniform enough for sharding; NOT a cryptographic hash. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Encode non-BMP code points as their UTF-16 surrogate pair values;
    // all realistic URL characters are BMP after normalization anyway.
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193);
    // Fold in the high byte for code points above 0xFF.
    if (code > 0xff) {
      hash = Math.imul(hash ^ (code >>> 8), 0x01000193);
    }
  }
  return hash >>> 0;
}

/** Map a SIP-01-normalized URL to its shard (0–255). */
export function urlShard(normalizedUrl: string): number {
  return fnv1a32(normalizedUrl) >>> 24;
}

/** A node's home shard: first byte of its indexer pubkey (hex). */
export function nodeShard(pubkeyHex: string): number {
  const byte = parseInt(pubkeyHex.slice(0, 2), 16);
  return Number.isFinite(byte) ? byte : 0;
}

/** Human label for a shard, e.g. 167 → "A7". */
export function shardLabel(shard: number): string {
  return shard.toString(16).toUpperCase().padStart(2, '0');
}
