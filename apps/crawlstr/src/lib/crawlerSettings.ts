// Crawlstr app settings + crawl modes.
//
// App-specific presentation/config state (blueprint §6: settings UI and
// seed/mode policy live in the app; the engine itself is @sip01/crawler-core).
// Settings persist in localStorage and are mapped onto a CrawlerConfig in
// lib/crawlerNode.ts.

/** Crawl budget presets — how much one session may do before auto-stopping. */
export type CrawlMode = 'quick' | 'site' | 'deep' | 'volunteer';

export const CRAWL_MODES: Record<CrawlMode, { label: string; maxPages: number; description: string }> = {
  quick:     { label: 'Quick Scan', maxPages: 5,   description: '1–5 pages, fast inspection' },
  site:      { label: 'Site Scan',  maxPages: 30,  description: '~30 pages, useful crawl' },
  deep:      { label: 'Deep Scan',  maxPages: 150, description: 'up to ~150 pages' },
  volunteer: { label: 'Volunteer',  maxPages: 0,   description: 'crawl until you stop it' },
};

export interface CrawlerSettings {
  wifiOnly: boolean;
  chargingOnly: boolean;
  respectRobots: boolean;
  maxBandwidthMB: number;
  maxPagesPerHour: number;
  maxDepth: number;
  maxPageSizeKB: number;
  ecoMode: boolean;
  /** Follow RSS/Atom feeds found on pages. */
  followFeeds: boolean;
  /** Read sitemap.xml for discovery. */
  followSitemaps: boolean;
}

export const DEFAULT_SETTINGS: CrawlerSettings = {
  wifiOnly: false,
  chargingOnly: false,
  respectRobots: true,
  maxBandwidthMB: 100,
  maxPagesPerHour: 500,
  maxDepth: 3,
  maxPageSizeKB: 2048,
  ecoMode: true,
  followFeeds: true,
  followSitemaps: true,
};

const LS_SETTINGS = 'crawler-settings';

/** Load settings, tolerating corrupted JSON (defaults on corruption). */
export function loadCrawlerSettings(): CrawlerSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : null;
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveCrawlerSettings(settings: CrawlerSettings): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  } catch {
    // Storage unavailable — settings simply won't persist.
  }
}
