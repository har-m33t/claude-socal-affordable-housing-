"use client";
import type { LiveError } from "@/components/pointer/use-live-run";

/**
 * Honest, specific banner for a run that could not happen. The important case
 * is `no_api_key`: both localhost and production currently have no key, so
 * this is the path most reviewers will see, and it must read as a
 * configuration fact with a way forward - not as a crash.
 */
export function RunNotice({ error, onScripted }: { error: LiveError; onScripted: () => void }) {
  const heading = HEADINGS[error.kind];
  const soft = error.kind === "no_api_key" || error.kind === "rate_limited";
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2.5 text-sm ${
        soft
          ? "border-[var(--color-line)] bg-[var(--color-cream-deep)]"
          : "border-[var(--color-missing)] bg-[var(--color-paper)]"
      }`}
    >
      <p className="font-semibold">{heading}</p>
      <p className="mt-0.5 text-[var(--color-ink-soft)]">{error.message}</p>
      {error.kind === "invalid_request" && error.issues.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-[var(--color-missing)]">
          {error.issues.map((i, k) => (
            <li key={`${i.path}-${k}`}>
              {i.path || "(body)"}: {i.message}
            </li>
          ))}
        </ul>
      )}
      {error.kind === "stream" && (
        <p className="mt-1 font-mono text-xs text-[var(--color-ink-soft)]">code: {error.code}</p>
      )}
      <button type="button" className="btn btn-primary mt-2" onClick={onScripted}>
        Run the scripted demo instead
      </button>
    </div>
  );
}

const HEADINGS: Record<LiveError["kind"], string> = {
  no_api_key: "No API key on this server, so no live run",
  rate_limited: "Live runs are rate limited right now",
  invalid_request: "The run request was rejected",
  refusal: "The agent refused this question",
  stream: "The run failed partway",
  network: "Could not start the run",
};
