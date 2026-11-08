// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN } from "@/components/pointer/config";
import { foldEvents } from "@/components/pointer/run-state";
import { LIVE_NOTE, useRun } from "@/components/pointer/use-run";
import { formatFrame } from "@/lib/agent/sse";
import type { StreamFrame } from "@/lib/agent/types";
import { FULL_RUN_QUESTION, NO_KEY_NOTE, type PreparedLiveRun } from "@/lib/live/run-client";
import { syntheticEvents } from "../plan/synthetic-run";

const scope = { checklist: PLAN.targets };
const events = syntheticEvents();
const ts = "2026-11-07T12:00:00Z";
const prepared: PreparedLiveRun = {
  request: { city: "Anaheim", projectType: "adu", question: FULL_RUN_QUESTION, documents: [] },
  restore: (t) => t.replaceAll("[NAME_1]", "Maria Ejemplo"),
};

function sse(frames: StreamFrame[]): Response {
  return new Response(frames.map(formatFrame).join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** Let fetch/stream promises settle, then run the pacing timers dry. */
async function settle() {
  for (let i = 0; i < 200; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRun", () => {
  it("starts idle: nothing checked, and Play does not start anything", async () => {
    const { result } = renderHook(() => useRun(scope));
    expect(result.current.play).toBe("idle");
    act(() => result.current.start());
    await settle();
    expect(result.current.play).toBe("idle");
    expect(result.current.run.items).toEqual({});
    expect(result.current.run.log).toEqual([]);
  });

  it("live: a full stream folds to the same state as a plain fold of its events", async () => {
    const frames: StreamFrame[] = [
      { type: "status", phase: "started" },
      ...events.map((event): StreamFrame => ({ type: "event", event })),
      { type: "status", phase: "done" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sse(frames)));
    const { result } = renderHook(() => useRun(scope));
    act(() => void result.current.startLive(async () => prepared));
    await settle();
    expect(result.current.play).toBe("done");
    expect(result.current.run).toEqual(foldEvents(events, scope));
  });

  it("live: streamed events drive the run, drafts are restored locally, the note says live", async () => {
    const frames: StreamFrame[] = [
      { type: "status", phase: "started" },
      { type: "event", event: { tool: "point_to", item_id: "express-applicant-name", ts } },
      { type: "event", event: { tool: "draft_field", item_id: "express-applicant-name", text: "[NAME_1]", ts } },
      { type: "event", event: { tool: "mark_item", item_id: "meter-spot-report", status: "missing", ts } },
      { type: "dropped", reason: "law in prose", event: { tool: "add_note", item_id: "b802-adu-impact-fees", text: "x", ts } },
      { type: "status", phase: "done" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sse(frames)));
    const { result } = renderHook(() => useRun(scope));
    act(() => void result.current.startLive(async () => prepared));
    await settle();
    const r = result.current;
    expect(r.play).toBe("done");
    expect(r.note).toBe("Live run finished.");
    expect(r.run.items["meter-spot-report"].status).toBe("missing");
    expect(r.run.items["express-applicant-name"].suggestions[0].text).toBe("Maria Ejemplo");
    expect(r.run.log.at(-1)?.rejected).toBe("dropped by the verifier: law in prose");
  });

  it("live: no API key runs nothing and says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no_api_key" }), { status: 503 })));
    const { result } = renderHook(() => useRun(scope));
    act(() => void result.current.startLive(async () => prepared));
    await settle();
    expect(result.current.note).toBe(NO_KEY_NOTE);
    expect(result.current.note).toBe("Live checks need ANTHROPIC_API_KEY on the server. Nothing was run.");
    expect(result.current.play).toBe("idle");
    expect(result.current.total).toBe(0);
    expect(result.current.run.items).toEqual({});
    expect(result.current.run.log).toEqual([]);
  });

  it("live: a refusal stops with the reason and applies nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse([{ type: "error", code: "not_verified", message: "Brea is not verified." }])),
    );
    const { result } = renderHook(() => useRun(scope));
    act(() => void result.current.startLive(async () => prepared));
    await settle();
    expect(result.current.play).toBe("stopped");
    expect(result.current.note).toBe("Refused: Brea is not verified.");
    expect(result.current.run.log).toEqual([]);
  });

  it("live: Stop aborts the request and keeps the run", async () => {
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        init.signal?.addEventListener("abort", () => (aborted = true));
        return new Response(new ReadableStream(), { status: 200 });
      }),
    );
    const { result } = renderHook(() => useRun(scope));
    act(() => void result.current.startLive(async () => prepared));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.note).toBe(LIVE_NOTE);
    act(() => result.current.stop());
    await settle();
    expect(aborted).toBe(true);
    expect(result.current.play).toBe("stopped");
  });
});
