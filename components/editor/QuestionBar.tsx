"use client";
import type { RunPhase } from "@/components/pointer/use-live-run";

export type RunMode = "live" | "scripted";

/** A sensible starting question, so the field is never an empty box. */
export const DEFAULT_QUESTION = "What is missing from my packet, and what do I need to fix before I apply?";

export const QUESTION_MAX = 4_000;

/**
 * Where a run comes from, and the question that drives it.
 *
 * The mode is explicit and always on screen, because the two modes produce
 * different things: a live run asks the model about THIS question, while the
 * scripted run replays a recorded Anaheim run and ignores the question
 * entirely. A reviewer must never have to guess which one they are looking at.
 */
export function QuestionBar({
  mode,
  onMode,
  question,
  onQuestion,
  phase,
  onRun,
  onStop,
  busy,
}: {
  mode: RunMode;
  onMode: (m: RunMode) => void;
  question: string;
  onQuestion: (q: string) => void;
  phase: RunPhase;
  onRun: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const live = mode === "live";
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-line)] px-5 py-3">
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="sr-only">Run mode</legend>
        <span className="picker-label">Run mode</span>
        {(
          [
            ["live", "Live agent run", "calls the model with your question"],
            ["scripted", "Scripted replay", "a recorded run, no model, no key needed"],
          ] as Array<[RunMode, string, string]>
        ).map(([value, label, hint]) => (
          <label key={value} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="run-mode"
              value={value}
              checked={mode === value}
              onChange={() => onMode(value)}
            />
            <span className={mode === value ? "font-semibold" : ""}>{label}</span>
            <span className="text-xs text-[var(--color-ink-soft)]">· {hint}</span>
          </label>
        ))}
      </fieldset>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (live && !busy) onRun();
        }}
      >
        <label className="picker min-w-0 flex-1">
          <span className="picker-label">Your question</span>
          <input
            type="text"
            value={question}
            maxLength={QUESTION_MAX}
            onChange={(e) => onQuestion(e.target.value)}
            disabled={!live}
            placeholder={DEFAULT_QUESTION}
            className="picker-select !w-full"
            aria-describedby="question-hint"
          />
          <span id="question-hint" className="picker-hint">
            {live
              ? "Sent to the agent with the city and project type. Nothing is filed anywhere."
              : "The scripted replay ignores the question."}
          </span>
        </label>
        {live &&
          (busy ? (
            <button type="button" className="btn btn-stop" onClick={onStop}>
              Stop agent
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={question.trim() === ""}>
              {phase === "idle" ? "Run live agent" : "Run again"}
            </button>
          ))}
      </form>
    </div>
  );
}
