// The translation flow around an answer. Retrieval and the agent work in English
// (the documents' language), so:
//   question (any offered language) → English → answer (English, verbatim quote)
//   → reply text + quote translated to the homeowner's language.
// The English stays the official text: the UI shows it one tap away. Source titles,
// URLs and dates (the citation chips) are never translated.
import type { AnswerResult } from "@/components/pointer/answer";
import type { LangCode } from "./languages";
import type { TranslationService } from "./translator";

/** Below this, the detector's guess loses to the language the homeowner chose. */
export const DETECT_CONFIDENCE = 0.6;

export interface AskedQuestion {
  /** What the homeowner typed or said. */
  original: string;
  /** What retrieval saw. Equal to `original` when no translation was needed. */
  english: string;
  from: LangCode;
}

/**
 * The question in English. The detector decides the source language when it is
 * confident and we can translate from it; otherwise the chosen language does.
 * An English question is passed through untouched. `known` skips detection when the
 * caller knows the language (a suggested-question chip is always English).
 */
export async function questionToEnglish(question: string, chosen: LangCode, t: TranslationService, known?: LangCode): Promise<AskedQuestion> {
  const detected = known ? { code: known, confidence: 1 } : await t.detect(question).catch(() => undefined);
  const confident = detected && detected.confidence >= DETECT_CONFIDENCE ? detected.code : undefined;
  const from: LangCode = confident && (confident === "en" || t.ready(confident)) ? confident : chosen;
  if (from === "en") return { original: question, english: question, from };
  const english = (await t.translate(question, from, "en")).trim();
  return { original: question, english: english || question, from };
}

export interface ReplyTranslation {
  lang: LangCode;
  text: string;
  quote?: string;
}

/**
 * Words a translator must not touch: file names, snake_case types, e-mail addresses and
 * web addresses. A translated "sewer-capacity-email.pdf" or "anaheim.net/3472" would
 * point the homeowner at something that doesn't exist.
 */
const VERBATIM =
  /(https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[\w-]+(?:\.[\w-]+)*\.(?:pdf|docx?|xlsx?|jpe?g|png|heic)\b|\b[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[\w-]+\.(?:net|com|gov|org|us)(?:\/[\w./-]*\w)?)/gi;

/** Translates `text` around its verbatim spans, which pass through untouched. */
export async function translatePreserving(text: string, to: LangCode, t: TranslationService): Promise<string> {
  const parts = text.split(VERBATIM); // odd indexes are the verbatim spans
  const out = await Promise.all(
    parts.map(async (part, i) => {
      if (i % 2 === 1 || !/\p{L}/u.test(part)) return part;
      const lead = part.match(/^\s*/)![0];
      const trail = part.match(/\s*$/)![0];
      return `${lead}${(await t.translate(part.trim(), "en", to)).trim()}${trail}`;
    }),
  );
  return out.join("");
}

/** The reply's text and quote in `to`, line by line so the reply keeps its shape. Sources are left alone. */
export async function translateReply(result: AnswerResult, to: LangCode, t: TranslationService): Promise<ReplyTranslation | undefined> {
  if (to === "en") return undefined;
  const lines = result.text.split("\n");
  const quote = result.kind === "found" ? result.quote : undefined;
  const [text, translatedQuote] = await Promise.all([
    Promise.all(lines.map((l) => translatePreserving(l, to, t))).then((ls) => ls.join("\n")),
    quote ? translatePreserving(quote, to, t) : Promise.resolve(undefined),
  ]);
  return { lang: to, text, quote: translatedQuote };
}
