import { describe, expect, it, vi } from "vitest";
import type { Availability } from "@/lib/i18n/translator";
import {
  checkRecognition,
  hasCloudConsent,
  installOnDevice,
  listen,
  micIdle,
  micReducer,
  setCloudConsent,
  STOP_GRACE_MS,
  type MicEvent,
  type MicState,
  type RecognitionCheck,
  type RecognitionCtor,
  type RecognitionInstance,
} from "@/lib/voice/recognition";

const run = (...es: MicEvent[]) => es.reduce<MicState>(micReducer, micIdle);
const checked = (onDevice: RecognitionCheck["onDevice"], cloud: RecognitionCheck["cloud"] = "available", consented = false): MicEvent => ({
  type: "checked",
  check: { lang: "es-US", onDevice, cloud },
  consented,
});

describe("mic state machine", () => {
  it("on-device model present: listens locally straight away", () => {
    expect(run({ type: "press" }, checked("available"))).toEqual({ kind: "listening", lang: "es-US", local: true });
  });

  it("on-device model downloadable: offers the one-time download, then listens locally", () => {
    const offered = run({ type: "press" }, checked("downloadable"));
    expect(offered).toEqual({ kind: "offer-download", lang: "es-US" });
    const downloading = micReducer(offered, { type: "download" });
    expect(downloading.kind).toBe("downloading");
    expect(micReducer(downloading, { type: "installed", ok: true })).toEqual({ kind: "listening", lang: "es-US", local: true });
    expect(micReducer(downloading, { type: "installed", ok: false }).kind).toBe("error");
  });

  it("no on-device recognition: never the cloud without consent", () => {
    const asked = run({ type: "press" }, checked("unsupported"));
    expect(asked).toEqual({ kind: "ask-consent", lang: "es-US" });
    expect(micReducer(asked, { type: "consent", granted: false })).toEqual(micIdle);
    expect(micReducer(asked, { type: "consent", granted: true })).toEqual({ kind: "listening", lang: "es-US", local: false });
    // A "download" or "installed" can't sneak past the consent question.
    expect(micReducer(asked, { type: "download" })).toBe(asked);
    expect(micReducer(asked, { type: "installed", ok: true })).toBe(asked);
  });

  it("consent already given this session: listens via the cloud without asking again", () => {
    expect(run({ type: "press" }, checked("unavailable", "available", true))).toEqual({ kind: "listening", lang: "es-US", local: false });
  });

  it("neither on-device nor cloud: an honest error", () => {
    expect(run({ type: "press" }, checked("unavailable", "unavailable", true)).kind).toBe("error");
  });

  it("ignores stale results and ends listening on 'ended'", () => {
    expect(micReducer(micIdle, checked("available"))).toBe(micIdle); // not checking
    expect(run({ type: "press" }, checked("available"), { type: "ended" })).toEqual(micIdle);
  });

  it("consent lives in memory only", () => {
    expect(hasCloudConsent()).toBe(false);
    setCloudConsent(true);
    expect(hasCloudConsent()).toBe(true);
    setCloudConsent(false);
  });
});

/** A fake SpeechRecognition with the static on-device API. */
function fakeCtor(table: Record<string, Availability>, installOk = true) {
  const instances: Array<RecognitionInstance & { started: boolean }> = [];
  class Fake {
    lang = "";
    continuous = true;
    interimResults = false;
    maxAlternatives = 3;
    processLocally?: boolean;
    onresult: RecognitionInstance["onresult"] = null;
    onerror: RecognitionInstance["onerror"] = null;
    onend: RecognitionInstance["onend"] = null;
    started = false;
    constructor() {
      instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
    static available = vi.fn(async ({ langs, processLocally }: { langs: string[]; processLocally: boolean }) => table[`${langs[0]}:${processLocally ? "local" : "cloud"}`] ?? "unavailable");
    static install = vi.fn(async () => installOk);
  }
  return { ctor: Fake as unknown as RecognitionCtor, instances };
}

const result = (parts: Array<[string, boolean]>) => ({
  results: Object.assign(
    parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    { length: parts.length },
  ),
});

describe("checking and listening", () => {
  it("picks the first locale with on-device support, else one the cloud supports", async () => {
    const { ctor } = fakeCtor({ "es-US:local": "unavailable", "es-MX:local": "downloadable", "es-US:cloud": "available" });
    expect(await checkRecognition(ctor, ["es-US", "es-MX"])).toEqual({ lang: "es-MX", onDevice: "downloadable", cloud: "unavailable" });
    const cloudOnly = fakeCtor({ "fil-PH:cloud": "available" }).ctor;
    expect(await checkRecognition(cloudOnly, ["fil-PH"])).toEqual({ lang: "fil-PH", onDevice: "unavailable", cloud: "available" });
  });

  it("a browser without the static API reports 'unsupported' (so the consent gate applies)", async () => {
    const Old = function () {} as unknown as RecognitionCtor;
    expect(await checkRecognition(Old, ["en-US"])).toEqual({ lang: "en-US", onDevice: "unsupported", cloud: "unsupported" });
    expect(await installOnDevice(Old, "en-US")).toBe(false);
  });

  it("listen(): on-device flag, live interim text, and what was heard when stopped", () => {
    const { ctor, instances } = fakeCtor({});
    const heard: string[] = [];
    const onFinal = vi.fn();
    const stop = listen(ctor, { lang: "es-US", local: true }, { onInterim: (t) => heard.push(t), onFinal, onError: vi.fn() });
    const r = instances[0];
    expect([r.lang, r.processLocally, r.interimResults, r.continuous, r.started]).toEqual(["es-US", true, true, false, true]);
    r.onresult?.(result([["¿Qué es", false]]));
    r.onresult?.(result([["¿Qué es el medidor?", true]]));
    expect(heard).toEqual(["¿Qué es", "¿Qué es el medidor?"]);
    stop();
    expect(onFinal).toHaveBeenCalledWith("¿Qué es el medidor?");
  });

  it("listen(): cloud sessions don't set processLocally; errors report once and skip onFinal", () => {
    const { ctor, instances } = fakeCtor({});
    const onFinal = vi.fn();
    const onError = vi.fn();
    listen(ctor, { lang: "en-US", local: false }, { onInterim: vi.fn(), onFinal, onError });
    const r = instances[0];
    expect(r.processLocally).toBeUndefined();
    r.onerror?.({ error: "not-allowed" });
    r.onend?.();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access is off/));
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("stop() ends the session itself when the engine never fires 'end' (Chrome on-device)", () => {
    vi.useFakeTimers();
    try {
      const { ctor, instances } = fakeCtor({});
      const onFinal = vi.fn();
      const stop = listen(ctor, { lang: "vi-VN", local: true }, { onInterim: vi.fn(), onFinal, onError: vi.fn() });
      const r = instances[0];
      r.stop = vi.fn(); // fires nothing
      r.abort = vi.fn();
      r.onresult?.(result([["Báo cáo", false]]));
      stop();
      expect(onFinal).not.toHaveBeenCalled();
      vi.advanceTimersByTime(STOP_GRACE_MS);
      expect(r.abort).toHaveBeenCalled();
      expect(onFinal).toHaveBeenCalledWith("Báo cáo");
      r.onend?.(); // a late "end" doesn't report twice
      expect(onFinal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("install() asks the browser for the on-device model", async () => {
    const { ctor } = fakeCtor({}, true);
    expect(await installOnDevice(ctor, "es-US")).toBe(true);
    expect(ctor.install).toHaveBeenCalledWith({ langs: ["es-US"], processLocally: true });
  });
});
