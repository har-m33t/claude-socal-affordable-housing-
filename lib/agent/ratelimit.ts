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
 * TWO caps, both checked, the global one first:
 *   - per client, keyed on a proxy header, which a caller may be able to
 *     choose; and
 *   - GLOBAL, across every client combined, in a counter that no request can
 *     address. This is the one that actually bounds spend. A per-client limit
 *     that resets when the caller rotates a header is not a spend limit, so
 *     the global counter is deliberately NOT a bucket in the keyed map:
 *     clearing, sweeping or rotating keys cannot touch it.
 *
 * Residual limitation: with POINTER_TRUST_PROXY=1 behind a proxy that does not
 * actually overwrite x-forwarded-for, per-client keys are still
 * attacker-chosen and the per-client cap is worth little. The global cap is the
 * backstop in that case. Keying on the socket peer address would be the real
 * fix, and Next's App Router Request does not expose it.
 *
 * NOT in here, on purpose: authentication, sessions and an Origin/CSRF check.
 * This is a localhost prototype. Deploying it beyond localhost is gated on
 * HTTPS, CORS locked to the app's own origin and a privacy notice, per the
 * build plan - that gate is where those controls belong.
 */
import { readRateLimit, trustProxyHeaders } from "./config";

export interface RateLimitDecision {
  ok: boolean;
  /**
   * Which cap this decision came from. On a refusal it names the one that was
   * hit, so an operator can tell one noisy client from the whole app sitting
   * at its ceiling.
   */
  scope: "client" | "global";
  /** Per-client runs left in the current window. 0 when refused. */
  remaining: number;
  /** Milliseconds until the relevant window resets. 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Counts one run against `key` and says whether it may proceed. */
  check(key: string): RateLimitDecision;
  reset(): void;
}

export interface RateLimiterOptions {
  /** Per-client cap per window. */
  max: number;
  /** Cap across all clients combined, per window. */
  globalMax: number;
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
  // Its own counter, not an entry in `windows`, so no amount of key rotation
  // or map sweeping can reset it.
  let global: Window = { count: 0, resetAt: -Infinity };

  function sweep(at: number): void {
    for (const [key, window] of windows) {
      if (at >= window.resetAt) windows.delete(key);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const at = now();

      // --- global ceiling, checked first.
      if (at >= global.resetAt) global = { count: 0, resetAt: at + options.windowMs };
      if (global.count >= options.globalMax) {
        // Refused here, so the per-client window is not touched at all: a
        // global refusal must not spend anybody's own allowance.
        return {
          ok: false,
          scope: "global",
          remaining: 0,
          retryAfterMs: Math.max(0, global.resetAt - at),
        };
      }

      // --- per-client cap.
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
        return {
          ok: false,
          scope: "client",
          remaining: 0,
          retryAfterMs: Math.max(0, window.resetAt - at),
        };
      }

      // Allowed: only now does the run count against either cap.
      global.count += 1;
      window.count += 1;
      return { ok: true, scope: "client", remaining: options.max - window.count, retryAfterMs: 0 };
    },
    reset(): void {
      windows.clear();
      global = { count: 0, resetAt: -Infinity };
    },
  };
}

/**
 * The bucket key for one request.
 *
 * Proxy headers are ignored unless POINTER_TRUST_PROXY=1, because without a
 * trusted proxy in front of the app they are attacker-supplied: a caller could
 * hand itself a brand new per-client allowance on every request. Off, every
 * caller shares one bucket, which is the safe default. On, the header
 * precedence below applies - and the global cap remains the backstop, since a
 * misconfigured proxy still leaves these keys attacker-chosen.
 *
 * The fallback is deliberately a single SHARED bucket, not a per-request one:
 * with no usable header every caller lands in one bucket rather than each
 * getting an unlimited allowance.
 */
export function clientKey(headers: Headers, trustProxy = trustProxyHeaders()): string {
  if (!trustProxy) return "shared";

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
/**
 * The caps the limiters share, read from the environment. Exported so the
 * durable (Redis) limiter enforces exactly the same numbers as the in-process
 * one it falls back to - two sources of truth would mean the ceiling silently
 * changes depending on which backend answered.
 */
export function rateLimitOptions(): { max: number; globalMax: number; windowMs: number } {
  const { max, globalMax, windowMs } = readRateLimit();
  return { max, globalMax, windowMs };
}

export function requestRateLimiter(): RateLimiter {
  if (shared === null) {
    const { max, globalMax, windowMs } = readRateLimit();
    shared = createRateLimiter({ max, globalMax, windowMs });
  }
  return shared;
}

/**
 * The limiter used when a durable backend is CONFIGURED but not answering.
 *
 * Memoized at module scope for the same reason `requestRateLimiter` is: a
 * limiter built per request starts from zero every time, so its cap is never
 * reached and the "degraded" path is really fail-open. Counts must carry
 * across requests in the instance to mean anything.
 */
let degradedShared: RateLimiter | null = null;

export function degradedRateLimiter(
  caps: { max: number; globalMax: number; windowMs: number },
): RateLimiter {
  if (degradedShared === null) {
    degradedShared = createRateLimiter(caps);
  }
  return degradedShared;
}

/** Drops the shared limiter so the next call re-reads the env. For tests. */
export function resetRateLimiter(): void {
  shared = null;
  degradedShared = null;
}
