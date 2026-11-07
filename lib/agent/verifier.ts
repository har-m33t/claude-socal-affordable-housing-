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
 *   (b) EVERY law-like reference in the prose resolves to a
 *       `data/statutes.json` entry whose `confirmed` is literally `true`.
 *
 * `confirmed: false` is a lead, not a fact: a human has not opened the source.
 * A claim resting on one is dropped.
 *
 * Both halves are hostile-input aware. City PDFs and uploaded packets are
 * untrusted and prompt injection through them is in this product's threat
 * model, so a planted instruction can induce any output shape it likes. Two
 * consequences shape the code below:
 *
 *   1. Detection runs on a normalized copy of the text, never on the raw
 *      bytes. Fullwidth digits, zero-width splits inside a number and
 *      combining marks are all folded away first, so none of them can hide a
 *      citation from the detector.
 *   2. A reference that cannot be resolved against the statute map by
 *      construction - a bill number, or digits that are not ASCII after
 *      normalization - does not get silently skipped. It forces the citation
 *      requirement, because an unresolvable reference is an unbacked one.
 *
 * The event handed back on success is the original, untouched. Normalization
 * exists only to decide.
 */
import type {
  AgentEvent,
  Citation,
  StatuteEntry,
  VerifierModule,
  VerifyResult,
} from "./types";

// ----------------------------------------------------------- normalization

/**
 * Characters that render blank, or carry no width at all, and so can be used
 * to split a word or a number in two without a reader noticing.
 *
 * Category alone is not enough here. Format characters and combining marks
 * cover the zero-width spaces, the soft hyphen, the byte-order mark and the
 * variation selectors, but several blank-rendering code points sit in
 * unrelated categories: U+2800 BRAILLE PATTERN BLANK is `So`, and the Hangul
 * fillers are `Lo`. Each code point below was checked against Node 20 rather
 * than assumed - the fillers are `Default_Ignorable_Code_Point` but U+2800 is
 * not, so it is named explicitly.
 */
const BLANK_RENDERING =
  /[\p{Cf}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}\u2800\u115F\u1160\u3164\uFFA0]/gu;

/**
 * Invisible or hair-thin characters sitting between two digits, which is the
 * shape of an attempt to break up a section number: "66<U+2009>333".
 *
 * Deliberately NOT ordinary spaces, tabs or newlines. Joining across those
 * welds a section number to whatever number follows it - "Section 66333 2024"
 * becomes the 9-digit run "663332024", which no section pattern matches, and
 * the reference disappears. A vanished reference is far worse than a false
 * positive: it is a miss, and the claim then sails through.
 *
 * This runs on the RAW text, before normalization. NFKD folds U+2009, U+200A
 * and U+202F into ordinary spaces, so after normalization they are no longer
 * distinguishable from a space that was always a space.
 */
const BLANK_INSIDE_NUMBER =
  /(?<=\p{Nd})[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u115F\u1160\u3164\uFFA0\u2009\u200A\u202F]+(?=\p{Nd})/gu;

/** The two forms the detectors run against. */
interface NormalizedText {
  /** Folded, with digit runs left exactly as the author spaced them. */
  unjoined: string;
  /** Folded, with invisible and hair-thin breaks inside numbers closed up. */
  joined: string;
}

/**
 * Fold the text: NFKD so compatibility forms come apart (fullwidth and
 * mathematical digits become ASCII, accented letters separate from their
 * marks), strip what renders blank, then NFKC to put the rest back together.
 */
function fold(text: string): string {
  return text.normalize("NFKD").replace(BLANK_RENDERING, "").normalize("NFKC");
}

/**
 * Both forms are kept and both are searched, belt and braces. The joined form
 * catches a number broken up on purpose; the unjoined form guarantees that no
 * future change to the joining rule can silently hide a reference that plain
 * text would have shown. Callers union the results.
 *
 * Only the decision uses this. The event keeps its original text.
 */
function normalizeForDetection(text: string): NormalizedText {
  return { unjoined: fold(text), joined: fold(text.replace(BLANK_INSIDE_NUMBER, "")) };
}

// --------------------------------------------------------------- detection

/*
 * WHAT THIS IS AND IS NOT. Everything below is a regex detector run over model
 * output after the fact. That makes it a mitigation, not a guarantee, and it
 * should not be read as a hard gate. Known-open evasions: Unicode confusables
 * (UTS #39 skeletons - NFKC does not fold Cyrillic "c" onto Latin "c", so a
 * homoglyph in a law-asserting phrase still passes), letter-spaced phrases
 * ("m i n i s t e r i a l"), and the fact that a citation is checked for form
 * and not for truth, so a well-formed but fabricated source_url backs any
 * claim. The robust alternative is not a better regex: law-bearing prose
 * should be constructed from verified data rather than scanned after it has
 * been written.
 *
 * Every pattern below carries the `u` flag and spells a digit `\p{Nd}`, not
 * `\d`. `\d` is ASCII-only, so an Arabic-Indic or other non-ASCII numeral
 * would slip past a `\d` pattern even after normalization - NFKC does not fold
 * those to ASCII. `\p{Nd}` sees them, and the reference layer then treats them
 * as unresolvable rather than as a number it can look up.
 */

