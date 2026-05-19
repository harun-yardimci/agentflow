import { describe, it, expect } from 'vitest';
import { detectRateLimit } from '../rate-limit-detector.js';

describe('detectRateLimit', () => {
  it('returns null when the message does not look like a rate limit', () => {
    expect(detectRateLimit('Some unrelated error', 'claude')).toBeNull();
    expect(detectRateLimit('', 'claude')).toBeNull();
  });

  it('returns null for non-claude providers (TODO)', () => {
    expect(detectRateLimit("You've hit your limit · resets 12am (UTC)", 'codex')).toBeNull();
    expect(detectRateLimit("You've hit your limit · resets 12am (UTC)", 'gemini')).toBeNull();
  });

  it('parses "resets HH am (Zone)" absolute format', () => {
    const info = detectRateLimit(
      "You've hit your limit · resets 12am (Europe/Istanbul)",
      'claude',
    );
    expect(info).not.toBeNull();
    expect(info!.resumeAt.getTime()).toBeGreaterThan(Date.now());
    // Upper bound: never more than 24h away.
    expect(info!.resumeAt.getTime() - Date.now()).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
    expect(info!.source).toMatch(/resets?\s+12am/i);
  });

  it('parses "resets in N hours" relative format', () => {
    const info = detectRateLimit(
      "You've hit your 5-hour limit. Resets in 3 hours.",
      'claude',
    );
    expect(info).not.toBeNull();
    const deltaMs = info!.resumeAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(3 * 3600_000 - 5_000);
    expect(deltaMs).toBeLessThan(3 * 3600_000 + 5_000);
  });

  it('parses "resets in N minutes" relative format', () => {
    const info = detectRateLimit(
      "You've hit your usage limit. Resets in 45 minutes.",
      'claude',
    );
    expect(info).not.toBeNull();
    const deltaMs = info!.resumeAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(45 * 60_000 - 5_000);
    expect(deltaMs).toBeLessThan(45 * 60_000 + 5_000);
  });

  it('falls back to ~1h delay when reset time is unparseable', () => {
    const info = detectRateLimit(
      "You've hit your limit but the format is weird blah",
      'claude',
    );
    expect(info).not.toBeNull();
    expect(info!.source).toBe('fallback:1h');
    const deltaMs = info!.resumeAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(59 * 60_000);
    expect(deltaMs).toBeLessThan(61 * 60_000);
  });

  it('handles an invalid timezone by falling back', () => {
    const info = detectRateLimit(
      "You've hit your limit · resets 3pm (Not/AZone)",
      'claude',
    );
    expect(info).not.toBeNull();
    // Either parsed via fallback (1h) or succeeded somehow — assert not null + in future.
    expect(info!.resumeAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('is case-insensitive on the trigger', () => {
    const info = detectRateLimit(
      "YOU'VE HIT YOUR LIMIT · RESETS 3PM (UTC)",
      'claude',
    );
    expect(info).not.toBeNull();
  });

  it('does not misparse meridiem-less digits as an hour', () => {
    // Historic risk: "resets 15 min" being captured as "resets 15[pm]" and
    // scheduling 3pm today. Tightened regex requires meridiem; falls back.
    const info = detectRateLimit(
      "You've hit your limit. Resets 15 min later hopefully.",
      'claude',
    );
    expect(info).not.toBeNull();
    expect(info!.source).toBe('fallback:1h');
  });

  it('clamps resume_at to at least 1 minute in the future', () => {
    // A zero-duration relative ("resets in 0 hours") should not schedule
    // immediately — the resumer would otherwise loop into the same rate
    // limit on the next tick.
    const info = detectRateLimit(
      "You've hit your limit. Resets in 0 hours.",
      'claude',
    );
    expect(info).not.toBeNull();
    const deltaMs = info!.resumeAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThanOrEqual(59_000);
  });
});
