// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedactor, redact, TOKEN_PATTERN } from "@/lib/redact";
import {
  APPLICANT_DOCUMENTS,
  KNOWN_NAMES,
  loadApplicantDocument,
  MUST_SURVIVE,
  SENSITIVE_VALUES,
} from "./fixtures/applicant/applicant";

const docs = APPLICANT_DOCUMENTS.map((name) => ({ name, text: loadApplicantDocument(name) }));
const allSensitive = Object.values(SENSITIVE_VALUES).flat();

function redactPacket(options = { knownNames: [...KNOWN_NAMES] }) {
  const session = createRedactor(options);
  return { session, results: docs.map((d) => ({ ...d, ...session.redact(d.text) })) };
}

describe("made-up applicant packet", () => {
  it("uses fixtures that actually contain every sensitive value and every must-survive string", () => {
    const packet = docs.map((d) => d.text).join("\n").toLowerCase();
    for (const v of allSensitive) expect(packet, v).toContain(v.toLowerCase());
    for (const s of MUST_SURVIVE) expect(packet, s).toContain(s.toLowerCase());
  });

  for (const withKnownNames of [true, false]) {
    it(`removes every sensitive value (${withKnownNames ? "with" : "without"} known names)`, () => {
      const { results } = redactPacket({ knownNames: withKnownNames ? [...KNOWN_NAMES] : [] });
      for (const r of results) {
        const lower = r.text.toLowerCase();
        for (const v of allSensitive) expect(lower, `${v} leaked in ${r.name}`).not.toContain(v.toLowerCase());
        // No run of 7+ digits from a phone number or APN survives in any punctuation.
        expect(r.text.replace(/\D/g, ""), r.name).not.toMatch(/5550(1[0-9]{2})|99999999/);
      }
    });
  }

  it("leaves every must-survive string unchanged", () => {
    const { results } = redactPacket();
    const out = results.map((r) => r.text).join("\n");
    for (const s of MUST_SURVIVE) expect(out, s).toContain(s);
  });

  it("gives the same value the same token across documents in one session", () => {
    const { results } = redactPacket();
    const tokensFor = (doc: string, kind: string) =>
      new Set(results.find((r) => r.name === doc)!.spans.filter((s) => s.kind === kind).map((s) => s.token));
    expect(results[0]!.text).toContain("Property Owner: [NAME_1]");
    // Maria Ejemplo is [NAME_1] in every document, including "MARIA  EJEMPLO".
    for (const r of results) expect(r.text).toContain("[NAME_1]");
    expect(results[2]!.text).toContain("Owner contact: [NAME_1], [PHONE_1]");
    // APN 999-999-99 and the labelled 99999999 are the same parcel.
    expect(tokensFor("owner-info-sheet.txt", "APN")).toEqual(tokensFor("cover-letter.txt", "APN"));
    expect(tokensFor("cover-letter.txt", "APN")).toEqual(new Set(["[APN_1]"]));
    // (714) 555-0142 and 714-555-0142 are the same phone.
    expect(results[1]!.text).toContain("Mrs. [NAME_3] at [PHONE_1]");
    // The email is one token in the sheet and the letter.
    expect(results[0]!.text).toContain("Email: [EMAIL_1]");
    expect(results[1]!.text).toContain("<[EMAIL_1]>");
  });

  it("restore() round-trips each document exactly", () => {
    // One session per document: within a document each value has one spelling.
    for (const d of docs.filter((x) => x.name !== "site-plan-notes.txt")) {
      const session = createRedactor({ knownNames: [...KNOWN_NAMES] });
      const { text } = session.redact(d.text);
      expect(session.restore(text), d.name).toBe(d.text);
    }
  });

  it("restore() of a whole packet returns each value in the first spelling seen", () => {
    const { session, results } = redactPacket();
    for (const r of results) {
      const expected = r.spans.reduceRight(
        (acc, s) => acc.slice(0, s.start) + session.restore(s.token) + acc.slice(s.end),
        docs.find((d) => d.name === r.name)!.text,
      );
      expect(session.restore(r.text)).toBe(expected);
    }
    // The site plan wrote "MARIA  EJEMPLO"; a draft gets the first spelling back.
    expect(session.restore("[NAME_1]")).toBe("Maria Ejemplo");
  });

  it("restores tokens inside a new draft and leaves unknown tokens alone", () => {
    const { session } = redactPacket();
    const draft = "Owner [NAME_1] ([EMAIL_1], [PHONE_1]) owns APN [APN_1]. See [NAME_99].";
    expect(session.restore(draft)).toBe(
      "Owner Maria Ejemplo (maria.ejemplo@example.com, (714) 555-0142) owns APN 999-999-99. See [NAME_99].",
    );
  });

  it("reports counts of distinct values per kind and forgets them on clear()", () => {
    const { session } = redactPacket();
    expect(session.counts.EMAIL).toBe(2);
    expect(session.counts.APN).toBe(1);
    expect(session.counts.PHONE).toBe(3);
    expect(session.counts.NAME).toBeGreaterThanOrEqual(4);
    expect(Object.isFrozen(session.counts)).toBe(true);
    session.clear();
    expect(session.counts).toEqual({ NAME: 0, ADDRESS: 0, PHONE: 0, EMAIL: 0, APN: 0 });
    expect(session.restore("[NAME_1]")).toBe("[NAME_1]");
  });

  it("spans point at the original value and at the token in the output", () => {
    const { results } = redactPacket();
    for (const r of results) {
      const original = docs.find((d) => d.name === r.name)!.text;
      for (const s of r.spans) {
        expect(r.text.slice(s.redactedStart, s.redactedEnd)).toBe(s.token);
        expect(original.slice(s.start, s.end).length).toBeGreaterThan(0);
      }
      // Every token in the output has a span, and nothing else looks like a token.
      expect([...r.text.matchAll(TOKEN_PATTERN)].length).toBe(r.spans.length);
    }
  });
});

