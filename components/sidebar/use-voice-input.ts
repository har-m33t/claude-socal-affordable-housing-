"use client";
// The mic in the Ask composer: drives lib/voice/recognition's state machine. What is
// heard shows live in the input; when the homeowner stops talking (or presses Esc)
// it stays there to edit and send. Nothing is sent on its own.
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { Language } from "@/lib/i18n/languages";
import {
  checkRecognition,
  hasCloudConsent,
  installOnDevice,
  listen,
  micIdle,
  micReducer,
  recognitionCtor,
  setCloudConsent,
} from "@/lib/voice/recognition";

const noSubscribe = () => () => {};

interface Options {
  language: Language;
  draft: string;
  setDraft: (s: string) => void;
  /** Focus the input when listening ends, so Enter sends. */
  onDone: () => void;
}

export function useVoiceInput(o: Options) {
  const ctor = useSyncExternalStore(noSubscribe, recognitionCtor, () => undefined);
  const [state, dispatch] = useReducer(micReducer, micIdle);
  const latest = useRef(o);
  useEffect(() => {
    latest.current = o;
  });

  const press = useCallback(() => {
    if (!ctor) return;
    dispatch({ type: "press" });
    checkRecognition(ctor, latest.current.language.recognition).then(
      (check) => dispatch({ type: "checked", check, consented: hasCloudConsent() }),
      () => dispatch({ type: "failed", message: "Voice input isn't available in this browser." }),
    );
  }, [ctor]);

  const downloadModel = useCallback(() => {
    if (!ctor || state.kind !== "offer-download") return;
    dispatch({ type: "download" });
    installOnDevice(ctor, state.lang).then((ok) => dispatch({ type: "installed", ok }));
  }, [ctor, state]);

  const consent = useCallback((granted: boolean) => {
    if (granted) setCloudConsent(true);
    dispatch({ type: "consent", granted });
  }, []);

  const stopRef = useRef<(() => void) | null>(null);
  const stop = useCallback(() => stopRef.current?.(), []);
  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);

  // One recognition session per "listening" state.
  const listening = state.kind === "listening" ? state : null;
  useEffect(() => {
    if (!listening || !ctor) return;
    const typed = latest.current.draft.trim();
    const prefix = typed ? `${typed} ` : "";
    const stopListening = listen(ctor, { lang: listening.lang, local: listening.local }, {
      onInterim: (t) => latest.current.setDraft(prefix + t),
      onFinal: (t) => {
        latest.current.setDraft((prefix + t).trim());
        dispatch({ type: "ended" });
        latest.current.onDone();
      },
      onError: (message) => {
        latest.current.setDraft(typed);
        dispatch({ type: "failed", message });
      },
    });
    stopRef.current = stopListening;
    return () => {
      stopRef.current = null;
      stopListening();
    };
  }, [listening, ctor]);

  // Esc stops listening, from anywhere on the page.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening]);

  // A new language resets any half-finished offer (its model or consent was for the old one).
  const code = o.language.code;
  useEffect(() => {
    stopRef.current?.();
    dispatch({ type: "dismiss" });
  }, [code]);

  return { supported: !!ctor, state, press, stop, downloadModel, consent, dismiss };
}
