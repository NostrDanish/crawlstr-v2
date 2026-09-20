/**
 * crawlerNode.ts — the host-seam wiring between the crawlstr app and
 * @sip01/crawler-core. This is the ONLY place the app builds a CrawlerConfig.
 *
 * Seam ownership (blueprint §6/§8):
 *   - signer:    the device's dedicated SIP-01 indexer identity from
 *                @sip01/protocol (spec §14) — NEVER the user's personal
 *                Nostr login signer.
 *   - publish:   the app's @nostrify pool (useCrawler injects it; each
 *                observation goes to every relay in the publish set via a
 *                targeted per-relay connection).
 *   - fetch:     the app's wire fetch — core owns the SSRF guard, redirect
 *                re-check, stream cap and metering (guardedFetch choke
 *                point); the app owns the wire and the CORS proxy template.
 *   - storage:   core's default IndexedDB adapter (dbName preserved from v1).
 *   - clock:     core default (Date.now).
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { finalizeEvent } from 'nostr-tools/pure';
import {
  createCrawler,
  type CrawlerConfig,
  type CrawlerNode,
  type RelayCapabilities,
  type SignableEvent,
} from '@sip01/crawler-core';
import { getIndexerIdentity, getIndexerSecretKey } from '@sip01/protocol';

import { getIndexPublishRelays } from '@/lib/relays';
import type { CrawlerSettings } from '@/lib/crawlerSettings';

/**
 * IndexedDB database name — kept from v1 ('searchstr-crawler') so existing
 * crawl history, queue and outbox survive the v2 migration. Core's v3 schema
 * is store-compatible with v1's v3 (see p1 build log); the shard indexes it
 * adds are only created for fresh databases and are unused here (the
 * sharding module is off for crawlstr).
 */
export const CRAWLER_DB_NAME = 'searchstr-crawler';

/** CORS proxy used when a direct cross-origin fetch is blocked. */
export const CORS_PROXY_TEMPLATE = 'https://proxy.shakespeare.diy/?url={href}';

/** Indexer software id for the SIP-01 `source` tag. */
export const CRAWLER_SOURCE = 'crawlstr/2';

/**
 * The wire fetch the app hands to core's guardedFetch. Core supplies the
 * RequestInit (mode cors, credentials omit, Accept, signal) — this seam
 * exists so the host controls the actual network primitive.
 */
const crawlerFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** Sign with the device's dedicated indexer key (never the user's login). */
async function signWithIndexerIdentity(event: SignableEvent): Promise<NostrEvent> {
  return finalizeEvent(event, getIndexerSecretKey()) as NostrEvent;
}

export type PublishTransport = (relayUrl: string, ev: NostrEvent) => Promise<void>;

