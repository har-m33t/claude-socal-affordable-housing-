import { describe, expect, it, vi } from "vitest";
import { formatFrame } from "@/lib/agent/sse";
import type { StreamFrame } from "@/lib/agent/types";
import { FULL_RUN_QUESTION, startLiveRun, type LiveRunRequest, type LiveRunSignal } from "@/lib/live/run-client";

const ts = "2026-11-07T12:00:00Z";
const REQ: LiveRunRequest = { city: "Anaheim", projectType: "adu", question: FULL_RUN_QUESTION, documents: [] };

/** The server's own SSE encoder, cut into odd-sized chunks so frames split mid-line. */
function sse(frames: StreamFrame[], chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(frames.map(formatFrame).join(""));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function run(res: Response | (() => Promise<Response>), signal?: AbortSignal) {
  const signals: LiveRunSignal[] = [];
  const fetchImpl = vi.fn(async () => (typeof res === "function" ? res() : res)) as unknown as typeof fetch;
  const end = await startLiveRun(REQ, (s) => signals.push(s), signal, fetchImpl);
  return { end, signals, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

const point = { type: "event", event: { tool: "point_to", item_id: "express-applicant-name", ts } } as const;
const mark = { type: "event", event: { tool: "mark_item", item_id: "meter-spot-report", status: "missing", ts } } as const;

describe("startLiveRun: SSE frames", () => {
  it("posts the redacted request to /api/agent as JSON", async () => {
    const { fetchImpl } = await run(sse([{ type: "status", phase: "done" }]));
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(REQ);
  });

  it("parses every frame type across 1-byte chunk boundaries", async () => {
    const frames: StreamFrame[] = [
      { type: "status", phase: "started", detail: "Anaheim / adu" },
      { type: "status", phase: "step", step: 1 },
      point,
      { type: "dropped", reason: "prose asserts law", event: { tool: "add_note", item_id: "b802-adu-impact-fees", text: "x", ts } },
      mark,
      { type: "status", phase: "done", detail: "end_turn" },
    ];
    const { end, signals } = await run(sse(frames, 1));
    expect(end).toEqual({ kind: "done" });
    expect(signals).toEqual([
      { kind: "status", phase: "started", step: undefined, detail: "Anaheim / adu" },
      { kind: "status", phase: "step", step: 1, detail: undefined },
      { kind: "event", event: point.event },
      { kind: "dropped", reason: "prose asserts law", event: expect.objectContaining({ tool: "add_note" }) },
      { kind: "event", event: mark.event },
    ]);
  });

  it("skips malformed events instead of trusting them", async () => {
    const bad = { type: "event", event: { tool: "submit_application", item_id: "x", ts } } as unknown as StreamFrame;
    const { signals } = await run(sse([bad, point, { type: "status", phase: "done" }]));
    expect(signals.filter((s) => s.kind === "event")).toHaveLength(1);
  });

  it("a refusal ends the run with its reason", async () => {
    const { end } = await run(sse([point, { type: "refusal", reason: "The model declined." }, { type: "status", phase: "stopped" }]));
    expect(end).toEqual({ kind: "refused", note: "The model declined." });
  });

  it("an unverified city is a refusal, not 'unavailable'", async () => {
    const { end } = await run(
      sse([
        { type: "status", phase: "started" },
        { type: "error", code: "not_verified", message: 'the city "Brea" is not verified yet' },
        { type: "status", phase: "stopped", detail: "refused" },
      ]),
    );
    expect(end).toEqual({ kind: "refused", note: 'the city "Brea" is not verified yet' });
  });

  it("the step cap stops the run and says so", async () => {
    const { end } = await run(sse([point, { type: "status", phase: "stopped", detail: "step cap reached (12 steps)" }]));
    expect(end).toEqual({ kind: "stopped", note: "Stopped: step cap reached (12 steps)." });
  });

  it("an error before any event means nothing was checked; after events it stops and keeps them", async () => {
    const before = await run(sse([{ type: "status", phase: "started" }, { type: "error", code: "api_500", message: "m" }]));
    expect(before.end).toEqual({ kind: "unavailable", note: "The live run failed (api_500) before anything was checked." });
    const after = await run(sse([point, { type: "error", code: "api_500", message: "m" }]));
    expect(after.end).toMatchObject({ kind: "stopped", note: expect.stringContaining("api_500") });
  });

  it("a stream that closes without a terminal frame is not reported as done", async () => {
    const { end } = await run(sse([point]));
    expect(end.kind).toBe("stopped");
  });
});

describe("startLiveRun: HTTP failures are 'unavailable': nothing runs, and the note says why", () => {
  it("503 no_api_key", async () => {
    const { end, signals } = await run(json(503, { error: "no_api_key", message: "..." }));
    expect(end).toEqual({ kind: "unavailable", note: "Live checks need ANTHROPIC_API_KEY on the server. Nothing was run." });
    expect(signals).toEqual([]);
  });

  it("missing_api_key as a stream error", async () => {
    const { end } = await run(sse([{ type: "error", code: "missing_api_key", message: "m" }]));
    expect(end).toEqual({ kind: "unavailable", note: "Live checks need ANTHROPIC_API_KEY on the server. Nothing was run." });
  });

  it("429 with retry time", async () => {
    const { end } = await run(json(429, { error: "rate_limited", retry_after_ms: 41_200 }));
    expect(end).toEqual({ kind: "unavailable", note: "Rate limited. Nothing was run. Try again in about 42s." });
  });

  it("5xx and network errors", async () => {
    expect((await run(new Response("boom", { status: 502 }))).end).toEqual({ kind: "unavailable", note: "The server answered 502. Nothing was run." });
    const offline = await run(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(offline.end).toEqual({ kind: "unavailable", note: "Could not reach the server. Nothing was run." });
  });
});

describe("startLiveRun: abort", () => {
  it("aborting mid-stream stops the run and keeps what arrived", async () => {
    const ctl = new AbortController();
    const enc = new TextEncoder();
    let push: ((s: string) => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc.encode(s));
        ctl.signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
      },
    });
    const signals: LiveRunSignal[] = [];
    const done = startLiveRun(
      REQ,
      (s) => {
        signals.push(s);
        if (s.kind === "event") ctl.abort();
      },
      ctl.signal,
      (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    );
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    push?.(formatFrame(point));
    const end = await done;
    expect(end.kind).toBe("stopped");
    expect(signals.filter((s) => s.kind === "event")).toHaveLength(1);
  });

  it("aborting before the response arrives is a stop, not 'offline'", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const end = await startLiveRun(REQ, () => {}, ctl.signal, (async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch);
    expect(end.kind).toBe("stopped");
  });
});
