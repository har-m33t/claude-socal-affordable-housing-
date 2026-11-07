"use client";
import { useEffect, useRef } from "react";
import type { ChecklistItem, Tool } from "@/components/pointer/contract";
import type { LogEntry } from "@/components/pointer/run-state";
import { CitationChip } from "@/components/ui/bits";

const TOOL_LABEL: Record<Tool, string> = {
  point_to: "point_to",
  highlight: "highlight",
  mark_item: "mark_item",
  draft_field: "draft_field",
  add_note: "add_note",
};

export function ActionLog({ log, checklist, running }: { log: LogEntry[]; checklist: ChecklistItem[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length]);
  const num = (id: string) => {
    const i = checklist.findIndex((c) => c.id === id);
    return i >= 0 ? `item ${i + 1}` : id;
  };

  return (
    <ol className="space-y-1.5 font-mono text-[0.78rem] leading-relaxed" aria-live="polite">
      {log.length === 0 && <li className="text-[var(--color-ink-soft)]">No actions yet. Press Play to start the mock run.</li>}
      {log.map((l) => (
        <li key={l.index} className={`log-row ${l.rejected ? "log-rejected" : ""}`}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="log-tool">{TOOL_LABEL[l.event.tool]}</span>
            <span className="text-[var(--color-ink-soft)]">{num(l.event.item_id)}</span>
            {l.event.status && <span className={`log-status log-status-${l.event.status}`}>{l.event.status}</span>}
          </div>
          {l.rejected ? (
            <div className="text-[var(--color-missing)]">Ignored: {l.rejected}</div>
          ) : (
            l.event.text && <div className="font-sans text-[0.82rem] text-[var(--color-ink)]">{l.event.text}</div>
          )}
          {l.citation && (
            <div className="mt-1 font-sans">
              <CitationChip c={l.citation} />
            </div>
          )}
        </li>
      ))}
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
