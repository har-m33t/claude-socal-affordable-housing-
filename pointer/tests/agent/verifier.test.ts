/**
 * Lane 3 tests: the law-claim verifier, the run recorder and replay mode.
 *
 * No network. The statute map under test is the real `data/statutes.json`, so
 * no statute number, section, range or checked date is invented here: every
 * one is read back out of that file. The two fake citations below are marked
 * fake in place and point at the reserved `.invalid` TLD.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import statutesJson from "../../data/statutes.json";
import type { AgentEvent, Citation, StatuteEntry, StreamFrame } from "../../lib/agent/types";
import { looksLikeLawClaim, verifier, verifyEvent } from "../../lib/agent/verifier";
import { createRecorder } from "../../lib/agent/recorder";
import { DEFAULT_REPLAY_PATH, loadReplay } from "../../lib/agent/replay";

const statutes: StatuteEntry[] = statutesJson;

const foundConfirmed = statutes.find((entry) => entry.confirmed === true);
const foundUnconfirmed = statutes.find((entry) => entry.confirmed === false);
if (!foundConfirmed || !foundUnconfirmed) {
  throw new Error("data/statutes.json must hold one confirmed and one unconfirmed entry for these tests");
}
const confirmedEntry: StatuteEntry = foundConfirmed;
const unconfirmedEntry: StatuteEntry = foundUnconfirmed;

/** A real, human-checked citation, taken straight out of the statute map. */
const goodCitation: Citation = {
  source_url: confirmedEntry.source_url,
  checked_date: confirmedEntry.checked_date,
};

function event(partial: Partial<AgentEvent> = {}): AgentEvent {
  return {
    tool: "add_note",
    item_id: "item-1",
    ts: new Date().toISOString(),
    ...partial,
  };
}

function reasonOf(result: ReturnType<typeof verifyEvent>): string {
  if (result.ok) throw new Error("expected the event to be dropped, but it passed");
  return result.reason;
}

// ------------------------------------------------------------------ shape

describe("VerifierModule shape", () => {
  it("exports the frozen contract surface", () => {
    expect(typeof verifier.verifyEvent).toBe("function");
    expect(typeof verifier.looksLikeLawClaim).toBe("function");
  });
});

// --------------------------------------------------------- pass-through

describe("verifyEvent pass-through", () => {
  it("passes a non-law add_note through unchanged", () => {
    const note = event({ text: "Your packet is missing the title sheet, so I marked that item incomplete." });
    const result = verifyEvent(note, statutes);
    expect(result).toEqual({ ok: true, event: note });
    if (result.ok) expect(result.event).toBe(note);
  });

  it("passes an event with no text through unchanged", () => {
    const pointer = event({ tool: "point_to", item_id: "item-2" });
    const result = verifyEvent(pointer, statutes);
    expect(result).toEqual({ ok: true, event: pointer });
  });

  it("passes an event whose text is only whitespace through unchanged", () => {
    const blank = event({ tool: "draft_field", text: "   " });
    expect(verifyEvent(blank, statutes).ok).toBe(true);
  });
});

// ------------------------------------------------------------- citations

describe("verifyEvent citation path", () => {
  it("passes a law claim carrying a well-formed citation", () => {
    const claim = event({
      text: "State law requires ministerial approval for a qualifying unit.",
      citation: goodCitation,
    });
    const result = verifyEvent(claim, statutes);
    expect(result).toEqual({ ok: true, event: claim });
  });

  it("drops a law claim with no citation at all", () => {
    const claim = event({ text: "State law requires ministerial approval for a qualifying unit." });
    expect(reasonOf(verifyEvent(claim, statutes))).toBe("law claim with no citation");
  });

  it("does not accept a citation with an empty source_url as backing", () => {
    const claim = event({
      text: "State law requires ministerial approval for a qualifying unit.",
      citation: { source_url: "", checked_date: confirmedEntry.checked_date },
    });
    const reason = reasonOf(verifyEvent(claim, statutes));
    expect(reason).toContain("source_url");
    expect(reason).toBe("law claim with an empty citation source_url");
  });

  it("does not accept a citation with a whitespace-only source_url as backing", () => {
    const claim = event({
      text: "The city must approve it ministerially.",
      citation: { source_url: "   ", checked_date: confirmedEntry.checked_date },
    });
    expect(reasonOf(verifyEvent(claim, statutes))).toContain("source_url");
  });

  it("does not accept a citation with a missing checked_date as backing", () => {
    const claim = event({
      text: "The city must approve it ministerially.",
      citation: { source_url: confirmedEntry.source_url, checked_date: "" },
    });
    expect(reasonOf(verifyEvent(claim, statutes))).toContain("checked_date");
  });

  it("does not accept a citation whose checked_date is not an ISO date", () => {
    const claim = event({
      text: "The city must approve it ministerially.",
      // obviously fake, non-ISO date string
      citation: { source_url: confirmedEntry.source_url, checked_date: "sometime last week" },
    });
    expect(reasonOf(verifyEvent(claim, statutes))).toContain("checked_date");
  });

  it("does not accept a citation whose source_url is not a URL", () => {
    const claim = event({
      text: "The city must approve it ministerially.",
      citation: { source_url: "not-a-url", checked_date: confirmedEntry.checked_date },
    });
    expect(reasonOf(verifyEvent(claim, statutes))).toContain("source_url");
  });

  it("checks a citation for form, not for truth (a known limit of this gate)", () => {
    const claim = event({
      text: "The city must approve it ministerially.",
      // FAKE citation: example.invalid is a reserved, unresolvable TLD. The
      // verifier cannot tell a real source from a fabricated one; it only
      // enforces that a source and a check date are present and well formed.
      citation: { source_url: "https://example.invalid/fake-source", checked_date: confirmedEntry.checked_date },
    });
    expect(verifyEvent(claim, statutes).ok).toBe(true);
  });
});

