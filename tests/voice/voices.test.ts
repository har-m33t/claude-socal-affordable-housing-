import { describe, expect, it } from "vitest";
import { languageByCode } from "@/lib/i18n/languages";
import { pickVoice, speakingEstimateMs, type VoiceLike } from "@/lib/voice/voices";

const v = (lang: string, name: string, localService = true, isDefault = false): VoiceLike => ({ lang, name, localService, default: isDefault });
// Roughly this Mac: Spanish, Chinese, Korean and English voices; no Vietnamese.
const mac = [
  v("en-US", "Samantha", true, true),
  v("es-ES", "Mónica"),
  v("es-MX", "Paulina"),
  v("es-US", "Google español de Estados Unidos", false),
  v("zh-HK", "Sinji"),
  v("zh-TW", "Meijia"),
  v("zh-CN", "Tingting"),
  v("ko-KR", "Yuna"),
];
const lang = (c: string) => languageByCode(c)!;

describe("voice selection", () => {
  it("prefers the earliest preferred locale, and never a network voice (it would send the text away)", () => {
    // es-US is first on the list but only as a network voice: the on-device es-MX voice wins.
    expect(pickVoice(mac, lang("es"))?.name).toBe("Paulina");
    expect(pickVoice([v("es-US", "net", false)], lang("es"))).toBeUndefined();
    expect(pickVoice([v("es-MX", "b"), v("es-MX", "a", true, true)], lang("es"))?.name).toBe("a");
  });

  it("Simplified Chinese gets a Mandarin zh-CN voice, never Cantonese zh-HK", () => {
    expect(pickVoice(mac, lang("zh"))?.name).toBe("Tingting");
    expect(pickVoice([v("zh-HK", "Sinji")], lang("zh"))).toBeUndefined();
  });

  it("no Vietnamese voice: undefined, never an English stand-in", () => {
    expect(pickVoice(mac, lang("vi"))).toBeUndefined();
  });

  it("a bare preference matches any region, and Android-style underscores", () => {
    expect(pickVoice([v("es_419", "LatAm")], lang("es"))?.name).toBe("LatAm");
    expect(pickVoice([v("ko_KR", "Yuna")], lang("ko"))?.name).toBe("Yuna");
  });

  it("speaking estimate counts words, and CJK/Hangul syllables (no spaces to split on)", () => {
    expect(speakingEstimateMs("short")).toBe(4000);
    const en = "word ".repeat(40);
    expect(speakingEstimateMs(en)).toBe(40 * 460 + 2000);
    const zh = "污水验证需要公共工程部门的书面确认".repeat(3);
    expect(speakingEstimateMs(zh)).toBeGreaterThan(zh.length * 200);
  });
});
