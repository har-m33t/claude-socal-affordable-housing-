import { describe, expect, it, vi } from "vitest";
import { languageForTag } from "@/lib/i18n/languages";
import { OnDeviceTranslation, type Availability, type DetectorStatic, type TranslatorStatic } from "@/lib/i18n/translator";

/** A fake on-device Translator: `table` gives each "src>dst" pair's availability (default unavailable). */
function fakeTranslator(table: Record<string, Availability>) {
  const created: string[] = [];
  const T: TranslatorStatic = {
    availability: vi.fn(async ({ sourceLanguage: s, targetLanguage: t }) => {
      if (s === "xx" || t === "xx") throw new Error("bad tag");
      return table[`${s}>${t}`] ?? "unavailable";
    }),
    create: vi.fn(async ({ sourceLanguage: s, targetLanguage: t, monitor }) => {
      created.push(`${s}>${t}`);
      if (monitor) {
        const m = new EventTarget();
        monitor(m);
        for (const loaded of [0.5, 1]) m.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded }));
      }
      return { translate: async (text: string) => `[${t}] ${text}` };
    }),
  };
  return { T, created };
}

const both = (code: string, a: Availability): Record<string, Availability> => ({ [`en>${code}`]: a, [`${code}>en`]: a });

describe("on-device languages", () => {
  it("is English-only without a Translator API", async () => {
    const langs = await new OnDeviceTranslation({}).languages();
    expect(langs.map((l) => l.language.code)).toEqual(["en"]);
  });

  it("offers only languages translatable both ways, with their download status", async () => {
    const { T } = fakeTranslator({ ...both("es", "available"), ...both("vi", "downloadable"), "en>ko": "available", "ko>en": "unavailable" });
    const svc = new OnDeviceTranslation({ Translator: T });
    const langs = await svc.languages();
    expect(langs.map((l) => [l.language.code, l.status])).toEqual([
      ["en", "available"],
      ["es", "available"],
      ["vi", "downloadable"],
    ]);
    expect(svc.ready("es")).toBe(true);
    expect(svc.ready("vi")).toBe(false); // needs prepare() from a click
  });

  it("falls back to another code the Translator knows a language by (Tagalog as fil or tl)", async () => {
    const { T } = fakeTranslator(both("tl", "downloadable"));
    const langs = await new OnDeviceTranslation({ Translator: T }).languages();
    expect(langs.map((l) => l.language.code)).toContain("tl");
  });

  it("prepare() downloads one model per click (each download uses up the gesture), replies first", async () => {
    const table = both("vi", "downloadable");
    const { T, created } = fakeTranslator(table);
    const svc = new OnDeviceTranslation({ Translator: T });
    await svc.languages();
    const progress: number[] = [];
    expect(await svc.prepare("vi", (p) => progress.push(p))).toBe(false);
    expect(created).toEqual(["en>vi"]);
    expect(progress).toEqual([0.5, 1]);
    expect(svc.ready("vi")).toBe(false);
    table["en>vi"] = "available";
    expect(await svc.prepare("vi")).toBe(true); // the second click
    expect(created).toEqual(["en>vi", "vi>en"]);
    expect(svc.ready("vi")).toBe(true);
  });

  it("prepare() finishes in one click when the other direction is already on the device", async () => {
    const { T, created } = fakeTranslator({ "en>ko": "downloadable", "ko>en": "available" });
    const svc = new OnDeviceTranslation({ Translator: T });
    await svc.languages();
    expect(await svc.prepare("ko")).toBe(true);
    expect(created).toEqual(["en>ko", "ko>en"]);
  });

  it("translate() creates each pair once and passes English through", async () => {
    const { T, created } = fakeTranslator(both("es", "available"));
    const svc = new OnDeviceTranslation({ Translator: T });
    await svc.languages();
    expect(await svc.translate("Sewer", "en", "es")).toBe("[es] Sewer");
    expect(await svc.translate("Meter", "en", "es")).toBe("[es] Meter");
    expect(await svc.translate("Same", "en", "en")).toBe("Same");
    expect(created).toEqual(["en>es"]);
  });

  it("translate() rejects for a language the device can't translate", async () => {
    const svc = new OnDeviceTranslation({ Translator: fakeTranslator({}).T });
    await svc.languages();
    await expect(svc.translate("hi", "en", "ko")).rejects.toThrow();
  });

  it("detect() maps the detector's tag to an offered language", async () => {
    const D: DetectorStatic = {
      availability: async () => "available",
      create: async () => ({ detect: async () => [{ detectedLanguage: "es-419", confidence: 0.93 }] }),
    };
    const svc = new OnDeviceTranslation({ LanguageDetector: D });
    expect(await svc.detect("¿Qué es el reporte del medidor?")).toEqual({ code: "es", confidence: 0.93 });
    expect(await new OnDeviceTranslation({}).detect("hola")).toBeUndefined();
  });

  it("languageForTag knows regional and alternate tags", () => {
    expect(languageForTag("zh-Hans")?.code).toBe("zh");
    expect(languageForTag("fil")?.code).toBe("tl");
    expect(languageForTag("fr")).toBeUndefined();
  });
});
