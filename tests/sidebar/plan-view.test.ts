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

  describe("suggested questions", () => {
    const step = (id: string) => plan.steps.find((s) => s.id === id)!;
    const ask = (q: string, current?: string) =>
      answerLocally(q, { plan, city: plan.city, projectType: plan.project_type, currentTargetId: current });

    it("at most three, each answered locally by a target of its own step", () => {
      for (const s of plan.steps) {
        const qs = suggestedQuestions(plan, s, s.targets[0]);
        expect(qs.length).toBeGreaterThan(0);
        expect(qs.length).toBeLessThanOrEqual(3);
        for (const q of qs) {
          const r = ask(q, s.targets[0]);
          expect(r.kind, q).toBe("found");
          if (r.kind === "found") expect(s.targets, q).toContain(r.targetId);
        }
      }
    });

    it("form: what goes in a field, or whether an '(if applicable)' field is needed", () => {
      expect(suggestedQuestions(plan, step("form-applicant"))).toContain("What goes in “Applicant name”?");
      expect(suggestedQuestions(plan, step("form-owner"), "express-owner-company")[0]).toBe("Do I have to fill in the owner company?");
      expect(suggestedQuestions(plan, step("form-signatures")).some((q) => q.startsWith("What am I certifying"))).toBe(true);
    });

    it("gather: how to get each item", () => {
      expect(suggestedQuestions(plan, step("gather-before-plan-check"))).toEqual([
        "How do I get a sewer verification?",
        "How do I get a meter spot report?",
        "How do I get a new address request?",
      ]);
    });

    it("law: the cited code section, and the fee threshold the document states", () => {
      expect(suggestedQuestions(plan, step("check-the-law"))).toEqual(["What does AMC Section 18.38.015.110 say?"]);
      expect(suggestedQuestions(plan, step("impact-fees"))).toEqual([
        "Do I pay impact fees on an ADU under 750 sq ft?",
        "What does Government Code Section 66324 say?",
      ]);
    });

    it("the plan pointer's target comes first", () => {
      const s = step("gather-before-plan-check");
      expect(suggestedQuestions(plan, s, "new-address-request")[0]).toBe("How do I get a new address request?");
    });

    it("no bland 'What is the applicant company?' chips", () => {
      for (const s of plan.steps) expect(suggestedQuestions(plan, s).join(" ")).not.toMatch(/What is the applicant/);
    });
  });
});
