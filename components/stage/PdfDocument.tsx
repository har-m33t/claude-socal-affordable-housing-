"use client";
/**
 * A city PDF from the plan, rendered with react-pdf, with one overlay box per plan
 * target on it. Box positions come from the plan's precomputed [x, y, w, h] in PDF
 * points (top-left origin), scaled to the rendered width; never from matching text.
 * Each box carries `data-target-id`, which is all the PointerLayer needs.
 *
 * Generic over documents: any number of pages and targets. Pages render at the
 * width of the pane (capped), and re-render when the pane resizes.
 *
 * Animations:
 *   box state   Overlay boxes transition background, border and shadow over
 *               --dur-slow as the run marks them (classes item-complete/missing/
 *               unknown/lawlens/pointed/selected from globals.css).
 *   .stage-box-answer  A blue ring on the box the answer pointer is on, faded in
 *               over --dur-slow (stage.css).
 * Reduced motion: colour changes are instant (stage.css).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import type { PlanDocument, PlanTarget } from "@/components/pointer/plan";
import type { ItemState } from "@/components/pointer/run-state";
import { PDF_OPTIONS } from "./pdfjs";

const MAX_PAGE_WIDTH = 760;
/** Letter width in points; used until a page reports its real size. */
const DEFAULT_PAGE_WIDTH = 612;

interface Props {
  doc: PlanDocument;
  targets: PlanTarget[];
  items: Record<string, ItemState>;
  planTargetId?: string;
  answerTargetId?: string;
  selectedTargetId?: string;
  onSelectTarget: (id: string) => void;
}

export function PdfDocument({ doc, targets, items, planTargetId, answerTargetId, selectedTargetId, onSelectTarget }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageWidths, setPageWidths] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fit = (w: number) => setWidth(Math.max(240, Math.min(MAX_PAGE_WIDTH, Math.floor(w))));
    fit(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) fit(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!doc.url) return <Notice title="This document has no file to show." />;
  if (error) return <Notice title={`Could not load “${doc.title}”.`} detail={error} />;

  return (
    <div ref={frameRef} className="w-full">
      {width > 0 && (
        <div className="relative mx-auto" style={{ width }}>
          <Document
            file={doc.url}
            options={PDF_OPTIONS}
            onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
            onLoadError={(e) => setError(e.message)}
            loading={<p className="p-6 text-sm text-[var(--fg-muted)]">Loading {doc.title}…</p>}
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
              const scale = width / (pageWidths[p] ?? DEFAULT_PAGE_WIDTH);
              return (
                <div key={p} className="stage-page" aria-label={`Page ${p} of ${numPages}`} role="group">
                  <Page
                    pageNumber={p}
                    width={width}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(pg) =>
                      setPageWidths((prev) => (prev[p] === pg.originalWidth ? prev : { ...prev, [p]: pg.originalWidth }))
                    }
                  />
                  {pageWidths[p] &&
                    targets
                      .filter((t) => t.page === p && t.box)
                      .map((t) => (
                        <TargetBox
                          key={t.id}
                          target={t}
                          state={items[t.id]}
                          scale={scale}
                          pointed={t.id === planTargetId}
                          answered={t.id === answerTargetId}
                          selected={t.id === selectedTargetId}
                          onSelect={onSelectTarget}
                        />
                      ))}
                </div>
              );
            })}
          </Document>
        </div>
      )}
    </div>
  );
}

const BADGE = { complete: "✓", missing: "!", unknown: "?" } as const;

function TargetBox({
  target,
  state,
  scale,
  pointed,
  answered,
  selected,
  onSelect,
}: {
  target: PlanTarget;
  state?: ItemState;
  scale: number;
  pointed: boolean;
  answered: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [x, y, w, h] = target.box!;
  const status = state?.status;
  const cls = [
    "item-box stage-box",
    status && `item-${status}`,
    state?.highlighted && "item-lawlens",
    pointed && "item-pointed",
    answered && "stage-box-answer",
    selected && "item-selected",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      data-target-id={target.id}
      className={cls}
      style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale }}
      onClick={() => onSelect(target.id)}
      aria-label={`${target.label}${status ? `, ${status}` : ""}`}
      aria-pressed={selected}
      title={target.label}
    >
      {status && (
        <span className="item-badge" aria-hidden>
          {BADGE[status]}
        </span>
      )}
    </button>
  );
}

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="mx-auto mt-6 max-w-xl rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--bg)] p-4 text-sm">
      <p className="font-semibold text-[var(--danger)]">{title}</p>
      {detail && <p className="mt-1 text-[var(--fg-muted)]">{detail}</p>}
    </div>
  );
}
