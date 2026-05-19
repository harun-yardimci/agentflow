/**
 * Rate-limit detection for CLI error messages.
 *
 * When a provider reports that the user ran out of credit/quota, we want to
 * keep the task in a holding state and resume it automatically once the
 * provider-reported reset window has passed — instead of surfacing a generic
 * failure and forcing the user to retry by hand.
 *
 * Each CLI encodes this differently; only Claude is supported right now.
 * See TODOs below for Codex/Gemini — real samples needed.
 */

export interface RateLimitInfo {
  resumeAt: Date;
  /** Substring that triggered the match; used for logs/debugging. */
  source: string;
}

const FALLBACK_DELAY_MS = 60 * 60 * 1000;
/** Never schedule a resume sooner than this — guards against clock skew
 *  or Intl timezone edge cases that could produce a near-past timestamp
 *  and cause the resumer to immediately re-run into the same rate limit. */
const MIN_HOLD_MS = 60 * 1000;

const CLAUDE_LIMIT_RE = /hit your.*?limit/i;
/** Tightened: require explicit am/pm so we don't misread e.g. "resets 15 min"
 *  as "3pm". If Claude ever drops the meridiem we'll fall through to the 1h
 *  fallback instead of silently scheduling the wrong wall-clock time. */
const CLAUDE_RESET_AT_RE =
  /reset(?:s|ting)?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:\(([^)]+)\))?/i;
const CLAUDE_RESET_IN_RE =
  /reset(?:s|ting)?\s+in\s+(\d+)\s*(hour|hr|h|minute|min|m)s?/i;

export function detectRateLimit(
  errorMsg: string,
  provider: string,
): RateLimitInfo | null {
  if (!errorMsg) return null;

  if (provider === 'claude') return detectClaudeRateLimit(errorMsg);

  // TODO(codex): capture a real `codex exec` rate-limit payload. Errors surface
  // via output-parser as { type: 'item.completed', item: { type: 'error' } }
  // or { type: 'turn.failed', error } — wire detection here once format known.
  // TODO(gemini): capture a real `gemini -p` rate-limit payload. Message may
  // land in stderr, in an assistant text block, or a structured error line.
  return null;
}

function detectClaudeRateLimit(msg: string): RateLimitInfo | null {
  if (!CLAUDE_LIMIT_RE.test(msg)) return null;

  const now = new Date();

  const relative = msg.match(CLAUDE_RESET_IN_RE);
  if (relative) {
    const amount = parseInt(relative[1]!, 10);
    const unit = relative[2]!.toLowerCase();
    const ms = unit.startsWith('h') ? amount * 3_600_000 : amount * 60_000;
    return {
      resumeAt: clampFuture(new Date(now.getTime() + ms), now),
      source: relative[0],
    };
  }

  const absolute = msg.match(CLAUDE_RESET_AT_RE);
  if (absolute) {
    const time = parseTime(absolute[1]!);
    const zone = absolute[2]?.trim();
    if (time) {
      const next = computeNextOccurrence(time.hour, time.minute, zone, now);
      if (next) return { resumeAt: clampFuture(next, now), source: absolute[0] };
    }
  }

  return {
    resumeAt: clampFuture(new Date(now.getTime() + FALLBACK_DELAY_MS), now),
    source: 'fallback:1h',
  };
}

/** Guarantee `resumeAt` is at least MIN_HOLD_MS in the future. */
function clampFuture(resumeAt: Date, now: Date): Date {
  const min = now.getTime() + MIN_HOLD_MS;
  return resumeAt.getTime() < min ? new Date(min) : resumeAt;
}

function parseTime(s: string): { hour: number; minute: number } | null {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1]!, 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'am' && hour === 12) hour = 0;
  else if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Compute the next moment in wall-clock `hour:minute` within `zone`.
 *
 * Ignores DST shifts inside the window (worst case ±1h twice a year on DST
 * boundaries). Good enough for rate-limit reset windows that are typically
 * measured in hours.
 */
function computeNextOccurrence(
  hour: number,
  minute: number,
  zone: string | undefined,
  from: Date,
): Date | null {
  const options: Intl.DateTimeFormatOptions = {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  };
  if (zone) options.timeZone = zone;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', options).formatToParts(from);
  } catch {
    return null;
  }

  const rawHour = parts.find((p) => p.type === 'hour')?.value;
  const rawMin = parts.find((p) => p.type === 'minute')?.value;
  if (rawHour == null || rawMin == null) return null;

  const curHour = parseInt(rawHour, 10) % 24;
  const curMin = parseInt(rawMin, 10);

  let deltaMin = hour * 60 + minute - (curHour * 60 + curMin);
  if (deltaMin <= 0) deltaMin += 24 * 60;

  return new Date(from.getTime() + deltaMin * 60 * 1000);
}
