"use client";
// The city checklist PDF, with one overlay box per checklist item and the pointer hand.
// Item boxes come from the city config (precomputed), never from matching text the agent quoted.
// Load this module with next/dynamic and ssr: false: pdf.js needs the browser.
//
// Document-shape assumptions live in exactly one place — components/pdf/geometry.ts — and
// there are none here: any page count, any page size, any zoom. All four degraded states
// (no PDF, failed load, unknown page, unextracted box) are rendered explicitly.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { ChecklistItem } from "@/components/pointer/contract";
import type { ItemState } from "@/components/pointer/run-state";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampZoom,
  fitPageWidth,
  locateItem,
  locationMessage,
  normalizeBox,
  pageScale,
  visiblePage,
  type ItemLocation,
  type PageSizes,
  type Rect,
} from "./geometry";
import { PointerHand } from "./PointerHand";
import { LoadErrorState, NoDocumentState } from "./ViewerStates";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// A city checklist is an untrusted document fetched from a third-party city website, so
// pdf.js runs with scripting off: no eval-compiled font/expression code (isEvalSupported),
// no XFA forms, and `enableScripting` is never turned on anywhere in this component.
// We only ever rasterise pages — no text layer, no annotation layer, no form fields.
const PDF_OPTIONS = { enableXfa: false, isEvalSupported: false } as const;
const MAX_PAGE_WIDTH = 680;
const GUTTER = 32;

interface Props {
  /** URL of the city's checklist PDF. Empty string means this city has no document yet. */
  file: string;
  checklist: ChecklistItem[];
  items: Record<string, ItemState>;
  pointedItem?: string;
  selectedItem?: string;
  onSelect?: (id: string) => void;
  tapKey: number;
  /** Optional: named in the "no document yet" state so the message is concrete. */
  cityName?: string;
  /** Optional: cap on the fit-to-width page size, before zoom. */
  maxPageWidth?: number;
}

