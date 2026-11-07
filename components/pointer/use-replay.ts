"use client";
// Plays a list of agent events into RunState on a timer. This is the mock seam: at
// integration, Team 3's SSE stream can call `push(event)` instead of using the timer.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentEvent } from "./contract";
import { applyEvent, decide, initialRunState, saveDecisions, type RunState, type TargetScope } from "./run-state";

export type PlayState = "idle" | "playing" | "paused" | "stopped" | "done";

interface S {
  run: RunState;
  cursor: number; // events applied so far
  play: PlayState;
}

type A =
  | { type: "advance"; event: AgentEvent; city: TargetScope }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "done" }
  | { type: "reset" }
  | { type: "decide"; itemId: string; suggestionId: string; decision: "accepted" | "rejected" };

function reducer(s: S, a: A): S {
  switch (a.type) {
    case "advance":
      return { ...s, run: applyEvent(s.run, a.event, s.cursor, a.city), cursor: s.cursor + 1 };
    case "play":
      return s.play === "done" || s.play === "stopped" ? s : { ...s, play: "playing" };
    case "pause":
      return s.play === "playing" ? { ...s, play: "paused" } : s;
    case "stop":
      return { ...s, play: "stopped" };
    case "done":
      return { ...s, play: "done" };
    case "reset":
      return { run: initialRunState(), cursor: 0, play: "idle" };
    case "decide":
      return { ...s, run: decide(s.run, a.itemId, a.suggestionId, a.decision) };
  }
}

const MIN_GAP_MS = 700;
const MAX_GAP_MS = 2600;

function gapMs(prev: AgentEvent | undefined, next: AgentEvent, speed: number): number {
  let ms = 1400;
  if (prev) {
    const d = Date.parse(next.ts) - Date.parse(prev.ts);
    if (Number.isFinite(d)) ms = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, d));
  }
  return ms / speed;
}

export function useReplay(events: AgentEvent[], city: TargetScope | undefined, speed = 1) {
  const [s, dispatch] = useReducer(reducer, { run: initialRunState(), cursor: 0, play: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (s.play !== "playing" || !city) return;
    if (s.cursor >= events.length) {
      dispatch({ type: "done" });
      return;
    }
    const next = events[s.cursor];
    timer.current = setTimeout(
      () => dispatch({ type: "advance", event: next, city }),
      s.cursor === 0 ? 300 : gapMs(events[s.cursor - 1], next, speed),
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [s.play, s.cursor, events, city, speed]);

  useEffect(() => {
    saveDecisions(s.run);
  }, [s.run]);

  const step = useCallback(() => {
    if (!city || s.cursor >= events.length || s.play === "stopped") return;
    dispatch({ type: "pause" });
    dispatch({ type: "advance", event: events[s.cursor], city });
    if (s.cursor + 1 >= events.length) dispatch({ type: "done" });
  }, [city, events, s.cursor, s.play]);

  return {
    run: s.run,
    cursor: s.cursor,
    total: events.length,
    play: s.play,
    start: useCallback(() => dispatch({ type: "play" }), []),
    pause: useCallback(() => dispatch({ type: "pause" }), []),
    stop: useCallback(() => dispatch({ type: "stop" }), []),
    reset: useCallback(() => dispatch({ type: "reset" }), []),
    step,
    decide: useCallback(
      (itemId: string, suggestionId: string, decision: "accepted" | "rejected") =>
        dispatch({ type: "decide", itemId, suggestionId, decision }),
      [],
    ),
  };
}
