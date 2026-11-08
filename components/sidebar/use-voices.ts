"use client";
// The device's speech synthesis voices, which most browsers load asynchronously
// (getVoices() is empty until "voiceschanged" fires).
import { useSyncExternalStore } from "react";

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : undefined);

let cache: SpeechSynthesisVoice[] = [];
const EMPTY: SpeechSynthesisVoice[] = [];

function subscribe(onChange: () => void): () => void {
  const s = synth();
  if (!s) return () => {};
  const update = () => {
    cache = s.getVoices();
    onChange();
  };
  s.addEventListener("voiceschanged", update);
  update();
  return () => s.removeEventListener("voiceschanged", update);
}

export function useVoices(): SpeechSynthesisVoice[] {
  return useSyncExternalStore(
    subscribe,
    () => cache,
    () => EMPTY,
  );
}