export default function ChecklistViewer({
  file,
  checklist,
  items,
  pointedItem,
  selectedItem,
  onSelect,
  tapKey,
  cityName,
  maxPageWidth = MAX_PAGE_WIDTH,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [numPages, setNumPages] = useState(0);
  const [pageSizes, setPageSizes] = useState<PageSizes>({});
  const [containerWidth, setContainerWidth] = useState(maxPageWidth + GUTTER);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<{ x: number; y: number } | null>(null);

  const hasDocument = file.trim().length > 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDocument, error]);

  // One CSS width for every page; each page's own scale is derived from its own
  // intrinsic width, so a mixed-size document (portrait + landscape) still lines up.
  const renderedWidth = useMemo(
    () => fitPageWidth({ containerWidth, maxWidth: maxPageWidth, zoom, gutter: GUTTER }),
    [containerWidth, maxPageWidth, zoom],
  );

  const target = useMemo(() => checklist.find((c) => c.id === pointedItem), [checklist, pointedItem]);
  const location = useMemo<ItemLocation | null>(
    () => (target ? locateItem(target, { numPages, pageSizes, renderedWidth }) : null),
    [target, numPages, pageSizes, renderedWidth],
  );

  const scrollToPage = useCallback((page: number) => {
    const sc = scrollRef.current;
    const pageEl = pageRefs.current[page];
    if (!sc || !pageEl) return;
    sc.scrollTo?.({ top: Math.max(0, pageEl.offsetTop - 12), behavior: "smooth" });
    setCurrentPage(page);
  }, []);

  // Move the hand: the page's offset within the stack, plus the item's point on that page.
  // Scrolls the target page into view first so the reader sees the hand arrive, on any page.
  useEffect(() => {
    if (!location || location.kind === "unknown-box" || location.kind === "unknown-page") {
      setHand(null);
      return;
    }
    if (location.kind === "page-not-measured") {
      // The page exists but hasn't rendered yet; get it on screen and re-run once it has.
      scrollToPage(location.page);
      setHand(null);
      return;
    }
    const pageEl = pageRefs.current[location.page];
    if (!pageEl || !stackRef.current) return;
    const x = pageEl.offsetLeft + location.hand.x;
    const y = pageEl.offsetTop + location.hand.y;
    setHand({ x, y });
    setCurrentPage(location.page);
    const sc = scrollRef.current;
    if (sc) sc.scrollTo?.({ top: Math.max(0, y - sc.clientHeight / 2), behavior: "smooth" });
  }, [location, scrollToPage]);

  const onScroll = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const offsets = Object.entries(pageRefs.current)
      .filter(([, el]) => el)
      .map(([p, el]) => ({ page: Number(p), top: el!.offsetTop }));
    const page = visiblePage(offsets, sc.scrollTop, sc.clientHeight);
    if (page !== null) setCurrentPage(page);
  }, []);

  const onDocumentLoad = useCallback((pdf: { numPages: number }) => {
    setError(null);
    setNumPages(pdf.numPages);
  }, []);

  const onPageLoad = useCallback((page: number, originalWidth: number, originalHeight: number) => {
    setPageSizes((prev) =>
      prev[page]?.width === originalWidth && prev[page]?.height === originalHeight
        ? prev
        : { ...prev, [page]: { width: originalWidth, height: originalHeight } },
    );
  }, []);

  // A city with no checklist document at all: the normal state for most cities today.
  if (!hasDocument) return <NoDocumentState cityName={cityName} />;
  // The PDF was requested and did not arrive. Name the URL: this already shipped broken once.
  if (error) return <LoadErrorState url={file} detail={error} />;

  const status = location ? locationMessage(location, numPages) : null;
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        numPages={numPages}
        currentPage={currentPage}
        zoom={zoom}
        onPage={scrollToPage}
        onZoom={(z) => setZoom(clampZoom(z))}
      />
      <p aria-live="polite" className="min-h-[1.25rem] px-4 text-xs text-[var(--color-ink-soft)]" data-testid="viewer-status">
        {status ?? ""}
      </p>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto px-4 pb-6 pt-2">
        <div ref={stackRef} className="relative mx-auto" style={{ width: renderedWidth }}>
          <Document
            file={file}
            options={PDF_OPTIONS}
            suspense={false}
            onLoadSuccess={onDocumentLoad}
            onLoadError={(e: Error) => setError(e.message)}
            onSourceError={(e: Error) => setError(e.message)}
            loading={<p className="p-6 text-sm text-[var(--color-ink-soft)]">Loading checklist…</p>}
            error={<LoadErrorState url={file} />}
          >
            {pageNumbers.map((p) => {
              const scale = pageScale(renderedWidth, pageSizes[p]?.width);
              return (
                <div
                  key={p}
                  data-testid={`viewer-page-${p}`}
                  ref={(el) => {
                    pageRefs.current[p] = el;
                  }}
                  className="relative mb-6 overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(59,42,32,0.15),0_8px_24px_rgba(59,42,32,0.08)]"
                >
                  <Page
                    pageNumber={p}
                    width={renderedWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(pg: { originalWidth: number; originalHeight: number }) =>
                      onPageLoad(p, pg.originalWidth, pg.originalHeight)
                    }
                  />
                  {scale !== null &&
                    checklist
                      .filter((c) => c.page === p)
                      .map((c) => {
                        const box = normalizeBox(c.box);
                        if (!box) return null; // No coordinates yet: nothing to draw, and we never guess.
                        return (
                          <ItemBox
                            key={c.id}
                            item={c}
                            state={items[c.id]}
                            rect={{
                              left: box[0] * scale,
                              top: box[1] * scale,
                              width: box[2] * scale,
                              height: box[3] * scale,
                            }}
                            pointed={c.id === pointedItem}
                            selected={c.id === selectedItem}
                            onSelect={onSelect}
                          />
                        );
                      })}
                  {numPages > 1 && (
                    <span className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-[var(--color-ink-soft)]">
                      {p} / {numPages}
                    </span>
                  )}
                </div>
              );
            })}
          </Document>
          <PointerHand x={hand?.x ?? 0} y={hand?.y ?? 0} visible={Boolean(hand)} tapKey={tapKey} />
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  numPages,
  currentPage,
  zoom,
  onPage,
  onZoom,
}: {
  numPages: number;
  currentPage: number;
  zoom: number;
  onPage: (page: number) => void;
  onZoom: (zoom: number) => void;
}) {
  const btn =
    "rounded-sm border border-[var(--color-line)] px-2 py-0.5 text-xs disabled:opacity-40 hover:bg-[var(--color-cream-deep)]";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-2">
      <div className="flex items-center gap-2">
        {numPages > 1 && (
          <>
            <button type="button" className={btn} onClick={() => onPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page">
              ‹
            </button>
            <span className="text-xs text-[var(--color-ink-soft)]" data-testid="viewer-page-indicator">
              Page {Math.min(currentPage, numPages)} of {numPages}
            </span>
            <button
              type="button"
              className={btn}
              onClick={() => onPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              aria-label="Next page"
            >
              ›
            </button>
          </>
        )}
        {numPages === 1 && <span className="text-xs text-[var(--color-ink-soft)]">1 page</span>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => onZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
          −
        </button>
        <span className="w-10 text-center text-xs text-[var(--color-ink-soft)]" data-testid="viewer-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={btn} onClick={() => onZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={btn} onClick={() => onZoom(1)} aria-label="Fit to width">
          Fit
        </button>
      </div>
    </div>
  );
}

function ItemBox({
  item,
  state,
  rect,
  pointed,
  selected,
  onSelect,
}: {
  item: ChecklistItem;
  state?: ItemState;
  rect: Rect;
  pointed: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const status = state?.status;
  const cls = [
    "item-box absolute rounded-[3px] transition-[background-color,box-shadow,border-color] duration-500",
    status === "complete" && "item-complete",
    status === "missing" && "item-missing",
    status === "unknown" && "item-unknown",
    state?.highlighted && "item-lawlens",
    pointed && "item-pointed",
    selected && "item-selected",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-testid={`item-box-${item.id}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onClick={() => onSelect?.(item.id)}
      aria-label={`${item.text}${status ? `, ${status}` : ""}`}
      title={item.text}
    >
      {status && <span className="item-badge">{status === "complete" ? "✓" : status === "missing" ? "!" : "?"}</span>}
    </button>
  );
}
