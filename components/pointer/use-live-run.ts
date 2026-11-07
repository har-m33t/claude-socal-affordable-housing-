"use client";
/**
 * Lane `live-run`: drives a REAL agent run against `POST /api/agent`.
 *
 * This is the mock seam from use-replay.ts, closed. Instead of a timer walking
 * a fixture array, the frames arrive over SSE and are folded into the SAME
 * `RunState` by the SAME `applyEvent` reducer, so the checklist, the hand and
 * the draft panel behave identically whichever mode produced them. Nothing in
 * run-state.ts or contract.ts changes for this; `parseEvent` already unwraps
 * the `{type:"event", event}` envelope.
 *
 * Deliberately NOT done here:
 * - No `saveDecisions`. The readiness report folds the SCRIPTED fixture, so
 *   writing live suggestion ids into sessionStorage would mislabel the report's
 *   rows (`s3` means different things in the two runs). Live decisions stay in
 *   this hook's state.
 * - No retry, no reconnect. A failed run is shown to the person, who decides.
 *
 * The question text an applicant types is sent in the POST body and is never
 * logged or persisted by this file.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { parseEvent, type AgentEvent, type CityConfig } from "./contract";
import { applyEvent, decide, initialRunState, type RunState } from "./run-state";

/** Where the run is, from the UI's point of view. */
export type RunPhase = "idle" | "connecting" | "running" | "done" | "stopped" | "error";

/** `phase` on a server `status` frame. */
export type StatusPhase = "started" | "step" | "done" | "stopped";

/**
 * One streamed frame, normalized for display. `seq` is assigned by this hook
 * (the wire carries no ids) and is stable, so it is safe as a React key.
 *
 * Every frame type the route can send is represented: an action that the
 * reducer accepted, an action the law gate dropped, a status beat, a refusal
 * and an error. The action log renders all five.
 */
export type LiveFrame =
  /** `rejected` is the REDUCER's own refusal (an unknown item id, a status-less
   * mark_item): the frame arrived but changed nothing, and the log says why. */
  | { seq: number; kind: "event"; event: AgentEvent; rejected?: string }
  | { seq: number; kind: "dropped"; reason: string; tool?: string; itemId?: string }
  | { seq: number; kind: "status"; phase: StatusPhase; step?: number; detail?: string }
  | { seq: number; kind: "refusal"; reason: string }
  | { seq: number; kind: "error"; code: string; message: string };

/**
 * Why a run could not happen, or did not finish. Each kind gets its own
 * message in the UI: a missing API key is a configuration fact, not a crash.
 */
export type LiveError =
  | { kind: "no_api_key"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterMs?: number; global: boolean }
  | { kind: "invalid_request"; message: string; issues: Array<{ path: string; message: string }> }
  | { kind: "refusal"; message: string }
  | { kind: "stream"; message: string; code: string }
  | { kind: "network"; message: string };

export interface LiveRunParams {
  /** Checklist and verification state. Events for unknown item ids are logged and ignored. */
  city: CityConfig | undefined;
  /** City NAME as the route's `city` field wants it. */
  cityName: string;
  /** `projectType`, not `type`: the route's schema is strict and `type` is a 400. */
  projectType: string;
  /** What the person typed. Required by the route, 1-4000 characters. */
  question: string;
}

export interface LiveRun {
  state: RunState;
  frames: LiveFrame[];
  phase: RunPhase;
  error: LiveError | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
  decide: (itemId: string, suggestionId: string, decision: "accepted" | "rejected") => void;
}

export const AGENT_ENDPOINT = "/api/agent";

// ------------------------------------------------------------------ SSE parsing

/**
 * Pull every COMPLETE SSE message out of `buffer` and return the unconsumed
 * tail. A message ends at a blank line, so a frame split across two network
 * chunks stays in `rest` until the rest of it arrives.
 *
 * Control frames carry an `event: <name>` line as well as `data:`; only
 * `data:` lines are read, which is why routing by `frame.type` works for both
 * named and unnamed frames. Multiple `data:` lines in one message are joined
 * with a newline, per the SSE spec.
 */
export function drainSSE(buffer: string): { frames: unknown[]; rest: string } {
  // \r\n and bare \r are legal SSE line endings. Normalizing the whole buffer
  // is idempotent, so re-normalizing a tail on the next chunk is harmless.
  let rest = buffer.replace(/\r\n|\r/g, "\n");
  const frames: unknown[] = [];
  for (;;) {
    const end = rest.indexOf("\n\n");
    if (end < 0) break;
    const message = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const data = message
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") continue; // a comment-only or name-only message
    try {
      frames.push(JSON.parse(data));
    } catch {
      frames.push({ type: "error", code: "bad_frame", message: "A streamed frame was not valid JSON." });
    }
  }
  return { frames, rest };
}

