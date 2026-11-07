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
 *
 * FAILURE POLICY: on any Redis error, timeout or malformed reply, this returns
 * `null` rather than a decision, and the caller falls back to the in-process
 * limiter. That is deliberate. Failing closed would turn one Redis hiccup into
 * a dead demo; failing fully open would remove the ceiling exactly when the
 * backend is unhealthy. Falling back preserves the per-instance cap - the
 * behaviour we had before this file existed - and the caller reports which
 * limiter actually decided.
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
  // A misconfigured URL must not become an SSRF vector: only https, no
  // credentials in the URL, and it must parse.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), token };
}

interface PipelineReply {
  result?: unknown;
  error?: unknown;
}

function asCount(reply: PipelineReply | undefined): number | null {
  const v = reply?.result;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * One fixed window, two counters, one round trip.
 *
 * INCR is atomic, so concurrent instances cannot both read a stale value. PEXPIRE
 * with NX sets the lifetime only on the first increment of a window, so the
 * window does not slide forward on every request. PTTL comes back in the same
 * pipeline, giving an accurate retry hint without a second call.
 *
 * Returns null when the backend is unreachable or answers in a shape we do not
 * recognise, which the caller treats as "fall back", never as "allow".
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
  let replies: PipelineReply[];
  try {
    const res = await doFetch(`${backend.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${backend.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", globalKey],
        ["PEXPIRE", globalKey, String(ttl), "NX"],
        ["INCR", clientKey],
        ["PEXPIRE", clientKey, String(ttl), "NX"],
        ["PTTL", globalKey],
        ["PTTL", clientKey],
      ]),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length < 6) return null;
    replies = body as PipelineReply[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (replies.some((r) => r !== null && typeof r === "object" && "error" in r && r.error)) {
    return null;
  }

  const globalCount = asCount(replies[0]);
  const clientCount = asCount(replies[2]);
  if (globalCount === null || clientCount === null) return null;

  const globalTtl = asCount(replies[4]);
  const clientTtl = asCount(replies[5]);
  const resetGlobal = globalTtl !== null && globalTtl > 0 ? globalTtl : ttl;
  const resetClient = clientTtl !== null && clientTtl > 0 ? clientTtl : ttl;

  // Global is checked FIRST: it is the spend ceiling, and a caller rotating
  // its client key must still hit it.
  if (globalCount > options.globalMax) {
    return { ok: false, scope: "global", remaining: 0, retryAfterMs: resetGlobal };
  }
  if (clientCount > options.max) {
    return { ok: false, scope: "client", remaining: 0, retryAfterMs: resetClient };
  }
  return {
    ok: true,
    scope: "client",
    remaining: Math.max(0, options.max - clientCount),
    retryAfterMs: 0,
  };
}
