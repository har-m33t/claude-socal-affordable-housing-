import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSUMED_INSTANCES,
  checkDurableLimit,
  degradedCaps,
  durableBackend,
} from "../../lib/agent/durable-limit";

const OPTS = { max: 5, globalMax: 20, windowMs: 60_000 };
const BACKEND = { url: "https://example-redis.upstash.io", token: "token-for-tests" };

/** The Lua script's reply: {allowed, which, globalCount, clientCount, ttl}. */
function allow(globalCount: number, clientCount: number, ttl = 30_000) {
  return { result: [1, "ok", globalCount, clientCount, ttl] };
}
function refuse(which: "global" | "client", globalCount: number, clientCount: number, ttl = 30_000) {
  return { result: [0, which, globalCount, clientCount, ttl] };
}

function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("durableBackend - configuration", () => {
  it("is null when nothing is configured, so the caller keeps the in-process limiter", () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(durableBackend()).toBeNull();
  });

  it("accepts the Vercel Marketplace naming", () => {
    vi.stubEnv("KV_REST_API_URL", "https://a.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    expect(durableBackend()).toEqual({ url: "https://a.upstash.io", token: "t" });
  });

  it("accepts Upstash's own naming", () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://b.upstash.io/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t2");
    // Trailing slash is stripped so the pipeline path cannot become a double slash.
    expect(durableBackend()).toEqual({ url: "https://b.upstash.io", token: "t2" });
  });

  it("refuses a non-https URL, so a misconfigured var cannot become an SSRF vector", () => {
    vi.stubEnv("KV_REST_API_URL", "http://internal.local");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    expect(durableBackend()).toBeNull();
  });

  it("refuses a URL carrying credentials", () => {
    vi.stubEnv("KV_REST_API_URL", "https://user:pass@a.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    expect(durableBackend()).toBeNull();
  });

  it("refuses an unparseable URL", () => {
    vi.stubEnv("KV_REST_API_URL", "not a url");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    expect(durableBackend()).toBeNull();
  });
});

describe("checkDurableLimit - decisions", () => {
  it("returns null when no backend is configured", async () => {
    expect(await checkDurableLimit("ip:a", OPTS, { backend: null })).toBeNull();
  });

  it("allows a run under both caps and reports the client remainder", async () => {
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(allow(3, 2)),
    });
    expect(d).toEqual({ ok: true, scope: "client", remaining: 3, retryAfterMs: 0 });
  });

  it("refuses at the GLOBAL ceiling even when that client is well under its own cap", async () => {
    // This is the whole point of the durable limiter: one client rotating keys,
    // or many clients together, must still hit a real spend ceiling.
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(refuse("global", 20, 1, 12_000)),
    });
    expect(d).toEqual({ ok: false, scope: "global", remaining: 0, retryAfterMs: 12_000 });
  });

  it("refuses a single noisy client at its own cap", async () => {
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(refuse("client", 6, 5, 9_000)),
    });
    expect(d).toEqual({ ok: false, scope: "client", remaining: 0, retryAfterMs: 9_000 });
  });

  it("checks global BEFORE client, so the ceiling is named when both are exceeded", async () => {
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(refuse("global", 99, 99)),
    });
    expect(d?.scope).toBe("global");
  });

  it("allows exactly at the cap and refuses one past it", async () => {
    const at = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(allow(20, 5)),
    });
    expect(at?.ok).toBe(true);
    const past = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(refuse("global", 20, 5)),
    });
    expect(past?.ok).toBe(false);
  });
});

describe("checkDurableLimit - failure policy", () => {
  // Every case here must return null, NOT a decision. null means "fall back to
  // the in-process limiter", which keeps the per-instance cap. Returning
  // {ok:true} would remove the ceiling exactly when the backend is unhealthy;
  // returning {ok:false} would turn a Redis hiccup into a dead demo.
  it("returns null on a non-OK HTTP status", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, {
        backend: BACKEND,
        fetchImpl: fetchReturning({}, false, 500),
      }),
    ).toBeNull();
  });

  it("returns null when the result is not an array", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: fetchReturning({ result: "nope" }) }),
    ).toBeNull();
  });

  it("returns null when the pipeline is short", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, {
        backend: BACKEND,
        fetchImpl: fetchReturning({ result: [1, "ok"] }),
      }),
    ).toBeNull();
  });

  it("returns null when Redis reports a script error", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, {
        backend: BACKEND,
        fetchImpl: fetchReturning({ error: "ERR unknown command" }),
      }),
    ).toBeNull();
  });

  it("returns null when a counter is not a number", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, {
        backend: BACKEND,
        fetchImpl: fetchReturning({ result: [1, "ok", "nope", 1, 1] }),
      }),
    ).toBeNull();
  });

  it("returns null when fetch throws or is aborted", async () => {
    const boom = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: boom })).toBeNull();
  });

  it("falls back rather than stalling: it passes an abort signal", async () => {
    let sawSignal = false;
    const spy = vi.fn(async (_u: unknown, init: RequestInit) => {
      sawSignal = init.signal instanceof AbortSignal;
      return { ok: true, status: 200, json: async () => allow(1, 1) };
    }) as unknown as typeof fetch;
    await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: spy });
    expect(sawSignal).toBe(true);
  });
});

