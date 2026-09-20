// React adapter for the crawler node — a thin shell over
// @sip01/crawler-core's createCrawler(). The engine, SSRF guard, robots,
// outbox, publisher, meter and discovery modules all live in core; this
// hook owns only app concerns: crawl modes (session page budgets), the
// Random Scout/Explorer flows over the curated seed corpus, settings
// persistence, and mapping node stats onto the dashboard's shape.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { CrawlerNode, CrawlerStats as CoreStats } from '@sip01/crawler-core';
import { normalizeIndexUrl } from '@sip01/protocol';

import {
  initCrawlerNode,
  getCrawlerNode,
  getPersistedCounts,
  getRecentCrawls,
  clearCrawlQueue,
  resourceGateOpen,
} from '@/lib/crawlerNode';
import {
  seedCount,
  scoutedCount,
  getCategories,
  categoryOf,
  previewRandomSeed,
  pickRandomSeed,
  commitSeed,
} from '@/lib/seeds';
import {
  CRAWL_MODES,
  DEFAULT_SETTINGS,
  loadCrawlerSettings,
  saveCrawlerSettings,
  type CrawlMode,
  type CrawlerSettings,
} from '@/lib/crawlerSettings';

/** What one scouting session accomplished — for the completion summary. */
export interface SessionSummary {
  seed: string | null;
  pages: number;
  discovered: number;
  feeds: number;
  sitemaps: number;
}

/** Dashboard stats shape: core's CrawlerStats plus the v1 field alias. */
export type CrawlerStats = Omit<CoreStats, 'discovered'> & {
  /** New URLs discovered this session (links + feed entries + sitemap URLs). */
  urlsDiscovered: number;
};

function mapStats(core: CoreStats): CrawlerStats {
  const { discovered, ...rest } = core;
  return { ...rest, urlsDiscovered: discovered };
}

const EMPTY_STATS: CrawlerStats = mapStats({
  pagesIndexed: 0,
  queueSize: 0,
  bandwidthUsed: 0,
  uptime: 0,
  errors: 0,
  skipped: 0,
  viaProxy: 0,
  viaDirect: 0,
  robotsBlocked: 0,
  ssrfBlocked: 0,
  fetchFailed: 0,
  duplicates: 0,
  thinContent: 0,
  published: 0,
  outboxPending: 0,
  discovered: 0,
  feedsFound: 0,
  sitemapsFound: 0,
  homeShardJobs: 0,
  networkIntake: 0,
  intakeRejected: 0,
  trapsBlocked: 0,
});

export interface ScoutPreview {
  url: string;
  category: string;
}

/** Session bookkeeping for crawl modes (page budgets) and summaries. */
interface SessionState {
  mode: CrawlMode;
  explorer: boolean;
  seed: string | null;
  /** Core stats at session start — session counters are deltas. */
  baseline: { pages: number; discovered: number; feeds: number; sitemaps: number };
}

