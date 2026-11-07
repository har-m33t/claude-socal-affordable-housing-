"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  COVERAGE,
  DEFAULT_CITY,
  DEFAULT_TYPE,
  PACKET_FILES,
  PROJECT_TYPES,
  getCityConfig,
  loadMockEvents,
} from "@/components/pointer/config";
import { useReplay } from "@/components/pointer/use-replay";
import { useLiveRun } from "@/components/pointer/use-live-run";
import { readiness } from "@/components/pointer/run-state";
import { ActionLog } from "./ActionLog";
import { DraftPanel } from "./DraftPanel";
import { Pickers } from "./Pickers";
import { QuestionBar, DEFAULT_QUESTION, type RunMode } from "./QuestionBar";
import { RunNotice } from "./RunNotice";
import { rowsFromFrames, rowsFromLog } from "./log-rows";

const ChecklistViewer = dynamic(() => import("@/components/pdf/ChecklistViewer"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--color-ink-soft)]">Loading viewer…</p>,
});

const PHASE_LABEL: Record<string, string> = {
  idle: "not started",
  connecting: "connecting…",
  running: "running",
  done: "finished",
  stopped: "stopped by you",
  error: "failed",
};

export function Editor() {
  const [cityName, setCityName] = useState(DEFAULT_CITY);
  const [typeId, setTypeId] = useState(DEFAULT_TYPE);
  const [selected, setSelected] = useState<string | undefined>();
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<RunMode>("live");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const city = getCityConfig(cityName);
  const { events, dropped } = useMemo(loadMockEvents, []);
  const r = useReplay(events, city, speed);
  const live = useLiveRun({ city, cityName, projectType: typeId, question });

  // Only one run drives the screen at a time: switching modes quiets the other
  // one rather than leaving it streaming or ticking in the background.
  const changeMode = useCallback(
    (m: RunMode) => {
      setMode(m);
      if (m === "live") r.pause();
      else live.stop();
    },
    [live, r],
  );

  // The 503 path: a reviewer with no API key gets the recorded run in one click.
  const runScripted = useCallback(() => {
    setMode("scripted");
    live.reset();
    r.start();
  }, [live, r]);

  if (!city || !city.verified) {
    // Unreachable through the pickers; kept so a bad default can never produce advice.
    return <p className="p-8">{cityName} is not yet verified. Pointer gives no guidance for it.</p>;
  }

  const isLive = mode === "live";
  const liveBusy = live.phase === "connecting" || live.phase === "running";
  const run = isLive ? live.state : r.run;
  const running = isLive ? liveBusy : r.play === "playing";
  const rows = isLive ? rowsFromFrames(live.frames) : rowsFromLog(r.run.log);
  const ready = readiness(run, city);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] px-5 py-3">
        <Pickers cities={COVERAGE} types={PROJECT_TYPES} city={cityName} type={typeId} onCity={setCityName} onType={setTypeId} />
        {!isLive && (
          <div className="flex flex-wrap items-center gap-2">
            {r.play === "playing" ? (
              <button type="button" className="btn btn-primary" onClick={r.pause}>
                Pause
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={r.start} disabled={r.play === "done" || r.play === "stopped"}>
                {r.play === "idle" ? "Play scripted run" : r.play === "done" ? "Run complete" : r.play === "stopped" ? "Stopped" : "Resume"}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={r.step} disabled={r.play === "done" || r.play === "stopped"}>
              Step
            </button>
            <button type="button" className="btn btn-stop" onClick={r.stop} disabled={r.play === "stopped" || r.play === "done" || r.play === "idle"}>
              Stop agent
            </button>
            <button type="button" className="btn btn-ghost" onClick={r.reset}>
              Restart
            </button>
            <label className="ml-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
              Speed
              <select className="picker-select !w-auto !min-w-0 !py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <QuestionBar
        mode={mode}
        onMode={changeMode}
        question={question}
        onQuestion={setQuestion}
        phase={live.phase}
        onRun={live.start}
        onStop={live.stop}
        busy={liveBusy}
      />

      {isLive && live.error && (
        <div className="px-5 pb-3">
          <RunNotice error={live.error} onScripted={runScripted} />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)]">
        <section aria-label="City checklist" className="relative min-h-[60vh] border-r border-[var(--color-line)] bg-[var(--color-cream-deep)] lg:min-h-0">
          <div className="absolute inset-0">
            <ChecklistViewer
              file={city.checklist_pdf ?? ""}
              checklist={city.checklist}
              items={run.items}
              pointedItem={run.pointedItem}
              selectedItem={selected}
              onSelect={setSelected}
              tapKey={isLive ? live.state.log.length : r.cursor}
            />
          </div>
        </section>

        <section aria-label="Draft and action log" className="flex min-h-0 flex-col">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
            <h2 className="font-serif text-xl">Your draft packet</h2>
            <div className="flex gap-2 text-xs">
              <span className="pill pill-complete">{ready.complete.length} complete</span>
              <span className="pill pill-missing">{ready.missing.length} missing</span>
              <span className="pill pill-unknown">{ready.unknown.length} unknown</span>
            </div>
          </div>
          <p className="px-5 pt-1 text-xs text-[var(--color-ink-soft)]">
            {city.city} · checklist checked {city.checked_date ?? "unknown"} ·{" "}
            <span className="font-semibold">
              {isLive ? "live agent run, driven by your question" : "scripted replay of a recorded run"}
            </span>{" "}
            · the made-up applicant from the mock packet
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <DraftPanel
              checklist={city.checklist}
              items={run.items}
              packet={PACKET_FILES}
              pointedItem={run.pointedItem}
              selectedItem={selected}
              onSelect={setSelected}
              onDecide={isLive ? live.decide : r.decide}
            />
            {!isLive && r.play === "done" && (
              <Link href="/report" className="btn btn-primary mt-4 inline-flex">
                View readiness report →
              </Link>
            )}
            {isLive && live.phase === "done" && (
              // The report page folds the scripted fixture, not this run, so
              // linking to it from a live run would show someone else's answer.
              <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
                The readiness report still covers the scripted run only. Switch to Scripted replay to see it.
              </p>
            )}
          </div>

          <div className="flex h-[38%] min-h-[220px] flex-col border-t border-[var(--color-line)] bg-[var(--color-paper)]">
            <div className="flex items-baseline justify-between px-5 pt-3">
              <h2 className="font-serif text-lg">Action log</h2>
              <span className="text-xs tabular-nums text-[var(--color-ink-soft)]">
                {isLive ? (
                  <>
                    live · {live.frames.length} frames
                    <span className="ml-2">{PHASE_LABEL[live.phase] ?? live.phase}</span>
                  </>
                ) : (
                  <>
                    scripted · {r.cursor}/{r.total} actions
                    {r.play === "stopped" && <span className="ml-2 font-semibold text-[var(--color-missing)]">stopped by you</span>}
                    {dropped > 0 && <span className="ml-2 text-[var(--color-missing)]">{dropped} malformed dropped</span>}
                  </>
                )}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              <ActionLog
                rows={rows}
                checklist={city.checklist}
                running={running}
                empty={isLive ? "No actions yet. Type a question and press Run live agent." : "No actions yet. Press Play to start the scripted run."}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
