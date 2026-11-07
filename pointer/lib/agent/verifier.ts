/**
 * Lane 3: the law-claim verifier. The last gate before a law claim reaches a
 * homeowner's screen.
 *
 * It FAILS CLOSED. California renumbered ADU law in 2024 and city handouts
 * still cite the dead numbers, so a confident wrong answer here is the worst
 * possible outcome. A dropped sentence costs the demo a sentence; an unbacked
 * statement of law costs the user real money.
 *
 * Backing means one of exactly two things:
 *   (a) a well-formed `citation` (an absolute http(s) `source_url` plus an ISO
 *       `checked_date`), or
 *   (b) every statute-like token in the prose maps to a `data/statutes.json`
 *       entry whose `confirmed` is literally `true`.
 *
 * `confirmed: false` is a lead, not a fact: a human has not opened the source.
 * A claim resting on one is dropped.
 */
import type {
  AgentEvent,
  Citation,
  StatuteEntry,
  VerifierModule,
  VerifyResult,
} from "./types";

// --------------------------------------------------------------- detection

/**
 * A Government Code citation with a word marker in front of it:
 *   "Gov Code 65852.2", "Government Code § 66314", "GOV 66333",
 *   "Government Code Section 66314".
 */
const GOV_CODE_CITATION =
  /\b(?:gov|govt|government)\b\.?\s*(?:code)?\s*(?:§{1,2}\s*)?(?:sec(?:tion)?s?\.?\s*)?\d{4,6}(?:\.\d{1,3})?/i;

/** A section marker in front of a section-sized number: "§ 66314", "Section 66314". */
const SECTION_MARKER_CITATION =
  /(?:§{1,2}|\bsec(?:tion)?s?\.?)\s*\d{4,6}(?:\.\d{1,3})?/i;

/**
 * A bare section-sized number: "65852.22", "66333".
 *
 * Deliberately broad: five-digit runs that are not statutes (a ZIP code in a
 * drafted address, say) will trip this and cost that one event. Per the lane
 * brief, over-detection is the cheap error and under-detection is the
 * expensive one. The lookaround keeps it off longer digit runs and off
 * comma-grouped numbers such as "6,000".
 */
const BARE_STATUTE_NUMBER = /(?<![\d.,])\d{5}(?:\.\d{1,3})?(?!\d)/;

/** A California bill reference: "SB 9", "AB 2221", "SB 477", "S.B. 9". */
const BILL_REFERENCE = /\b(?:s\.?\s?b\.?|a\.?\s?b\.?|ac\.?a\.?|sc\.?a\.?)\s*-?\s*\d{1,4}\b/i;

