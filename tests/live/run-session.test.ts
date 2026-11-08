import { describe, expect, it } from "vitest";
import { PLAN, loadMockEvents } from "@/components/pointer/config";
import type { AgentEvent } from "@/components/pointer/contract";
import { recordedSession, runReducer, type RunAction, type RunSession } from "@/components/pointer/run-session";
import { foldEvents } from "@/components/pointer/run-state";
import { capDocuments, MAX_DOCUMENTS, MAX_TOTAL_CHARS } from "@/lib/live/packet";

const scope = { checklist: PLAN.targets };
const { events } = loadMockEvents();
const apply = (s: RunSession, ...actions: RunAction[]) => actions.reduce(runReducer, s);
const drain = (s: RunSession) => {
  while (s.cursor < s.queue.length && s.play === "playing") s = runReducer(s, { type: "advance", scope });
  return s;
};

describe("run session: one reducer for recorded and live", () => {
  it("a recorded run ends in the same state as a plain fold (the report's view)", () => {
    const s = drain(apply(recordedSession(events), { type: "play" }));
    expect(s.play).toBe("done");
    expect(s.run).toEqual(foldEvents(events, scope));
  });

  it("the same events pushed live end in the same state, once the stream finishes and the queue drains", () => {
    let s = apply(recordedSession([]), { type: "begin", mode: "live", queue: [], play: "playing" });
    for (const event of events) s = runReducer(s, { type: "push", item: { kind: "event", event } });
    s = runReducer(s, { type: "advance", scope });
    expect(s.play).toBe("playing"); // stream still open
    s = runReducer(s, { type: "finish", final: "done", note: "Live run finished." });
    expect(s.play).toBe("playing"); // queue not drained yet
    s = drain(s);
    expect(s.play).toBe("done");
    expect(s.mode).toBe("live");
    expect(s.run).toEqual(foldEvents(events, scope));
  });

  it("an empty live queue waits for the stream instead of finishing", () => {
    const s = apply(recordedSession([]), { type: "begin", mode: "live", queue: [], play: "playing" }, { type: "advance", scope });
    expect(s.play).toBe("playing");
  });

  it("a verifier drop is logged as rejected and changes no item", () => {
    const ev: AgentEvent = { tool: "add_note", item_id: "b802-adu-impact-fees", text: "x", ts: "2026-11-07T00:00:00Z" };
    const s = drain(
      apply(recordedSession([]), { type: "begin", mode: "live", queue: [{ kind: "dropped", event: ev, reason: "law in prose" }], play: "playing" }),
    );
    expect(s.run.items).toEqual({});
    expect(s.run.log).toEqual([{ index: 0, event: ev, rejected: "dropped by the verifier: law in prose" }]);
  });

  it("pause buffers live events; stop keeps what was applied and ignores a late finish", () => {
    let s = apply(recordedSession([]), { type: "begin", mode: "live", queue: [], play: "playing" }, { type: "pause" });
    s = runReducer(s, { type: "push", item: { kind: "event", event: events[0] } });
    s = runReducer(s, { type: "advance", scope }); // paused: Step applies one
    expect(s.cursor).toBe(1);
    s = apply(s, { type: "stop", note: "Stopped." }, { type: "finish", final: "done", note: "Live run finished." });
    expect(s.play).toBe("stopped");
    expect(s.note).toBe("Stopped.");
    expect(s.run.pointedItem).toBe(events[0].item_id);
  });

  it("stepping through the last recorded event ends the run", () => {
    let s = recordedSession(events.slice(0, 2));
    s = apply(s, { type: "advance", scope }, { type: "advance", scope });
    expect(s.play).toBe("done");
  });
});

describe("capDocuments: the route's caps", () => {
  const doc = (n: number, len: number) => ({ name: `f${n}.pdf`, declared_type: "unknown", text: "a".repeat(len) });

  it("passes small packets through untouched", () => {
    const docs = [doc(1, 10), doc(2, 20)];
    expect(capDocuments(docs)).toEqual({ documents: docs, notes: [] });
  });

  it("keeps at most 20 documents and at most 100,000 characters, marking the cut", () => {
    const { documents, notes } = capDocuments(Array.from({ length: 25 }, (_, i) => doc(i, 9_000)));
    expect(documents).toHaveLength(MAX_DOCUMENTS);
    const total = documents.reduce((n, d) => n + d.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
    expect(documents.some((d) => d.text.includes("[Truncated by Pointer"))).toBe(true);
    expect(notes.join(" ")).toMatch(/5 file\(s\) left out.*truncated/);
  });
});
