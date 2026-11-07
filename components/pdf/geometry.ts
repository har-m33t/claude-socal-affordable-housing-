/**
 * Pure coordinate maths for the checklist viewer. No React, no pdf.js, no DOM:
 * everything here is a function of numbers so it can be tested without rendering a PDF.
 *
 * Coordinate system: a checklist item's `box` is `[x, y, w, h]` in PDF points at scale 1
 * with the origin at the TOP-LEFT of its page (pdf.js viewport coordinates, not PDF
 * user-space). Nothing here assumes a page size: every conversion is driven by the
 * page's own measured `originalWidth`, so Letter, A4, Legal and tabloid all work.
 */

export interface PageSize {
  /** The page's intrinsic width in PDF points at scale 1. */
  width: number;
  /** The page's intrinsic height in PDF points at scale 1. */
  height: number;
}

export type Box = [number, number, number, number];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Measured intrinsic sizes, keyed by 1-indexed page number. Absent = not rendered yet. */
export type PageSizes = Record<number, PageSize | undefined>;

/** Smallest width we will ever ask pdf.js to render a page at. */
export const MIN_PAGE_WIDTH = 160;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.25;

/**
 * Where the fingertip lands inside a box: a little in from the left edge and slightly
 * below the middle, so the hand reads as pointing at the start of the line. Both are in
 * PDF points, so they scale with the page like everything else.
 */
const HAND_INSET_FRACTION = 0.06;
const HAND_INSET_MAX_POINTS = 28;
const HAND_VERTICAL_FRACTION = 0.55;

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Accept a box only if it is four finite numbers with a positive width and height.
 * `null`/`undefined` (coordinates not extracted yet), short arrays, NaN and zero-area
 * boxes all return null, which callers must render as "location unknown" rather than
 * pointing at an arbitrary spot. The declared contract type says the box is always
 * present; city JSON is data and may disagree, so this is deliberately defensive.
 */
export function normalizeBox(box: unknown): Box | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [x, y, w, h] = box;
  if (![x, y].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (!isFinitePositive(w) || !isFinitePositive(h)) return null;
  return [x, y, w, h];
}

/** Rendered CSS pixels per PDF point for a page, or null while the page is unmeasured. */
export function pageScale(renderedWidth: number, pageWidth: number | undefined | null): number | null {
  if (!isFinitePositive(renderedWidth) || !isFinitePositive(pageWidth)) return null;
  return renderedWidth / pageWidth;
}

/**
 * The CSS width we hand to `<Page width=…>`. Fit-to-container, capped at `maxWidth`,
 * multiplied by the user's zoom. Independent of page size: pdf.js scales each page to
 * this width itself, and `pageScale` then derives that page's own scale factor.
 */
export function fitPageWidth(opts: { containerWidth: number; maxWidth: number; zoom?: number; gutter?: number }): number {
  const { containerWidth, maxWidth, zoom = 1, gutter = 0 } = opts;
  const available = Number.isFinite(containerWidth) ? containerWidth - gutter : maxWidth;
  const base = Math.min(maxWidth, available);
  const scaled = base * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  return Math.max(MIN_PAGE_WIDTH, Math.floor(scaled));
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/** Box in PDF points -> CSS rect inside the rendered page element. */
export function boxToRect(box: Box, scale: number): Rect {
  const [x, y, w, h] = box;
  return { left: x * scale, top: y * scale, width: w * scale, height: h * scale };
}

/** Fingertip position for a box, in CSS pixels relative to the rendered page element. */
export function handTarget(box: Box, scale: number): Point {
  const [x, y, w, h] = box;
  const inset = Math.min(w * HAND_INSET_FRACTION, HAND_INSET_MAX_POINTS);
  return { x: (x + inset) * scale, y: (y + h * HAND_VERTICAL_FRACTION) * scale };
}

/**
 * Resolve an item's `page` against the document we actually loaded.
 * 1-indexed; returns null for a missing, non-integer or out-of-range page so a
 * checklist that disagrees with its PDF degrades to "unknown" instead of page 1.
 */
export function resolvePage(page: unknown, numPages: number): number | null {
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return null;
  if (!Number.isInteger(numPages) || numPages < 1) return null;
  return page <= numPages ? page : null;
}

export type ItemLocation =
  | { kind: "located"; page: number; scale: number; rect: Rect; hand: Point }
  /** The item has no usable box: coordinates have not been extracted. */
  | { kind: "unknown-box"; page: number | null }
  /** The item names a page this document does not have. */
  | { kind: "unknown-page"; page: number | null }
  /** Page exists but has not reported its intrinsic size yet; try again after it renders. */
  | { kind: "page-not-measured"; page: number };

export interface LocateOptions {
  numPages: number;
  pageSizes: PageSizes;
  renderedWidth: number;
}

/**
 * The one place that turns a checklist item into screen geometry. Works for any page
 * count and any page size, and reports *why* it could not place an item rather than
 * guessing. Deliberately takes a structural `{page, box}` so tests need no full item.
 */
export function locateItem(item: { page?: unknown; box?: unknown }, opts: LocateOptions): ItemLocation {
  const page = resolvePage(item.page, opts.numPages);
  const box = normalizeBox(item.box);
  if (page === null) {
    // A bad box is the more useful thing to report when both are bad.
    return box === null ? { kind: "unknown-box", page: null } : { kind: "unknown-page", page: null };
  }
  if (box === null) return { kind: "unknown-box", page };
  const scale = pageScale(opts.renderedWidth, opts.pageSizes[page]?.width);
  if (scale === null) return { kind: "page-not-measured", page };
  return { kind: "located", page, scale, rect: boxToRect(box, scale), hand: handTarget(box, scale) };
}

/** Human-readable reason an item could not be pointed at, or null when it was located. */
export function locationMessage(loc: ItemLocation, numPages: number): string | null {
  switch (loc.kind) {
    case "located":
      return null;
    case "unknown-box":
      return "This item's location in the checklist document hasn't been recorded yet, so the pointer can't show you where it is.";
    case "unknown-page":
      return `This item refers to a page that isn't in this document${numPages > 0 ? ` (it has ${numPages} ${numPages === 1 ? "page" : "pages"})` : ""}, so the pointer can't show you where it is.`;
    case "page-not-measured":
      return `Finding this item on page ${loc.page}…`;
  }
}

/**
 * Which page the reader is looking at, from page offsets within the scroll stack.
 * A page counts as current once its top passes a third of the way down the viewport.
 */
export function visiblePage(offsets: { page: number; top: number }[], scrollTop: number, viewportHeight: number): number | null {
  if (offsets.length === 0) return null;
  const line = scrollTop + viewportHeight / 3;
  const sorted = [...offsets].sort((a, b) => a.top - b.top);
  let current = sorted[0].page;
  for (const o of sorted) {
    if (o.top <= line) current = o.page;
    else break;
  }
  return current;
}
