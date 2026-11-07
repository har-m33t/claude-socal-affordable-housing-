// @vitest-environment jsdom
/**
 * Checklist viewer tests. react-pdf is mocked: no real PDF is parsed and no network
 * request is made. The coordinate maths is tested as pure functions (geometry.ts) at
 * several scales and page sizes, and the component is tested for the states it will
 * actually spend time in: no document, failed load, an item on a page other than 1,
 * and an item whose box has not been extracted yet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import type { ChecklistItem } from "@/components/pointer/contract";
import {
  boxToRect,
  clampZoom,
  fitPageWidth,
  handTarget,
  locateItem,
  locationMessage,
  normalizeBox,
  pageScale,
  resolvePage,
  visiblePage,
  type Box,
  type PageSizes,
} from "@/components/pdf/geometry";

// ---------------------------------------------------------------- react-pdf mock

const mock = vi.hoisted(() => ({
  /** Page sizes the fake pdf.js reports, keyed by page number. */
  pageSizes: {} as Record<number, { width: number; height: number }>,
  numPages: 1,
  /** When set, Document reports a load failure with this message instead of loading. */
  failWith: null as string | null,
  /** Last `options` object handed to <Document>, so we can assert scripting is off. */
  options: null as Record<string, unknown> | null,
  /** Last `file` handed to <Document>. */
  file: null as unknown,
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
  Document: ({
    file,
    options,
    children,
    onLoadSuccess,
    onLoadError,
  }: {
    file: unknown;
    options: Record<string, unknown>;
    children?: React.ReactNode;
    onLoadSuccess?: (pdf: { numPages: number }) => void;
    onLoadError?: (e: Error) => void;
  }) => {
    mock.options = options;
    mock.file = file;
    React.useEffect(() => {
      if (mock.failWith) onLoadError?.(new Error(mock.failWith));
      else onLoadSuccess?.({ numPages: mock.numPages });
    }, [file, onLoadSuccess, onLoadError]);
    return React.createElement("div", { "data-testid": "document" }, children);
  },
  Page: ({
    pageNumber,
    width,
    onLoadSuccess,
  }: {
    pageNumber: number;
    width: number;
    onLoadSuccess?: (p: { originalWidth: number; originalHeight: number }) => void;
  }) => {
    React.useEffect(() => {
      const size = mock.pageSizes[pageNumber];
      if (size) onLoadSuccess?.({ originalWidth: size.width, originalHeight: size.height });
    }, [pageNumber, onLoadSuccess]);
    return React.createElement("div", { "data-testid": `page-canvas-${pageNumber}`, style: { width } });
  },
}));

// Imported after the mock is declared (vi.mock is hoisted above the imports anyway).
const { default: ChecklistViewer } = await import("@/components/pdf/ChecklistViewer");

// ---------------------------------------------------------------- environment stubs

beforeAll(() => {
  // jsdom ships neither of these; the component must not depend on their behaviour.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
});

beforeEach(() => {
  mock.pageSizes = {};
  mock.numPages = 1;
  mock.failWith = null;
  mock.options = null;
  mock.file = null;
});

afterEach(cleanup);

// ---------------------------------------------------------------- helpers

const LETTER = { width: 612, height: 792 };
const A4 = { width: 595.28, height: 841.89 };
const LANDSCAPE_TABLOID = { width: 1224, height: 792 };

function item(over: Partial<ChecklistItem> & { id: string }): ChecklistItem {
  return {
    text: `item ${over.id}`,
    page: 1,
    box: [36, 100, 500, 40],
    doc_type: "doc",
    source: "https://example.gov/checklist",
    ...over,
  } as ChecklistItem;
}

