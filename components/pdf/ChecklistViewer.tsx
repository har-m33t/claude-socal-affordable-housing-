"use client";
// The city checklist PDF, with one overlay box per checklist item and the pointer hand.
// Item boxes come from the city config (precomputed), never from matching text the agent quoted.
// Load this module with next/dynamic and ssr: false: pdf.js needs the browser.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { ChecklistItem } from "@/components/pointer/contract";
import type { ItemState } from "@/components/pointer/run-state";
import { PointerHand } from "./PointerHand";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// pdf.js scripting stays off; we only render pages.
const PDF_OPTIONS = { enableXfa: false } as const;
const MAX_PAGE_WIDTH = 680;

interface Props {
  file: string;
  checklist: ChecklistItem[];
  items: Record<string, ItemState>;
  pointedItem?: string;
  selectedItem?: string;
  onSelect?: (id: string) => void;
  tapKey: number;
}

export default function ChecklistViewer({ file, checklist, items, pointedItem, selectedItem, onSelect, tapKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [numPages, setNumPages] = useState(0);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [width, setWidth] = useState(MAX_PAGE_WIDTH);
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(entry.contentRect.width) - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scaleFor = useCallback((page: number) => width / (sizes[page]?.w ?? 612), [sizes, width]);

  const target = useMemo(() => checklist.find((c) => c.id === pointedItem), [checklist, pointedItem]);

  // Move the hand: the page's offset within the stack, plus the item box scaled to the rendered width.
  useEffect(() => {
    if (!target) return;
    const pageEl = pageRefs.current[target.page];
    const stack = stackRef.current;
    if (!pageEl || !stack || !sizes[target.page]) return;
    const s = scaleFor(target.page);
    const [bx, by, bw, bh] = target.box;
    const x = pageEl.offsetLeft + (bx + Math.min(bw * 0.06, 28)) * s;
    const y = pageEl.offsetTop + (by + bh * 0.55) * s;
    setHand({ x, y });
    const sc = scrollRef.current;
    if (sc) sc.scrollTo({ top: Math.max(0, y - sc.clientHeight / 2), behavior: "smooth" });
  }, [target, sizes, scaleFor, width]);

  if (error) {
    return (
      <div className="m-6 rounded-lg border border-[var(--color-missing)] bg-[var(--color-paper)] p-4 text-sm">
        <p className="font-semibold text-[var(--color-missing)]">Could not load the checklist PDF.</p>
        <p className="mt-1 text-[var(--color-ink-soft)]">{error}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden px-4 py-6">
      <div ref={stackRef} className="relative mx-auto" style={{ width }}>
        <Document
          file={file}
          options={PDF_OPTIONS}
          suspense={false}
          onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
          onLoadError={(e) => setError(e.message)}
          loading={<p className="p-6 text-sm text-[var(--color-ink-soft)]">Loading checklist…</p>}
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
            const s = scaleFor(p);
            return (
              <div
                key={p}
                ref={(el) => {
                  pageRefs.current[p] = el;
                }}
                className="relative mb-6 overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(59,42,32,0.15),0_8px_24px_rgba(59,42,32,0.08)]"
              >
                <Page
                  pageNumber={p}
                  width={width}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={(pg) =>
                    setSizes((prev) =>
                      prev[p]?.w === pg.originalWidth ? prev : { ...prev, [p]: { w: pg.originalWidth, h: pg.originalHeight } },
                    )
                  }
                />
                {sizes[p] &&
                  checklist
                    .filter((c) => c.page === p)
                    .map((c) => (
                      <ItemBox
                        key={c.id}
                        item={c}
                        state={items[c.id]}
                        scale={s}
                        pointed={c.id === pointedItem}
                        selected={c.id === selectedItem}
                        onSelect={onSelect}
                      />
                    ))}
              </div>
            );
          })}
        </Document>
        <PointerHand x={hand?.x ?? 0} y={hand?.y ?? 0} visible={Boolean(hand && target)} tapKey={tapKey} />
      </div>
    </div>
  );
}

function ItemBox({
  item,
  state,
  scale,
  pointed,
  selected,
  onSelect,
}: {
  item: ChecklistItem;
  state?: ItemState;
  scale: number;
  pointed: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const [x, y, w, h] = item.box;
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
      style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale }}
      onClick={() => onSelect?.(item.id)}
      aria-label={`${item.text}${status ? `, ${status}` : ""}`}
      title={item.text}
    >
      {status && <span className="item-badge">{status === "complete" ? "✓" : status === "missing" ? "!" : "?"}</span>}
    </button>
  );
}
