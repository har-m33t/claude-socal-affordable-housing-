import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvent } from "@/components/pointer/contract";
import { checkPlan, stepIndexOf, targetById, type Plan } from "@/components/pointer/plan";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const plan = read("data/plans/anaheim-adu.json") as Plan;
const run = read("fixtures/plan-run.json") as { about: string; events: Record<string, unknown>[] };
const statutes = (read("data/statutes.json") as { statutes: Record<string, unknown>[] }).statutes;
const applicant = read("data/packet/applicant.json") as Record<string, string>;

describe("fixtures/plan-run.json", () => {
  it("runs over a valid plan", () => {
    expect(checkPlan(plan)).toEqual([]);
  });

  it("every event passes parseEvent and names a known plan target", () => {
    for (const [i, e] of run.events.entries()) {
      expect(parseEvent(e), `event ${i}`).not.toBeNull();
      expect(targetById(plan, e.item_id as string), `event ${i}: ${e.item_id}`).toBeDefined();
    }
  });

  it("visits every step, in order", () => {
    const steps = run.events.filter((e) => e.tool === "point_to").map((e) => stepIndexOf(plan, e.item_id as string));
    for (let i = 1; i < steps.length; i++) expect(steps[i], `point_to #${i}`).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(new Set(steps)).toEqual(new Set(plan.steps.map((_, i) => i)));
  });

  it("every action on a target comes after the pointer reached that target's step", () => {
    let step = -1;
    for (const e of run.events) {
      const s = stepIndexOf(plan, e.item_id as string);
      if (e.tool === "point_to") step = s;
      else expect(s, `${e.tool} ${e.item_id}`).toBe(step);
    }
  });

  it("every statute_ref deep-equals a confirmed statutes.json entry (minus `confirmed`)", () => {
    const refs = run.events.filter((e) => e.statute_ref !== undefined);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const e of refs) {
      const ref = e.statute_ref as { id: string };
      const entry = statutes.find((s) => s.id === ref.id);
      expect(entry, ref.id).toBeDefined();
      expect(entry?.confirmed).toBe(true);
      const { confirmed: _c, ...rest } = entry as Record<string, unknown>;
      expect(ref).toEqual(rest);
    }
  });

  it("is terse: no add_note, short status texts", () => {
    expect(run.events.some((e) => e.tool === "add_note")).toBe(false);
    for (const e of run.events) {
      if (e.tool === "mark_item" || e.tool === "highlight") {
        expect((e.text as string).split(/\s+/).length, String(e.text)).toBeLessThanOrEqual(8);
      }
    }
  });

  it("puts the made-up applicant's personal values only inside draft_field", () => {
    // City and state are not personal; every other applicant value is.
    const personal = ["name", "co_owner", "street", "zip", "apn", "phone", "email"].map((k) => applicant[k]);
    for (const e of run.events) {
      if (e.tool === "draft_field") continue;
      const text = JSON.stringify({ ...e, statute_ref: undefined });
      for (const v of personal) expect(text.includes(v), `${e.tool} ${e.item_id} contains ${v}`).toBe(false);
    }
    const about = run.about;
    for (const v of personal) expect(about.includes(v)).toBe(false);
  });
});
