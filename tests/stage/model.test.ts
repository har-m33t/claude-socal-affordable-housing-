import { describe, expect, it } from "vitest";
import { PACKET_FILES, PLAN } from "@/components/pointer/config";
import type { Plan } from "@/components/pointer/plan";
import { emptyItem, type ItemState } from "@/components/pointer/run-state";
import {
  boardSummaries,
  answerAnnouncement,
  declaredTypeForSlot,
  docProgress,
  fileCards,
  handsFor,
  needsBackBanner,
  placeOf,
  slotGroups,
  stepMarker,
} from "@/components/stage/model";

// A small plan with two PDFs and a packet, to prove nothing assumes one checklist.
const plan: Plan = {
  about: "test",
  city: "Testville",
  project_type: "adu",
  checked_date: null,
  documents: [
    { id: "packet", title: "Your files (made up)", kind: "packet", made_up: true },
    { id: "a", title: "Checklist A", kind: "pdf", url: "/a.pdf" },
    { id: "b", title: "Form B", kind: "pdf", url: "/b.pdf" },
  ],
  targets: [
    { id: "file-x", doc: "packet", label: "x.pdf", text: "x.pdf (declared type: site_plan). Made-up applicant file." },
    { id: "a1", doc: "a", label: "A one", text: "A1", page: 1, box: [0, 0, 10, 10] },
    { id: "a2", doc: "a", label: "A two", text: "A2", page: 2, box: [0, 0, 10, 10] },
    { id: "b1", doc: "b", label: "B one", text: "B1", page: 1, box: [0, 0, 10, 10] },
  ],
  steps: [
    { id: "s1", title: "Organize", kind: "organize", doc: "packet", targets: ["file-x"] },
    { id: "s2", title: "Read A", kind: "read", doc: "a", targets: ["a1", "a2"] },
    { id: "s3", title: "Fill B", kind: "form", doc: "b", targets: ["b1"] },
  ],
};

const item = (over: Partial<ItemState>): ItemState => ({ ...emptyItem(), ...over });

describe("handsFor", () => {
  it("draws each hand only on its own target's document", () => {
    const answer = { targetId: "b1", pulsePlan: false };
    expect(handsFor(plan, "a", "a1", answer)).toEqual({ plan: "a1", answer: undefined, pulsePlan: false });
    expect(handsFor(plan, "b", "a1", answer)).toEqual({ plan: undefined, answer: "b1", pulsePlan: false });
  });

  it("never draws a second hand on the plan's own target: the plan hand pulses", () => {
    expect(handsFor(plan, "a", "a1", { targetId: "a1", pulsePlan: true })).toEqual({ plan: "a1", answer: undefined, pulsePlan: true });
    // Even if the flag is missing, the same spot never gets two hands.
    expect(handsFor(plan, "a", "a1", { targetId: "a1", pulsePlan: false })).toEqual({ plan: "a1", answer: undefined, pulsePlan: true });
    // A flag left over from an earlier step never hides an answer elsewhere.
    expect(handsFor(plan, "a", "a2", { targetId: "a1", pulsePlan: true })).toEqual({ plan: "a2", answer: "a1", pulsePlan: false });
  });

  it("draws nothing for an answer that is not on the plan's documents", () => {
    expect(handsFor(plan, "a", "a1", { pulsePlan: false })).toEqual({ plan: "a1", answer: undefined, pulsePlan: false });
    expect(handsFor(plan, "a", "a1", { targetId: "nope", pulsePlan: false }).answer).toBeUndefined();
  });
});

describe("tabs", () => {
  it("counts checked targets per document", () => {
    const items = { a1: item({ status: "complete" }), a2: item({ highlighted: true }) };
    expect(docProgress(plan, "a", items)).toEqual({ reviewed: 1, total: 2 });
    expect(docProgress(plan, "b", items)).toEqual({ reviewed: 0, total: 1 });
  });

  it("marks the step's tab only while another document is on screen", () => {
    expect(stepMarker(plan, "b1", "a")).toEqual({ docId: "b", label: "Step 3" });
    expect(stepMarker(plan, "b1", "b")).toBeNull();
    expect(stepMarker(plan, undefined, "a")).toBeNull();
  });
});

