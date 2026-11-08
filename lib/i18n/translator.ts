// On-device translation and language detection, over the browser's built-in
// Translator and LanguageDetector APIs (Chrome 138+). Nothing here makes a network
// call: when a language pack is "downloadable", the browser itself fetches the model
// once and keeps it on this device. Where the APIs are missing, Pointer is English-only.
import { ENGLISH, LANGUAGES, languageForTag, type LangCode, type Language } from "./languages";

export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface Monitor extends EventTarget {}
interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
export interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: Monitor) => void }): Promise<TranslatorInstance>;
}
interface DetectorInstance {
  detect(text: string): Promise<Array<{ detectedLanguage?: string; confidence?: number }>>;
}
export interface DetectorStatic {
  availability(): Promise<Availability>;
  create(o?: { monitor?: (m: Monitor) => void }): Promise<DetectorInstance>;
}

export interface BrowserTranslationApis {
  Translator?: TranslatorStatic;
  LanguageDetector?: DetectorStatic;
}

export function browserTranslationApis(): BrowserTranslationApis {
  if (typeof globalThis === "undefined") return {};
  const g = globalThis as unknown as BrowserTranslationApis;
  return { Translator: g.Translator, LanguageDetector: g.LanguageDetector };
}

/** A language the menu offers, with whether its model is already on this device. */
export interface LanguageOption {
  language: Language;
  /** "available": ready now. "downloadable"/"downloading": the browser fetches it once, on first use. */
  status: Exclude<Availability, "unavailable">;
}

export interface Detected {
  code: LangCode;
  confidence: number;
}

/** What the answer flow needs from translation; implemented on-device below, faked in tests. */
export interface TranslationService {
  detect(text: string): Promise<Detected | undefined>;
  translate(text: string, from: LangCode, to: LangCode): Promise<string>;
  /** True once both directions between English and `code` can translate without a download prompt. */
  ready(code: LangCode): boolean;
}

const worst = (a: Availability, b: Availability): Availability => {
  const order: Availability[] = ["unavailable", "downloadable", "downloading", "available"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
};

export class OnDeviceTranslation implements TranslationService {
  private readonly apis: BrowserTranslationApis;
  /** Our language code -> the code this browser's Translator knows it by. */
  private readonly codes = new Map<LangCode, string>([["en", "en"]]);
  private readonly translators = new Map<string, Promise<TranslatorInstance>>();
  /** Pairs whose translator exists (its model is on this device). */
  private readonly created = new Set<string>();
  private readonly readyPairs = new Set<LangCode>(["en"]);
  private detector?: Promise<DetectorInstance | undefined>;

  constructor(apis: BrowserTranslationApis = browserTranslationApis()) {
    this.apis = apis;
  }

  get supported(): boolean {
    return !!this.apis.Translator;
  }

  /** English, plus every language this browser can translate to and from English on-device. */
  async languages(): Promise<LanguageOption[]> {
    const T = this.apis.Translator;
    const out: LanguageOption[] = [{ language: ENGLISH, status: "available" }];
    if (!T) return out;
    const checks = LANGUAGES.filter((l) => l.code !== "en").map(async (language) => {
      for (const code of language.translator) {
        try {
          const [to, back] = await Promise.all([
            T.availability({ sourceLanguage: "en", targetLanguage: code }),
            T.availability({ sourceLanguage: code, targetLanguage: "en" }),
          ]);
          const status = worst(to, back);
          if (status === "unavailable") continue;
          this.codes.set(language.code, code);
          if (status === "available") this.readyPairs.add(language.code);
          return { language, status } satisfies LanguageOption;
        } catch {
          // An unknown tag throws in some builds: try the next code.
        }
      }
      return undefined;
    });
    for (const o of await Promise.all(checks)) if (o) out.push(o);
    return out;
  }

  ready(code: LangCode): boolean {
    return this.readyPairs.has(code);
  }

  /**
   * Make `code` usable both ways (English → code for replies, code → English for
   * questions), downloading models as needed. Call it from a click: the browser starts
   * a download only on a user gesture, and each download uses the gesture up. So one
   * call downloads at most one model; it resolves false when the other direction still
   * needs a download (call again from another click), true once both are ready.
   * `onProgress` gets 0..1 while the browser downloads.
   */
  async prepare(code: LangCode, onProgress?: (loaded: number) => void): Promise<boolean> {
    const T = this.apis.Translator;
    if (code === "en" || this.readyPairs.has(code)) return true;
    if (!T) throw new Error("No on-device translator");
    let gestureUsed = false;
    for (const [from, to] of [["en", code], [code, "en"]] as const) {
      const key = this.pairKey(from, to);
      if (key && this.created.has(key)) continue;
      const a = await T.availability({ sourceLanguage: this.codes.get(from)!, targetLanguage: this.codes.get(to)! });
      if (a === "unavailable") throw new Error(`No on-device translator for ${from} → ${to}`);
      if (a !== "available") {
        if (gestureUsed) return false;
        gestureUsed = true;
      }
      const monitor = (m: Monitor) =>
        m.addEventListener("downloadprogress", (e) => onProgress?.(Number((e as Event & { loaded?: number }).loaded ?? 0)));
      await this.translator(from, to, a === "available" ? undefined : monitor);
    }
    this.readyPairs.add(code);
    return true;
  }

  async translate(text: string, from: LangCode, to: LangCode): Promise<string> {
    if (from === to || !text.trim()) return text;
    const t = await this.translator(from, to);
    return t.translate(text);
  }

  async detect(text: string): Promise<Detected | undefined> {
    const d = await this.detectorInstance();
    if (!d) return undefined;
    try {
      const [top] = await d.detect(text);
      const lang = languageForTag(top?.detectedLanguage);
      return lang && top?.confidence !== undefined ? { code: lang.code, confidence: top.confidence } : undefined;
    } catch {
      return undefined;
    }
  }

  private pairKey(from: LangCode, to: LangCode): string | undefined {
    const source = this.codes.get(from);
    const target = this.codes.get(to);
    return source && target ? `${source}>${target}` : undefined;
  }

  private translator(from: LangCode, to: LangCode, monitor?: (m: Monitor) => void): Promise<TranslatorInstance> {
    const T = this.apis.Translator;
    const key = this.pairKey(from, to);
    if (!T || !key) return Promise.reject(new Error(`No on-device translator for ${from} → ${to}`));
    let p = this.translators.get(key);
    if (!p) {
      p = T.create({ sourceLanguage: this.codes.get(from)!, targetLanguage: this.codes.get(to)!, monitor });
      p.then(
        () => this.created.add(key),
        // A failed create (no gesture, download cancelled) may be retried later.
        () => this.translators.delete(key),
      );
      this.translators.set(key, p);
    }
    return p;
  }

  private detectorInstance(): Promise<DetectorInstance | undefined> {
    const D = this.apis.LanguageDetector;
    if (!D) return Promise.resolve(undefined);
    if (!this.detector) {
      // Only a detector already on this device: creating a downloadable one would spend the
      // homeowner's click (see prepare). Without it, the chosen language decides.
      this.detector = D.availability()
        .then((a) => (a === "available" ? D.create() : undefined))
        .catch(() => {
          this.detector = undefined; // retry on the next gesture
          return undefined;
        });
    }
    return this.detector;
  }
}
