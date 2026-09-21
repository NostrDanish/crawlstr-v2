import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFetch,
  recordPage,
  bytesLastHour,
  pagesLastHour,
  remainingBytesThisHour,
  getSessionTotals,
  resetMeter,
} from './meter';

beforeEach(() => resetMeter());

describe('meter — sliding-window resource accounting', () => {
  it('counts bytes within the hour window', () => {
    recordFetch(1000);
    recordFetch(2000);
    expect(bytesLastHour()).toBe(3000);
  });

  it('expires entries older than one hour', () => {
    const now = Date.now();
    const old = now - 61 * 60 * 1000; // 61 min ago
    recordFetch(5000, old);
    recordFetch(1000, now);
    expect(bytesLastHour(now)).toBe(1000);
  });

  it('counts pages separately from bytes', () => {
    recordFetch(10000);
    recordPage();
    recordPage();
    expect(pagesLastHour()).toBe(2);
  });

  it('pages window also expires', () => {
    const now = Date.now();
    const old = now - 61 * 60 * 1000;
    recordPage(old);
    recordPage(now);
    expect(pagesLastHour(now)).toBe(1);
  });

  it('remainingBytesThisHour never goes negative', () => {
    recordFetch(10000);
    expect(remainingBytesThisHour(5000)).toBe(0);
    expect(remainingBytesThisHour(20000)).toBe(10000);
  });

  it('tracks session totals independently of the window', () => {
    recordFetch(1000);
    recordFetch(2000);
    const { bytes, fetches } = getSessionTotals();
    expect(bytes).toBe(3000);
    expect(fetches).toBe(2);
  });
});
