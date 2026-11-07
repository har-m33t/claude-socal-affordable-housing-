/**
 * Durable rate limiting, backed by Upstash Redis over its REST API.
 *
 * WHY THIS EXISTS: `ratelimit.ts` keeps its counters in process memory. That is
 * correct on one long-lived server and close to useless on Vercel, where each
 * serverless instance gets its own memory - so a cap of "20 live runs per
 * minute" silently becomes "20 per instance", and the public URL has no real
 * ceiling at all. With a real ANTHROPIC_API_KEY set, that is somebody's billing
 * account rather than an abstract concern.
 *
 * Counters live in Redis instead, so every instance increments the same number.
 *
 * CONFIGURATION is by environment only, and this module reads nothing else:
 *   KV_REST_API_URL / KV_REST_API_TOKEN              (Vercel Marketplace naming)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash's own naming)
 * Both are injected automatically when the store is attached to the project.
 * When neither pair is present this module reports "not configured" and the
 * caller keeps using the in-process limiter.
 */
import type { RateLimitDecision } from "./ratelimit";

export interface DurableLimitBackend {
  url: string;
  token: string;
}

export interface DurableLimitOptions {
  /** Per-client cap per window. */
  max: number;
  /** Cap across ALL clients per window. The actual spend ceiling. */
  globalMax: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Abort the Redis call after this long; a slow limiter must not stall a run. */
  timeoutMs?: number;
}

/** Namespaced so a shared store cannot collide with another app's keys. */
const PREFIX = "pointer:agent:rl";
const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Check-then-increment, atomically, in one round trip.
 *
 * An earlier version pipelined unconditional INCRs, which was wrong: a caller
 * already over the limit kept pushing the counters up, so the window never
 * drained and a flood of ALREADY-REFUSED requests locked out legitimate users
 * for the whole window. A refused request must not consume the budget it was
 * refused by.
 *
 * Lua runs atomically inside Redis, so the read and the increment cannot
 * interleave with another instance. Comparisons are `>=` against the value
 * BEFORE incrementing, which matches the in-process limiter's boundary.
 */
const LIMIT_SCRIPT = `
local gc = tonumber(redis.call('GET', KEYS[1]) or '0')
local cc = tonumber(redis.call('GET', KEYS[2]) or '0')
local gmax = tonumber(ARGV[1])
local cmax = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if gc >= gmax then
  return {0, 'global', gc, cc, redis.call('PTTL', KEYS[1])}
end
if cc >= cmax then
  return {0, 'client', gc, cc, redis.call('PTTL', KEYS[2])}
end
gc = redis.call('INCR', KEYS[1])
if gc == 1 then redis.call('PEXPIRE', KEYS[1], ttl) end
cc = redis.call('INCR', KEYS[2])
if cc == 1 then redis.call('PEXPIRE', KEYS[2], ttl) end
return {1, 'ok', gc, cc, ttl}
`;

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The backend from the environment, or null when nothing is configured.
 * Accepts either naming so the Marketplace integration and a hand-configured
 * Upstash store both work with no code change.
 */
export function durableBackend(): DurableLimitBackend | null {
  const url = readEnv("KV_REST_API_URL") ?? readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("KV_REST_API_TOKEN") ?? readEnv("UPSTASH_REDIS_REST_TOKEN");
  if (url === null || token === null) return null;
  // A misconfigured URL must not become an SSRF vector: https only, no
  // credentials embedded in the URL, and it must parse.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), token };
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Returns a decision, or null when the backend is absent, unreachable, or
 * answers in a shape we do not recognise. null means "I could not decide" and
 * is never treated by the caller as "allow" - see `durableHealth` for what the
 * caller does with a configured-but-unhealthy backend.
 */
export async function checkDurableLimit(
  key: string,
  options: DurableLimitOptions,
  deps: { backend?: DurableLimitBackend | null; fetchImpl?: typeof fetch } = {},
): Promise<RateLimitDecision | null> {
  const backend = deps.backend === undefined ? durableBackend() : deps.backend;
  if (backend === null) return null;

  const doFetch = deps.fetchImpl ?? fetch;
  const ttl = Math.max(1, Math.floor(options.windowMs));
  // The window number makes each window its own key, so a counter can never be
  // inherited by the next window if a TTL is somehow lost.
  const windowId = Math.floor(Date.now() / ttl);
  const globalKey = `${PREFIX}:global:${windowId}`;
  const clientKey = `${PREFIX}:client:${key}:${windowId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let out: unknown;
  try {
    const res = await doFetch(backend.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${backend.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        LIMIT_SCRIPT,
        "2",
        globalKey,
        clientKey,
        String(options.globalMax),
        String(options.max),
        String(ttl),
      ]),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body === null || typeof body !== "object") return null;
    const rec = body as Record<string, unknown>;
    if ("error" in rec && rec.error) return null;
    out = rec.result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(out) || out.length < 5) return null;
  const allowed = asNum(out[0]);
  const which = typeof out[1] === "string" ? out[1] : null;
  const globalCount = asNum(out[2]);
  const clientCount = asNum(out[3]);
  const ttlLeft = asNum(out[4]);
  if (allowed === null || which === null || globalCount === null || clientCount === null) {
    return null;
  }

  if (allowed === 0) {
    return {
      ok: false,
      scope: which === "global" ? "global" : "client",
      remaining: 0,
      retryAfterMs: ttlLeft !== null && ttlLeft > 0 ? ttlLeft : ttl,
    };
  }
  return {
    ok: true,
    scope: "client",
    remaining: Math.max(0, options.max - clientCount),
    retryAfterMs: 0,
  };
}

/**
 * How the caller should behave when the durable backend is CONFIGURED but did
 * not answer.
 *
 * The naive fallback - just use the in-process limiter - is an escalation path:
 * flood the app, exhaust the Redis quota, and the ceiling silently reverts to
 * per-instance, which is what the durable limiter existed to fix. Failing
 * closed instead would turn one transient blip into a dead demo.
 *
 * So a configured-but-unhealthy backend falls back to a DELIBERATELY TIGHTER
 * in-process budget: the global cap divided across an assumed instance count,
 * floored at 1. The app keeps serving, but an attacker who can break Redis
 * gains a much smaller ceiling than before rather than a larger one.
 */
export const ASSUMED_INSTANCES = 8;

export function degradedCaps(options: DurableLimitOptions): { max: number; globalMax: number } {
  const perInstance = Math.max(1, Math.floor(options.globalMax / ASSUMED_INSTANCES));
  return { max: Math.max(1, Math.min(options.max, perInstance)), globalMax: perInstance };
}