describe("edge cases", () => {
  const r = (text: string, knownNames: string[] = []) => redact(text, { knownNames }).text;

  it("tells APNs from phone numbers", () => {
    expect(r("APN 999-999-99, call 714-555-0123")).toBe("APN [APN_1], call [PHONE_1]");
    expect(r("Parcel No. 99999999")).toBe("Parcel No. [APN_1]");
    // 8 digits without a label are not an APN.
    expect(r("Invoice 12345678")).toBe("Invoice 12345678");
    // A phone is never cut into an APN plus leftovers.
    expect(r("Cell 714-555-0123")).toBe("Cell [PHONE_1]");
  });

  it("catches every common US phone format", () => {
    for (const p of [
      "(714) 555-0123",
      "714-555-0123",
      "714.555.0123",
      "+1 714 555 0123",
      "1-714-555-0123",
      "714-555-0123 ext. 45",
      "(714) 555-0123 x45",
    ]) {
      expect(r(`Call ${p} today`), p).toBe("Call [PHONE_1] today");
    }
    expect(r("Phone: 7145550123")).toBe("Phone: [PHONE_1]");
  });

  it("does not touch statute numbers, dates, money or permit numbers", () => {
    for (const s of [
      "Gov. Code 65852.2",
      "Gov. Code § 66314",
      "Government Code sections 66310 to 66342",
      "Effective 2025-01-01 and 01/01/2025",
      "Fee estimate $1,234.56",
      "Permit BLD-2026-00123",
      "Permit No. 2026-001234",
      "Section 66314(d)(2)",
      "4 ft. side and rear setbacks, 16 ft height, 850 sq ft",
      "Checklist item 3: Site plan showing setbacks",
    ]) {
      expect(r(s), s).toBe(s);
    }
  });

  it("does not redact agencies, places or form titles", () => {
    for (const s of [
      "City of Anaheim Planning and Building Department",
      "Orange County",
      "HCD ADU Handbook",
      "To: City of Anaheim Planning Division",
      "Contact: City of Anaheim Building Division",
      "Santa Ana College and San Jose State",
      "Dear Planning Staff,",
      "Owner/Applicant: Same as above",
      "ADU APPLICATION - OWNER INFORMATION SHEET",
    ]) {
      expect(r(s), s).toBe(s);
    }
  });

  it("keeps an email whole even when it contains a known name", () => {
    const out = redact("Write to maria.ejemplo@example.com or Maria Ejemplo directly", {
      knownNames: ["Maria Ejemplo"],
    });
    expect(out.text).toBe("Write to [EMAIL_1] or [NAME_1] directly");
    expect(out.spans.map((s) => s.kind)).toEqual(["EMAIL", "NAME"]);
  });

  it("resolves overlapping matches longest-first", () => {
    // The address contains a name-like word and an honorific-like suffix.
    expect(r("Mail to 12 Daniel Testwood Dr., Anaheim, CA 92800 please")).toBe("Mail to [ADDRESS_1] please");
    // An address label line wins over the plain street match inside it.
    expect(r("Site Address: 1234 Example Lane, Unit B, Anaheim, CA 92800")).toBe("Site Address: [ADDRESS_1]");
    // A labelled APN inside an address-like line stays its own token.
    expect(r("Address: 1234 Example Lane  APN: 999-999-99")).toBe("Address: [ADDRESS_1]  APN: [APN_1]");
  });

  it("matches known names regardless of case and spacing", () => {
    const session = createRedactor({ knownNames: ["Maria  Ejemplo"] });
    const a = session.redact("MARIA EJEMPLO").text;
    const b = session.redact("maria   ejemplo").text;
    const c = session.redact("Maria\nEjemplo").text;
    expect([a, b, c]).toEqual(["[NAME_1]", "[NAME_1]", "[NAME_1]"]);
  });

  it("finds names from labels, honorifics, greetings, sign-offs and common first names", () => {
    expect(r("Applicant Name: Tran Thi Example")).toBe("Applicant Name: [NAME_1]");
    expect(r("Owner: Maria Ejemplo   Date: 2026-03-03")).toBe("Owner: [NAME_1]   Date: 2026-03-03");
    expect(r("Prepared by Kenji Ejemplo-Sample")).toBe("Prepared by [NAME_1]");
    expect(r("Please ask Sra. Ejemplo first")).toBe("Please ask Sra. [NAME_1] first");
    expect(r("Hi Okonkwo,\nthanks")).toBe("Hi [NAME_1],\nthanks");
    expect(r("Regards,\nOkonkwo Example")).toBe("Regards,\n[NAME_1]");
    expect(r("I met Daniel Testwood on site")).toBe("I met [NAME_1] on site");
    expect(r("Maria de la Cruz signed")).toBe("[NAME_1] signed");
  });

  it("learns a name once found and catches later bare mentions", () => {
    const session = createRedactor();
    session.redact("Property Owner: Kenji Ejemplo");
    expect(session.redact("Ejemplo will call. Kenji agrees.").text).toBe("[NAME_2] will call. [NAME_3] agrees.");
  });

  it("finds street addresses in common shapes", () => {
    for (const a of [
      "1234 Example Lane",
      "1234 N. Example Ave., Apt 5",
      "1234 Example Blvd #12, Anaheim, CA 92800",
      "1234 EXAMPLE LN",
      "77 West 5th St",
      "P.O. Box 0101",
    ]) {
      expect(r(`Mail: ${a} today`), a).toBe("Mail: [ADDRESS_1] today");
    }
    expect(r("Home: 1234 Example Lane\nAnaheim, CA 92800\nThanks")).toBe("Home: [ADDRESS_1]\nThanks");
    // Without a suffix an address is only caught after an Address label.
    expect(r("Property Address: 1234 Example")).toBe("Property Address: [ADDRESS_1]");
  });

  it("does not let a document fake a token into a different value", () => {
    // A literal token in the source is left as-is; it only restores to what this session mapped.
    const session = createRedactor();
    const { text } = session.redact("Note [EMAIL_7] and a@example.com");
    expect(text).toBe("Note [EMAIL_7] and [EMAIL_1]");
    expect(session.restore(text)).toBe("Note [EMAIL_7] and a@example.com");
  });
});

