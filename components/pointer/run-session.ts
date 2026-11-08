// A plan run as a pure state machine, whatever its source.
//
// Both sources fill one queue and one timer drains it through applyEvent, so the
// editor, the sidebar and the report fold events the same way:
//   recorded  the queue is the whole recording up front (fixtures/plan-run.json)
//   live      the queue grows as /api/agent streams events; `final` is set when
//             the stream ends, and the run is over once the queue has drained.
// Because live events are queued rather than applied on arrival, Pause and Step
// mean the same thing in both modes: the stream keeps buffering, the hand waits.
import type { AgentEvent } from "./contract";
import type { RunMode } from "./documents";
import { applyEvent, decide, initialRunState, type RunState, type TargetScope } from "./run-state";

export type PlayState = "idle" | "playing" | "paused" | "stopped" | "done";

export type QueuedItem =
  | { kind: "event"; event: AgentEvent }
  /** An action the server's verifier threw away. Logged, never applied. */
  | { kind: "dropped"; event: AgentEvent; reason: string };

export interface RunSession {
  run: RunState;
  queue: QueuedItem[];
  /** Items applied from the queue so far. */
  cursor: number;
  play: PlayState;
  mode: RunMode;
  /** One honest line about where the events come from, or why the run ended. */
  note?: string;
  /** Live only: how the stream ended. The run takes this state once the queue drains. */
  final?: "done" | "stopped";
}

export type RunAction =
  | { type: "begin"; mode: RunMode; queue: QueuedItem[]; play: PlayState; note?: string }
  | { type: "push"; item: QueuedItem }
  | { type: "advance"; scope: TargetScope }
  | { type: "finish"; final: "done" | "stopped"; note?: string }
  | { type: "note"; note?: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop"; note?: string }
  | { type: "decide"; itemId: string; suggestionId: string; decision: "accepted" | "rejected" };

export function recordedSession(events: AgentEvent[], note?: string, play: PlayState = "idle"): RunSession {
  return { run: initialRunState(), queue: events.map((event) => ({ kind: "event", event })), cursor: 0, play, mode: "recorded", note };
}

const ended = (p: PlayState) => p === "done" || p === "stopped";

/** Apply one queued item. Index = log length, so suggestion ids match a plain fold of the same events. */
function applyItem(run: RunState, item: QueuedItem, scope: TargetScope): RunState {
  const index = run.log.length;
  if (item.kind === "event") return applyEvent(run, item.event, index, scope);
  return { ...run, log: [...run.log, { index, event: item.event, rejected: `dropped by the verifier: ${item.reason}` }] };
}

/** What the run becomes when the queue is empty: recorded runs are over, live runs wait for the stream. */
function settle(s: RunSession): RunSession {
  if (s.cursor < s.queue.length || ended(s.play)) return s;
  // Stepping through the last recorded event ends the run too, not just playing it.
  if (s.mode === "recorded") return s.play === "playing" || s.cursor > 0 ? { ...s, play: "done" } : s;
  return s.final ? { ...s, play: s.final } : s;
}

export function runReducer(s: RunSession, a: RunAction): RunSession {
  switch (a.type) {
    case "begin":
      return { run: initialRunState(), queue: a.queue, cursor: 0, play: a.play, mode: a.mode, note: a.note };
    case "push":
      return ended(s.play) ? s : { ...s, queue: [...s.queue, a.item] };
    case "advance": {
      if (s.cursor >= s.queue.length || ended(s.play)) return settle(s);
      return settle({ ...s, run: applyItem(s.run, s.queue[s.cursor], a.scope), cursor: s.cursor + 1 });
    }
    case "finish":
      // A late finish after the person pressed Stop keeps their Stop.
      if (ended(s.play)) return a.note && s.play === "stopped" && !s.note ? { ...s, note: a.note } : s;
      return settle({ ...s, final: a.final, note: a.note ?? s.note });
    case "note":
      return { ...s, note: a.note };
    case "play":
      return ended(s.play) ? s : settle({ ...s, play: "playing" });
    case "pause":
      return s.play === "playing" ? { ...s, play: "paused" } : s;
    case "stop":
      return ended(s.play) ? s : { ...s, play: "stopped", note: a.note ?? s.note };
    case "decide":
      return { ...s, run: decide(s.run, a.itemId, a.suggestionId, a.decision) };
  }
}