function handStyle(container: HTMLElement) {
  const el = container.querySelector(".pointer-hand") as HTMLElement | null;
  if (!el) return null;
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
  return { opacity: el.style.opacity, x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
}

// ---------------------------------------------------------------- pure maths

describe("geometry: box -> screen", () => {
  it("scales a box by rendered width / page width, for several page sizes", () => {
    const box: Box = [36, 274.7, 542.5, 62];

    // Letter at 1x fit (612 -> 612) is the identity case.
    expect(pageScale(612, LETTER.width)).toBe(1);
    expect(boxToRect(box, pageScale(612, LETTER.width)!)).toEqual({ left: 36, top: 274.7, width: 542.5, height: 62 });

    // Same page, rendered half size.
    const half = pageScale(306, LETTER.width)!;
    expect(half).toBe(0.5);
    expect(boxToRect(box, half)).toEqual({ left: 18, top: 137.35, width: 271.25, height: 31 });

    // A4 at the same CSS width gets a different scale: page geometry is never assumed.
    const a4 = pageScale(612, A4.width)!;
    expect(a4).toBeCloseTo(1.02809, 5);
    const a4Rect = boxToRect(box, a4);
    expect(a4Rect.left).toBeCloseTo(37.011, 3);
    expect(a4Rect.width).toBeCloseTo(557.7, 1);

    // A wide landscape page shrinks to the same CSS width, so the scale drops below 1.
    const wide = pageScale(612, LANDSCAPE_TABLOID.width)!;
    expect(wide).toBe(0.5);
    expect(boxToRect(box, wide).width).toBe(271.25);
  });

  it("keeps rects proportional across two zoom levels of the same page", () => {
    const box: Box = [100, 200, 300, 50];
    const fit = fitPageWidth({ containerWidth: 720, maxWidth: 680, zoom: 1, gutter: 32 });
    const zoomed = fitPageWidth({ containerWidth: 720, maxWidth: 680, zoom: 2, gutter: 32 });
    expect(fit).toBe(680);
    expect(zoomed).toBe(1360);

    const a = boxToRect(box, pageScale(fit, A4.width)!);
    const b = boxToRect(box, pageScale(zoomed, A4.width)!);
    expect(b.left / a.left).toBeCloseTo(2, 10);
    expect(b.width / a.width).toBeCloseTo(2, 10);
    expect(b.top / a.top).toBeCloseTo(2, 10);
  });

  it("fits to the container below the cap and never below the floor", () => {
    expect(fitPageWidth({ containerWidth: 400, maxWidth: 680, gutter: 32 })).toBe(368);
    expect(fitPageWidth({ containerWidth: 5000, maxWidth: 680, gutter: 32 })).toBe(680);
    expect(fitPageWidth({ containerWidth: 10, maxWidth: 680, gutter: 32 })).toBe(160);
    expect(fitPageWidth({ containerWidth: Number.NaN, maxWidth: 680 })).toBe(680);
  });

  it("clamps zoom into range", () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("puts the fingertip inside the box, and scales it with the page", () => {
    const box: Box = [36, 100, 500, 40];
    const at1 = handTarget(box, 1);
    expect(at1.x).toBeGreaterThan(box[0]);
    expect(at1.x).toBeLessThan(box[0] + box[2]);
    expect(at1.y).toBeGreaterThan(box[1]);
    expect(at1.y).toBeLessThan(box[1] + box[3]);

    const at2 = handTarget(box, 2);
    expect(at2.x).toBeCloseTo(at1.x * 2, 10);
    expect(at2.y).toBeCloseTo(at1.y * 2, 10);

    // A narrow box gets a proportional inset rather than a fixed one.
    expect(handTarget([0, 0, 50, 10], 1).x).toBeCloseTo(3, 10);
  });

  it("rejects boxes that are not four usable numbers", () => {
    expect(normalizeBox([36, 100, 500, 40])).toEqual([36, 100, 500, 40]);
    expect(normalizeBox(null)).toBeNull();
    expect(normalizeBox(undefined)).toBeNull();
    expect(normalizeBox([1, 2, 3])).toBeNull();
    expect(normalizeBox([1, 2, 0, 40])).toBeNull();
    expect(normalizeBox([1, 2, 10, -5])).toBeNull();
    expect(normalizeBox([Number.NaN, 2, 10, 5])).toBeNull();
    expect(normalizeBox(["36", 100, 500, 40])).toBeNull();
    expect(pageScale(680, 0)).toBeNull();
    expect(pageScale(680, undefined)).toBeNull();
  });
});

describe("geometry: page resolution", () => {
  it("resolves a page inside the document and refuses one outside it", () => {
    expect(resolvePage(3, 5)).toBe(3);
    expect(resolvePage(5, 5)).toBe(5);
    expect(resolvePage(1, 1)).toBe(1);
    expect(resolvePage(6, 5)).toBeNull();
    expect(resolvePage(0, 5)).toBeNull();
    expect(resolvePage(2.5, 5)).toBeNull();
    expect(resolvePage(undefined, 5)).toBeNull();
    expect(resolvePage(1, 0)).toBeNull();
  });

  it("locates an item on page 3 of a 5-page document using page 3's own size", () => {
    const pageSizes: PageSizes = { 1: LETTER, 2: LETTER, 3: A4, 4: LETTER, 5: LANDSCAPE_TABLOID };
    const loc = locateItem({ page: 3, box: [50, 400, 400, 30] }, { numPages: 5, pageSizes, renderedWidth: 600 });
    expect(loc.kind).toBe("located");
    if (loc.kind !== "located") throw new Error("unreachable");
    expect(loc.page).toBe(3);
    expect(loc.scale).toBeCloseTo(600 / A4.width, 10);
    expect(loc.rect.left).toBeCloseTo(50 * (600 / A4.width), 6);
    expect(loc.hand.y).toBeGreaterThan(loc.rect.top);
    expect(loc.hand.y).toBeLessThan(loc.rect.top + loc.rect.height);
    expect(locationMessage(loc, 5)).toBeNull();

    // Page 5 is landscape: same CSS width, a different scale, no page-1 assumptions.
    const wide = locateItem({ page: 5, box: [50, 400, 400, 30] }, { numPages: 5, pageSizes, renderedWidth: 600 });
    if (wide.kind !== "located") throw new Error("expected page 5 to locate");
    expect(wide.scale).toBeCloseTo(600 / LANDSCAPE_TABLOID.width, 10);
    expect(wide.scale).not.toBeCloseTo(loc.scale, 3);
  });

  it("reports a null box as unknown instead of pointing somewhere arbitrary", () => {
    const loc = locateItem({ page: 2, box: null }, { numPages: 4, pageSizes: { 2: LETTER }, renderedWidth: 600 });
    expect(loc).toEqual({ kind: "unknown-box", page: 2 });
    expect(locationMessage(loc, 4)).toMatch(/hasn't been recorded/i);
  });

  it("reports a page the document does not have, and a page not yet measured", () => {
    const out = locateItem({ page: 9, box: [1, 2, 3, 4] }, { numPages: 4, pageSizes: {}, renderedWidth: 600 });
    expect(out.kind).toBe("unknown-page");
    expect(locationMessage(out, 4)).toMatch(/4 pages/);

    const unmeasured = locateItem({ page: 3, box: [1, 2, 3, 4] }, { numPages: 4, pageSizes: {}, renderedWidth: 600 });
    expect(unmeasured).toEqual({ kind: "page-not-measured", page: 3 });
    expect(locationMessage(unmeasured, 4)).toMatch(/page 3/);
  });

  it("tracks which page is on screen from page offsets", () => {
    const offsets = [
      { page: 1, top: 0 },
      { page: 2, top: 800 },
      { page: 3, top: 1600 },
    ];
    expect(visiblePage(offsets, 0, 600)).toBe(1);
    expect(visiblePage(offsets, 700, 600)).toBe(2);
    expect(visiblePage(offsets, 1500, 600)).toBe(3);
    expect(visiblePage([], 0, 600)).toBeNull();
  });
});

// ---------------------------------------------------------------- component states

describe("ChecklistViewer: degraded states", () => {
  it("shows a calm empty state when the city has no PDF at all", () => {
    const { getByTestId, queryByTestId } = render(
      <ChecklistViewer file="" checklist={[item({ id: "a" })]} items={{}} tapKey={0} cityName="Irvine" />,
    );
    const empty = getByTestId("viewer-no-document");
    expect(empty.textContent).toMatch(/Irvine/);
    expect(empty.textContent).toMatch(/hasn’t been added to Pointer yet/);
    // Nothing was handed to pdf.js, so there is no request and no broken frame.
    expect(queryByTestId("document")).toBeNull();
    expect(mock.file).toBeNull();
  });

  it("treats a whitespace-only file as no document", () => {
    const { getByTestId } = render(<ChecklistViewer file="   " checklist={[]} items={{}} tapKey={0} />);
    expect(getByTestId("viewer-no-document")).toBeTruthy();
  });

  it("names the URL that failed when the PDF cannot be loaded", async () => {
    mock.failWith = "Unexpected server response (404) while loading PDF";
    const url = "/data/docs/anaheim-adu-checklist.pdf";
    const { getByTestId } = render(<ChecklistViewer file={url} checklist={[item({ id: "a" })]} items={{}} tapKey={0} />);
    await waitFor(() => getByTestId("viewer-load-error"));
    expect(getByTestId("viewer-load-error-url").textContent).toBe(url);
    expect(getByTestId("viewer-load-error-detail").textContent).toMatch(/404/);
  });

  it("says the location is unknown for an item whose box has not been extracted", async () => {
    mock.numPages = 1;
    mock.pageSizes = { 1: LETTER };
    const broken = { ...item({ id: "no-box" }), box: null } as unknown as ChecklistItem;
    const { getByTestId, queryByTestId, container } = render(
      <ChecklistViewer file="/x.pdf" checklist={[broken]} items={{}} pointedItem="no-box" tapKey={1} />,
    );
    await waitFor(() => expect(getByTestId("viewer-status").textContent).toMatch(/hasn't been recorded/i));
    // No overlay box is drawn, and the hand stays hidden rather than pointing at 0,0.
    expect(queryByTestId("item-box-no-box")).toBeNull();
    expect(handStyle(container)?.opacity).toBe("0");
  });
});

describe("ChecklistViewer: multi-page documents", () => {
  const pages = { 1: LETTER, 2: LETTER, 3: A4, 4: LETTER, 5: LANDSCAPE_TABLOID };

  it("renders every page of a 5-page document and locates an item on page 3", async () => {
    mock.numPages = 5;
    mock.pageSizes = pages;
    const onPage3 = item({ id: "p3", page: 3, box: [50, 400, 400, 30] });
    const { getByTestId, container } = render(
      <ChecklistViewer
        file="/multi.pdf"
        checklist={[item({ id: "p1", page: 1 }), onPage3]}
        items={{}}
        pointedItem="p3"
        tapKey={2}
        maxPageWidth={600}
      />,
    );

    await waitFor(() => getByTestId("viewer-page-5"));
    expect(getByTestId("viewer-page-1")).toBeTruthy();
    expect(getByTestId("viewer-page-3")).toBeTruthy();

    // The item's overlay is a child of page 3's container, not page 1's.
    const box = await waitFor(() => getByTestId("item-box-p3"));
    expect(getByTestId("viewer-page-3").contains(box)).toBe(true);
    expect(getByTestId("viewer-page-1").contains(box)).toBe(false);

    // Positioned with page 3's own scale (A4), not Letter's.
    const scale = 600 / A4.width;
    expect(Number.parseFloat(box.style.left)).toBeCloseTo(50 * scale, 2);
    expect(Number.parseFloat(box.style.width)).toBeCloseTo(400 * scale, 2);

    // The hand is visible and sits on the item (page offsets are 0 in jsdom).
    await waitFor(() => expect(handStyle(container)?.opacity).toBe("1"));
    const hand = handStyle(container)!;
    const want = handTarget([50, 400, 400, 30], scale);
    expect(hand.x).toBeCloseTo(want.x - 15, 2);
    expect(hand.y).toBeCloseTo(want.y - 2, 2);

    // And the reader can see which page they are on.
    expect(getByTestId("viewer-page-indicator").textContent).toMatch(/Page 3 of 5/);
  });

  it("reports an item that points past the end of the document", async () => {
    mock.numPages = 2;
    mock.pageSizes = { 1: LETTER, 2: LETTER };
    const { getByTestId } = render(
      <ChecklistViewer
        file="/short.pdf"
        checklist={[item({ id: "ghost", page: 7 })]}
        items={{}}
        pointedItem="ghost"
        tapKey={3}
      />,
    );
    await waitFor(() => expect(getByTestId("viewer-status").textContent).toMatch(/isn't in this document/i));
  });
});

describe("ChecklistViewer: pdf.js hardening", () => {
  it("runs pdf.js with scripting off", async () => {
    mock.numPages = 1;
    mock.pageSizes = { 1: LETTER };
    render(<ChecklistViewer file="/x.pdf" checklist={[]} items={{}} tapKey={0} />);
    await waitFor(() => expect(mock.options).not.toBeNull());
    const options = mock.options!;
    expect(options.isEvalSupported).toBe(false);
    expect(options.enableXfa).toBe(false);
    // enableScripting must never be turned on for an untrusted third-party document.
    expect(options.enableScripting ?? false).toBe(false);
  });
});