/**
 * A Government Code citation with a word marker in front of it:
 *   "Gov Code 65852.2", "Government Code § 66314", "GOV 66333",
 *   "Government Code Section 66314".
 */
const GOV_CODE_CITATION =
  /\b(?:gov|govt|government)\b\.?\s*(?:code)?\s*(?:§{1,2}\s*)?(?:sec(?:tion)?s?\.?\s*)?\p{Nd}{4,6}(?:\.\p{Nd}{1,3})?/iu;

/** A section marker in front of a section-sized number: "§ 66314", "Section 66314". */
const SECTION_MARKER_CITATION =
  /(?:§{1,2}|\bsec(?:tion)?s?\.?)\s*\p{Nd}{4,6}(?:\.\p{Nd}{1,3})?/iu;

/**
 * A bare section-sized number: "65852.22", "66333".
 *
 * Deliberately broad: five-digit runs that are not statutes (a ZIP code in a
 * drafted address, say) will trip this and cost that one event. Per the lane
 * brief, over-detection is the cheap error and under-detection is the
 * expensive one. The lookaround keeps it off longer digit runs and off
 * comma-grouped numbers such as "6,000".
 */
const BARE_STATUTE_NUMBER = /(?<![\p{Nd}.,])\p{Nd}{5}(?:\.\p{Nd}{1,3})?(?!\p{Nd})/u;

/**
 * A California bill reference: "SB 9", "AB 2221", "SB 477", "S.B. 9".
 *
 * The boundaries are spelled out rather than `\b`, because `\b` is defined on
 * ASCII word characters: with `\p{Nd}` matching a non-ASCII numeral, a
 * trailing `\b` sees no boundary between that numeral and a following space
 * and the whole match fails. "SB <Arabic-Indic nine>" slipped through that way.
 */
const BILL_REFERENCE =
  /(?<![\p{L}\p{Nd}_])(?:s\.?\s?b\.?|a\.?\s?b\.?|ac\.?a\.?|sc\.?a\.?)\s*-?\s*\p{Nd}{1,4}(?![\p{L}\p{Nd}_])/iu;

