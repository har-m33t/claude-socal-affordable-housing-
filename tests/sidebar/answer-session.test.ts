import { describe, expect, it } from "vitest";
import type { AnswerResult } from "@/components/pointer/answer";
import {
  answerPointerView,
  answerSessionReducer as reduce,
  initialAnswerSession as init,
  replyId,
  spokenText,
  type AnswerSessionAction,
} from "@/components/sidebar/answer-session";

const found = (targetId: string): AnswerResult => ({ kind: "found", targetId, text: "“X” — from Doc:", quote: "Quote.", sources: [] });
const notFound: AnswerResult = { kind: "not_found", text: "That isn't on this checklist.", sources: [] };
const run = (...as: AnswerSessionAction[]) => as.reduce(reduce, init);

describe("answer session state machine", () => {
  it("ask -> thinking, with the user's turn in the chat and no pointer", () => {
    const s = run({ type: "ask", id: "q1", question: "  sewer? " });
    expect(s.phase).toBe("thinking");
    expect(s.turns).toEqual([{ id: "q1", role: "user", text: "sewer?" }]);
    expect(answerPointerView(s, undefined)).toEqual({ pulsePlan: false });
  });

  it("ignores empty questions", () => {
    expect(run({ type: "ask", id: "q1", question: "   " })).toBe(init);
  });

  it("found -> answering, pointer on the target; pulses the plan hand when it's the plan's target", () => {
    const s = run({ type: "ask", id: "q1", question: "meter" }, { type: "resolved", id: "q1", result: found("meter") });
    expect(s.phase).toBe("answering");
    expect(s.latestReplyId).toBe(replyId("q1"));
    expect(answerPointerView(s, "sewer")).toEqual({ targetId: "meter", pulsePlan: false });
    expect(answerPointerView(s, "meter")).toEqual({ targetId: "meter", pulsePlan: true });
  });

  it("not_found -> a reply but never a pointer", () => {
    const s = run({ type: "ask", id: "q1", question: "tax" }, { type: "resolved", id: "q1", result: notFound });
    expect(s.phase).toBe("answering");
    expect(s.turns.at(-1)?.result).toEqual(notFound);
    expect(answerPointerView(s, undefined)).toEqual({ pulsePlan: false });
  });

  it("speech ending fades the pointer (done), and the reply stays", () => {
    const s = run(
      { type: "ask", id: "q1", question: "meter" },
      { type: "resolved", id: "q1", result: found("meter") },
      { type: "speechEnded", id: replyId("q1") },
    );
    expect(s.phase).toBe("done");
    expect(answerPointerView(s, undefined)).toEqual({ pulsePlan: false });
    expect(s.turns).toHaveLength(2);
  });

  it("drops a stale result after a newer ask, and a stale speechEnded", () => {
    const s = run(
      { type: "ask", id: "q1", question: "meter" },
      { type: "ask", id: "q2", question: "sewer" },
      { type: "resolved", id: "q1", result: found("meter") },
    );
    expect(s.phase).toBe("thinking");
    expect(s.pendingId).toBe("q2");
    const t = run(
      { type: "ask", id: "q1", question: "meter" },
      { type: "resolved", id: "q1", result: found("meter") },
      { type: "ask", id: "q2", question: "sewer" },
      { type: "resolved", id: "q2", result: found("sewer") },
      { type: "speechEnded", id: replyId("q1") },
    );
    expect(t.phase).toBe("answering");
    expect(answerPointerView(t, undefined).targetId).toBe("sewer");
  });

  it("back dismisses the pointer (idle) but keeps the chat; it doesn't cancel a pending ask", () => {
    const s = run({ type: "ask", id: "q1", question: "meter" }, { type: "resolved", id: "q1", result: found("meter") }, { type: "back" });
    expect(s.phase).toBe("idle");
    expect(answerPointerView(s, undefined)).toEqual({ pulsePlan: false });
    expect(s.turns).toHaveLength(2);
    const t = run({ type: "ask", id: "q1", question: "meter" }, { type: "back" });
    expect(t.phase).toBe("thinking");
  });

  it("a failure is a reply with no result and no pointer", () => {
    const s = run({ type: "ask", id: "q1", question: "x" }, { type: "failed", id: "q1", text: "Try again." });
    expect(s.phase).toBe("done");
    expect(s.turns.at(-1)).toMatchObject({ role: "pointer", text: "Try again." });
  });

  it("voice toggles, and the spoken text is the reply plus its quote", () => {
    expect(run({ type: "setVoice", on: true }).voice).toBe(true);
    expect(spokenText({ id: "r", role: "pointer", text: "“Meter” — from Doc:", result: found("m") })).toBe("Meter — from Doc: Quote.");
  });
});

describe("answer session: translation", () => {
  const asked = { original: "¿Qué es el medidor?", english: "What is the meter?", from: "es" as const };
  const translation = { lang: "es" as const, text: "“Informe” — de Doc:", quote: "Cita." };

  it("the user turn keeps what they typed and gains the English; the reply carries its translation", () => {
    const s = run(
      { type: "ask", id: "q1", question: asked.original },
      { type: "resolved", id: "q1", result: found("meter"), asked, translation },
    );
    expect(s.turns[0]).toMatchObject({ text: "¿Qué es el medidor?", asked });
    expect(s.turns[1]).toMatchObject({ text: "“X” — from Doc:", translation });
    // Spoken in the chosen language: translated text, then translated quote.
    expect(spokenText(s.turns[1])).toBe("Informe — de Doc: Cita.");
  });

  it("an English question gets no 'asked' note; a failed translation is recorded and the English is spoken", () => {
    const s = run(
      { type: "ask", id: "q1", question: "meter" },
      { type: "resolved", id: "q1", result: found("meter"), asked: { original: "meter", english: "meter", from: "en" }, translationFailed: "vi" },
    );
    expect(s.turns[0].asked).toBeUndefined();
    expect(s.turns[1].translationFailed).toBe("vi");
    expect(spokenText(s.turns[1])).toBe("X — from Doc: Quote.");
  });
});

