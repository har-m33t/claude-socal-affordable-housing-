// Text helpers for local answer retrieval: normalize, tokenize, expand synonyms,
// and cut a verbatim quote. Pure and dependency-free so the tests run in node.

/** Words that carry no meaning for matching a question to a checklist line. */
const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing done for from get got had has have how i if in into is it " +
    "its me my need needs of on or our please should so tell that the their them then there these they this those to was " +
    "we were what when where which who whom why will with would you your about any anything mean means more much"
  ).split(" "),
);

/**
 * Multi-word phrases rewritten before tokenizing, so the homeowner's words reach
 * the checklist's words. Only ever adds checklist vocabulary; never adds facts.
 */
const PHRASES: Array<[RegExp, string]> = [
  [/\belectric(?:al|ity)? meters?\b/g, "meter spot report"],
  [/\bpower meters?\b/g, "meter spot report"],
  [/\bimpact fees?\b/g, "fee"],
  [/\bstreet address(?:es)?\b/g, "address"],
  [/\bhouse numbers?\b/g, "address"],
];

/** Single-word synonyms: each word also counts as the listed checklist words. */
const SYNONYMS: Record<string, string[]> = {
  sewage: ["sewer"],
  septic: ["sewer"],
  electric: ["meter"],
  electricity: ["meter"],
  electrical: ["meter"],
  deed: ["deed", "grant"],
  ownership: ["owner", "title", "deed"],
  covenant: ["covenant", "occupancy"],
  fee: ["fee", "payment"],
  fees: ["fee", "payment"],
  cost: ["fee", "payment"],
  costs: ["fee", "payment"],
  sign: ["sign", "signature"],
  signature: ["sign", "signature"],
  signed: ["sign", "signature"],
  addresses: ["address"],
  jadu: ["jadu", "junior"],
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude singular form: "reports" -> "report", "fees" -> "fee". Enough for checklist words. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Tokens of a document text (no synonyms: the document's own words). */
export function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/** Tokens of a question: phrases rewritten, stopwords dropped, synonyms added. Deduped. */
/**
 * The question as concepts: one group per meaningful word, holding its stem and its
 * synonyms' stems ("sewage" → ["sewag", "sewer"]). A concept is covered when any member
 * matches, so a synonym never counts against coverage.
 */
export function questionConcepts(q: string): string[][] {
  let s = normalize(q);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const groups = new Map<string, Set<string>>();
  for (const w of s.split(" ")) {
    if (w.length <= 1 || STOPWORDS.has(w)) continue;
    const key = stem(w);
    const g = groups.get(key) ?? new Set([key]);
    for (const syn of SYNONYMS[w] ?? []) g.add(stem(syn));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => [...g]);
}

export function questionTokens(q: string): string[] {
  return [...new Set(questionConcepts(q).flat())];
}

/** "What is this step?", "why?", "explain this": questions about whatever the plan pointer is on. */
export function isDeictic(q: string): boolean {
  const s = normalize(q);
  if (/\b(this|that|current) (step|item|one|line|part|requirement|box|thing)\b/.test(s)) return true;
  if (/\b(here|this|that|it)\b/.test(s) && questionTokens(q).filter((t) => !DEICTIC_FILLER.has(t)).length === 0) return true;
  return /^(why|how come|explain|what now)$/.test(s);
}
const DEICTIC_FILLER = new Set(["here", "explain", "step", "item", "mean", "required", "require", "important", "matter"]);

/**
 * The first one or two sentences of a verbatim text, as an exact substring
 * (a leading list number like "2. " is dropped; nothing is reworded).
 * Long results are cut at a word boundary and end with "…".
 */
export function verbatimQuote(text: string, maxChars = 280): string {
  const body = text.replace(/^\s*\d+\.\s+/, "").trim();
  // A sentence ends at . ! or ? followed by a space and an uppercase letter, digit or bullet.
  const ends: number[] = [];
  const re = /[.!?](?=\s+[A-Z0-9•])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && ends.length < 2) ends.push(m.index + 1);
  // Fewer than two boundaries means the whole text is at most two sentences.
  let quote = ends.length === 2 ? body.slice(0, ends[1]) : body;
  if (quote.length > maxChars && ends[0] && ends[0] <= maxChars) quote = body.slice(0, ends[0]);
  if (quote.length > maxChars) {
    const cut = quote.slice(0, maxChars);
    quote = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), maxChars - 20)).replace(/[\s,;:]+$/, "")}…`;
  }
  return quote;
}
