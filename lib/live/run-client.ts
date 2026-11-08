// A live plan run: POST the (already redacted) packet to /api/agent and turn its
// SSE stream of StreamFrames into what the editor needs. Every way a run can end
// is one `LiveRunEnd`, and each one says honestly what happened:
//
//   done      the model finished the walk
//   stopped   the person pressed Stop, the step cap hit, or the run broke midway
//             (events so far are kept; nothing recorded is mixed in)
//   refused   the server or the model declined (e.g. an unverified city). No
//             fallback: a refusal must never be papered over with a recording.
//   fallback  no live run happened at all (no key, rate limited, server error,
//             offline). The caller plays the recorded run under `note`.
import { parseEvent, type AgentEvent } from "@/components/pointer/contract";
import { readSseData } from "./sse-client";

export interface LiveDocument {
  name: string;
  declared_type: string;
  /** Redacted text. Never the original. */
  text: string;
}

export interface LiveRunRequest {
  city: string;
  projectType: string;
  question: string;
  documents: LiveDocument[];
}

/** What a live run needs, prepared after the button is pressed (reading PDFs takes a moment). */
export interface PreparedLiveRun {
  request: LiveRunRequest;
  /** Puts redacted values back into a draft, on this device only. Identity when absent. */
  restore?: (text: string) => string;
  /** Anything the caps cut, said plainly. */
  notes?: string[];
}

/** What arrives while the run is going. */
export type LiveRunSignal =
  | { kind: "event"; event: AgentEvent }
  | { kind: "dropped"; reason: string; event: AgentEvent }
  | { kind: "status"; phase: "started" | "step"; step?: number; detail?: string };

export type LiveRunEnd =
  | { kind: "done" }
  | { kind: "stopped"; note: string }
  | { kind: "refused"; note: string }
  | { kind: "fallback"; note: string };

/** The full-run question. The prompt's plan-walk rules key off "check ... packet ... plan". */
export const FULL_RUN_QUESTION = "Check this homeowner's packet against every step of the plan, in order.";

const RECORDED = "playing the recorded run instead";

/** Error codes that mean "nothing was advised, and nothing should be": no fallback. */
const REFUSAL_CODES = new Set(["not_verified", "city_not_found", "type_not_found"]);
/** Error codes that mean "no live run was possible": fall back. */
const FALLBACK_CODES = new Set(["missing_api_key"]);

function httpNote(status: number, body: { error?: unknown; retry_after_ms?: unknown } | null): string {
  if (status === 503 && body?.error === "no_api_key") return `No API key on the server, so ${RECORDED}.`;
  if (status === 429) {
    const ms = typeof body?.retry_after_ms === "number" ? body.retry_after_ms : NaN;
    const wait = Number.isFinite(ms) ? ` Try live again in about ${Math.max(1, Math.ceil(ms / 1000))}s.` : "";
    return `Rate limited, so ${RECORDED}.${wait}`;
  }
  if (status === 400) return `The server rejected the request (400), so ${RECORDED}.`;
  return `The server answered ${status}, so ${RECORDED}.`;
}

async function readJson(res: Response): Promise<{ error?: unknown; retry_after_ms?: unknown } | null> {
  try {
    return (await res.json()) as { error?: unknown; retry_after_ms?: unknown };
  } catch {
    return null;
  }
}

const isAbort = (err: unknown) => err instanceof Error && err.name === "AbortError";

/**
 * Run the plan live. `onSignal` sees every accepted event, every verifier drop
 * and progress; the promise resolves with how the run ended. It never rejects.
 */
export async function startLiveRun(
  request: LiveRunRequest,
  onSignal: (s: LiveRunSignal) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<LiveRunEnd> {
  const stoppedByUser: LiveRunEnd = { kind: "stopped", note: "Stopped. The steps checked so far are kept." };
  let res: Response;
  try {
    res = await fetchImpl("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || isAbort(err)) return stoppedByUser;
    return { kind: "fallback", note: `Could not reach the server, so ${RECORDED}.` };
  }
  if (!res.ok || !res.body) return { kind: "fallback", note: httpNote(res.status, await readJson(res)) };

  let events = 0;
  /** A failure before any event is "no live run happened"; after one, the run just stopped. */
  const broke = (what: string): LiveRunEnd =>
    events === 0
      ? { kind: "fallback", note: `${what}, so ${RECORDED}.` }
      : { kind: "stopped", note: `${what}. The steps checked so far are kept.` };

  try {
    for await (const raw of readSseData(res.body)) {
      const frame = raw as { type?: unknown; [k: string]: unknown };
      switch (frame.type) {
        case "event": {
          const event = parseEvent(frame);
          if (event) {
            events += 1;
            onSignal({ kind: "event", event });
          }
          break;
        }
        case "dropped": {
          const event = parseEvent(frame.event);
          const reason = typeof frame.reason === "string" ? frame.reason : "no reason given";
          if (event) onSignal({ kind: "dropped", reason, event });
          break;
        }
        case "refusal":
          return { kind: "refused", note: typeof frame.reason === "string" ? frame.reason : "The model declined." };
        case "error": {
          const code = typeof frame.code === "string" ? frame.code : "error";
          const message = typeof frame.message === "string" ? frame.message : "The live run failed.";
          if (REFUSAL_CODES.has(code)) return { kind: "refused", note: message };
          if (FALLBACK_CODES.has(code)) return { kind: "fallback", note: `No API key on the server, so ${RECORDED}.` };
          return broke(`The live run failed (${code})`);
        }
        case "status": {
          const phase = frame.phase;
          const detail = typeof frame.detail === "string" ? frame.detail : undefined;
          if (phase === "done") return { kind: "done" };
          if (phase === "stopped") return { kind: "stopped", note: detail ? `Stopped: ${detail}.` : "Stopped." };
          if (phase === "started" || phase === "step") {
            onSignal({ kind: "status", phase, step: typeof frame.step === "number" ? frame.step : undefined, detail });
          }
          break;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted || isAbort(err)) return stoppedByUser;
    return broke("The connection dropped");
  }
  if (signal?.aborted) return stoppedByUser;
  return broke("The connection closed before the run finished");
}