export function useCrawler() {
  const { nostr } = useNostr();
  const [isRunning, setIsRunning] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<CrawlMode>('site');
  const [currentSeed, setCurrentSeed] = useState<string | null>(null);
  const [scoutPreview, setScoutPreview] = useState<ScoutPreview | null>(null);
  const [lastSession, setLastSession] = useState<SessionSummary | null>(null);
  const [stats, setStats] = useState<CrawlerStats>(EMPTY_STATS);
  const [recentCrawls, setRecentCrawls] = useState<Array<{
    url: string;
    title: string;
    crawledAt: number;
  }>>([]);
  const [indexerInfo, setIndexerInfo] = useState<{ pubkeyHex: string; npub: string } | null>(null);

  /** Latest nostr pool — the publish transport reads through this ref so
   *  the node is created once and never rebuilt on pool identity changes. */
  const nostrRef = useRef(nostr);
  useEffect(() => {
    nostrRef.current = nostr;
  }, [nostr]);

  const settingsRef = useRef<CrawlerSettings>(loadCrawlerSettings());
  const sessionRef = useRef<SessionState | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  /** Publish one signed event to one relay via the app's nostr pool.
   *  MUST rethrow — the core publisher tracks per-relay health and routes
   *  zero-accept events into the IndexedDB outbox. */
  const publishRef = useRef(async (relayUrl: string, event: NostrEvent): Promise<void> => {
    await nostrRef.current.relay(relayUrl).event(event, { signal: AbortSignal.timeout(10000) });
  });

  /** End the current session: emit the summary and stop the node. */
  const finishSession = useCallback(async (node: CrawlerNode, session: SessionState, core: CoreStats) => {
    const summary: SessionSummary = {
      seed: session.seed,
      pages: core.pagesIndexed - session.baseline.pages,
      discovered: core.discovered - session.baseline.discovered,
      feeds: core.feedsFound - session.baseline.feeds,
      sitemaps: core.sitemapsFound - session.baseline.sitemaps,
    };
    sessionRef.current = null;
    await node.stop();
    setIsRunning(false);
    setCurrentSeed(null);
    setLastSession(summary);
  }, []);

  /** Attach event listeners to a node; returns a detach function. */
  const attach = useCallback((node: CrawlerNode) => {
    return node.on('stats', (event) => {
      if (event.type !== 'stats') return;
      const core = event.stats;
      setStats(mapStats(core));
      if (!node.isRunning()) setIsRunning(false);

      // Session page budget — the crawl modes. Core has no session concept;
      // it is an app concern, enforced here.
      const session = sessionRef.current;
      if (session && node.isRunning()) {
        const maxPages = CRAWL_MODES[session.mode].maxPages;
        if (maxPages > 0 && core.pagesIndexed - session.baseline.pages >= maxPages) {
          if (session.explorer) {
            // Random Explorer: budget spent → pick a fresh seed and continue.
            const seed = pickRandomSeed();
            if (seed) {
              session.seed = seed;
              session.baseline = {
                pages: core.pagesIndexed,
                discovered: core.discovered,
                feeds: core.feedsFound,
                sitemaps: core.sitemapsFound,
              };
              setCurrentSeed(seed);
              void node.seed([seed]);
            } else {
              void finishSession(node, session, core);
            }
          } else {
            void finishSession(node, session, core);
          }
        }
      }
    });
  }, [finishSession]);

  // Create the crawler node once (host seams wired in lib/crawlerNode.ts).
  useEffect(() => {
    const node = initCrawlerNode(settingsRef.current, (relayUrl, ev) => publishRef.current(relayUrl, ev));
    detachRef.current = attach(node);

    setIndexerInfo(node.indexerInfo());
    setInitialized(true);

    // Show persisted counts before the first start (core stats are zero
    // until start() rehydrates them from storage).
    void getPersistedCounts().then((counts) => {
      if (counts) setStats((s) => ({ ...s, ...counts }));
    });

    return () => {
      detachRef.current?.();
      detachRef.current = null;
      void node.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // wifiOnly / chargingOnly / slow-2g are app settings with no core config
  // equivalent — poll the gate while running and stop when it closes.
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      void resourceGateOpen(settingsRef.current).then((open) => {
        const node = getCrawlerNode();
        if (!open && node?.isRunning()) {
          sessionRef.current = null;
          void node.stop();
          setIsRunning(false);
        }
      });
    }, 15_000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Poll recent crawls (dashboard history tab).
  useEffect(() => {
    if (!initialized) return;

    const loadRecent = async () => {
      try {
        setRecentCrawls(await getRecentCrawls(20));
      } catch {
        // IndexedDB unavailable (tests / privacy mode) — history stays empty.
      }
    };

    loadRecent();
    const interval = setInterval(loadRecent, 10000);
    return () => clearInterval(interval);
  }, [initialized, isRunning]);

  const beginSession = useCallback(async (crawlMode: CrawlMode, seed: string | null, explorer: boolean) => {
    const node = getCrawlerNode();
    if (!node) return;
    const core = node.stats();
    sessionRef.current = {
      mode: crawlMode,
      explorer,
      seed,
      baseline: {
        pages: core.pagesIndexed,
        discovered: core.discovered,
        feeds: core.feedsFound,
        sitemaps: core.sitemapsFound,
      },
    };
    await node.start();
    setIsRunning(true);
  }, []);

  const start = useCallback(async (crawlMode?: CrawlMode) => {
    const effectiveMode = crawlMode ?? mode;
    if (crawlMode) setMode(crawlMode);
    if (!(await resourceGateOpen(settingsRef.current))) return;
    await beginSession(effectiveMode, null, false);
  }, [mode, beginSession]);

  const stop = useCallback(async () => {
    const node = getCrawlerNode();
    if (!node) return;
    sessionRef.current = null;
    await node.stop();
    setIsRunning(false);
  }, []);

  const setModePreference = useCallback((crawlMode: CrawlMode) => {
    setMode(crawlMode);
  }, []);

  const seedUrl = useCallback(async (url: string) => {
    const node = getCrawlerNode();
    if (!node) return;
    await node.seed([url]);
    setCurrentSeed(normalizeIndexUrl(url) ?? url);
  }, []);

  /** Random Scout: pick a seed the device hasn't scouted, start crawling. */
  const scoutRandom = useCallback(async (crawlMode?: CrawlMode): Promise<string | null> => {
    const effectiveMode = crawlMode ?? mode;
    if (crawlMode) setMode(crawlMode);
    const seed = pickRandomSeed();
    if (!seed) return null;
    if (!(await resourceGateOpen(settingsRef.current))) return null;
    const node = getCrawlerNode();
    if (!node) return null;
    await node.seed([seed]);
    await beginSession(effectiveMode, seed, false);
    setCurrentSeed(seed);
    return seed;
  }, [mode, beginSession]);

  /** Preview a random seed without committing — for the "🎲 Random corner" card. */
  const previewScout = useCallback((categoryId?: string): ScoutPreview | null => {
    const preview = previewRandomSeed(categoryId);
    setScoutPreview(preview);
    return preview;
  }, []);

  /** Start scouting the previewed seed. */
  const confirmScout = useCallback(async (crawlMode?: CrawlMode): Promise<void> => {
    if (!scoutPreview) return;
    const effectiveMode = crawlMode ?? mode;
    if (crawlMode) setMode(crawlMode);
    if (!(await resourceGateOpen(settingsRef.current))) return;
    const node = getCrawlerNode();
    if (!node) return;
    setLastSession(null);
    commitSeed(scoutPreview.url);
    await node.seed([scoutPreview.url]);
    await beginSession(effectiveMode, scoutPreview.url, false);
    setCurrentSeed(scoutPreview.url);
    setScoutPreview(null);
  }, [scoutPreview, mode, beginSession]);

  const dismissScoutPreview = useCallback(() => {
    setScoutPreview(null);
  }, []);

  /** Dismiss the "SCOUT COMPLETE" summary card. */
  const dismissSessionSummary = useCallback(() => {
    setLastSession(null);
  }, []);

  /** Random Explorer: keep scouting fresh random seeds within every limit. */
  const startExplorer = useCallback(async (): Promise<string | null> => {
    const seed = pickRandomSeed();
    if (!seed) return null;
    if (!(await resourceGateOpen(settingsRef.current))) return null;
    const node = getCrawlerNode();
    if (!node) return null;
    await node.seed([seed]);
    await beginSession(mode, seed, true);
    setCurrentSeed(seed);
    return seed;
  }, [mode, beginSession]);

  const clearAll = useCallback(async () => {
    await clearCrawlQueue();
    setStats((s) => ({ ...s, queueSize: 0 }));
  }, []);

  const updateSettings = useCallback((patch: Partial<CrawlerSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    saveCrawlerSettings(next);

    // Core config is fixed at createCrawler() time, so a settings change
    // rebuilds the node. A running crawl is stopped first — restarting
    // automatically would silently reset the session budget.
    const old = getCrawlerNode();
    const wasRunning = old?.isRunning() ?? false;
    detachRef.current?.();
    const node = initCrawlerNode(next, (relayUrl, ev) => publishRef.current(relayUrl, ev));
    detachRef.current = attach(node);
    if (wasRunning) {
      sessionRef.current = null;
      setIsRunning(false);
    }
  }, [attach]);

  const getSettings = useCallback((): CrawlerSettings => {
    return { ...DEFAULT_SETTINGS, ...settingsRef.current };
  }, []);

  return {
    isRunning,
    initialized,
    mode,
    modes: CRAWL_MODES,
    setModePreference,
    currentSeed,
    currentSeedCategory: currentSeed ? categoryOf(currentSeed) : undefined,
    scoutPreview,
    lastSession,
    dismissSessionSummary,
    stats,
    recentCrawls,
    indexerInfo,
    seedCount: seedCount(),
    scoutedCount: scoutedCount(),
    categories: getCategories(),
    start,
    stop,
    seedUrl,
    scoutRandom,
    previewScout,
    confirmScout,
    dismissScoutPreview,
    startExplorer,
    clearAll,
    updateSettings,
    getSettings,
  };
}