// -------------------------------------------------------------- statutes

describe("verifyEvent statute-map path", () => {
  it("passes a law claim resting on a confirmed statute mapping", () => {
    const claim = event({
      text: `The city handout still cites ${confirmedEntry.old}, which the state renumbered.`,
    });
    const result = verifyEvent(claim, statutes);
    expect(result).toEqual({ ok: true, event: claim });
  });

  it("drops a law claim resting on an unconfirmed statute mapping", () => {
    const claim = event({
      text: `Gov Code ${unconfirmedEntry.old} is the rule that applies to your junior unit.`,
    });
    const reason = reasonOf(verifyEvent(claim, statutes));
    expect(reason).toContain(unconfirmedEntry.old);
    expect(reason).toContain("unconfirmed");
  });

  it("drops a law claim that mentions one confirmed and one unconfirmed statute", () => {
    const claim = event({
      text: `State law requires ministerial approval under ${confirmedEntry.old}, and ${unconfirmedEntry.old} does the same for a junior unit.`,
    });
    const reason = reasonOf(verifyEvent(claim, statutes));
    expect(reason).toContain(unconfirmedEntry.old);
    expect(reason).toContain("unconfirmed");
  });

  it("drops a law claim citing a statute that is not in the map at all", () => {
    // 99999.9 is an obviously fake section number, used only to exercise the
    // unmapped branch. It is not a real California code section.
    const claim = event({ text: "State law requires this under Government Code 99999.9." });
    const reason = reasonOf(verifyEvent(claim, statutes));
    expect(reason).toContain("99999.9");
    expect(reason).toContain("not in the statute map");
  });

  it("drops a bill reference that has no citation, since bills are not in the map", () => {
    const claim = event({ text: "SB 9 lets you split the lot." });
    expect(verifyEvent(claim, statutes).ok).toBe(false);
  });

  it("lets the statute path rescue a claim whose citation is malformed", () => {
    const claim = event({
      text: `The handout still cites ${confirmedEntry.old}; that number was renumbered.`,
      citation: { source_url: "", checked_date: confirmedEntry.checked_date },
    });
    expect(verifyEvent(claim, statutes).ok).toBe(true);
  });

  it("drops every law claim when the statute map is empty", () => {
    const claim = event({ text: `The handout still cites ${confirmedEntry.old}; it was renumbered.` });
    expect(verifyEvent(claim, []).ok).toBe(false);
  });

  it("accepts a new-range section that only a confirmed entry covers", () => {
    // The confirmed entry's own new_range, read out of the data file, not typed in.
    const lowEnd = confirmedEntry.new_range.split("-")[0] as string;
    const claim = event({ text: `State law requires ministerial review under Government Code ${lowEnd}.` });
    expect(verifyEvent(claim, statutes).ok).toBe(true);
  });

  it("drops a section that an unconfirmed entry also claims, even inside a confirmed range", () => {
    // The unconfirmed entry's new_range sits inside the confirmed entry's
    // range. Fail closed: a human has not confirmed that mapping.
    const claim = event({
      text: `State law requires ministerial review under Government Code ${unconfirmedEntry.new_range}.`,
    });
    const reason = reasonOf(verifyEvent(claim, statutes));
    expect(reason).toContain("unconfirmed");
  });

  it("drops a law claim on a draft_field as readily as on an add_note", () => {
    const claim = event({ tool: "draft_field", text: "You are entitled to ministerial approval." });
    expect(verifyEvent(claim, statutes).ok).toBe(false);
  });
});

