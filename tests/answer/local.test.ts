import { describe, expect, it } from "vitest";
import { answerLocally, createLocalProvider } from "@/lib/answer/local";
import { isDeictic, questionTokens, verbatimQuote } from "@/lib/answer/text";
import { ctx, plan, targetIdWhere } from "./helpers";

const sewer = targetIdWhere((l) => l.includes("sewer"));
const meter = targetIdWhere((l) => l.includes("meter spot"));

describe("local answers: retrieval over the plan's own targets", () => {
  it('"sewer" finds the sewer target on the city\'s document', () => {
    const r = answerLocally("sewer", ctx());
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.targetId).toBe(sewer);
  });

  it('"sewage" reaches the sewer target through a synonym', () => {
    const r = answerLocally("Do I need anything about sewage?", ctx());
    expect(r.kind === "found" && r.targetId).toBe(sewer);
  });

  it('"what is a meter spot report?" finds the meter target', () => {
    const r = answerLocally("What is a meter spot report?", ctx());
    expect(r.kind === "found" && r.targetId).toBe(meter);
  });

  it('"electric meter" maps onto the meter spot report', () => {
    const r = answerLocally("I'm adding an electric meter", ctx());
    expect(r.kind === "found" && r.targetId).toBe(meter);
  });

  it('"property tax" is not on the checklist: not_found, with the city\'s own page and no mailto', () => {
    const r = answerLocally("Do I need to pay property tax?", ctx());
    expect(r.kind).toBe("not_found");
    expect(r.text).toMatch(/isn't on this checklist/);
    expect(r.sources.length).toBeGreaterThan(0);
    for (const s of r.sources) expect(s.url).toMatch(/^https?:\/\//);
  });

  it('"what is this step?" resolves to the plan pointer\'s current target', () => {
    const r = answerLocally("What is this step?", ctx(meter));
    expect(r.kind === "found" && r.targetId).toBe(meter);
    expect(answerLocally("why?", ctx(sewer)).kind === "found").toBe(true);
  });

  it("builds the reply only from the target's label, document and verbatim text", () => {
    const r = answerLocally("meter spot report", ctx());
    if (r.kind !== "found") throw new Error("expected found");
    const t = plan.targets.find((x) => x.id === r.targetId)!;
    expect(r.text).toContain(t.label);
    expect(r.quote && t.text.includes(r.quote.replace(/…$/, ""))).toBe(true);
    expect(r.sources[0]?.url).toMatch(/^https:\/\//);
  });

  it("the provider honours an aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createLocalProvider().ask("sewer", ctx(), ac.signal)).rejects.toThrow();
  });
});

describe("text helpers", () => {
  it("drops stopwords and adds synonyms", () => {
    expect(questionTokens("What is the sewage fee?")).toEqual(expect.arrayContaining(["sewage", "sewer", "fee"]));
    expect(questionTokens("What is the")).toEqual([]);
  });

  it("recognises questions about 'this'", () => {
    expect(isDeictic("what is this")).toBe(true);
    expect(isDeictic("Why do I need this step?")).toBe(true);
    expect(isDeictic("is this about the sewer")).toBe(false);
  });

  it("quotes the first sentences verbatim, without the list number", () => {
    const q = verbatimQuote("2. METER: First sentence here. Second one. Third one.");
    expect(q).toBe("METER: First sentence here. Second one.");
    expect(verbatimQuote("x ".repeat(400)).length).toBeLessThanOrEqual(281);
  });
});

describe("verbatimQuote edge cases", () => {
  it("keeps a two-sentence text whole", () => {
    expect(verbatimQuote("floor-plan.pdf (declared type: unknown). Made-up applicant file.")).toBe(
      "floor-plan.pdf (declared type: unknown). Made-up applicant file.",
    );
  });
});

describe("coverage is weighted by how distinctive each word is", () => {
  it('"property tax" does not point at the form\'s "Property Owner" field', () => {
    const r = answerLocally("property tax", ctx());
    expect(r.kind).toBe("not_found");
  });
});