describe("answer placement", () => {
  it("names where the answer is, with the page for PDFs", () => {
    expect(placeOf(plan, "a2")).toBe("Checklist A, page 2");
    expect(placeOf(plan, "file-x")).toBe("Your files (made up)");
    expect(answerAnnouncement(plan, { targetId: "a2", pulsePlan: false }, "a1")).toBe("Answer is on Checklist A, page 2.");
    expect(answerAnnouncement(plan, { targetId: "a1", pulsePlan: true }, "a1")).toBe("The answer is at your current step.");
    expect(answerAnnouncement(plan, { pulsePlan: false }, "a1")).toBe("");
  });

  it("shows the Back banner only when the answer took the homeowner off their step's page", () => {
    expect(needsBackBanner(plan, { targetId: "b1", pulsePlan: false }, "a1")).toBe(true); // other document
    expect(needsBackBanner(plan, { targetId: "a2", pulsePlan: false }, "a1")).toBe(true); // other page
    expect(needsBackBanner(plan, { targetId: "a1", pulsePlan: true }, "a1")).toBe(false); // same spot
    expect(needsBackBanner(plan, { pulsePlan: false }, "a1")).toBe(false); // no answer hand
  });
});

describe("file board", () => {
  it("makes one pointable card per slot, then lists other packet files", () => {
    const cards = fileCards(plan, "packet", [{ name: "other.pdf", declared_type: "unknown" }], {
      "file-x": item({ status: "missing", statusText: "Not signed" }),
    });
    expect(cards).toEqual([
      { targetId: "file-x", name: "x.pdf", declaredType: "site_plan", status: "missing", statusText: "Not signed", highlighted: false },
      { name: "other.pdf", declaredType: "unknown", highlighted: false },
    ]);
  });

  it("prefers the packet's declared type when a file matches a slot by name", () => {
    const [card] = fileCards(plan, "packet", [{ name: "x.pdf", declared_type: "floor_plan" }], {});
    expect(card).toMatchObject({ targetId: "file-x", declaredType: "floor_plan" });
  });

  it("offers every target as an upload slot, file slots first, grouped by document", () => {
    const groups = slotGroups(plan);
    expect(groups.map((g) => g.docId)).toEqual(["packet", "a", "b"]);
    expect(groups[1].options).toEqual([
      { id: "a1", label: "A one" },
      { id: "a2", label: "A two" },
    ]);
  });

  it("works on the real Anaheim plan", () => {
    const slots = slotGroups(PLAN).flatMap((g) => g.options.map((o) => o.id));
    expect(new Set(slots)).toEqual(new Set(PLAN.targets.map((t) => t.id)));
    const packet = PLAN.documents.find((d) => d.kind === "packet")!;
    const cards = fileCards(PLAN, packet.id, PACKET_FILES, {});
    expect(cards.map((c) => c.name)).toEqual(PACKET_FILES.map((f) => f.name));
    expect(cards.every((c) => c.targetId)).toBe(true);
    // Board-level targets are summaries, never file cards.
    const summaries = boardSummaries(PLAN, packet.id, {});
    expect(summaries.map((s) => s.targetId)).toContain("packet-summary");
    expect(cards.some((c) => c.targetId === "packet-summary")).toBe(false);
  });
  it("sends an added file with its slot's declared type, or the slot id when the slot is not a file", () => {
    expect(declaredTypeForSlot(plan, "file-x")).toBe("site_plan");
    expect(declaredTypeForSlot(plan, "a1")).toBe("a1");
    expect(declaredTypeForSlot(plan, "nope")).toBe("nope");
  });
});
