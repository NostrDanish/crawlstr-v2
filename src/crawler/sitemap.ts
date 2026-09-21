/**
 * XML sitemap parsing.
 *
 * Handles <urlset> (page URLs) and <sitemapindex> (nested sitemaps).
 * Sitemaps are the site's own map of itself — the single highest-value
 * discovery document a crawler can read. We sample them, never drink
 * from the firehose.
 */

export interface ParsedSitemap {
  /** Page URLs from a <urlset>. */
  urls: string[];
  /** Child sitemap URLs from a <sitemapindex>. */
  sitemaps: string[];
}

export function parseSitemap(xml: string, baseUrl: string): ParsedSitemap | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  const result: ParsedSitemap = { urls: [], sitemaps: [] };

  const collect = (locs: NodeListOf<Element>, into: string[]) => {
    locs.forEach((loc) => {
      const text = loc.textContent?.trim();
      if (!text) return;
      try {
        const url = new URL(text, baseUrl).href;
        if (url.startsWith('http')) into.push(url);
      } catch {
        // Invalid URL, skip
      }
    });
  };

  collect(doc.querySelectorAll('urlset > url > loc, url > loc'), result.urls);
  collect(doc.querySelectorAll('sitemapindex > sitemap > loc, sitemap > loc'), result.sitemaps);

  // Deduplicate
  result.urls = [...new Set(result.urls)];
  result.sitemaps = [...new Set(result.sitemaps)];

  if (result.urls.length === 0 && result.sitemaps.length === 0) return null;
  return result;
}

/**
 * Pick up to `count` items with a cheap deterministic spread (evenly spaced
 * through the list rather than always the first N — the head of a sitemap is
 * often the newest or the nav pages).
 */
export function sampleUrls(urls: string[], count: number): string[] {
  if (urls.length <= count) return urls;
  const step = urls.length / count;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(urls[Math.floor(i * step)]);
  }
  return out;
}