// ------------------------------------------------------------------ error mapping

function seconds(ms: unknown): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : 0;
}

/**
 * Map a non-2xx response to a specific, honest error. The wording is this
 * hook's, not the server's, so the UI can promise the one thing it can
 * actually deliver: the scripted run.
 */
export function errorFromResponse(status: number, body: unknown): LiveError {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = typeof b.error === "string" ? b.error : "";

  if (status === 503 && code === "no_api_key") {
    return {
      kind: "no_api_key",
      message:
        "This server has no ANTHROPIC_API_KEY, so there is no model to run. " +
        "Nothing is broken: a live run needs a key on the server. " +
        "The scripted run replays a recorded Anaheim run and needs no key.",
    };
  }
  if (status === 429 && (code === "rate_limited" || code === "rate_limited_global")) {
    const global = code === "rate_limited_global";
    const wait = seconds(b.retry_after_ms);
    const waited = wait > 0 ? ` Try again in about ${wait}s.` : " Try again shortly.";
    return {
      kind: "rate_limited",
      global,
      retryAfterMs: typeof b.retry_after_ms === "number" ? b.retry_after_ms : undefined,
      message: global
        ? `This app is at its ceiling for live runs across all callers.${waited}`
        : `Too many live runs from here.${waited}`,
    };
  }
  if (status === 400 && code === "invalid_request") {
    const raw = Array.isArray(b.issues) ? b.issues : [];
    const issues = raw.flatMap((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      return typeof o.message === "string"
        ? [{ path: typeof o.path === "string" ? o.path : "", message: o.message }]
        : [];
    });
    return { kind: "invalid_request", issues, message: "The server rejected the run request." };
  }
  if (status === 400) {
    return { kind: "invalid_request", issues: [], message: "The server could not read the run request." };
  }
  return {
    kind: "stream",
    code: code || `http_${status}`,
    message: `The server answered ${status} instead of starting a run. Nothing was submitted anywhere.`,
  };
}

// ------------------------------------------------------------------ reducer

interface S {
  run: RunState;
  frames: LiveFrame[];
  phase: RunPhase;
  error: LiveError | null;
  seq: number;
  /** Events handed to `applyEvent`. Doubles as the reducer's event index. */
  applied: number;
}

type A =
  | { type: "begin" }
  | { type: "frame"; raw: unknown; city: CityConfig }
  | { type: "closed" }
  | { type: "fail"; error: LiveError }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "decide"; itemId: string; suggestionId: string; decision: "accepted" | "rejected" };

