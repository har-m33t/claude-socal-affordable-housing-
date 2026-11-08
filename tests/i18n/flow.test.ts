import { describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "@/components/pointer/answer";
import { questionToEnglish, translatePreserving, translateReply } from "@/lib/i18n/flow";
import type { LangCode } from "@/lib/i18n/languages";
import type { Detected, TranslationService } from "@/lib/i18n/translator";

function fake(detected?: Detected, ready: LangCode[] = ["en", "es", "vi"]): TranslationService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detect: vi.fn(async () => detected),
    ready: (c) => ready.includes(c),
    translate: vi.fn(async (text: string, from: LangCode, to: LangCode) => {
      calls.push(`${from}>${to}:${text}`);
      return `<${to}>${text}`;
    }),
  };
}

describe("question to English", () => {
  it("passes an English question through untouched", async () => {
    const t = fake({ code: "en", confidence: 0.99 });
    expect(await questionToEnglish("What is the meter spot report?", "es", t)).toEqual({
      original: "What is the meter spot report?",
      english: "What is the meter spot report?",
      from: "en",
    });
    expect(t.calls).toEqual([]);
  });

  it("detect → English: a confident detection wins over the chosen language", async () => {
    const t = fake({ code: "vi", confidence: 0.9 });
    const a = await questionToEnglish("Báo cáo đồng hồ là gì?", "es", t);
    expect(a.from).toBe("vi");
    expect(a.english).toBe("<en>Báo cáo đồng hồ là gì?");
  });

  it("an unsure detection, or one we can't translate from, falls back to the chosen language", async () => {
    expect((await questionToEnglish("medidor", "es", fake({ code: "vi", confidence: 0.3 }))).from).toBe("es");
    expect((await questionToEnglish("미터", "es", fake({ code: "ko", confidence: 0.99 }))).from).toBe("es");
    expect((await questionToEnglish("medidor", "es", fake(undefined))).from).toBe("es");
  });

  it("a question known to be English (a suggestion chip) skips detection and translation", async () => {
    const t = fake(undefined);
    expect((await questionToEnglish("How do I get a sewer verification?", "es", t, "en")).from).toBe("en");
    expect(t.detect).not.toHaveBeenCalled();
    expect(t.calls).toEqual([]);
  });

  it("English chosen and nothing detected: no translation at all", async () => {
    const t = fake(undefined);
    expect((await questionToEnglish("sewer", "en", t)).english).toBe("sewer");
    expect(t.calls).toEqual([]);
  });
});

describe("reply translation", () => {
  const found: AnswerResult = {
    kind: "found",
    targetId: "meter",
    text: "“Meter spot report” — from Checklist, page 1:\nAnswered from the documents (offline).",
    quote: "Complete this step if you are adding a new electric meter.",
    sources: [{ title: "Anaheim checklist", url: "https://www.anaheim.net/x.pdf", checked_date: "2026-05-01" }],
  };

  it("translates text line by line and the quote; never the sources", async () => {
    const t = fake();
    const r = await translateReply(found, "es", t);
    expect(r).toEqual({
      lang: "es",
      text: "<es>“Meter spot report” — from Checklist, page 1:\n<es>Answered from the documents (offline).",
      quote: "<es>Complete this step if you are adding a new electric meter.",
    });
    expect(t.calls.some((c) => c.includes("anaheim.net") || c.includes("Anaheim checklist"))).toBe(false);
  });

  it("does nothing for English, and has no quote for not_found", async () => {
    expect(await translateReply(found, "en", fake())).toBeUndefined();
    const nf: AnswerResult = { kind: "not_found", text: "That isn't on this checklist.", sources: [] };
    expect(await translateReply(nf, "vi", fake())).toEqual({ lang: "vi", text: "<vi>That isn't on this checklist.", quote: undefined });
  });
});

describe("verbatim spans", () => {
  it("file names, snake_case types, e-mails and web addresses are never translated", async () => {
    const t = fake();
    const out = await translatePreserving(
      "sewer-capacity-email.pdf (declared type: sewer_capacity_verification). Request it online (anaheim.net/3472) or e-mail PWPermits@anaheim.net.",
      "es",
      t,
    );
    expect(out).toBe(
      "sewer-capacity-email.pdf <es>(declared type: sewer_capacity_verification<es>). Request it online (anaheim.net/3472<es>) or e-mail PWPermits@anaheim.net.",
    );
    expect(t.calls.join(" ")).not.toMatch(/\.pdf|_capacity_|anaheim\.net/);
  });
});

