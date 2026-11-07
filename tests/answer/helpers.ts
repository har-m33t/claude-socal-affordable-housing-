import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnswerContext } from "@/components/pointer/answer";
import type { Plan } from "@/components/pointer/plan";

export const plan = JSON.parse(readFileSync(join(__dirname, "..", "..", "data/plans/anaheim-adu.json"), "utf8")) as Plan;

/** Finds a target by what it is about, so the tests survive the data lane renaming or adding targets. */
export function targetIdWhere(test: (label: string, text: string) => boolean): string {
  const t = plan.targets.find((x) => test(x.label.toLowerCase(), x.text.toLowerCase()) && !plan.documents.find((d) => d.id === x.doc)?.made_up);
  if (!t) throw new Error("no matching target in the plan");
  return t.id;
}

export function ctx(currentTargetId?: string): AnswerContext {
  return { plan, currentTargetId, city: plan.city, projectType: plan.project_type };
}
