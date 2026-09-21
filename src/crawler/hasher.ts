// SHA-256 content hashing for deduplication

export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

export async function hashUrl(url: string): Promise<string> {
  return hashContent(normalizeUrl(url));
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      '_ga', '_gl', 'dclid', 'gbraid', 'wbraid',
    ];
    trackingParams.forEach(param => u.searchParams.delete(param));
    
    // Normalize: lowercase host, remove trailing slash
    u.hostname = u.hostname.toLowerCase();
    let normalized = u.href;
    if (normalized.endsWith('/') && u.pathname === '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}
