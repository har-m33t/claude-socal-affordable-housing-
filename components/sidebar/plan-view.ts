// Pure derivations for the Plan tab: which steps are done, the current step's
// targets, its pending drafts, and the suggested questions for the Ask tab.
// Generic over any plan, so the data lane can grow it to any number of steps.
import type { ItemStatus } from "@/components/pointer/contract";
import { documentById, targetById, type Plan, type PlanStep } from "@/components/pointer/plan";
import type { ItemState, Suggestion } from "@/components/pointer/run-state";

export interface TargetRow {
  id: string;
  label: string;
  status?: ItemStatus;
  /** At most eight words of the run's status text; the full text goes in a tooltip. */
  short?: string;
  full?: string;
  flagged: boolean;
  current: boolean;
}

export interface PlanView {
  /** The step shown as the hero: the plan pointer's step, or step 1 before the run. */
  current?: PlanStep;
  currentIndex: number;
  started: boolean;
  done: PlanStep[];
  upcoming: number;
  /** 0..1, share of steps done (the current one counts once all its targets have a status). */
  progress: number;
  rows: TargetRow[];
  drafts: Array<{ itemId: string; label: string; suggestion: Suggestion }>;
}

export function clipWords(text: string, max = 8): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ").replace(/[,;:.]$/, "")}…`;
}

function stepFinished(step: PlanStep, items: Record<string, ItemState>): boolean {
  return step.targets.every((id) => items[id]?.status);
}

export function planView(
  plan: Plan,
  items: Record<string, ItemState>,
  stepIndex: number,
  planTargetId: string | undefined,
): PlanView {
  const started = stepIndex >= 0;
  const currentIndex = started ? stepIndex : 0;
  const current = plan.steps[currentIndex];
  // A step is done once the pointer has moved past it, or every target has a status.
  // (The pointer can return to an earlier step, e.g. for a Law Lens highlight.)
  const done = plan.steps.filter((s, i) => i !== currentIndex && started && (i < currentIndex || stepFinished(s, items)));
  const upcoming = plan.steps.filter((s, i) => i > currentIndex && !done.includes(s)).length;
  const currentDone = started && current && stepFinished(current, items) ? 1 : 0;

  const rows: TargetRow[] = (current?.targets ?? []).map((id) => {
    const t = targetById(plan, id);
    const it = items[id];
    return {
      id,
      label: t?.label ?? id,
      status: it?.status,
      short: it?.statusText ? clipWords(it.statusText) : undefined,
      full: it?.statusText,
      flagged: !!it?.highlighted,
      current: id === planTargetId,
    };
  });

  const drafts = (current?.targets ?? []).flatMap((id) =>
    (items[id]?.suggestions ?? []).map((suggestion) => ({
      itemId: id,
      label: targetById(plan, id)?.label ?? id,
      suggestion,
    })),
  );

  return {
    current,
    currentIndex,
    started,
    done,
    upcoming,
    progress: plan.steps.length ? (done.length + currentDone) / plan.steps.length : 0,
    rows,
    drafts,
  };
}

/** "What is the meter spot report?" — short questions built from a step's targets. */
export function suggestedQuestions(plan: Plan, step: PlanStep | undefined, currentTargetId?: string, max = 2): string[] {
  if (!step) return [];
  // The plan pointer's target first: it's what the homeowner is looking at.
  const ids = [...step.targets].sort((a, b) => Number(b === currentTargetId) - Number(a === currentTargetId));
  const qs = ids.slice(0, max).map((id) => {
    const t = targetById(plan, id);
    if (!t) return "";
    if (documentById(plan, t.doc)?.kind === "packet") return `What is ${t.label} for?`;
    const label = t.label.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    return `What is the ${label.toLowerCase()}?`;
  });
  return [...qs.filter(Boolean), "Why does this step matter?"];
}

/** The question prefilled by "Ask about this step". */
export function stepQuestion(plan: Plan, step: PlanStep, planTargetId: string | undefined): string {
  const id = planTargetId && step.targets.includes(planTargetId) ? planTargetId : step.targets[0];
  const label = targetById(plan, id)?.label;
  return label ? `What does “${label}” ask for?` : `What is “${step.title}”?`;
}
