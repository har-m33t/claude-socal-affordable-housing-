import { afterEach, describe, expect, it, vi } from "vitest";

import { checkDurableLimit, durableBackend } from "../../lib/agent/durable-limit";

const OPTS = { max: 5, globalMax: 20, windowMs: 60_000 };
const BACKEND = { url: "https://example-redis.upstash.io", token: "token-for-tests" };

/** A fake Upstash pipeline reply: [INCR g, PEXPIRE, INCR c, PEXPIRE, PTTL g, PTTL c]. */
function reply(globalCount: number, clientCount: number, ttl = 30_000) {
  return [
    { result: globalCount },
    { result: 1 },
    { result: clientCount },
    { result: 1 },
    { result: ttl },
    { result: ttl },
  ];
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
      fetchImpl: fetchReturning(reply(3, 2)),
    });
    expect(d).toEqual({ ok: true, scope: "client", remaining: 3, retryAfterMs: 0 });
  });

  it("refuses at the GLOBAL ceiling even when that client is well under its own cap", async () => {
    // This is the whole point of the durable limiter: one client rotating keys,
    // or many clients together, must still hit a real spend ceiling.
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(reply(21, 1, 12_000)),
    });
    expect(d).toEqual({ ok: false, scope: "global", remaining: 0, retryAfterMs: 12_000 });
  });

  it("refuses a single noisy client at its own cap", async () => {
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(reply(6, 6, 9_000)),
    });
    expect(d).toEqual({ ok: false, scope: "client", remaining: 0, retryAfterMs: 9_000 });
  });

  it("checks global BEFORE client, so the ceiling is named when both are exceeded", async () => {
    const d = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(reply(99, 99)),
    });
    expect(d?.scope).toBe("global");
  });

  it("allows exactly at the cap and refuses one past it", async () => {
    const at = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(reply(20, 5)),
    });
    expect(at?.ok).toBe(true);
    const past = await checkDurableLimit("ip:a", OPTS, {
      backend: BACKEND,
      fetchImpl: fetchReturning(reply(21, 5)),
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

  it("returns null when the body is not an array", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: fetchReturning({ oops: 1 }) }),
    ).toBeNull();
  });

  it("returns null when the pipeline is short", async () => {
    expect(
      await checkDurableLimit("ip:a", OPTS, {
        backend: BACKEND,
        fetchImpl: fetchReturning([{ result: 1 }]),
      }),
    ).toBeNull();
  });

  it("returns null when Redis reports an error for any command", async () => {
    const bad = reply(1, 1);
    bad[2] = { error: "WRONGTYPE" } as never;
    expect(
      await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: fetchReturning(bad) }),
    ).toBeNull();
  });

  it("returns null when a counter is not a number", async () => {
    const bad = reply(1, 1);
    bad[0] = { result: "nope" } as never;
    expect(
      await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: fetchReturning(bad) }),
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
      return { ok: true, status: 200, json: async () => reply(1, 1) };
    }) as unknown as typeof fetch;
    await checkDurableLimit("ip:a", OPTS, { backend: BACKEND, fetchImpl: spy });
    expect(sawSignal).toBe(true);
  });
});

describe("checkDurableLimit - the request it makes", () => {
  it("sends one atomic pipeline, bearer-authenticated, to /pipeline", async () => {
    let url = "";
    let init: RequestInit = {};
    const spy = vi.fn(async (u: unknown, i: RequestInit) => {
      url = String(u);
      init = i;
      return { ok: true, status: 200, json: async () => reply(1, 1) };
    }) as unknown as typeof fetch;

    await checkDurableLimit("ip:1.2.3.4", OPTS, { backend: BACKEND, fetchImpl: spy });

    expect(url).toBe("https://example-redis.upstash.io/pipeline");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-for-tests");

    const sent = JSON.parse(String(init.body)) as string[][];
    expect(sent.map((c) => c[0])).toEqual(["INCR", "PEXPIRE", "INCR", "PEXPIRE", "PTTL", "PTTL"]);
    // INCR is what makes this atomic across instances; PEXPIRE NX stops the
    // window sliding forward on every request.
    expect(sent[1]?.[3]).toBe("NX");
    expect(sent[3]?.[3]).toBe("NX");
  });

  it("namespaces keys and separates global from per-client", async () => {
    let body = "";
    const spy = vi.fn(async (_u: unknown, i: RequestInit) => {
      body = String(i.body);
      return { ok: true, status: 200, json: async () => reply(1, 1) };
    }) as unknown as typeof fetch;

    await checkDurableLimit("ip:1.2.3.4", OPTS, { backend: BACKEND, fetchImpl: spy });

    const cmds = JSON.parse(body) as string[][];
    const globalKey = cmds[0]?.[1] ?? "";
    const clientKey = cmds[2]?.[1] ?? "";
    expect(globalKey).toContain("pointer:agent:rl:global:");
    expect(clientKey).toContain("pointer:agent:rl:client:ip:1.2.3.4:");
    expect(globalKey).not.toBe(clientKey);
  });

  it("puts different clients in different keys but the same global key", async () => {
    const keysFor = async (who: string) => {
      let body = "";
      const spy = vi.fn(async (_u: unknown, i: RequestInit) => {
        body = String(i.body);
        return { ok: true, status: 200, json: async () => reply(1, 1) };
      }) as unknown as typeof fetch;
      await checkDurableLimit(who, OPTS, { backend: BACKEND, fetchImpl: spy });
      const cmds = JSON.parse(body) as string[][];
      return { global: cmds[0]?.[1], client: cmds[2]?.[1] };
    };
    const a = await keysFor("ip:a");
    const b = await keysFor("ip:b");
    expect(a.client).not.toBe(b.client);
    expect(a.global).toBe(b.global);
  });
});
