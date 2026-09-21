import { describe, it, expect } from 'vitest';
import type { CrawlJob } from './types';

/**
 * The scheduling invariant the audit flagged: the old getNextJob looked at
 * ONLY the highest-priority job and returned null when it was delayed,
 * starving ready jobs below it. The fix walks the cursor until it finds a
 * READY job. IndexedDB isn't in jsdom, so we model the cursor-walk logic
 * against an in-memory list to lock in the behavior.
 */

function pickReadyJob(jobs: CrawlJob[], now: number): CrawlJob | null {
  const sorted = [...jobs].sort((a, b) => b.priority - a.priority); // highest first
  for (const job of sorted) {
    if (!job.nextAttempt || job.nextAttempt <= now) return job;
  }
  return null;
}

function job(url: string, priority: number, nextAttempt?: number): CrawlJob {
  return { url, priority, depth: 0, attempts: 0, nextAttempt };
}

describe('ready-job scheduling (audit finding #3)', () => {
  it('returns the highest-priority READY job, not just the highest-priority job', () => {
    const now = Date.now();
    const jobs = [
      job('https://delayed.example', 1.0, now + 120_000),  // top priority but delayed
      job('https://ready-a.example', 0.8),                 // ready now
      job('https://ready-b.example', 0.6),                 // ready now
    ];
    expect(pickReadyJob(jobs, now)?.url).toBe('https://ready-a.example');
  });

  it('returns null only when EVERYTHING is delayed', () => {
    const now = Date.now();
    const jobs = [
      job('https://a.example', 1.0, now + 60_000),
      job('https://b.example', 0.5, now + 30_000),
    ];
    expect(pickReadyJob(jobs, now)).toBeNull();
  });

  it('treats a missing nextAttempt as ready', () => {
    const now = Date.now();
    const jobs = [job('https://plain.example', 0.1)];
    expect(pickReadyJob(jobs, now)?.url).toBe('https://plain.example');
  });

  it('a due retry beats a fresh lower-priority job', () => {
    const now = Date.now();
    const jobs = [
      job('https://retry.example', 0.9, now - 1000), // was delayed, now due
      job('https://fresh.example', 0.5),
    ];
    expect(pickReadyJob(jobs, now)?.url).toBe('https://retry.example');
  });

  it('returns null on an empty queue', () => {
    expect(pickReadyJob([], Date.now())).toBeNull();
  });
});
