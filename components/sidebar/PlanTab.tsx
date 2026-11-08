"use client";
// The Plan tab: terse by design. The current step is the hero; finished steps fold
// into one row; what's left is a count. No explanatory paragraphs — explanations
// live in the Ask tab, on request.
import { useState } from "react";
import type { ItemStatus } from "@/components/pointer/contract";
import { stepLabel, targetById, type Plan } from "@/components/pointer/plan";
import type { LogEntry } from "@/components/pointer/run-state";
import type { SidebarProps } from "@/components/pointer/ui-contract";
import type { PlayState } from "@/components/pointer/use-run";
import {
  AskIcon,
  CheckIcon,
  ChevronIcon,
  PauseIcon,
  PlayIcon,
  PulseIcon,
  RestartIcon,
  StepIcon,
  StepKindIcon,
  StopIcon,
  XIcon,
} from "./icons";
import { IconButton } from "./IconButton";
import { clipWords, type PlanView, type TargetRow } from "./plan-view";

const STATUS_WORD: Record<ItemStatus | "none", string> = {
  complete: "Complete",
  missing: "Missing",
  unknown: "Unknown",
  none: "Not reviewed",
};

interface Props {
  plan: Plan;
  view: PlanView;
  log: LogEntry[];
  play: PlayState;
  controls: SidebarProps["controls"];
  onDecide: SidebarProps["onDecide"];
  onSelectTarget: (id: string) => void;
  onAskAboutStep: () => void;
  runNote?: string;
}

