// Pure derivations for the document stage: which hand shows on which document,
// tab counters and markers, file-board cards, upload slots, screen-reader text.
// Everything here works for any number of documents and targets.
import type { AnswerPointerView } from "@/components/pointer/answer";
import type { PacketFile } from "@/components/pointer/contract";
import { documentById, stepIndexOf, targetById, type Plan, type PlanTarget } from "@/components/pointer/plan";
import type { ItemState } from "@/components/pointer/run-state";

/** Which hands a document pane draws. Undefined = that hand is not on this document. */
export interface PaneHands {
  plan?: string;
  answer?: string;
  /** The answer is the plan pointer's own target: pulse the plan hand, no second hand. */
  pulsePlan: boolean;
}

export function handsFor(plan: Plan, docId: string, planTargetId: string | undefined, answer: AnswerPointerView): PaneHands {
  const onDoc = (id: string | undefined) => (targetById(plan, id)?.doc === docId ? id : undefined);
  const planHere = onDoc(planTargetId);
  // The ids decide: a second hand never lands on the spot the plan hand already
  // marks, and a pulsePlan flag left over from an earlier step never hides a
  // real answer somewhere else.
  const same = !!answer.targetId && answer.targetId === planTargetId;
  const pulse = same || (answer.pulsePlan && !answer.targetId);
  return {
    plan: planHere,
    answer: same ? undefined : onDoc(answer.targetId),
    pulsePlan: pulse && !!planHere,
  };
}

/** Tab counter: how many of a document's targets the run has given a status. */
export function docProgress(plan: Plan, docId: string, items: Record<string, ItemState>): { reviewed: number; total: number } {
  const ids = plan.targets.filter((t) => t.doc === docId).map((t) => t.id);
  return { reviewed: ids.filter((id) => items[id]?.status).length, total: ids.length };
}

/** The "Step N" marker shown on the plan pointer's tab while another document is on screen. */
export function stepMarker(plan: Plan, planTargetId: string | undefined, activeDocId: string): { docId: string; label: string } | null {
  const doc = targetById(plan, planTargetId)?.doc;
  const i = stepIndexOf(plan, planTargetId);
  if (!doc || i < 0 || doc === activeDocId) return null;
  return { docId: doc, label: `Step ${i + 1}` };
}

/** Where a target lives, in words: "ADU Checklist, page 2" or "Your files (made up)". */
export function placeOf(plan: Plan, id: string | undefined): string | undefined {
  const t = targetById(plan, id);
  if (!t) return undefined;
  const title = documentById(plan, t.doc)?.title ?? t.doc;
  return t.page ? `${title}, page ${t.page}` : title;
}

/** Text for the visually-hidden live region when an answer arrives. */
export function answerAnnouncement(plan: Plan, answer: AnswerPointerView, planTargetId: string | undefined): string {
  if (!answer.targetId) return "";
  if (answer.targetId === planTargetId) return "The answer is at your current step.";
  const where = placeOf(plan, answer.targetId);
  return where ? `Answer is on ${where}.` : "";
}

/**
 * The top-of-stage "Back to my step" banner: shown when the answer took the
 * homeowner away from their step (another document or another page). On the
 * same page both hands are visible, so the floating button is enough.
 */
export function needsBackBanner(plan: Plan, answer: AnswerPointerView, planTargetId: string | undefined): boolean {
  if (!answer.targetId || answer.targetId === planTargetId) return false;
  const a = targetById(plan, answer.targetId);
  const p = targetById(plan, planTargetId);
  if (!a) return false;
  return !p || a.doc !== p.doc || (a.page ?? 0) !== (p.page ?? 0);
}

export interface FileCard {
  /** The plan target this card is, when it is one. Cards without one cannot be pointed at. */
  targetId?: string;
  name: string;
  declaredType: string;
  status?: ItemState["status"];
  statusText?: string;
  highlighted: boolean;
}

const DECLARED = /\(declared type:\s*([^)]+)\)/i;

/**
 * Cards for a packet document: one per plan target on it (in plan order), joined
 * to the packet file of the same name when there is one; then any packet files no
 * target names, so nothing the homeowner has is hidden.
 */
/** Targets on the file board are file slots unless the plan marks them as board summaries. */
function isFileTarget(t: PlanTarget): boolean {
  return !t.summary;
}

export function fileCards(plan: Plan, docId: string, packet: PacketFile[], items: Record<string, ItemState>): FileCard[] {
  const byName = new Map(packet.map((f) => [f.name, f]));
  const used = new Set<string>();
  const cards: FileCard[] = plan.targets
    .filter((t) => t.doc === docId && isFileTarget(t))
    .map((t) => {
      const file = byName.get(t.label);
      if (file) used.add(file.name);
      const it = items[t.id];
      return {
        targetId: t.id,
        name: file?.name ?? t.label,
        declaredType: file?.declared_type ?? t.text.match(DECLARED)?.[1]?.trim() ?? "not stated",
        status: it?.status,
        statusText: it?.statusText,
        highlighted: !!it?.highlighted,
      };
    });
  for (const f of packet) {
    if (!used.has(f.name)) cards.push({ name: f.name, declaredType: f.declared_type, highlighted: false });
  }
  return cards;
}

export interface BoardSummary {
  targetId: string;
  label: string;
  status?: ItemState["status"];
  statusText?: string;
}

/** Board-level targets on the packet document (not files), in plan order. */
export function boardSummaries(plan: Plan, docId: string, items: Record<string, ItemState>): BoardSummary[] {
  return plan.targets
    .filter((t) => t.doc === docId && !isFileTarget(t))
    .map((t) => ({ targetId: t.id, label: t.label, status: items[t.id]?.status, statusText: items[t.id]?.statusText }));
}

export interface SlotGroup {
  docId: string;
  title: string;
  options: { id: string; label: string }[];
}

/**
 * Where an uploaded file can go: every plan target, grouped by document (file
 * slots first, as they come in the plan). The homeowner picks; nothing is guessed.
 */
export function slotGroups(plan: Plan): SlotGroup[] {
  const order = [...plan.documents].sort((a, b) => Number(b.kind === "packet") - Number(a.kind === "packet"));
  return order
    .map((d) => ({
      docId: d.id,
      title: d.title,
      options: plan.targets.filter((t: PlanTarget) => t.doc === d.id).map((t) => ({ id: t.id, label: t.label })),
    }))
    .filter((g) => g.options.length > 0);
}

/**
 * The declared type an added file is sent with, from the slot the homeowner chose:
 * a file slot's own declared type ("(declared type: site_plan)" in its text),
 * otherwise the slot's id. Never guessed from the file itself.
 */
export function declaredTypeForSlot(plan: Plan, slotId: string): string {
  const t = targetById(plan, slotId);
  const fileSlot = !!t && isFileTarget(t) && documentById(plan, t.doc)?.kind === "packet";
  return (fileSlot && t.text.match(DECLARED)?.[1]?.trim()) || slotId;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