/** Prose that asserts what the law is, independent of any number. */
const LAW_ASSERTING_PHRASES: readonly RegExp[] = [
  // "state law requires", "California law", "under federal law"
  /\b(?:state|california|federal|local|municipal)\s+law\b/i,
  /\b(?:required|allowed|permitted|prohibited|mandated|exempt)\s+(?:by|under)\s+(?:state\s+|california\s+|federal\s+|local\s+)?law\b/i,
  /\bby\s+law\b/i,
  // "the city must", "the county cannot deny"
  /\b(?:city|county|jurisdiction|agency|planner|department)\s+(?:must|shall|cannot|can't|may\s+not|is\s+required\s+to|has\s+to|is\s+not\s+allowed\s+to)\b/i,
  /\b(?:cannot|can't|may\s+not|must\s+not)\s+(?:deny|reject|require|charge|impose|condition)\b/i,
  // "you are entitled to", "you have a right to"
  /\bentitl(?:e|es|ed|ement)\b/i,
  /\byou\s+(?:are|'re)?\s*(?:legally\s+)?(?:eligible|allowed|permitted)\s+(?:to|for)\b/i,
  /\b(?:have|has)\s+(?:a|the)\s+right\s+to\b/i,
  // "ministerial approval", "by right", "as of right"
  /\bministerial(?:ly)?\b/i,
  /\bby\s+right\b/i,
  /\bas\s+of\s+right\b/i,
  // statutory vocabulary
  /\bstatut(?:e|es|ory|orily)\b/i,
  /\bordinance\b/i,
  /\bgovernment\s+code\b/i,
  /\bsenate\s+bill\b/i,
  /\bassembly\s+bill\b/i,
  /\b(?:renumbered|repealed|recodified|superseded|preempt(?:s|ed|ion)?)\b/i,
  /\b(?:legal|legally|unlawful|illegal|lawful)\b/i,
  /\bexempt(?:ion|ions|ed)?\s+from\b/i,
  // "the code requires", "the ordinance prohibits", "state law mandates"
  /\b(?:law|laws|statute|statutes|code|ordinance|state|city|county)\b[^.;!?]{0,60}\b(?:requires?|mandates?|prohibits?|preempts?|allows?|entitles?|obligates?)\b/i,
  /\b(?:shall|must)\s+(?:be\s+)?(?:approved|permitted|allowed|granted|denied|ministerially)\b/i,
];

const STATUTE_LIKE_PATTERNS: readonly RegExp[] = [
  GOV_CODE_CITATION,
  SECTION_MARKER_CITATION,
  BARE_STATUTE_NUMBER,
  BILL_REFERENCE,
];

/**
 * True when `text` reads like an assertion about what the law is or requires.
 *
 * Tuned to over-detect. A false positive drops one sentence from the demo; a
 * false negative puts law nobody checked in front of a homeowner.
 */
export function looksLikeLawClaim(text: string): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed === "") return false;
  for (const pattern of STATUTE_LIKE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  for (const pattern of LAW_ASSERTING_PHRASES) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// ----------------------------------------------------------------- tokens

/**
 * Every section-sized number in the text, in order of first appearance, with
 * duplicates removed. Matches numbers with or without a marker word in front,
 * so "Gov Code 65852.2 and 65852.22" yields both.
 */
const STATUTE_TOKEN_SCAN = /(?<![\d.,])\d{4,6}(?:\.\d{1,3})?(?!\d)/g;

function statuteTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(STATUTE_TOKEN_SCAN)) {
    const token = match[0];
    // A bill number ("SB 9", "AB 2221") is a reference, not a code section;
    // the statute map is keyed by code sections, so bills can never be
    // satisfied on the statutes path and must rely on a citation. Four-digit
    // tokens are only treated as sections when a marker word precedes them.
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out.filter((token) => isSectionSized(token, text));
}

/**
 * A token counts as a code section when it has five or more leading digits, or
 * when a Government Code / section marker sits immediately in front of it.
 * This keeps "AB 2221" out of the statute map lookup while keeping
 * "Government Code 6631" style markers in.
 */
function isSectionSized(token: string, text: string): boolean {
  const digits = token.split(".")[0] ?? "";
  if (digits.length >= 5) return true;
  const marked = new RegExp(
    `(?:§{1,2}|\\bsec(?:tion)?s?\\.?|\\bgov(?:t|ernment)?\\b\\.?\\s*(?:code)?)\\s*${token.replace(".", "\\.")}\\b`,
    "i",
  );
  return marked.test(text);
}

// ------------------------------------------------------------- statute map

/** Numeric value of a section token, or null when it is not numeric. */
function sectionValue(raw: string): number | null {
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * True when `token` falls inside an entry's `new_range`. `new_range` is either
 * a single section or a hyphenated range, exactly as `data/statutes.json`
 * writes it; nothing is assumed about which numbers those are.
 */
function matchesNewRange(token: string, newRange: string): boolean {
  const value = sectionValue(token);
  if (value === null) return false;
  const parts = String(newRange ?? "")
    .split(/[-‐-―]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return false;
  if (parts.length === 1) {
    const only = sectionValue(parts[0] as string);
    return only !== null && only === value;
  }
  const low = sectionValue(parts[0] as string);
  const high = sectionValue(parts[parts.length - 1] as string);
  if (low === null || high === null) return false;
  return value >= Math.min(low, high) && value <= Math.max(low, high);
}

function entryMatchesToken(entry: StatuteEntry, token: string): boolean {
  const old = String(entry?.old ?? "").trim();
  if (old === token) return true;
  const oldValue = sectionValue(old);
  const tokenValue = sectionValue(token);
  if (oldValue !== null && tokenValue !== null && oldValue === tokenValue) return true;
  return matchesNewRange(token, String(entry?.new_range ?? ""));
}

// ---------------------------------------------------------------- citation

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * null when the citation is well-formed enough to back a law claim; otherwise
 * a fragment naming what is wrong, for the `reason` string.
 */
function citationDefect(citation: Citation | undefined): string | null {
  if (citation === undefined || citation === null) return "no citation";
  const url = typeof citation.source_url === "string" ? citation.source_url.trim() : "";
  if (url === "") return "an empty citation source_url";
  if (!isAbsoluteHttpUrl(url)) {
    return `a citation source_url that is not an absolute http(s) URL: "${url}"`;
  }
  const date = typeof citation.checked_date === "string" ? citation.checked_date.trim() : "";
  if (date === "") return "an empty citation checked_date";
  if (!ISO_DATE.test(date)) {
    return `a citation checked_date that is not an ISO date: "${date}"`;
  }
  return null;
}

// ------------------------------------------------------------------ gate

/**
 * The gate. Pass-through for anything that is not prose asserting law; for a
 * law claim, backing is required and anything short of it is dropped.
 *
 * When the text names several statutes, EVERY one of them must resolve to a
 * confirmed entry. One unconfirmed or unmapped number drops the whole claim,
 * because the sentence the user reads is a single unit: we cannot show them
 * half of it.
 *
 * A token that resolves to more than one entry (a section that sits inside a
 * confirmed range but is also the `new_range` of an unconfirmed entry) is
 * resolved fail-closed: if any matching entry is unconfirmed, the claim drops.
 */
export function verifyEvent(event: AgentEvent, statutes: StatuteEntry[]): VerifyResult {
  const text = typeof event?.text === "string" ? event.text : "";

  // point_to / highlight / mark_item carry no prose, and a draft_field or
  // add_note without text asserts nothing. Nothing to check.
  if (text.trim() === "") return { ok: true, event };
  if (!looksLikeLawClaim(text)) return { ok: true, event };

  // (a) a well-formed citation backs the claim on its own.
  const defect = citationDefect(event.citation);
  if (defect === null) return { ok: true, event };

  // (b) otherwise every statute-like token must map to a confirmed entry.
  const tokens = statuteTokens(text);
  if (tokens.length === 0) {
    return { ok: false, reason: `law claim with ${defect}` };
  }

  const entries = Array.isArray(statutes) ? statutes : [];
  for (const token of tokens) {
    const matches = entries.filter((entry) => entryMatchesToken(entry, token));
    if (matches.length === 0) {
      return { ok: false, reason: `law claim cites ${token}, which is not in the statute map` };
    }
    if (matches.some((entry) => entry.confirmed !== true)) {
      return { ok: false, reason: `law claim cites ${token}, whose mapping is unconfirmed` };
    }
  }

  return { ok: true, event };
}

/** The frozen `VerifierModule` surface, so tsc checks the shape for us. */
export const verifier: VerifierModule = { verifyEvent, looksLikeLawClaim };

export default verifier;