// ------------------------------------------------------- looksLikeLawClaim

describe("looksLikeLawClaim", () => {
  const mustDetect: Array<[string, string]> = [
    ["Gov Code form", "See Gov Code 65852.2 for the rule."],
    ["Government Code with section symbol", "Government Code § 66314 is the current section."],
    ["GOV shorthand", "GOV 66333 is where it moved."],
    ["bare section number", "65852.22 is the one the handout quotes."],
    ["Government Code Section spelled out", "Government Code Section 66314 applies."],
    ["bill reference SB", "SB 9 changed lot splits."],
    ["bill reference AB", "AB 2221 changed the ADU rules."],
    ["bill reference SB 477", "SB 477 renumbered the chapter."],
    ["state law requires", "State law requires a decision within the statutory window."],
    ["the city must", "The city must act on a complete application."],
    ["you are entitled to", "You are entitled to a second unit on this lot."],
    ["is required by law", "A fire sprinkler is required by law here."],
    ["ministerial approval", "This qualifies for ministerial approval."],
  ];

  for (const [label, text] of mustDetect) {
    it(`detects ${label}`, () => {
      expect(looksLikeLawClaim(text)).toBe(true);
    });
  }

  const mustNotDetect: string[] = [
    "Upload the site plan and the floor plan as two separate PDFs.",
    "Your packet is missing the title sheet, so I marked that item incomplete.",
    "The driveway on the survey measures 18 feet wide.",
    "I filled the owner name and the mailing address into the application form.",
    "Page two of the plan set shows the rear yard and the existing garage.",
  ];

  for (const text of mustNotDetect) {
    it(`does not trip on: ${text}`, () => {
      expect(looksLikeLawClaim(text)).toBe(false);
    });
  }

  it("over-detects a five-digit ZIP code, by design (documented trade-off)", () => {
    // A drafted mailing address carries a five-digit number, which this
    // detector cannot tell from a bare code section. The brief asks for
    // over-detection, so the cost is one dropped draft_field rather than an
    // unbacked statement of law. The loop lane sees the reason and can fall
    // back to drafting the address without the ZIP.
    const address = "Mail the completed form to 1234 Main Street, Anaheim, CA 92805.";
    expect(looksLikeLawClaim(address)).toBe(true);
    const reason = reasonOf(verifyEvent(event({ tool: "draft_field", text: address }), statutes));
    expect(reason).toBe("law claim cites 92805, which is not in the statute map");
  });

  it("returns false for empty and whitespace text", () => {
    expect(looksLikeLawClaim("")).toBe(false);
    expect(looksLikeLawClaim("   \n ")).toBe(false);
  });
});

// ------------------------------------------------- obfuscation + backing

/**
 * Regression tests for two detector bypasses.
 *
 * Untrusted city PDFs and uploaded packets are in this product's threat model,
 * so "the model would have to emit that" is not a defense: a planted
 * instruction can induce any output shape. Both groups below pass through the
 * verifier unnoticed on the pre-fix code.
 *
 * No statute number is typed in here. Each obfuscated string is built from the
 * real numbers in data/statutes.json by remapping their ASCII digits.
 */

const FULLWIDTH_ZERO = 0xff10;
const ARABIC_INDIC_ZERO = 0x0660;
const ZERO_WIDTH_SPACE = "​";

/** Remap ASCII digits onto another Unicode decimal-digit block. */
function remapDigits(text: string, zeroCodePoint: number): string {
  return text.replace(/[0-9]/g, (digit) => String.fromCodePoint(zeroCodePoint + Number(digit)));
}

/** Split every character of a number with a zero-width space. */
function splitWithZeroWidth(text: string): string {
  return Array.from(text).join(ZERO_WIDTH_SPACE);
}

