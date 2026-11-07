import { describe, expect, it, vi } from "vitest";
import { createLiveProvider, OFFLINE_NOTE, readSseData } from "@/lib/answer/live";
import { ctx, targetIdWhere } from "./helpers";

const meter = targetIdWhere((l) => l.includes("meter spot"));
const ts = "2026-11-07T12:00:00Z";

function sse(frames: unknown[], chunkSize = 17): Response {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Odd chunk sizes split frames mid-line, like a real network.
      for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("live answers: /api/agent SSE", () => {
  it("parses data: lines across chunk boundaries", async () => {
    const out: unknown[] = [];
    for await (const f of readSseData(sse([{ a: 1 }, { b: "x\ny" }], 3).body!)) out.push(f);
    expect(out).toEqual([{ a: 1 }, { b: "x\ny" }]);
  });

  it("takes the first plan target pointed at, and the add_note as the reply", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        { type: "status", phase: "started" },
        { type: "event", event: { tool: "point_to", item_id: "not-in-plan", ts } },
        { type: "event", event: { tool: "point_to", item_id: meter, ts } },
        { type: "event", event: { tool: "add_note", item_id: meter, text: "You are adding a meter, so this applies.", ts } },
        { type: "status", phase: "done" },
      ]),
    );
    const r = await createLiveProvider(fetchMock as unknown as typeof fetch).ask("meter?", ctx());
    expect(r.kind === "found" && r.targetId).toBe(meter);
    expect(r.text).toBe("You are adding a meter, so this applies.");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent");
    expect(JSON.parse(String(init.body))).toEqual({ city: "Anaheim", projectType: "adu", question: "meter?" });
  });

  it("falls back to local retrieval on a refusal, and says so", async () => {
    const fetchMock = async () => sse([{ type: "refusal", reason: "no" }]);
    const r = await createLiveProvider(fetchMock as unknown as typeof fetch).ask("what is a meter spot report", ctx());
    expect(r.kind === "found" && r.targetId).toBe(meter);
    expect(r.text).toContain(OFFLINE_NOTE);
  });

  it("falls back when the server has no API key (503)", async () => {
    const fetchMock = async () => new Response(JSON.stringify({ error: "no_api_key" }), { status: 503 });
    const r = await createLiveProvider(fetchMock as unknown as typeof fetch).ask("property tax", ctx());
    expect(r.kind).toBe("not_found");
    expect(r.text).toContain(OFFLINE_NOTE);
  });

  it("rejects when the caller aborts, instead of answering", async () => {
    const ac = new AbortController();
    const fetchMock = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    const p = createLiveProvider(fetchMock as unknown as typeof fetch).ask("sewer", ctx(), ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow(/Abort/);
  });
});
