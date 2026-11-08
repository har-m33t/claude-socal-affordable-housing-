import { describe, expect, it } from "vitest";
import { parseEvent } from "@/components/pointer/contract";
import { foldEvents, readiness } from "@/components/pointer/run-state";
import { PLAN_DATA as plan, STATUTE, syntheticEvents } from "./synthetic-run";

// Through parseEvent, as events arrive from the stream.
const events = syntheticEvents().map((e) => parseEvent(JSON.parse(JSON.stringify(e))));
const scope = { checklist: plan.targets };

describe("run state over the plan", () => {
  it("parses every event", () => expect(events.every((e) => e !== null)).toBe(true));
  const state = foldEvents(events.filter((e) => e !== null), scope);

  it("accepts every event against the plan's targets (none rejected)", () => {
    expect(state.log.filter((l) => l.rejected)).toEqual([]);
  });

  it("keeps the server-rendered statute on Law Lens items and lists its source", () => {
    const flagged = Object.entries(state.items).filter(([, it]) => it.highlighted);
    expect(flagged.length).toBeGreaterThan(0);
    for (const [, it] of flagged) {
      expect(it.statute, "highlight without statute_ref").toBeDefined();
      expect(it.citations.some((c) => c.url === it.statute!.source_url)).toBe(true);
    }
    expect(state.items["jadu-owner-occupancy-covenant"].statute).toEqual(STATUTE);
  });

  it("readiness covers every plan target, not just the city checklist", () => {
    const r = readiness(state, scope);
    const counted = r.complete.length + r.missing.length + r.unknown.length + r.drafted.length + r.notReviewed.length;
    expect(counted).toBe(plan.targets.length);
  });

  it("counts an accepted draft as filled in and a pending draft as waiting on the homeowner", () => {
    const drafted = readiness(state, scope).drafted;
    expect(drafted.length).toBeGreaterThan(0);
    const id = drafted[0];
    const sid = state.items[id].suggestions[0].id;
    const accepted = { ...state, items: { ...state.items, [id]: { ...state.items[id], suggestions: [{ ...state.items[id].suggestions[0], id: sid, decision: "accepted" as const }] } } };
    const r = readiness(accepted, scope);
    expect(r.complete).toContain(id);
    expect(r.drafted).not.toContain(id);
  });
});
