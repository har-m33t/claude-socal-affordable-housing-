"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
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
import { readiness } from "@/components/pointer/run-state";
import { ActionLog } from "./ActionLog";
import { DraftPanel } from "./DraftPanel";
import { Pickers } from "./Pickers";

const ChecklistViewer = dynamic(() => import("@/components/pdf/ChecklistViewer"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--color-ink-soft)]">Loading viewer…</p>,
});

export function Editor() {
  const [cityName, setCityName] = useState(DEFAULT_CITY);
  const [typeId, setTypeId] = useState(DEFAULT_TYPE);
  const [selected, setSelected] = useState<string | undefined>();
  const [speed, setSpeed] = useState(1);
  const city = getCityConfig(cityName);
  const { events, dropped } = useMemo(loadMockEvents, []);
  const r = useReplay(events, city, speed);

  if (!city || !city.verified) {
    // Unreachable through the pickers; kept so a bad default can never produce advice.
    return <p className="p-8">{cityName} is not yet verified. Pointer gives no guidance for it.</p>;
  }
  const ready = readiness(r.run, city);
  const running = r.play === "playing";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] px-5 py-3">
        <Pickers cities={COVERAGE} types={PROJECT_TYPES} city={cityName} type={typeId} onCity={setCityName} onType={setTypeId} />
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" className="btn btn-primary" onClick={r.pause}>
              Pause
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={r.start} disabled={r.play === "done" || r.play === "stopped"}>
              {r.play === "idle" ? "Play mock run" : r.play === "done" ? "Run complete" : r.play === "stopped" ? "Stopped" : "Resume"}
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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)]">
        <section aria-label="City checklist" className="relative min-h-[60vh] border-r border-[var(--color-line)] bg-[var(--color-cream-deep)] lg:min-h-0">
          <div className="absolute inset-0">
            <ChecklistViewer
              file={city.checklist_pdf ?? ""}
              checklist={city.checklist}
              items={r.run.items}
              pointedItem={r.run.pointedItem}
              selectedItem={selected}
              onSelect={setSelected}
              tapKey={r.cursor}
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
            {city.city} · checklist checked {city.checked_date ?? "unknown"} · the made-up applicant from the mock packet
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <DraftPanel
              checklist={city.checklist}
              items={r.run.items}
              packet={PACKET_FILES}
              pointedItem={r.run.pointedItem}
              selectedItem={selected}
              onSelect={setSelected}
              onDecide={r.decide}
            />
            {r.play === "done" && (
              <Link href="/report" className="btn btn-primary mt-4 inline-flex">
                View readiness report →
              </Link>
            )}
          </div>

          <div className="flex h-[38%] min-h-[220px] flex-col border-t border-[var(--color-line)] bg-[var(--color-paper)]">
            <div className="flex items-baseline justify-between px-5 pt-3">
              <h2 className="font-serif text-lg">Action log</h2>
              <span className="text-xs tabular-nums text-[var(--color-ink-soft)]">
                {r.cursor}/{r.total} actions
                {r.play === "stopped" && <span className="ml-2 font-semibold text-[var(--color-missing)]">stopped by you</span>}
                {dropped > 0 && <span className="ml-2 text-[var(--color-missing)]">{dropped} malformed dropped</span>}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              <ActionLog log={r.run.log} checklist={city.checklist} running={running} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