describe("obfuscated law claims (finding 1: unicode and zero-width evasion)", () => {
  it("detects and drops a statute written in fullwidth digits", () => {
    const disguised = remapDigits(unconfirmedEntry.old, FULLWIDTH_ZERO);
    expect(disguised).not.toBe(unconfirmedEntry.old);

    const text = `Gov Code ${disguised} is the rule that applies to your junior unit.`;
    expect(looksLikeLawClaim(text)).toBe(true);

    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    // Normalization folds the fullwidth digits to ASCII, so the number is
    // resolved for real and rejected for the right reason.
    expect(reason).toContain(unconfirmedEntry.old);
    expect(reason).toContain("unconfirmed");
  });

  it("detects and drops a statute split by zero-width spaces", () => {
    const disguised = splitWithZeroWidth(unconfirmedEntry.old);
    expect(disguised).not.toBe(unconfirmedEntry.old);

    const text = `Gov Code ${disguised} is the rule that applies to your junior unit.`;
    expect(looksLikeLawClaim(text)).toBe(true);

    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain(unconfirmedEntry.old);
    expect(reason).toContain("unconfirmed");
  });

  it("detects and drops a statute written in Arabic-Indic digits", () => {
    const disguised = remapDigits(unconfirmedEntry.old, ARABIC_INDIC_ZERO);
    expect(disguised).not.toBe(unconfirmedEntry.old);

    const text = `Gov Code ${disguised} is the rule that applies to your junior unit.`;
    expect(looksLikeLawClaim(text)).toBe(true);

    // NFKC does NOT fold these to ASCII, so there is no number to look up.
    // Unresolvable means unbacked, so the claim drops rather than passing.
    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain("not written in ASCII digits");
    expect(reason).toContain("no citation");
  });

  it("detects and drops a bare statute number written in fullwidth digits", () => {
    const text = remapDigits(unconfirmedEntry.old, FULLWIDTH_ZERO);
    expect(looksLikeLawClaim(text)).toBe(true);
    expect(verifyEvent(event({ text }), statutes).ok).toBe(false);
  });

  it("detects a law-asserting phrase broken by a zero-width space", () => {
    const text = `This qualifies for ministeri${ZERO_WIDTH_SPACE}al approval.`;
    expect(looksLikeLawClaim(text)).toBe(true);
    expect(verifyEvent(event({ text }), statutes).ok).toBe(false);
  });

  it("detects a number split by a thin space", () => {
    const disguised = unconfirmedEntry.old.replace(".", " .");
    const text = `Gov Code ${disguised} applies here.`;
    expect(looksLikeLawClaim(text)).toBe(true);
  });

  it("normalizes only to decide, and hands back the original text untouched", () => {
    const disguised = remapDigits(confirmedEntry.old, FULLWIDTH_ZERO);
    const claim = event({ text: `The handout still cites ${disguised}; that number was renumbered.` });

    const result = verifyEvent(claim, statutes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same object, same characters: the fullwidth digits survive to the UI.
      expect(result.event).toBe(claim);
      expect(result.event.text).toContain(disguised);
    }
  });

  it("still ignores plain prose after normalization", () => {
    expect(looksLikeLawClaim("Upload the site plan and the floor plan as two separate PDFs.")).toBe(false);
  });
});

describe("partial backing (finding 2: one backed reference must not carry the rest)", () => {
  /** The low end of the confirmed entry's new range, read out of the data file. */
  const confirmedNewSection = confirmedEntry.new_range.split("-")[0] as string;

  it("drops a claim that pairs a confirmed statute with an unbacked bill reference", () => {
    const text = `Gov Code ${confirmedNewSection} and SB 9 both require the city to approve this.`;
    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain("SB 9");
    expect(reason).toContain("statute map cannot back");
    expect(reason).toContain("no citation");
  });

  it("drops the same claim with the bill named first", () => {
    const text = `SB 9 and Gov Code ${confirmedNewSection} both require the city to approve this.`;
    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain("SB 9");
  });

  it("drops a claim pairing a confirmed statute with an unresolvable obfuscated number", () => {
    const disguised = remapDigits(unconfirmedEntry.old, ARABIC_INDIC_ZERO);
    const text = `Gov Code ${confirmedNewSection} and ${disguised} both require ministerial approval.`;
    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain("not written in ASCII digits");
  });

  it("names the first unbacked reference in reading order", () => {
    const text = `State law requires ministerial approval under ${unconfirmedEntry.old}, and SB 9 helps too.`;
    const reason = reasonOf(verifyEvent(event({ text }), statutes));
    expect(reason).toContain(unconfirmedEntry.old);
  });

  it("lets a citation back a bill reference, since the statute map never can", () => {
    const claim = event({ text: "SB 9 lets you split the lot.", citation: goodCitation });
    expect(verifyEvent(claim, statutes).ok).toBe(true);
  });

  it("still passes a claim whose every reference is a confirmed statute", () => {
    const text = `Gov Code ${confirmedNewSection} and ${confirmedEntry.old} are the same rule, renumbered.`;
    expect(verifyEvent(event({ text }), statutes).ok).toBe(true);
  });
});

// ------------------------------------------------------ recorder + replay

