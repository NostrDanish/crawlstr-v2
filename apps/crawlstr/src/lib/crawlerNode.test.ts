import { describe, it, expect } from 'vitest';

import { buildCrawlerConfig, CRAWLER_DB_NAME, CRAWLER_SOURCE } from '@/lib/crawlerNode';
import { DEFAULT_SETTINGS } from '@/lib/crawlerSettings';
import { SIP01_RELAYS } from '@/lib/relays';

const noopPublish = () => Promise.reject(new Error('test: no publish'));

describe('buildCrawlerConfig (crawlstr host-seam wiring)', () => {
  const config = buildCrawlerConfig(DEFAULT_SETTINGS, noopPublish);

  it('keeps the v1 database name and bumps the source tag', () => {
    expect(config.dbName).toBe(CRAWLER_DB_NAME);
    expect(config.dbName).toBe('searchstr-crawler');
    expect(config.source).toBe(CRAWLER_SOURCE);
  });

  it('enables the crawlstr module set per blueprint §6 (discovery + heartbeat on; intake/enrich/sharding off)', () => {
    expect(config.modules?.discovery).toEqual({ feeds: true, sitemaps: true });
    expect(config.modules?.heartbeat?.enabled).toBe(true);
    expect(config.modules?.intake?.enabled).toBe(false);
    expect(config.modules?.enrich?.enabled).toBe(false);
    expect(config.modules?.sharding?.enabled).toBe(false);
    expect(config.modules?.traps?.enabled).toBe(true);
  });

  it('maps settings onto budgets and politeness', () => {
    expect(config.budgets?.maxPagesPerHour).toBe(DEFAULT_SETTINGS.maxPagesPerHour);
    expect(config.budgets?.maxBytesPerHour).toBe(DEFAULT_SETTINGS.maxBandwidthMB * 1024 * 1024);
    expect(config.budgets?.maxPageSizeKB).toBe(DEFAULT_SETTINGS.maxPageSizeKB);
    expect(config.politeness?.respectRobots).toBe(true);
    expect(config.politeness?.minIntervalPerDomainMs).toBe(8000); // eco mode default
    expect(config.crawl?.maxDepth).toBe(DEFAULT_SETTINGS.maxDepth);
  });

  it('publishes to a conformant relay set (≥2 relays, ≥1 SIP-01-aware index relay)', () => {
    const relays = config.relays.publish;
    expect(relays.length).toBeGreaterThanOrEqual(2);
    expect(relays.some((url) => SIP01_RELAYS.includes(url))).toBe(true);
    expect(new Set(relays).size).toBe(relays.length); // deduped
  });

  it('injects the indexer identity signer and the CORS-proxy-aware wire fetch', () => {
    expect(typeof config.signer).toBe('function');
    expect(config.indexerPubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(config.transports.proxyTemplate).toContain('{href}');
    expect(typeof config.transports.fetch).toBe('function');
    // Network intake transports stay unwired (module off).
    expect(config.transports.subscribe).toBeUndefined();
    expect(config.transports.query).toBeUndefined();
  });

  it('honors non-eco pacing and toggled discovery settings', () => {
    const custom = buildCrawlerConfig(
      { ...DEFAULT_SETTINGS, ecoMode: false, followFeeds: false, followSitemaps: false, respectRobots: false },
      noopPublish,
    );
    expect(custom.politeness?.minIntervalPerDomainMs).toBe(5000);
    expect(custom.politeness?.respectRobots).toBe(false);
    expect(custom.modules?.discovery).toEqual({ feeds: false, sitemaps: false });
  });
});
