"use client";
/**
 * The left half of the editor: document tabs, the active document (a city PDF or
 * the homeowner's file board) and the two pointers. Props are frozen in
 * components/pointer/ui-contract.ts; the editor decides which document is active.
 *
 *   DocumentStage
 *   ├─ DocTabs                 tablist; counters; "Step N" marker on the step's tab
 *   ├─ BackToStep (banner)     when the answer is on another document or page
 *   ├─ live region             "Answer is on <doc>, page N" for screen readers
 *   └─ DocPane × visited docs  one scroll container per document, kept mounted
 *      ├─ PdfDocument | FileBoard   every target renders [data-target-id]
 *      └─ PointerLayer              resolves ids -> positions; plan + answer hands
 *         └─ BackToStep (floating)  under the answer hand
 *
 * Panes mount the first time their document is shown and then stay mounted (just
 * hidden), so switching tabs is instant and each document keeps its scroll
 * position. Only the active pane measures or shows hands.
 *
 * Load with next/dynamic and ssr: false: pdf.js needs the browser.
 *
 * Animations (all listed in the sub-components' headers; keyframes in stage.css):
 *   .anim-fade-up  A pane fades up the first time it opens (design lane utility).
 *   Hands, tap, pulse, glide, scroll: PointerLayer and PointerHand.
 *   Tabs and Step marker: DocTabs. Cards and drawer: FileBoard. Boxes: PdfDocument.
 */
import "./stage.css";
import { useRef, useState } from "react";
import type { AnswerPointerView } from "@/components/pointer/answer";
import type { PacketFile } from "@/components/pointer/contract";
import type { Plan, PlanDocument } from "@/components/pointer/plan";
import type { ItemState } from "@/components/pointer/run-state";
import type { DocumentStageProps } from "@/components/pointer/ui-contract";
import { BackToStep } from "./BackToStep";
import { DocTabs, panelId, tabId } from "./DocTabs";
import { FileBoard } from "./FileBoard";
import { answerAnnouncement, handsFor, needsBackBanner, placeOf } from "./model";
import { PdfDocument } from "./PdfDocument";
import { PointerLayer } from "./PointerLayer";

export default function DocumentStage(props: DocumentStageProps) {
  const { plan, onSelectDoc, items, planTargetId, answer, onBackToStep } = props;
  const activeDocId = plan.documents.some((d) => d.id === props.activeDocId) ? props.activeDocId : plan.documents[0]?.id;

  // Documents shown at least once; their panes stay mounted.
  const [visited, setVisited] = useState<string[]>(activeDocId ? [activeDocId] : []);
  if (activeDocId && !visited.includes(activeDocId)) setVisited([...visited, activeDocId]);

  return (
    <div className="stage absolute inset-0 flex flex-col">
      <DocTabs plan={plan} activeDocId={activeDocId} items={items} planTargetId={planTargetId} onSelectDoc={onSelectDoc} />
      {needsBackBanner(plan, answer, planTargetId) && (
        <BackToStep key={answer.targetId} placement="banner" where={placeOf(plan, answer.targetId)} onBack={onBackToStep} />
      )}
      <p className="sr-only" aria-live="polite">
        {answerAnnouncement(plan, answer, planTargetId)}
      </p>
      <div className="relative min-h-0 flex-1">
        {plan.documents
          .filter((d) => visited.includes(d.id))
          .map((d) => (
            <DocPane key={d.id} {...props} doc={d} active={d.id === activeDocId} />
          ))}
      </div>
    </div>
  );
}

interface DocPaneProps {
  doc: PlanDocument;
  active: boolean;
  plan: Plan;
  items: Record<string, ItemState>;
  packet: PacketFile[];
  planTargetId?: string;
  planLabel: string;
  answer: AnswerPointerView;
  onBackToStep: () => void;
  tapKey: number;
  selectedTargetId?: string;
  onSelectTarget: (id: string) => void;
}

function DocPane({ doc, active, plan, items, packet, planTargetId, planLabel, answer, onBackToStep, tapKey, selectedTargetId, onSelectTarget }: DocPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hands = handsFor(plan, doc.id, planTargetId, answer);
  const shared = { items, planTargetId, answerTargetId: hands.answer, selectedTargetId, onSelectTarget };

  return (
    <div role="tabpanel" id={panelId(doc.id)} aria-labelledby={tabId(doc.id)} hidden={!active} className="stage-pane">
      <div ref={scrollRef} className="stage-scroll">
        <div className="stage-content anim-fade-up">
          {doc.kind === "pdf" ? (
            <>
              <SourceLine doc={doc} />
              <PdfDocument doc={doc} targets={plan.targets.filter((t) => t.doc === doc.id)} {...shared} />
            </>
          ) : (
            <FileBoard plan={plan} doc={doc} packet={packet} {...shared} />
          )}
        </div>
        <PointerLayer
          containerRef={scrollRef}
          active={active}
          planTargetId={hands.plan}
          planLabel={planLabel}
          pulsePlan={hands.pulsePlan}
          tapKey={tapKey}
          answerTargetId={hands.answer}
          onBackToStep={onBackToStep}
        />
      </div>
    </div>
  );
}

function SourceLine({ doc }: { doc: PlanDocument }) {
  if (!doc.source_url) return null;
  let host = doc.source_url;
  try {
    host = new URL(doc.source_url).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <p className="mx-auto mb-3 max-w-[760px] text-[12px] text-[var(--fg-muted)]">
      Source:{" "}
      <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="stage-link">
        {host}
      </a>
      {doc.checked_date ? <> · checked {doc.checked_date}</> : <> · not yet checked by a person</>}
    </p>
  );
}