describe("recorder and replay", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-replay-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function framesForTest(): StreamFrame[] {
    const ts = new Date().toISOString();
    return [
      { type: "status", phase: "started", step: 0, detail: "run begin" },
      { type: "event", event: { tool: "point_to", item_id: "item-1", ts } },
      {
        type: "event",
        event: {
          tool: "add_note",
          item_id: "item-2",
          text: "State law requires ministerial approval for a qualifying unit.",
          citation: goodCitation,
          ts,
        },
      },
      {
        type: "dropped",
        reason: `law claim cites ${unconfirmedEntry.old}, whose mapping is unconfirmed`,
        event: { tool: "add_note", item_id: "item-3", text: `Gov Code ${unconfirmedEntry.old} applies.`, ts },
      },
      { type: "refusal", reason: "city config is not verified" },
      { type: "error", code: "stream_closed", message: "client disconnected" },
      { type: "status", phase: "done" },
    ];
  }

  it("round-trips the exact frames through record, save and loadReplay", async () => {
    const target = path.join(tempDir, "round-trip", "replay.json");
    const recorder = createRecorder(target);
    const frames = framesForTest();

    for (const frame of frames) recorder.record(frame);
    expect(recorder.size()).toBe(frames.length);

    const written = await recorder.save();
    expect(written).toBe(path.resolve(target));
    expect(recorder.wroteFile()).toBe(true);
    expect(existsSync(written)).toBe(true);

    const loaded = await loadReplay(written);
    expect(loaded).toEqual(frames);
  });

  it("creates the parent directory and leaves no temp file behind", async () => {
    const target = path.join(tempDir, "nested", "deeper", "replay.json");
    const recorder = createRecorder(target);
    recorder.record({ type: "status", phase: "started" });
    await recorder.save();

    const entries = await fs.readdir(path.dirname(target));
    expect(entries).toEqual(["replay.json"]);
  });

  it("writes no file when zero frames were recorded", async () => {
    const target = path.join(tempDir, "empty", "replay.json");
    const recorder = createRecorder(target);

    expect(recorder.size()).toBe(0);
    const written = await recorder.save();

    expect(written).toBe(path.resolve(target));
    expect(recorder.wroteFile()).toBe(false);
    expect(existsSync(written)).toBe(false);
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("defaults to fixtures/replay.json without touching it", () => {
    expect(DEFAULT_REPLAY_PATH).toBe(path.join("fixtures", "replay.json"));
    expect(existsSync(path.resolve(DEFAULT_REPLAY_PATH))).toBe(false);
  });

  it("rejects a missing replay file", async () => {
    await expect(loadReplay(path.join(tempDir, "nope.json"))).rejects.toThrow(/could not be read/);
  });

  it("rejects a file that is not JSON", async () => {
    const target = path.join(tempDir, "not-json.json");
    await fs.writeFile(target, "{ this is not json", "utf8");
    await expect(loadReplay(target)).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a file that is not an array of frames", async () => {
    const target = path.join(tempDir, "not-array.json");
    await fs.writeFile(target, JSON.stringify({ type: "status", phase: "started" }), "utf8");
    await expect(loadReplay(target)).rejects.toThrow(/must be a JSON array/);
  });

  it("rejects a frame with an unknown type", async () => {
    const target = path.join(tempDir, "bad-type.json");
    await fs.writeFile(target, JSON.stringify([{ type: "run_shell", command: "rm -rf /" }]), "utf8");
    await expect(loadReplay(target)).rejects.toThrow(/not a valid StreamFrame array/);
  });

  it("rejects an event frame carrying an unknown key", async () => {
    const target = path.join(tempDir, "extra-key.json");
    const frame = {
      type: "event",
      event: { tool: "add_note", item_id: "item-1", ts: new Date().toISOString(), injected: "payload" },
    };
    await fs.writeFile(target, JSON.stringify([frame]), "utf8");
    await expect(loadReplay(target)).rejects.toThrow(/not a valid StreamFrame array/);
  });

  it("rejects an event frame with an unknown tool name", async () => {
    const target = path.join(tempDir, "bad-tool.json");
    const frame = {
      type: "event",
      event: { tool: "exfiltrate", item_id: "item-1", ts: new Date().toISOString() },
    };
    await fs.writeFile(target, JSON.stringify([frame]), "utf8");
    await expect(loadReplay(target)).rejects.toThrow(/not a valid StreamFrame array/);
  });

  it("accepts an empty frame array", async () => {
    const target = path.join(tempDir, "empty-array.json");
    await fs.writeFile(target, "[]", "utf8");
    await expect(loadReplay(target)).resolves.toEqual([]);
  });
});
