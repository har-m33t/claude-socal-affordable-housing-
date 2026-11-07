"use client";
import { useEffect, useRef } from "react";
import type { ChecklistItem, Tool } from "@/components/pointer/contract";
import { CitationChip } from "@/components/ui/bits";
import type { LogRow } from "./log-rows";

const TOOL_LABEL: Record<Tool, string> = {
  point_to: "point_to",
  highlight: "highlight",
  mark_item: "mark_item",
  draft_field: "draft_field",
  add_note: "add_note",
};

const STATUS_WORDS: Record<string, string> = {
  started: "run started",
  step: "thinking",
  done: "run finished",
  stopped: "run stopped",
};

/**
 * Every frame the run produced, in arrival order: agent actions, actions the
 * law gate dropped, status beats, refusals and errors. A drop is the gate
 * working, so it is shown with its reason rather than hidden.
 */
export function ActionLog({
  rows,
  checklist,
  running,
  empty = "No actions yet.",
}: {
  rows: LogRow[];
  checklist: ChecklistItem[];
  running: boolean;
  empty?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Optional call: jsdom has no scrollIntoView, and a log that cannot scroll
    // itself is no reason to fail a render.
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [rows.length]);
  const num = (id: string | undefined) => {
    if (!id) return "general note";
    const i = checklist.findIndex((c) => c.id === id);
    return i >= 0 ? `item ${i + 1}` : id;
  };

  return (
    <ol className="space-y-1.5 font-mono text-[0.78rem] leading-relaxed" aria-live="polite">
      {rows.length === 0 && <li className="text-[var(--color-ink-soft)]">{empty}</li>}
      {rows.map((row) => {
        if (row.kind === "action") {
          return (
            <li key={row.key} className={`log-row ${row.rejected ? "log-rejected" : ""}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="log-tool">{TOOL_LABEL[row.event.tool]}</span>
                <span className="text-[var(--color-ink-soft)]">{num(row.event.item_id)}</span>
                {row.event.status && <span className={`log-status log-status-${row.event.status}`}>{row.event.status}</span>}
              </div>
              {row.rejected ? (
                <div className="text-[var(--color-missing)]">Ignored: {row.rejected}</div>
              ) : (
                row.event.text && <div className="font-sans text-[0.82rem] text-[var(--color-ink)]">{row.event.text}</div>
              )}
              {row.citation && (
                <div className="mt-1 font-sans">
                  <CitationChip c={row.citation} />
                </div>
              )}
            </li>
          );
        }
        if (row.kind === "dropped") {
          return (
            <li key={row.key} className="log-row log-rejected">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="log-tool">dropped</span>
                {row.tool && <span className="text-[var(--color-ink-soft)]">{row.tool}</span>}
                {row.itemId && <span className="text-[var(--color-ink-soft)]">{num(row.itemId)}</span>}
              </div>
              <div className="font-sans text-[0.82rem] text-[var(--color-missing)]">
                <span className="font-semibold">Law gate refused this action:</span> {row.reason}
              </div>
            </li>
          );
        }
        if (row.kind === "status") {
          return (
            <li key={row.key} className="log-row border-l-2 border-[var(--color-line)] pl-2 text-[var(--color-ink-soft)]">
              <span className="log-tool opacity-70">status</span>{" "}
              <span>{STATUS_WORDS[row.phase] ?? row.phase}</span>
              {typeof row.step === "number" && <span className="ml-1 tabular-nums">step {row.step}</span>}
              {row.detail && <div className="font-sans text-[0.82rem]">{row.detail}</div>}
            </li>
          );
        }
        if (row.kind === "refusal") {
          return (
            <li key={row.key} className="log-row log-rejected">
              <span className="log-tool">refusal</span>
              <div className="font-sans text-[0.82rem] text-[var(--color-missing)]">
                <span className="font-semibold">The agent refused:</span> {row.reason}
              </div>
            </li>
          );
        }
        return (
          <li key={row.key} className="log-row log-rejected">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="log-tool">error</span>
              <span className="text-[var(--color-ink-soft)]">{row.code}</span>
            </div>
            <div className="font-sans text-[0.82rem] text-[var(--color-missing)]">{row.message}</div>
          </li>
        );
      })}
      {running && (
        <li className="flex items-center gap-2 text-[var(--color-ink-soft)]">
          <span className="thinking-dot" />
          working…
        </li>
      )}
      <div ref={endRef} />
    </ol>
  );
}
