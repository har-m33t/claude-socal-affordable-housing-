"use client";
// Side effects for the answer session: ask the provider (aborting any ask still in
// flight), speak replies when voice is on, report the answer pointer up to the
// editor, and dismiss everything when the editor signals "Back to my step".
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { AnswerPointerView, AnswerProvider } from "@/components/pointer/answer";
import type { Plan } from "@/components/pointer/plan";
import { answerPointerView, answerSessionReducer, initialAnswerSession, replyId, spokenText } from "./answer-session";

interface Options {
  provider: AnswerProvider;
  plan: Plan;
  city: string;
  projectType: string;
  planTargetId?: string;
  onAnswerPointer: (view: AnswerPointerView) => void;
  backToStepSignal: number;
  /** Called after the session has dismissed itself for "Back to my step". */
  onDismissed: () => void;
}

function speech(): SpeechSynthesis | undefined {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : undefined;
}

const noSubscribe = () => () => {};

/** Instant local answers would flash the thinking state for one frame; hold it briefly so it reads. */
const MIN_THINK_MS = 450;
const minThink = () => new Promise((r) => setTimeout(r, MIN_THINK_MS));

export function useAnswerSession(o: Options) {
  const [s, dispatch] = useReducer(answerSessionReducer, initialAnswerSession);
  const inflight = useRef<AbortController | null>(null);
  const seq = useRef(0);
  // Latest values for async callbacks, without re-creating `ask` on every render.
  const latest = useRef({ ...o, voice: s.voice });
  useEffect(() => {
    latest.current = { ...o, voice: s.voice };
  });

  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const stopSpeaking = useCallback(() => speech()?.cancel(), []);

  const speak = useCallback((id: string, text: string) => {
    const synth = speech();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      dispatch({ type: "speechEnded", id });
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    utterance.current = u; // Chrome drops onend for utterances that get garbage-collected
    u.rate = 1.02;
    // Some engines never fire onend (no audio device, Chrome's long-utterance bug). A generous
    // estimate of the speaking time (~130 words a minute) guarantees the pointer still fades.
    const words = text.split(/\s+/).length;
    const guard = setTimeout(() => finish(), Math.max(4000, words * 460 + 2000));
    const finish = () => {
      clearTimeout(guard);
      dispatch({ type: "speechEnded", id });
    };
    // onerror covers cancel(): the pointer fades rather than sticking around.
    u.onend = u.onerror = finish;
    synth.speak(u);
  }, []);

  const ask = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      inflight.current?.abort();
      stopSpeaking();
      const ctl = new AbortController();
      inflight.current = ctl;
      const id = `q${++seq.current}`;
      dispatch({ type: "ask", id, question: q });
      const { provider, plan, city, projectType, planTargetId } = latest.current;
      Promise.all([provider.ask(q, { plan, city, projectType, currentTargetId: planTargetId }, ctl.signal), minThink()])
        .then(([result]) => {
          if (ctl.signal.aborted) return;
          dispatch({ type: "resolved", id, result });
          if (latest.current.voice) {
            speak(replyId(id), spokenText({ id: replyId(id), role: "pointer", text: result.text, result }));
          }
        })
        .catch(() => {
          if (ctl.signal.aborted) return;
          dispatch({ type: "failed", id, text: "Pointer couldn't look that up just now. Try asking again." });
        })
        .finally(() => {
          if (inflight.current === ctl) inflight.current = null;
        });
    },
    [speak, stopSpeaking],
  );

  const setVoice = useCallback(
    (on: boolean) => {
      if (!on) stopSpeaking(); // turning voice off mid-reply ends speech; the pointer then stays until Back
      dispatch({ type: "setVoice", on });
    },
    [stopSpeaking],
  );

  // Report the pointer view up whenever it changes (by value).
  const view = answerPointerView(s, o.planTargetId);
  const { onAnswerPointer } = o;
  useEffect(() => {
    onAnswerPointer({ targetId: view.targetId, pulsePlan: view.pulsePlan });
  }, [onAnswerPointer, view.targetId, view.pulsePlan]);

  // "Back to my step", from the bubble or the stage: the editor bumps the signal.
  const seenSignal = useRef(o.backToStepSignal);
  useEffect(() => {
    if (o.backToStepSignal === seenSignal.current) return;
    seenSignal.current = o.backToStepSignal;
    stopSpeaking();
    dispatch({ type: "back" });
    latest.current.onDismissed();
  }, [o.backToStepSignal, stopSpeaking]);

  // Leaving the page: stop talking and stop asking.
  useEffect(
    () => () => {
      inflight.current?.abort();
      speech()?.cancel();
    },
    [],
  );

  return {
    state: s,
    ask,
    setVoice,
    voiceSupported: useSyncExternalStore(noSubscribe, () => !!speech(), () => false),
  };
}