/** Map app settings + the nostr publish transport onto a CrawlerConfig. */
export function buildCrawlerConfig(
  settings: CrawlerSettings,
  publish: PublishTransport,
): CrawlerConfig {
  const identity = getIndexerIdentity();
  return {
    dbName: CRAWLER_DB_NAME,
    source: CRAWLER_SOURCE,
    signer: signWithIndexerIdentity,
    indexerPubkey: identity.pubkeyHex,
    indexerNpub: identity.npub,
    transports: {
      publish,
      proxyTemplate: CORS_PROXY_TEMPLATE,
      fetch: crawlerFetch,
      // No subscribe/query: network intake is OFF for crawlstr (§6).
    },
    relays: { publish: getIndexPublishRelays() },
    budgets: {
      maxPagesPerHour: settings.maxPagesPerHour,
      maxBytesPerHour: settings.maxBandwidthMB * 1024 * 1024,
      maxPageSizeKB: settings.maxPageSizeKB,
    },
    politeness: {
      // v1 pacing: 8 s between requests in eco mode, 3 s otherwise.
      minIntervalPerDomainMs: settings.ecoMode ? 8000 : 5000,
      respectRobots: settings.respectRobots,
    },
    modules: {
      // crawlstr = single-user scout: discovery + metering on,
      // intake/enrich/sharding off (§6). Traps stay on (both apps).
      discovery: { feeds: settings.followFeeds, sitemaps: settings.followSitemaps },
      heartbeat: { enabled: true, intervalMs: 600_000 },
      intake: { enabled: false },
      enrich: { enabled: false },
      traps: { enabled: true },
      sharding: { enabled: false },
    },
    crawl: {
      maxDepth: settings.maxDepth,
      ecoMode: settings.ecoMode,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Node singleton                                                      */
/* ------------------------------------------------------------------ */

let node: CrawlerNode | null = null;

/** Create (or, after settings/relay changes, recreate) the crawler node. */
export function initCrawlerNode(settings: CrawlerSettings, publish: PublishTransport): CrawlerNode {
  if (node) {
    // A node owns a running loop and side-channel timers; never leak it.
    void node.stop().catch(() => {});
  }
  node = createCrawler(buildCrawlerConfig(settings, publish));
  return node;
}

export function getCrawlerNode(): CrawlerNode | null {
  return node;
}

/* ------------------------------------------------------------------ */
/* Relay probing (relayprobe module, UI-triggered)                     */
/* ------------------------------------------------------------------ */

let probeNode: CrawlerNode | null = null;

/**
 * Probe a relay's NIP-11 document through core's guarded choke point.
 * Uses a dedicated node whose publish transport is unreachable — probing
 * never publishes; the guard is what matters here.
 */
export async function probeRelay(url: string): Promise<RelayCapabilities> {
  probeNode ??= createCrawler({
    dbName: CRAWLER_DB_NAME,
    source: CRAWLER_SOURCE,
    transports: {
      publish: () => Promise.reject(new Error('probe-only node does not publish')),
      proxyTemplate: CORS_PROXY_TEMPLATE,
      fetch: crawlerFetch,
    },
    relays: { publish: [] },
  });
  return probeNode.probeRelay(url);
}

/* ------------------------------------------------------------------ */
/* Dashboard read paths — served by core's public surface               */
/*                                                                     */
/* recentCrawls / clearQueue / persistedStats are core CrawlerNode      */
/* methods (core owns the database; apps never open it directly — the   */
/* v1→v2 migration's MUST-MIRROR schema copy is gone). These wrappers   */
/* only adapt the node singleton to the hook's call shape.              */
/* ------------------------------------------------------------------ */

/** Recently crawled pages, newest first (dashboard history tab).
 *  Observed (feed/sitemap-announced) rows included, matching v1. */
export async function getRecentCrawls(
  limit = 20,
): Promise<Array<{ url: string; title: string; crawledAt: number }>> {
  const node = getCrawlerNode();
  if (!node) return [];
  const rows = await node.recentCrawls(limit, { includeObserved: true });
  return rows.map(({ url, title, crawledAt }) => ({ url, title, crawledAt }));
}

/** Clear the crawl queue (crawled history and the outbox are kept). */
export async function clearCrawlQueue(): Promise<void> {
  await getCrawlerNode()?.clearQueue();
}

/**
 * Persisted store counts — the dashboard shows these before the first
 * crawl starts (core's stats() is session-scoped until start() rehydrates
 * it). Returns null when IndexedDB is unavailable (tests, privacy mode).
 */
export async function getPersistedCounts(): Promise<{
  pagesIndexed: number;
  queueSize: number;
  outboxPending: number;
} | null> {
  const node = getCrawlerNode();
  if (!node || typeof indexedDB === 'undefined') return null;
  try {
    const { pagesIndexed, queueSize, outboxPending } = await node.persistedStats();
    return { pagesIndexed, queueSize, outboxPending };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* App-side resource gates                                             */
/*                                                                     */
/* wifiOnly / chargingOnly / slow-2g are crawlstr settings with no      */
/* core config equivalent — core enforces only the low-battery gate.    */
/* The hook polls this while running and stops the node when the gate   */
/* closes.                                                              */
/* ------------------------------------------------------------------ */

export async function resourceGateOpen(settings: CrawlerSettings): Promise<boolean> {
  if (typeof navigator === 'undefined') return true;

  if ('getBattery' in navigator) {
    try {
      const battery = await (
        navigator as unknown as { getBattery(): Promise<{ charging: boolean }> }
      ).getBattery();
      if (settings.chargingOnly && !battery.charging) return false;
    } catch {
      // Battery API unavailable — don't gate on it.
    }
  }

  if ('connection' in navigator) {
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; type?: string } })
      .connection;
    if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return false;
    if (settings.wifiOnly && conn?.type !== 'wifi' && conn?.effectiveType !== '4g') return false;
  }

  return true;
}
