/**
 * Resource metering — one accounting point for EVERY byte the crawler moves.
 *
 * Previously only successfully-fetched HTML pages counted toward the
 * bandwidth budget, so robots.txt, RSS/Atom feeds, sitemaps and failed
 * requests were invisible to the limiter. The audit was right: a user
 * setting 25 MB/h could actually consume substantially more.
 *
 * This module tracks a sliding 1-hour window of ALL fetches (pages, feeds,
 * sitemaps, robots.txt — proxied or direct), plus a pages-per-hour window.
 * Nothing here is per-session cosmetic: these are the numbers the engine's
 * canCrawl() gate actually enforces.
 */

interface ByteEntry {
  at: number;
  bytes: number;
}

const HOUR_MS = 3_600_000;

/** Sliding window of every fetch's byte count. */
const byteWindow: ByteEntry[] = [];
/** Sliding window of successful page fetches (for pages/hour). */
const pageWindow: number[] = [];
/** Session totals for display. */
let sessionBytes = 0;
let sessionFetches = 0;

function prune(window: { at: number }[], now: number): void {
  const cutoff = now - HOUR_MS;
  while (window.length > 0 && window[0].at < cutoff) {
    window.shift();
  }
}

/** Record bytes for any fetch — page, feed, sitemap, robots, proxy overhead. */
export function recordFetch(bytes: number, at = Date.now()): void {
  byteWindow.push({ at, bytes });
  sessionBytes += bytes;
  sessionFetches++;
  prune(byteWindow, at);
}

/** Record a successfully processed page (for the pages/hour budget). */
export function recordPage(at = Date.now()): void {
  pageWindow.push(at);
  const cutoff = at - HOUR_MS;
  while (pageWindow.length > 0 && pageWindow[0] < cutoff) {
    pageWindow.shift();
  }
}

/** Bytes moved in the last hour across ALL traffic. */
export function bytesLastHour(now = Date.now()): number {
  prune(byteWindow, now);
  return byteWindow.reduce((sum, e) => sum + e.bytes, 0);
}

/** Pages fetched in the last hour. */
export function pagesLastHour(now = Date.now()): number {
  const cutoff = now - HOUR_MS;
  while (pageWindow.length > 0 && pageWindow[0] < cutoff) {
    pageWindow.shift();
  }
  return pageWindow.length;
}

/** Session totals (for the dashboard display). */
export function getSessionTotals(): { bytes: number; fetches: number } {
  return { bytes: sessionBytes, fetches: sessionFetches };
}

/** Remaining bytes this hour under a budget (bytes). */
export function remainingBytesThisHour(limitBytes: number, now = Date.now()): number {
  return Math.max(0, limitBytes - bytesLastHour(now));
}

/** Test hook: clear all accounting. */
export function resetMeter(): void {
  byteWindow.length = 0;
  pageWindow.length = 0;
  sessionBytes = 0;
  sessionFetches = 0;
}
