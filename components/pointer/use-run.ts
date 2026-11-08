"use client";
// The plan run hook. startLive() reads and redacts the packet, POSTs it to
// /api/agent and queues events as the stream delivers them; one timer paces them
// onto the page through the reducer in run-session.ts.
//
// There is only the live run. When it cannot happen at all (no key, rate
// limited, offline), the run stays idle with nothing checked and `note` says why.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { startLiveRun, type LiveRunEnd, type PreparedLiveRun } from "@/lib/live/run-client";
import { idleSession, runReducer, type QueuedItem } from "./run-session";
import type { TargetScope } from "./run-state";

export type { PlayState } from "./run-session";

/** Live events arrive in bursts (one model turn batches many calls); this paces the hand. */
const LIVE_GAP_MS = 450;
const FIRST_GAP_MS = 300;

export const IDLE_NOTE = "Press “Check my packet” to have Claude check your files.";
export const PREPARING_NOTE = "Live: reading and redacting your packet…";
export const LIVE_NOTE = "Live: Claude is checking your packet now.";
export const STOPPED_NOTE = "Stopped. The steps checked so far are kept.";

function endNote(end: Exclude<LiveRunEnd, { kind: "unavailable" }>): string {
  if (end.kind === "done") return "Live run finished.";
  if (end.kind === "refused") return `Refused: ${end.note}`;
  return end.note;
}

export function useRun(scope: TargetScope | undefined, speed = 1) {
  const [s, dispatch] = useReducer(runReducer, undefined, () => idleSession());
  const live = useRef<AbortController | null>(null);

  // One timer drains the queue. It depends on the cursor, not the queue, so a
  // burst of pushes does not keep resetting it.
  const pending = s.play === "playing" && s.cursor < s.queue.length;
  const gap = pending ? (s.cursor === 0 ? FIRST_GAP_MS : LIVE_GAP_MS / speed) : 0;
  useEffect(() => {
    if (!pending || !scope) return;
    const t = setTimeout(() => dispatch({ type: "advance", scope }), gap);
    return () => clearTimeout(t);
  }, [pending, gap, s.cursor, scope]);

  // Leaving the page ends a live run.
  useEffect(() => () => live.current?.abort(), []);

  const cancelLive = useCallback(() => {
    const was = live.current !== null;
    live.current?.abort();
    live.current = null;
    return was;
  }, []);

  const startLive = useCallback(
    async (prepare: (signal: AbortSignal) => Promise<PreparedLiveRun>) => {
      cancelLive();
      const ctl = new AbortController();
      live.current = ctl;
      const current = () => live.current === ctl;
      dispatch({ type: "begin", play: "playing", note: PREPARING_NOTE });

      let prepared: PreparedLiveRun;
      try {
        prepared = await prepare(ctl.signal);
      } catch (err) {
        if (!current()) return;
        live.current = null;
        const why = err instanceof Error ? err.message : "unknown error";
        dispatch({ type: "begin", play: "idle", note: `Could not read the packet (${why}). Nothing was run.` });
        return;
      }
      if (!current()) return;
      dispatch({ type: "note", note: [LIVE_NOTE, ...(prepared.notes ?? [])].join(" ") });

      const restore = prepared.restore ?? ((t: string) => t);
      const end = await startLiveRun(
        prepared.request,
        (sig) => {
          if (!current() || sig.kind === "status") return;
          const event = sig.event.text === undefined ? sig.event : { ...sig.event, text: restore(sig.event.text) };
          const item: QueuedItem = sig.kind === "event" ? { kind: "event", event } : { kind: "dropped", event, reason: sig.reason };
          dispatch({ type: "push", item });
        },
        ctl.signal,
      );
      if (!current()) return; // stopped, reset or superseded meanwhile
      ctl.abort(); // release the response body; the server's run ends with it
      live.current = null;
      if (end.kind === "unavailable") dispatch({ type: "begin", play: "idle", note: end.note });
      else dispatch({ type: "finish", final: end.kind === "done" ? "done" : "stopped", note: endNote(end) });
    },
    [cancelLive],
  );

  const step = useCallback(() => {
    if (!scope) return;
    dispatch({ type: "pause" });
    dispatch({ type: "advance", scope });
  }, [scope]);

  return {
    run: s.run,
    cursor: s.cursor,
    total: s.queue.length,
    play: s.play,
    note: s.note,
    start: useCallback(() => dispatch({ type: "play" }), []),
    pause: useCallback(() => dispatch({ type: "pause" }), []),
    step,
    stop: useCallback(() => {
      const wasLive = cancelLive();
      dispatch({ type: "stop", note: wasLive ? STOPPED_NOTE : undefined });
    }, [cancelLive]),
    reset: useCallback(() => {
      cancelLive();
      dispatch({ type: "begin", play: "idle" });
    }, [cancelLive]),
    startLive,
    decide: useCallback(
      (itemId: string, suggestionId: string, decision: "accepted" | "rejected") =>
        dispatch({ type: "decide", itemId, suggestionId, decision }),
      [],
    ),
  };
}
