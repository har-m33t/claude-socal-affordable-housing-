// FROZEN CONTRACT (lead). The multi-step plan: documents, targets and steps.
//
// A *target* is anything a pointer can point at: a box on a PDF page, or a slot
// on the homeowner's file board. Pointers only ever receive a target id (the
// agent's item_id), never coordinates; the stage resolves the id to a position.
// City checklist item ids are reused as target ids, so agent events, the server's
// item_id allowlist and this plan all agree on one id space.
//
// Shape on disk: data/plans/<city>-<type>.json, validated by contracts/plan.schema.json.

export type DocumentKind = "pdf" | "packet";

export interface PlanDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  /** Served path for kind "pdf" (under public/). Absent for the packet board. */
  url?: string;
  /** Where the document came from, and when a person checked it. */
  source_url?: string;
  checked_date?: string | null;
  /** True for the made-up applicant's files. Shown as "made up" in the UI. */
  made_up?: boolean;
}

export interface PlanTarget {
  id: string;
  doc: string;
  /** Short label for the sidebar, e.g. "Sewer verification". */
  label: string;
  /** Verbatim text from the document. Answers quote this; nothing is paraphrased as fact. */
  text: string;
  /** PDF targets only: 1-based page and [x, y, w, h] in PDF points, top-left origin. */
  page?: number;
  box?: [number, number, number, number];
  source_url?: string;
  /**
   * Packet documents only: true when the target is about the board as a whole
   * (e.g. "Your packet, all files") rather than one file slot.
   */
  summary?: boolean;
}

export type StepKind = "organize" | "read" | "law" | "form" | "gather" | "final";

export interface PlanStep {
  id: string;
  title: string;
  kind: StepKind;
  /** Document shown while this step is active. */
  doc: string;
  /** Targets this step covers, in the order the plan pointer visits them. */
  targets: string[];
  /** One sentence, shown only when the homeowner opens the step. Sourced via its targets. */
  summary?: string;
}

export interface Plan {
  about: string;
  city: string;
  project_type: string;
  checked_date: string | null;
  documents: PlanDocument[];
  targets: PlanTarget[];
  steps: PlanStep[];
}

export function targetById(plan: Plan, id: string | undefined | null): PlanTarget | undefined {
  return id ? plan.targets.find((t) => t.id === id) : undefined;
}

export function documentById(plan: Plan, id: string | undefined): PlanDocument | undefined {
  return id ? plan.documents.find((d) => d.id === id) : undefined;
}

/** Index of the step that covers a target, or -1. A target belongs to exactly one step. */
export function stepIndexOf(plan: Plan, targetId: string | undefined | null): number {
  return targetId ? plan.steps.findIndex((s) => s.targets.includes(targetId)) : -1;
}

/** "Step 4 of 12" for the plan pointer's label. */
export function stepLabel(plan: Plan, index: number): string {
  return index >= 0 ? `Step ${index + 1} of ${plan.steps.length}` : `${plan.steps.length} steps`;
}

/**
 * Structural check used at load time. Returns problems as strings (empty = valid)
 * so a broken plan file fails loudly in tests instead of silently mis-pointing.
 */
export function checkPlan(plan: Plan): string[] {
  const problems: string[] = [];
  const docIds = new Set(plan.documents.map((d) => d.id));
  const targetIds = new Set<string>();
  for (const t of plan.targets) {
    if (targetIds.has(t.id)) problems.push(`duplicate target id ${t.id}`);
    targetIds.add(t.id);
    const doc = plan.documents.find((d) => d.id === t.doc);
    if (!doc) problems.push(`target ${t.id}: unknown doc ${t.doc}`);
    else if (doc.kind === "pdf" && (!t.page || !t.box)) problems.push(`target ${t.id}: pdf target needs page and box`);
  }
  const owner = new Map<string, string>();
  for (const s of plan.steps) {
    if (!docIds.has(s.doc)) problems.push(`step ${s.id}: unknown doc ${s.doc}`);
    if (s.targets.length === 0) problems.push(`step ${s.id}: no targets`);
    for (const id of s.targets) {
      if (!targetIds.has(id)) problems.push(`step ${s.id}: unknown target ${id}`);
      const prev = owner.get(id);
      if (prev) problems.push(`target ${id} is in both ${prev} and ${s.id}`);
      owner.set(id, s.id);
    }
  }
  return problems;
}
