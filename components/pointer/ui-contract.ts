// FROZEN CONTRACT (lead). Props for the two halves of the editor, so the stage
// lane and the sidebar lane build in parallel and Editor.tsx only wires them.

import type { AgentEvent, PacketFile } from "./contract";
import type { AnswerPointerView, AnswerProvider } from "./answer";
import type { AddedDocument } from "./documents";
import type { Plan } from "./plan";
import type { PlayState } from "./use-run";
import type { ItemState, LogEntry } from "./run-state";

/** Left side: the active document (a PDF or the file board) with both pointers. */
export interface DocumentStageProps {
  plan: Plan;
  /** Document currently on screen. The editor decides; tabs call onSelectDoc. */
  activeDocId: string;
  onSelectDoc: (docId: string) => void;
  /** Per-target state from the run (status, highlight, suggestions). Keyed by target id. */
  items: Record<string, ItemState>;
  packet: PacketFile[];
  /** Plan pointer: always visible on its target when that target's doc is on screen. */
  planTargetId?: string;
  planLabel: string; // "Step 4 of 12"
  /** Answer pointer, from the sidebar's answer session. */
  answer: AnswerPointerView;
  /** "Back to my step": dismiss the answer pointer and return to the plan pointer's doc. */
  onBackToStep: () => void;
  /** Restart the plan hand's tap animation on each new event. */
  tapKey: number;
  selectedTargetId?: string;
  onSelectTarget: (id: string) => void;
  /** Files added on this device (redacted). The editor owns them so the live run can send them. */
  addedFiles: AddedDocument[];
  onAddFile: (doc: AddedDocument) => void;
  onRemoveFile: (id: string) => void;
}

/** Right side: the slim side rail with two tabs, Plan and Ask. */
export interface SidebarProps {
  plan: Plan;
  items: Record<string, ItemState>;
  log: LogEntry[];
  /** Index of the active step (-1 before the run starts). */
  stepIndex: number;
  planTargetId?: string;
  play: PlayState;
  controls: {
    start: () => void;
    pause: () => void;
    step: () => void;
    stop: () => void;
    reset: () => void;
  };
  onDecide: (itemId: string, suggestionId: string, decision: "accepted" | "rejected") => void;
  onSelectTarget: (id: string) => void;
  provider: AnswerProvider;
  city: string;
  projectType: string;
  /** The sidebar owns the answer session and reports the pointer view up to the editor. */
  onAnswerPointer: (view: AnswerPointerView) => void;
  /** Called when the answer pointer is dismissed ("Back to my step" or speech ended). */
  backToStepSignal: number;
  onBackToStep: () => void;
  /** Optional one-line note about the live run (e.g. why it could not start). The editor shows it in its run bar. */
  runNote?: string;
}

export type { AgentEvent };
