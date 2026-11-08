// The editor's latest run, handed to the readiness report in page memory only.
//
// Live drafts can be restored from redaction tokens to real values on this device,
// so the run is never written to sessionStorage/localStorage. A module-level value
// survives Next's client-side navigation (Editor → Report via <Link>) and is gone
// on reload, which is the privacy property we want. The report falls back to the
// recorded run when there is none.
import type { RunMode } from "./documents";
import type { RunState } from "./run-state";

export interface LastRun {
  run: RunState;
  mode: RunMode;
  city: string;
}

let last: LastRun | null = null;

export function publishRun(r: LastRun): void {
  last = r;
}

export function latestRun(): LastRun | null {
  return last;
}
