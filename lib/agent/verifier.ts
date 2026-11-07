/**
 * Lane 3: the prose law-claim backstop, and the statute resolver.
 *
 * THE DESIGN. The model is not trusted to write law at all. Law reaches the UI
 * through exactly one channel: the model NAMES an entry in the statute table
 * by id, and the server resolves that id and renders the authoritative text
 * from verified data. The model never types a section number, a range, a
 * title or a URL, so there is nothing for it to get wrong and nothing for an
 * injected instruction to forge.
 *
 * That leaves this module two jobs:
 *
 *   1. `verifyEvent` / `looksLikeLawClaim` - the BACKSTOP. Prose (`text` on
 *      draft_field and add_note) is plain-language explanation only and may
 *      not assert law. If it does, the event is dropped, full stop. There is
 *      no longer a "but it carried a citation" escape, because law does not
 *      belong in prose any more. That makes the gate strictly simpler and
 *      strictly safer than the citation-and-statute-map version it replaces.
 *
 *   2. `loadStatuteTable` / `resolveStatuteId` - the LAW CHANNEL. An id either
 *      is in the table and confirmed, or the claim is refused. Every field
 *      handed back is copied out of the table entry, never out of the caller's
 *      input.
 *
 * Everything here fails closed. California renumbered ADU law in 2024 and city
 * handouts still cite the dead numbers, so a confident wrong answer is the
 * worst possible outcome: a dropped sentence costs the demo a sentence, while
 * an unbacked statement of law costs the user real money.
 *
 * The event handed back on success is the original, untouched. Normalization
 * exists only to decide.
 */
import type {
  AgentEvent,
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
 * A blank-rendering run sitting between two digits.
 *
 * `fold` must not DELETE these, only because deletion welds: "1234<U+2800>5678"
 * would become the 8-digit run "12345678", which no section pattern matches,
 * and both numbers would vanish at once. Between two digits the run collapses
 * to a single plain space instead, which keeps the two numbers separate and
 * separately visible. Everywhere else deletion is right, and is what closes up
 * "ministeri<U+200B>al".
 */
const BLANK_RENDERING_BETWEEN_DIGITS =
  /(?<=\p{Nd})[\p{Cf}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}\u2800\u115F\u1160\u3164\uFFA0]+(?=\p{Nd})/gu;

/**
 * Anything between two digits that could be hiding a break in a number:
 * blank-rendering runs and ordinary whitespace alike.
 *
 * This is deliberately aggressive, and it is safe to be aggressive ONLY
 * because it feeds the `joined` form alone. Welding is the hazard here -
 * "Section 66333 2024" joins into the 9-digit run "663332024", which no
 * section pattern matches - but the `unjoined` form is scanned too and still
 * sees "66333" on its own, and callers union the two. Over-detecting a
 * ZIP-shaped number is the cheap error; losing a real statute is not.
 *
 * It runs on the RAW text, before normalization: NFKD folds U+2009, U+200A and
 * U+202F into ordinary spaces, so after normalization a hair-thin space can no
 * longer be told apart from a space that was always a space.
 */
const BLANK_INSIDE_NUMBER =
  /(?<=\p{Nd})[\p{Cf}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}\p{Zs}\s\u2800\u115F\u1160\u3164\uFFA0]+(?=\p{Nd})/gu;

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
  return text
    .normalize("NFKD")
    .replace(BLANK_RENDERING_BETWEEN_DIGITS, " ")
    .replace(BLANK_RENDERING, "")
    .normalize("NFKC");
}

/**
 * Both forms are kept and CALLERS MUST UNION THEM - that is what licenses the
 * joined form to be as aggressive as it is. The joined form catches a number
 * broken up on purpose; the unjoined form guarantees that no amount of joining
 * can hide something plain text would have shown. Scanning only one of them
 * reintroduces either the evasion or the welding bug, depending which.
 *
 * Only the decision uses this. The event keeps its original text.
 */
function normalizeForDetection(text: string): NormalizedText {
  return { unjoined: fold(text), joined: fold(text.replace(BLANK_INSIDE_NUMBER, "")) };
}

// --------------------------------------------------------------- detection

/*
 * WHAT THIS IS AND IS NOT. Law reaches the UI only through server-resolved
 * statute ids: `resolveStatuteId` reads the section, range, title, URL and
 * check date out of the verified table, so nothing the model types is ever
 * read as law. The detector below is a BACKSTOP against the model asserting
 * law in prose, where it does not belong - not the thing that makes the law
 * correct. It is a regex over model output, so it mitigates rather than
 * guarantees: Unicode confusables (UTS #39 skeletons - NFKC does not fold
 * Cyrillic "c" onto Latin "c") and letter-spaced phrases ("m i n i s t e r i a
 * l") remain open against it. Those evasions no longer gate correctness,
 * because the legitimate law channel does not pass through here at all.
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


// ------------------------------------------------------------ law channel

/**
 * A statute as the SERVER renders it. Every field is copied out of the table
 * entry. None of it comes from the model, which is the entire point: the model
 * contributes an id and nothing else.
 */
export interface ResolvedStatute {
  id: string;
  old: string;
  new_range: string;
  title: string;
  source_url: string;
  checked_date: string;
}

export type StatuteResolution =
  | { ok: true; statute: ResolvedStatute }
  | { ok: false; reason: string };

