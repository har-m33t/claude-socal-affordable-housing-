// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRedactor, RedactionPreview } from "@/lib/redact";
import { KNOWN_NAMES, loadApplicantDocument, SENSITIVE_VALUES } from "./fixtures/applicant/applicant";

afterEach(cleanup);

function setup(className?: string) {
  const original = loadApplicantDocument("owner-info-sheet.txt");
  const { text, spans } = createRedactor({ knownNames: [...KNOWN_NAMES] }).redact(original);
  const view = render(<RedactionPreview original={original} redacted={text} spans={spans} className={className} />);
  const before = screen.getByRole("region", { name: "Before (stays on this device)" });
  const after = screen.getByRole("region", { name: "After (what is sent to Claude)" });
  return { original, text, spans, view, before, after };
}

describe("RedactionPreview", () => {
  it("renders a titled panel with both panes as labelled regions", () => {
    const { before, after } = setup();
    expect(screen.getByRole("heading", { level: 2, name: "What leaves your device" })).toBeTruthy();
    expect(within(before).getByRole("heading", { level: 3 })).toBeTruthy();
    expect(within(after).getByRole("heading", { level: 3 })).toBeTruthy();
  });

  it("shows the original values only in the before pane", () => {
    const { before, after, view } = setup();
    const values = [
      "Maria Ejemplo",
      "1234 Example Lane",
      "999-999-99",
      "(714) 555-0142",
      "714.555.0187",
      ...SENSITIVE_VALUES.EMAIL.slice(0, 1),
    ];
    const outside = view.container.textContent!.replace(before.textContent!, "");
    for (const v of values) {
      expect(before.textContent, v).toContain(v);
      expect(after.textContent, v).not.toContain(v);
      expect(outside, v).not.toContain(v);
    }
  });

  it("shows exactly the redacted text in the after pane, with each token highlighted", () => {
    const { after, text, spans } = setup();
    expect(after.querySelector("pre")!.textContent).toBe(text);
    const marks = [...after.querySelectorAll("mark")];
    expect(marks.length).toBe(spans.length);
    for (const m of marks) {
      expect(m.textContent).toMatch(/^\[(NAME|ADDRESS|PHONE|EMAIL|APN)_\d+\]$/);
      expect(m.getAttribute("data-kind")).toBe(m.textContent!.slice(1).split("_")[0]);
      expect(m.className).toMatch(/b5523b/);
    }
  });

  it("marks what will be hidden in the before pane, with a text label for screen readers", () => {
    const { before, spans, original } = setup();
    const marks = [...before.querySelectorAll("mark")];
    expect(marks.length).toBe(spans.length);
    expect(marks[0]!.textContent).toContain(original.slice(spans[0]!.start, spans[0]!.end));
    expect(marks[0]!.textContent).toContain(`hidden as ${spans[0]!.token}`);
  });

  it("shows a count of hidden values by kind, in words", () => {
    setup();
    const list = screen.getByRole("list", { name: "Hidden before sending" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "2 names hidden",
      "2 addresses hidden",
      "2 phone numbers hidden",
      "1 email hidden",
      "1 parcel number (APN) hidden",
    ]);
  });

  it("says the token map stays in this tab", () => {
    setup();
    expect(screen.getByText(/stays in this browser tab/)).toBeTruthy();
  });

  it("accepts a className override on the outer element", () => {
    const { view } = setup("mt-8 max-w-5xl");
    expect((view.container.firstElementChild as HTMLElement).className).toMatch(/mt-8 max-w-5xl$/);
  });

  it("handles text with nothing to hide", () => {
    render(<RedactionPreview original="Site plan showing setbacks" redacted="Site plan showing setbacks" spans={[]} />);
    expect(screen.getByText(/No names, addresses, phone numbers, emails or parcel numbers were found/)).toBeTruthy();
  });
});
