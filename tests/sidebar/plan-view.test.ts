import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Plan } from "@/components/pointer/plan";
import { emptyItem, type ItemState } from "@/components/pointer/run-state";
import { clipWords, planView, stepQuestion, suggestedQuestions } from "@/components/sidebar/plan-view";
import { answerLocally } from "@/lib/answer/local";

const plan = JSON.parse(readFileSync(join(__dirname, "..", "..", "data/plans/anaheim-adu.json"), "utf8")) as Plan;
const marked = (ids: string[]): Record<string, ItemState> =>
  Object.fromEntries(ids.map((id) => [id, { ...emptyItem(), status: "complete" as const, statusText: "Found it in your packet, it answers this step fully." }]));

describe("plan view", () => {
  it("before the run: step 1 previewed, nothing done, the rest to go", () => {
    const v = planView(plan, {}, -1, undefined);
    expect(v.started).toBe(false);
    expect(v.current).toBe(plan.steps[0]);
    expect(v.done).toEqual([]);
    expect(v.upcoming).toBe(plan.steps.length - 1);
    expect(v.progress).toBe(0);
  });

  it("past steps are done, the hero is the pointer's step, the rest is a count", () => {
    const i = Math.min(2, plan.steps.length - 1);
    const t = plan.steps[i].targets[0];
    const v = planView(plan, {}, i, t);
    expect(v.done).toEqual(plan.steps.slice(0, i));
    expect(v.upcoming).toBe(plan.steps.length - 1 - i);
    expect(v.rows.find((r) => r.current)?.id).toBe(t);
  });

  it("a later step whose targets are all marked counts as done when the pointer goes back", () => {
    const last = plan.steps.at(-1)!;
    const v = planView(plan, marked(last.targets), 0, plan.steps[0].targets[0]);
    expect(v.done).toContain(last);
    expect(v.upcoming).toBe(plan.steps.length - 2);
  });

  it("status text is clipped to eight words", () => {
    const t = plan.steps[0].targets[0];
    const v = planView(plan, marked([t]), 0, t);
    expect(v.rows[0].short?.split(" ").length).toBeLessThanOrEqual(8);
    expect(clipWords("one two")).toBe("one two");
  });

  it("suggested questions and the step question find an answer locally", () => {
    for (const step of plan.steps) {
      for (const q of [...suggestedQuestions(plan, step), stepQuestion(plan, step, undefined)]) {
        const r = answerLocally(q, { plan, city: plan.city, projectType: plan.project_type, currentTargetId: step.targets[0] });
        expect(r.kind, q).toBe("found");
      }
    }
  });
});