function fresh(): S {
  return { run: initialRunState(), frames: [], phase: "idle", error: null, seq: 0, applied: 0 };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const STATUS_PHASES: StatusPhase[] = ["started", "step", "done", "stopped"];

function onFrame(s: S, raw: unknown, city: CityConfig): S {
  const frame = (raw ?? {}) as Record<string, unknown>;
  const seq = s.seq;
  const next = { ...s, seq: seq + 1 };

  switch (frame.type) {
    case "event": {
      // parseEvent unwraps the envelope and refuses anything off-contract.
      const event = parseEvent(raw);
      if (!event) {
        return {
          ...next,
          frames: [
            ...s.frames,
            { seq, kind: "dropped", reason: "the frame did not match the event contract and was ignored" },
          ],
        };
      }
      const run = applyEvent(s.run, event, s.applied, city);
      // applyEvent is the gate on item ids; its own refusal is in the entry it
      // just appended, and the log shows it rather than pretending it applied.
      const rejected = run.log[run.log.length - 1]?.rejected;
      return {
        ...next,
        run,
        applied: s.applied + 1,
        frames: [...s.frames, { seq, kind: "event", event, rejected }],
      };
    }
    case "status": {
      const phase = STATUS_PHASES.find((p) => p === frame.phase);
      if (!phase) return { ...next, frames: [...s.frames, { seq, kind: "dropped", reason: "status frame with no phase" }] };
      const step = typeof frame.step === "number" ? frame.step : undefined;
      return {
        ...next,
        phase: phase === "done" ? "done" : phase === "stopped" ? "stopped" : "running",
        frames: [...s.frames, { seq, kind: "status", phase, step, detail: str(frame.detail) }],
      };
    }
    case "dropped": {
      const dropped = (frame.event ?? {}) as Record<string, unknown>;
      return {
        ...next,
        frames: [
          ...s.frames,
          {
            seq,
            kind: "dropped",
            reason: str(frame.reason) ?? "no reason given",
            tool: str(dropped.tool),
            itemId: str(dropped.item_id),
          },
        ],
      };
    }
    case "refusal": {
      const reason = str(frame.reason) ?? "no reason given";
      return {
        ...next,
        error: { kind: "refusal", message: `The agent refused to answer: ${reason}` },
        frames: [...s.frames, { seq, kind: "refusal", reason }],
      };
    }
    case "error": {
      const code = str(frame.code) ?? "stream_error";
      const message = str(frame.message) ?? "The agent run failed before it finished.";
      return {
        ...next,
        phase: "error",
        error: { kind: "stream", code, message },
        frames: [...s.frames, { seq, kind: "error", code, message }],
      };
    }
    default:
      return {
        ...next,
        frames: [...s.frames, { seq, kind: "dropped", reason: `unrecognized frame type ${JSON.stringify(frame.type)}` }],
      };
  }
}

function reducer(s: S, a: A): S {
  switch (a.type) {
    case "begin":
      return { ...fresh(), phase: "connecting" };
    case "frame":
      return onFrame(s, a.raw, a.city);
    case "closed":
      // A stream that ends without a `done` status still ended. Say so rather
      // than leaving a spinner running forever.
      return s.phase === "connecting" || s.phase === "running" ? { ...s, phase: "done" } : s;
    case "fail":
      return { ...s, phase: "error", error: a.error };
    case "stop":
      return s.phase === "idle" ? s : { ...s, phase: "stopped" };
    case "reset":
      return fresh();
    case "decide":
      return { ...s, run: decide(s.run, a.itemId, a.suggestionId, a.decision) };
  }
}

// ------------------------------------------------------------------ hook

async function readBody(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return {};
  }
}

export function useLiveRun(params: LiveRunParams): LiveRun {
  const [s, dispatch] = useReducer(reducer, undefined, fresh);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const abort = useRef<AbortController | null>(null);

  // An unmount must not leave a request in flight.
  useEffect(() => () => abort.current?.abort(), []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    dispatch({ type: "stop" });
  }, []);

  const start = useCallback(() => {
    const { city, cityName, projectType, question } = paramsRef.current;
    if (!city) {
      dispatch({
        type: "fail",
        error: { kind: "network", message: `Pointer has no verified checklist for ${cityName}, so it will not run.` },
      });
      return;
    }
    const q = question.trim();
    if (q === "") {
      dispatch({
        type: "fail",
        error: { kind: "invalid_request", issues: [{ path: "question", message: "Type a question first." }], message: "Nothing to ask." },
      });
      return;
    }

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: "begin" });

    void (async () => {
      try {
        const res = await fetch(AGENT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Exactly the four contract fields. The route's schema is strict, so
          // any extra key would be a 400.
          body: JSON.stringify({ city: cityName, projectType, question: q }),
          signal: controller.signal,
        });

        if (!res.ok) {
          dispatch({ type: "fail", error: errorFromResponse(res.status, await readBody(res)) });
          return;
        }
        if (!res.body) {
          dispatch({
            type: "fail",
            error: { kind: "stream", code: "no_body", message: "The server accepted the run but sent no stream." },
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) buffer += decoder.decode(value, { stream: true });
          const drained = drainSSE(buffer);
          buffer = drained.rest;
          for (const raw of drained.frames) dispatch({ type: "frame", raw, city });
        }
        // Flush: a stream can end without the final blank line.
        buffer += decoder.decode();
        for (const raw of drainSSE(`${buffer}\n\n`).frames) dispatch({ type: "frame", raw, city });
        dispatch({ type: "closed" });
      } catch (err) {
        // stop() aborts the fetch; that is not a failure.
        if (controller.signal.aborted) return;
        dispatch({
          type: "fail",
          error: {
            kind: "network",
            message:
              err instanceof Error && err.message
                ? `Could not reach the agent endpoint: ${err.message}`
                : "Could not reach the agent endpoint.",
          },
        });
      }
    })();
  }, []);

  return {
    state: s.run,
    frames: s.frames,
    phase: s.phase,
    error: s.error,
    start,
    stop,
    reset: useCallback(() => {
      abort.current?.abort();
      abort.current = null;
      dispatch({ type: "reset" });
    }, []),
    decide: useCallback(
      (itemId: string, suggestionId: string, decision: "accepted" | "rejected") =>
        dispatch({ type: "decide", itemId, suggestionId, decision }),
      [],
    ),
  };
}
