"use client";
// The editor wires the plan run, the answer session and the two halves of the
// screen together. It owns only cross-cutting state: the city, which document is
// on screen, where the answer pointer is, and the files added on this device.
// Everything visual lives in DocumentStage (left) and Sidebar (right); their
// props are frozen in ui-contract.ts.
//
// Runs: "Check my packet" is a live run (the packet, redacted in this browser,
// goes to /api/agent and Claude's tool calls drive the pointer). "Play recorded
// run" replays fixtures/plan-run.json. Either way the sidebar is told which one
// it is showing; a live run that cannot happen says so and plays the recording.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CityPicker } from "@/components/coverage/CityPicker";
import { UnverifiedCityNotice } from "@/components/coverage/UnverifiedCityNotice";
import { DEFAULT_CITY, DEFAULT_TYPE, PACKET_FILES, getCityConfig, loadMockEvents, planFor } from "@/components/pointer/config";
import { stepIndexOf, stepLabel, targetById } from "@/components/pointer/plan";
import type { AnswerPointerView } from "@/components/pointer/answer";
import type { AddedDocument } from "@/components/pointer/documents";
import { useRun } from "@/components/pointer/use-replay";
import { publishRun } from "@/components/pointer/last-run";
import { Sidebar } from "@/components/sidebar/Sidebar";
import applicant from "@/data/packet/applicant.json";
import { getAnswerProvider } from "@/lib/answer";
import { preparePacketRun } from "@/lib/live/packet";

const DocumentStage = dynamic(() => import("@/components/stage/DocumentStage"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--fg-muted)]">Loading documents…</p>,
});

const NO_ANSWER: AnswerPointerView = { pulsePlan: false };
const IDLE_NOTE = "Recorded run, not live. Press “Check my packet” to have Claude check your files.";
const RECORDED_NOTE = "Recorded run, not live: a replay of an earlier check.";

export function Editor() {
  const [cityName, setCityName] = useState(DEFAULT_CITY);
  const verified = getCityConfig(cityName)?.verified === true;
  // No advice without a verified city, and no run without a plan for it.
  const plan = verified ? planFor(cityName, DEFAULT_TYPE) : undefined;

  const { events } = useMemo(loadMockEvents, []);
  // Events may name any plan target (checklist boxes, form fields, file slots).
  const scope = useMemo(() => (plan ? { checklist: plan.targets } : undefined), [plan]);
  const r = useRun(scope, events);
  // Hand the run (with the homeowner's accept/reject decisions) to the readiness report, in memory.
  useEffect(() => {
    if (r.run.log.length > 0) publishRun({ run: r.run, mode: r.mode, city: cityName });
  }, [r.run, r.mode, cityName]);
  const provider = useMemo(getAnswerProvider, []);

  const [answer, setAnswer] = useState<AnswerPointerView>(NO_ANSWER);
  const [backSignal, setBackSignal] = useState(0);
  const [selected, setSelected] = useState<string | undefined>();
  // Files added on this device, redacted. Owned here so a live run can send them.
  const [addedFiles, setAddedFiles] = useState<AddedDocument[]>([]);
  const addFile = useCallback((d: AddedDocument) => setAddedFiles((fs) => [...fs, d]), []);
  const removeFile = useCallback((id: string) => setAddedFiles((fs) => fs.filter((f) => f.id !== id)), []);
  // A tab the homeowner clicked wins until the plan or the answer moves on.
  const [manualDoc, setManualDoc] = useState<string | undefined>();

  // A different city is a different run: stop whatever was going.
  const { reset, startLive, playRecorded } = r;
  useEffect(() => {
    reset();
    setAnswer(NO_ANSWER);
    setSelected(undefined);
  }, [cityName, reset]);

  const planTargetId = r.run.pointedItem;
  const stepIndex = plan ? stepIndexOf(plan, planTargetId) : -1;
  const stepDoc = plan ? (plan.steps[Math.max(0, stepIndex)]?.doc ?? plan.documents[0].id) : "";
  const answerDoc = plan ? targetById(plan, answer.targetId)?.doc : undefined;

  useEffect(() => setManualDoc(undefined), [planTargetId, answer.targetId]);
  const activeDocId = manualDoc ?? answerDoc ?? stepDoc;

  const backToStep = useCallback(() => {
    setAnswer(NO_ANSWER);
    setManualDoc(undefined);
    setBackSignal((n) => n + 1);
  }, []);

  const checkPacket = useCallback(() => {
    void startLive((signal) =>
      preparePacketRun({ city: cityName, projectType: DEFAULT_TYPE, packet: PACKET_FILES, added: addedFiles, applicant, signal }),
    );
  }, [startLive, cityName, addedFiles]);

  const liveRunning = r.mode === "live" && (r.play === "playing" || r.play === "paused");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Run"
        className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2 md:px-6"
      >
        <CityPicker value={cityName} onChange={setCityName} id="editor-city" />
        <div className="ml-auto flex items-center gap-2">
          {/* What the last button press led to, right where it was pressed. Empty until a run starts. */}
          <p role="status" aria-live="polite" className="max-w-md text-right text-xs text-[var(--fg-muted)]">
            {plan && r.note ? (
              <>
                <span className={`pill ${r.mode === "live" ? "pill-complete" : "pill-unknown"} mr-1.5`}>
                  {r.mode === "live" ? "Live" : "Recorded"}
                </span>
                {r.note}
              </>
            ) : null}
          </p>
          <button type="button" className="btn btn-primary" onClick={checkPacket} disabled={!plan || liveRunning}>
            {liveRunning ? "Checking…" : "Check my packet"}
          </button>
          <button type="button" className="btn" onClick={() => playRecorded(RECORDED_NOTE)} disabled={!plan}>
            Play recorded run
          </button>
        </div>
      </div>

      {!verified ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
          <UnverifiedCityNotice city={cityName} />
        </div>
      ) : !plan ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
          <p className="mx-auto max-w-prose text-sm">
            {cityName} is verified, but nobody has written a step-by-step plan for its ADU forms yet, so there is nothing to
            check a packet against. Pointer will not improvise one.
          </p>
        </div>
      ) : (
        <div className="editor-shell flex min-h-0 flex-1">
          <section aria-label="Documents" className="relative min-w-0 flex-1 bg-[var(--bg-subtle)]">
            <DocumentStage
              plan={plan}
              activeDocId={activeDocId}
              onSelectDoc={setManualDoc}
              items={r.run.items}
              packet={PACKET_FILES}
              planTargetId={planTargetId}
              planLabel={stepLabel(plan, stepIndex)}
              answer={answer}
              onBackToStep={backToStep}
              tapKey={r.cursor}
              selectedTargetId={selected}
              onSelectTarget={setSelected}
              addedFiles={addedFiles}
              onAddFile={addFile}
              onRemoveFile={removeFile}
            />
          </section>
          <Sidebar
            plan={plan}
            items={r.run.items}
            log={r.run.log}
            stepIndex={stepIndex}
            planTargetId={planTargetId}
            play={r.play}
            controls={{ start: r.start, pause: r.pause, step: r.step, stop: r.stop, reset: r.reset }}
            onDecide={r.decide}
            onSelectTarget={setSelected}
            provider={provider}
            city={cityName}
            projectType={DEFAULT_TYPE}
            onAnswerPointer={setAnswer}
            backToStepSignal={backSignal}
            onBackToStep={backToStep}
            runMode={r.mode}
            runNote={r.note ?? (r.mode === "recorded" ? IDLE_NOTE : undefined)}
          />
        </div>
      )}
    </div>
  );
}
