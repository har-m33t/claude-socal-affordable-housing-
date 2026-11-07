"use client";
import { useEffect, useRef } from "react";
import type { ChecklistItem, PacketFile } from "@/components/pointer/contract";
import type { ItemState } from "@/components/pointer/run-state";
import { CitationChip, StatusPill } from "@/components/ui/bits";

interface Props {
  checklist: ChecklistItem[];
  items: Record<string, ItemState>;
  packet: PacketFile[];
  pointedItem?: string;
  selectedItem?: string;
  onSelect: (id: string) => void;
  onDecide: (itemId: string, suggestionId: string, decision: "accepted" | "rejected") => void;
}

/** The applicant's draft packet: one section per checklist item, with suggestions to accept or reject. */
export function DraftPanel({ checklist, items, packet, pointedItem, selectedItem, onSelect, onDecide }: Props) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const focus = selectedItem ?? pointedItem;
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focus]);

  return (
    <div className="space-y-3">
      <details className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Uploaded packet · {packet.length} files (made up)</summary>
        <ul className="mt-2 space-y-1 text-[var(--color-ink-soft)]">
          {packet.map((f) => (
            <li key={f.name} className="flex justify-between gap-3 font-mono text-xs">
              <span className="truncate">{f.name}</span>
              <span className="shrink-0">{f.declared_type}</span>
            </li>
          ))}
        </ul>
      </details>

      {checklist.map((c, i) => {
        const st = items[c.id];
        const active = c.id === focus;
        return (
          <section
            key={c.id}
            ref={(el) => {
              refs.current[c.id] = el;
            }}
            onClick={() => onSelect(c.id)}
            className={`draft-item cursor-pointer rounded-md border bg-[var(--color-paper)] px-3 py-2.5 transition-colors ${
              active ? "border-[var(--color-terracotta)] ring-2 ring-[var(--color-terracotta)]/20" : "border-[var(--color-line)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[0.95rem] leading-snug">
                <span className="mr-1.5 tabular-nums text-[var(--color-ink-soft)]">{i + 1}.</span>
                {c.text}
              </h3>
              <StatusPill status={st?.status} />
            </div>

            {st?.statusText && <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{st.statusText}</p>}

            {st?.highlighted && st.highlightText && (
              <div className="lawlens-note mt-2 rounded border-l-4 px-2.5 py-1.5 text-sm">
                <span className="mr-1 font-semibold">Law Lens:</span>
                {st.highlightText.replace(/^Law Lens:\s*/i, "")}
              </div>
            )}

            {st?.suggestions.map((s) => (
              <div
                key={s.id}
                className={`suggestion mt-2 rounded border px-2.5 py-2 text-sm ${
                  s.decision === "accepted" ? "suggestion-accepted" : s.decision === "rejected" ? "suggestion-rejected" : ""
                }`}
              >
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-soft)]">
                  {s.decision === "pending" ? "Suggested draft" : s.decision === "accepted" ? "In your draft" : "Rejected"}
                </div>
                <p className={s.decision === "rejected" ? "line-through opacity-60" : ""}>{s.text}</p>
                {s.decision === "pending" && (
                  <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-accept" onClick={() => onDecide(c.id, s.id, "accepted")}>
                      Accept
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onDecide(c.id, s.id, "rejected")}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}

            {st?.notes.map((n, k) => (
              <p key={k} className="mt-2 rounded bg-[var(--color-cream-deep)] px-2.5 py-1.5 text-sm">
                <span className="mr-1 font-semibold">Note:</span>
                {n}
              </p>
            ))}

            {st && st.citations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                {dedupe(st.citations).map((c) => (
                  <CitationChip key={c.url} c={c} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function dedupe<T extends { url: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}
