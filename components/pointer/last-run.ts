// The editor's latest run, handed to the readiness report in page memory only.
//
// Live drafts can be restored from redaction tokens to real values on this device,
// so the run is never written to sessionStorage/localStorage. A module-level value
// survives Next's client-side navigation (Editor → Report via <Link>) and is gone
// on reload, which is the privacy property we want. With no run in this tab the
// report says so; it never invents one.
import type { RunState } from "./run-state";

export interface LastRun {
  run: RunState;
  city: string;
}

let last: LastRun | null = null;

export function publishRun(r: LastRun): void {
  last = r;
}

export function latestRun(): LastRun | null {
  return last;
}
