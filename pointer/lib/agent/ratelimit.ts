/**
 * Lane `agent-loop`: a per-client cap on live agent runs.
 *
 * Why this exists: a live run spends tokens. The build plan's security table
 * lists "Per-session rate limit, max tokens per call, max agent steps per run"
 * as the control for cost abuse; config.ts has the token and step caps and this
 * file is the third.
 *
 * Fixed window, in process, no dependency and no store. That is the right size
 * for a localhost prototype: it resets when the server restarts and it does not
 * coordinate across instances. Replay runs cost nothing and are never limited.
 *
 * NOT in here, on purpose: authentication, sessions and an Origin/CSRF check.
 * This is a localhost prototype. Deploying it beyond localhost is gated on
 * HTTPS, CORS locked to the app's own origin and a privacy notice, per the
 * build plan - that gate is where those controls belong.
 */
import { readRateLimit } from "./config";

export interface RateLimitDecision {
  ok: boolean;
  /** Runs left in the current window. 0 when refused. */
  remaining: number;
  /** Milliseconds until the window resets. 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Counts one run against `key` and says whether it may proceed. */
  check(key: string): RateLimitDecision;
  reset(): void;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  /** Injectable clock. Tests pass a fake one rather than sleeping. */
  now?: () => number;
}

/** Guard against the bucket map itself becoming the denial of service. */
const MAX_TRACKED_KEYS = 10_000;

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, Window>();

  function sweep(at: number): void {
    for (const [key, window] of windows) {
      if (at >= window.resetAt) windows.delete(key);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const at = now();
      let window = windows.get(key);

      if (window === undefined || at >= window.resetAt) {
        if (windows.size >= MAX_TRACKED_KEYS) {
          sweep(at);
          // Still full: every window is live, so start over rather than grow.
          if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
        }
        window = { count: 0, resetAt: at + options.windowMs };
        windows.set(key, window);
      }

      if (window.count >= options.max) {
        return { ok: false, remaining: 0, retryAfterMs: Math.max(0, window.resetAt - at) };
      }

      window.count += 1;
      return { ok: true, remaining: options.max - window.count, retryAfterMs: 0 };
    },
    reset(): void {
      windows.clear();
    },
  };
}

/**
 * The bucket key for one request. There is no authentication here, so this is
 * a proxy header and a client that sets its own `x-forwarded-for` can pick its
 * own bucket. That is acceptable for a localhost prototype and is exactly why
 * the fallback is a single SHARED bucket: with no proxy headers at all, every
 * caller lands in one bucket rather than getting an unlimited allowance each.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return `ip:${first.slice(0, 64)}`;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real !== undefined && real !== "") return `ip:${real.slice(0, 64)}`;
  return "shared";
}

let shared: RateLimiter | null = null;

/** The process-wide limiter the route uses. Built on first use. */
export function requestRateLimiter(): RateLimiter {
  if (shared === null) {
    const { max, windowMs } = readRateLimit();
    shared = createRateLimiter({ max, windowMs });
  }
  return shared;
}

/** Drops the shared limiter so the next call re-reads the env. For tests. */
export function resetRateLimiter(): void {
  shared = null;
}