describe("privacy of the token map", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a full redact + restore never touches network, storage, cookies or the console", () => {
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    const wsSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", wsSpy);
    vi.stubGlobal("EventSource", vi.fn());
    Object.defineProperty(navigator, "sendBeacon", { value: beaconSpy, configurable: true });
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, "open");
    const storage = [
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
      vi.spyOn(Storage.prototype, "key"),
    ];
    const cookieSet = vi.fn();
    const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: cookieSet,
    });
    const idbOpen = vi.fn();
    vi.stubGlobal("indexedDB", { open: idbOpen });
    const consoleSpies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) =>
      vi.spyOn(console, m),
    );

    try {
      const { session, results } = redactPacket();
      for (const r of results) session.restore(r.text);
      session.restore("[NAME_1] at [ADDRESS_1]");
      void session.counts;
      session.clear();
    } finally {
      Object.defineProperty(document, "cookie", cookieDesc);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    for (const s of storage) expect(s).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("lib/redact source uses no network, storage, logging or Node-only APIs", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../lib/redact");
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const forbidden =
      /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches|console)\b|document\.cookie|from\s+["'](node:|fs|path|crypto|child_process|http|https|net)["']|require\(/;
    for (const f of files) {
      const code = readFileSync(join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code.match(forbidden)?.[0], f).toBeUndefined();
    }
  });
});
