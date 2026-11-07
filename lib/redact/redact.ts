/**
 * In-browser redaction for Pointer.
 *
 * Replaces personal details in document text with tokens such as `[NAME_1]`,
 * `[ADDRESS_1]`, `[PHONE_1]`, `[EMAIL_1]` and `[APN_1]` before anything is
 * sent to the server. The token map (token -> real value) lives only in the
 * closure of a `createRedactor()` session: it is never stored, sent or logged.
 * Drafts that come back are filled in locally with `restore()`.
 *
 * This file must stay browser-safe: no Node-only imports, no network, no
 * storage, no console output.
 *
 * What it catches
 * - Names the homeowner typed in (`knownNames`), in any case or spacing.
 * - Names after a label (Owner:, Applicant:, Name:, Signature:, Contact:,
 *   Prepared by, From:, Dear ..., a sign-off line), after an honorific
 *   (Mr., Ms., Mrs., Dr., Sr., Sra.) or starting with a common first name.
 *   Once a name is found it is remembered for the rest of the session, as is
 *   its surname, so later bare mentions are caught too.
 * - Street addresses with a house number and street suffix, optional unit and
 *   ", City, CA 92xxx" (also on the next line); "Address:" lines starting with
 *   a number; PO boxes.
 * - US phone numbers (10 digits, common punctuation, +1, extensions).
 * - Email addresses.
 * - Orange County APNs (###-###-##; 8 digits only when labelled).
 *
 * What it does NOT catch (best-effort, regex and dictionary only)
 * - Names with no label, honorific, known-name entry or common first name,
 *   e.g. "talked to Okonkwo yesterday" or a lowercase "maria ejemplo".
 * - Addresses without a house number or street suffix ("the house on Example"),
 *   or written out ("twelve thirty-four Example Lane").
 * - 7-digit phone numbers without an area code, and international numbers.
 * - Other identifiers: dates of birth, license or SSN numbers, bank details,
 *   signatures in images, anything inside scanned images without a text layer.
 * It can also over-redact: any ###-###-## number is treated as an APN.
 */

export type RedactionKind = "NAME" | "ADDRESS" | "PHONE" | "EMAIL" | "APN";

export const REDACTION_KINDS: readonly RedactionKind[] = Object.freeze([
  "NAME",
  "ADDRESS",
  "PHONE",
  "EMAIL",
  "APN",
]);

/** Matches one token, e.g. `[NAME_1]`. Global: reset `lastIndex` or use `matchAll`. */
export const TOKEN_PATTERN = /\[(NAME|ADDRESS|PHONE|EMAIL|APN)_(\d{1,6})\]/g;

export interface RedactionSpan {
  kind: RedactionKind;
  token: string;
  /** Offsets of the replaced value in the original text. */
  start: number;
  end: number;
  /** Offsets of the token in the redacted text. */
  redactedStart: number;
  redactedEnd: number;
}

export interface RedactionResult {
  text: string;
  spans: RedactionSpan[];
}

export interface RedactorOptions {
  /** Names the homeowner typed in (owner, co-owner, contractor). Strongest signal. */
  knownNames?: readonly string[];
}