/** Prose that asserts what the law is, independent of any number. */
const LAW_ASSERTING_PHRASES: readonly RegExp[] = [
  // "state law requires", "California law", "under federal law"
  /\b(?:state|california|federal|local|municipal)\s+law\b/iu,
  /\b(?:required|allowed|permitted|prohibited|mandated|exempt)\s+(?:by|under)\s+(?:state\s+|california\s+|federal\s+|local\s+)?law\b/iu,
  /\bby\s+law\b/iu,
  // "the city must", "the county cannot deny"
  /\b(?:city|county|jurisdiction|agency|planner|department)\s+(?:must|shall|cannot|can't|may\s+not|is\s+required\s+to|has\s+to|is\s+not\s+allowed\s+to)\b/iu,
  /\b(?:cannot|can't|may\s+not|must\s+not)\s+(?:deny|reject|require|charge|impose|condition)\b/iu,
  // "you are entitled to", "you have a right to"
  /\bentitl(?:e|es|ed|ement)\b/iu,
  /\byou\s+(?:are|'re)?\s*(?:legally\s+)?(?:eligible|allowed|permitted)\s+(?:to|for)\b/iu,
  /\b(?:have|has)\s+(?:a|the)\s+right\s+to\b/iu,
  // "ministerial approval", "by right", "as of right"
  /\bministerial(?:ly)?\b/iu,
  /\bby\s+right\b/iu,
  /\bas\s+of\s+right\b/iu,
  // statutory vocabulary
  /\bstatut(?:e|es|ory|orily)\b/iu,
  /\bordinance\b/iu,
  /\bgovernment\s+code\b/iu,
  /\bsenate\s+bill\b/iu,
  /\bassembly\s+bill\b/iu,
  /\b(?:renumbered|repealed|recodified|superseded|preempt(?:s|ed|ion)?)\b/iu,
  /\b(?:legal|legally|unlawful|illegal|lawful)\b/iu,
  /\bexempt(?:ion|ions|ed)?\s+from\b/iu,
  // "the code requires", "the ordinance prohibits", "state law mandates"
  /\b(?:law|laws|statute|statutes|code|ordinance|state|city|county)\b[^.;!?]{0,60}\b(?:requires?|mandates?|prohibits?|preempts?|allows?|entitles?|obligates?)\b/iu,
  /\b(?:shall|must)\s+(?:be\s+)?(?:approved|permitted|allowed|granted|denied|ministerially)\b/iu,
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
  const normalized = normalizeForDetection(text);
  return matchesAnyPattern(normalized.unjoined) || matchesAnyPattern(normalized.joined);
}

function matchesAnyPattern(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed === "") return false;
  for (const pattern of STATUTE_LIKE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  for (const pattern of LAW_ASSERTING_PHRASES) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// -------------------------------------------------------------- references

/**
 * One thing in the prose that points at law and therefore has to be backed.
 *
 *   `section` - a code section this module can look up in the statute map.
 *   `bill`    - a bill number. The statute map is keyed by code sections, so a
 *               bill can never resolve there; it can only be backed by a
 *               citation.
 *   `opaque`  - a section-shaped run of digits that is still not ASCII after
 *               normalization, so there is no number to look up. Treated as
 *               unresolvable rather than ignored.
 */
interface LawReference {
  kind: "section" | "bill" | "opaque";
  token: string;
  index: number;
}

/** Section-shaped digit runs, with or without a marker word in front. */
const STATUTE_TOKEN_SCAN = /(?<![\p{Nd}.,])\p{Nd}{4,6}(?:\.\p{Nd}{1,3})?(?!\p{Nd})/gu;

const BILL_REFERENCE_SCAN = new RegExp(BILL_REFERENCE.source, "giu");

const ASCII_SECTION = /^[0-9]+(?:\.[0-9]+)?$/;

function digitCount(token: string): number {
  return Array.from(token).filter((char) => /\p{Nd}/u.test(char)).length;
}

/**
 * Every law-like reference in the normalized text, in the order it appears,
 * duplicates removed.
 *
 * This is the fix for partial backing: the old code collected only the tokens
 * it could look up, so a sentence pairing a confirmed section with an unbacked
 * bill passed on the strength of the section alone. Everything that points at
 * law is enumerated here, and verifyEvent requires all of it to resolve.
 */
function collectReferences(normalized: NormalizedText): LawReference[] {
  const found: LawReference[] = [];

  // Both forms are scanned and the results unioned, so a reference only has to
  // be visible in ONE of them to be required to resolve.
  scanForReferences(normalized.unjoined, found);
  if (normalized.joined !== normalized.unjoined) {
    scanForReferences(normalized.joined, found);
  }

  const seen = new Set<string>();
  return found
    .filter((reference) => {
      const key = `${reference.kind}:${reference.token}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.index - b.index);
}

function scanForReferences(normalized: string, found: LawReference[]): void {
  for (const match of normalized.matchAll(STATUTE_TOKEN_SCAN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (ASCII_SECTION.test(token)) {
      // A four-digit run is only a section when a marker word precedes it;
      // otherwise it is a year, a lot size or a street number.
      if (digitCount(token) >= 5 || hasSectionMarker(token, normalized)) {
        found.push({ kind: "section", token, index });
      }
      continue;
    }
    // Section-shaped but not ASCII after normalization: nothing to look up.
    if (digitCount(token) >= 5 || hasSectionMarker(token, normalized)) {
      found.push({ kind: "opaque", token, index });
    }
  }

  for (const match of normalized.matchAll(BILL_REFERENCE_SCAN)) {
    found.push({ kind: "bill", token: match[0], index: match.index ?? 0 });
  }
}

/** True when a Government Code or section marker sits immediately before `token`. */
function hasSectionMarker(token: string, text: string): boolean {
  const literal = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marked = new RegExp(
    `(?:§{1,2}|\\bsec(?:tion)?s?\\.?|\\bgov(?:t|ernment)?\\b\\.?\\s*(?:code)?)\\s*${literal}(?!\\p{Nd})`,
    "iu",
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
 * When the text names several things, EVERY one of them must resolve to a
 * confirmed entry. One unconfirmed, unmapped or unresolvable reference drops
 * the whole claim, because the sentence the user reads is a single unit: we
 * cannot show them half of it.
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

  const normalized = normalizeForDetection(text);
  if (!looksLikeLawClaim(text)) return { ok: true, event };

  // (a) a well-formed citation backs the claim on its own.
  const defect = citationDefect(event.citation);
  if (defect === null) return { ok: true, event };

  // (b) otherwise every law-like reference must resolve to a confirmed entry.
  const references = collectReferences(normalized);
  if (references.length === 0) {
    return { ok: false, reason: `law claim with ${defect}` };
  }

  const entries = Array.isArray(statutes) ? statutes : [];
  for (const reference of references) {
    if (reference.kind === "bill") {
      return {
        ok: false,
        reason: `law claim references ${reference.token}, which the statute map cannot back, and has ${defect}`,
      };
    }
    if (reference.kind === "opaque") {
      return {
        ok: false,
        reason: `law claim references "${reference.token}", which is not written in ASCII digits and cannot be checked against the statute map, and has ${defect}`,
      };
    }
    const matches = entries.filter((entry) => entryMatchesToken(entry, reference.token));
    if (matches.length === 0) {
      return {
        ok: false,
        reason: `law claim cites ${reference.token}, which is not in the statute map`,
      };
    }
    if (matches.some((entry) => entry.confirmed !== true)) {
      return {
        ok: false,
        reason: `law claim cites ${reference.token}, whose mapping is unconfirmed`,
      };
    }
  }

  return { ok: true, event };
}

/** The frozen `VerifierModule` surface, so tsc checks the shape for us. */
export const verifier: VerifierModule = { verifyEvent, looksLikeLawClaim };

export default verifier;
