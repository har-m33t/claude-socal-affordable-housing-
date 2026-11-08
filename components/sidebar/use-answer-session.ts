"use client";
// Side effects for the answer session: translate the question to English, ask the
// provider (aborting any ask still in flight), translate the reply back, speak it
// in the homeowner's language when voice is on, report the answer pointer up to the
// editor, and dismiss everything when the editor signals "Back to my step".
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { AnswerPointerView, AnswerProvider } from "@/components/pointer/answer";
import type { Plan } from "@/components/pointer/plan";
import { questionToEnglish, translateReply, type AskedQuestion, type ReplyTranslation } from "@/lib/i18n/flow";
import { ENGLISH, type LangCode, type Language } from "@/lib/i18n/languages";
import type { TranslationService } from "@/lib/i18n/translator";
import { pickVoice, speakingEstimateMs } from "@/lib/voice/voices";
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
  /** The language replies are shown and spoken in, and the on-device translator. */
  language: Language;
  translation: TranslationService;
  voices: readonly SpeechSynthesisVoice[];
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

  /** Speaks in `voice` only: a reply is never read in another language's voice. */
  const speak = useCallback((id: string, text: string, voice: SpeechSynthesisVoice | undefined) => {
    const synth = speech();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      dispatch({ type: "speechEnded", id });
      return;
    }
    // No voice for this language on this device: the Ask tab says so; nothing is spoken,
    // and the pointer behaves as with voice off.
    if (!voice) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    utterance.current = u; // Chrome drops onend for utterances that get garbage-collected
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 1.02;
    // Some engines never fire onend (no audio device, Chrome's long-utterance bug). A generous
    // estimate of the speaking time guarantees the pointer still fades.
    const guard = setTimeout(() => finish(), speakingEstimateMs(text));
    const finish = () => {
      clearTimeout(guard);
      dispatch({ type: "speechEnded", id });
    };
    // onerror covers cancel(): the pointer fades rather than sticking around.
    u.onend = u.onerror = finish;
    synth.speak(u);
  }, []);

  const ask = useCallback(
    /** `known`: the question's language when the caller knows it (chips are English). */
    (question: string, known?: LangCode) => {
      const q = question.trim();
      if (!q) return;
      inflight.current?.abort();
      stopSpeaking();
      const ctl = new AbortController();
      inflight.current = ctl;
      const id = `q${++seq.current}`;
      dispatch({ type: "ask", id, question: q });
      const { provider, plan, city, projectType, planTargetId, language, translation } = latest.current;
      const lang = language.code;
      const run = async () => {
        // Retrieval and the agent read English. A failed translation asks with the words as typed.
        const asked: AskedQuestion = await questionToEnglish(q, lang, translation, known).catch(() => ({ original: q, english: q, from: lang }));
        if (ctl.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const result = await provider.ask(asked.english, { plan, city, projectType, currentTargetId: planTargetId }, ctl.signal);
        let translated: ReplyTranslation | undefined;
        let failed = false;
        if (lang !== "en") translated = await translateReply(result, lang, translation).catch(() => ((failed = true), undefined));
        return { asked, result, translated, failed };
      };
      Promise.all([run(), minThink()])
        .then(([{ asked, result, translated, failed }]) => {
          if (ctl.signal.aborted) return;
          dispatch({ type: "resolved", id, result, asked, translation: translated, translationFailed: failed ? lang : undefined });
          if (latest.current.voice) {
            const rid = replyId(id);
            const voice = pickVoice(latest.current.voices, translated ? language : ENGLISH);
            speak(rid, spokenText({ id: rid, role: "pointer", text: result.text, result, translation: translated }), voice);
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
