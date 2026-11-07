import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvent } from "@/components/pointer/contract";
import { foldEvents, readiness } from "@/components/pointer/run-state";
import type { Plan } from "@/components/pointer/plan";

const ROOT = join(__dirname, "..", "..");
const plan = JSON.parse(readFileSync(join(ROOT, "data/plans/anaheim-adu.json"), "utf8")) as Plan;
const run = JSON.parse(readFileSync(join(ROOT, "fixtures/plan-run.json"), "utf8")) as { events: unknown[] };
const events = run.events.map(parseEvent).filter((e): e is NonNullable<typeof e> => e !== null);
const scope = { checklist: plan.targets };

describe("run state over the plan", () => {
  const state = foldEvents(events, scope);

  it("accepts every scripted event against the plan's targets (none rejected)", () => {
    expect(state.log.filter((l) => l.rejected)).toEqual([]);
  });

  it("keeps the server-rendered statute on Law Lens items and lists its source", () => {
    const flagged = Object.entries(state.items).filter(([, it]) => it.highlighted);
    expect(flagged.length).toBeGreaterThan(0);
    for (const [, it] of flagged) {
      expect(it.statute, "highlight without statute_ref").toBeDefined();
      expect(it.citations.some((c) => c.url === it.statute!.source_url)).toBe(true);
    }
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