export function PlanTab({ plan, view, log, play, controls, onDecide, onSelectTarget, onAskAboutStep, runNote }: Props) {
  const [showDone, setShowDone] = useState(false);
  const step = view.current;

  return (
    <div className="sb-plan">
      <Controls play={play} controls={controls} />
      {runNote && (
        <p className="sb-run-note" title={runNote}>
          {runNote}
        </p>
      )}

      {view.done.length > 0 && (
        <div className="sb-done">
          <button
            type="button"
            className="sb-done-toggle"
            aria-expanded={showDone}
            aria-controls="sb-done-list"
            onClick={() => setShowDone((v) => !v)}
          >
            <span className="sb-done-check">
              <CheckIcon size={12} />
            </span>
            <span>
              {view.done.length} {view.done.length === 1 ? "step" : "steps"} done
            </span>
            <span className="sb-done-show">
              {showDone ? "Hide" : "Show"}
              <ChevronIcon dir={showDone ? "up" : "down"} size={12} />
            </span>
          </button>
          {/* Always rendered so .anim-collapse can animate height; closed = hidden from AT too. */}
          <div id="sb-done-list" className="anim-collapse" data-open={showDone}>
            <div>
              <ol className="sb-done-list">
                {view.done.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="sb-done-row"
                      tabIndex={showDone ? 0 : -1}
                      onClick={() => onSelectTarget(s.targets[0])}
                    >
                      <span className="sb-done-check">
                        <CheckIcon size={10} />
                      </span>
                      <span className="truncate">{s.title}</span>
                      <StepKindIcon kind={s.kind} size={12} className="sb-muted shrink-0" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {step && (
        <section key={step.id} className={`sb-hero anim-fade-up ${view.started ? "" : "sb-hero-preview"}`} aria-labelledby="sb-step-title">
          <div className="sb-hero-head">
            <span className="sb-kind" title={step.kind}>
              <StepKindIcon kind={step.kind} />
            </span>
            <div className="min-w-0">
              <p className="sb-eyebrow">{view.started ? stepLabel(plan, view.currentIndex) : `${plan.steps.length} steps · ready`}</p>
              <h2 id="sb-step-title" className="sb-step-title">
                {step.title}
              </h2>
            </div>
          </div>
          <div
            className="sb-progress"
            role="progressbar"
            aria-label="Plan progress"
            aria-valuemin={0}
            aria-valuemax={plan.steps.length}
            aria-valuenow={view.done.length}
          >
            <span style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>

          <ul className="sb-targets">
            {view.rows.map((r) => (
              <TargetRowView key={r.id} row={r} onSelect={onSelectTarget} />
            ))}
          </ul>

          {view.drafts.length > 0 && (
            <ul className="sb-drafts">
              {view.drafts.map(({ itemId, label, suggestion: s }) => (
                <li key={s.id} className={`sb-draft sb-draft-${s.decision} anim-fade-up`}>
                  <p className="sb-draft-head">
                    <span>{s.decision === "pending" ? "Draft" : s.decision === "accepted" ? "In your draft" : "Rejected"}</span>
                    <span className="sb-muted truncate">· {label}</span>
                  </p>
                  {s.decision !== "rejected" && <p className="sb-draft-text">{s.text}</p>}
                  {s.decision === "pending" && (
                    <div className="sb-draft-actions">
                      <button type="button" className="sb-btn sb-btn-accept" onClick={() => onDecide(itemId, s.id, "accepted")}>
                        <CheckIcon size={12} /> Accept
                      </button>
                      <button type="button" className="sb-btn" onClick={() => onDecide(itemId, s.id, "rejected")}>
                        <XIcon size={12} /> Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="sb-ask-step" onClick={onAskAboutStep}>
            <AskIcon size={14} />
            Ask about this step
          </button>
        </section>
      )}

      {view.upcoming > 0 && (
        <p className="sb-upcoming">
          <span className="sb-upcoming-dots" aria-hidden>
            {Array.from({ length: Math.min(view.upcoming, 12) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          {view.upcoming} to go
        </p>
      )}
      {play === "done" && view.upcoming === 0 && (
        <p className="sb-finished anim-pop">
          <CheckIcon size={12} /> Run finished
        </p>
      )}

      <Activity plan={plan} log={log} running={play === "playing"} />
    </div>
  );
}

function TargetRowView({ row, onSelect }: { row: TargetRow; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className={`sb-target ${row.current ? "sb-target-current" : ""}`}
        aria-current={row.current ? "step" : undefined}
        onClick={() => onSelect(row.id)}
        title={row.full}
      >
        {/* key on status: the dot pops when the run marks the target */}
        <span key={row.status ?? "none"} className={`sb-dot sb-dot-${row.status ?? "none"} ${row.status ? "anim-pop" : ""}`} />
        <span className="sb-sr">{STATUS_WORD[row.status ?? "none"]}:</span>
        <span className="sb-target-text">
          <span className="sb-target-label">
            {row.label}
            {row.flagged && (
              <span className="sb-flag" title="Law Lens flagged this line">
                Law
              </span>
            )}
          </span>
          {row.short && <span className="sb-target-status">{row.short}</span>}
        </span>
      </button>
    </li>
  );
}

// The live run starts from the editor's "Check my packet". These controls only
// pace it: Pause holds the hand while the stream keeps buffering, Step applies
// one queued action, Stop ends the run, Clear goes back to no check at all.
function Controls({ play, controls }: { play: PlayState; controls: Props["controls"] }) {
  const playing = play === "playing";
  const running = playing || play === "paused";
  return (
    <div className="sb-controls" role="toolbar" aria-label="Run controls">
      <IconButton
        label={playing ? "Pause" : "Resume"}
        onClick={playing ? controls.pause : controls.start}
        disabled={!running}
        primary
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </IconButton>
      <IconButton label="Step once" onClick={controls.step} disabled={!running}>
        <StepIcon />
      </IconButton>
      <IconButton label="Stop" onClick={controls.stop} disabled={!running}>
        <StopIcon />
      </IconButton>
      <IconButton label="Clear" onClick={controls.reset} disabled={play === "idle"}>
        <RestartIcon />
      </IconButton>
      <span className={`sb-play-state sb-play-${play}`} aria-live="polite">
        {playing && <span className="sb-live-dot" aria-hidden />}
        {{ idle: "Not run yet", playing: "Running", paused: "Paused", stopped: "Stopped", done: "Done" }[play]}
      </span>
      {play !== "idle" && (
        <span className="sb-run-mode sb-run-mode-live" title="Claude reads the documents now, live">
          Live · Claude
        </span>
      )}
    </div>
  );
}

function Activity({ plan, log, running }: { plan: Plan; log: LogEntry[]; running: boolean }) {
  return (
    <details className="sb-activity">
      <summary>
        <PulseIcon size={12} />
        Activity
        <span className="sb-count">{log.length}</span>
        {running && <span className="sb-live-dot" aria-hidden />}
      </summary>
      <ol className="sb-log">
        {log.length === 0 && <li className="sb-muted">Nothing yet.</li>}
        {log
          .slice()
          .reverse()
          .map((l) => (
            <li key={l.index} className={l.rejected ? "sb-log-rejected" : ""} title={l.rejected ?? l.event.text}>
              <code>{l.event.tool}</code>
              <span className="truncate">{targetById(plan, l.event.item_id)?.label ?? l.event.item_id}</span>
              {l.event.status && <span className={`sb-dot sb-dot-${l.event.status}`} aria-label={l.event.status} />}
              {(l.rejected || l.event.text) && (
                <span className="sb-log-text">{l.rejected ? `Ignored: ${l.rejected}` : clipWords(l.event.text ?? "", 12)}</span>
              )}
            </li>
          ))}
      </ol>
    </details>
  );
}
