// The languages Pointer can answer in. English is the official text; every other
// language is an on-device machine translation of it, offered only when this
// browser's built-in Translator supports the pair (see availableLanguages).
//
// Why these: in Anaheim, the most common languages spoken at home after English are
// Spanish (41.2%) and Vietnamese (6.9%), then Tagalog and Korean (ACS 2024 1-year,
// table C16001). HCD publishes its ADU Handbook in Spanish, Vietnamese and Chinese.

export type LangCode = "en" | "es" | "vi" | "zh" | "ko" | "tl";

export interface Language {
  code: LangCode;
  /** The language's name in itself, shown in the menu. */
  native: string;
  english: string;
  /** Codes the on-device Translator may know this language by, in order of preference. */
  translator: string[];
  /** Speech recognition locales, in order of preference. */
  recognition: string[];
  /** Speech synthesis voice locales, in order of preference; a bare code matches any region. Dialects that would misread the text are left out. */
  voices: string[];
  /** HCD publishes its ADU Handbook in this language. */
  handbook: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { code: "en", native: "English", english: "English", translator: ["en"], recognition: ["en-US"], voices: ["en-US", "en-GB", "en"], handbook: false },
  { code: "es", native: "Español", english: "Spanish", translator: ["es"], recognition: ["es-US", "es-MX"], voices: ["es-US", "es-MX", "es-ES", "es"], handbook: true },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", translator: ["vi"], recognition: ["vi-VN"], voices: ["vi-VN", "vi"], handbook: true },
  // Simplified Chinese, read in Mandarin: a Cantonese (zh-HK) voice would misread it.
  { code: "zh", native: "中文 (简体)", english: "Chinese (Simplified)", translator: ["zh"], recognition: ["zh-CN"], voices: ["zh-CN", "zh-SG", "zh-TW"], handbook: true },
  { code: "ko", native: "한국어", english: "Korean", translator: ["ko"], recognition: ["ko-KR"], voices: ["ko-KR", "ko"], handbook: false },
  { code: "tl", native: "Tagalog", english: "Tagalog", translator: ["fil", "tl"], recognition: ["fil-PH"], voices: ["fil-PH", "tl-PH", "fil", "tl"], handbook: false },
];

export const ENGLISH = LANGUAGES[0];

/** HCD's ADU Handbook page, which links its Spanish, Vietnamese and Chinese editions. */
export const HCD_HANDBOOK_URL = "https://www.hcd.ca.gov/building-standards/adu/handbook";

export function languageByCode(code: string | undefined): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** The Language a detected BCP 47 tag ("es-419", "fil", "zh-Hans") belongs to, if we offer it. */
export function languageForTag(tag: string | undefined): Language | undefined {
  if (!tag) return undefined;
  const primary = tag.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((l) => l.code === primary || l.translator.some((t) => t.toLowerCase() === primary));
}
