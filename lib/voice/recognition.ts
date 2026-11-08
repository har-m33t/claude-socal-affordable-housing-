// Voice input: the homeowner speaks their question. On-device first.
//
//   press ─▶ checking ─┬─ on-device "available" ──────────────────────────────▶ listening (local)
//                      ├─ on-device "downloadable" ─▶ offer-download ─download─▶ downloading ─▶ listening (local)
//                      └─ no on-device recognition ─┬─ consent given this session ─▶ listening (cloud)
//                                                   └─▶ ask-consent ─allow─▶ listening (cloud)
//   listening ─(final result | Esc | stop | error)─▶ idle / error
//
// Cloud recognition sends audio to the browser vendor's speech service, and Pointer can
// redact typed text but not audio: so it is used only when this browser can't recognize
// speech on-device, and only after the homeowner says yes. That yes lives in memory for
// this page session (never stored).
import type { Availability } from "@/lib/i18n/translator";

/** "unsupported": this browser can't say (no SpeechRecognition.available). */
export type RecognitionAvailability = Availability | "unsupported";

interface RecognitionResultList {
  length: number;
  [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } };
}
export interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Options = { langs: string[]; processLocally: boolean };
export interface RecognitionCtor {
  new (): RecognitionInstance;
  available?(o: Options): Promise<Availability>;
  install?(o: Options): Promise<boolean>;
}

export function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// ---------- consent (memory only, this page session) ----------

let cloudConsent = false;
export const hasCloudConsent = () => cloudConsent;
export const setCloudConsent = (granted: boolean) => {
  cloudConsent = granted;
};

export const CLOUD_NOTICE =
  "This browser can't recognize speech on this device, so it would send your audio to its speech service (for Chrome, that's Google). Pointer redacts typed text, but it cannot redact audio.";

// ---------- checking what this browser can do ----------

export interface RecognitionCheck {
  /** The locale to listen in. */
  lang: string;
  onDevice: RecognitionAvailability;
  cloud: RecognitionAvailability;
}

async function availability(ctor: RecognitionCtor, lang: string, processLocally: boolean): Promise<RecognitionAvailability> {
  if (typeof ctor.available !== "function") return "unsupported";
  try {
    return await ctor.available({ langs: [lang], processLocally });
  } catch {
    return "unsupported";
  }
}

/** Picks the first preferred locale this browser can recognize, preferring on-device anywhere over cloud. */
export async function checkRecognition(ctor: RecognitionCtor, locales: readonly string[]): Promise<RecognitionCheck> {
  const checks = await Promise.all(
    locales.map(async (lang) => ({ lang, onDevice: await availability(ctor, lang, true), cloud: await availability(ctor, lang, false) })),
  );
  return (
    checks.find((c) => c.onDevice !== "unavailable" && c.onDevice !== "unsupported") ??
    checks.find((c) => c.cloud !== "unavailable") ??
    checks[0] ?? { lang: "en-US", onDevice: "unsupported", cloud: "unsupported" }
  );
}

// ---------- the mic state machine ----------

export type MicState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "offer-download"; lang: string }
  | { kind: "downloading"; lang: string }
  | { kind: "ask-consent"; lang: string }
  | { kind: "listening"; lang: string; local: boolean }
  | { kind: "error"; message: string };

export type MicEvent =
  | { type: "press" }
  | { type: "checked"; check: RecognitionCheck; consented: boolean }
  | { type: "download" }
  | { type: "installed"; ok: boolean }
  | { type: "consent"; granted: boolean }
  | { type: "ended" }
  | { type: "failed"; message: string }
  | { type: "dismiss" };

export const micIdle: MicState = { kind: "idle" };

export function micReducer(s: MicState, e: MicEvent): MicState {
  switch (e.type) {
    case "press":
      return s.kind === "idle" || s.kind === "error" ? { kind: "checking" } : s;
    case "checked": {
      if (s.kind !== "checking") return s;
      const { lang, onDevice, cloud } = e.check;
      if (onDevice === "available") return { kind: "listening", lang, local: true };
      if (onDevice === "downloadable" || onDevice === "downloading") return { kind: "offer-download", lang };
      if (cloud === "unavailable") return { kind: "error", message: "Voice input isn't available for this language in this browser." };
      // No on-device recognition: the cloud only with consent.
      return e.consented ? { kind: "listening", lang, local: false } : { kind: "ask-consent", lang };
    }
    case "download":
      return s.kind === "offer-download" ? { kind: "downloading", lang: s.lang } : s;
    case "installed":
      if (s.kind !== "downloading") return s;
      return e.ok
        ? { kind: "listening", lang: s.lang, local: true }
        : { kind: "error", message: "The voice model didn't download. Try again, or type your question." };
    case "consent":
      if (s.kind !== "ask-consent") return s;
      return e.granted ? { kind: "listening", lang: s.lang, local: false } : micIdle;
    case "ended":
      return s.kind === "listening" ? micIdle : s;
    case "failed":
      return { kind: "error", message: e.message };
    case "dismiss":
      return micIdle;
  }
}

export function recognitionErrorMessage(code: string): string | undefined {
  switch (code) {
    case "aborted":
      return undefined; // we stopped it
    case "no-speech":
      return "Didn't catch that. Try again, a little closer to the mic.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is off for this site. Allow it in the browser's site settings, or type your question.";
    case "audio-capture":
      return "No microphone found.";
    case "language-not-supported":
      return "Voice input isn't available for this language in this browser.";
    case "network":
      return "The browser's speech service couldn't be reached.";
    default:
      return "Voice input stopped. Try again, or type your question.";
  }
}

// ---------- one listening session ----------

export interface ListenHandlers {
  /** Everything heard so far, final and interim: shown live in the input. */
  onInterim(text: string): void;
  /** Everything heard (may be empty) once recognition ends. */
  onFinal(text: string): void;
  onError(message: string): void;
}

/** How long stop() waits for the engine's own "end" before ending the session itself. */
export const STOP_GRACE_MS = 1200;

/**
 * Starts listening for one utterance. Returns a stop function: stop keeps what was heard.
 * Some engines (Chrome's on-device recognizer, seen with Chrome 156) fire "audioend" but
 * never "end" after stop(), so stop() ends the session itself after a short grace period.
 */
export function listen(ctor: RecognitionCtor, o: { lang: string; local: boolean }, h: ListenHandlers): () => void {
  const r = new ctor();
  r.lang = o.lang;
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  if (o.local) r.processLocally = true;
  let heard = "";
  let done = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const finish = (report: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(grace);
    report();
  };
  r.onresult = (e) => {
    if (done) return;
    let fin = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) fin += res[0].transcript;
      else interim += res[0].transcript;
    }
    heard = (fin + interim).trim();
    h.onInterim(heard);
  };
  r.onerror = (e) => {
    const msg = recognitionErrorMessage(e.error);
    if (msg) finish(() => h.onError(msg));
  };
  // Stopped early or not: keep what was heard, interim included.
  r.onend = () => finish(() => h.onFinal(heard));
  r.start();
  return () => {
    if (done || grace) return;
    r.stop();
    grace = setTimeout(() => {
      r.abort();
      finish(() => h.onFinal(heard));
    }, STOP_GRACE_MS);
  };
}

/** Downloads the on-device model for `lang` (the browser does the download). */
export async function installOnDevice(ctor: RecognitionCtor, lang: string): Promise<boolean> {
  if (typeof ctor.install !== "function") return false;
  try {
    return await ctor.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}
