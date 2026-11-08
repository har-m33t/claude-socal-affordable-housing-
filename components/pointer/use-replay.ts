"use client";
// The plan run hook. One reducer (run-session.ts), two sources:
//   playRecorded()  queues fixtures/plan-run.json and plays it on a timer
//   startLive()     reads and redacts the packet, POSTs it to /api/agent and
//                   queues events as the stream delivers them
// A live run that cannot happen at all (no key, rate limited, offline) falls
// back to the recording, and says so in `note`. A refusal never falls back.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { startLiveRun, type LiveRunEnd, type PreparedLiveRun } from "@/lib/live/run-client";
import type { AgentEvent } from "./contract";
import { recordedSession, runReducer, type QueuedItem, type RunSession } from "./run-session";
import { saveDecisions, type TargetScope } from "./run-state";

export type { PlayState } from "./run-session";

const MIN_GAP_MS = 700;
const MAX_GAP_MS = 2600;
/** Live events arrive in bursts (one model turn batches many calls); this paces the hand. */
const LIVE_GAP_MS = 450;

/** Delay before applying the item at the cursor. */
function gapMs(s: RunSession, speed: number): number {
  if (s.cursor === 0) return 300;
  if (s.mode === "live") return LIVE_GAP_MS / speed;
  const d = Date.parse(s.queue[s.cursor].event.ts) - Date.parse(s.queue[s.cursor - 1].event.ts);
  return (Number.isFinite(d) ? Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, d)) : 1400) / speed;
}

export const LIVE_NOTE = "Live: Claude is checking your packet now.";
export const STOPPED_NOTE = "Stopped. The steps checked so far are kept.";

function endNote(end: Exclude<LiveRunEnd, { kind: "fallback" }>): string {
  if (end.kind === "done") return "Live run finished.";
  if (end.kind === "refused") return `Refused: ${end.note}`;
  return end.note;
}

export function useRun(scope: TargetScope | undefined, recorded: AgentEvent[], speed = 1) {
  const [s, dispatch] = useReducer(runReducer, recorded, (events) => recordedSession(events));
  const live = useRef<AbortController | null>(null);

  // One timer drains the queue for both sources. It depends on the cursor, not
  // the queue, so a burst of live pushes does not keep resetting it.
  const pending = s.play === "playing" && s.cursor < s.queue.length;
  const gap = pending ? gapMs(s, speed) : 0;
  useEffect(() => {
    if (!pending || !scope) return;
    const t = setTimeout(() => dispatch({ type: "advance", scope }), gap);
    return () => clearTimeout(t);
  }, [pending, gap, s.cursor, scope]);

  useEffect(() => {
    saveDecisions(s.run);
  }, [s.run]);

  // Leaving the page ends a live run.
  useEffect(() => () => live.current?.abort(), []);

  const cancelLive = useCallback(() => {
    const was = live.current !== null;
    live.current?.abort();
    live.current = null;
    return was;
  }, []);

  const playRecorded = useCallback(
    (note?: string) => {
      cancelLive();
      dispatch({ type: "begin", mode: "recorded", queue: recordedSession(recorded).queue, play: "playing", note });
    },
    [cancelLive, recorded],
  );

  const startLive = useCallback(
    async (prepare: (signal: AbortSignal) => Promise<PreparedLiveRun>) => {
      cancelLive();
      const ctl = new AbortController();
      live.current = ctl;
      const current = () => live.current === ctl;
      dispatch({ type: "begin", mode: "live", queue: [], play: "playing", note: "Live: reading and redacting your packet…" });

      let prepared: PreparedLiveRun;
      try {
        prepared = await prepare(ctl.signal);
      } catch (err) {
        if (!current()) return;
        live.current = null;
        const why = err instanceof Error ? err.message : "unknown error";
        dispatch({
          type: "begin",
          mode: "recorded",
          queue: recordedSession(recorded).queue,
          play: "playing",
          note: `Could not read the packet (${why}), so playing the recorded run instead.`,
        });
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
      if (end.kind === "fallback") {
        playRecorded(end.note);
      } else {
        dispatch({ type: "finish", final: end.kind === "done" ? "done" : "stopped", note: endNote(end) });
      }
    },
    [cancelLive, playRecorded, recorded],
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
    mode: s.mode,
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
      dispatch({ type: "begin", mode: "recorded", queue: recordedSession(recorded).queue, play: "idle" });
    }, [cancelLive, recorded]),
    playRecorded,
    startLive,
    decide: useCallback(
      (itemId: string, suggestionId: string, decision: "accepted" | "rejected") =>
        dispatch({ type: "decide", itemId, suggestionId, decision }),
      [],
    ),
  };
}