/** An entry may carry an explicit `id`. The frozen StatuteEntry does not declare one. */
type StatuteEntryWithId = StatuteEntry & { id?: unknown };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Every field the renderer needs, present and of the right type. */
function isStatuteEntry(value: unknown): value is StatuteEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.old) &&
    isNonEmptyString(candidate.new_range) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.source_url) &&
    isNonEmptyString(candidate.checked_date) &&
    typeof candidate.confirmed === "boolean"
  );
}

function unwrapRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const wrapped = (raw as { statutes?: unknown }).statutes;
    if (Array.isArray(wrapped)) return wrapped;
  }
  throw new Error(
    "statute table must be an array of entries or an object carrying a `statutes` array",
  );
}

/**
 * Read a statute table out of parsed JSON.
 *
 * Two shapes are accepted, because two of them exist: a bare array, and an
 * object wrapping the array under `statutes` alongside its own provenance
 * notes. Anything else throws, because a table nobody can read is a boot-time
 * problem and should say so.
 *
 * An individual entry missing a field the renderer needs is left out rather
 * than throwing. That degrades closed: the id simply will not resolve, and
 * `resolveStatuteId` says so, which beats refusing to start over one typo.
 * Entries with `confirmed: false` are KEPT, so the resolver can tell "not
 * confirmed yet" apart from "not in the table".
 */
export function loadStatuteTable(raw: unknown): StatuteEntry[] {
  return unwrapRows(raw).filter(isStatuteEntry);
}

/** The identifier an entry answers to: its own `id`, or its `old` number. */
function entryIdentifier(entry: StatuteEntry): string {
  const declared = (entry as StatuteEntryWithId).id;
  return isNonEmptyString(declared) ? declared.trim() : String(entry.old ?? "").trim();
}

const MAX_LABEL_LENGTH = 64;

/**
 * Render a rejected id for the reason string.
 *
 * The id is model output and the model can be driven by an injected
 * instruction, so it is flattened (no control or format characters, which
 * could smuggle structure into a log line or a UI string) and clipped before
 * it is quoted back. The id is the ONLY part of the input that ever appears in
 * a reason.
 */
function safeLabel(value: unknown): string {
  if (typeof value !== "string") return `<${value === null ? "null" : typeof value}>`;
  const flattened = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
  const clipped =
    flattened.length > MAX_LABEL_LENGTH ? `${flattened.slice(0, MAX_LABEL_LENGTH)}...` : flattened;
  return `"${clipped}"`;
}

/**
 * Resolve a statute id against the table. Fails closed on every doubt.
 *
 * Matching is exact string equality after trimming - no normalization, no
 * case folding, no prefix or fuzzy matching. An id either is in the table or
 * is not. Fuzzy matching here would hand back a statute the model did not name
 * and the user did not ask for, which is the failure this whole design exists
 * to prevent.
 */
export function resolveStatuteId(id: string, statutes: StatuteEntry[]): StatuteResolution {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, reason: `statute id ${safeLabel(id)} is not a usable id` };
  }
  const wanted = id.trim();
  const entries = Array.isArray(statutes) ? statutes : [];
  const matches = entries.filter(
    (entry) => isStatuteEntry(entry) && entryIdentifier(entry) === wanted,
  );

  if (matches.length === 0) {
    return {
      ok: false,
      reason: `unknown statute id ${safeLabel(wanted)}; it is not in the statute table`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `statute id ${safeLabel(wanted)} is ambiguous: the statute table holds ${matches.length} entries for it`,
    };
  }

  const entry = matches[0] as StatuteEntry;
  if (entry.confirmed !== true) {
    return {
      ok: false,
      reason: `statute id ${safeLabel(wanted)} is unconfirmed; a human has not opened the source`,
    };
  }

  // Every field from the entry. Nothing from the caller.
  return {
    ok: true,
    statute: {
      id: entryIdentifier(entry),
      old: entry.old,
      new_range: entry.new_range,
      title: entry.title,
      source_url: entry.source_url,
      checked_date: entry.checked_date,
    },
  };
}

// ------------------------------------------------------------------ gate

/** The one reason the prose backstop can give. */
export const PROSE_LAW_REASON = "law assertion in prose; law must be passed as statute_id";

/**
 * The prose backstop. Prose is explanation; law travels as a statute id.
 *
 * `statutes` is part of the frozen VerifierModule signature and is no longer
 * consulted here: nothing on the prose path can be rescued by the table, since
 * a law assertion in prose is wrong even when it happens to be true. Statute
 * lookups go through `resolveStatuteId`.
 */
export function verifyEvent(event: AgentEvent, statutes: StatuteEntry[]): VerifyResult {
  void statutes;
  const text = typeof event?.text === "string" ? event.text : "";

  // point_to / highlight / mark_item carry no prose, and a draft_field or
  // add_note without text asserts nothing. Nothing to check.
  if (text.trim() === "") return { ok: true, event };

  if (looksLikeLawClaim(text)) return { ok: false, reason: PROSE_LAW_REASON };

  return { ok: true, event };
}

/** The frozen `VerifierModule` surface, so tsc checks the shape for us. */
export const verifier: VerifierModule = {
  verifyEvent,
  looksLikeLawClaim,
  loadStatuteTable,
  resolveStatuteId,
};

export default verifier;
