"use client";
/**
 * Document tabs across the top of the stage, GitHub underline-tab style
 * (`.underline-tab` with `data-active`). Each tab: the document's title, a
 * "made up" label for the demo packet, a counter of targets the run has checked,
 * and, when the homeowner's step is on a document that is not on screen, a small
 * terracotta "Step N" marker on that document's tab.
 *
 * A proper WAI-ARIA tablist: roving tabindex, Left/Right/Home/End move focus and
 * select (automatic activation), each tab controls its panel.
 *
 * Animations:
 *   .underline-tab  (design lane) The active underline.
 *   .anim-pop       (design lane) The Step marker pops in when it appears.
 * Reduced motion: handled by the utilities.
 */
import { useRef, type KeyboardEvent } from "react";
import type { Plan } from "@/components/pointer/plan";
import type { ItemState } from "@/components/pointer/run-state";
import { docProgress, stepMarker } from "./model";

export const tabId = (docId: string) => `stage-tab-${docId}`;
export const panelId = (docId: string) => `stage-panel-${docId}`;

export function DocTabs({
  plan,
  activeDocId,
  items,
  planTargetId,
  onSelectDoc,
}: {
  plan: Plan;
  activeDocId: string;
  items: Record<string, ItemState>;
  planTargetId?: string;
  onSelectDoc: (docId: string) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const marker = stepMarker(plan, planTargetId, activeDocId);
  const ids = plan.documents.map((d) => d.id);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = ids.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onSelectDoc(ids[to]);
    refs.current[ids[to]]?.focus();
  }

  return (
    <div role="tablist" aria-label="Documents" className="stage-tabs">
      {plan.documents.map((d, i) => {
        const active = d.id === activeDocId;
        const { reviewed, total } = docProgress(plan, d.id, items);
        return (
          <button
            key={d.id}
            ref={(el) => {
              refs.current[d.id] = el;
            }}
            id={tabId(d.id)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={panelId(d.id)}
            tabIndex={active ? 0 : -1}
            data-active={active}
            className="underline-tab stage-tab"
            title={d.title}
            onClick={() => onSelectDoc(d.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {d.kind === "packet" ? <FolderIcon /> : <PdfIcon />}
            <span className="stage-tab-title">{d.title.replace(/\s*\(made up\)\s*$/i, "")}</span>
            {d.made_up && <span className="stage-made-up">made up</span>}
            {total > 0 && (
              <span className="stage-counter" title={`${reviewed} of ${total} checked`}>
                {reviewed}/{total}
                <span className="sr-only"> checked</span>
              </span>
            )}
            {marker?.docId === d.id && (
              <span className="stage-step-marker anim-pop">
                <span aria-hidden className="stage-step-dot" />
                {marker.label}
                <span className="sr-only"> is on this document</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PdfIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
    </svg>
  );
}