describe("checkDurableLimit - the request it makes", () => {
  it("sends ONE atomic EVAL, bearer-authenticated, with both keys", async () => {
    let url = "";
    let init: RequestInit = {};
    const spy = vi.fn(async (u: unknown, i: RequestInit) => {
      url = String(u);
      init = i;
      return { ok: true, status: 200, json: async () => allow(1, 1) };
    }) as unknown as typeof fetch;

    await checkDurableLimit("ip:1.2.3.4", OPTS, { backend: BACKEND, fetchImpl: spy });

    expect(url).toBe("https://example-redis.upstash.io");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-for-tests");

    const sent = JSON.parse(String(init.body)) as string[];
    expect(sent[0]).toBe("EVAL");
    expect(sent[2]).toBe("2");
    // The script must CHECK before it increments: a refused request that still
    // increments would let a flood of refusals lock out everyone for the window.
    expect(sent[1]).toContain("if gc >= gmax then");
    expect(sent[1]).toContain("if cc >= cmax then");
    const incrAt = sent[1]!.indexOf("INCR");
    expect(sent[1]!.indexOf("if gc >= gmax then")).toBeLessThan(incrAt);
  });

  it("namespaces keys and separates global from per-client", async () => {
    let body = "";
    const spy = vi.fn(async (_u: unknown, i: RequestInit) => {
      body = String(i.body);
      return { ok: true, status: 200, json: async () => allow(1, 1) };
    }) as unknown as typeof fetch;

    await checkDurableLimit("ip:1.2.3.4", OPTS, { backend: BACKEND, fetchImpl: spy });

    const sent = JSON.parse(body) as string[];
    expect(sent[3]).toContain("pointer:agent:rl:global:");
    expect(sent[4]).toContain("pointer:agent:rl:client:ip:1.2.3.4:");
    expect(sent[3]).not.toBe(sent[4]);
  });

  it("puts different clients in different keys but the same global key", async () => {
    const keysFor = async (who: string) => {
      let body = "";
      const spy = vi.fn(async (_u: unknown, i: RequestInit) => {
        body = String(i.body);
        return { ok: true, status: 200, json: async () => allow(1, 1) };
      }) as unknown as typeof fetch;
      await checkDurableLimit(who, OPTS, { backend: BACKEND, fetchImpl: spy });
      const sent = JSON.parse(body) as string[];
      return { global: sent[3], client: sent[4] };
    };
    const a = await keysFor("ip:a");
    const b = await keysFor("ip:b");
    expect(a.client).not.toBe(b.client);
    expect(a.global).toBe(b.global);
  });
});

describe("degradedCaps - a broken backend must not RAISE the ceiling", () => {
  it("is much tighter than the configured global cap", () => {
    const d = degradedCaps(OPTS);
    expect(d.globalMax).toBe(Math.floor(OPTS.globalMax / ASSUMED_INSTANCES));
    expect(d.globalMax).toBeLessThan(OPTS.globalMax);
  });

  it("never drops below 1, so the app still serves", () => {
    const d = degradedCaps({ max: 5, globalMax: 2, windowMs: 1000 });
    expect(d.globalMax).toBeGreaterThanOrEqual(1);
    expect(d.max).toBeGreaterThanOrEqual(1);
  });

  it("never exceeds the per-client cap", () => {
    const d = degradedCaps({ max: 2, globalMax: 1000, windowMs: 1000 });
    expect(d.max).toBeLessThanOrEqual(2);
  });
});

describe("degradedRateLimiter - counts must carry across requests", () => {
  // The bug this pins: building the degraded limiter per request gave every
  // request fresh counters, so its cap was never reached. That is fail-open,
  // which defeats the entire point of degrading rather than falling back.
  it("returns the SAME limiter instance on repeated calls", async () => {
    const { degradedRateLimiter, resetRateLimiter } = await import("../../lib/agent/ratelimit");
    resetRateLimiter();
    const caps = { max: 2, globalMax: 2, windowMs: 60_000 };
    expect(degradedRateLimiter(caps)).toBe(degradedRateLimiter(caps));
    resetRateLimiter();
  });

  it("actually refuses once the degraded cap is reached, across separate calls", async () => {
    const { degradedRateLimiter, resetRateLimiter } = await import("../../lib/agent/ratelimit");
    resetRateLimiter();
    const caps = { max: 2, globalMax: 2, windowMs: 60_000 };
    const hit = () => degradedRateLimiter(caps).check("ip:same");
    expect(hit().ok).toBe(true);
    expect(hit().ok).toBe(true);
    // A per-request limiter would still say true here.
    expect(hit().ok).toBe(false);
    resetRateLimiter();
  });

  it("is dropped by resetRateLimiter so a test cannot leak state into the next", async () => {
    const { degradedRateLimiter, resetRateLimiter } = await import("../../lib/agent/ratelimit");
    const caps = { max: 1, globalMax: 1, windowMs: 60_000 };
    resetRateLimiter();
    expect(degradedRateLimiter(caps).check("ip:x").ok).toBe(true);
    expect(degradedRateLimiter(caps).check("ip:x").ok).toBe(false);
    resetRateLimiter();
    expect(degradedRateLimiter(caps).check("ip:x").ok).toBe(true);
    resetRateLimiter();
  });
});
