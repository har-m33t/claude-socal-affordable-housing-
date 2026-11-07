"use client";
// The editor wires the plan run, the answer session and the two halves of the
// screen together. It owns only cross-cutting state: which document is on screen
// and where the answer pointer is. Everything visual lives in DocumentStage
// (left) and Sidebar (right); their props are frozen in ui-contract.ts.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_CITY, DEFAULT_TYPE, PACKET_FILES, PLAN, getCityConfig, loadMockEvents } from "@/components/pointer/config";
import { stepIndexOf, stepLabel, targetById } from "@/components/pointer/plan";
import type { AnswerPointerView } from "@/components/pointer/answer";
import { useReplay } from "@/components/pointer/use-replay";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { getAnswerProvider } from "@/lib/answer";

const DocumentStage = dynamic(() => import("@/components/stage/DocumentStage"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--fg-muted)]">Loading documents…</p>,
});

const NO_ANSWER: AnswerPointerView = { pulsePlan: false };

export function Editor() {
  const city = getCityConfig(DEFAULT_CITY);
  const { events } = useMemo(loadMockEvents, []);
  // Events may name any plan target (checklist boxes, form fields, file slots).
  const scope = useMemo(() => ({ checklist: PLAN.targets }), []);
  const r = useReplay(events, scope);
  const provider = useMemo(getAnswerProvider, []);

  const [answer, setAnswer] = useState<AnswerPointerView>(NO_ANSWER);
  const [backSignal, setBackSignal] = useState(0);
  const [selected, setSelected] = useState<string | undefined>();
  // A tab the homeowner clicked wins until the plan or the answer moves on.
  const [manualDoc, setManualDoc] = useState<string | undefined>();

  const planTargetId = r.run.pointedItem;
  const stepIndex = stepIndexOf(PLAN, planTargetId);
  const stepDoc = PLAN.steps[Math.max(0, stepIndex)]?.doc ?? PLAN.documents[0].id;
  const answerDoc = targetById(PLAN, answer.targetId)?.doc;

  useEffect(() => setManualDoc(undefined), [planTargetId, answer.targetId]);
  const activeDocId = manualDoc ?? answerDoc ?? stepDoc;

  const backToStep = useCallback(() => {
    setAnswer(NO_ANSWER);
    setManualDoc(undefined);
    setBackSignal((n) => n + 1);
  }, []);

  if (!city || !city.verified) {
    // Unreachable for the default city; kept so a bad default can never produce advice.
    return <p className="p-8">{DEFAULT_CITY} is not yet verified. Pointer gives no guidance for it.</p>;
  }

  return (
    <div className="editor-shell flex min-h-0 flex-1">
      <section aria-label="Documents" className="relative min-w-0 flex-1 bg-[var(--bg-subtle)]">
        <DocumentStage
          plan={PLAN}
          activeDocId={activeDocId}
          onSelectDoc={setManualDoc}
          items={r.run.items}
          packet={PACKET_FILES}
          planTargetId={planTargetId}
          planLabel={stepLabel(PLAN, stepIndex)}
          answer={answer}
          onBackToStep={backToStep}
          tapKey={r.cursor}
          selectedTargetId={selected}
          onSelectTarget={setSelected}
        />
      </section>
      <Sidebar
        plan={PLAN}
        items={r.run.items}
        log={r.run.log}
        stepIndex={stepIndex}
        planTargetId={planTargetId}
        play={r.play}
        controls={{ start: r.start, pause: r.pause, step: r.step, stop: r.stop, reset: r.reset }}
        onDecide={r.decide}
        onSelectTarget={setSelected}
        provider={provider}
        city={city.city}
        projectType={DEFAULT_TYPE}
        onAnswerPointer={setAnswer}
        backToStepSignal={backSignal}
        onBackToStep={backToStep}
      />
    </div>
  );
}
