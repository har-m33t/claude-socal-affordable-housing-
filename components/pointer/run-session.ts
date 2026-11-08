// A live plan run as a pure state machine.
//
// /api/agent streams events into a queue and one timer drains it through
// applyEvent, so the editor, the sidebar and the report fold events the same way.
// `final` is set when the stream ends, and the run is over once the queue has
// drained. Because events are queued rather than applied on arrival, Pause and
// Step hold the hand while the stream keeps buffering.
import type { AgentEvent } from "./contract";
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
  /** One honest line about the run: what it is doing, why it ended, or why it could not start. */
  note?: string;
  /** How the stream ended. The run takes this state once the queue drains. */
  final?: "done" | "stopped";
}

export type RunAction =
  | { type: "begin"; play: PlayState; note?: string }
  | { type: "push"; item: QueuedItem }
  | { type: "advance"; scope: TargetScope }
  | { type: "finish"; final: "done" | "stopped"; note?: string }
  | { type: "note"; note?: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop"; note?: string }
  | { type: "decide"; itemId: string; suggestionId: string; decision: "accepted" | "rejected" };

/** Before any check: no events, no statuses. `note` says why when a check could not start. */
export function idleSession(note?: string): RunSession {
  return { run: initialRunState(), queue: [], cursor: 0, play: "idle", note };
}

const ended = (p: PlayState) => p === "done" || p === "stopped";
/** Idle runs nothing, and an ended run takes nothing more. */
const inactive = (p: PlayState) => p === "idle" || ended(p);

/** Apply one queued item. Index = log length, so suggestion ids match a plain fold of the same events. */
function applyItem(run: RunState, item: QueuedItem, scope: TargetScope): RunState {
  const index = run.log.length;
  if (item.kind === "event") return applyEvent(run, item.event, index, scope);
  return { ...run, log: [...run.log, { index, event: item.event, rejected: `dropped by the verifier: ${item.reason}` }] };
}

/** Once the queue is empty, a stream that has ended ends the run; otherwise it waits for more. */
function settle(s: RunSession): RunSession {
  if (s.cursor < s.queue.length || inactive(s.play)) return s;
  return s.final ? { ...s, play: s.final } : s;
}

export function runReducer(s: RunSession, a: RunAction): RunSession {
  switch (a.type) {
    case "begin":
      return { ...idleSession(a.note), play: a.play };
    case "push":
      return inactive(s.play) ? s : { ...s, queue: [...s.queue, a.item] };
    case "advance":
      if (s.cursor >= s.queue.length || inactive(s.play)) return settle(s);
      return settle({ ...s, run: applyItem(s.run, s.queue[s.cursor], a.scope), cursor: s.cursor + 1 });
    case "finish":
      // A late finish after the person pressed Stop keeps their Stop.
      if (ended(s.play)) return a.note && s.play === "stopped" && !s.note ? { ...s, note: a.note } : s;
      if (s.play === "idle") return s;
      return settle({ ...s, final: a.final, note: a.note ?? s.note });
    case "note":
      return { ...s, note: a.note };
    case "play":
      return s.play === "paused" ? settle({ ...s, play: "playing" }) : s;
    case "pause":
      return s.play === "playing" ? { ...s, play: "paused" } : s;
    case "stop":
      return inactive(s.play) ? s : { ...s, play: "stopped", note: a.note ?? s.note };
    case "decide":
      return { ...s, run: decide(s.run, a.itemId, a.suggestionId, a.decision) };
  }
}