export interface Redactor {
  /** Replace personal details with tokens. Same value -> same token for the whole session. */
  redact(text: string): RedactionResult;
  /**
   * Put real values back in place of tokens. Unknown tokens are left as they are.
   * When one value appeared in several spellings ("MARIA  LOPEZ", "Maria Lopez"),
   * the token restores to the first spelling seen.
   */
  restore(text: string): string;
  /** Number of distinct values hidden so far, per kind. */
  readonly counts: Readonly<Record<RedactionKind, number>>;
  /** Add names to the dictionary mid-session (e.g. after the homeowner fills a form). */
  addKnownNames(names: readonly string[]): void;
  /** Forget every token and learned name. Call when the homeowner starts over. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that are never part of a person's name in this domain (lowercase). */
const NOT_NAME_WORDS = new Set(
  (
    "city county state department dept planning building buildings division office agency commission " +
    "council board bureau anaheim orange california irvine fullerton santa los angeles huntington beach " +
    "costa mesa newport tustin buena park cypress placentia brea yorba garden grove westminster " +
    "hcd housing community development government gov code codes section sections statute law laws " +
    "adu adus jadu accessory dwelling unit units permit permits application applications checklist form " +
    "forms plan plans site floor elevation elevations handbook program inc llc corp co company " +
    "construction builders services group associates design architects engineering center public works " +
    "fire utilities utility water power edison gas bank trust the and of for street st lane ln avenue " +
    "ave road rd drive way court ct boulevard blvd place circle terrace parkway highway january february " +
    "march april may june july august september october november december monday tuesday wednesday " +
    "thursday friday saturday sunday same see none applicant owner owners property contractor engineer " +
    "architect signature date phone email address name total fee fees item items page yes no not " +
    "required notes note attached pending approved submitted review structural title report sincerely " +
    "regards dear thank thanks hello hi team staff prototype claude pointer apn parcel number tel cell " +
    "mobile fax license lic cslb sq ft square feet detached attached garage conversion zoning zone " +
    "setback setbacks utility sewer septic electrical plumbing mechanical energy title24 calgreen " +
    "residential single family multifamily department's county's city's ca usa us"
  ).split(/\s+/),
);

/** Words that, right before a first name, mean it is a place ("Santa Ana", "San Jose"). */
const PLACE_PREFIX = /(?:^|[^\p{L}])(?:Santa|San|Los|Las|El|St\.?|Saint|Mount|Mt\.?|Lake|Port|Fort|Ft\.?)[ \t]+$/u;

/** A modest list of common given names, avoiding ones that are also everyday words. */
const FIRST_NAMES = (
  "James John Robert Michael William David Richard Joseph Thomas Charles Christopher Daniel Matthew " +
  "Anthony Steven Paul Andrew Joshua Kevin Brian George Edward Ronald Timothy Jason Jeffrey Ryan Jacob " +
  "Gary Nicholas Eric Jonathan Stephen Larry Justin Scott Brandon Benjamin Samuel Gregory Alexander " +
  "Patrick Dennis Jerry Tyler Aaron Jose Adam Nathan Henry Douglas Peter Kyle Noah Ethan Jeremy " +
  "Christian Walter Keith Roger Sean Gerald Carl Harold Dylan Arthur Lawrence Jesse Bryan Bruce Gabriel " +
  "Logan Albert Alan Juan Wayne Elijah Randy Vincent Ralph Eugene Russell Mason Philip Louis " +
  "Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra " +
  "Margaret Ashley Kimberly Emily Donna Michelle Carol Amanda Melissa Deborah Stephanie Rebecca Sharon " +
  "Laura Cynthia Dorothy Amy Kathleen Angela Shirley Brenda Emma Anna Pamela Nicole Samantha Katherine " +
  "Christine Helen Debra Rachel Carolyn Janet Maria Catherine Heather Diane Olivia Julie Joyce Victoria " +
  "Ruth Virginia Lauren Kelly Christina Joan Evelyn Judith Andrea Hannah Megan Cheryl Jacqueline Martha " +
  "Madison Teresa Gloria Sara Janice Kathryn Abigail Sophia Frances Alice Judy Isabella Julia Beverly " +
  "Denise Marilyn Amber Danielle Brittany Diana Natalie " +
  "Jorge Luis Carlos Miguel Jesus Alejandro Francisco Antonio Manuel Pedro Ricardo Fernando Javier " +
  "Roberto Eduardo Rafael Sergio Raul Arturo Oscar Enrique Alberto Mario Hector Ramon Guadalupe Rosa " +
  "Ana Carmen Lucia Sofia Valentina Camila Gabriela Alejandra Daniela Mariana Fernanda Veronica Adriana " +
  "Leticia Yolanda Silvia Elena Isabel Beatriz Graciela Josefina Marisol Ximena Paola " +
  "Minh Linh Anh Thanh Tuan Hung Huong Duc Quang Phuong Trang Hieu Khanh Thuy Ngoc " +
  "Jiwoo Minjun Seojun Jisoo Hyejin Eunji Sungmin Jihoon " +
  "Mohammed Muhammad Ahmed Omar Fatima Aisha Priya Arjun Wei Ming Mei Hiroshi Yuki Kenji"
).split(/\s+/);

const STREET_SUFFIXES =
  "Street St Avenue Ave Av Boulevard Blvd Drive Dr Lane Ln Way Court Ct Place Pl Road Rd Circle Cir " +
  "Terrace Ter Parkway Pkwy Highway Hwy Trail Trl Square Sq Plaza Plz Loop Alley Aly Crescent Cres " +
  "Row Walk Path Pike Expressway Expy Freeway Fwy";

// ---------------------------------------------------------------------------
// Pattern building blocks
// ---------------------------------------------------------------------------

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Prepared by" -> Prepared by | PREPARED BY | prepared by. Keeps `\p{Lu}` meaningful (no `i` flag). */
function caseVariants(words: string, withLower: boolean): string[] {
  const title = words.replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
  const forms = [words, title, words.toUpperCase()];
  if (withLower) forms.push(words.toLowerCase());
  return [...new Set(forms)];
}
const alt = (items: string[], withLower = true): string =>
  items
    .flatMap((w) => caseVariants(w, withLower))
    .sort((a, b) => b.length - a.length)
    .map((s) => escapeRe(s).replace(/ /g, "[ \\t]+"))
    .join("|");

const NAME_WORD = "\\p{Lu}[\\p{L}\\p{M}]*(?:['’-]\\p{L}[\\p{L}\\p{M}]*)*";
const INITIAL = "\\p{Lu}\\.";
const PARTICLE = "(?:de la|de los|del|de|la|las|van der|van|von|da|das|do|dos|du|le|bin|al)";
const nameSeq = (max: number): string =>
  `(?:${NAME_WORD}|${INITIAL})(?:[ \\t]+(?:${PARTICLE}[ \\t]+)?(?:${NAME_WORD}|${INITIAL})){0,${max - 1}}`;
const NOT_AFTER_LETTER = "(?<![\\p{L}\\p{N}_])";

const HONORIFICS = alt(["Mr", "Ms", "Mrs", "Mx", "Dr", "Sr", "Sra", "Srta", "Miss", "Señor", "Señora"]);

const COLON_LABELS = alt([
  "Name", "Full Name", "Printed Name", "Print Name", "Owner", "Owner Name", "Owner's Name",
  "Owners", "Property Owner", "Property Owner Name", "Property Owner's Name", "Homeowner",
  "Applicant", "Applicant Name", "Applicant's Name", "Owner/Applicant", "Applicant/Owner",
  "Contact", "Contact Name", "Contact Person", "Signature", "Signed", "Attn", "Attention",
  "From", "To", "Cc", "Representative", "Agent", "Engineer", "Architect", "Designer",
  "Nombre", "Propietario", "Propietaria", "Solicitante", "Firma",
]);
const BY_LABELS = alt(["Prepared by", "Submitted by", "Signed by", "Drawn by", "Preparado por"]);
const GREETINGS = alt(["Dear", "Hi", "Hello", "Hola", "Estimada", "Estimado", "Querida", "Querido"]);
const SIGN_OFFS = alt([
  "Sincerely", "Regards", "Best regards", "Kind regards", "Warm regards", "Respectfully",
  "Thank you", "Thanks", "Best", "Cordially", "Atentamente", "Saludos", "Gracias",
]);

const NAME_PATTERNS: { re: RegExp; minWords: number }[] = [
  {
    re: new RegExp(`${NOT_AFTER_LETTER}(?:${COLON_LABELS})[ \\t]*[:：][ \\t]*(${nameSeq(4)})`, "dgu"),
    minWords: 2,
  },
  {
    re: new RegExp(`${NOT_AFTER_LETTER}(?:${BY_LABELS})[ \\t]*:?[ \\t]*(${nameSeq(4)})`, "dgu"),
    minWords: 2,
  },
  {
    re: new RegExp(`${NOT_AFTER_LETTER}(?:${HONORIFICS})\\.?[ \\t]+(${nameSeq(3)})`, "dgu"),
    minWords: 1,
  },
  {
    re: new RegExp(
      `${NOT_AFTER_LETTER}(?:${GREETINGS})[ \\t]+(?:(?:${HONORIFICS})\\.?[ \\t]+)?(${nameSeq(3)})[ \\t]*[,:!]`,
      "dgu",
    ),
    minWords: 1,
  },
  {
    re: new RegExp(
      `${NOT_AFTER_LETTER}(?:${SIGN_OFFS})[ \\t]*[,.!]?[ \\t]*\\r?\\n[ \\t]*(${nameSeq(4)})`,
      "dgu",
    ),
    minWords: 1,
  },
  {
    // A common first name followed by a capitalised surname, on one line.
    re: new RegExp(
      `${NOT_AFTER_LETTER}((?:${alt(FIRST_NAMES, false)})(?:[ \\t]+${INITIAL})?[ \\t]+(?:${PARTICLE}[ \\t]+)?${NAME_WORD}(?:[ \\t]+${NAME_WORD})?)(?![\\p{L}])`,
      "dgu",
    ),
    minWords: 2,
  },
];

const EMAIL_RE = /(?<![\p{L}\p{N}._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\p{L}\p{N}-])/gu;

const PHONE_RE =
  /(?<![\p{L}\p{N}+.\-/])(?:\+?1[ \t.-]?)?(?:\(\d{3}\)[ \t]?|\d{3}[ \t.-])\d{3}[ \t.-]\d{4}(?![\d-])(?:[ \t]*,?[ \t]*(?:ext\.?|x|extension|EXT\.?|Ext\.?|X)[ \t]*\d{1,6}(?!\d))?/gu;
const PHONE_LABELLED_RE =
  /(?<![\p{L}])(?:phone|tel|telephone|cell|mobile|fax|tel[ée]fono)\.?[ \t]*(?:no\.?|number|#)?[ \t]*[:#]?[ \t]*(\d{10})(?!\d)/dgiu;

const APN_RE = /(?<![\p{L}\p{N}.\-/$])\d{3}-\d{3}-\d{2}(?![\p{L}\p{N}]|[-.]\d)/gu;
const APN_LABELLED_RE =
  /(?<![\p{L}])(?:apn|a\.p\.n\.|assessor'?s?[ \t]+parcel[ \t]+(?:no\.?|number|#)|parcel[ \t]+(?:no\.?|number|#|id))[ \t]*[:#]?[ \t]*(\d{3}[- ]\d{3}[- ]\d{2}|\d{8})(?![\p{N}]|-\d)/dgiu;

const STREET_WORD = "(?:\\p{Lu}[\\p{L}'’.-]*|\\d+(?:st|nd|rd|th))";
const SUFFIX = alt(STREET_SUFFIXES.split(" "));
const DIRECTION = "(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|NORTH|SOUTH|EAST|WEST)";
const UNIT = alt(["Apt", "Apartment", "Unit", "Ste", "Suite", "Spc", "Space", "Bldg"]);
const CITY = "\\p{Lu}[\\p{L}'’.-]*(?:[ \\t]+\\p{Lu}[\\p{L}'’.-]*){0,3}";
const LOCALITY =
  `(?:(?:[ \\t]*,[ \\t]*|[ \\t]*\\r?\\n[ \\t]*|[ \\t]+)${CITY}[ \\t]*,?[ \\t]*` +
  `(?:CA|Calif\\.|California)(?:[ \\t]+\\d{5}(?:-\\d{4})?)?(?![\\p{L}\\p{N}]))`;
const ADDRESS_RE = new RegExp(
  `(?<![\\p{L}\\p{N}$.,/#\\-])\\d{1,6}[ \\t]+(?:${DIRECTION}\\.?[ \\t]+)?(?:${STREET_WORD}[ \\t]+){1,4}` +
    `(?:${SUFFIX})\\.?(?![\\p{L}\\p{N}])` +
    `(?:[ \\t]+${DIRECTION}\\.?(?![\\p{L}\\p{N}]))?` +
    `(?:[ \\t]*,?[ \\t]*(?:#|(?:${UNIT})\\.?)[ \\t]*[A-Za-z0-9-]{1,6}(?![\\p{L}\\p{N}]))?` +
    `${LOCALITY}?`,
  "gu",
);
const PO_BOX_RE = new RegExp(
  `${NOT_AFTER_LETTER}(?:P\\.?[ \\t]*O\\.?|Post[ \\t]+Office)[ \\t]*Box[ \\t]+\\d{1,6}${LOCALITY}?`,
  "giu",
);
const ADDRESS_LABELLED_RE =
  /(?<![\p{L}])(?:(?:property|site|project|mailing|street|home|job|physical)[ \t]+)?(?:address|direcci[oó]n)[ \t]*[:：][ \t]*(\d[^\n\r\t;|]*?)(?=[ \t]{2,}|[\t\r\n;|]|$)/dgiu;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface Candidate {
  kind: RedactionKind;
  start: number;
  end: number;
}

const PRIORITY: Record<RedactionKind, number> = { EMAIL: 0, APN: 1, PHONE: 2, ADDRESS: 3, NAME: 4 };

/** Find matches; if the pattern has a capture group, the group is the redacted value. */
function scan(re: RegExp, text: string, kind: RedactionKind, out: Candidate[]): void {
  for (const m of text.matchAll(re)) {
    const group = m.indices?.[1];
    const value = m[1] ?? m[0];
    const start = group ? group[0] : m.index;
    const trimmed = value.replace(/[\s,.;:]+$/u, "");
    if (trimmed.length > 0) out.push({ kind, start, end: start + trimmed.length });
  }
}

const WORD_IN_NAME = new RegExp(`${NAME_WORD}|${INITIAL}|${PARTICLE}`, "gu");

/**
 * Keep the leading run of words that look like a name: stop at the first word
 * that is a known non-name ("Owner: Maria Lopez Date" -> "Maria Lopez").
 */
function trimName(text: string, start: number, end: number, minWords: number): Candidate | null {
  const raw = text.slice(start, end);
  let words = 0;
  let lastEnd = 0;
  for (const w of raw.matchAll(WORD_IN_NAME)) {
    const word = w[0];
    const isParticle = /^\p{Ll}/u.test(word);
    if (!isParticle && NOT_NAME_WORDS.has(word.toLowerCase().replace(/\.$/, ""))) break;
    if (!isParticle) {
      words += 1;
      // "Ejemplo's contractor" -> "Ejemplo"
      lastEnd = w.index + word.length - (/['’]s$/u.test(word) ? 2 : 0);
    }
  }
  if (words < minWords || lastEnd === 0) return null;
  // A lone initial ("J.") is not a name.
  if (words === 1 && /^\p{Lu}\.$/u.test(raw.slice(0, lastEnd))) return null;
  return { kind: "NAME", start, end: start + lastEnd };
}

function detectNames(text: string, out: Candidate[]): void {
  for (const { re, minWords } of NAME_PATTERNS) {
    const found: Candidate[] = [];
    scan(re, text, "NAME", found);
    for (const c of found) {
      if (PLACE_PREFIX.test(text.slice(Math.max(0, c.start - 12), c.start))) continue;
      const t = trimName(text, c.start, c.end, minWords);
      if (t) out.push(t);
    }
  }
}

function detectAll(text: string, dictionary: RegExp | null): Candidate[] {
  const out: Candidate[] = [];
  scan(EMAIL_RE, text, "EMAIL", out);
  scan(APN_LABELLED_RE, text, "APN", out);
  scan(APN_RE, text, "APN", out);
  scan(PHONE_RE, text, "PHONE", out);
  scan(PHONE_LABELLED_RE, text, "PHONE", out);
  scan(ADDRESS_RE, text, "ADDRESS", out);
  scan(PO_BOX_RE, text, "ADDRESS", out);
  scan(ADDRESS_LABELLED_RE, text, "ADDRESS", out);
  detectNames(text, out);
  if (dictionary) {
    for (const m of text.matchAll(dictionary)) {
      const single = !/\s/u.test(m[0]);
      if (single) {
        if (!/^\p{Lu}/u.test(m[0])) continue;
        if (PLACE_PREFIX.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
      }
      out.push({ kind: "NAME", start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/** Longest span wins; ties go to the more specific kind, then the earlier start. */
function resolveOverlaps(candidates: Candidate[], textLength: number): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) || PRIORITY[a.kind] - PRIORITY[b.kind] || a.start - b.start,
  );
  const taken = new Uint8Array(textLength); // 1 = character already inside a kept span
  const kept: Candidate[] = [];
  for (const c of sorted) {
    if (taken.subarray(c.start, c.end).includes(1)) continue;
    taken.fill(1, c.start, c.end);
    kept.push(c);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Normalisation (decides when two spellings are "the same value")
// ---------------------------------------------------------------------------

const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct",
  place: "pl", road: "rd", circle: "cir", terrace: "ter", parkway: "pkwy", highway: "hwy",
  trail: "trl", square: "sq", plaza: "plz", alley: "aly", crescent: "cres", expressway: "expy",
  freeway: "fwy", north: "n", south: "s", east: "e", west: "w", apartment: "apt", suite: "ste",
  space: "spc", california: "ca", calif: "ca",
};

function normalise(kind: RedactionKind, value: string): string {
  const base = value.normalize("NFKC").toLowerCase();
  switch (kind) {
    case "PHONE": {
      const [main = "", ext = ""] = base.split(/\s*,?\s*(?:ext\.?|extension|x)\s*/u);
      const digits = main.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      const extDigits = ext.replace(/\D/g, "");
      return extDigits ? `${digits}x${extDigits}` : digits;
    }
    case "APN":
      return base.replace(/\D/g, "");
    case "EMAIL":
      return base.trim();
    case "ADDRESS":
      return base
        .replace(/[^\p{L}\p{N}#]+/gu, " ")
        .trim()
        .split(" ")
        .map((w) => ADDRESS_ABBREVIATIONS[w] ?? w)
        .join(" ");
    case "NAME":
      return base.replace(/\./g, "").replace(/\s+/gu, " ").trim();
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function createRedactor(options: RedactorOptions = {}): Redactor {
  // All state lives in this closure. Nothing here is exported, stored or sent.
  let byKey = new Map<string, string>(); // `${kind}:${normalised}` -> token
  let byToken = new Map<string, string>(); // token -> first spelling seen
  let next: Record<RedactionKind, number> = { NAME: 0, ADDRESS: 0, PHONE: 0, EMAIL: 0, APN: 0 };
  let names = new Set<string>(); // normalised dictionary entries
  let dictionary: RegExp | null = null;

  function learnName(raw: string): boolean {
    const clean = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const words = clean.split(" ").filter((w) => !/^\p{Lu}\.$/u.test(w) && /\p{L}{2,}/u.test(w));
    // Remember each part on its own too: "Mrs. Lopez", "call Jorge", a bare "Lopez" later on.
    const entries = [clean, ...(words.length >= 2 ? words.filter((w) => w.length >= 3) : [])];
    let grew = false;
    for (const e of entries) {
      const key = normalise("NAME", e);
      if (key.length < 2 || NOT_NAME_WORDS.has(key) || names.has(key)) continue;
      names.add(key);
      grew = true;
    }
    if (grew) dictionary = buildDictionary(names);
    return grew;
  }

  function tokenFor(kind: RedactionKind, value: string): string {
    const key = `${kind}:${normalise(kind, value)}`;
    let token = byKey.get(key);
    if (!token) {
      next[kind] += 1;
      token = `[${kind}_${next[kind]}]`;
      byKey.set(key, token);
      byToken.set(token, value);
    }
    return token;
  }

  for (const n of options.knownNames ?? []) learnName(n);

  function redact(text: string): RedactionResult {
    let found = resolveOverlaps(detectAll(text, dictionary), text.length);
    // Names found by heuristics join the dictionary, so every other mention
    // in this text (and in later documents) is caught too.
    let grew = false;
    for (const c of found) if (c.kind === "NAME") grew = learnName(text.slice(c.start, c.end)) || grew;
    if (grew) found = resolveOverlaps(detectAll(text, dictionary), text.length);

    let out = "";
    let cursor = 0;
    const spans: RedactionSpan[] = [];
    for (const c of found) {
      const token = tokenFor(c.kind, text.slice(c.start, c.end));
      out += text.slice(cursor, c.start);
      spans.push({
        kind: c.kind,
        token,
        start: c.start,
        end: c.end,
        redactedStart: out.length,
        redactedEnd: out.length + token.length,
      });
      out += token;
      cursor = c.end;
    }
    out += text.slice(cursor);
    return { text: out, spans };
  }

  function restore(text: string): string {
    return text.replace(TOKEN_PATTERN, (token) => byToken.get(token) ?? token);
  }

  return {
    redact,
    restore,
    get counts() {
      return Object.freeze({ ...next });
    },
    addKnownNames(list) {
      for (const n of list) learnName(n);
    },
    clear() {
      byKey = new Map();
      byToken = new Map();
      next = { NAME: 0, ADDRESS: 0, PHONE: 0, EMAIL: 0, APN: 0 };
      names = new Set();
      dictionary = null;
      for (const n of options.knownNames ?? []) learnName(n);
    },
  };
}

function buildDictionary(entries: Set<string>): RegExp | null {
  if (entries.size === 0) return null;
  const parts = [...entries]
    .sort((a, b) => b.length - a.length)
    .map((e) =>
      e
        .split(" ")
        .map((w) => escapeRe(w).replace(/^(\p{L})$/u, "$1\\.?"))
        .join("[\\s.]*\\s"),
    );
  return new RegExp(`${NOT_AFTER_LETTER}(?:${parts.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/** One-off redaction with a fresh session. Use `createRedactor()` when you need `restore()`. */
export function redact(text: string, options?: RedactorOptions): RedactionResult {
  return createRedactor(options).redact(text);
}
