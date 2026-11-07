/**
 * One display shape for the action log, so the same component renders the
 * scripted replay (a list of `LogEntry`) and a live run (a list of
 * `LiveFrame`). Pure: no React, no DOM.
 *
 * A live run carries frame types the scripted fixture never produces - law-gate
 * drops, status beats, refusals, errors - and all of them are worth seeing, so
 * the row union covers every one.
 */
import type { AgentEvent, Citation } from "@/components/pointer/contract";
import type { LogEntry } from "@/components/pointer/run-state";
import type { LiveFrame } from "@/components/pointer/use-live-run";

export type LogRow =
  | { key: string; kind: "action"; event: AgentEvent; rejected?: string; citation?: Citation }
  | { key: string; kind: "dropped"; reason: string; tool?: string; itemId?: string }
  | { key: string; kind: "status"; phase: string; step?: number; detail?: string }
  | { key: string; kind: "refusal"; reason: string }
  | { key: string; kind: "error"; code: string; message: string };

/**
 * Law reaches the UI only as a server-rendered `statute_ref` (contract.ts
 * rejects any event carrying a `citation`), so the log's source chip is built
 * from that. `parseEvent` has already checked every field is a string.
 */
interface StatuteRefish {
  title?: string;
  source_url?: string;
  checked_date?: string;
  quote?: string;
  old?: string;
  new_range?: string;
}

export function statuteCitation(event: AgentEvent): Citation | undefined {
  const ref = (event as AgentEvent & { statute_ref?: StatuteRefish }).statute_ref;
  if (!ref || typeof ref.source_url !== "string") return undefined;
  const span = ref.old && ref.new_range ? `${ref.old} → ${ref.new_range}` : undefined;
  return {
    title: ref.title ?? span ?? ref.source_url,
    url: ref.source_url,
    checked_date: ref.checked_date,
    quote: ref.quote,
  };
}

/** Scripted replay rows. */
export function rowsFromLog(log: LogEntry[]): LogRow[] {
  return log.map((l) => ({
    key: `r${l.index}`,
    kind: "action",
    event: l.event,
    rejected: l.rejected,
    citation: l.citation ?? statuteCitation(l.event),
  }));
}

/** Live run rows, in arrival order. */
export function rowsFromFrames(frames: LiveFrame[]): LogRow[] {
  return frames.map((f) => {
    const key = `l${f.seq}`;
    switch (f.kind) {
      case "event":
        return { key, kind: "action", event: f.event, rejected: f.rejected, citation: statuteCitation(f.event) };
      case "dropped":
        return { key, kind: "dropped", reason: f.reason, tool: f.tool, itemId: f.itemId };
      case "status":
        return { key, kind: "status", phase: f.phase, step: f.step, detail: f.detail };
      case "refusal":
        return { key, kind: "refusal", reason: f.reason };
      case "error":
        return { key, kind: "error", code: f.code, message: f.message };
    }
  });
}
