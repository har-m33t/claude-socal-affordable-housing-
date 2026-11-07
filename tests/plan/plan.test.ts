import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPlan, stepIndexOf, stepLabel, type Plan } from "@/components/pointer/plan";

const ROOT = join(__dirname, "..", "..");
const plan = JSON.parse(readFileSync(join(ROOT, "data/plans/anaheim-adu.json"), "utf8")) as Plan;
const city = JSON.parse(readFileSync(join(ROOT, "data/cities/anaheim.json"), "utf8")) as { checklist: { id: string; box: number[]; page: number }[] };

describe("data/plans/anaheim-adu.json", () => {
  it("is structurally valid: unique ids, known docs, one step per target, pdf targets have boxes", () => {
    expect(checkPlan(plan)).toEqual([]);
  });

  it("keeps the city checklist's ids, pages and boxes, so agent item_ids and the plan agree", () => {
    for (const c of city.checklist) {
      const t = plan.targets.find((x) => x.id === c.id);
      expect(t, `checklist item ${c.id} missing from the plan`).toBeDefined();
      expect(t?.page).toBe(c.page);
      expect(t?.box).toEqual(c.box);
    }
  });

  it("labels steps for the plan pointer", () => {
    const first = plan.steps[0].targets[0];
    expect(stepIndexOf(plan, first)).toBe(0);
    expect(stepLabel(plan, 0)).toBe(`Step 1 of ${plan.steps.length}`);
    expect(stepIndexOf(plan, "not-a-target")).toBe(-1);
  });

  it("checkPlan catches a broken plan", () => {
    const broken: Plan = {
      ...plan,
      targets: [...plan.targets, { id: plan.targets[0].id, doc: "nope", label: "x", text: "x" }],
      steps: [...plan.steps, { id: "dup", title: "x", kind: "read", doc: "nope", targets: [plan.steps[0].targets[0]] }],
    };
    const problems = checkPlan(broken).join("\n");
    expect(problems).toContain("duplicate target id");
    expect(problems).toContain("unknown doc nope");
    expect(problems).toContain("is in both");
  });
});
