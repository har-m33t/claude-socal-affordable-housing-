// FROZEN CONTRACT (lead). The answer pointer: the homeowner asks, Pointer shows
// where the answer is on the plan's own documents.
//
// Rules (from the product spec):
// - The answer names a target id, never coordinates, exactly like the plan pointer.
// - If the answer is the current plan target, no second hand appears: the plan pointer pulses.
// - If the answer is not on the plan's documents, there is NO answer pointer. The reply says it
//   isn't on this checklist and suggests asking the city ("unknown" is an honest answer).
// - Answers quote the document's own text and cite it. They never invent a rule, fee or date.

import type { Plan } from "./plan";

export interface AnswerSource {
  title: string;
  url: string;
  checked_date?: string | null;
}

export type AnswerResult =
  | {
      kind: "found";
      targetId: string;
      /** Plain-language reply. When produced locally it is built from the target's verbatim text. */
      text: string;
      quote?: string;
      sources: AnswerSource[];
    }
  | {
      kind: "not_found";
      text: string;
      sources: AnswerSource[];
    };

export interface AnswerContext {
  plan: Plan;
  /** The plan pointer's current target, so "what is this step?" questions resolve to it. */
  currentTargetId?: string;
  city: string;
  projectType: string;
}

/** Where answers come from. Local retrieval works offline; live uses /api/agent when a key is set. */
export interface AnswerProvider {
  readonly name: "local" | "live";
  ask(question: string, ctx: AnswerContext, signal?: AbortSignal): Promise<AnswerResult>;
}

export type AnswerPhase =
  | "idle" // nothing asked, or dismissed
  | "thinking" // waiting on the provider
  | "answering" // reply shown (and being spoken, if voice is on); pointer visible
  | "done"; // reply finished; pointer has faded, reply stays in the chat

export interface ChatTurn {
  id: string;
  role: "user" | "pointer";
  text: string;
  result?: AnswerResult;
}

/** What the stage needs to draw the answer pointer. Derived by the sidebar's answer session. */
export interface AnswerPointerView {
  /** Target to point at, or undefined when no answer hand should show. */
  targetId?: string;
  /** True when the answer is the plan pointer's own target: pulse the plan hand instead. */
  pulsePlan: boolean;
}
