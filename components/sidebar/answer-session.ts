// The answer session as a pure state machine: the chat, the phase, and where the
// answer pointer is. The hook (use-answer-session.ts) runs the side effects —
// calling the provider, aborting, speaking — and dispatches these actions.
//
//            ask                  resolved(found|not_found)
//   idle ─────────▶ thinking ───────────────────────────▶ answering ──speechEnded──▶ done
//    ▲  ◀── back ──   │  ▲                                   │  (pointer shown)       (pointer faded)
//    │                │  └──────────── ask (aborts the in-flight one) ◀──────────────────┘
//    └──── back ──────┴── failed ──▶ done
//
// - A result whose id isn't the pending ask is stale (a newer ask replaced it) and is dropped.
// - not_found answers never carry a pointer.
// - With voice off, nothing ends "answering" but "Back to my step" (back) or a new ask.
import type { AnswerPhase, AnswerPointerView, AnswerResult, ChatTurn } from "@/components/pointer/answer";

export interface AnswerSessionState {
  turns: ChatTurn[];
  phase: AnswerPhase;
  /** Id of the ask awaiting its result, while thinking. */
  pendingId?: string;
  /** Target of the latest answer while its pointer is up (phase "answering"). */
  pointerTargetId?: string;
  /** Id of the latest pointer turn: the one that gets "Back to my step". */
  latestReplyId?: string;
  voice: boolean;
}

export type AnswerSessionAction =
  | { type: "ask"; id: string; question: string }
  | { type: "resolved"; id: string; result: AnswerResult }
  | { type: "failed"; id: string; text: string }
  | { type: "speechEnded"; id: string }
  | { type: "back" }
  | { type: "setVoice"; on: boolean };

export const initialAnswerSession: AnswerSessionState = { turns: [], phase: "idle", voice: false };

export function replyId(askId: string): string {
  return `${askId}:reply`;
}

export function answerSessionReducer(s: AnswerSessionState, a: AnswerSessionAction): AnswerSessionState {
  switch (a.type) {
    case "ask": {
      const question = a.question.trim();
      if (!question) return s;
      return {
        ...s,
        turns: [...s.turns, { id: a.id, role: "user", text: question }],
        phase: "thinking",
        pendingId: a.id,
        pointerTargetId: undefined,
      };
    }
    case "resolved": {
      if (s.phase !== "thinking" || a.id !== s.pendingId) return s;
      const id = replyId(a.id);
      return {
        ...s,
        turns: [...s.turns, { id, role: "pointer", text: a.result.text, result: a.result }],
        phase: "answering",
        pendingId: undefined,
        pointerTargetId: a.result.kind === "found" ? a.result.targetId : undefined,
        latestReplyId: id,
      };
    }
    case "failed": {
      if (s.phase !== "thinking" || a.id !== s.pendingId) return s;
      const id = replyId(a.id);
      return {
        ...s,
        turns: [...s.turns, { id, role: "pointer", text: a.text }],
        phase: "done",
        pendingId: undefined,
        pointerTargetId: undefined,
        latestReplyId: id,
      };
    }
    case "speechEnded":
      if (s.phase !== "answering" || a.id !== s.latestReplyId) return s;
      return { ...s, phase: "done", pointerTargetId: undefined };
    case "back":
      // Dismisses the pointer. An ask still in flight stays in flight: only a new ask replaces it.
      return s.phase === "thinking" ? s : { ...s, phase: "idle", pointerTargetId: undefined };
    case "setVoice":
      return { ...s, voice: a.on };
  }
}

/** What the stage draws. Pulses the plan hand instead of a second hand when both point at one target. */
export function answerPointerView(s: AnswerSessionState, planTargetId: string | undefined): AnswerPointerView {
  if (s.phase !== "answering" || !s.pointerTargetId) return { pulsePlan: false };
  return { targetId: s.pointerTargetId, pulsePlan: s.pointerTargetId === planTargetId };
}

/** The words spoken aloud for a reply: its text, then the quote. */
export function spokenText(turn: ChatTurn): string {
  const quote = turn.result?.kind === "found" ? turn.result.quote : undefined;
  return [turn.text.replace(/[“”]/g, ""), quote].filter(Boolean).join(" ");
}
