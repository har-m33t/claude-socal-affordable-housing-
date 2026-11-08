// Pure derivations for the Plan tab: which steps are done, the current step's
// targets, its pending drafts, and the suggested questions for the Ask tab.
// Generic over any plan, so the data lane can grow it to any number of steps.
import type { ItemStatus } from "@/components/pointer/contract";
import { documentById, targetById, type Plan, type PlanStep, type PlanTarget } from "@/components/pointer/plan";
import type { ItemState, Suggestion } from "@/components/pointer/run-state";
import { answerLocally } from "@/lib/answer/local";

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

/** A target's label as running text: "Owner occupancy covenant (JADU)" -> "owner occupancy covenant". */
function plainLabel(label: string): string {
  const l = label.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  // Keep acronyms and proper nouns ("ADU Express Program") as written.
  return /^[A-Z][a-z]/.test(l) && !/\b[A-Z]{2,}\b/.test(l) ? l[0].toLowerCase() + l.slice(1) : l;
}

/**
 * Candidate questions for one target, by the step's kind, each phrased only from what
 * the target's own text supports: a law citation it names, a size threshold it states,
 * "(if applicable)" on a form field.
 */
function candidates(plan: Plan, step: PlanStep, target: PlanTarget): string[] {
  const label = plainLabel(target.label);
  if (documentById(plan, target.doc)?.kind === "packet") return [target.summary ? "What files are in my packet?" : `What is ${target.label} for?`];
  const text = target.text;
  const qs: string[] = [];
  switch (step.kind) {
    case "form": {
      if (/\(if applicable\)/i.test(text)) qs.push(`Do I have to fill in the ${label}?`);
      else if (text.split(/\s+/).length > 12) qs.push(/certif/i.test(text) ? `What am I certifying with the ${label}?` : `What does the ${label} say?`);
      else qs.push(`What goes in “${target.label}”?`);
      break;
    }
    case "gather":
      qs.push(`How do I get a ${label}?`);
      break;
    case "law": {
      const size = /\bless than ([\d,]+) (?:sq\.? ?ft|square feet)/i.exec(text);
      if (size && /\bfees?\b/i.test(text)) qs.push(`Do I pay impact fees on an ADU under ${size[1]} sq ft?`);
      const cite = /\b(AMC|Government Code) Section ([\d.]*\d)/i.exec(text);
      if (cite) qs.push(`What does ${cite[1].toUpperCase() === "AMC" ? "AMC" : "Government Code"} Section ${cite[2]} say?`);
      if (!size && !cite) qs.push(`What does the ${label} require?`);
      break;
    }
    default:
      qs.push(`What is the ${label}?`);
  }
  return qs;
}

/**
 * Up to `max` questions for the Ask tab, built from the step's targets (the plan
 * pointer's target first) and kept only if local retrieval answers each one with the
 * very target it came from: a chip never leads to "that isn't on this checklist".
 */
export function suggestedQuestions(plan: Plan, step: PlanStep | undefined, currentTargetId?: string, max = 3): string[] {
  if (!step) return [];
  const ids = [...step.targets].sort((a, b) => Number(b === currentTargetId) - Number(a === currentTargetId));
  const ctx = { plan, city: plan.city, projectType: plan.project_type };
  const out: string[] = [];
  for (const id of ids) {
    const t = targetById(plan, id);
    if (!t) continue;
    for (const q of candidates(plan, step, t)) {
      if (out.length >= max || out.includes(q)) continue;
      const r = answerLocally(q, ctx);
      if (r.kind === "found" && r.targetId === t.id) out.push(q);
    }
    if (out.length >= max) break;
  }
  return out.length ? out : ["What does this step ask for?"];
}

/** The question prefilled by "Ask about this step". */
export function stepQuestion(plan: Plan, step: PlanStep, planTargetId: string | undefined): string {
  const id = planTargetId && step.targets.includes(planTargetId) ? planTargetId : step.targets[0];
  const label = targetById(plan, id)?.label;
  return label ? `What does “${label}” ask for?` : `What is “${step.title}”?`;
}
